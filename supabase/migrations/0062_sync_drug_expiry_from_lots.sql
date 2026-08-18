-- 0062_sync_drug_expiry_from_lots.sql
-- 목적: drug_lots 변경 시 drugs.expiry_date를 '활성 LOT 중 최단 유효기한' 캐시로 자동 동기화(A안).
--   · 대상 (drug_code, tenant_id)의 활성 LOT(is_active=true, expiry_date IS NOT NULL) 중 MIN(expiry_date)을 반영.
--   · 활성 LOT 0건이면 drugs.expiry_date를 변경하지 않음(기존 값 유지 — null로 비우지 않음).
--   · UPDATE에서 drug_code/tenant_id가 바뀌면 이전(OLD)·이후(NEW) 양쪽 재계산.
--   · tenant 격리: (drug_code, tenant_id)로 스코프 — drugs UNIQUE(tenant_id, drug_code)와 정합.
--   · SECURITY DEFINER · search_path=public(기존 트리거 함수 관례: log_drugs_qty·set_tenant_id_from_user 동일).
--   · 무한재귀 없음: drugs만 UPDATE하고 drug_lots는 건드리지 않음. AFTER 트리거(return null).

create or replace function public.sync_drug_expiry_from_lots()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_min date;
begin
  -- INSERT/UPDATE: NEW 기준 재계산
  if tg_op in ('INSERT','UPDATE') then
    select min(expiry_date) into v_min from public.drug_lots
      where drug_code = new.drug_code
        and tenant_id is not distinct from new.tenant_id
        and is_active = true
        and expiry_date is not null;
    if v_min is not null then
      update public.drugs set expiry_date = v_min
        where drug_code = new.drug_code
          and tenant_id is not distinct from new.tenant_id
          and expiry_date is distinct from v_min;
    end if;
  end if;

  -- DELETE, 또는 UPDATE에서 drug_code/tenant_id 변경 시: OLD 기준도 재계산
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE'
         and (new.drug_code is distinct from old.drug_code
              or new.tenant_id is distinct from old.tenant_id)) then
    select min(expiry_date) into v_min from public.drug_lots
      where drug_code = old.drug_code
        and tenant_id is not distinct from old.tenant_id
        and is_active = true
        and expiry_date is not null;
    if v_min is not null then
      update public.drugs set expiry_date = v_min
        where drug_code = old.drug_code
          and tenant_id is not distinct from old.tenant_id
          and expiry_date is distinct from v_min;
    end if;
  end if;

  return null;
end $function$;

drop trigger if exists trg_sync_drug_expiry on public.drug_lots;
create trigger trg_sync_drug_expiry
  after insert or update or delete on public.drug_lots
  for each row execute function public.sync_drug_expiry_from_lots();

-- 롤백(참고): drop trigger if exists trg_sync_drug_expiry on public.drug_lots;
--            drop function if exists public.sync_drug_expiry_from_lots();