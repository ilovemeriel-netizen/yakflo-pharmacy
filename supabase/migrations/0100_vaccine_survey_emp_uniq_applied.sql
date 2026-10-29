-- ════════════════════════════════════════════════════════════════════════════
-- 0100 — 사번 1회 제한을 「신청 중인 건」에만 건다(취소한 뒤에는 다시 신청할 수 있게).
--
-- ★ 지금: UNIQUE (survey_id, emp_no) WHERE emp_no is not null   ← 상태 무관
--   그래서 **취소한 사람이 같은 사번으로 다시 신청할 수 없다.**
--   사용자 확정(2026-10-30): cancelled 는 중복으로 보지 않는다.
--
-- ★ 순서가 중요하다 — **새 인덱스를 먼저 만들고, 그다음에 옛 것을 지운다.**
--   반대로 하면 둘 사이에 제약이 **없는 구간**이 생겨 같은 사번 두 건이 들어올 수 있다.
--   이 순서면 전환 중에도 제약은 「옛 것 ∧ 새 것」이라 느슨해지는 순간이 없다.
--   → 접수가 열려 있는 동안 적용해도 안전하다.
--
-- ★ CONCURRENTLY 는 트랜잭션 안에서 돌지 않는다.
--   그래서 이 파일은 **한 문장씩 따로** 보낸다(apply 스크립트가 그렇게 한다).
--   dryrun 은 CONCURRENTLY 를 뺀 형태로 트랜잭션 안에서 확인한다.
--
-- ★ 자료를 바꾸지 않는다. 정책·GRANT·트리거도 건드리지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) 새 인덱스 — 신청 중인 건에만 사번 1회
create unique index concurrently if not exists vaccine_survey_responses_emp_applied_uniq
  on public.vaccine_survey_responses (survey_id, emp_no)
  where emp_no is not null and status = 'applied';

-- 2) 옛 인덱스 제거 — 새 것이 자리 잡은 뒤에만
drop index concurrently if exists public.vaccine_survey_responses_emp_uniq;

comment on index public.vaccine_survey_responses_emp_applied_uniq is
  '같은 회차에서 사번 1회 — 단 status=applied 인 건만. 취소한 뒤에는 같은 사번으로 다시 신청할 수 있다(0100).';
