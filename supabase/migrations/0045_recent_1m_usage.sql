-- 0045_recent_1m_usage.sql
-- 목적: 재고현황 '직전1개월사용량'(최근 1개월 출고 합) 컬럼 + 자동집계 확장.
--   1) drugs.recent_1m_usage: 표시용 참조(안전재고 산식엔 미사용 — 1개월 변동성 큼).
--   2) app_recompute_usage에 recent_1m 집계 추가. recent_3m·prev_year·monthly_avg·
--      safety_stock(×1.5)·max_stock(×3) 산식은 그대로. manual 행 보존(기존 로직).
--      · recent_1m_usage = 최근 1개월(rolling, recent_3m/prev_year와 동일 방식) 출고 합.
--      · 월말일자(2026-07-31 등) 출고도 rolling 윈도우에 포함.
-- ※ 기존 데이터 손상 없음(컬럼 추가·CREATE OR REPLACE). RLS/tenant·재고상태 판정 무관.

alter table public.drugs
  add column if not exists recent_1m_usage integer;

comment on column public.drugs.recent_1m_usage is '직전 1개월(최근 1개월) 출고 합. 표시용 참조 — 안전재고 산식엔 미사용(변동성 큼).';

-- app_recompute_usage 확장: recent_1m 추가(나머지 산식·manual 보존 무변경)
create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
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
  return v_count;
end
$$;

-- 롤백(참고, 실행 안 함):
-- (app_recompute_usage는 0044 정의로 CREATE OR REPLACE 되돌림)
-- alter table public.drugs drop column if exists recent_1m_usage;