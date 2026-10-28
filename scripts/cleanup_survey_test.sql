-- ════════════════════════════════════════════════════════════════════════════
-- 수요조사 테스트 데이터 정리 — **실행하지 않았습니다.** 검증 뒤 이정화 님이 쓰십니다.
--
-- ★★ 먼저 읽을 것 ★★
--   감사 기록(audit)이 1건이라도 있는 회차는 지울 수 없다.
--   이 경우 status='closed' 로 두고, 접종 끝날이 지난 뒤
--   약플로 「개인정보 파기」 버튼으로 정리한다.
--
-- ★ 쓰는 순서
--    1) 0) 확인  — 지울 대상이 테스트 회차뿐인지 **먼저 눈으로 본다**
--    2) 1) 삭제  — BEGIN … 확인 … COMMIT. 미리 ROLLBACK 으로 연습할 수 있다
--
-- ★ 회차 제목에 「테스트」가 들어간 것만 지운다. 실제 회차를 지우지 않기 위한 안전장치다.
--    테스트 회차를 다른 제목으로 만들었으면 아래 조건을 그 제목으로 바꿀 것.
--
-- ★ 삭제 순서가 중요하다 — audit · responses 가 survey 를 FK(on delete restrict)로 잡고 있다.
--    audit → responses → attempts → surveys 순서여야 한다.
--
-- ★ vaccine_survey_audit 에는 **UPDATE·DELETE 금지 트리거**가 걸려 있다.
--    그래서 audit 행은 관리자 권한(postgres)으로만 지울 수 있고, 화면에서는 지워지지 않는다.
--    기록을 남겨 두는 편이 낫다면 2-A 를 건너뛰고 2-B 부터 하되,
--    그때는 surveys 를 지울 수 없으므로 status='closed' 로만 두고 남겨 둔다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0) 확인 — 지울 대상을 먼저 센다 (읽기만) ────────────────────────────────
select s.id, s.title, s.season, s.status, s.open_at, s.vax_start, s.vax_end,
       (select count(*) from public.vaccine_survey_responses r where r.survey_id = s.id) as responses,
       (select count(*) from public.vaccine_survey_audit a     where a.survey_id = s.id) as audit_rows
from public.vaccine_surveys s
where s.title like '%테스트%'
order by s.created_at;

-- 테스트 회차에 달린 응답이 **정말 테스트인지** 확인한다(성명은 출력하지 않는다)
select r.survey_id, r.status, count(*) as rows, sum((case when r.self_dose then 1 else 0 end) + r.family_count) as dose
from public.vaccine_survey_responses r
join public.vaccine_surveys s on s.id = r.survey_id
where s.title like '%테스트%'
group by r.survey_id, r.status
order by 1, 2;

-- ── 1) 삭제 — 트랜잭션으로 묶는다 ───────────────────────────────────────────
-- ※ 먼저 ROLLBACK 으로 연습해 보고, 숫자가 맞으면 COMMIT 으로 바꿔 다시 실행할 것.
begin;

-- 2-A) 기록 — append-only 트리거는 **DELETE 도** 막는다.
--      관리자 권한에서도 트리거는 돈다. 지우려면 트리거를 잠시 끄는 수밖에 없는데,
--      그건 가드를 우회하는 일이라 권하지 않는다.
--      ★ 권장: 이 블록을 쓰지 말고 기록을 남긴다. 그러면 2-D 도 건너뛴다.
-- alter table public.vaccine_survey_audit disable trigger trg_vaccine_survey_audit_append_only;
-- delete from public.vaccine_survey_audit
--  where survey_id in (select id from public.vaccine_surveys where title like '%테스트%');
-- alter table public.vaccine_survey_audit enable  trigger trg_vaccine_survey_audit_append_only;

-- 2-B) 응답
delete from public.vaccine_survey_responses
 where survey_id in (select id from public.vaccine_surveys where title like '%테스트%');

-- 2-C) 제출 횟수 기록 — IP 해시별 창. 테스트로 늘어난 것만 지우려 해도 구별이 안 되므로
--      **전부 지운다**. 1시간 창이라 지워도 실사용에 영향이 없다(다음 제출에 새로 만들어진다).
delete from public.vaccine_survey_attempts;

-- 2-D) 회차 — 2-A 를 건너뛰었으면 audit FK 때문에 지워지지 않는다.
--      그 경우 이 구문은 23503 으로 실패하므로, 아래 UPDATE 로 대신한다.
delete from public.vaccine_surveys where title like '%테스트%';

-- 2-D') 2-D 가 실패하면 이것만 실행한다 — 지우지 않고 닫아 둔다(기록 보존)
-- update public.vaccine_surveys
--    set status = 'closed', open_at = null, updated_at = now()
--  where title like '%테스트%';

-- ── 2) 확인 후 결정 ─────────────────────────────────────────────────────────
select (select count(*) from public.vaccine_surveys)          as surveys_left,
       (select count(*) from public.vaccine_survey_responses) as responses_left,
       (select count(*) from public.vaccine_survey_audit)     as audit_left,
       (select count(*) from public.vaccine_survey_attempts)  as attempts_left,
       -- ★ 아래 셋은 **변하지 않아야** 한다
       (select count(*) from public.vaccine_events)           as events_must_be_43,
       (select count(*) from public.vaccine_categories)        as cats_must_be_13,
       (select count(*) from public.vaccine_public_attempts)   as old_lock_must_be_0;

rollback;   -- ← 숫자가 맞으면 이 줄을 commit; 으로 바꿔 다시 실행
