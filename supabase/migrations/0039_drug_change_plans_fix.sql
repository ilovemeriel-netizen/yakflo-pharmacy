-- 0039: 약품변경 결함 정정 — base_date NOT NULL + 요일별 진료과 사용량 컬럼
--
-- ① base_date nullable → UNIQUE(tenant_id, from_drug_code, base_date) 무력화(NULL은 중복으로 안 봄).
--    현재 테이블 0행·NULL 0건 확인 후 NOT NULL 부여(기존 데이터 무변경).
-- ② 엑셀 원장의 요일별 진료과 사용량 내역이 weekly_usage(단일)로는 보존 안 됨 → 분해 컬럼 추가.
--    weekly_usage는 합계 보관용으로 유지(기존 데이터 손대지 않음).
--
-- GRANT: drug_change_plans 는 테이블 단위로 anon/authenticated 에 SELECT·INSERT·UPDATE·DELETE 가
--   이미 부여돼 있어, 컬럼 추가 시 신규 컬럼도 자동 포함된다(컬럼 레벨 GRANT 아님) → 추가 GRANT 불필요.
-- 재적용 안전: set not null 은 이미 NOT NULL이면 no-op, add column if not exists.

begin;

-- ① base_date NOT NULL (UNIQUE 유효화)
alter table public.drug_change_plans alter column base_date set not null;

-- ② 요일별 진료과 사용량(주간). weekly_usage(합계)는 유지.
alter table public.drug_change_plans
  add column if not exists usage_dept1 numeric,   -- 가정의학과(화)
  add column if not exists usage_dept2 numeric,   -- 재활의학과(수)
  add column if not exists usage_dept3 numeric;   -- 신경과(목)

commit;