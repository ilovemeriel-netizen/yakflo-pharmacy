-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0029 tenants 본인 테넌트 SELECT 정책 — 가역
-- 실행: Supabase Management API.
--
-- 배경: tenants는 RLS 활성이나 SELECT 정책 부재 → 본인 테넌트명도 앱(authenticated)이 못 읽음
--   (대시보드 헤더 테넌트명 동적표시 불가). GRANT(SELECT)는 이미 보유.
-- 변경: 본인 소속 테넌트(id ∈ current_tenant_ids())만 SELECT 허용. 타테넌트 비노출(격리 유지).
--   INSERT/UPDATE/DELETE 정책은 추가하지 않음(직접 쓰기 불가 유지).
-- ════════════════════════════════════════════════════════════════

drop policy if exists tenants_select_own on public.tenants;
create policy tenants_select_own on public.tenants
  for select using (id in (select public.current_tenant_ids()));

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop policy if exists tenants_select_own on public.tenants;
-- ════════════════════════════════════════════════════════════════