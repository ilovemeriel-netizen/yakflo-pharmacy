-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0041 drug_master 공공데이터 레퍼런스 적재 준비 — 가역
-- 실행: Supabase SQL Editor / Management API (운영 phgkjrvdtcdrdiuigici).
--
-- 목적: 식약처·심평원 공공데이터 32,321건(급여 21,959 + 비급여 10,362)을
--   drug_master 에 적재하기 위한 (1) 부족 컬럼 추가, (2) 공유 레퍼런스 권한 정비.
--   ※ 실제 적재는 data/load_drug_master.js 가 수행. 이 파일은 스키마·권한만 변경.
--
-- main_code 채움 규칙(적재 스크립트가 계산해 넣음 — DB 생성 컬럼 아님):
--   ① 보험코드 → ② 없으면 표준코드 → ③ 둘 다 없으면 품목기준코드 || '-' || 규격
--   커버리지 100%(32,321) · 고유 32,321 · 중복 0.
--
-- (1) 신규 컬럼 11개: CSV 27항목 중 기존 34컬럼에 대응이 없는 것.
--     insurance_code = 보험코드 원본(main_code 는 계산값이라 별개 저장).
--     전부 NULL 허용 · 기본값 없음 · CHECK 없음(외부 원본 충실 저장; 통제어휘 검증은 적재 스크립트 리포트).
-- (2) 권한: 공유 글로벌 레퍼런스 → anon 전부 회수, authenticated 읽기전용, RLS on + SELECT 정책 1개.
--     적재는 소유자/postgres(BYPASSRLS) 접속이라 정비 후에도 동작.
-- 무변경: 기존 컬럼·제약·UNIQUE(main_code)·FK·DUR 테이블·인덱스.
-- ════════════════════════════════════════════════════════════════

-- (1) 부족 컬럼 추가 — 전부 IF NOT EXISTS · NULL 허용 · 기본값 없음 · CHECK 없음
alter table public.drug_master add column if not exists insurance_code       text;
alter table public.drug_master add column if not exists drug_name_orig       text;
alter table public.drug_master add column if not exists main_ingredient_code text;
alter table public.drug_master add column if not exists excipient            text;
alter table public.drug_master add column if not exists compound_type        text;
alter table public.drug_master add column if not exists atc_name             text;
alter table public.drug_master add column if not exists category             text;
alter table public.drug_master add column if not exists narcotic_type        text;
alter table public.drug_master add column if not exists total_qty            numeric;
alter table public.drug_master add column if not exists package              text;
alter table public.drug_master add column if not exists shape                text;

-- (2) 권한 정비 — 공유 레퍼런스(테넌트 스코프 없음)
revoke all on public.drug_master from anon;                 -- anon 전부 회수
revoke all on public.drug_master from authenticated;        -- 초기화 후 SELECT만 재부여
grant select on public.drug_master to authenticated;        -- authenticated 는 SELECT 전용

alter table public.drug_master enable row level security;

drop policy if exists drug_master_select_all on public.drug_master;
create policy drug_master_select_all on public.drug_master
  for select to authenticated using (true);
-- 쓰기 정책 없음: INSERT/UPDATE/DELETE 는 소유자/service_role(RLS 우회)만 가능.

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop policy if exists drug_master_select_all on public.drug_master;
-- alter table public.drug_master disable row level security;
-- grant insert, update, delete, truncate, references, trigger on public.drug_master to authenticated;
-- grant all on public.drug_master to anon;
-- alter table public.drug_master drop column if exists shape;
-- alter table public.drug_master drop column if exists package;
-- alter table public.drug_master drop column if exists total_qty;
-- alter table public.drug_master drop column if exists narcotic_type;
-- alter table public.drug_master drop column if exists category;
-- alter table public.drug_master drop column if exists atc_name;
-- alter table public.drug_master drop column if exists compound_type;
-- alter table public.drug_master drop column if exists excipient;
-- alter table public.drug_master drop column if exists main_ingredient_code;
-- alter table public.drug_master drop column if exists drug_name_orig;
-- alter table public.drug_master drop column if exists insurance_code;
-- ════════════════════════════════════════════════════════════════