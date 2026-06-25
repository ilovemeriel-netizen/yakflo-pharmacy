-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0026 변경예측·사용량 분석 수식 선반영 (RPC, SECURITY INVOKER·RLS) — 가역
-- 실행: Supabase Management API. CREATE OR REPLACE(재실행 안전).
--
-- 목적: 설계서 §4-2 수식을 서버(RPC)로 선반영 → transactions 채워지면 코드수정 없이 자동 산출.
--   거래 0건이면 graceful(빈/데이터부족, 에러 0). 0나눗셈/NULL 가드 필수.
-- ▶ SECURITY INVOKER(기본) — 호출자 권한·RLS 경유(본인 테넌트만). SECURITY DEFINER 아님.
-- 후속(범위 밖): 과별(진료과) 차원은 운영DB 부재 → 입력 슬롯만(원내코드 매핑 업로드 연동 자리).
-- ════════════════════════════════════════════════════════════════

-- (1) 변경 예측 — 주간 사용량·남은 주·변경예상시점·상태 (transactions 출고 기반)
create or replace function public.drug_change_forecast(p_weeks integer default 12)
returns table(drug_code text, drug_name text, current_qty numeric, weekly_usage numeric,
              remaining_weeks numeric, expected_change_date date, status text)
language sql stable
set search_path = public
as $$
  with outq as (
    select t.drug_code, sum(t.quantity) as out_sum
    from public.transactions t
    where t.type = '출고'
      and t.transaction_date >= (current_date - (greatest(p_weeks,1) * 7))
    group by t.drug_code
  )
  select d.drug_code, d.drug_name, d.current_qty,
    round(coalesce(o.out_sum, 0) / nullif(greatest(p_weeks,1), 0), 2) as weekly_usage,
    case when coalesce(o.out_sum,0) > 0
         then round(coalesce(d.current_qty,0) / (o.out_sum::numeric / greatest(p_weeks,1)), 2)
         else null end as remaining_weeks,
    case when coalesce(o.out_sum,0) > 0
         then (current_date + ((coalesce(d.current_qty,0) / (o.out_sum::numeric / greatest(p_weeks,1))) * 7)::int)
         else null end as expected_change_date,
    case when coalesce(d.current_qty,0) = 0 then '변경완료'
         when coalesce(o.out_sum,0) = 0 then '데이터부족'
         when (coalesce(d.current_qty,0) / (o.out_sum::numeric / greatest(p_weeks,1))) <= 2 then '긴급(2주내)'
         else '여유' end as status
  from public.drugs d
  left join outq o on o.drug_code = d.drug_code
  where d.status in ('사용','휴면')
$$;

-- (2) 사용량 분석 — 최근 N개월 월별 출고 추이 (monthly_snapshots 기반, 월마감 시 transactions 자동 반영)
create or replace function public.usage_monthly_trend(p_months integer default 6)
returns table(ym text, out_qty numeric)
language sql stable
set search_path = public
as $$
  select to_char(make_date(s.snap_year, s.snap_month, 1), 'YYYY-MM') as ym,
         sum(coalesce(s.total_out_qty, 0)) as out_qty
  from public.monthly_snapshots s
  where make_date(s.snap_year, s.snap_month, 1)
        >= (date_trunc('month', current_date) - ((greatest(p_months,1) - 1) || ' months')::interval)
  group by 1
  order by 1
$$;

grant execute on function public.drug_change_forecast(integer) to authenticated;
grant execute on function public.usage_monthly_trend(integer)  to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop function if exists public.drug_change_forecast(integer);
-- drop function if exists public.usage_monthly_trend(integer);
-- ════════════════════════════════════════════════════════════════