-- 0044_usage_source_and_recompute.sql
-- 목적: 사용량 이중 소스(B 수기/업로드 · A transactions 자동집계) 공존 인프라.
--   1) drugs.usage_source: 사용량/안전재고 산출 출처 플래그 ('manual' | 'auto' | NULL=미설정).
--   2) app_recompute_usage RPC: transactions 출고를 집계해 사용량·안전재고 컬럼을 채운다(서버측).
--      · SECURITY INVOKER(기본) + RLS 경유 → 호출자 본인 테넌트만 집계·갱신(기존 RPC와 동일 규약).
--      · p_overwrite_manual=false(기본): usage_source='manual'(수기 오버라이드) 행은 보존(건너뜀).
--      · 출고 0건이면 갱신 0행(graceful). 0나눗셈/NULL 가드.
-- ※ 기존 데이터 손상 없음(컬럼 추가·CREATE OR REPLACE). order_params·재고상태 판정 무관.

-- (1) 소스 플래그 컬럼
alter table public.drugs
  add column if not exists usage_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drugs_usage_source_chk') then
    alter table public.drugs
      add constraint drugs_usage_source_chk
      check (usage_source is null or usage_source in ('manual','auto'));
  end if;
end $$;

comment on column public.drugs.usage_source is '사용량/안전재고 산출 출처: manual(수기·업로드) | auto(transactions 자동집계) | NULL(미설정).';

-- (2) transactions 출고 → 사용량 자동집계 및 안전재고 파생 (서버측, 본인 테넌트만)
--   prev_year_usage = 최근 12개월 출고 합, recent_3m_usage = 최근 3개월 출고 합.
--   monthly_avg = recent_3m/3 (없으면 prev_year/12), safety=avg×1.5, max=avg×3.
--   p_overwrite_manual=false: 수기(manual) 행 보존.
create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  with agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select drug_code,
      coalesce(py, 0) as py,
      coalesce(r3, 0) as r3,
      case when coalesce(r3,0) > 0 then round(coalesce(r3,0) / 3.0)
           when coalesce(py,0) > 0 then round(coalesce(py,0) / 12.0)
           else null end as mavg
    from agg
  )
  update public.drugs d set
    prev_year_usage = c.py,
    recent_3m_usage = c.r3,
    monthly_avg  = coalesce(c.mavg, d.monthly_avg),
    safety_stock = case when c.mavg is not null then round(c.mavg * 1.5) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- 롤백(참고, 실행 안 함):
-- drop function if exists public.app_recompute_usage(boolean);
-- alter table public.drugs drop constraint if exists drugs_usage_source_chk;
-- alter table public.drugs drop column if exists usage_source;