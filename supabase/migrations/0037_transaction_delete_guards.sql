-- 0037: 거래 삭제 기능 + 마감월 가드(입력·삭제 양방향)
--
-- 배경:
--   trg_revert_tx_from_inventory(AFTER DELETE)가 이미 존재해 INSERT의 역방향으로 재고를 복원한다.
--   그러나 (1) RLS DELETE 정책이 없어 삭제가 조용히 0행 처리되고,
--          (2) revert 트리거에 재고 음수 방지·inventory_stock 부재 분기가 없으며,
--          (3) 마감월 가드가 삭제·입력 양쪽 모두 없다(마감 후 소급 삭제/입력 시 결산 붕괴).
--   본 마이그레이션은 이 셋을 보강한다. 기존 역보정 계산식은 변경하지 않는다(가드만 가산).
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

-- ── 2) revert_tx_from_inventory 보강 (역보정 계산식 불변, 가드만 가산) ──
--   · 재고 음수 방지: 복원 delta < 0(입고 삭제 등)일 때 current_qty + delta < 0 이면 RAISE
--     (INSERT 트리거와 동일한 '재고 부족' 메시지 · errcode check_violation)
--   · inventory_stock 행 부재 시 INSERT 트리거와 동일한 if not found 분기
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

-- ── 3) 마감월 가드 (입력·삭제 공용 함수 + 트리거 2개) ──
--   판정 기준은 transaction_date(≠created_at), tenant_id 일치 스냅샷만 대상.
create or replace function public.guard_closed_month_tx()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d   date;
  tid uuid;
begin
  if tg_op = 'DELETE' then
    d := old.transaction_date; tid := old.tenant_id;
  else
    d := new.transaction_date; tid := new.tenant_id;   -- INSERT: set_tenant_id 뒤 실행되어 tid 채워짐
  end if;

  if exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = tid
      and ms.snap_year  = extract(year  from d)::int
      and ms.snap_month = extract(month from d)::int
  ) then
    raise exception '마감된 월(%)의 거래는 수정할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(d, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$function$;

-- 기존 단독 DELETE 가드(0037 초판) 정리 후 공용 함수로 재구성
drop trigger if exists trg_block_delete_closed_month on public.transactions;
drop function if exists public.block_delete_closed_month();

-- 삭제 가드 (old.tenant_id 항상 존재 → 순서 무관)
create trigger trg_block_delete_closed_month
  before delete on public.transactions
  for each row execute function public.guard_closed_month_tx();

-- 입력 가드 (trg_zz_ 접두로 trg_set_tenant_id 보다 뒤에 실행 → new.tenant_id 채워진 뒤 판정)
drop trigger if exists trg_zz_block_insert_closed_month on public.transactions;
create trigger trg_zz_block_insert_closed_month
  before insert on public.transactions
  for each row execute function public.guard_closed_month_tx();

commit;