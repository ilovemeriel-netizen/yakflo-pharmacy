-- 0043_suppliers_lead_time.sql
-- 목적: 도매사(suppliers)별 리드타임(입고 소요일) 컬럼 신설.
--   · 현재 리드타임은 order_params(테넌트 전역) 1개 → 도매사별 관리를 위해 suppliers에 컬럼 추가.
--   · 기본값 3(데이터 부재 시 3일 적용). 음수 방지 CHECK.
--   · tenant_id 기반 기존 RLS 정책(suppliers_sel/ins/upd/del)은 컬럼 무관하게 그대로 적용됨
--     → 신규 컬럼도 동일 테넌트 격리(별도 정책 변경 불필요).
--   · order_params(전역 리드타임)는 건드리지 않는다.

alter table public.suppliers
  add column if not exists lead_time_days integer not null default 3;

-- 리드타임 음수 방지(멱등)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suppliers_lead_time_days_nonneg'
  ) then
    alter table public.suppliers
      add constraint suppliers_lead_time_days_nonneg check (lead_time_days >= 0);
  end if;
end $$;

comment on column public.suppliers.lead_time_days is '도매사별 리드타임(일). 기본 3. 발주점=안전재고+리드타임×일평균 산출용(향후).';

-- 롤백(참고, 실행 안 함):
-- alter table public.suppliers drop constraint if exists suppliers_lead_time_days_nonneg;
-- alter table public.suppliers drop column if exists lead_time_days;