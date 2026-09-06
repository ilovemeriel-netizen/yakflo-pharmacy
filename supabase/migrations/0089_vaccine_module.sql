-- =============================================================================
-- 0089_vaccine_module.sql
-- 백신 관리 모듈 — 시즌별 재고 계정 · 대상 구분 · append-only 원장
--
-- ★ 적용 완료 — 2026-09-06 · direct pg script · 소요 0.43초
--   BASE TABLE 43→46 · VIEW 4→5 · 정책 102→114
--   supabase db push 미사용
--   ※ schema_migrations 가 0행이므로 이 주석이 사실상 유일한 적용 기록이다.
--     "미적용"으로 오독해 재적용하지 말 것.
--   적용 절차는 dryrun_0089 → apply_0089 → verify_0089 였다(28/28 · 게이트 17종 · 11/11).
--
-- 목적
--   1) 백신은 시즌·재원(일반/보건소/지자체)별로 재고를 **따로 세는** 계정 단위가 필요하다.
--      기존 drugs.current_qty 는 약품당 단일 값이라 이 구분을 담을 수 없다.
--   2) 접종·반납·폐기가 기존 5종 거래 어휘와 성격이 달라 별도 원장을 둔다.
--   3) 원장은 append-only — 정정은 반대 부호 이벤트를 추가한다(A안 역거래와 같은 규약).
--
-- -----------------------------------------------------------------------------
-- ★ 기존 계통 무접촉 — 이 마이그레이션은 신규 객체만 만든다
--   drugs · transactions · inventory_stock · monthly_snapshots · drug_barcodes ·
--   inventory_counts · apply_tx_to_inventory · revert_tx_from_inventory ·
--   guard_drugs_qty_direct · guard_closed_month_tx 를 ALTER·DROP·수정하지 않는다.
--
-- ★ transactions_type_check 에 신규 값을 넣지 않는다.
--   실측(2026-09-06): runClose 는 type 을 리터럴 5개로 하드코딩 필터한다
--     dTx.filter(x=>x.type==='입고') … '출고' … '폐기' … '반품' … '조정'
--   else 분기가 없고 apply_tx_to_inventory 도 case … else 0 이라,
--   신규 어휘를 추가하면 **오류 없이 조용히 누락**된다(재고 무변동 + 스냅샷 실종).
--   따라서 백신 이벤트는 transactions 가 아니라 이 원장에 쌓는다.
--
-- ★ drugs 에 FK 를 걸지 않는다(기존 관행).
--   drug_code 는 text 이고 tenant 별로 갈리며, 약품 삭제가 원장을 끊으면 안 된다.
--   무결성은 앱 계층과 조회 조인으로 유지한다.
--
-- ★★ 내부 FK 는 전부 ON DELETE RESTRICT 다 — CASCADE 를 쓰지 않는다.
--   append-only 원장이 계정 삭제 한 번으로 **통째로 소멸**하면 안 된다.
--   CASCADE 였다면 `delete from vaccine_accounts where …` 한 줄이 그 계정의
--   배정·입고·접종·반납·폐기 기록을 전부 지운다. 되돌릴 방법이 없다.
--   RESTRICT 면 기록이 있는 계정·카테고리는 **삭제 자체가 막힌다**(errcode 23503).
--
--   ★ 규약 — 삭제 대신 비활성화한다.
--     · 계정   : vaccine_accounts.is_active   = false
--     · 카테고리: vaccine_categories.is_active = false
--     이력이 남은 것은 지우지 않는다. drug_barcodes 의 is_active 회수 규약,
--     실사 되돌리기의 A안 역거래와 같은 판단이다.
--   ※ 기록이 하나도 없는 계정·카테고리는 그대로 DELETE 가 된다 — RESTRICT 는
--     참조가 있을 때만 막는다. 잘못 만든 것을 지우는 길은 열려 있다.
--
-- ★★ GRANT 는 authenticated 에만 준다. anon 에는 한 줄도 주지 않는다.
--   실측(2026-09-06): 기존 13개 테이블이 anon 에 전권을 갖고 있고 그중 9개가 TRUNCATE 다.
--   TRUNCATE 는 **RLS 를 우회**하므로(실증: set role anon → truncate drugs 통과)
--   GRANT 만으로 테이블이 통째로 비워진다. 이 구 패턴을 반복하지 않는다.
--   0085·0087·0088 이 이미 authenticated + service_role 만 주는 새 패턴이다.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. vaccine_accounts — 시즌 × 약품 × 재원 단위의 재고 계정
-- -----------------------------------------------------------------------------
create table if not exists public.vaccine_accounts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid        not null references public.tenants(id),
  season            text        not null,                 -- 예 '2026-2027'
  season_start      date        not null,                 -- 예 2026-09-01
  season_end        date        not null,                 -- 예 2027-06-30
  drug_code         text        not null,                 -- drugs 참조. ★ FK 없음(위 헤더 참조)
  funding_source    text        not null,                 -- '일반' | '보건소' | '지자체'
  settlement_body   text,                                 -- 정산 주체
  storage_location  text,                                 -- 냉장고 구획
  admin_end         date,                                 -- 접종 종료
  return_due        date,                                 -- 반납 기한
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now()
);

comment on table  public.vaccine_accounts                  is '백신 재고 계정 — 시즌·약품·재원 조합 단위. drugs.current_qty 와 별개 계통이다.';
comment on column public.vaccine_accounts.drug_code        is 'drugs.drug_code 참조. FK 를 걸지 않는다(기존 관행) — 무결성은 앱·조회 조인으로 유지.';
comment on column public.vaccine_accounts.funding_source   is '재원. 같은 약품이라도 재원이 다르면 별도 계정으로 센다.';
comment on column public.vaccine_accounts.return_due       is '반납 기한. 지자체·보건소 물량은 미접종분을 반납한다.';

alter table public.vaccine_accounts drop constraint if exists vaccine_accounts_funding_source_chk;
alter table public.vaccine_accounts add  constraint vaccine_accounts_funding_source_chk
  check (funding_source in ('일반', '보건소', '지자체'));

-- 시즌 구간이 뒤집히면 조회가 조용히 0건이 된다 — 저장 시점에 막는다.
alter table public.vaccine_accounts drop constraint if exists vaccine_accounts_season_range_chk;
alter table public.vaccine_accounts add  constraint vaccine_accounts_season_range_chk
  check (season_end >= season_start);

-- ★ 같은 시즌·약품·재원은 하나뿐이다. 중복 계정이 생기면 잔량이 갈린다.
alter table public.vaccine_accounts drop constraint if exists vaccine_accounts_uniq;
alter table public.vaccine_accounts add  constraint vaccine_accounts_uniq
  unique (tenant_id, season, drug_code, funding_source);

-- -----------------------------------------------------------------------------
-- 2. vaccine_categories — 계정별 대상 구분(어르신·지자체·일반 등)
-- -----------------------------------------------------------------------------
create table if not exists public.vaccine_categories (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id),
  account_id  uuid        not null references public.vaccine_accounts(id) on delete restrict,
  label       text        not null,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on table  public.vaccine_categories is '계정별 접종 대상 구분. 같은 계정 안에서 누구에게 얼마나 나갔는지를 가른다.';

alter table public.vaccine_categories drop constraint if exists vaccine_categories_uniq;
alter table public.vaccine_categories add  constraint vaccine_categories_uniq
  unique (account_id, label);

-- -----------------------------------------------------------------------------
-- 3. vaccine_events — append-only 원장
--    ★ 정정은 UPDATE·DELETE 가 아니라 **반대 부호 이벤트 추가**로 한다.
--      실사 되돌리기(A안 역거래)와 같은 규약이다. 원본을 지우면 이력이 끊긴다.
-- -----------------------------------------------------------------------------
create table if not exists public.vaccine_events (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id),
  account_id  uuid        not null references public.vaccine_accounts(id)   on delete restrict,
  event_type  text        not null,                       -- '배정'|'입고'|'접종'|'반납'|'폐기'
  qty         numeric     not null,                       -- ★ numeric. 정수 강제하지 않는다(멀티도즈 분할)
  event_date  date        not null default current_date,
  category_id uuid        references public.vaccine_categories(id) on delete restrict,
  lot_no      text,
  expiry_date date,
  container   text,                                       -- '바이알'|'PFS'. NULL 허용
  memo        text,
  created_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid()
);

comment on table  public.vaccine_events            is '백신 원장(append-only). 정정은 반대 부호 이벤트를 추가한다 — UPDATE·DELETE 로 지우지 말 것.';
comment on column public.vaccine_events.qty        is 'numeric. 멀티도즈 바이알 분할을 담기 위해 정수로 강제하지 않는다(drug_lots.quantity 가 integer 라 겪는 제약을 반복하지 않음).';
comment on column public.vaccine_events.event_type is '배정=지자체 물량 할당 · 입고=실물 수령 · 접종=사용 · 반납=미접종분 반환 · 폐기';
comment on column public.vaccine_events.container  is '바이알|PFS. 같은 약품이 두 형태로 오는 경우가 있어 구분한다. 모르면 NULL.';

alter table public.vaccine_events drop constraint if exists vaccine_events_event_type_chk;
alter table public.vaccine_events add  constraint vaccine_events_event_type_chk
  check (event_type in ('배정', '입고', '접종', '반납', '폐기'));

alter table public.vaccine_events drop constraint if exists vaccine_events_container_chk;
alter table public.vaccine_events add  constraint vaccine_events_container_chk
  check (container is null or container in ('바이알', 'PFS'));

-- ★ 0 은 의미가 없다. 정정용 음수는 허용하되(append-only 규약) 0 은 막는다.
--   0 이 들어가면 원장에 「아무 일도 없었다」는 행이 남아 합계·건수를 흐린다.
alter table public.vaccine_events drop constraint if exists vaccine_events_qty_chk;
alter table public.vaccine_events add  constraint vaccine_events_qty_chk
  check (qty <> 0);

-- ★ 대상 구분 없는 접종은 통계에서 **조용히 누락**된다.
--   접종만 강제하고 배정·입고·반납·폐기는 카테고리가 없어도 된다 —
--   그쪽은 계정 단위 수량이지 대상별로 갈리는 값이 아니다.
alter table public.vaccine_events drop constraint if exists vaccine_events_category_chk;
alter table public.vaccine_events add  constraint vaccine_events_category_chk
  check (event_type <> '접종' or category_id is not null);

-- -----------------------------------------------------------------------------
-- 4. 인덱스
-- -----------------------------------------------------------------------------
create index if not exists vaccine_accounts_tenant_season_idx  on public.vaccine_accounts  (tenant_id, season, is_active);
create index if not exists vaccine_accounts_drug_code_idx      on public.vaccine_accounts  (tenant_id, drug_code);
create index if not exists vaccine_categories_account_idx      on public.vaccine_categories (account_id, sort_order);
create index if not exists vaccine_events_account_type_idx     on public.vaccine_events    (account_id, event_type);
create index if not exists vaccine_events_account_date_idx     on public.vaccine_events    (account_id, event_date);

-- -----------------------------------------------------------------------------
-- 5. tenant_id 자동 주입 — 기존 함수 재사용(신규 함수 만들지 않음)
-- -----------------------------------------------------------------------------
drop trigger if exists trg_set_tenant_id on public.vaccine_accounts;
create trigger trg_set_tenant_id before insert on public.vaccine_accounts
  for each row execute function public.set_tenant_id_from_user();

drop trigger if exists trg_set_tenant_id on public.vaccine_categories;
create trigger trg_set_tenant_id before insert on public.vaccine_categories
  for each row execute function public.set_tenant_id_from_user();

drop trigger if exists trg_set_tenant_id on public.vaccine_events;
create trigger trg_set_tenant_id before insert on public.vaccine_events
  for each row execute function public.set_tenant_id_from_user();

-- -----------------------------------------------------------------------------
-- 6. append-only 가드 — 원장을 고치거나 지우지 못하게 막는다
--    ★ 헤더에 「append-only」라고 선언만 하고 DB 가 막지 않으면 선언과 실제가 어긋난다.
--      RLS 정책은 UPDATE·DELETE 를 열어 두므로 실수로 지울 수 있다. 여기서 막는다.
--    ★ guard_drugs_qty_direct 와 같은 **선별 차단** 패턴이다 —
--      전면 금지가 아니라 「바뀌면 안 되는 컬럼」만 본다.
--        차단: qty · event_type · category_id · account_id · event_date
--        허용: memo · lot_no · expiry_date · container
--      LOT·유효기한·용기는 나중에 알게 되는 값이라 사후 보정이 정상 업무다.
--    ★ 정정은 반대 부호 이벤트를 추가한다(실사 되돌리기 A안 역거래와 같은 규약).
--      qty <> 0 제약이 있으므로 음수는 허용되고 0 만 막힌다.
-- -----------------------------------------------------------------------------
create or replace function public.guard_vaccine_events_append_only()
  returns trigger
  language plpgsql
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception '백신 원장은 삭제할 수 없습니다 — 반대 부호 이벤트로 정정하세요 (id=%)', old.id
      using errcode = 'check_violation';
  end if;
  if new.qty         is distinct from old.qty
  or new.event_type  is distinct from old.event_type
  or new.category_id is distinct from old.category_id
  or new.account_id  is distinct from old.account_id
  or new.event_date  is distinct from old.event_date then
    raise exception '백신 원장은 append-only — 정정은 반대 부호 이벤트를 추가하세요 (id=%)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

comment on function public.guard_vaccine_events_append_only() is
  '백신 원장 append-only 가드. qty·event_type·category_id·account_id·event_date 변경과 DELETE 를 차단한다. memo·lot_no·expiry_date·container 는 사후 보정을 허용한다.';

drop trigger if exists trg_vaccine_events_append_only on public.vaccine_events;
create trigger trg_vaccine_events_append_only
  before update or delete on public.vaccine_events
  for each row execute function public.guard_vaccine_events_append_only();

-- -----------------------------------------------------------------------------
-- 7. RLS — 0085 inventory_counts 패턴과 동일. 4정책 전부 tenant 격리.
-- -----------------------------------------------------------------------------
alter table public.vaccine_accounts   enable row level security;
alter table public.vaccine_categories enable row level security;
alter table public.vaccine_events     enable row level security;

-- 계정
drop policy if exists vaccine_accounts_select_own_tenant on public.vaccine_accounts;
create policy vaccine_accounts_select_own_tenant on public.vaccine_accounts
  for select using (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_accounts_insert_own_tenant on public.vaccine_accounts;
create policy vaccine_accounts_insert_own_tenant on public.vaccine_accounts
  for insert with check (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_accounts_update_own_tenant on public.vaccine_accounts;
create policy vaccine_accounts_update_own_tenant on public.vaccine_accounts
  for update using      (tenant_id in (select current_tenant_ids()))
              with check (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_accounts_delete_own_tenant on public.vaccine_accounts;
create policy vaccine_accounts_delete_own_tenant on public.vaccine_accounts
  for delete using (tenant_id in (select current_tenant_ids()));

-- 대상 구분
drop policy if exists vaccine_categories_select_own_tenant on public.vaccine_categories;
create policy vaccine_categories_select_own_tenant on public.vaccine_categories
  for select using (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_categories_insert_own_tenant on public.vaccine_categories;
create policy vaccine_categories_insert_own_tenant on public.vaccine_categories
  for insert with check (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_categories_update_own_tenant on public.vaccine_categories;
create policy vaccine_categories_update_own_tenant on public.vaccine_categories
  for update using      (tenant_id in (select current_tenant_ids()))
              with check (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_categories_delete_own_tenant on public.vaccine_categories;
create policy vaccine_categories_delete_own_tenant on public.vaccine_categories
  for delete using (tenant_id in (select current_tenant_ids()));

-- 원장
drop policy if exists vaccine_events_select_own_tenant on public.vaccine_events;
create policy vaccine_events_select_own_tenant on public.vaccine_events
  for select using (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_events_insert_own_tenant on public.vaccine_events;
create policy vaccine_events_insert_own_tenant on public.vaccine_events
  for insert with check (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_events_update_own_tenant on public.vaccine_events;
create policy vaccine_events_update_own_tenant on public.vaccine_events
  for update using      (tenant_id in (select current_tenant_ids()))
              with check (tenant_id in (select current_tenant_ids()));
drop policy if exists vaccine_events_delete_own_tenant on public.vaccine_events;
create policy vaccine_events_delete_own_tenant on public.vaccine_events
  for delete using (tenant_id in (select current_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 8. 잔량 뷰 — 계정별 집계를 한 곳에 둔다
--
--    ★★ 「배정」은 재고가 아니다. 실물이 병원에 없으므로 잔량에 더하지 않는다.
--       배정 = 지자체가 「이만큼 주겠다」고 할당한 수량이고,
--       입고 = 실제로 받아 냉장고에 들어온 수량이다. 둘은 성격이 다르다.
--
--         현재잔량 balance_qty = 입고 − 접종 − 반납 − 폐기
--         미입고   pending_qty = 배정 − 입고
--
--       배정을 잔량에 더하면 없는 재고를 있다고 세게 된다.
--       (배정 100 · 입고 60 · 접종 20 → balance 40 이 맞다. 140 이면 틀린 것이다.)
--
--    ★ 부호 규칙을 여기 한 곳에만 둔다. 화면마다 다시 쓰면 값이 갈린다 —
--      countAdjustRows 를 함수 안에 둔 것과 같은 이유다(결함 21).
--
--    ★★ security_invoker = true 필수.
--       기본값(security_definer)이면 뷰가 **소유자 권한으로 실행**되어 하위 테이블의
--       RLS 를 우회한다. 테넌트 격리가 통째로 뚫린다.
--
--    ★ LEFT JOIN 을 유지한다 — 이벤트가 0건인 계정도 행이 나와야 한다.
--      INNER JOIN 이면 「배정만 받고 아직 아무 일도 없는 계정」이 화면에서 사라진다.
-- -----------------------------------------------------------------------------
create or replace view public.v_vaccine_balance as
select
  a.id                                                                as account_id,
  a.tenant_id,
  a.season,
  a.drug_code,
  a.funding_source,
  coalesce(sum(e.qty) filter (where e.event_type = '배정'), 0)         as allocated_qty,
  coalesce(sum(e.qty) filter (where e.event_type = '입고'), 0)         as received_qty,
  coalesce(sum(e.qty) filter (where e.event_type = '접종'), 0)         as administered_qty,
  coalesce(sum(e.qty) filter (where e.event_type = '반납'), 0)         as returned_qty,
  coalesce(sum(e.qty) filter (where e.event_type = '폐기'), 0)         as discarded_qty,
  /* 미입고 = 배정 − 입고 */
  coalesce(sum(e.qty) filter (where e.event_type = '배정'), 0)
    - coalesce(sum(e.qty) filter (where e.event_type = '입고'), 0)     as pending_qty,
  /* 현재잔량 = 입고 − 접종 − 반납 − 폐기  (★ 배정을 더하지 않는다) */
  coalesce(sum(e.qty) filter (where e.event_type = '입고'), 0)
    - coalesce(sum(e.qty) filter (where e.event_type = '접종'), 0)
    - coalesce(sum(e.qty) filter (where e.event_type = '반납'), 0)
    - coalesce(sum(e.qty) filter (where e.event_type = '폐기'), 0)     as balance_qty
from public.vaccine_accounts a
left join public.vaccine_events e on e.account_id = a.id
group by a.id, a.tenant_id, a.season, a.drug_code, a.funding_source;

alter view public.v_vaccine_balance set (security_invoker = true);

comment on view public.v_vaccine_balance is
  '백신 계정별 잔량. ★ balance_qty 에 배정을 더하지 않는다 — 배정은 실물이 아직 없는 할당분이며 pending_qty 로 따로 낸다. security_invoker=true 로 하위 테이블 RLS 를 그대로 탄다.';

-- -----------------------------------------------------------------------------
-- 9. GRANT — ★ authenticated 에만. anon 에는 한 줄도 없다.
--    TRUNCATE·REFERENCES·TRIGGER 도 주지 않는다 — TRUNCATE 는 RLS 를 우회한다.
--    service_role 은 PostgREST 상 bypass RLS 이며 별도 GRANT 를 두지 않는다
--    (0085 는 service_role 도 명시했으나, 이 모듈에는 배치 적재 경로가 없다).
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.vaccine_accounts   to authenticated;
grant select, insert, update, delete on public.vaccine_categories to authenticated;
grant select, insert, update, delete on public.vaccine_events     to authenticated;
-- 뷰는 조회 전용. security_invoker=true 라 하위 테이블 RLS 가 그대로 적용된다.
grant select                         on public.v_vaccine_balance  to authenticated;

commit;

-- =============================================================================
-- 롤백(참고) — 역순으로 지운다. 기존 객체는 하나도 건드리지 않는다.
-- =============================================================================
-- drop view    if exists public.v_vaccine_balance;
-- revoke select, insert, update, delete on public.vaccine_events     from authenticated;
-- revoke select, insert, update, delete on public.vaccine_categories from authenticated;
-- revoke select, insert, update, delete on public.vaccine_accounts   from authenticated;
-- drop policy  if exists vaccine_events_delete_own_tenant     on public.vaccine_events;      (외 정책 11개)
-- drop trigger if exists trg_set_tenant_id on public.vaccine_events;
-- drop trigger if exists trg_set_tenant_id on public.vaccine_categories;
-- drop trigger if exists trg_set_tenant_id on public.vaccine_accounts;
-- drop table   if exists public.vaccine_events;       -- ★ FK 가 RESTRICT 이므로 이 순서가 강제된다
-- drop table   if exists public.vaccine_categories;   --   (events → categories → accounts)
-- drop table   if exists public.vaccine_accounts;     --   순서를 어기면 23503 으로 막힌다
-- ※ set_tenant_id_from_user · current_tenant_ids 는 기존 함수이므로 **지우지 말 것**.
