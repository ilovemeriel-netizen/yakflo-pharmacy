-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0017 월간 보고서 상세 집계 RPC (단일 월) — 가산적·가역
-- 실행: Supabase Management API. CREATE OR REPLACE(재실행 안전).
--
-- 용도: ReportsPage 월간 보고서 양식(① 헤더 ② 재고현황 ③ 입출고 ④ 손실 ⑤ 유효기간 ⑥ 작성).
--   값은 monthly_snapshots(해당 월) 집계 + 유효기간은 현재 drugs.expiry_date 기준.
-- ▶ SECURITY INVOKER + stable → 호출자(로그인) 권한, RLS로 테넌트 격리. 기존 함수·테이블 무수정.
--
-- 주의(데이터 갭, 합의):
--  · 폐기/반품 '금액'은 monthly_snapshots에 컬럼 없음 → 수량 × 행 자체 단가(기말금액/기말수량 등)로 산출.
--    검증결과 결산 KPI 폐기/반품 금액과 전 월 정확히 일치(근사 아님). (disp_amt/ret_amt)
--  · 유효기간 버킷(만료/긴급30/주의60/확인90)은 월별 스냅샷이 없어 '현재 시점' drugs 기준(과거 월도 현재값).
--  · 건수(in_cnt/out_cnt/...)는 해당 월 수량>0 품목 수(거래 건수 아님 — transactions 미개시).
-- ════════════════════════════════════════════════════════════════

create or replace function public.app_monthly_report_detail(p_year int, p_month int)
returns json language sql stable security invoker set search_path = public as $$
  with ms as (
    select * from monthly_snapshots where snap_year = p_year and snap_month = p_month
  ),
  pj as (
    -- 행 자체 단가: 기말금액/기말수량 우선, 없으면 기초·출고·입고 단가 순으로 추정
    select ms.total_disp_qty, ms.total_ret_qty,
           coalesce(closing_amount / nullif(closing_qty, 0),
                    opening_amount / nullif(opening_qty, 0),
                    total_out_amount / nullif(total_out_qty, 0),
                    total_in_amount / nullif(total_in_qty, 0), 0) as up
      from ms
  )
  select json_build_object(
    'year', p_year, 'month', p_month,
    -- ② 재고현황
    'items',       (select count(*) from ms where coalesce(opening_qty,0)<>0 or coalesce(total_in_qty,0)<>0
                                                or coalesce(total_out_qty,0)<>0 or coalesce(closing_qty,0)<>0),
    'opening_amt', (select coalesce(sum(opening_amount),0) from ms),
    'closing_amt', (select coalesce(sum(closing_amount),0) from ms),
    -- 전월재고 = 전월 기말금액(재고 체인). DB opening_amount 체인이 끊긴 월 보정용. 전월 없으면 0.
    'prev_closing_amt', (select coalesce(sum(closing_amount),0) from monthly_snapshots
                           where snap_year = p_year and snap_month = p_month - 1),
    -- ③ 입출고현황
    'in_cnt',  (select count(*) from ms where coalesce(total_in_qty,0)>0),
    'in_qty',  (select coalesce(sum(total_in_qty),0) from ms),
    'in_amt',  (select coalesce(sum(total_in_amount),0) from ms),
    'out_cnt', (select count(*) from ms where coalesce(total_out_qty,0)>0),
    'out_qty', (select coalesce(sum(total_out_qty),0) from ms),
    'out_amt', (select coalesce(sum(total_out_amount),0) from ms),
    -- ④ 손실현황 (폐기/반품 금액 = 수량×단가 근사)
    'disp_cnt', (select count(*) from ms where coalesce(total_disp_qty,0)>0),
    'disp_qty', (select coalesce(sum(total_disp_qty),0) from ms),
    'disp_amt', (select coalesce(sum(total_disp_qty*up),0) from pj),
    'ret_cnt',  (select count(*) from ms where coalesce(total_ret_qty,0)>0),
    'ret_qty',  (select coalesce(sum(total_ret_qty),0) from ms),
    'ret_amt',  (select coalesce(sum(total_ret_qty*up),0) from pj),
    -- ⑤ 유효기간 (현재 시점 drugs, 중지 제외, 밴드)
    'exp_expired',  (select count(*) from drugs where status<>'중지' and expiry_date is not null and expiry_date <  current_date),
    'exp_urgent30', (select count(*) from drugs where status<>'중지' and expiry_date >= current_date        and expiry_date <  current_date+30),
    'exp_warn60',   (select count(*) from drugs where status<>'중지' and expiry_date >= current_date+30     and expiry_date <  current_date+60),
    'exp_check90',  (select count(*) from drugs where status<>'중지' and expiry_date >= current_date+60     and expiry_date <  current_date+90),
    -- 사용 가능한 월 목록(셀렉터용)
    'months', (select coalesce(json_agg(distinct snap_month order by snap_month), '[]')
                 from monthly_snapshots where snap_year = p_year)
  );
$$;

grant execute on function public.app_monthly_report_detail(int, int) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop function if exists public.app_monthly_report_detail(int, int);
-- ════════════════════════════════════════════════════════════════