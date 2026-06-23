-- ════════════════════════════════════════════════════════════════
-- Yakflo · /app 대시보드·보고서 집계 RPC (DB측 집계, 클라 과다로드 회피)
-- 실행 위치: Supabase Management API (또는 Dashboard SQL Editor)
-- 안전 재실행 가능 (CREATE OR REPLACE)
--
-- ▶ 모두 SECURITY INVOKER + stable → 호출자(로그인 세션) 권한으로 실행되어
--   RLS(*_select_own_tenant)로 테넌트 격리. tenant_id 파라미터 불필요·교차테넌트 누출 없음.
-- ▶ 가산적: 신규 함수만 추가. 기존 테이블·정책·트리거 무수정.
-- ════════════════════════════════════════════════════════════════

-- 1) 대시보드 요약: KPI + 구분/상태 분포(JSON 단일 왕복)
--    default_safety: safety_stock 미적재(0) 시 부족 판정에 쓰는 상수 임계(클라 상수에서 전달)
--    expiry_days: 유효기간 임박 일수(예: 90)
create or replace function public.app_dashboard(default_safety int default 10, expiry_days int default 90)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'total',        (select count(*) from drugs),
    'active',       (select count(*) from drugs where status = '사용'),
    'dormant',      (select count(*) from drugs where status = '휴면'),
    'discontinued', (select count(*) from drugs where status = '중지'),
    'low_stock',    (select count(*) from drugs
                       where status = '사용'
                         and current_qty <= coalesce(nullif(safety_stock, 0), default_safety)),
    'expiring',     (select count(*) from drugs
                       where status <> '중지' and expiry_date is not null
                         and expiry_date <= current_date + expiry_days),
    'by_category',  (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc), '[]')
                       from (select coalesce(nullif(category, ''), '미분류') k, count(*) n
                               from drugs group by 1) c),
    'by_status',    (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc), '[]')
                       from (select coalesce(nullif(status, ''), '미지정') k, count(*) n
                               from drugs group by 1) s)
  );
$$;

-- 2) 재고부족 목록: 활성(사용) 약품 중 current_qty <= 유효 안전재고(없으면 상수). 부족분 큰 순.
create or replace function public.app_low_stock(default_safety int default 10, max_rows int default 100)
returns table(drug_code text, drug_name text, category text, current_qty numeric, safety_stock numeric, deficit numeric)
language sql stable security invoker set search_path = public as $$
  select drug_code, drug_name, category,
         current_qty::numeric,
         coalesce(nullif(safety_stock, 0), default_safety)::numeric as safety_stock,
         (coalesce(nullif(safety_stock, 0), default_safety) - current_qty)::numeric as deficit
    from drugs
   where status = '사용'
     and current_qty <= coalesce(nullif(safety_stock, 0), default_safety)
   order by (coalesce(nullif(safety_stock, 0), default_safety) - current_qty) desc, drug_name
   limit max_rows;
$$;

-- 3) 월마감 보고서: 연도별 월별 입고·사용·폐기·반품·기말 집계
create or replace function public.app_monthly_report(p_year int)
returns table(snap_month int, items bigint,
              in_qty numeric, in_amt numeric, out_qty numeric, out_amt numeric,
              disp_qty numeric, ret_qty numeric, closing_qty numeric, closing_amt numeric)
language sql stable security invoker set search_path = public as $$
  select snap_month, count(*),
         sum(total_in_qty), sum(total_in_amount),
         sum(total_out_qty), sum(total_out_amount),
         sum(total_disp_qty), sum(total_ret_qty),
         sum(closing_qty), sum(closing_amount)
    from monthly_snapshots
   where snap_year = p_year
   group by snap_month
   order by snap_month;
$$;

grant execute on function public.app_dashboard(int, int)       to anon, authenticated;
grant execute on function public.app_low_stock(int, int)       to anon, authenticated;
grant execute on function public.app_monthly_report(int)       to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- ----------------------------------------------------------------
-- drop function if exists public.app_dashboard(int, int);
-- drop function if exists public.app_low_stock(int, int);
-- drop function if exists public.app_monthly_report(int);
-- ════════════════════════════════════════════════════════════════