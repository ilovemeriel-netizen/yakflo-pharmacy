-- 0038: 약품변경 관리 (drug_change_plans)
--
-- 제약사 사정 등으로 기존 약품을 다른 제품으로 대체하는 '약품변경' 업무 추적.
-- 기존 약품 재고 소진 시점을 예측(조회 시 재계산)해 변경 시점을 판단한다.
-- 계산 원천: 월평균/추천주문량은 monthly_snapshots.total_out_qty(조회 시 산출),
--            주간 사용량은 수기 입력(transactions 출고 0건이라 자동 산출 불가).
--
-- 규약: monthly_report_totals 패턴(명명·타입·RLS·GRANT·복합 UNIQUE) 그대로.
--   ⚠ GRANT 필수(과거 GRANT 누락으로 PostgREST 42501 발생 이력).
--   ⚠ UNIQUE는 처음부터 (tenant_id, from_drug_code, base_date) 복합
--     (한 약품에 변경 이력이 여러 번 생길 수 있으므로 from_drug_code 단독 금지).
-- 재적용 안전: create table if not exists / drop policy if exists / do-guard.

begin;

create table if not exists public.drug_change_plans (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id),
  from_drug_code  text not null,          -- 기존 약품(drugs 조인 키)
  to_drug_name    text,                   -- 변경될 약품명
  to_drug_code    text,                   -- 변경될 약품코드(미등록 가능 → nullable)
  to_manufacturer text,                   -- 변경 후 제약사
  purchased       text,                   -- 사입여부(기존 표기 '○'/'X' 등 유지)
  plan_status     text,                   -- '예정'/'완료'/'보류'
  weekly_usage    numeric,                -- 주간 사용량(수기)
  base_date       date,                   -- 기준일
  memo            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- UNIQUE 복합(재적용 안전)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'drug_change_plans_tenant_from_base_key'
      and conrelid = 'public.drug_change_plans'::regclass
  ) then
    alter table public.drug_change_plans
      add constraint drug_change_plans_tenant_from_base_key unique (tenant_id, from_drug_code, base_date);
  end if;
end $$;

-- tenant_id 자동 세팅(클라 미지정 → auth 기반). 기존 set_tenant_id_from_user 재사용.
drop trigger if exists trg_set_tenant_id on public.drug_change_plans;
create trigger trg_set_tenant_id
  before insert on public.drug_change_plans
  for each row execute function public.set_tenant_id_from_user();

alter table public.drug_change_plans enable row level security;

-- RLS: SELECT/INSERT/UPDATE — 자기 테넌트 (monthly_report_totals 패턴)
drop policy if exists drug_change_plans_select_own_tenant on public.drug_change_plans;
create policy drug_change_plans_select_own_tenant on public.drug_change_plans
  for select using (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_change_plans_insert_own_tenant on public.drug_change_plans;
create policy drug_change_plans_insert_own_tenant on public.drug_change_plans
  for insert with check (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_change_plans_update_own_tenant on public.drug_change_plans;
create policy drug_change_plans_update_own_tenant on public.drug_change_plans
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- DELETE: owner·admin 한정 (transactions_delete_admin_own_tenant 패턴)
drop policy if exists drug_change_plans_delete_admin_own_tenant on public.drug_change_plans;
create policy drug_change_plans_delete_admin_own_tenant on public.drug_change_plans
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = drug_change_plans.tenant_id
        and tm.role in ('owner', 'admin')
    )
  );

-- ⚠ GRANT(42501 재발 방지)
grant select, insert, update, delete on public.drug_change_plans to anon, authenticated;
grant all on public.drug_change_plans to service_role;

commit;