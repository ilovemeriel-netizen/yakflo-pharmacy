-- ════════════════════════════════════════════════════════════════════════════
-- 0094 — 백신 수요조사 권한(GRANT). 0093 이 만든 객체에만 부여한다.
--
-- ★ 이 프로젝트에는 ALTER DEFAULT PRIVILEGES 가 없다 — 새 테이블은 권한 0건으로 시작한다.
--   그래서 쓰는 동작을 **전부 명시**해야 한다(0092 교훈: service_role 은 rolbypassrls=t 라
--   RLS 는 우회하지만 **테이블 GRANT 는 우회하지 못한다**).
--
-- ★ anon 에는 아무것도 부여하지 않는다. 공개 화면은 Function(service_role)만 거친다.
--
-- ★ responses 의 「상태·접종 체크만 수정」은 RLS 로 막을 수 없다(RLS 는 행 단위다).
--   **열 단위 UPDATE GRANT** 가 그 역할을 한다 — 아래 4개 열만 부여한다.
--
-- ★ vaccine_survey_attempts 에는 authenticated 권한을 주지 않는다 — 공개 함수 전용이다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── authenticated (약플로 관리 화면) ────────────────────────────────────────
-- 회차: 읽기·만들기·수정. 삭제는 주지 않는다(0093 에 DELETE 정책도 없다)
grant select, insert, update on public.vaccine_surveys to authenticated;

-- 응답: 읽기 전체 + **이 4개 열만** 수정. INSERT·DELETE 는 주지 않는다
grant select on public.vaccine_survey_responses to authenticated;
grant update (status, done_self, done_family, updated_at)
  on public.vaccine_survey_responses to authenticated;

-- 기록: 쓰기·읽기. UPDATE·DELETE 는 주지 않고 트리거도 막는다(이중 방어)
grant select, insert on public.vaccine_survey_audit to authenticated;

-- 산식 뷰: security_invoker 라 하위 테이블 정책이 그대로 적용된다
grant select on public.v_vaccine_demand to authenticated;

-- 파기 함수 실행
grant execute on function public.purge_vaccine_survey(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid)      to authenticated;

-- ── service_role (공개 사이트 Function) ─────────────────────────────────────
-- 공개 함수가 실제로 하는 동작만 부여한다.
--   info   : surveys SELECT · vaccine_accounts SELECT(0092 에서 이미 부여됨)
--   submit : responses INSERT(+중복 확인 SELECT) · attempts SELECT/INSERT/UPDATE
--   lookup : responses SELECT
--   update : responses UPDATE
--   cancel : responses UPDATE  (DELETE 하지 않는다 — status 를 cancelled 로 바꾼다)
grant select                 on public.vaccine_surveys          to service_role;
grant select, insert, update on public.vaccine_survey_responses to service_role;
grant select, insert, update on public.vaccine_survey_attempts  to service_role;

-- ★ 일부러 주지 않는 것 (코드 경로가 없다 — 필요해지면 그때 추가한다)
--   · responses DELETE            : 취소는 status 변경으로 한다
--   · attempts DELETE             : 1시간 창 초기화는 UPDATE 로 한다
--   · vaccine_survey_audit 전체   : 기록은 로그인한 관리자만 남긴다(공개 함수는 쓰지 않는다)
--   · v_vaccine_demand            : 공개 화면은 산식을 보지 않는다
--   · anon 전부
