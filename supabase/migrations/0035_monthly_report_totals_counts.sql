-- 0035_monthly_report_totals_counts.sql
-- 월간보고서 결재본 '건수' 9종을 사이드카에 저장(정본 값 그대로, 계산·역산 금지).
-- 기존 컬럼·제약·RLS·금액 데이터는 변경하지 않는다.
-- 테이블 GRANT(anon/authenticated SELECT/INSERT/UPDATE)는 0034에서 부여됨 → 신규 컬럼도 테이블 권한을 따름.

alter table public.monthly_report_totals
  add column if not exists item_count      integer,   -- 관리 품목수
  add column if not exists in_count         integer,   -- 입고 건수
  add column if not exists out_count        integer,   -- 출고 건수
  add column if not exists disposal_count   integer,   -- 폐기 건수
  add column if not exists return_count     integer,   -- 반품 건수
  add column if not exists exp_expired      integer,   -- 유효기간: 만료
  add column if not exists exp_urgent30     integer,   -- 긴급(30일)
  add column if not exists exp_caution60    integer,   -- 주의(60일)
  add column if not exists exp_check90      integer;   -- 확인(90일)

-- ── 결재본 건수 적재 (cnc 테넌트, 2026 1~6월) — 표값 그대로 UPDATE ──
update public.monthly_report_totals t set
  item_count=v.ic, in_count=v.inc, out_count=v.ouc, disposal_count=v.dc, return_count=v.rc,
  exp_expired=v.ee, exp_urgent30=v.eu, exp_caution60=v.eca, exp_check90=v.ech
from (values
  (1, 575, 282, 373, 17,  0, 3, 1, 10, 13),
  (2, 580, 213, 356, 10,  1, 4, 8, 12, 17),
  (3, 566, 209, 390, 27, 10, 1, 3,  8,  6),
  (4, 546, 145, 352, 32, 17, 0, 2,  2, 12),
  (5, 532, 132, 336, 19, 23, 1, 1,  9,  1),
  (6, 531, 151, 354, 13, 17, 0, 3,  1, 11)
) as v(m, ic, inc, ouc, dc, rc, ee, eu, eca, ech)
where t.tenant_id='5e0aa267-cf21-4227-af97-a27b32b04c07'::uuid
  and t.snap_year=2026 and t.snap_month=v.m;