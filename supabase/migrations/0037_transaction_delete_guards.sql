-- 0037: 거래 삭제 기능 — RLS DELETE 정책 + 역보정 트리거 가드 + 마감월 삭제 차단
--
-- 배경:
--   trg_revert_tx_from_inventory(AFTER DELETE)가 이미 존재해 INSERT의 역방향으로 재고를 복원한다.
--   그러나 (1) RLS DELETE 정책이 없어 삭제가 조용히 0행 처리되고,
--          (2) revert 트리거에 재고 음수 방지·inventory_stock 부재 분기가 없으며,
--          (3) 마감월 삭제 차단 가드가 없다.
--   본 마이그레이션은 이 세 가지를 보강한다. 기존 역보정 계산식은 변경하지 않는다(가드만 가산).
--
-- 재적용 안전: drop policy if exists / create or replace function / drop trigger if exists.

begin;

-- ── 1) RLS DELETE 정책 (owner·admin 전용, 기존 drugs_delete_admin_own_tenant 패턴) ──
drop policy if exists transactions_delete_admin_own_tenant on public.transactions;
create policy transactions_delete_admin_own_tenant on public.transactions
  for delete
  using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = transactions.tenant_id
        and tm.role in ('owner', 'admin')
    )
  );

-- ── 2) revert_tx_from_inventory 보강 (계산식 불변, 가드만 가산) ──
--   · 재고 음수 방지: 복원 delta < 0(입고 삭제 등)일 때 current_qty + delta < 0 이면 RAISE
--     errcode 는 INSERT 트리거(apply_tx_to_inventory)와 동일하게 check_violation.
--   · inventory_stock 행 부재 시 INSERT 트리거와 동일한 if not found 분기 추가.
create or replace function public.revert_tx_from_inventory()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  delta numeric;
  cur   numeric;
begin
  delta := case old.type
    when '입고' then -old.quantity
    when '출고' then  old.quantity
    when '폐기' then  old.quantity
    when '반품' then  old.quantity
    when '조정' then -old.quantity
    else 0 end;

  if delta <> 0 then
    -- 가드: 복원으로 재고가 음수가 되는 경우(입고 삭제 등) 차단
    if delta < 0 then
      select current_qty into cur from public.inventory_stock
        where drug_code = old.drug_code and tenant_id = old.tenant_id;
      if coalesce(cur, 0) + delta < 0 then
        raise exception '재고 부족: % (현재고 %, 복원차감 %)', old.drug_code, coalesce(cur, 0), -delta
          using errcode = 'check_violation';
      end if;
    end if;

    update public.inventory_stock
       set current_qty = coalesce(current_qty, 0) + delta, updated_at = now()
     where drug_code = old.drug_code and tenant_id = old.tenant_id;
    if not found then
      insert into public.inventory_stock (drug_code, current_qty, tenant_id, drug_name)
      values (old.drug_code, greatest(delta, 0), old.tenant_id,
              (select drug_name from public.drugs where drug_code = old.drug_code and tenant_id = old.tenant_id limit 1));
    end if;

    update public.drugs
       set current_qty = coalesce(current_qty, 0) + delta
     where drug_code = old.drug_code and tenant_id = old.tenant_id;
  end if;
  return old;
end
$function$;

-- ── 3) 마감월 삭제 차단 (BEFORE DELETE) ──
--   판정 기준은 transaction_date(created_at 아님), tenant_id 일치 스냅샷만 대상.
create or replace function public.block_delete_closed_month()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = old.tenant_id
      and ms.snap_year  = extract(year  from old.transaction_date)::int
      and ms.snap_month = extract(month from old.transaction_date)::int
  ) then
    raise exception '마감된 월(%)의 거래는 삭제할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(old.transaction_date, 'YYYY-MM')
      using errcode = 'check_violation';
  end if;
  return old;
end
$function$;

drop trigger if exists trg_block_delete_closed_month on public.transactions;
create trigger trg_block_delete_closed_month
  before delete on public.transactions
  for each row execute function block_delete_closed_month();

commit;