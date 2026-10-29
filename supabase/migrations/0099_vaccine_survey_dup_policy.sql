-- ════════════════════════════════════════════════════════════════════════════
-- 0099 — 중복 신청 정책에 필요한 칸을 만든다(쓰는 쪽은 0100·코드가 한다).
--
-- ★ expand-contract 의 expand 단계다. 이 파일은 **칸만 더한다.**
--   기존 동작은 한 줄도 바뀌지 않는다 — 더한 칸은 전부 NULL 허용이거나 기본값이 있다.
--   CLAUDE.md 규칙: 칸을 더한 뒤 스키마 캐시를 갱신하고, API 에서 보이는지 확인한
--   다음에 그 칸을 쓰는 쪽을 올린다.
--
-- ★ 접수가 열려 있는 동안 적용해도 안전하다 — 칸 추가는 기존 INSERT/UPDATE 를
--   막지 않는다. (위험한 것은 0100 의 인덱스 교체인데, 그쪽도 「새로 만들고 옛 것을
--   지우는」 순서라 제약이 느슨해지는 구간이 없다.)
--
-- ★ 개인정보를 더하지 않는다 — 소속은 부서 이름이고 연락처·주민번호 따위는 없다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) 소속 ────────────────────────────────────────────────────────────────
-- NULL 허용: 사번으로 접수하거나 동명이인이 아닌 신청에는 소속이 없다.
alter table public.vaccine_survey_responses
  add column if not exists dept text;

-- 허용값 17개를 **순서 그대로** 고정한다(사용자 확정 2026-10-30).
-- ★ 값을 늘리려면 이 제약을 다시 써야 한다 — 참조표로 바꾸는 안은 백로그.
alter table public.vaccine_survey_responses
  drop constraint if exists vaccine_survey_responses_dept_chk;
alter table public.vaccine_survey_responses
  add  constraint vaccine_survey_responses_dept_chk
  check (dept is null or dept in (
    '진료부', '간호부', '약제과', '재활치료센터', '임상병리실', '영상의학과',
    '사회사업실', '감염관리실', 'QPS실', '진료협력팀', '영양실', '심사팀',
    '원무과', '총무과', '전산', '홍보', '고객지원'));

comment on column public.vaccine_survey_responses.dept is
  '소속(부서). 동명이인이 「저는 다른 사람이에요」를 고를 때 필수. 허용값 17개는 CHECK 로 고정.';

-- ── 2) 동명이인 선언·확인 ──────────────────────────────────────────────────
alter table public.vaccine_survey_responses
  add column if not exists dup_declared boolean not null default false;
alter table public.vaccine_survey_responses
  add column if not exists dup_checked_at timestamptz;
alter table public.vaccine_survey_responses
  add column if not exists dup_checked_by uuid;

comment on column public.vaccine_survey_responses.dup_declared is
  '신청자가 「같은 이름이지만 다른 사람」이라고 **스스로 밝힌** 건. 소속 유무로 추정하지 않는다.';
comment on column public.vaccine_survey_responses.dup_checked_at is
  '관리자가 「확인 완료」로 처리한 시각. 채워지면 「동명이인 확인 필요」 숫자에서 빠진다.';
comment on column public.vaccine_survey_responses.dup_checked_by is
  '확인 완료를 처리한 사용자. auth.users 를 참조하지 않는다 — 사용자가 지워져도 기록은 남아야 한다.';

-- 확인 필요 건을 세는 질의가 쓰는 인덱스(부분)
create index if not exists vaccine_survey_responses_dup_idx
  on public.vaccine_survey_responses (survey_id)
  where dup_declared and dup_checked_at is null;

-- ── 3) 시도 기록 — 용도 구분과 청소용 시각 ────────────────────────────────
-- ★ 지금은 (tenant_id, ip_hash) 가 PK 라 제출 제한과 확인번호 대조가 **같은 행**을
--   쓰게 된다. 용도를 나누지 않으면 서로의 창을 덮어쓴다.
alter table public.vaccine_survey_attempts
  add column if not exists kind text not null default 'submit';
alter table public.vaccine_survey_attempts
  add column if not exists last_seen timestamptz not null default now();

alter table public.vaccine_survey_attempts
  drop constraint if exists vaccine_survey_attempts_kind_chk;
alter table public.vaccine_survey_attempts
  add  constraint vaccine_survey_attempts_kind_chk
  check (kind in ('submit', 'claim_ip', 'claim_name'));

-- PK 를 용도까지 포함하도록 바꾼다. 표가 작아 잠금이 짧다.
alter table public.vaccine_survey_attempts
  drop constraint if exists vaccine_survey_attempts_pkey;
alter table public.vaccine_survey_attempts
  add  constraint vaccine_survey_attempts_pkey
  primary key (tenant_id, ip_hash, kind);

-- 청소용 — last_seen 이 오래된 행을 지운다
create index if not exists vaccine_survey_attempts_lastseen_idx
  on public.vaccine_survey_attempts (last_seen);

comment on column public.vaccine_survey_attempts.kind is
  'submit=제출 횟수 · claim_ip=확인번호 대조(IP 기준) · claim_name=확인번호 대조(이름 기준). '
  '★ claim_name 행은 ip_hash 자리에 HMAC(secret, survey_id||name_key) 를 넣는다 — 이름 원문은 저장하지 않는다.';
comment on column public.vaccine_survey_attempts.last_seen is
  '마지막으로 건드린 시각. 7일 지난 행은 청소한다(행이 IP 마다 영구 누적되던 것을 막는다).';

-- ★ PostgREST 가 새 칸을 보게 한다. 이 알림은 커밋될 때 나간다.
notify pgrst, 'reload schema';
