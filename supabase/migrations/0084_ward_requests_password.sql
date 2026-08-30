-- 0084_ward_requests_password.sql
-- 목적: 병동이 저장한 신청을 **비밀번호로 재조회**할 수 있게 ward_requests에 컬럼 4개 추가.
--
-- 흐름: 저장 시 병동이 숫자 4자리를 입력 → ward-submit이 행별 salt로 scrypt 해시해 저장
--       → 재방문 시 ward-verify가 ward+pw로 검증하고 **품목 목록만** 돌려준다.
--
-- ★ 설계 판단 (0084 고유)
--  (a) 컬럼 4개 전부 **nullable 또는 default** — 기존 INSERT 경로(ward-submit의 5필드 INSERT,
--      관리 화면 authenticated INSERT)를 하나도 깨지 않는다. 접수 기간이 **열린 채로** 적용하기 위한 전제다.
--  (b) pw_hash/pw_salt가 null인 기존 행은 **조회 불가 상태로 남는다**(비밀번호를 만든 적이 없으므로).
--      ward-verify가 그 경우를 구분해 「약제과 내선 217로 문의해 주세요」로 안내한다.
--  (c) 행별 salt 필수 — 4자리는 경우의 수 1만이라 salt가 없으면 무지개표로 즉시 역산된다.
--      salt는 Function이 randomBytes로 만들어 넣는다(DB 기본값을 두지 않는다 — 해시와 짝이 맞아야 한다).
--  (d) pw_fail / pw_locked_until — 레이트 리미팅 상태를 **행에 둔다**.
--      비회원 경로라 세션이 없고, Function 인스턴스는 요청마다 갈리므로 메모리 카운터를 쓸 수 없다.
--  (e) pw_fail은 smallint not null default 0 — null 분기를 없애 Function 로직을 단순하게 유지한다.
--
-- ★ CHECK 미부여 — 0080·0083과 같은 취지.
--    4자리 규칙·잠금 시간은 쓰기 경로(Function 단일)에서 검증하는 편이 낫고,
--    정책이 바뀌어도(6자리 전환 등) 마이그레이션이 불필요해진다.
--    또한 접수 기간이 열린 상태에서 기존 행을 훑는 제약을 걸지 않는다.
--
-- ★ GRANT는 자동 부여되지 않는다(함정 #16). 다만 **컬럼 추가는 테이블 GRANT를 그대로 물려받으므로**
--   0083에서 부여한 authenticated·service_role 권한이 새 컬럼에도 적용된다.
--   그럼에도 회귀를 막기 위해 테이블 GRANT를 명시적으로 재선언한다(멱등).
-- ★ RLS 정책은 컬럼 단위가 아니라 행 단위라 0083 정책 그대로 적용된다 — 신규 정책 없음.
-- ★ 정본(monthly_snapshots)·거래·금액 무관. dryrun A~H 통과 후 승인받아 apply.

alter table public.ward_requests add column if not exists pw_hash         text;
alter table public.ward_requests add column if not exists pw_salt         text;
alter table public.ward_requests add column if not exists pw_fail         smallint not null default 0;
alter table public.ward_requests add column if not exists pw_locked_until timestamptz;

comment on column public.ward_requests.pw_hash is
  '재조회용 비밀번호 해시 — Node crypto.scrypt(pw, pw_salt) hex. null이면 비밀번호 미설정(조회 불가, 약제과 문의 안내).';
comment on column public.ward_requests.pw_salt is
  '해시용 행별 salt(hex). 4자리 비밀번호는 경우의 수 1만이라 salt 없이는 즉시 역산된다.';
comment on column public.ward_requests.pw_fail is
  '연속 실패 횟수. 성공 시 0으로 초기화. 임계치 도달 시 pw_locked_until 설정.';
comment on column public.ward_requests.pw_locked_until is
  '이 시각까지 조회 잠금. null이거나 과거면 잠금 아님.';

-- ★ 컬럼 추가는 기존 테이블 GRANT를 물려받지만, 회귀 방지를 위해 명시 재선언(멱등).
grant select, insert, update, delete on public.ward_requests to authenticated;
grant select, insert, update, delete on public.ward_requests to service_role;

-- 롤백(참고):
-- alter table public.ward_requests drop column if exists pw_locked_until;
-- alter table public.ward_requests drop column if exists pw_fail;
-- alter table public.ward_requests drop column if exists pw_salt;
-- alter table public.ward_requests drop column if exists pw_hash;
