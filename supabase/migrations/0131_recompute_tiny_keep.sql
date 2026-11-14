-- ════════════════════════════════════════════════════════════════════════
-- 0131 — 「반올림 꼬리는 기준을 지운다」를 **자동집계에도** 맞춘다
--        (2026-11-14 이정화 님 지적 · 2단계 앞에 먼저 깐다)
--
-- 무엇이 어긋났나
--   PR #466 에서 사용량 비교·갱신에는 규칙 ③ 을 넣었다 —
--     「3개월 출고가 **있는데** 월평균이 반올림으로 0 이 되면, 기존 기준을 그대로 둔다」
--     (lib/usageCompare.js 의 tiny — 1 ÷ 3 = 0.33 → round 0)
--   그런데 app_recompute_usage 에는 **그 규칙이 없다.** 그대로 0 을 쓴다.
--   그래서 2단계로 수기 도장을 풀고 자동집계를 돌리면, 3개월에 1개만 나간 약
--   8종이 월평균·안전재고를 **0 으로 잃는다**(그중 5종은 지금 기준이 있다).
--   「안 쓰는 약」과 「아주 조금 쓰는 약」은 다른데 똑같이 0 이 된다.
--
-- 무엇을 바꾸나 — **두 군데뿐**
--   (A)·(A2) 의 월평균 갈래에서
--     · 출고가 **0 이면** 그대로 **0** (0129 규칙 그대로 — 안 쓰는 약은 0 이다)
--     · 출고가 **있는데** 반올림이 0 이면 **null** → 기존 월평균·안전재고·최대재고를 **그대로 둔다**
--   null 이 「그대로 둔다」가 되는 까닭은 아래 두 줄이 이미 그렇게 쓰여 있기 때문이다:
--     monthly_avg  = coalesce(c.mavg, d.monthly_avg)
--     safety_stock = case when c.mavg is not null then ... else d.safety_stock end
--   그래서 **다른 줄은 한 글자도 건드리지 않는다.**
--
-- 무엇을 **안** 바꾸나
--   · 반올림 자체(round) — 건드리지 않는다(함정 #15)
--   · recent_3m_usage 는 **실제 출고 숫자로 갱신**한다. 그것은 「기준」이 아니라 **사실**이라
--     묵은 값을 두면 화면에 거짓을 보여 준다.
--   · 마약 갈래(p_scope='narcotic') · 권한 검사 · 감사 · 반환값 · (B) 1개월 집계
--
-- ★ 서명이 그대로라 CREATE OR REPLACE 로 갈아끼운다(함수가 늘지 않는다).
-- ════════════════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public.app_recompute_usage(p_overwrite_manual boolean DEFAULT false, p_scope text DEFAULT 'all'::text, p_year integer DEFAULT NULL::integer, p_month integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  with win3 as (
    /* 가장 최근 마감 3개월 — 재고현황 「N개월 사용량 0」과 **같은 잣대**를 쓴다 */
    select (snap_year * 100 + snap_month) ym
      from public.monthly_snapshots
     group by 1 order by 1 desc limit 3
  ),
  snap3 as (
    select upper(btrim(drug_code)) code, count(*) n
      from public.monthly_snapshots
     where (snap_year * 100 + snap_month) in (select ym from win3)
     group by 1
  ),
  agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select a.drug_code,
      coalesce(a.py, 0) as py,
      coalesce(a.r3, 0) as r3,
      case
        /* ★★ 창에 **기록이 있는데**(마감 줄 3개 이상) 출고가 0 이면 **0** 이다.
             전년÷12 로 넘어가지 않는다 — 「3개월 사용량 0 이면 발주 대상 아님」과 맞춘다.
           ★ 마약·향정은 **빠진다** — 출고를 NIMS 로 따로 보므로 약플로 0 이
             「정말 안 썼다」를 뜻하지 않는다 (2026-11-14 이정화 님 결정). */
        when d.narcotic_type is distinct from '마약'
         and d.narcotic_type is distinct from '향정'
         and coalesce(s.n, 0) >= 3
          then case when coalesce(a.r3,0) = 0 then 0
                    else nullif(round(coalesce(a.r3,0) / 3.0), 0) end
        when coalesce(a.r3,0) > 0 then nullif(round(coalesce(a.r3,0) / 3.0), 0)
        when coalesce(a.py,0) > 0 then round(coalesce(a.py,0) / 12.0)
        else null end as mavg
    from agg a
    join public.drugs d on d.drug_code = a.drug_code
    left join snap3 s on s.code = upper(btrim(a.drug_code))
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
        /* ★★ (A) 와 **같은 규칙** — 기록이 있는데 출고 0 이면 0 이다(전년으로 안 넘어감).
             마약·향정은 빠진다. */
        when dd.narcotic_type is distinct from '마약'
         and dd.narcotic_type is distinct from '향정'
         and coalesce(s2.n, 0) >= 3
          then case when coalesce(txa.r3,0) = 0 then 0
                    else nullif(round(coalesce(txa.r3,0) / 3.0), 0) end
        when coalesce(txa.r3,0) > 0 then nullif(round(coalesce(txa.r3,0) / 3.0), 0)
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
    left join (
      select upper(btrim(ms.drug_code)) code, count(*) n
        from public.monthly_snapshots ms
       where (ms.snap_year * 100 + ms.snap_month) in (
               select (snap_year * 100 + snap_month)
                 from public.monthly_snapshots group by 1 order by 1 desc limit 3)
       group by 1
    ) s2 on s2.code = upper(btrim(dd.drug_code))
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

commit;

-- 서명이 안 바뀌었으므로 스키마 캐시는 그대로 두어도 되지만, 버릇대로 한 번 깨운다
notify pgrst, 'reload schema';
