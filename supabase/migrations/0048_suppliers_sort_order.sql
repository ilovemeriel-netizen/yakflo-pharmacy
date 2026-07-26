-- 0048_suppliers_sort_order.sql
-- 목적: 도매사 표시 순위(sort_order) — 주거래처를 상단으로 정렬. 발주 로직엔 무영향(표시 순서만).
--   1) suppliers.sort_order integer 추가(nullable).
--   2) 기존 도매사에 name순으로 초기 순위(1..N) 부여(테넌트별). 재실행 안전(sort_order is null 만).
-- ※ 기존 데이터 손상 없음(컬럼 추가·조건부 UPDATE). RLS/tenant·발주 산출 무관.

alter table public.suppliers
  add column if not exists sort_order integer;

comment on column public.suppliers.sort_order is '도매사 표시 순위(오름차순, 주거래처 상단). 발주 로직엔 무영향(표시 순서만).';

update public.suppliers s set sort_order = sub.rn
  from (
    select id, row_number() over (partition by tenant_id order by name, created_at, id) as rn
    from public.suppliers
  ) sub
  where s.id = sub.id and s.sort_order is null;

-- 롤백(참고, 실행 안 함):
-- alter table public.suppliers drop column if exists sort_order;