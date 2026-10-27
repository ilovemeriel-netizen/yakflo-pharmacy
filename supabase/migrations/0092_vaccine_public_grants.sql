-- 0092: 백신 공개 조회 Function 3개가 쓰는 객체에 service_role 권한 부여
-- 배경: 0091 이 만든 vaccine_public_settings·vaccine_public_attempts 의 relacl 이 비어 있어
--       service_role 이 42501(permission denied) 로 막힌다. 0089 의 vaccine_accounts·vaccine_events·
--       v_vaccine_balance 도 authenticated 에만 GRANT 돼 있어 service_role 권한이 없다.
--       ★ service_role 은 rolbypassrls=t 라 RLS 는 우회하지만, 테이블 GRANT 는 우회하지 못한다.
--         이 프로젝트는 새 테이블 자동 권한 부여(ALTER DEFAULT PRIVILEGES)가 동작하지 않아 명시 GRANT 가 필요하다.
-- 성격: GRANT 만. RLS·정책·트리거·뷰 정의·테이블 구조를 바꾸지 않는다.
--       anon·authenticated 에는 **아무것도 부여하지 않는다**(공개 화면은 Function 경유라는 0091 설계 유지).
-- 적용: Supabase SQL Editor(운영 phgkjrvdtcdrdiuigici) 또는 scripts/apply_0092.mjs.

-- ── 공개 화면 설정·잠금 (0091) ──────────────────────────────────────────────
--   settings : admin 이 select + upsert(=insert+update). delete 하는 코드 경로가 없어 부여하지 않는다.
grant select, insert, update on public.vaccine_public_settings to service_role;

--   attempts : verify 가 select·upsert·delete, admin 이 select·delete.
grant select, insert, update, delete on public.vaccine_public_attempts to service_role;

-- ── 잔량 조회 (0089) — 읽기만 ───────────────────────────────────────────────
--   ★ v_vaccine_balance 는 security_invoker=true 라 호출자(service_role) 권한으로 하위 테이블을 읽는다.
--     따라서 뷰뿐 아니라 vaccine_accounts·vaccine_events 에도 SELECT 가 필요하다.
grant select on public.vaccine_accounts  to service_role;
grant select on public.vaccine_events    to service_role;
grant select on public.v_vaccine_balance to service_role;

-- ※ tenant_members 는 이미 service_role=arwdDxtm 이라 손대지 않는다.

-- 롤백:
--   revoke select, insert, update on public.vaccine_public_settings from service_role;
--   revoke select, insert, update, delete on public.vaccine_public_attempts from service_role;
--   revoke select on public.vaccine_accounts  from service_role;
--   revoke select on public.vaccine_events    from service_role;
--   revoke select on public.v_vaccine_balance from service_role;
