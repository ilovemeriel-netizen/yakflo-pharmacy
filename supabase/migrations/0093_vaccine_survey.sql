-- ════════════════════════════════════════════════════════════════════════════
-- 0093 — 백신 수요조사(직원·가족) : 테이블 4 · 뷰 1 · 함수 3 · 정책
--
-- ★ 기존 테이블·뷰·정책을 한 칸도 바꾸지 않는다. 전부 **추가만** 한다.
--   적용 전 정책 수 114 → 적용 후 114 + 이 파일이 만든 정책 수.
--
-- ★ 분류를 **이름으로 매칭하지 않는다**(2026-10-28 결정 ⓐ).
--   운영 label 에 가격이 붙어 있어("직원가족&간병사(30000)") 이름 매칭은 조용히 0도즈가 된다.
--   그래서 회차가 대상 분류의 **id 배열**을 들고, A 는 id 로만 집계한다.
--   배열에는 FK 를 걸 수 없으므로 트리거로 검증한다.
--
-- ★ 접종 완료(A) 식 — 조사 연 **당일 접종 포함**(결정 ⓒ, >= 사용):
--     A = Σ qty  WHERE event_type='접종'
--                  AND account_id = 회차 account_id
--                  AND category_id = ANY(category_ids)
--                  AND event_date >= (open_at AT TIME ZONE 'Asia/Seoul')::date
--     open_at 이 NULL(아직 열지 않은 회차)이면 A = 0.
--   ※ vaccine_events.event_date 는 **date** 다(timestamptz 아님). 그래서 open_at 을
--     KST 로 바꿔 날짜만 비교한다 — 단계 0 실측으로 확인했다.
--
-- ★ 수요조사 전체가 owner·admin 전용(결정 ⓓ). 기존 백신 테이블은 테넌트 격리만 하지만
--   이 기능은 성명·사번을 다루므로 역할까지 본다. 판정은 is_tenant_admin() 한 곳에만 둔다.
--
-- ★ GRANT 는 이 파일에 없다 — 0094 에서 한다.
--   이 프로젝트에는 ALTER DEFAULT PRIVILEGES 가 없어 새 테이블은 권한이 **0건**으로 시작한다.
--   즉 0093 만 적용된 상태에서는 anon·authenticated·service_role 모두 접근할 수 없다(의도).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0) 관리자 판정 헬퍼 ──────────────────────────────────────────────────────
-- tenant_members(tenant_id, user_id, role) — 단계 0 실측. role 운영 분포는 owner 1건.
create or replace function public.is_tenant_admin(p_tenant uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant
      and tm.user_id   = auth.uid()
      and tm.role in ('owner', 'admin')
  )
$$;

comment on function public.is_tenant_admin(uuid) is
  '현재 로그인 사용자가 해당 tenant 의 owner·admin 인가. 수요조사 정책·파기 함수가 이 한 곳만 쓴다.';

-- ── 1) vaccine_surveys — 조사 회차 ──────────────────────────────────────────
create table if not exists public.vaccine_surveys (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id),
  title         text        not null,
  season        text        not null,
  account_id    uuid        not null references public.vaccine_accounts(id) on delete restrict,
  category_ids  uuid[]      not null,                    -- ★ 접종 완료(A)로 셀 분류. 이름 아님
  open_at       timestamptz,
  close_at      timestamptz,
  vax_start     date        not null,
  vax_end       date        not null,
  status        text        not null default 'draft',
  safety_ratio  numeric     not null default 0.10,
  safety_min    int         not null default 5,
  order_unit    int         not null default 10,
  purged_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.vaccine_surveys drop constraint if exists vaccine_surveys_status_chk;
alter table public.vaccine_surveys add  constraint vaccine_surveys_status_chk
  check (status in ('draft', 'open', 'closed'));

alter table public.vaccine_surveys drop constraint if exists vaccine_surveys_vax_range_chk;
alter table public.vaccine_surveys add  constraint vaccine_surveys_vax_range_chk
  check (vax_start <= vax_end);

alter table public.vaccine_surveys drop constraint if exists vaccine_surveys_cats_chk;
alter table public.vaccine_surveys add  constraint vaccine_surveys_cats_chk
  check (cardinality(category_ids) >= 1);

alter table public.vaccine_surveys drop constraint if exists vaccine_surveys_params_chk;
alter table public.vaccine_surveys add  constraint vaccine_surveys_params_chk
  check (safety_ratio >= 0 and safety_ratio <= 1 and safety_min >= 0 and order_unit >= 1);

-- tenant 당 열린 회차는 1건만 — 공개 화면이 「열린 회차 1건」을 전제로 그린다
create unique index if not exists vaccine_surveys_one_open_idx
  on public.vaccine_surveys (tenant_id) where status = 'open';

create index if not exists vaccine_surveys_tenant_status_idx
  on public.vaccine_surveys (tenant_id, status);

comment on table  public.vaccine_surveys              is '백신 수요조사 회차. tenant 당 status=open 은 1건만.';
comment on column public.vaccine_surveys.category_ids is '접종 완료(A)로 세는 vaccine_categories.id 배열. ★ label 문자열 매칭을 쓰지 않는 이유 = 운영 label 에 가격이 붙어 있다.';
comment on column public.vaccine_surveys.open_at      is 'NULL 이면 아직 열지 않은 회차 — 이때 A 는 0 이다.';
comment on column public.vaccine_surveys.purged_at    is '개인정보 파기 시각. purge_vaccine_survey() 만 채운다.';

-- category_ids 검증 — 배열에는 FK 를 걸 수 없어 트리거로 막는다.
-- ★ 같은 tenant 의 분류여야 하고(지시), **같은 account 의 분류**여야 한다(추가 가드).
--   다른 계정의 분류를 골라도 A 식의 account_id 조건에 걸려 **조용히 0도즈**가 되므로 미리 막는다.
create or replace function public.guard_vaccine_survey_cats()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  bad int;
begin
  select count(*) into bad
  from unnest(new.category_ids) as cid
  where not exists (
    select 1 from public.vaccine_categories c
    where c.id = cid
      and c.tenant_id  = new.tenant_id
      and c.account_id = new.account_id
  );
  if bad > 0 then
    raise exception '선택한 분류 %건이 이 회차의 백신 계정에 없습니다 — 같은 계정의 분류만 고를 수 있습니다', bad
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(new.category_ids) g group by g having count(*) > 1) then
    raise exception '같은 분류가 두 번 선택됐습니다' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_vaccine_survey_cats on public.vaccine_surveys;
create trigger trg_vaccine_survey_cats
  before insert or update of category_ids, account_id, tenant_id on public.vaccine_surveys
  for each row execute function public.guard_vaccine_survey_cats();

-- tenant_id 자동 채움 — 기존 vaccine_* 테이블과 같은 트리거를 재사용한다(무수정)
drop trigger if exists trg_set_tenant_id on public.vaccine_surveys;
create trigger trg_set_tenant_id
  before insert on public.vaccine_surveys
  for each row execute function public.set_tenant_id_from_user();

-- ── 2) vaccine_survey_responses — 응답 ──────────────────────────────────────
create table if not exists public.vaccine_survey_responses (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants(id),
  survey_id        uuid        not null references public.vaccine_surveys(id) on delete restrict,
  receipt_code     text        not null,                   -- 신청번호 6자리
  emp_no           text,                                   -- 선택 입력
  name             text        not null,
  name_key         text        not null,                   -- 공백 제거·소문자. 중복 비교용
  self_dose        boolean     not null,
  family_count     int         not null default 0,
  account_id       uuid        not null references public.vaccine_accounts(id) on delete restrict,
  wish_date        date        not null,
  pin_hash         text,
  pin_salt         text,
  pin_fail         int         not null default 0,
  pin_locked_until timestamptz,
  status           text        not null default 'applied',
  done_self        boolean     not null default false,
  done_family      int         not null default 0,
  consent_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 신청번호 — 혼동 문자(0 O 1 I L) 제외 대문자+숫자 6자리. 31글자 집합
alter table public.vaccine_survey_responses drop constraint if exists vaccine_survey_responses_code_chk;
alter table public.vaccine_survey_responses add  constraint vaccine_survey_responses_code_chk
  check (receipt_code ~ '^[2-9A-HJKMNP-Z]{6}$');

alter table public.vaccine_survey_responses drop constraint if exists vaccine_survey_responses_family_chk;
alter table public.vaccine_survey_responses add  constraint vaccine_survey_responses_family_chk
  check (family_count >= 0 and family_count <= 20);

-- 본인도 아니고 가족도 0 이면 신청할 게 없다
alter table public.vaccine_survey_responses drop constraint if exists vaccine_survey_responses_dose_chk;
alter table public.vaccine_survey_responses add  constraint vaccine_survey_responses_dose_chk
  check (self_dose or family_count > 0);

alter table public.vaccine_survey_responses drop constraint if exists vaccine_survey_responses_status_chk;
alter table public.vaccine_survey_responses add  constraint vaccine_survey_responses_status_chk
  check (status in ('applied', 'cancelled'));

alter table public.vaccine_survey_responses drop constraint if exists vaccine_survey_responses_done_chk;
alter table public.vaccine_survey_responses add  constraint vaccine_survey_responses_done_chk
  check (done_family >= 0 and done_family <= family_count);

alter table public.vaccine_survey_responses drop constraint if exists vaccine_survey_responses_pin_chk;
alter table public.vaccine_survey_responses add  constraint vaccine_survey_responses_pin_chk
  check (pin_fail >= 0);

create unique index if not exists vaccine_survey_responses_code_uniq
  on public.vaccine_survey_responses (survey_id, receipt_code);

-- 사번은 선택 입력이라 NULL 이 여러 건 들어온다 — 부분 UNIQUE 로 「넣은 경우만」 1회 제한
create unique index if not exists vaccine_survey_responses_emp_uniq
  on public.vaccine_survey_responses (survey_id, emp_no) where emp_no is not null;

create index if not exists vaccine_survey_responses_namekey_idx
  on public.vaccine_survey_responses (survey_id, name_key);

create index if not exists vaccine_survey_responses_survey_status_idx
  on public.vaccine_survey_responses (survey_id, status);

comment on table  public.vaccine_survey_responses          is '수요조사 응답. 성명·사번은 개인정보 — 접종 기간이 끝나면 purge_vaccine_survey() 로 파기한다.';
comment on column public.vaccine_survey_responses.name_key is '공백 제거·소문자. 사번 없는 동명이인 경고에만 쓴다(막지 않는다).';
comment on column public.vaccine_survey_responses.done_self is '명단에서 손으로 체크하는 확인용 보조값. 접종 완료(A)의 정본은 vaccine_events 다.';

-- 응답 ↔ 회차 정합 가드 — 어긋나면 산식이 조용히 틀린다
create or replace function public.guard_vaccine_survey_response()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  s record;
begin
  select tenant_id, account_id, vax_start, vax_end into s
  from public.vaccine_surveys where id = new.survey_id;
  if not found then
    raise exception '회차를 찾을 수 없습니다' using errcode = 'foreign_key_violation';
  end if;
  if new.tenant_id is distinct from s.tenant_id then
    raise exception '응답의 tenant 가 회차와 다릅니다' using errcode = 'check_violation';
  end if;
  if new.account_id is distinct from s.account_id then
    raise exception '응답의 백신 계정이 회차와 다릅니다' using errcode = 'check_violation';
  end if;
  if new.wish_date < s.vax_start or new.wish_date > s.vax_end then
    raise exception '희망일이 접종 기간(% ~ %) 밖입니다', s.vax_start, s.vax_end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_vaccine_survey_response_guard on public.vaccine_survey_responses;
create trigger trg_vaccine_survey_response_guard
  before insert or update of survey_id, tenant_id, account_id, wish_date
  on public.vaccine_survey_responses
  for each row execute function public.guard_vaccine_survey_response();

-- ── 3) vaccine_survey_audit — 열람·내려받기·파기 기록(append-only) ─────────
create table if not exists public.vaccine_survey_audit (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id),
  survey_id   uuid        not null references public.vaccine_surveys(id) on delete restrict,
  user_id     uuid        not null,
  action      text        not null,
  response_id uuid        references public.vaccine_survey_responses(id) on delete restrict,
  row_count   int,
  created_at  timestamptz not null default now()
);

alter table public.vaccine_survey_audit drop constraint if exists vaccine_survey_audit_action_chk;
alter table public.vaccine_survey_audit add  constraint vaccine_survey_audit_action_chk
  check (action in ('view_raw', 'export_pdf', 'export_xlsx', 'purge'));

create index if not exists vaccine_survey_audit_survey_idx
  on public.vaccine_survey_audit (survey_id, created_at desc);

comment on table public.vaccine_survey_audit is
  '개인정보 열람·내려받기·파기 기록. append-only — UPDATE·DELETE 는 트리거가 막는다(vaccine_events 와 같은 방식).';

-- append-only 가드 — guard_vaccine_events_append_only 와 같은 방침
create or replace function public.guard_vaccine_survey_audit_append_only()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '개인정보 기록은 삭제할 수 없습니다 (id=%)', old.id
      using errcode = 'check_violation';
  end if;
  raise exception '개인정보 기록은 append-only — 수정할 수 없습니다 (id=%)', old.id
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_vaccine_survey_audit_append_only on public.vaccine_survey_audit;
create trigger trg_vaccine_survey_audit_append_only
  before update or delete on public.vaccine_survey_audit
  for each row execute function public.guard_vaccine_survey_audit_append_only();

drop trigger if exists trg_set_tenant_id on public.vaccine_survey_audit;
create trigger trg_set_tenant_id
  before insert on public.vaccine_survey_audit
  for each row execute function public.set_tenant_id_from_user();

-- ── 4) vaccine_survey_attempts — 제출 횟수 제한(결정 ⓔ) ────────────────────
-- ★ vaccine_public_attempts 를 겸용하지 않는다 — 그 테이블은 (tenant_id, ip_hash) PK 하나로
--   공개 조회 **비밀번호 실패 잠금**을 이미 쓰고 있어, 겸용하면 두 기능이 서로의 잠금을 덮는다.
create table if not exists public.vaccine_survey_attempts (
  tenant_id    uuid        not null references public.tenants(id),
  ip_hash      text        not null,                       -- HMAC. IP 원문은 저장하지 않는다
  window_start timestamptz not null default now(),
  submit_count int         not null default 0,
  primary key (tenant_id, ip_hash)
);

alter table public.vaccine_survey_attempts drop constraint if exists vaccine_survey_attempts_count_chk;
alter table public.vaccine_survey_attempts add  constraint vaccine_survey_attempts_count_chk
  check (submit_count >= 0);

comment on table  public.vaccine_survey_attempts is
  '수요조사 제출 횟수 제한(1시간 고정 창). ★ vaccine_public_attempts(비밀번호 잠금)와 별개 테이블이다 — 겸용하면 서로의 잠금을 덮는다.';
comment on column public.vaccine_survey_attempts.ip_hash is 'HMAC-SHA256(secret, IP). 원문은 저장하지도 로그하지도 않는다.';

-- ── 5) RLS — 네 테이블 모두 켠다 ───────────────────────────────────────────
alter table public.vaccine_surveys          enable row level security;
alter table public.vaccine_survey_responses enable row level security;
alter table public.vaccine_survey_audit     enable row level security;
alter table public.vaccine_survey_attempts  enable row level security;

-- ★ attempts 는 정책을 **하나도 만들지 않는다** — service_role(RLS 우회)만 쓴다.
--   anon·authenticated 는 GRANT 도 정책도 없어 접근 경로가 없다.

-- surveys — owner·admin 만. 생성·수정 가능, 삭제 정책 없음(지우지 않는다)
drop policy if exists vaccine_surveys_select_admin on public.vaccine_surveys;
create policy vaccine_surveys_select_admin on public.vaccine_surveys
  for select to authenticated
  using (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id));

drop policy if exists vaccine_surveys_insert_admin on public.vaccine_surveys;
create policy vaccine_surveys_insert_admin on public.vaccine_surveys
  for insert to authenticated
  with check (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id));

drop policy if exists vaccine_surveys_update_admin on public.vaccine_surveys;
create policy vaccine_surveys_update_admin on public.vaccine_surveys
  for update to authenticated
  using      (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id));

-- responses — SELECT 와 「상태·접종 체크」 UPDATE 만. INSERT·DELETE 정책 없음
--   ※ 어떤 **컬럼**만 고칠 수 있는지는 RLS 로 못 막는다 → 0094 의 열 단위 GRANT 가 담당한다
drop policy if exists vaccine_survey_responses_select_admin on public.vaccine_survey_responses;
create policy vaccine_survey_responses_select_admin on public.vaccine_survey_responses
  for select to authenticated
  using (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id));

drop policy if exists vaccine_survey_responses_update_admin on public.vaccine_survey_responses;
create policy vaccine_survey_responses_update_admin on public.vaccine_survey_responses
  for update to authenticated
  using      (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id));

-- audit — INSERT(user_id = auth.uid() 강제) · SELECT
drop policy if exists vaccine_survey_audit_select_admin on public.vaccine_survey_audit;
create policy vaccine_survey_audit_select_admin on public.vaccine_survey_audit
  for select to authenticated
  using (tenant_id in (select current_tenant_ids()) and public.is_tenant_admin(tenant_id));

drop policy if exists vaccine_survey_audit_insert_admin on public.vaccine_survey_audit;
create policy vaccine_survey_audit_insert_admin on public.vaccine_survey_audit
  for insert to authenticated
  with check (
    tenant_id in (select current_tenant_ids())
    and public.is_tenant_admin(tenant_id)
    and user_id = auth.uid()
  );

-- ── 6) v_vaccine_demand — 산식 한 곳 ───────────────────────────────────────
-- ★ security_invoker = true — 호출자 권한으로 돈다. 즉 위 정책이 그대로 적용된다.
-- ★ 잔량 B 는 v_vaccine_balance 를 그대로 읽는다(수식 재작성 금지).
drop view if exists public.v_vaccine_demand;
create view public.v_vaccine_demand with (security_invoker = true) as
with dem as (
  /* D = Σ(본인 1 + 가족 수) — status='applied' 만 */
  select r.survey_id,
         coalesce(sum((case when r.self_dose then 1 else 0 end) + r.family_count), 0)::numeric as demand_qty,
         count(*) filter (where r.emp_no is null)::int                                        as no_emp_cnt,
         coalesce(sum((case when r.done_self then 1 else 0 end) + r.done_family), 0)::numeric as done_checked
  from public.vaccine_survey_responses r
  where r.status = 'applied'
  group by r.survey_id
), dup as (
  /* 이름 중복 의심 = 사번 없이 같은 name_key 를 쓰는 **신청 건수 합**(눈으로 볼 행 수) */
  select survey_id, coalesce(sum(cnt), 0)::int as name_dup_cnt
  from (
    select survey_id, name_key, count(*) as cnt
    from public.vaccine_survey_responses
    where status = 'applied' and emp_no is null
    group by survey_id, name_key
    having count(*) > 1
  ) g
  group by survey_id
), adm as (
  /* A = 조사 연 날(KST) 이후 「접종」 수량 합. open_at 이 NULL 이면 0 */
  select s.id as survey_id,
         coalesce(sum(e.qty), 0)::numeric as administered_qty
  from public.vaccine_surveys s
  left join public.vaccine_events e
         on e.tenant_id   = s.tenant_id
        and e.account_id  = s.account_id
        and e.event_type  = '접종'
        and e.category_id = any (s.category_ids)
        and s.open_at is not null
        and e.event_date >= (s.open_at at time zone 'Asia/Seoul')::date
  group by s.id
), base as (
  select s.*,
         coalesce(d.demand_qty, 0)                        as d_qty,
         coalesce(d.no_emp_cnt, 0)                        as no_emp_cnt,
         coalesce(d.done_checked, 0)                      as done_checked,
         coalesce(p.name_dup_cnt, 0)                      as name_dup_cnt,
         coalesce(a.administered_qty, 0)                  as a_qty,
         coalesce(b.balance_qty, 0)                       as b_qty
  from public.vaccine_surveys s
  left join dem  d on d.survey_id = s.id
  left join dup  p on p.survey_id = s.id
  left join adm  a on a.survey_id = s.id
  left join public.v_vaccine_balance b on b.account_id = s.account_id
), calc as (
  select base.*,
         greatest(0, d_qty - a_qty) as r_qty
  from base
), calc2 as (
  select calc.*,
         greatest(safety_min::numeric, ceil(r_qty * safety_ratio)) as s_qty
  from calc
), calc3 as (
  select calc2.*,
         greatest(0, r_qty + s_qty - b_qty) as g_qty
  from calc2
)
select
  id            as survey_id,
  tenant_id,
  account_id,
  title,
  season,
  status,
  open_at,
  close_at,
  vax_start,
  vax_end,
  purged_at,
  category_ids,
  safety_ratio,
  safety_min,
  order_unit,
  d_qty                                                           as demand_qty,      -- D
  a_qty                                                           as administered_qty,-- A
  r_qty                                                           as remain_qty,      -- R
  b_qty                                                           as balance_qty,     -- B
  s_qty                                                           as safety_qty,      -- S
  g_qty                                                           as gap_qty,         -- G
  (ceil(g_qty / order_unit::numeric) * order_unit)::numeric        as order_qty,       -- O
  case when b_qty >= r_qty + s_qty then '충분'
       when b_qty >= r_qty         then '주의'
       else '부족' end                                            as demand_status,
  no_emp_cnt,                                                                          -- 사번 없음
  name_dup_cnt,                                                                        -- 이름 중복 의심
  done_checked,                                                                        -- 명단 체크 합
  greatest(0, a_qty - done_checked)                               as outside_qty       -- 수요조사 외 접종
from calc3;

comment on view public.v_vaccine_demand is
  '수요조사 회차별 산식. D 신청 · A 접종완료(연 날 포함, 분류 id 매칭) · R 남은수요 · B 잔량 · S 안전재고 · G 부족분 · O 주문권장. security_invoker 라 호출자 정책을 따른다.';

-- ── 7) purge_vaccine_survey — 개인정보 파기 ────────────────────────────────
-- ★ 이 함수만 성명·사번을 지운다. 자동 파기는 하지 않는다(사람이 눌러야 한다).
-- ★ 도즈 수·희망일·상태·신청번호는 남긴다 — 통계와 이력이 사라지면 안 된다.
create or replace function public.purge_vaccine_survey(p_survey uuid)
  returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  s        record;
  n_rows   int;
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
begin
  select id, tenant_id, status, vax_end, purged_at into s
  from public.vaccine_surveys where id = p_survey;

  if not found then
    raise exception '회차를 찾을 수 없습니다' using errcode = 'no_data_found';
  end if;

  /* 호출자 검사 — SECURITY DEFINER 라 RLS 를 우회하므로 여기서 직접 막는다 */
  if not exists (select 1 from public.current_tenant_ids() t where t = s.tenant_id) then
    raise exception '권한이 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_tenant_admin(s.tenant_id) then
    raise exception '관리자만 파기할 수 있습니다' using errcode = 'insufficient_privilege';
  end if;

  if s.status <> 'closed' then
    raise exception '조사를 닫은 뒤에만 파기할 수 있습니다 (현재 %)', s.status
      using errcode = 'check_violation';
  end if;
  if today_kst <= s.vax_end then
    raise exception '접종 끝날(%)이 지난 뒤에만 파기할 수 있습니다 (오늘 %)', s.vax_end, today_kst
      using errcode = 'check_violation';
  end if;

  update public.vaccine_survey_responses
     set name       = '(파기)',
         name_key   = '',
         emp_no     = null,
         pin_hash   = null,
         pin_salt   = null,
         updated_at = now()
   where survey_id = p_survey;
  get diagnostics n_rows = row_count;

  update public.vaccine_surveys set purged_at = now(), updated_at = now() where id = p_survey;

  insert into public.vaccine_survey_audit (tenant_id, survey_id, user_id, action, row_count)
  values (s.tenant_id, p_survey, auth.uid(), 'purge', n_rows);

  return n_rows;
end $$;

comment on function public.purge_vaccine_survey(uuid) is
  '회차 개인정보 파기. 조건 = status=closed AND 오늘(KST) > vax_end AND 호출자가 그 tenant 의 owner·admin. 도즈·희망일·상태·신청번호는 남긴다.';
