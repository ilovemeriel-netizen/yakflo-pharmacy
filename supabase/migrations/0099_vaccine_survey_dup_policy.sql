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

-- ── 3) 확인번호 대조 시도 — **새 표**로 둔다 ──────────────────────────────
-- ★ 기존 vaccine_survey_attempts 를 건드리지 않는다(사용자 확정 2026-10-30).
--   그 표의 PK 에 용도를 더하려면 PK 를 바꿔야 하는데, **지금 배포된 코드**가
--   onConflict: 'tenant_id,ip_hash' 로 upsert 한다. PK 를 바꾸는 순간부터 코드가
--   올라가기 전까지 그 upsert 가 조용히 실패해 **제출 횟수 제한이 기록되지 않는다**
--   (접수는 성공하므로 아무도 눈치채지 못한다). 접수가 열려 있는 동안에는 더 위험하다.
--   새 표로 두면 그 구간이 **아예 없다** — 기존 표·PK·코드가 한 글자도 영향받지 않는다.
--
-- ★ 이름 원문을 저장하지 않는다 — key_hash 는 HMAC 이다.
--   scope='ip'   : HMAC(secret, IP)
--   scope='name' : HMAC(secret, survey_id || name_key)
create table if not exists public.vaccine_survey_claim_attempts (
  tenant_id    uuid        not null references public.tenants(id),
  scope        text        not null,
  key_hash     text        not null,
  window_start timestamptz not null default now(),
  fail_count   int         not null default 0,
  locked_until timestamptz,
  last_seen    timestamptz not null default now(),
  primary key (tenant_id, scope, key_hash)
);

alter table public.vaccine_survey_claim_attempts
  drop constraint if exists vaccine_survey_claim_attempts_scope_chk;
alter table public.vaccine_survey_claim_attempts
  add  constraint vaccine_survey_claim_attempts_scope_chk
  check (scope in ('ip', 'name'));

alter table public.vaccine_survey_claim_attempts
  drop constraint if exists vaccine_survey_claim_attempts_count_chk;
alter table public.vaccine_survey_claim_attempts
  add  constraint vaccine_survey_claim_attempts_count_chk
  check (fail_count >= 0);

-- 청소용 — last_seen 이 오래된 행부터 지운다
create index if not exists vaccine_survey_claim_attempts_lastseen_idx
  on public.vaccine_survey_claim_attempts (last_seen);

alter table public.vaccine_survey_claim_attempts enable row level security;
-- ★ 정책을 **하나도 만들지 않는다** — service_role(RLS 우회) 전용이다.
--   anon·authenticated 는 GRANT 도 정책도 없어 접근 경로가 없다(attempts 와 같은 방침).
--   → 정책 수는 변하지 않는다.
grant select, insert, update, delete on public.vaccine_survey_claim_attempts to service_role;

comment on table public.vaccine_survey_claim_attempts is
  '확인번호 대조 실패 횟수·잠금. 같은 이름 기준 5회 실패 시 60분 잠금 + IP 기준 제한을 함께 건다. '
  '★ vaccine_survey_attempts(제출 횟수)와 별개 표다 — 겸용하면 서로의 창을 덮는다.';
comment on column public.vaccine_survey_claim_attempts.key_hash is
  'HMAC-SHA256. scope=ip 는 IP, scope=name 은 survey_id||name_key. 원문은 저장하지도 로그하지도 않는다.';
comment on column public.vaccine_survey_claim_attempts.last_seen is
  '마지막으로 건드린 시각. 7일 지난 행은 청소한다(행이 영구 누적되는 것을 막는다).';

-- ── 4) 청소 ────────────────────────────────────────────────────────────────
-- 7일 지난 행을 지운다. pg_cron 이 있으면 그쪽에 걸고, 없으면 함수만 두고
-- 접수 때 가끔(1/100) 부른다 — 어느 쪽이든 같은 함수를 쓴다.
create or replace function public.purge_vaccine_survey_claim_attempts()
  returns int
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  with gone as (
    delete from public.vaccine_survey_claim_attempts
     where last_seen < now() - interval '7 days'
    returning 1)
  select coalesce(count(*), 0)::int from gone;
$$;

grant execute on function public.purge_vaccine_survey_claim_attempts() to service_role;

comment on function public.purge_vaccine_survey_claim_attempts() is
  '7일 지난 확인번호 시도 기록을 지운다. 지운 행 수를 돌려준다. pg_cron 이 있으면 하루 1회, 없으면 접수 때 1/100 확률로 부른다.';

notify pgrst, 'reload schema';
