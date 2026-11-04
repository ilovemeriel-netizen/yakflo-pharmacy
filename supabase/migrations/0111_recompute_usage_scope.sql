-- 0111_recompute_usage_scope.sql   ★ 시안 — **적용하지 않았다**(dryrun 결과만 보고)
--
-- 목적: `app_recompute_usage` 가 **마약·향정만**, **달력 기준 기준월**로 다시 셀 수 있게 한다.
--
-- 왜 (2026-11-04 이정화 님 결정 · 확정 업무 규칙 9)
--   마약·향정의 출고는 NIMS 거래량으로 입력하므로 직전1개월·최근3개월의 정본은 **약플로 출고**다.
--   그런데 그 칸들에는 예전에 원내(EMR) 파일로 넣은 값이 남아 있어 출고와 어긋나 있다.
--   A단계(PR #400)가 「더 어긋나지 않게」 막았고, B-1(PR #401)이 「얼마나 어긋났나」를 보여 준다.
--   이 마이그레이션은 그 숫자를 **실제로 넣는** 길을 만든다.
--
-- ★ 왜 달력 기준인가
--   지금 (A)·(B) 블록은 `current_date - interval '1 month'` 를 쓴다 — 「오늘부터 30일」이라
--   **하루만 지나도 답이 달라진다**(2026-11-04 에 돌리면 창이 10-03~11-03 이라 10-31 출고는
--   들어오고 09-30 출고는 빠진다). 월마감은 달력으로 끊으므로 사용량도 달력으로 끊어야 짝이 맞는다.
--     달력 1개월 = [그달 1일, 다음달 1일)
--     달력 3개월 = [그달−2개월 1일, 다음달 1일)
--
-- ★ 계산식은 **한 글자도 바꾸지 않는다** — 기존 (A) 블록과 같은 식이다.
--     월평균 = 3개월이 있으면 round(3개월 / 3), 없으면 round(전년 / 12)
--     안전재고 = ceil(월평균 × 1.2)   ·   최대재고 = round(월평균 × 3)
--   화면(App.jsx)·0108·usageParse·narcoticUsagePreview 가 모두 이 식을 쓴다.
--
-- ★ 기본값이 지금 동작이다
--   `p_scope` 를 안 주면 'all', 기준월을 안 주면 지금과 **똑같이** 돈다.
--   화면의 「출고 자동집계」(p_overwrite_manual:false 하나만 넘긴다)는 **한 글자도 달라지지 않는다**.
--
-- ★ usage_source 는 'manual' 로 둔다 — 보호를 그대로 유지하기 위해서다.
--   'auto' 로 적으면 다음에 누가 「출고 자동집계」를 누를 때 (A)·(B) 블록의
--   `usage_source is distinct from 'manual'` 조건에 걸려 **덮인다**.
--   마약·향정 값은 NIMS 기준이라 일반 자동집계가 건드리면 안 되므로 'manual' 을 유지한다.
--   ※ 덤 — 지금 마약·향정 29종 가운데 **8종은 usage_source 가 비어 있어 보호가 안 걸린다**
--     (전부 중지·값 0 이라 당장 잃을 것은 없다). 이 함수를 한 번 돌리면 그 8종도 'manual' 이 되어
--     보호 안으로 들어온다.
--
-- ★ CREATE OR REPLACE 로는 인자를 못 늘린다 — 같은 이름의 **다른 함수**가 하나 더 생겨
--   PostgREST 가 어느 쪽을 부를지 헷갈린다. 그래서 **같은 트랜잭션 안에서** 옛 것을 지우고
--   새로 만든다(중간에 빈 순간이 없다). 지운 뒤에는 권한도 사라지므로 **다시 준다**
--   — 지금과 똑같이 authenticated 만 execute, anon·service_role 은 없음.
--
-- ★ expand 순서 (CLAUDE.md): 이 함수를 **먼저** 적용하고 PostgREST 캐시를 갱신해
--   API 에서 새 인자가 보이는지 확인한 뒤에야 이 인자를 쓰는 화면을 배포한다.

begin;

-- 옛 함수 제거 — 같은 트랜잭션 안이라 바깥에서는 빈 순간이 없다
drop function if exists public.app_recompute_usage(boolean);

create function public.app_recompute_usage(
  p_overwrite_manual boolean default false,
  p_scope            text    default 'all',      -- 'all' | 'narcotic'
  p_year             integer default null,
  p_month            integer default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_count  integer;
  v_count2 integer;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_srole  text := session_user;                                    -- 접속한 롤 (SET ROLE 에 안 흔들린다)
  v_grole  text := coalesce(current_setting('role', true), 'none');  -- PostgREST 가 건 SET ROLE 결과
  v_mrole  text;
  v_m1_from date;
  v_m3_from date;
  v_to      date;                                                    -- **포함하지 않는다**
begin
  -- ⓐ 관리자 검사 — 0105·0105c 와 **글자 그대로 같은** 판정이다(바꾸지 않았다).
  --    예외는 service_role(JWT)·직접 접속한 관리 롤뿐이다.
  --    ★ 「auth.uid() is null 이면 통과」로 적지 않는다 — 그러면 로그인 안 한 사람까지 통과한다.
  --    ★ current_user 도 쓰지 않는다 — DEFINER 안에서 주인으로 바뀐다(트리거 쪽 주석 참조).
  if not (coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
          or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none')) then
    if not exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id in (select current_tenant_ids())
    ) then
      -- 0105c 와 같은 진단값 — 토큰·비밀값은 넣지 않는다. uid 는 앞 8자리만.
      select tm.role into v_mrole
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id in (select current_tenant_ids())
       limit 1;
      raise exception '출고 자동집계는 관리자만 실행할 수 있습니다 [진단: uid=%, member_role=%, guc_role=%]',
        coalesce(left(auth.uid()::text, 8), '없음'),
        coalesce(v_mrole, '없음'),
        v_grole
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_scope is null or p_scope not in ('all', 'narcotic') then
    raise exception '알 수 없는 대상 범위입니다(all · narcotic 만 됩니다)'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- 마약·향정만 · 달력 기준 — 새 갈래
  -- ═══════════════════════════════════════════════════════════════════
  if p_scope = 'narcotic' then
    if p_year is null or p_month is null then
      raise exception '기준월(연·월)을 주셔야 합니다'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_month < 1 or p_month > 12 or p_year < 2000 or p_year > 2100 then
      raise exception '기준월이 올바르지 않습니다(%-%)', p_year, p_month
        using errcode = 'invalid_parameter_value';
    end if;

    v_m1_from := make_date(p_year, p_month, 1);
    v_m3_from := (v_m1_from - interval '2 months')::date;
    v_to      := (v_m1_from + interval '1 month')::date;    -- 이 날은 **포함하지 않는다**

    with tx as (
      select t.drug_code,
        coalesce(sum(t.quantity) filter (
          where t.transaction_date >= v_m1_from and t.transaction_date < v_to), 0) as m1,
        coalesce(sum(t.quantity) filter (
          where t.transaction_date >= v_m3_from and t.transaction_date < v_to), 0) as m3
      from public.transactions t
      where t.type = '출고'
        and t.transaction_date >= v_m3_from
        and t.transaction_date <  v_to
      group by t.drug_code
    ),
    calc as (
      select d.drug_code,
        coalesce(tx.m1, 0) as m1,
        coalesce(tx.m3, 0) as m3,
        /* ★ 기존 (A) 블록과 **같은 식**이다. 새로 만들지 않았다. */
        case when coalesce(tx.m3, 0) > 0 then round(coalesce(tx.m3, 0) / 3.0)
             when coalesce(d.prev_year_usage, 0) > 0 then round(coalesce(d.prev_year_usage, 0) / 12.0)
             else null end as mavg
      from public.drugs d
      left join tx on tx.drug_code = d.drug_code
      /* ★ 범위는 여기 한 줄뿐이다 — 한외마약은 들어오지 않는다(확정 업무 규칙 9) */
      where d.narcotic_type in ('마약', '향정')
    )
    update public.drugs d set
      recent_1m_usage = c.m1,
      recent_3m_usage = c.m3,
      monthly_avg  = coalesce(c.mavg, d.monthly_avg),
      safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
      max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
      /* ★ 'auto' 가 아니라 'manual' 이다 — 일반 자동집계가 못 덮게 보호를 유지한다(위 주석) */
      usage_source = 'manual'
    from calc c
    where d.drug_code = c.drug_code
      /* 바뀌는 것이 없는 줄은 건드리지 않는다 — 감사표에 빈 줄이 쌓이지 않게 */
      and (d.recent_1m_usage is distinct from c.m1
        or d.recent_3m_usage is distinct from c.m3
        or (c.mavg is not null and (
             d.monthly_avg  is distinct from c.mavg
          or d.safety_stock is distinct from ceil(c.mavg * 1.2)
          or d.max_stock    is distinct from round(c.mavg * 3)))
        or d.usage_source is distinct from 'manual');
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- 아래는 **지금과 똑같다** — 한 글자도 바꾸지 않았다.
  -- ═══════════════════════════════════════════════════════════════════

  -- (A) recent_3m·prev_year·monthly_avg·safety·max: 출고 있는 약품만 갱신, manual 보존.
  with agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select drug_code,
      coalesce(py, 0) as py,
      coalesce(r3, 0) as r3,
      case when coalesce(r3,0) > 0 then round(coalesce(r3,0) / 3.0)
           when coalesce(py,0) > 0 then round(coalesce(py,0) / 12.0)
           else null end as mavg
    from agg
  )
  update public.drugs d set
    prev_year_usage = c.py,
    recent_3m_usage = c.r3,
    monthly_avg  = coalesce(c.mavg, d.monthly_avg),
    safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');
  get diagnostics v_count = row_count;

  -- (A2) (A)에서 빠진(출고 없음) 또는 manual 스킵된 약품 중 safety_stock 미설정 건을
  --      컬럼 폴백으로 채운다. 컬럼·usage_source 무변경, 빈 값만, mavg>0만.
  update public.drugs d set
    monthly_avg  = fb.mavg,
    safety_stock = ceil(fb.mavg * 1.2),
    max_stock    = round(fb.mavg * 3)
  from (
    select dd.drug_code,
      case
        when coalesce(txa.r3,0) > 0 then round(coalesce(txa.r3,0) / 3.0)
        when coalesce(txa.py,0) > 0 then round(coalesce(txa.py,0) / 12.0)
        when coalesce(dd.prev_year_usage,0) > 0 then round(coalesce(dd.prev_year_usage,0) / 12.0)
        when coalesce(dd.recent_3m_usage,0) > 0 then round(coalesce(dd.recent_3m_usage,0) / 3.0)
        else null
      end as mavg
    from public.drugs dd
    left join (
      select t.drug_code,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
      from public.transactions t
      where t.type = '출고'
      group by t.drug_code
    ) txa on txa.drug_code = dd.drug_code
    where dd.status in ('사용','휴면')
      and coalesce(dd.safety_stock, 0) <= 0
      and coalesce(dd.monthly_avg, 0) <= 0
  ) fb
  where d.drug_code = fb.drug_code
    and fb.mavg is not null
    and fb.mavg > 0;
  get diagnostics v_count2 = row_count;

  -- (B) recent_1m_usage: 최근 1개월 출고 합(없으면 0). 0105 의 manual 보호가 걸려 있다.
  update public.drugs d set
    recent_1m_usage = coalesce(sub.r1, 0)
  from (
    select d2.drug_code, ag.r1
    from public.drugs d2
    left join (
      select t.drug_code, sum(t.quantity) as r1
      from public.transactions t
      where t.type = '출고'
        and t.transaction_date >= current_date - interval '1 month'
      group by t.drug_code
    ) ag on ag.drug_code = d2.drug_code
  ) sub
  where d.drug_code = sub.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');

  return v_count + v_count2;
end
$function$;

-- 권한 — 지운 뒤에는 사라지므로 **지금과 똑같이** 다시 준다
revoke all on function public.app_recompute_usage(boolean, text, integer, integer) from public;
revoke all on function public.app_recompute_usage(boolean, text, integer, integer) from anon;
grant execute on function public.app_recompute_usage(boolean, text, integer, integer) to authenticated;

commit;

-- PostgREST 스키마 캐시 갱신 — 이 줄까지 돌려야 API 에서 새 인자가 보인다(CLAUDE.md 함정 #22).
notify pgrst, 'reload schema';

-- ═══ 확인 (읽기 전용) ═══
--   select has_function_privilege('anon','public.app_recompute_usage(boolean,text,integer,integer)','execute') as anon,
--          has_function_privilege('authenticated','public.app_recompute_usage(boolean,text,integer,integer)','execute') as auth;
--   → anon false · auth true
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='app_recompute_usage';
--   → 1 (두 개면 PostgREST 가 헷갈린다)

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop function if exists public.app_recompute_usage(boolean, text, integer, integer);
--   그다음 0051_recompute_column_fallback.sql 의 함수 본문을 다시 만들고
--   grant execute ... to authenticated 를 다시 준다.
--   ⚠ 이미 넣은 마약·향정 값은 되돌아오지 않는다 — 값 복구는 drug_usage_audit 를 보고 손으로 한다.
