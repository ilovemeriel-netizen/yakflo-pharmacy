-- 0063_drug_lots_unique.sql
-- 목적: drug_lots 동일 LOT 중복 입력 방지.
--   · 판단: drugs UNIQUE가 (tenant_id, drug_code)라 drug_code는 tenant별로만 유일 →
--          LOT 유일성도 tenant_id를 포함해 (tenant_id, drug_code, lot_no)로 제약(멀티테넌시 안전).
--          tenant_id만으로 코드가 갈리므로, tenant 미포함 시 타 tenant 동일코드·동일LOT이 오탐 차단됨.
--   · 현재 drug_lots 0행이라 위반 데이터 없음.
--   · tenant_id는 trg_set_tenant_id(BEFORE INSERT)로 채워지므로 실무상 null 아님.

alter table public.drug_lots
  add constraint drug_lots_tenant_code_lot_key unique (tenant_id, drug_code, lot_no);

-- 롤백(참고): alter table public.drug_lots drop constraint if exists drug_lots_tenant_code_lot_key;