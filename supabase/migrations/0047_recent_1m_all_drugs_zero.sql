-- 0047_recent_1m_all_drugs_zero.sql
-- 목적: 직전1개월(recent_1m_usage)을 "최근 1개월 실제 출고 그대로(없으면 0)"로 전 약품 재산출.
--   배경: 기존 recompute는 UPDATE ... FROM agg(출고 집계) 조인이라 출고 없는 약품은 매칭 0 →
--         갱신 대상에서 빠져 옛 recent_1m가 STALE로 남았다(출고 전체삭제 후에도 리셋 안 됨).
--   수정: recent_1m_usage 만 drugs LEFT JOIN (1개월 출고 합) → coalesce(r1,0) 로 전 약품 세팅.
--         출고 있으면 그 합, 없으면 0. manual/auto 무관(직전1개월은 출고 사실).
--   ★ recent_3m·prev_year·monthly_avg·safety_stock(×1.5)·max_stock(×3) 는 기존 로직 유지:
--     출고 있는 약품만 갱신 + manual 보존(p_overwrite_manual=false). recent_1m만 전 약품 분리.
--   usage_source 규약·재고상태·마감·RLS/tenant 무관. CREATE OR REPLACE(데이터 손상 없음).

create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
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
    safety_stock = case when c.mavg is not null then round(c.mavg * 1.5) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');
  get diagnostics v_count = row_count;

  -- (B) recent_1m_usage: 전 약품 "최근 1개월 출고 합(없으면 0)". recent_1m 외 컬럼·usage_source 무변경.
  --     LEFT JOIN 으로 출고 없는 약품도 포함 → 0-세팅(STALE 해소). manual 약품도 출고 기반(0→0).
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

  return v_count;
end
$$;

-- 롤백(참고, 실행 안 함): 0046 정의로 CREATE OR REPLACE 되돌림.