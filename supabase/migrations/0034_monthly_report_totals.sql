-- 0034_monthly_report_totals.sql
-- 월간보고서 결산 '정본'(엑셀 결재본) 총계 사이드카.
-- monthly_snapshots(약품별 스냅샷)와 별개의 '월 총계' 단위 테이블.
-- 기존 테이블(monthly_snapshots 등)은 일절 변경하지 않는다.
-- DELETE 정책은 만들지 않는다(결재본 불변 — 정정은 UPDATE로).

create table if not exists public.monthly_report_totals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id),
  snap_year      int  not null,
  snap_month     int  not null,
  opening_amount  numeric(20,4),   -- 전월재고 (정본 절대값)
  in_amount       numeric(20,4),   -- 입고
  out_amount      numeric(20,4),   -- 출고 (반품 별도)
  disposal_amount numeric(20,4),   -- 폐기
  return_amount   numeric(20,4),   -- 반품(출고성)
  calc_closing    numeric(20,4),   -- 계산현재고 = 전월+입고-출고-폐기-반품 (파생, 감사용)
  actual_closing  numeric(20,4),   -- 실제현재고 = 정본 기말재고 (절대값)
  audit_adjust    numeric(20,4),   -- 실사조정액 = 실제-계산 (정본 표값 그대로)
  reason_note    text,
  source         text,             -- '엑셀결재본' / '시스템'
  created_by     uuid default auth.uid(),
  created_at     timestamptz default now(),
  unique (tenant_id, snap_year, snap_month)
);

alter table public.monthly_report_totals enable row level security;

-- RLS: monthly_snapshots 패턴 그대로 (tenant 격리). DELETE 정책 없음.
create policy monthly_report_totals_select_own_tenant on public.monthly_report_totals
  for select using (tenant_id in (select current_tenant_ids()));

create policy monthly_report_totals_insert_own_tenant on public.monthly_report_totals
  for insert with check (tenant_id in (select current_tenant_ids()));

create policy monthly_report_totals_update_own_tenant on public.monthly_report_totals
  for update using (tenant_id in (select current_tenant_ids()))
            with check (tenant_id in (select current_tenant_ids()));

-- ── 정본 6행 적재 (cnc 테넌트, source='엑셀결재본') ──
-- 진짜 정본 = 결재본의 6개 절대값(전월재고·입고·출고·폐기·반품·기말재고). 문자열/numeric 리터럴로 삽입(JS Number 부동소수 미경유).
-- calc_closing = 전월+입고-출고-폐기-반품 (Postgres numeric 정확 연산).
-- audit_adjust = actual_closing - calc_closing (파생 정확값). → 전월표의 반올림 .68/.02 대신 정확값 저장.
insert into public.monthly_report_totals
  (tenant_id, snap_year, snap_month,
   opening_amount, in_amount, out_amount, disposal_amount, return_amount,
   calc_closing, actual_closing, audit_adjust, source)
select '5e0aa267-cf21-4227-af97-a27b32b04c07'::uuid, 2026, v.m,
       v.opening, v.inx, v.outx, v.disp, v.ret,
       (v.opening + v.inx - v.outx - v.disp - v.ret) as calc_closing,
       v.actual,
       (v.actual - (v.opening + v.inx - v.outx - v.disp - v.ret)) as audit_adjust,
       '엑셀결재본'
from (values
  (1, 154936671::numeric, 51211064::numeric, 47478010.168::numeric, 1110805.5::numeric,       0::numeric, 155101115.782::numeric),
  (2, 155101115.782,      30824672,          34985850.274,          161791,                21384,        149997617.234),
  (3, 149997617.234,      29465221,          33194044.133,          1403402.5,             283881,       129432153.934),
  (4, 129432154,          31542984,          30115498.5698,         1418892,               8282704,      124104133.9302),
  (5, 124104134,          22557422,          30242670.6268,         2812331.5,             1770253,      113063587.5534),
  (6, 113063588,          25755415,          29371088,              821850,                1291080,      107354133.0212)
) as v(m, opening, inx, outx, disp, ret, actual);

-- ── API 역할 권한(GRANT) — PostgREST가 RLS 이전에 테이블 권한을 검사하므로 필수 ──
-- pg 직결로 CREATE 시 Supabase 역할에 권한이 자동 부여되지 않아 별도 GRANT 필요.
-- anon/authenticated: SELECT/INSERT/UPDATE만(결재본 불변 — DELETE 미부여, RLS에도 DELETE 정책 없음).
grant select, insert, update on public.monthly_report_totals to anon, authenticated;
grant all on public.monthly_report_totals to service_role;