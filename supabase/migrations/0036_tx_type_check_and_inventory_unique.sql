-- 0036: 거래 정합성 제약 정비 (폐기·반품 실사용 개시 전 선제 적용)
--
-- 1) transactions.type CHECK 추가
--    - type에 제약이 없어 오타 입력 시 트리거(apply_tx_to_inventory)가 재고를 갱신하지 않고
--      집계에서도 누락되는 '조용한 실패'가 가능했다.
--    - 허용값은 코드 상수(TYPES=['입고','출고','반품','폐기']) + 재고 보정의 '조정' 5종.
--    - 트리거의 case 분기(입고/출고/폐기/반품/조정)와 정확히 일치한다.
--
-- 2) inventory_stock UNIQUE 를 drug_code 단독 → (tenant_id, drug_code) 복합으로 전환
--    - 멀티테넌트에서 다른 병원이 같은 약품코드를 쓰면 단독 UNIQUE가 충돌한다.
--    - 트리거는 inventory_stock 을 (drug_code, tenant_id) 로 조회·갱신·insert 하므로
--      복합 전환 후에도 정상 동작한다.
--    - 무제약 구간이 생기지 않도록 신규 복합 UNIQUE 를 먼저 만든 뒤 기존 단독을 제거한다.
--
-- 재적용 안전(idempotent): drop if exists / 존재 확인 후 add. 단일 트랜잭션.

begin;

-- 1) transactions.type CHECK (허용값 5종)
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('입고', '출고', '반품', '폐기', '조정'));

-- 2) inventory_stock UNIQUE: 복합 신설 → 단독 제거 (이 순서로 무제약 구간 없음)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_stock_tenant_drug_key'
      and conrelid = 'public.inventory_stock'::regclass
  ) then
    alter table public.inventory_stock
      add constraint inventory_stock_tenant_drug_key unique (tenant_id, drug_code);
  end if;
end $$;

alter table public.inventory_stock drop constraint if exists inventory_stock_drug_code_key;

commit;