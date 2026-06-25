-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0027 drug_price_history GRANT SELECT 보강 (0020 누락 보정) — 가역
-- 실행: Supabase Management API.
--
-- 배경: 0020에서 drug_price_history RLS(SELECT 자기 테넌트만) 정책은 생성됐으나
--   authenticated 역할에 GRANT SELECT가 누락 → 앱(owner) 경로로도 감사 이력 조회 불가
--   (permission denied). RLS 격리 실증 완료(외부인 0행) 상태에서 GRANT만 가산.
-- ▶ GRANT 후에도 RLS(tenant_id in current_tenant_ids())가 행 범위 통제 → 자기 테넌트만 노출.
--   INSERT/UPDATE/DELETE는 정책 없음(트리거 definer만 기록) 그대로 — 직접 쓰기 불가 유지.
-- ════════════════════════════════════════════════════════════════

grant select on public.drug_price_history to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- revoke select on public.drug_price_history from authenticated;
-- ════════════════════════════════════════════════════════════════