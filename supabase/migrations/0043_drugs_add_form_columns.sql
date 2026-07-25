-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0043 drugs 제형 컬럼 신설 — 가역
-- 실행: Supabase SQL Editor / Management API (운영 phgkjrvdtcdrdiuigici).
--
-- 목적: 자동입력 매핑 정리를 위한 제형 전용 컬럼 분리.
--   drug_master.dosage_form(제형: 정제·캡슐) 을 담을 drugs.dosage_form 을 만든다.
--
-- 신설 대상(사용자 결정): dosage_form 만.
--   · 규격        → 기존 specification 재사용
--   · 포장        → 기존 packaging 재사용
--   · 품목기준코드 → 기존 standard_code 재사용
--   · 함량(strength) → 신설하지 않음. API 함량값은 폼에서 완전히 버린다(오매핑 제거).
-- NULL 허용 · 기본값 없음 · CHECK 없음.
-- 무변경: 기존 컬럼·제약·RLS·tenant_id·specification·unit·standard_code·packaging.
-- ════════════════════════════════════════════════════════════════

alter table public.drugs add column if not exists dosage_form text;   -- 제형

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- alter table public.drugs drop column if exists dosage_form;
-- ════════════════════════════════════════════════════════════════