-- ════════════════════════════════════════════════════════════════
-- Yakflo · monthly_snapshots upsert용 유니크 인덱스 (2026-01~05 적재 전제)
-- 실행 위치: Supabase Dashboard → SQL Editor (또는 Management API)
-- 안전 재실행 가능 (IF NOT EXISTS)
--
-- ▶ 배경: 로더(scripts/load_seed_2026.mjs)는 onConflict
--   (tenant_id, snap_year, snap_month, drug_code) 로 upsert 한다.
--   기존 유니크 인덱스 monthly_snapshots_drug_code_snap_year_snap_month_key 는
--   tenant_id 를 포함하지 않아 onConflict 컬럼셋과 불일치 → upsert 실패.
-- ▶ 조치: tenant_id 포함 4컬럼 유니크 인덱스를 가산 추가(중복키 0 확인 후).
--   기존 인덱스·데이터 무수정. append-only 정책 불변(DELETE 미추가).
-- ════════════════════════════════════════════════════════════════

create unique index if not exists monthly_snapshots_tenant_ym_code_uq
  on public.monthly_snapshots (tenant_id, snap_year, snap_month, drug_code);

-- ════════════════════════════════════════════════════════════════
-- 검증
--   · select count(*) from (select tenant_id,snap_year,snap_month,drug_code,count(*)
--       from monthly_snapshots group by 1,2,3,4 having count(*)>1) t;  -- 0 이어야 생성 가능
-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- ----------------------------------------------------------------
-- drop index if exists public.monthly_snapshots_tenant_ym_code_uq;
-- ════════════════════════════════════════════════════════════════