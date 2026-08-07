-- 0055_guard_drugs_qty_direct.sql
-- 목적: drugs.current_qty 직접 UPDATE 차단 — 재고는 거래(apply_tx/revert_tx) 경유로만 변경.
--   · apply_tx_to_inventory / revert_tx_from_inventory 가 drugs.current_qty 갱신 직전 세션 플래그
--     app.qty_via_tx='on' 을 세우고, 갱신 직후 'off' 로 되돌린다(트랜잭션-로컬).
--   · 가드 트리거 guard_drugs_qty_direct(BEFORE UPDATE)는 current_qty 변경 시 플래그가 'on' 이
--     아니면 예외. INSERT 는 차단하지 않음(신규 약품 current_qty=0 등록 허용).
--   · ★ 선행 조건: 프론트의 모든 current_qty 직접쓰기 경로(엑셀 대량등록·약품 등록 폼)를
--     조정거래 경유로 전환한 뒤 적용할 것(전환 전 적용 시 해당 기능이 차단됨).
--   · dryrun 필수(트랜잭션 내 검증 후 ROLLBACK) — 본 파일은 apply 미실행.

-- 1) apply_tx_to_inventory — drugs 갱신 전후로 플래그 설정(기존 로직 불변, set_config 2줄만 추가)
create or replace function public.apply_tx_to_inventory()
returns trigger language plpgsql security definer set search_path = 'public' as $function$
declare delta numeric; cur numeric;
begin
  delta := case new.type
    when '입고' then  new.quantity when '출고' then -new.quantity
    when '폐기' then -new.quantity when '반품' then -new.quantity
    when '조정' then  new.quantity else 0 end;
  if delta < 0 then
    select current_qty into cur from public.inventory_stock
      where drug_code = new.drug_code and tenant_id = new.tenant_id;
    if coalesce(cur,0)+delta < 0 then
      raise exception '재고 부족: % (현재고 %, 차감요청 %)', new.drug_code, coalesce(cur,0), -delta using errcode='check_violation';
    end if;
  end if;
  if delta <> 0 then
    update public.inventory_stock set current_qty = coalesce(current_qty,0)+delta, updated_at = now()
      where drug_code = new.drug_code and tenant_id = new.tenant_id;
    if not found then
      insert into public.inventory_stock (drug_code, current_qty, tenant_id, drug_name)
      values (new.drug_code, greatest(delta,0), new.tenant_id,
              (select drug_name from public.drugs where drug_code = new.drug_code and tenant_id = new.tenant_id limit 1));
    end if;
    perform set_config('app.qty_via_tx','on',true);
    update public.drugs set current_qty = coalesce(current_qty,0)+delta
      where drug_code = new.drug_code and tenant_id = new.tenant_id;
    perform set_config('app.qty_via_tx','off',true);
  end if;
  return new;
end $function$;

-- 2) revert_tx_from_inventory — 동일하게 drugs 갱신 전후 플래그 설정
create or replace function public.revert_tx_from_inventory()
returns trigger language plpgsql security definer set search_path = 'public' as $function$
declare delta numeric; cur numeric;
begin
  delta := case old.type
    when '입고' then -old.quantity when '출고' then  old.quantity
    when '폐기' then  old.quantity when '반품' then  old.quantity
    when '조정' then -old.quantity else 0 end;
  if delta <> 0 then
    if delta < 0 then
      select current_qty into cur from public.inventory_stock
        where drug_code = old.drug_code and tenant_id = old.tenant_id;
      if coalesce(cur,0)+delta < 0 then
        raise exception '재고 부족: % (현재고 %, 복원차감 %)', old.drug_code, coalesce(cur,0), -delta using errcode='check_violation';
      end if;
    end if;
    update public.inventory_stock set current_qty = coalesce(current_qty,0)+delta, updated_at = now()
      where drug_code = old.drug_code and tenant_id = old.tenant_id;
    if not found then
      insert into public.inventory_stock (drug_code, current_qty, tenant_id, drug_name)
      values (old.drug_code, greatest(delta,0), old.tenant_id,
              (select drug_name from public.drugs where drug_code = old.drug_code and tenant_id = old.tenant_id limit 1));
    end if;
    perform set_config('app.qty_via_tx','on',true);
    update public.drugs set current_qty = coalesce(current_qty,0)+delta
      where drug_code = old.drug_code and tenant_id = old.tenant_id;
    perform set_config('app.qty_via_tx','off',true);
  end if;
  return old;
end $function$;

-- 3) 가드 트리거 — current_qty 직접변경(플래그 없음) 차단
create or replace function public.guard_drugs_qty_direct()
returns trigger language plpgsql as $function$
begin
  if new.current_qty is distinct from old.current_qty
     and coalesce(current_setting('app.qty_via_tx', true), 'off') <> 'on' then
    raise exception 'drugs.current_qty 직접 수정 차단 — 재고는 거래(입출고/조정)로만 변경하세요 (drug_code=%, % → %)',
      new.drug_code, old.current_qty, new.current_qty using errcode = 'check_violation';
  end if;
  return new;
end $function$;

drop trigger if exists trg_guard_drugs_qty_direct on public.drugs;
create trigger trg_guard_drugs_qty_direct
  before update on public.drugs
  for each row execute function public.guard_drugs_qty_direct();

-- 롤백(참고): drop trigger if exists trg_guard_drugs_qty_direct on public.drugs;
--            그리고 0015 정의로 apply_tx_to_inventory/revert_tx_from_inventory 복원.