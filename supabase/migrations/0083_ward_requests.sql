-- 0083_ward_requests.sql
-- 목적: 명절 병동 약품 신청 — 신청 헤더/품목 2테이블 + 기간 설정 1테이블 신설. 0080(drug_idle_reviews) 패턴 복제.
--
-- 흐름: 비회원이 분리 앱(ward-request)에서 신청 → Netlify Function이 service_role로 INSERT
--       → 약제과 관리 화면(authenticated)에서 조회·수정·사용량 기입. 병동은 저장 후 조회·수정 불가.
--
-- ★ 설계 판단 (0083 고유)
--  (a) tenant_id NOT NULL 유지 — Function이 service_role로 **명시 지정**한다.
--      `set_tenant_id_from_user()`는 **`if new.tenant_id is null`일 때만** 채우므로(실측 확인)
--      명시값을 덮어쓰지 않는다 → 비회원 경로에서도 NOT NULL 충족. 트리거는 안전망으로 함께 부착
--      (관리 화면에서 authenticated가 직접 만들 경우 자동 부여).
--  (b) 기간 설정은 **신규 테이블**(ward_request_window). profiles.settings는 사용자별이라 Function이
--      「누구의 settings인지」 정할 수 없고, 환경변수는 여닫을 때마다 재배포가 필요해 요구 불충족.
--  (c) season·request_year를 **헤더에도 둔다**(window와 중복). window는 「지금 어느 명절이 열려 있나」,
--      헤더는 「이 신청이 어느 명절 것인가」 — window가 다음 명절로 바뀌어도 과거 신청의 소속이 유지돼야 하므로
--      의도적 비정규화(스냅샷).
--  (d) 헤더/품목 2테이블. 1테이블이면 병동·작성자가 품목마다 반복되고 신청 단위 상태(status)를 표현할 수 없다.
--  (e) items.drug_code는 **nullable**, drug_name은 NOT NULL. 기본 동선은 검색 선택이라 코드가 채워지지만,
--      「목록에 없는데 필요한 약」 자유 입력을 나중에 열 때 마이그레이션이 불필요하도록 열어 둔다(0080 확장 유연성과 같은 취지).
--      코드가 비면 관리 화면에서 매칭 대상으로 표시.
--
-- ★ UNIQUE·CHECK 미부여 — 0080과 같은 취지
--  · UNIQUE: (tenant,ward,season,year)에 걸면 **같은 병동의 추가 신청이 막힌다**. 약제과가 추가 접수를
--    받을 수 있어야 하므로 미부여. 중복은 관리 화면에서 확인.
--  · CHECK: ward(3·4·5·6)·season(설·추석)·status(접수·처리중·완료) 모두 **확장 가능**(병동 신설 등).
--    쓰기 경로가 Function 단일이라 거기서 검증하는 편이 낫고, 값 확장 시 마이그레이션이 불필요해진다.
--
-- ★ GRANT는 자동 부여되지 않는다(함정 #16) — `grant ... to authenticated` 명시 필수. 누락 시 42501.
-- ★ anon GRANT 부여 금지 — Function 경유이므로 불필요하고, 0076 최소권한 취지에 맞다.
--  · drug_code는 drugs FK 아님(코드 기준 조인 — 프로젝트 규약).
--  · 정본(monthly_snapshots)·거래·금액 무관. dryrun A~J 통과 후 승인받아 apply.

-- ── 1) 신청 헤더 ────────────────────────────────────────────────
create table public.ward_requests (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id),
  ward           text not null,                        -- 3·4·5·6 (앱/Function 검증, CHECK 미부여)
  requester_name text not null,                        -- 작성자 이름(비회원 입력)
  season         text not null,                        -- 설·추석 (신청 시점 스냅샷)
  request_year   integer not null,
  status         text not null default '접수',          -- 접수·처리중·완료
  submitted_at   timestamptz not null default now(),   -- 병동이 저장(잠금)한 시각
  created_at     timestamptz default now()
);
create index ward_requests_tenant_period_idx
  on public.ward_requests (tenant_id, request_year desc, season, ward);

-- ── 2) 신청 품목 ────────────────────────────────────────────────
create table public.ward_request_items (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.ward_requests(id) on delete cascade,
  drug_code   text,                                    -- nullable: 자유 입력 대비(위 (e))
  drug_name   text not null,
  qty         numeric not null,                        -- 신청 수량(수량 계열 numeric 일관 — 0012·0013·0015)
  unit        text,                                    -- 표시용 포장 단위 스냅샷(병·포·PTP…)
  usage_qty   numeric,                                 -- 관리자 화면에서만 기입
  memo        text,
  sort_order  integer default 0
);
create index ward_request_items_request_idx
  on public.ward_request_items (request_id, sort_order);

-- ── 3) 신청 기간 설정 ───────────────────────────────────────────
create table public.ward_request_window (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  season       text not null,
  request_year integer not null,
  is_open      boolean not null default false,         -- 관리자가 여닫음(재배포 불요)
  opens_at     timestamptz,
  closes_at    timestamptz,
  notice       text,                                   -- 신청 화면 상단 안내문
  updated_at   timestamptz default now()
);
create index ward_request_window_open_idx
  on public.ward_request_window (tenant_id, is_open, request_year desc);

-- ── tenant 자동 부여 안전망(명시값이 있으면 덮어쓰지 않음) ──────
create trigger trg_set_tenant_id before insert on public.ward_requests
  for each row execute function public.set_tenant_id_from_user();
create trigger trg_set_tenant_id before insert on public.ward_request_window
  for each row execute function public.set_tenant_id_from_user();

-- ── GRANT (★ 자동 부여 안 됨 · anon 제외) ──────────────────────
grant select, insert, update, delete on public.ward_requests       to authenticated;
grant select, insert, update, delete on public.ward_request_items  to authenticated;
grant select, insert, update, delete on public.ward_request_window to authenticated;

-- ★★ service_role도 자동 부여되지 않는다 — dryrun에서 42501 확인(함정 #16의 확장).
--    Function(비회원 신청 쓰기 + 기간 개폐 판정)이 service_role로 동작하므로 없으면 쓰기 경로 전체가 죽는다.
--    ※ 0080(drug_idle_reviews)에도 service_role GRANT가 없으나, 그 테이블은 authenticated만 쓰기 때문에 문제가 없었다.
grant select, insert, update, delete on public.ward_requests       to service_role;
grant select, insert, update, delete on public.ward_request_items  to service_role;
grant select, insert, update, delete on public.ward_request_window to service_role;

-- ── RLS ────────────────────────────────────────────────────────
alter table public.ward_requests       enable row level security;
alter table public.ward_request_items  enable row level security;
alter table public.ward_request_window enable row level security;

-- 헤더: 자기 tenant 조회·수정·삭제(admin)
create policy ward_requests_select_own_tenant on public.ward_requests
  for select using (tenant_id in (select current_tenant_ids()));
create policy ward_requests_insert_own_tenant on public.ward_requests
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy ward_requests_update_own_tenant on public.ward_requests
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
create policy ward_requests_delete_admin_own_tenant on public.ward_requests
  for delete using (tenant_id in (select current_tenant_ids()) and public.is_admin());

-- 품목: 헤더의 tenant를 따라감(EXISTS 조인)
create policy ward_request_items_select_own_tenant on public.ward_request_items
  for select using (exists (select 1 from public.ward_requests r
    where r.id = request_id and r.tenant_id in (select current_tenant_ids())));
create policy ward_request_items_insert_own_tenant on public.ward_request_items
  for insert with check (exists (select 1 from public.ward_requests r
    where r.id = request_id and r.tenant_id in (select current_tenant_ids())));
create policy ward_request_items_update_own_tenant on public.ward_request_items
  for update using (exists (select 1 from public.ward_requests r
    where r.id = request_id and r.tenant_id in (select current_tenant_ids())))
  with check (exists (select 1 from public.ward_requests r
    where r.id = request_id and r.tenant_id in (select current_tenant_ids())));
create policy ward_request_items_delete_admin_own_tenant on public.ward_request_items
  for delete using (public.is_admin() and exists (select 1 from public.ward_requests r
    where r.id = request_id and r.tenant_id in (select current_tenant_ids())));

-- 기간 설정: 조회·수정(관리 화면), 생성/삭제도 tenant 한정
create policy ward_request_window_select_own_tenant on public.ward_request_window
  for select using (tenant_id in (select current_tenant_ids()));
create policy ward_request_window_insert_own_tenant on public.ward_request_window
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy ward_request_window_update_own_tenant on public.ward_request_window
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
create policy ward_request_window_delete_admin_own_tenant on public.ward_request_window
  for delete using (tenant_id in (select current_tenant_ids()) and public.is_admin());

comment on table public.ward_requests       is '명절 병동 약품 신청 헤더 — 비회원이 Function(service_role) 경유로 생성. 병동은 저장 후 수정 불가.';
comment on table public.ward_request_items  is '명절 병동 약품 신청 품목 — 헤더 삭제 시 cascade. usage_qty는 관리자 화면 전용.';
comment on table public.ward_request_window is '명절 신청 기간 설정 — 관리자가 is_open으로 여닫음(재배포 불요). Function이 service_role로 읽어 개폐 판정.';

-- 롤백(참고):
-- drop table if exists public.ward_request_items cascade;
-- drop table if exists public.ward_requests cascade;
-- drop table if exists public.ward_request_window cascade;
