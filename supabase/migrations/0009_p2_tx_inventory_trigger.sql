-- ════════════════════════════════════════════════════════════════
-- Yakflo · P2-4a — 거래→재고 원자적 갱신 트리거 + 상태 명시 정렬
-- 실행 위치: Supabase Dashboard → SQL Editor (또는 Management API)
-- 안전 재실행 가능 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS)
--
-- 근거: 통합구현가이드 §3(단일 기록 관문)·DATA_UI_CONTRACT.md §6
-- 가산적: 기존 데이터 무수정. transactions 0건이라 첫 실쓰기 기반.
-- ════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────
-- 1) (Task3) 상태 명시 정렬 — 사용<휴면<중지를 collation 우연이 아닌 CASE로 고정
-- ────────────────────────────────────────────────────────────────
alter table public.drugs
  add column if not exists status_sort integer
  generated always as (case status when '사용' then 1 when '휴면' then 2 when '중지' then 3 else 9 end) stored;

-- ────────────────────────────────────────────────────────────────
-- 2) 거래 적용 함수 — type별 증감을 inventory_stock·drugs.current_qty에 원자 반영
--    입고 + / 출고 − / 폐기 − / 반품 −(공급처 반품 = 재고 차감)
--    음수 재고 차단: delta<0 일 때 현재고 부족이면 예외(거래 INSERT 전체 롤백).
--    ★ 단일 정본: inventory_stock·drugs.current_qty는 '이 트리거만' 갱신한다.
--      프론트/다른 경로에서 current_qty를 직접 수정 금지(거래로만 변동).
--    SECURITY DEFINER: 트리거가 재고 행을 일관 갱신(같은 tenant 한정)
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_tx_to_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  delta integer;
  cur   integer;
begin
  delta := case new.type
    when '입고' then  new.quantity
    when '출고' then -new.quantity
    when '폐기' then -new.quantity
    when '반품' then -new.quantity
    else 0 end;

  -- 음수 재고 차단 (출고·폐기·반품)
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

    -- 마스터(목록 표시)도 동기 유지
    update public.drugs
       set current_qty = coalesce(current_qty, 0) + delta
     where drug_code = new.drug_code and tenant_id = new.tenant_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_apply_tx_to_inventory on public.transactions;
create trigger trg_apply_tx_to_inventory
  after insert on public.transactions
  for each row execute function public.apply_tx_to_inventory();

commit;

-- ════════════════════════════════════════════════════════════════
-- 검증 (commit 후)
-- ────────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns where table_name='drugs' and column_name='status_sort';
-- select tgname from pg_trigger where tgname='trg_apply_tx_to_inventory';
--
-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- ────────────────────────────────────────────────────────────────
-- drop trigger if exists trg_apply_tx_to_inventory on public.transactions;
-- drop function if exists public.apply_tx_to_inventory();
-- alter table public.drugs drop column if exists status_sort;
-- ════════════════════════════════════════════════════════════════