-- 0085_inventory_counts.sql
-- 목적: 바코드 실사 1단계 — 실사 세션/항목 2테이블 신설 + drugs 컬럼 2개 추가.
--       0083(ward_requests) 패턴 복제. 스캔 인식(카메라·GS1 파싱)은 2단계이며 이 마이그레이션에 없다.
--
-- 흐름: 「+ 실사 시작」으로 세션 생성(작성중) → 수동·엑셀(2단계에서 스캔)로 항목 적재
--       → 「재고반영」 시 차이만큼 **조정 거래를 생성**하고 그 id를 applied_tx_id에 기록(반영완료)
--       → 「되돌리기」는 ★ A안 역거래 — applied_tx_id를 근거로 **반대 부호 조정 거래를 신규 생성**(반영취소).
--
-- ★ 설계 판단 (0085 고유)
--  (a) current_qty를 직접 UPDATE하지 않는다(0055 가드). transactions에 type='조정'을 INSERT하면
--      트리거 apply_tx_to_inventory()가 재고를 갱신한다 — 실측 확인:
--        delta := case new.type ... when '조정' then new.quantity ... end
--      즉 **조정 거래의 quantity는 부호를 그대로 더한다**(음수 허용). 역거래는 부호만 뒤집으면 된다.
--  (b) 거래를 **삭제하지 않는다**. 월마감 스냅샷이 거래를 근거로 산출되므로 삭제는 정합성을 깬다.
--      되돌리기는 항상 신규 역거래다(A안). 그래서 applied_tx_id는 「지울 대상」이 아니라 「역거래의 근거」다.
--  (c) applied_tx_id에 **FK를 걸지 않는다**. 두 가지 이유 —
--      · 프로젝트 규약상 drug_code도 FK가 아니다(코드 기준 조인).
--      · FK(RESTRICT)를 걸면 마감되지 않은 월의 거래 삭제가 막혀 **기존 동작이 바뀐다**.
--        0085는 기존 화면·테이블 무변동이 전제이므로 부작용을 만들지 않는다.
--      대신 uuid로 두고 역거래 시 앱이 조회한다. 원 거래가 사라지면 화면에서 「원 거래 없음」으로 보인다.
--  (d) book_qty(장부수량)를 항목에 **스냅샷**으로 둔다. 실사 시점의 장부값을 남겨야
--      나중에 「그때 얼마였는지」를 재구성할 수 있다. 단 ★ 반영 직전에는 장부를 다시 읽어
--      차이를 재계산한다(실사 중 다른 거래가 발생했을 수 있다) — 앱 책임.
--  (e) counted_qty는 NOT NULL, book_qty는 nullable. 수동/엑셀 입력 시점에 장부를 못 읽는 경우가 있고,
--      비어 있으면 반영 시 조회해 채운다.
--  (f) lot_no·expiry_date는 nullable — 낱알/비로트 품목이 있다.
--  (g) drugs.gtin·unit_mgmt는 **nullable, 기본값 없음**.
--      gtin은 2단계(스캔 매칭)용으로 자리만 만든다 — 이번 단계에서 읽지도 쓰지도 않는다.
--      unit_mgmt(낱알 관리 대상)는 ★ 참고 표시 전용이며 **비어 있어도 재고반영을 막지 않는다**.
--
-- ★ CHECK 미부여 — 0083과 같은 취지.
--    status(작성중·반영완료·반영취소)와 source(스캔·엑셀·수동) 모두 **확장 가능**하다.
--    값이 늘 때마다 마이그레이션을 요구하지 않으려고 걸지 않는다. 검증은 화면에서 한다.
-- ★ UNIQUE 미부여 — 같은 약품을 LOT별로 여러 행 세는 것이 정상이고,
--    같은 LOT를 나눠 세는 경우(구역별)도 막지 않는다. 합산은 화면에서 한다.
-- ★ GRANT는 자동 부여되지 않는다(함정 #16) — authenticated·service_role 명시. anon 부여 금지.
-- ★ 기존 테이블·정책·정본 무변동. 마감(monthly_snapshots)·거래·금액 산식 미접촉.

-- ── 1) 실사 세션 ────────────────────────────────────────────────
create table public.inventory_counts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  count_date    date not null default current_date,   -- 실사일
  title         text not null,                        -- 「2026-09 정기실사」 자동 생성 후 수정 가능
  status        text not null default '작성중',        -- 작성중 / 반영완료 / 반영취소 (CHECK 미부여)
  created_by    uuid default auth.uid(),
  created_at    timestamptz default now(),
  applied_at    timestamptz,                          -- 재고반영 시각
  applied_by    uuid,
  reverted_at   timestamptz,                          -- 되돌리기 시각
  reverted_by   uuid,
  revert_reason text                                  -- ★ 선택 입력 — 비워도 저장된다
);

-- ── 2) 실사 항목 ────────────────────────────────────────────────
create table public.inventory_count_items (
  id            uuid primary key default gen_random_uuid(),
  count_id      uuid not null references public.inventory_counts(id) on delete cascade,
  drug_code     text not null,                        -- drugs FK 아님(코드 기준 조인 — 프로젝트 규약)
  lot_no        text,
  expiry_date   date,
  counted_qty   numeric not null,                     -- 실사수량
  book_qty      numeric,                              -- 장부수량 스냅샷(반영 직전 재계산)
  source        text not null default '수동',          -- 스캔 / 엑셀 / 수동 (CHECK 미부여)
  applied_tx_id uuid,                                 -- ★ 반영 시 생성한 조정 거래 id — 역거래의 근거(FK 아님, (c) 참조)
  created_at    timestamptz default now()
);

create index inventory_counts_tenant_date_idx      on public.inventory_counts (tenant_id, count_date desc);
create index inventory_count_items_count_id_idx    on public.inventory_count_items (count_id);
create index inventory_count_items_drug_code_idx   on public.inventory_count_items (drug_code);

-- ── 3) drugs 컬럼 2개 ───────────────────────────────────────────
-- ★ 둘 다 nullable·기본값 없음 — 기존 INSERT/UPDATE 경로를 깨지 않는다.
alter table public.drugs add column if not exists gtin      text;  -- 2단계(스캔 매칭)용 · 이번 단계 미사용
alter table public.drugs add column if not exists unit_mgmt text;  -- 낱알 관리 대상 · 참고 표시 전용

-- ── tenant_id 자동 부여 (authenticated 경로 안전망) ─────────────
-- set_tenant_id_from_user()는 `new.tenant_id is null`일 때만 채운다(0083에서 실측) → 명시값을 덮어쓰지 않는다.
create trigger trg_set_tenant_id before insert on public.inventory_counts
  for each row execute function public.set_tenant_id_from_user();

-- ── GRANT (★ 자동 부여 안 됨 · anon 제외) ──────────────────────
grant select, insert, update, delete on public.inventory_counts      to authenticated;
grant select, insert, update, delete on public.inventory_count_items to authenticated;
grant select, insert, update, delete on public.inventory_counts      to service_role;
grant select, insert, update, delete on public.inventory_count_items to service_role;

-- ── RLS ────────────────────────────────────────────────────────
alter table public.inventory_counts      enable row level security;
alter table public.inventory_count_items enable row level security;

-- 세션: 자기 tenant 조회·생성·수정 · 삭제는 admin
create policy inventory_counts_select_own_tenant on public.inventory_counts
  for select using (tenant_id in (select current_tenant_ids()));
create policy inventory_counts_insert_own_tenant on public.inventory_counts
  for insert with check (tenant_id in (select current_tenant_ids()));
create policy inventory_counts_update_own_tenant on public.inventory_counts
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
create policy inventory_counts_delete_admin_own_tenant on public.inventory_counts
  for delete using (tenant_id in (select current_tenant_ids()) and public.is_admin());

-- 항목: 세션의 tenant를 따라감(EXISTS 조인) — 0083 items 패턴과 동일
create policy inventory_count_items_select_own_tenant on public.inventory_count_items
  for select using (exists (select 1 from public.inventory_counts c
    where c.id = count_id and c.tenant_id in (select current_tenant_ids())));
create policy inventory_count_items_insert_own_tenant on public.inventory_count_items
  for insert with check (exists (select 1 from public.inventory_counts c
    where c.id = count_id and c.tenant_id in (select current_tenant_ids())));
create policy inventory_count_items_update_own_tenant on public.inventory_count_items
  for update using (exists (select 1 from public.inventory_counts c
    where c.id = count_id and c.tenant_id in (select current_tenant_ids())))
  with check (exists (select 1 from public.inventory_counts c
    where c.id = count_id and c.tenant_id in (select current_tenant_ids())));
create policy inventory_count_items_delete_own_tenant on public.inventory_count_items
  for delete using (exists (select 1 from public.inventory_counts c
    where c.id = count_id and c.tenant_id in (select current_tenant_ids())));
-- ※ 항목 삭제는 admin 한정으로 두지 않는다 — 작성중 세션에서 잘못 담은 줄을 지우는 것은 일상 작업이다.
--   세션 자체 삭제만 admin으로 제한한다.

-- 롤백(참고):
-- drop policy if exists inventory_count_items_delete_own_tenant on public.inventory_count_items;  (외 정책 7개)
-- drop table if exists public.inventory_count_items;
-- drop table if exists public.inventory_counts;
-- alter table public.drugs drop column if exists unit_mgmt;
-- alter table public.drugs drop column if exists gtin;
