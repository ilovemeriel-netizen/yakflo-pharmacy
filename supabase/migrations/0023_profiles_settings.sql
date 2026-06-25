-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0023 profiles.settings(jsonb) 추가 — 사용자 환경설정(표시 컬럼 등) — 가역
-- 실행: Supabase Management API. ADD COLUMN IF NOT EXISTS(재실행 안전).
--
-- 목적: 약품목록 '표시 컬럼' 선택 등 UI 환경설정을 사용자별 서버 저장(프론트에 비밀정보 미저장).
--   profiles는 본인 행만 select/update(기존 RLS) → 본인 설정만 읽기/쓰기.
-- 비밀정보 미포함(컬럼 키 목록 등 UI 상태만). 기본값 빈 객체.
-- ════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column public.profiles.settings is '사용자 UI 환경설정(jsonb). 예: {"drugCols":["drug_code","drug_name",...]}. 비밀정보 미포함.';

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- alter table public.profiles drop column if exists settings;
-- ════════════════════════════════════════════════════════════════