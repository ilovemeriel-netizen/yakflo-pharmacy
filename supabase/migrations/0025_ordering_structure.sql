-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0025 발주 구조 — suppliers·purchase_orders·order_items·order_params — 가역
-- 실행: Supabase Management API. IF NOT EXISTS / CREATE OR REPLACE(재실행 안전).
--
-- 목적: 3단계 발주 '구조'(현재고+safety 기반, 사용량 비의존). 발주점 판정·도매사 그룹핑·주문리스트.
--   ※ 발주량 자동산정(EOQ 등 사용량 기반)·입고체크 자동거래는 범위 밖(후속).
-- RLS: 전 테이블 tenant_id + current_tenant_ids() 격리(0001 패턴). allow_all 금지.
-- drugs.supplier_id(nullable) 가산 — 발주 도매사 그룹핑용. 기존 데이터·트리거 무변경.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  contact text, phone text, email text, memo text,
  created_at timestamptz not null default now()
);
create index if not exists idx_suppliers_tenant on public.suppliers(tenant_id);

create table if not exists public.order_params (
  tenant_id uuid primary key,
  safety_coeff numeric not null default 1.0,
  lead_time_days integer not null default 7,
  calc_period_days integer not null default 30,
  order_unit integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default '작성중',
  order_date date not null default current_date,
  memo text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_po_tenant on public.purchase_orders(tenant_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  drug_code text not null,
  drug_name text,
  order_qty numeric not null default 0,
  current_qty numeric,
  safety_stock numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_oi_order on public.order_items(order_id);

alter table public.drugs add column if not exists supplier_id uuid;
comment on column public.drugs.supplier_id is '발주 도매사(suppliers.id). 발주 그룹핑용. nullable.';

-- ── RLS (0001 패턴: tenant_id in current_tenant_ids()) ──
alter table public.suppliers       enable row level security;
alter table public.order_params    enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.order_items     enable row level security;

do $$
declare tbl text; act text;
begin
  foreach tbl in array array['suppliers','order_params','purchase_orders','order_items'] loop
    execute format('drop policy if exists %I_sel on public.%I', tbl, tbl);
    execute format('create policy %I_sel on public.%I for select using (tenant_id in (select public.current_tenant_ids()))', tbl, tbl);
    execute format('drop policy if exists %I_ins on public.%I', tbl, tbl);
    execute format('create policy %I_ins on public.%I for insert with check (tenant_id in (select public.current_tenant_ids()))', tbl, tbl);
    execute format('drop policy if exists %I_upd on public.%I', tbl, tbl);
    execute format('create policy %I_upd on public.%I for update using (tenant_id in (select public.current_tenant_ids())) with check (tenant_id in (select public.current_tenant_ids()))', tbl, tbl);
    execute format('drop policy if exists %I_del on public.%I', tbl, tbl);
    execute format('create policy %I_del on public.%I for delete using (tenant_id in (select public.current_tenant_ids()))', tbl, tbl);
  end loop;
end $$;

-- ── GRANT (authenticated 역할 — RLS가 행 범위 통제) ──
grant select, insert, update, delete on public.suppliers       to authenticated;
grant select, insert, update, delete on public.order_params    to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.order_items     to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- revoke all on public.suppliers, public.order_params, public.purchase_orders, public.order_items from authenticated;
-- alter table public.drugs drop column if exists supplier_id;
-- drop table if exists public.order_items;
-- drop table if exists public.purchase_orders;
-- drop table if exists public.order_params;
-- drop table if exists public.suppliers;
-- ════════════════════════════════════════════════════════════════