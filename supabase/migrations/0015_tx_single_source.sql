-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0015 거래→재고 단일기록 일원화 (가역)
-- 실행: Supabase Management API (DDL). 안전 재실행 가능(CREATE OR REPLACE / IF EXISTS).
--
-- 변경:
--  (a) drugs.current_qty integer→numeric (inventory는 0013로 이미 numeric, 미러 정합)
--  (b) apply_tx_to_inventory(): 지역변수 cur/delta numeric, type '조정'(부호있는 차이) 처리,
--      음수 재고는 RAISE로 명시 차단(무음절삭 금지)
--  (c) AFTER DELETE 트리거: 거래 삭제 시 drugs+inventory 양 테이블 역보정
--  ★ 재고 변경은 transactions·트리거 경유만. 클라이언트 직접 current_qty update 금지(레거시 수정 동반).
-- ════════════════════════════════════════════════════════════════

-- (a) drugs.current_qty numeric (가산·비파괴) + transactions.quantity numeric(소수 조정/이동 지원)
alter table public.drugs alter column current_qty type numeric;
alter table public.transactions alter column quantity type numeric;

-- (b) 거래 적용 함수 — numeric·'조정'·음수 RAISE
create or replace function public.apply_tx_to_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  delta numeric;
  cur   numeric;
begin
  delta := case new.type
    when '입고' then  new.quantity
    when '출고' then -new.quantity
    when '폐기' then -new.quantity
    when '반품' then -new.quantity
    when '조정' then  new.quantity   -- 조정: quantity = 목표 − 현재(부호있는 차이)
    else 0 end;

  if delta < 0 then
    select current_qty into cur from public.inventory_stock
      where drug_code = new.drug_code and tenant_id = new.tenant_id;
    if coalesce(cur, 0) + delta < 0 then
      raise exception '재고 부족: % (현재고 %, 차감요청 %)', new.drug_code, coalesce(cur, 0), -delta
        using errcode = 'check_violation';
    end if;
  end if;

  if delta <> 0 then
    update public.inventory_stock
       set current_qty = coalesce(current_qty, 0) + delta, updated_at = now()
     where drug_code = new.drug_code and tenant_id = new.tenant_id;
    if not found then
      insert into public.inventory_stock (drug_code, current_qty, tenant_id, drug_name)
      values (new.drug_code, greatest(delta, 0), new.tenant_id,
              (select drug_name from public.drugs where drug_code = new.drug_code and tenant_id = new.tenant_id limit 1));
    end if;
    update public.drugs
       set current_qty = coalesce(current_qty, 0) + delta
     where drug_code = new.drug_code and tenant_id = new.tenant_id;
  end if;
  return new;
end $$;

-- (c) 거래 삭제 시 역보정
create or replace function public.revert_tx_from_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare delta numeric;
begin
  delta := case old.type
    when '입고' then -old.quantity
    when '출고' then  old.quantity
    when '폐기' then  old.quantity
    when '반품' then  old.quantity
    when '조정' then -old.quantity
    else 0 end;
  if delta <> 0 then
    update public.inventory_stock set current_qty = coalesce(current_qty, 0) + delta, updated_at = now()
      where drug_code = old.drug_code and tenant_id = old.tenant_id;
    update public.drugs set current_qty = coalesce(current_qty, 0) + delta
      where drug_code = old.drug_code and tenant_id = old.tenant_id;
  end if;
  return old;
end $$;

drop trigger if exists trg_revert_tx_from_inventory on public.transactions;
create trigger trg_revert_tx_from_inventory
  after delete on public.transactions
  for each row execute function public.revert_tx_from_inventory();

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- ----------------------------------------------------------------
-- drop trigger if exists trg_revert_tx_from_inventory on public.transactions;
-- drop function if exists public.revert_tx_from_inventory();
-- -- apply_tx_to_inventory()를 0009 원본(integer cur/delta, '조정' 미처리)으로 create or replace 복원
-- alter table public.drugs alter column current_qty type integer using round(current_qty)::int;  -- ⚠ 소수 절삭
-- alter table public.transactions alter column quantity type integer using round(quantity)::int;  -- ⚠ 소수 절삭
-- ════════════════════════════════════════════════════════════════