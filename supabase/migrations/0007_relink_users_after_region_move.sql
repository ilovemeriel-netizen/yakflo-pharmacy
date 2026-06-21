-- ════════════════════════════════════════════════════════════════
-- Yakflo · 리전 이전(Sydney→Seoul) 후 사용자 재매핑
-- 실행 위치: 신규(Seoul) 프로젝트 → Supabase Dashboard → SQL Editor
-- 안전 재실행 가능 (ON CONFLICT / WHERE / IF EXISTS)
--
-- 목적: 리전 이전 시 auth.users는 옮겨지지 않아 사용자가 재로그인하면
--       UUID가 새로 발급된다. 복원된 운영 데이터(drugs 등)는 tenants(id)만
--       참조하므로 그대로 붙지만, tenant_members/profiles는 옛 UUID 기준이라
--       고아가 된다. 이 스크립트는 **이메일 기준으로 멤버십·관리자 권한을
--       새 UUID에 다시 붙인다**(0002 step4 + profiles_schema step7과 동일 원칙).
--
-- ⚠️ 실행 전제 (순서 중요):
--   1) tenants 데이터가 복원되어 'cnc' 테넌트가 같은 UUID로 존재할 것
--      (drugs.tenant_id가 이 UUID를 참조 — 재생성하지 말고 복원본 재사용)
--   2) data-only 복원 시 profiles·tenant_members는 **제외**하길 권장.
--      (auth.users가 비어 있어 FK 위반으로 복원이 중단될 수 있음)
--      → 사용자 전원 재로그인(handle_new_user 트리거가 profiles 자동 생성) 후
--        이 스크립트를 실행한다.
--   3) 관리자/소유자 이메일이 아래 상수와 일치하는지 먼저 확인.
--
-- ⚠️ 금지: 기존 운영 데이터(drugs/inventory_stock/transactions/monthly_snapshots) 수정 0건.
-- ════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────
-- 0) 'cnc' 테넌트 존재 보장 (복원됐으면 무시 — 재생성 금지)
--    복원이 누락된 경우에만 새로 만들어진다. slug 유일.
-- ────────────────────────────────────────────────────────────────
insert into public.tenants (name, slug, plan)
values ('씨엔씨재활의학과병원', 'cnc', 'enterprise')
on conflict (slug) do nothing;

-- ────────────────────────────────────────────────────────────────
-- 1) 고아 멤버십 정리 — 새 auth.users에 없는 user_id 행 제거
--    (profiles/tenant_members를 옛 UUID로 복원했다가 남은 경우 대비. 멱등)
-- ────────────────────────────────────────────────────────────────
delete from public.tenant_members tm
where not exists (select 1 from auth.users u where u.id = tm.user_id);

-- 고아 프로필도 정리 (FK on delete cascade라 보통 자동이나, 방어적으로)
delete from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id);

-- ────────────────────────────────────────────────────────────────
-- 2) 멤버십 재구축 — 현재 auth.users 전원을 'cnc'에 매핑
--    · ilovemeriel@gmail.com → 'owner'
--    · 그 외 → 'member'
--    · 이미 매핑된 경우 역할만 보정 (재실행 안전)
-- ────────────────────────────────────────────────────────────────
insert into public.tenant_members (tenant_id, user_id, role)
select
  (select id from public.tenants where slug = 'cnc') as tenant_id,
  u.id                                               as user_id,
  case when u.email = 'ilovemeriel@gmail.com'
       then 'owner' else 'member' end                as role
from auth.users u
on conflict (tenant_id, user_id) do update
  set role = excluded.role;

-- ────────────────────────────────────────────────────────────────
-- 3) profiles 백필 + 관리자 지정
--    handle_new_user 트리거가 가입 시 자동 생성하지만, 누락분 방어 백필.
-- ────────────────────────────────────────────────────────────────
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

update public.profiles
   set role = 'admin'
 where email = 'ilovemeriel@gmail.com';

commit;

-- ════════════════════════════════════════════════════════════════
-- 검증 SELECT (commit 후 실행 — 결과가 기대값과 일치하면 정상)
-- ────────────────────────────────────────────────────────────────
--
-- [검증 1] 고아 멤버십/프로필 0건 확인
-- ----------------------------------------------------------------
-- select 'tenant_members' as t, count(*) as orphan
--   from public.tenant_members tm
--  where not exists (select 1 from auth.users u where u.id = tm.user_id)
-- union all
-- select 'profiles', count(*)
--   from public.profiles p
--  where not exists (select 1 from auth.users u where u.id = p.id);
--   기대: 양쪽 0
--
-- [검증 2] 본인이 owner + admin으로 매핑됐는지
-- ----------------------------------------------------------------
-- select u.email, tm.role as tenant_role, p.role as profile_role
--   from auth.users u
--   left join public.tenant_members tm on tm.user_id = u.id
--   left join public.profiles p on p.id = u.id
--  where u.email = 'ilovemeriel@gmail.com';
--   기대: tenant_role=owner, profile_role=admin
--
-- [검증 3] 운영 데이터의 tenant_id가 복원된 cnc와 일치하는지 (고아 0)
-- ----------------------------------------------------------------
-- select 'drugs' as t, count(*) as bad_tenant
--   from public.drugs d
--  where d.tenant_id is null
--     or not exists (select 1 from public.tenants t where t.id = d.tenant_id)
-- union all
-- select 'inventory_stock', count(*) from public.inventory_stock s
--  where s.tenant_id is null
--     or not exists (select 1 from public.tenants t where t.id = s.tenant_id);
--   기대: 0 (복원된 tenants UUID와 drugs.tenant_id가 일치)
--
-- ════════════════════════════════════════════════════════════════
-- 후속:
--   · 신규 프로젝트 키/URL → .env·Netlify·Vercel 교체, Auth Redirect URLs,
--     카카오/네이버 OAuth 콜백 URL 갱신 (별도 체크리스트 — 요청 시 작성)
--   · 멤버가 여럿이고 역할이 제각각이면 위 case 규칙을 이메일별로 확장
-- ════════════════════════════════════════════════════════════════
