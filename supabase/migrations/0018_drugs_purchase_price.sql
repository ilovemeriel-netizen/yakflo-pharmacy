-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0018 drugs.purchase_price (구입단가·개당) 컬럼 신설 — 가역
-- 실행: Supabase Management API (DDL). IF NOT EXISTS(재실행 안전).
--
-- 배경: 기존 price_unit=통당단가, edi_price=혼재(통당/개당 섞여 신뢰불가).
--   검증된 구입단가(개당)는 monthly_snapshots 클린월 closing_amount/closing_qty에만 정확.
--   → 전용 컬럼 purchase_price 신설 후 검증단가 백필(별도 스크립트), 단가표시·재고금액이 이를 참조.
-- edi_price는 무수정(사용자 이력용 보존).
-- ════════════════════════════════════════════════════════════════

alter table public.drugs add column if not exists purchase_price numeric;
comment on column public.drugs.purchase_price is '구입단가(개당). 검증된 monthly_snapshots 클린월 단가 기반. 재고금액·단가표시 정본.';

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- alter table public.drugs drop column if exists purchase_price;
-- ════════════════════════════════════════════════════════════════
