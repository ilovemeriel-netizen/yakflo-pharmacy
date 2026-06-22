-- ════════════════════════════════════════════════════════════════
-- Yakflo · A하드닝 — tenant_members 자기행 SELECT 정책 (RLS 버그 수정)
-- 실행 위치: Supabase Dashboard → SQL Editor (또는 Management API)
-- 안전 재실행 가능 (DROP POLICY IF EXISTS)
--
-- ▶ 문제: tenant_members 가 RLS 활성 + 정책 0개 = 전부 deny.
--   · 사용자가 자기 멤버십을 못 읽음 → 앱 역할탐지(loadMemberRole) null
--   · drugs_delete_admin_own_tenant 의 EXISTS(tenant_members …) 서브쿼리가
--     RLS에 막혀 false → owner/admin 도 삭제 불가(의도와 반대).
--   (drugs SELECT는 current_tenant_ids() SECURITY DEFINER라 정상 동작했음)
--
-- ▶ 수정: 사용자가 '자기 멤버십 행만' 읽도록 허용(타인 행은 계속 차단).
--   → EXISTS 서브쿼리 통과 → admin/owner 삭제 정상화 + 역할탐지 복구.
--   가산적: 신규 SELECT 정책 1개만 추가. 기존 정책·데이터 무수정.
-- ════════════════════════════════════════════════════════════════

begin;

drop policy if exists tenant_members_select_own on public.tenant_members;
create policy tenant_members_select_own on public.tenant_members
  for select to authenticated
  using (user_id = auth.uid());

commit;

-- ════════════════════════════════════════════════════════════════
-- 검증 (commit 후)
--   · 로그인 사용자가 자기 tenant_members 행 1건 조회됨
--   · owner/admin 의 drugs DELETE 허용, member 는 여전히 거부
-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- ----------------------------------------------------------------
-- drop policy if exists tenant_members_select_own on public.tenant_members;
-- ════════════════════════════════════════════════════════════════