-- 0040: 약품변경 — 월평균 수기 조정값 컬럼 추가
--
-- 계절성·신규 도입·패턴 변화 등으로 monthly_snapshots 자동 산출이 부적합할 때
-- 사용자가 월평균을 직접 조정할 수 있게 한다. 값이 있으면 자동값보다 우선한다.
--
-- base_date NOT NULL·usage_dept1~3 은 0039에서 적용됨(재적용 안전하게 함께 명시).
-- weekly_usage 는 유지(합계 보관용). GRANT 는 테이블 단위라 신규 컬럼 자동 포함(추가 불필요).
-- 재적용 안전: set not null 은 이미 NOT NULL이면 no-op, add column if not exists.

begin;

alter table public.drug_change_plans alter column base_date set not null;

alter table public.drug_change_plans
  add column if not exists usage_dept1 numeric,          -- 가정의학과(화)
  add column if not exists usage_dept2 numeric,          -- 재활의학과(수)
  add column if not exists usage_dept3 numeric,          -- 신경과(목)
  add column if not exists monthly_avg_manual numeric;   -- 월평균 수기 조정값(있으면 자동값보다 우선)

commit;