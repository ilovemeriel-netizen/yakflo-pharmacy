-- 0118 — 옛 「출고 자동집계」 단추가 넘지 말아야 할 선 두 가지 (2026-11-09 이정화 님 승인)
--
-- ★ 이 파일은 **함수 정의만** 바꾼다. 어떤 줄의 값도 바꾸지 않는다 —
--   drugs·transactions·monthly_snapshots 에 UPDATE·INSERT·DELETE 가 한 줄도 없다.
--   돌린 직후 화면 숫자는 그대로이고, **다음에 단추를 눌렀을 때부터** 동작이 달라진다.
--
-- ★ 운영에 있는 함수 원문(7,871자)을 그대로 가져와 **두 곳만** 고쳤다.
--   권한 검사 · 마약·향정 달력 갈래(0111) · (A)(B) 의 기간·대상·manual 보존 ·
--   반환값은 **한 글자도 같다.**
--
-- ① (A2) 폴백에 「수기 값은 건너뛴다」 조건 한 줄을 더한다
--    (A)·(B) 는 이미 manual 을 건너뛰는데 (A2) 만 보지 않아, 수기로 정한 값을
--    「오늘부터 30일」 기준으로 덮어쓸 수 있었다. 2026-11-09 실측 — 조건에 걸리는 약
--    70종 중 실제로 값이 들어갈 약 10종, 그중 manual 5종(데소나로션 · 락티케어제마지스로션 ·
--    더모베이트액 · 바헬바레스피맷 · 에펙신안연고). 새 「사용량 비교」가 지키기로 한
--    극소량 약을 이 갈래가 되돌려 놓는 일을 막는다.
--
-- ② (A) 에서 전년 사용량에 값을 넣던 줄 하나를 뺀다
--    전년 사용량은 **수기 유지**로 정했다(2026-11-09). 또 지금 거래가 넉 달치뿐이라
--    「롤링 12개월」로 센 전년은 어차피 맞지 않는다. (A) 는 이미 manual 을 건너뛰므로
--    실제 영향 범위는 usage_source 가 비어 있는 약뿐이다(사용 30 · 휴면 6 · auto 2).
--    ★ 월평균을 전년으로 채우는 갈래는 **그대로 둔다** — 지운 것은 전년 칸에
--      값을 넣는 줄 하나뿐이다.

create or replace function public.app_recompute_usage(
  p_overwrite_manual boolean default false,
  p_scope            text    default 'all',
  p_year             integer default null,
  p_month            integer default null
) returns integer
language plpgsql
set search_path to 'public'
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
      /* ★ 0118 — 여기 한 줄만 더했다. 수기로 정한 값을 덮지 않는다(2026-11-09). */
      and (p_overwrite_manual or dd.usage_source is distinct from 'manual')
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
