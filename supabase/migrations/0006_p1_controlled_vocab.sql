-- ════════════════════════════════════════════════════════════════
-- Yakflo · 기초데이터 P1-1 — 통제 어휘 7종 확정 (참조 seed + 컬럼 보강)
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 안전 재실행 가능 (IF NOT EXISTS / ON CONFLICT / ADD COLUMN IF NOT EXISTS)
--
-- 근거 문서: 약플로_통합구현가이드.md v1.1 §6-5(통제 어휘 7종), §7(상태 3종)
-- 런북: 약플로_ClaudeCode_실행가이드.md P1-1
--
-- ⚠️ 설계 원칙 (가산적 변경 · 기존 기능 무수정):
--   · 기존 drugs 1083행에 영향 0 — CHECK/NOT NULL 제약은 걸지 않는다.
--     (어휘 강제는 데이터 안정화 = P1-3 검증·보강 이후 별도 단계. 0002 주석과 동일 원칙)
--   · 신규 컬럼 2종(compound_type · prescription_type)은 NULL 허용으로만 추가.
--   · 신규 참조 테이블 drug_vocab 은 전 테넌트 공유(통제 목록) — tenant_id 없음.
--   · 금액(수량×단가) 파생값은 저장하지 않는다(§6-3) — 컬럼 추가 없음.
--
-- ⚠️ 금지 사항:
--   · DELETE / DROP / 기존 컬럼 수정 — 0건
--   · CHECK 제약 추가 — 안 함 (P1-3 이후)
-- ════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────
-- 1) 통제 어휘 참조 테이블 (전 테넌트 공유 · 비강제 reference)
--    axis = 어휘 축, code = 정규 값, label = 표시명
-- ────────────────────────────────────────────────────────────────
create table if not exists public.drug_vocab (
  axis        text    not null,
  code        text    not null,
  label       text    not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  note        text,
  primary key (axis, code)
);

comment on table public.drug_vocab is
  '약품 통제 어휘 7종(구분·마약구분·급여·복합단일·전문일반·보관방법·상태). 전 테넌트 공유 reference. 가이드 §6-5 기준.';

-- ────────────────────────────────────────────────────────────────
-- 2) 어휘 7종 seed (재실행 안전 — (axis,code) 충돌 시 label/순서만 갱신)
-- ────────────────────────────────────────────────────────────────

-- ① 구분 (drugs.category) — 6종 (가이드 §6-5)
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('category', '경구제',   '경구제',   1, null),
  ('category', '주사제',   '주사제',   2, null),
  ('category', '외용제',   '외용제',   3, null),
  ('category', '영양제',   '영양제',   4, null),
  ('category', '수액제',   '수액제',   5, null),
  ('category', '의약외품', '의약외품', 6, null)
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ② 마약구분 (drugs.narcotic_type + is_narcotic 조합으로 표현) — 4종 (규제, 가이드 §6-5 · §8)
--    NOTE: 현재 스키마는 is_narcotic(bool)+narcotic_type(text)로 분리 저장.
--          '일반'=is_narcotic:false, 그 외=narcotic_type 값. '한외마약'은 P1-3에서 재분류.
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('narcotic_class', '일반',     '일반',     1, 'is_narcotic=false'),
  ('narcotic_class', '향정',     '향정신성', 2, 'narcotic_type=향정'),
  ('narcotic_class', '마약',     '마약',     3, 'narcotic_type=마약'),
  ('narcotic_class', '한외마약', '한외마약', 4, 'P1-3 보강 대상 — 현재 미통제')
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ③ 급여구분 (drugs.insurance_type) — 2종
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('insurance', '급여',   '급여',   1, null),
  ('insurance', '비급여', '비급여', 2, null)
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ④ 복합/단일 (신규 컬럼 drugs.compound_type) — 2종
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('compound', '단일', '단일제', 1, null),
  ('compound', '복합', '복합제', 2, null)
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ⑤ 전문/일반 정규화 (신규 컬럼 drugs.prescription_type) — 가이드 §6-5(7개 → 정규 어휘로 수렴)
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('rx_class', '전문',       '전문의약품',   1, null),
  ('rx_class', '일반',       '일반의약품',   2, null),
  ('rx_class', '약국외판매', '약국외판매',   3, '의약외품/안전상비 등'),
  ('rx_class', '기타',       '기타',         9, '건기식·의료기기 등 비의약품 — 보류 분류')
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ⑥ 보관방법 (drugs.storage_method) — 원자 토큰(조합은 다중 적용, 가이드 §6-5 "조합")
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('storage', '실온', '실온', 1, '조합 가능: 실온/차광 등'),
  ('storage', '냉장', '냉장', 2, null),
  ('storage', '냉동', '냉동', 3, null),
  ('storage', '차광', '차광', 4, '단독 사용 안 함 — 조합 토큰')
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ⑦ 상태 (drugs.status) — 3종 (가이드 §7)
insert into public.drug_vocab (axis, code, label, sort_order, note) values
  ('status', '사용', '사용', 1, '메인 뷰 우선 노출'),
  ('status', '해면', '해면', 2, '곧 사용 예정·대기 (배지)'),
  ('status', '중지', '중지', 3, '아카이브(복귀 가능)')
on conflict (axis, code) do update
  set label = excluded.label, sort_order = excluded.sort_order, note = excluded.note;

-- ────────────────────────────────────────────────────────────────
-- 3) drugs 누락 어휘 컬럼 2종 추가 (NULL 허용 · 제약 없음)
--    가이드 §6-1 마스터 컬럼 인벤토리 중 현 스키마에 부재한 2종
-- ────────────────────────────────────────────────────────────────
alter table public.drugs
  add column if not exists compound_type     text;   -- 복합/단일 (drug_vocab.axis='compound')
alter table public.drugs
  add column if not exists prescription_type text;   -- 전문/일반 (drug_vocab.axis='rx_class')

comment on column public.drugs.compound_type     is '복합/단일 — drug_vocab(axis=compound). NULL=미분류(P1-3 보강).';
comment on column public.drugs.prescription_type is '전문/일반 정규화 — drug_vocab(axis=rx_class). NULL=미분류(P1-3 보강).';

-- ────────────────────────────────────────────────────────────────
-- 4) drug_vocab RLS — 공유 reference: 인증 사용자 읽기 허용, 쓰기 차단
--    (쓰기는 service_role/SQL Editor만 — 통제 목록은 서버 측에서만 갱신)
-- ────────────────────────────────────────────────────────────────
alter table public.drug_vocab enable row level security;

drop policy if exists drug_vocab_select_authenticated on public.drug_vocab;
create policy drug_vocab_select_authenticated
  on public.drug_vocab
  for select
  to authenticated
  using (true);

commit;

-- ════════════════════════════════════════════════════════════════
-- 검증 SELECT (commit 후 별도로 실행 — 결과가 기대값과 일치하면 정상)
-- ────────────────────────────────────────────────────────────────
--
-- [검증 1] 어휘 7축 seed 건수 → 6,4,2,2,4,4,3 = 총 25행
-- ----------------------------------------------------------------
-- select axis, count(*) as cnt
-- from public.drug_vocab group by axis order by axis;
--   기대: category=6, compound=2, insurance=2, narcotic_class=4, rx_class=4, status=3, storage=4
--
-- [검증 2] 신규 컬럼 2종 추가 확인 → 2행
-- ----------------------------------------------------------------
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema='public' and table_name='drugs'
--   and column_name in ('compound_type','prescription_type')
-- order by column_name;
--
-- [검증 3] 기존 drugs 행수 변동 0 — 사전 캡처(1083)와 비교
-- ----------------------------------------------------------------
-- select count(*) as drugs_cnt from public.drugs;
--
-- [검증 4] drug_vocab RLS 활성 + select 정책 1건 확인
-- ----------------------------------------------------------------
-- select relrowsecurity from pg_class where relname='drug_vocab';                 -- t
-- select policyname, cmd from pg_policies where tablename='drug_vocab';           -- select 1건
--
-- ════════════════════════════════════════════════════════════════
-- 후속 단계 예고 (이 마이그레이션 범위 밖):
--   P1-3: 규제·전문 "확인필요 225건" 재분류 + 보관방법 483건 보강
--         (통합본·약가마스터 레퍼런스 매칭) → 그 후 compound_type/prescription_type 백필
--   P1-1 제약 강제: 데이터 안정화 후 drugs.category/status/insurance_type 등에
--         CHECK (값 IN drug_vocab) 또는 FK(axis,code) 추가 (별도 마이그레이션 0007+)
-- ════════════════════════════════════════════════════════════════
