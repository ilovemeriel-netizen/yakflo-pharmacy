-- 0072_drug_status_audit.sql
-- 목적: drugs.status 변경 감사 — 상태 변경 이력 테이블 + AFTER UPDATE OF status 트리거.
--   · drug_status_audit: status 가 실제로 바뀔 때만(OLD<>NEW, NULL↔값 포함) 1행 기록.
--   · 동일 값 UPDATE·다른 컬럼 UPDATE 는 미기록(트리거 OF status + is distinct from 이중 가드).
--   · ★ 소급 적재 없음(적용 시점부터만). 대시보드 「이달 중지·사용 복귀」 목록 원천.
--   · 규약: drug_change_plans(0038) RLS/GRANT 4정책 + drug_qty_audit(0056) SECURITY DEFINER 트리거.
--   · dryrun(BEGIN → 생성 → 검증 A~G → 전량 ROLLBACK) 통과 후 apply.

begin;

-- 1) 상태 변경 이력 테이블
create table if not exists public.drug_status_audit (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  drug_code   text not null,
  old_status  text,
  new_status  text,
  changed_at  timestamptz not null default now(),
  changed_by  uuid default auth.uid()
);

-- 2) 인덱스
create index if not exists idx_drug_status_audit_tenant_changed on public.drug_status_audit(tenant_id, changed_at desc);
create index if not exists idx_drug_status_audit_tenant_code    on public.drug_status_audit(tenant_id, drug_code);

-- 3) tenant_id 자동 세팅(클라/수동 insert 대비 — 기존 set_tenant_id_from_user 재사용, NULL일 때만 충전)
drop trigger if exists trg_set_tenant_id on public.drug_status_audit;
create trigger trg_set_tenant_id
  before insert on public.drug_status_audit
  for each row execute function public.set_tenant_id_from_user();

-- 4) RLS(drug_change_plans 패턴: SELECT/INSERT/UPDATE 자기 테넌트 + DELETE owner·admin)
alter table public.drug_status_audit enable row level security;

drop policy if exists drug_status_audit_select_own_tenant on public.drug_status_audit;
create policy drug_status_audit_select_own_tenant on public.drug_status_audit
  for select using (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_status_audit_insert_own_tenant on public.drug_status_audit;
create policy drug_status_audit_insert_own_tenant on public.drug_status_audit
  for insert with check (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_status_audit_update_own_tenant on public.drug_status_audit;
create policy drug_status_audit_update_own_tenant on public.drug_status_audit
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_status_audit_delete_admin_own_tenant on public.drug_status_audit;
create policy drug_status_audit_delete_admin_own_tenant on public.drug_status_audit
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = drug_status_audit.tenant_id
        and tm.role in ('owner', 'admin')
    )
  );

-- ⚠ GRANT(42501 재발 방지 — 0038 이력)
grant select, insert, update, delete on public.drug_status_audit to anon, authenticated;
grant all on public.drug_status_audit to service_role;

-- 5) 상태 변경 로깅 트리거(AFTER UPDATE OF status — status 미포함 UPDATE 는 발화 자체 안 함)
create or replace function public.log_drugs_status()
returns trigger language plpgsql security definer set search_path = 'public' as $function$
begin
  if new.status is distinct from old.status then
    insert into public.drug_status_audit(tenant_id, drug_code, old_status, new_status, changed_by)
    values (new.tenant_id, new.drug_code, old.status, new.status, auth.uid());
  end if;
  return new;
end $function$;

drop trigger if exists trg_log_drugs_status on public.drugs;
create trigger trg_log_drugs_status
  after update of status on public.drugs
  for each row execute function public.log_drugs_status();

commit;

-- 롤백(참고):
-- drop trigger if exists trg_log_drugs_status on public.drugs;
-- drop function if exists public.log_drugs_status();
-- drop table if exists public.drug_status_audit;
