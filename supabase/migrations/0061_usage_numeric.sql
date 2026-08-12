-- 0061_usage_numeric.sql
-- 목적: 사용량 3컬럼 integer → numeric 전환(반알 처방·병동/외래 합산의 0.5 단위 소수 보존).
--   · 대상: prev_year_usage · recent_3m_usage · recent_1m_usage
--   · 값 보존(USING ::numeric — 기존 정수는 소수부 없는 numeric으로 그대로 남음).
--   · 기본값(0)·NULL 허용 상태 유지.
--   · monthly_avg · safety_stock · max_stock 는 전환 대상 아님(CEIL/ROUND 결과라 정수 유지가 맞음).
--   · 정밀도: 무한정 numeric(스케일 미지정) — 0.5 단위 합산에 유연.
--   · dryrun 필수: BEGIN → ALTER → A~F 검증 → ROLLBACK. 결과 보고 후 승인받고 apply.

alter table public.drugs
  alter column prev_year_usage type numeric using prev_year_usage::numeric,
  alter column recent_3m_usage type numeric using recent_3m_usage::numeric,
  alter column recent_1m_usage type numeric using recent_1m_usage::numeric;

-- 롤백(참고): 소수부가 있으면 반올림되어 소실될 수 있으니 apply 전 백업 권장.
-- alter table public.drugs
--   alter column prev_year_usage type integer using round(prev_year_usage)::integer,
--   alter column recent_3m_usage type integer using round(recent_3m_usage)::integer,
--   alter column recent_1m_usage type integer using round(recent_1m_usage)::integer;