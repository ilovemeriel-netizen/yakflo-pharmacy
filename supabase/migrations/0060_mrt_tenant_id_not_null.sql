-- 0060_mrt_tenant_id_not_null.sql
-- monthly_report_totals(정본): 다른 4테이블과 동일하게 trg_set_tenant_id(set_tenant_id_from_user) 부착 + tenant_id NOT NULL.
-- NULL 0건 실측 확인 후. 구조 변경만(데이터 값 무변경).
drop trigger if exists trg_set_tenant_id on public.monthly_report_totals;
create trigger trg_set_tenant_id before insert on public.monthly_report_totals
  for each row execute function public.set_tenant_id_from_user();
alter table public.monthly_report_totals alter column tenant_id set not null;
