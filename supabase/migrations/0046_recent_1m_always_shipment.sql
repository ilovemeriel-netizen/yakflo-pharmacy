-- 0046_recent_1m_always_shipment.sql
-- 목적: 직전1개월(recent_1m_usage)을 usage_source='manual' 행에도 항상 출고 기반으로 채운다.
--   근거: 직전1개월은 "최근 1개월 실제 출고" 사실 지표 → manual/auto 무관하게 출고 그대로여야 함.
--   보존: recent_3m·prev_year·monthly_avg·safety_stock(×1.5)·max_stock(×3)·usage_source 는
--         기존대로 manual 보존(무변경). 즉 recent_1m_usage 만 manual 게이트에서 분리한다.
-- ※ 재고상태 판정·마감·RLS/tenant 무관. CREATE OR REPLACE(데이터 손상 없음).

create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  -- (A) 기존 집계 — auto 대상 전 컬럼 갱신(p_overwrite_manual=false 면 manual 행 보존/건너뜀).
  with agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '1 month')   as r1
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select drug_code,
      coalesce(py, 0) as py,
      coalesce(r3, 0) as r3,
      coalesce(r1, 0) as r1,
      case when coalesce(r3,0) > 0 then round(coalesce(r3,0) / 3.0)
           when coalesce(py,0) > 0 then round(coalesce(py,0) / 12.0)
           else null end as mavg
    from agg
  )
  update public.drugs d set
    prev_year_usage = c.py,
    recent_3m_usage = c.r3,
    recent_1m_usage = c.r1,
    monthly_avg  = coalesce(c.mavg, d.monthly_avg),
    safety_stock = case when c.mavg is not null then round(c.mavg * 1.5) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');
  get diagnostics v_count = row_count;

  -- (B) 직전1개월만 manual 게이트 분리: (A)에서 건너뛴 manual 행에도 recent_1m_usage 반영.
  --     recent_1m_usage 외 컬럼(monthly_avg·safety_stock·recent_3m·prev_year·max·usage_source)은 손대지 않음.
  --     p_overwrite_manual=true 면 (A)가 이미 manual 포함 처리했으므로 스킵.
  if not p_overwrite_manual then
    with agg1 as (
      select t.drug_code,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '1 month') as r1
      from public.transactions t
      where t.type = '출고'
      group by t.drug_code
    )
    update public.drugs d set
      recent_1m_usage = coalesce(a.r1, 0)
    from agg1 a
    where d.drug_code = a.drug_code
      and d.usage_source is not distinct from 'manual';
  end if;

  return v_count;
end
$$;

-- 롤백(참고, 실행 안 함): 0045 정의로 CREATE OR REPLACE 되돌림.