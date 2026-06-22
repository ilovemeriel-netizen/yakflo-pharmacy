-- ════════════════════════════════════════════════════════════════
-- Yakflo · monthly_snapshots 수치 컬럼 numeric 확장 (반/사분 단위 지원)
-- 실행 위치: Supabase Dashboard → SQL Editor (또는 Management API)
--
-- ▶ 배경: 2026-01~05 월마감 원본에 분할단위 소수(예: 1469.5, 139.75, 230711.5)가 존재.
--   기존 정수형(integer/bigint) 컬럼은 이를 거부(invalid input for bigint) → 적재 전량 실패.
-- ▶ 조치: qty/amount 12개 컬럼을 numeric으로 확장(가산·비파괴). 기존 정수값 보존.
--   기존 2026-06(정수) 무영향. NOT NULL·유니크 인덱스(0011) 불변.
-- ════════════════════════════════════════════════════════════════

alter table public.monthly_snapshots
  alter column opening_qty     type numeric,
  alter column total_in_qty    type numeric,
  alter column subtotal_qty    type numeric,
  alter column total_out_qty   type numeric,
  alter column total_disp_qty  type numeric,
  alter column total_ret_qty   type numeric,
  alter column closing_qty     type numeric,
  alter column opening_amount  type numeric,
  alter column total_in_amount type numeric,
  alter column subtotal_amount type numeric,
  alter column total_out_amount type numeric,
  alter column closing_amount  type numeric;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — ⚠ 소수 데이터 존재 시 round로 절삭됨(적재 전에만 무손실).
-- ----------------------------------------------------------------
-- alter table public.monthly_snapshots
--   alter column opening_qty     type integer using round(opening_qty)::int,
--   alter column total_in_qty    type integer using round(total_in_qty)::int,
--   alter column subtotal_qty    type integer using round(subtotal_qty)::int,
--   alter column total_out_qty   type integer using round(total_out_qty)::int,
--   alter column total_disp_qty  type integer using round(total_disp_qty)::int,
--   alter column total_ret_qty   type integer using round(total_ret_qty)::int,
--   alter column closing_qty     type integer using round(closing_qty)::int,
--   alter column opening_amount  type bigint  using round(opening_amount)::bigint,
--   alter column total_in_amount type bigint  using round(total_in_amount)::bigint,
--   alter column subtotal_amount type bigint  using round(subtotal_amount)::bigint,
--   alter column total_out_amount type bigint using round(total_out_amount)::bigint,
--   alter column closing_amount  type bigint  using round(closing_amount)::bigint;
-- ════════════════════════════════════════════════════════════════