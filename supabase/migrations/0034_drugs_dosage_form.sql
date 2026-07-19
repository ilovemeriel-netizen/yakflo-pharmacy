-- 0034: 제형(dosage_form) 컬럼 신설 (drugs)
-- 배경: 세부 제형(정제·캡슐·주사제 등)이 현재 specification 컬럼에 혼재되어 있다.
--       전용 컬럼을 두어 향후 제형 기준 분류·집계를 가능케 한다.
--       (정본 CSV의 '제형' 30종과 라이브 specification 값이 일치함을 실측 확인 — 공통 757건 불일치 0)
-- 성격: 컬럼 추가만. 기존 58컬럼·데이터·RLS·tenant_id·트리거 일절 무변경. 데이터 이관 없음(별도 검토).
-- 적용: Supabase SQL Editor(운영 phgkjrvdtcdrdiuigici)에 붙여넣어 실행. ADD COLUMN IF NOT EXISTS로 재실행 안전.

alter table public.drugs add column if not exists dosage_form text;

-- 롤백: alter table public.drugs drop column if exists dosage_form;