-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0022 drugs ATC(효능군) 분류 컬럼 추가 — 가역 (T2 ATC 대시보드 기반)
-- 실행: Supabase Management API. ADD COLUMN IF NOT EXISTS(재실행 안전).
--
-- 배경: 약품_정본.csv(사용자 마스터)에 ATC번호·대/중/소분류가 100% 존재하나 drugs엔 미적재.
--   T2(ATC 효능군 도넛/KPI/칩)를 위해 컬럼 신설 후 마스터에서 적재(load_atc.mjs). 가산적·가역.
-- 의미: atc_l1=대분류(해부학적 계통), atc_l2=중분류, atc_l3=소분류, atc_code=ATC 코드.
-- ════════════════════════════════════════════════════════════════

alter table public.drugs add column if not exists atc_code text;
alter table public.drugs add column if not exists atc_l1   text;
alter table public.drugs add column if not exists atc_l2   text;
alter table public.drugs add column if not exists atc_l3   text;

comment on column public.drugs.atc_code is 'ATC 코드(WHO ATC). 마스터 약품_정본.csv 적재.';
comment on column public.drugs.atc_l1   is 'ATC 대분류(해부학적 계통, 예: 신경계·소화관 및 대사). 효능군 집계 기준.';
comment on column public.drugs.atc_l2   is 'ATC 중분류.';
comment on column public.drugs.atc_l3   is 'ATC 소분류.';

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- alter table public.drugs drop column if exists atc_code;
-- alter table public.drugs drop column if exists atc_l1;
-- alter table public.drugs drop column if exists atc_l2;
-- alter table public.drugs drop column if exists atc_l3;
-- ════════════════════════════════════════════════════════════════