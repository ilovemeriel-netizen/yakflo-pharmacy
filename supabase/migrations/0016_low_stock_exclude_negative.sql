-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0016 재고부족 알림 한시 예외 (음수재고=실사대기) — 가역
-- 실행: Supabase Management API (또는 Dashboard SQL Editor). CREATE OR REPLACE(재실행 안전).
--
-- 배경: SACFN(현재고 −305, safety 107)이 app_low_stock 알림 1순위로 노출(deficit 412 과대).
--       음수 재고는 발주 대상이 아니라 '실사대기' 상태 → 발주 알림 목록에서만 한시 제외한다.
-- 범위(중요): app_low_stock(알림 목록)만 변경. app_dashboard.low_stock(집계 카운트)·
--             발주/집계 계산은 무변경 → 음수 재고는 집계·KPI에 그대로 보인다(왜곡 추적 가능).
-- 한시: 실사 보정으로 SACFN current_qty>=0 회복 시 이 예외는 자연 해소(특정 코드 하드코딩 없음).
--       영구화 불필요 시 아래 'and current_qty >= 0' 한 줄만 제거하면 0014 원형 복귀(롤백).
-- ════════════════════════════════════════════════════════════════

create or replace function public.app_low_stock(default_safety int default 10, max_rows int default 100)
returns table(drug_code text, drug_name text, category text, current_qty numeric, safety_stock numeric, deficit numeric)
language sql stable security invoker set search_path = public as $$
  select drug_code, drug_name, category,
         current_qty::numeric,
         coalesce(nullif(safety_stock, 0), default_safety)::numeric as safety_stock,
         (coalesce(nullif(safety_stock, 0), default_safety) - current_qty)::numeric as deficit
    from drugs
   where status = '사용'
     and current_qty >= 0   -- 임시(실사대기): 음수 재고는 발주 알림에서 제외. 실사 보정 후 이 줄 제거.
     and current_qty <= coalesce(nullif(safety_stock, 0), default_safety)
   order by (coalesce(nullif(safety_stock, 0), default_safety) - current_qty) desc, drug_name
   limit max_rows;
$$;

grant execute on function public.app_low_stock(int, int) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — 0014 원형으로 복귀 (음수 포함 전체 알림)
-- ----------------------------------------------------------------
-- create or replace function public.app_low_stock(default_safety int default 10, max_rows int default 100)
-- returns table(drug_code text, drug_name text, category text, current_qty numeric, safety_stock numeric, deficit numeric)
-- language sql stable security invoker set search_path = public as $$
--   select drug_code, drug_name, category, current_qty::numeric,
--          coalesce(nullif(safety_stock, 0), default_safety)::numeric,
--          (coalesce(nullif(safety_stock, 0), default_safety) - current_qty)::numeric
--     from drugs
--    where status = '사용'
--      and current_qty <= coalesce(nullif(safety_stock, 0), default_safety)
--    order by (coalesce(nullif(safety_stock, 0), default_safety) - current_qty) desc, drug_name
--    limit max_rows;
-- $$;
-- ════════════════════════════════════════════════════════════════