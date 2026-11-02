-- 0105b_usage_rpc_revoke.sql
-- 목적: app_recompute_usage 의 EXECUTE 를 좁힌다. PUBLIC·anon 회수, authenticated 만 남긴다.
--
-- ★ 적용 시점 — 이 파일은 **화면 배포가 끝난 뒤에** 돌린다.
--   CLAUDE.md 규칙: 「권한을 회수하거나 좁히는 마이그레이션은 그 권한을 쓰는 옛 코드가
--   운영에서 사라진 뒤(병합·배포 직후)에 적용한다.」
--   2026-10-29 0096 사례 — status 열 UPDATE 권한을 먼저 회수해 PR #351 병합 전까지
--   운영 화면의 상태 변경이 42501 로 막혀 있었다.
--
-- 왜 authenticated 를 남기나: 함수가 SECURITY INVOKER 라 호출자 권한으로 돈다.
--   owner 검사는 0105 가 함수 **본문**에 넣었으므로, authenticated 가 불러도
--   owner 가 아니면 'insufficient_privilege' 로 거절된다. EXECUTE 를 owner 한 사람에게만
--   줄 수는 없다 — PostgreSQL 권한은 DB 롤 단위이고 owner 는 tenant_members 의 값이기 때문이다.
--   즉 이 파일이 막는 것은 「로그인조차 안 한 사람(anon)」이다.

begin;

revoke execute on function public.app_recompute_usage(boolean) from public;
revoke execute on function public.app_recompute_usage(boolean) from anon;
grant  execute on function public.app_recompute_usage(boolean) to authenticated;

commit;

-- 확인 (읽기 전용):
--   select coalesce(array_to_string(proacl::text[], ' | '), '(acl 없음 = PUBLIC)')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'app_recompute_usage';
--   → 'postgres=X/postgres | authenticated=X/postgres' 처럼 나오고 anon 이 없어야 한다.

-- 되돌리기 (참고 — 실행하지 않음):
-- begin;
--   grant execute on function public.app_recompute_usage(boolean) to public;
-- commit;
