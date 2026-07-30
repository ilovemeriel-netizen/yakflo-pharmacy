-- 0050_safety_remove_min1.sql
-- Yakflo · 안전재고 최소1 강제(greatest(...,1)) 제거 — mavg=0 약품은 safety=0(기준미설정 유지)
-- 사유: 시스템은 1118건 중 사용량0이 151건이라 최소1이 오탐(현재고0~1→긴급) 유발. 서식(관리 11~20건)과 성격 상이.
-- 안전계수 1.2·LEAD 14·목표배수 2 불변. 0049는 유지(덮어쓰기).
-- 롤백: ceil(c.mavg * 1.2) → greatest(ceil(c.mavg * 1.2), 1) + 백업 CSV 복원.

CREATE OR REPLACE FUNCTION public.app_recompute_usage(p_overwrite_manual boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
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
$function$
;

-- 적용 후: select public.app_recompute_usage(false);
