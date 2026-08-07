-- 0059_tenant_id_not_null.sql
-- 운영 4개 테이블 tenant_id NOT NULL 적용 (NULL 0건 실측 확인 후). trg_set_tenant_id가 INSERT 시 자동 충전.
-- monthly_report_totals는 트리거 미부착이라 이번 대상에서 제외(별도 판단).
alter table public.drugs             alter column tenant_id set not null;
alter table public.transactions      alter column tenant_id set not null;
alter table public.inventory_stock   alter column tenant_id set not null;
alter table public.monthly_snapshots alter column tenant_id set not null;
