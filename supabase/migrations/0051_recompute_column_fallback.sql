-- 0051_recompute_column_fallback.sql
-- 목적: app_recompute_usage 폴백 보강 — transactions 출고가 없어 (A)에서 제외되던 약품을
--       drugs 컬럼(prev_year_usage·recent_3m_usage) 기반으로 구제한다(판정 사각지대 해소).
--   · 배경: transactions는 약 1개월치뿐이라 대다수 약품이 (A) agg에서 빠져 safety_stock이 NULL로 남고
--           stockStat이 '기준미설정'으로 처리 → 긴급·주문필요 알림에서 누락(사각지대 151건).
--   · saveRowUsage(수기)는 이미 컬럼 폴백(rv/3, 없으면 pv/12)을 쓰므로 두 경로 정합을 맞춘다.
-- ★ safety_stock 배수는 라이브값 ceil(mavg*1.2) 그대로 유지(0049/0050). 이번에 배수 변경 없음.
-- ★ (A)/(B) 기존 블록은 무변경. (A2) 신규 블록만 추가.
--   (A2) 원칙:
--     - 우선순위 ① tx 3m>0 → r3/3  ② tx 12m>0 → py/12  ③ prev_year_usage>0 → /12  ④ recent_3m_usage>0 → /3
--       (①② 실거래 우선. ③④는 컬럼 폴백 — saveRowUsage와 동일 개념)
--     - 빈 값만 채움: coalesce(safety_stock,0)<=0 AND coalesce(monthly_avg,0)<=0 인 행만.
--       → 기존 monthly_avg/safety_stock 있는 약품은 절대 변경 안 됨.
--     - prev_year_usage·recent_3m_usage 컬럼은 (A2)에서 절대 갱신 안 함(수기 입력값 보존).
--     - usage_source 무변경 → manual 보호 유지(다음 (A) 재실행 시에도 그대로 스킵).
--     - mavg>0 인 건만 반영(prev_year 1~5로 mavg=0이면 safety=0이라 실효 없어 제외 → 여전히 기준미설정).
--     - 대상 status는 알림 모집단과 동일하게 사용·휴면으로 한정.

create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_count2 integer;
begin
  -- (A) recent_3m·prev_year·monthly_avg·safety·max: 출고 있는 약품만 갱신, manual 보존(기존 로직·무변경).
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

  -- (A2) 신규: (A)에서 빠진(출고 없음) 또는 manual 스킵된 약품 중 safety_stock 미설정 건을
  --      컬럼 폴백으로 채운다. 컬럼(prev_year/recent_3m)·usage_source 무변경, 빈 값만, mavg>0만.
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

  -- (B) recent_1m_usage: 전 약품 "최근 1개월 출고 합(없으면 0)". recent_1m 외 컬럼·usage_source 무변경.
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
  where d.drug_code = sub.drug_code;

  return v_count + v_count2;
end
$$;

-- 롤백(참고, 실행 안 함): 0044→0050 순으로 재적용하면 (A2) 없는 정의로 복귀.