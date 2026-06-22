-- ════════════════════════════════════════════════════════════════
-- Yakflo · P2-2a — drug_lots 신설 + drugs.drug_code unique index
-- 실행 위치: Supabase Dashboard → SQL Editor (또는 Management API)
-- 안전 재실행 가능 (IF NOT EXISTS / DROP POLICY IF EXISTS)
--
-- 근거: DATA_UI_CONTRACT.md §3·§7, 통합구현가이드 ⑤ 유효기한
-- 가산적: 기존 테이블·데이터 무수정. drugs 1103행 무변동.
-- ════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────
-- 1) drug_lots — 로트별 유효기간 관리 (App.jsx LotModal 호환 컬럼)
--    LotModal: select * where drug_code order by expiry_date /
--              insert {drug_code,lot_no,expiry_date,quantity,supplier,memo,received_date} /
--              update {is_active} / delete by id
-- ────────────────────────────────────────────────────────────────
create table if not exists public.drug_lots (
  id            uuid primary key default gen_random_uuid(),
  drug_code     text not null,
  lot_no        text not null default '',
  expiry_date   date,
  quantity      integer not null default 0,
  supplier      text default '',
  memo          text default '',
  received_date date default current_date,
  is_active     boolean not null default true,
  tenant_id     uuid references public.tenants(id),
  created_at    timestamptz not null default now()
);

create index if not exists drug_lots_drug_code_idx on public.drug_lots (drug_code);
create index if not exists drug_lots_tenant_idx    on public.drug_lots (tenant_id);

-- ────────────────────────────────────────────────────────────────
-- 2) tenant 자동 태깅 트리거 (기존 set_tenant_id_from_user 재사용)
-- ────────────────────────────────────────────────────────────────
drop trigger if exists trg_set_tenant_id on public.drug_lots;
create trigger trg_set_tenant_id
  before insert on public.drug_lots
  for each row execute function public.set_tenant_id_from_user();

-- ────────────────────────────────────────────────────────────────
-- 3) RLS — 운영 테이블과 동일 패턴(current_tenant_ids 격리)
-- ────────────────────────────────────────────────────────────────
alter table public.drug_lots enable row level security;

drop policy if exists drug_lots_select_own_tenant on public.drug_lots;
create policy drug_lots_select_own_tenant on public.drug_lots
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists drug_lots_insert_own_tenant on public.drug_lots;
create policy drug_lots_insert_own_tenant on public.drug_lots
  for insert to authenticated
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists drug_lots_update_own_tenant on public.drug_lots;
create policy drug_lots_update_own_tenant on public.drug_lots
  for update to authenticated
  using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists drug_lots_delete_own_tenant on public.drug_lots;
create policy drug_lots_delete_own_tenant on public.drug_lots
  for delete to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

-- ────────────────────────────────────────────────────────────────
-- 4) drugs.drug_code 유니크 인덱스 (테넌트별) — 360° 조인 무결성·성능
--    라이브 실측: (tenant 단일) 중복 0 → 안전. 멀티테넌트 대비 (tenant_id, drug_code).
-- ────────────────────────────────────────────────────────────────
create unique index if not exists drugs_tenant_drug_code_key
  on public.drugs (tenant_id, drug_code);

commit;

-- ════════════════════════════════════════════════════════════════
-- 검증 (commit 후)
-- ────────────────────────────────────────────────────────────────
-- select count(*) from public.drug_lots;                                  -- 0 (신규 빈 테이블)
-- select policyname, cmd from pg_policies where tablename='drug_lots';     -- own_tenant 4종
-- select indexname from pg_indexes where tablename='drugs' and indexname='drugs_tenant_drug_code_key';
-- select count(*) from public.drugs;                                      -- 1103 (무변동)
-- ════════════════════════════════════════════════════════════════
