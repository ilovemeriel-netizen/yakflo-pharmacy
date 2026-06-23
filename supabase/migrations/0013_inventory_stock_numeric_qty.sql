-- ════════════════════════════════════════════════════════════════
-- Yakflo · inventory_stock.current_qty integer→numeric 확장 (분할단위 소수 보존)
-- 실행 위치: Supabase Management API (또는 Dashboard SQL Editor)
--
-- ▶ 배경: monthly_snapshots 수량은 numeric(0012)이나 inventory_stock.current_qty는 integer라
--   분할단위 약품 42종의 반/사분 단위 재고가 정수로 반올림돼 유실(예: GRD2 287 vs 286.5, SLMT10 140 vs 139.75).
-- ▶ 조치: current_qty를 numeric으로 가산·비파괴 확장. 기존 정수값 보존(286→286.0). 트리거/RLS/인덱스 불변.
--   inventory_stock 트리거는 trg_set_tenant_id뿐 → 타입 변경 영향 없음. 음수차단(0009)은 transactions 측.
-- ════════════════════════════════════════════════════════════════

alter table public.inventory_stock
  alter column current_qty type numeric;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — ⚠ 소수 데이터 존재 시 round로 절삭됨(보정 적용 전에만 무손실)
-- ----------------------------------------------------------------
-- alter table public.inventory_stock
--   alter column current_qty type integer using round(current_qty)::int;
-- ════════════════════════════════════════════════════════════════