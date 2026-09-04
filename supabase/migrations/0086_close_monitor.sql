-- =============================================================================
-- 0086_close_monitor.sql
-- 약플로 월마감 무결성 모니터링 (검증 16종)
--
-- 목적
--   1) 마감 데이터 무결성 검증 (스냅샷 · 재고 이중화 · 마약향정)
--   2) 향후 마감에 영향을 주는 이상 징후 탐지 (데이터 불일치 · 성능 저하)
--   3) 이상 징후를 close_monitor_alerts 에 적재 (= 로그 기록)
--   4) 미확인 CRITICAL/HIGH 알림을 Edge Function 이 조회해 관리자에게 통지
--
-- 원칙
--   * 이 마이그레이션은 읽기 전용 진단만 수행한다. 운영 데이터를 변경하지 않는다.
--     쓰기는 close_monitor_alerts (자체 테이블) 에만 발생한다.
--   * 인증 정보는 어디에도 하드코딩하지 않는다. Edge Function 이 환경변수에서 읽는다.
--   * RLS 로 tenant 격리. 알림 조회는 authenticated, 생성은 service_role 만.
--
-- ★★ 운영 방침 (2026-09 확정): 약플로 = 실재고 정본, 결재 파일 = 공식 장부.
--    실사 조정은 결재 파일에 반영하지 않으므로 두 계통의 금액은 구조적으로 다르다.
--    이 격차는 오류가 아니라 설계된 상태다. 해소를 위한 소급 작업을 하지 말 것.
--    → C15 LEDGER_DIVERGENCE 는 이 격차를 **추적**할 뿐 오류로 알리지 않는다(INFO · 통지 제외).
--
-- ★ 실제 스키마 대조 완료 (Stage 0). 코드가 가정했던 컬럼명을 아래로 정정했다.
--    transactions.tx_date        → transaction_date
--    transactions.tx_type        → type            (값: 입고·출고·조정·폐기·반품 5종)
--    monthly_snapshots.period    → snap_year int + snap_month int
--    monthly_snapshots.created_at→ 없음. 마감 시각은 monthly_report_totals.created_at 사용
--    monthly_report_totals.period/closing_amount → snap_year+snap_month / actual_closing
--    drugs.is_narcotic           → 존재 확인(true 29건 = narcotic_type 향정22+마약7)
--
-- ★ 롤포워드 검사(구 ROLLFORWARD_DIFF)는 폐기했다. 이 스키마에서 성립하지 않는다 —
--    closing_qty 는 마감 시점 drugs.current_qty 스냅샷이고, 스냅샷에 조정 컬럼이 없다.
--    실측: 구 식으로 2026-07 369건 · 2026-08 61건이 편차로 잡혀 검사로 기능하지 못했다.
--    대신 SNAPSHOT_CHAIN_BREAK(기초 연결) · STOCK_FLOW_DIFF(거래로 설명되는가) 2종을 둔다.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 알림 저장소
-- -----------------------------------------------------------------------------
create table if not exists public.close_monitor_alerts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  period        text not null,                       -- 'YYYY-MM' (표시용. 판정은 year/month 로 한다)
  check_code    text not null,
  severity      text not null
                check (severity in ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  category      text not null
                check (category in ('무결성','정합성','성능','운영')),
  drug_code     text,
  drug_name     text,
  title         text not null,
  detail        jsonb not null default '{}'::jsonb,
  metric_value  numeric,
  threshold     numeric,
  run_id        uuid not null,
  detected_at   timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  notified_at   timestamptz
);

comment on table  public.close_monitor_alerts is '월마감 모니터링 이상 징후 로그';
comment on column public.close_monitor_alerts.detail      is '판정 근거 수치 원본 (감사 추적용)';
comment on column public.close_monitor_alerts.notified_at is 'NULL 이면 미통지 → Edge Function 이 대상으로 집어감. INFO 는 애초에 조회되지 않는다';

create index if not exists idx_cma_tenant_period
  on public.close_monitor_alerts (tenant_id, period desc, severity);
create index if not exists idx_cma_pending
  on public.close_monitor_alerts (tenant_id, detected_at desc)
  where notified_at is null and acknowledged_at is null;
create index if not exists idx_cma_run
  on public.close_monitor_alerts (run_id);

alter table public.close_monitor_alerts enable row level security;

drop policy if exists cma_select_own on public.close_monitor_alerts;
create policy cma_select_own on public.close_monitor_alerts
  for select using (tenant_id in (select current_tenant_ids()));

drop policy if exists cma_update_ack on public.close_monitor_alerts;
create policy cma_update_ack on public.close_monitor_alerts
  for update
  using      (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- ★ INSERT / DELETE 정책 없음 → service_role(RLS 우회) 만 가능

create or replace function public.guard_cma_ack_only()
returns trigger language plpgsql as $$
begin
  if  new.tenant_id    is distinct from old.tenant_id
   or new.period       is distinct from old.period
   or new.check_code   is distinct from old.check_code
   or new.severity     is distinct from old.severity
   or new.category     is distinct from old.category
   or new.drug_code    is distinct from old.drug_code
   or new.title        is distinct from old.title
   or new.detail       is distinct from old.detail
   or new.metric_value is distinct from old.metric_value
   or new.run_id       is distinct from old.run_id
   or new.detected_at  is distinct from old.detected_at
  then
    raise exception '알림 본문은 수정할 수 없습니다. acknowledged_* 만 변경 가능합니다.';
  end if;
  return new;
end $$;

drop trigger if exists trg_cma_ack_only on public.close_monitor_alerts;
create trigger trg_cma_ack_only
  before update on public.close_monitor_alerts
  for each row execute function public.guard_cma_ack_only();


-- -----------------------------------------------------------------------------
-- 2. 임계값 (코드에 흩뿌리지 않고 한 곳에서 관리)
--    ★ enabled 를 함수가 실제로 읽는다. false 인 검사는 블록 전체를 건너뛴다.
-- -----------------------------------------------------------------------------
create table if not exists public.close_monitor_thresholds (
  check_code  text primary key,
  severity    text not null,
  threshold   numeric,
  enabled     boolean not null default true,
  note        text
);

insert into public.close_monitor_thresholds (check_code, severity, threshold, enabled, note) values
  ('SNAPSHOT_MISSING',      'CRITICAL', null,  true, '마감 스냅샷 자체가 없음'),
  ('SNAPSHOT_AMOUNT_DIFF',  'CRITICAL', 1,     true, '계통별 3중 대조. 스냅샷합=actual · calc+audit=actual · audit 는 detail 기록만'),
  ('NEGATIVE_STOCK',        'CRITICAL', 0,     true, '음수 재고 품목 수'),
  ('STOCK_DUAL_MISMATCH',   'CRITICAL', 0.001, true, 'inventory_stock ↔ drugs current_qty 괴리'),
  ('POST_CLOSE_TX',         'CRITICAL', 0,     true, '마감 이후 입력된 마감월 거래'),
  ('SNAPSHOT_CHAIN_BREAK',  'HIGH',     0,     true, '당월 기초 ≠ 전월 기말. runClose 폴백 흔적 탐지(2026-07 53종·08 47종). PR-A 적용 후 9월부터 0 기대'),
  ('STOCK_FLOW_DIFF',       'HIGH',     1.0,   true, '전월 기말 + 당월 거래 순증 ≠ 당월 기말. 1.0 은 인슐린 펜 분할 반올림 흡수'),
  ('QTY_CHANGE_DIRECT',     'INFO',     0,     true, '실사 조정 정상 경로. 추이 관측용, 통지 제외'),
  ('QTY_DIRECT_UNLINKED',   'HIGH',     0,     true, '직접 변경 중 실사 세션과 연결되지 않은 건'),
  ('AMOUNT_FORMULA_DIFF',   'HIGH',     1,     true, '수량×단가 ≠ 금액 허용 오차(원)'),
  ('NARCOTIC_UNRECONCILED', 'HIGH',     0.001, true, '마약·향정 흐름 편차 — NIMS 대조 필요'),
  ('COUNT_SESSION_OPEN',    'HIGH',     0,     true, '마감 시점 미반영 실사 세션'),
  ('PRICE_ZERO_ACTIVE',     'MEDIUM',   0,     true, '사용 상태인데 구입단가 0'),
  ('REASON_PREFIX_COLLIDE', 'MEDIUM',   0,     true, 'reason 접두사 혼재'),
  ('TX_GROWTH',             'MEDIUM',   1.5,   true, '전월 대비 거래량 증가 배수'),
  ('TABLE_BLOAT',           'MEDIUM',   20,    true, 'dead tuple 비율(%)'),
  -- ★ 운영 방침(2026-09): 약플로 = 실재고 정본, 결재 파일 = 공식 장부.
  --   실사 조정은 결재 파일에 반영하지 않아 두 계통 금액이 구조적으로 다르다.
  --   이 격차는 오류가 아니라 설계된 상태이므로 소급 해소하지 않는다.
  ('LEDGER_DIVERGENCE',     'INFO',     0,     true, '결재/약플로 2계통 격차 추적. 설계된 상태이며 오류 아님. 소급 해소 금지. 통지 제외')
on conflict (check_code) do nothing;

-- ★ INDEX_UNUSED 는 두지 않는다 (seed 제거 · 함수 블록 미구현).

alter table public.close_monitor_thresholds enable row level security;
drop policy if exists cmt_select_all on public.close_monitor_thresholds;
create policy cmt_select_all on public.close_monitor_thresholds
  for select using (true);


-- -----------------------------------------------------------------------------
-- 3. 기초 연결 검증 뷰 — 당월 opening_qty 가 전월 closing_qty 와 이어지는가
--    runClose 의 폴백(전월 스냅샷 누락 시 current_qty 사용)을 정확히 잡는다.
-- -----------------------------------------------------------------------------
create or replace view public.v_close_chain as
select
  s.tenant_id,
  s.snap_year,
  s.snap_month,
  s.drug_code,
  d.drug_name,
  s.opening_qty,
  p.closing_qty                                   as prev_closing_qty,
  round(s.opening_qty - p.closing_qty, 4)         as diff,
  s.closing_qty,
  -- 기초와 기말이 같으면 current_qty 폴백의 흔적일 수 있다(그달 거래가 0이어도 같다).
  (abs(s.opening_qty - s.closing_qty) <= 0.001)   as opening_eq_closing
from public.monthly_snapshots s
join public.monthly_snapshots p
  on  p.tenant_id  = s.tenant_id
  and p.drug_code  = s.drug_code
  and p.snap_year  = case when s.snap_month = 1 then s.snap_year - 1 else s.snap_year end
  and p.snap_month = case when s.snap_month = 1 then 12 else s.snap_month - 1 end
left join public.drugs d
  on d.tenant_id = s.tenant_id and d.drug_code = s.drug_code;

comment on view public.v_close_chain is
  '당월 기초 ≠ 전월 기말 탐지. runClose 전월 스냅샷 조회 불완전 시 current_qty 로 폴백된 흔적.';


-- -----------------------------------------------------------------------------
-- 4. 재고 흐름 검증 뷰 — 전월 기말 + 당월 거래 순증 = 당월 기말 인가
--    ★ 미지 유형은 qty_unknown 으로 따로 센다. 조정으로 조용히 흡수되지 않게 한다.
-- -----------------------------------------------------------------------------
create or replace view public.v_close_stock_flow as
with tx as (
  select
    t.tenant_id,
    t.drug_code,
    extract(year  from t.transaction_date)::int as snap_year,
    extract(month from t.transaction_date)::int as snap_month,
    sum(case when t.type = '입고' then t.quantity else 0 end) as qty_in,
    sum(case when t.type = '출고' then t.quantity else 0 end) as qty_out,
    sum(case when t.type = '폐기' then t.quantity else 0 end) as qty_disposal,
    sum(case when t.type = '반품' then t.quantity else 0 end) as qty_return,
    sum(case when t.type = '조정' then t.quantity else 0 end) as qty_adjust,
    -- ★ 5종 외 미지 유형 (현재 데이터에는 없으나, 새 유형이 생겨도 조용히 섞이지 않게)
    sum(case when t.type not in ('입고','출고','폐기','반품','조정') then t.quantity else 0 end) as qty_unknown,
    count(*) filter (where t.type not in ('입고','출고','폐기','반품','조정'))                    as unknown_count,
    count(*)                                                                                     as tx_count
  from public.transactions t
  group by 1, 2, 3, 4
)
select
  s.tenant_id,
  s.snap_year,
  s.snap_month,
  s.drug_code,
  d.drug_name,
  p.closing_qty                       as prev_closing_qty,
  coalesce(tx.qty_in, 0)              as qty_in,
  coalesce(tx.qty_out, 0)             as qty_out,
  coalesce(tx.qty_disposal, 0)        as qty_disposal,
  coalesce(tx.qty_return, 0)          as qty_return,
  coalesce(tx.qty_adjust, 0)          as qty_adjust,
  coalesce(tx.qty_unknown, 0)         as qty_unknown,
  coalesce(tx.unknown_count, 0)       as unknown_count,
  coalesce(tx.tx_count, 0)            as tx_count,
  s.closing_qty,
  round(
    p.closing_qty
    + coalesce(tx.qty_in, 0)
    - coalesce(tx.qty_out, 0)
    - coalesce(tx.qty_disposal, 0)
    - coalesce(tx.qty_return, 0)
    + coalesce(tx.qty_adjust, 0)
    + coalesce(tx.qty_unknown, 0)
    - s.closing_qty
  , 4) as diff
from public.monthly_snapshots s
join public.monthly_snapshots p
  on  p.tenant_id  = s.tenant_id
  and p.drug_code  = s.drug_code
  and p.snap_year  = case when s.snap_month = 1 then s.snap_year - 1 else s.snap_year end
  and p.snap_month = case when s.snap_month = 1 then 12 else s.snap_month - 1 end
left join tx
  on  tx.tenant_id  = s.tenant_id
  and tx.drug_code  = s.drug_code
  and tx.snap_year  = s.snap_year
  and tx.snap_month = s.snap_month
left join public.drugs d
  on d.tenant_id = s.tenant_id and d.drug_code = s.drug_code;

comment on view public.v_close_stock_flow is
  '전월 기말 + 당월 거래 순증 ≠ 당월 기말 탐지. 거래로 설명되지 않는 재고 변동.';


-- -----------------------------------------------------------------------------
-- 5. 재고 이중 저장 정합 뷰 (inventory_stock ↔ drugs)
-- -----------------------------------------------------------------------------
create or replace view public.v_stock_dual_check as
select
  i.tenant_id,
  i.drug_code,
  d.drug_name,
  i.current_qty                           as stock_qty,
  d.current_qty                           as drug_qty,
  round(i.current_qty - d.current_qty, 4) as diff,
  d.status,
  d.purchase_price
from public.inventory_stock i
join public.drugs d
  on d.tenant_id = i.tenant_id
 and d.drug_code = i.drug_code
where abs(coalesce(i.current_qty,0) - coalesce(d.current_qty,0)) > 0.001;

comment on view public.v_stock_dual_check is
  'apply_tx_to_inventory 가 두 테이블을 함께 갱신하므로, 괴리는 트리거 우회의 증거.';


-- -----------------------------------------------------------------------------
-- 6. 성능 관측 뷰
-- -----------------------------------------------------------------------------
create or replace view public.v_close_table_health as
select
  relname                                            as table_name,
  n_live_tup                                         as live_rows,
  n_dead_tup                                         as dead_rows,
  case when n_live_tup > 0
       then round(100.0 * n_dead_tup / n_live_tup, 2)
       else 0 end                                    as dead_pct,
  last_autovacuum,
  last_autoanalyze,
  pg_size_pretty(pg_total_relation_size(relid))      as total_size,
  pg_total_relation_size(relid)                      as total_bytes
from pg_stat_user_tables
where schemaname = 'public'
  and relname in (
    'transactions','inventory_stock','drugs','monthly_snapshots',
    'drug_qty_audit','inventory_counts','inventory_count_items',
    'close_monitor_alerts'
  );


-- -----------------------------------------------------------------------------
-- 7. 메인 검증 함수 (검증 16종)
--    service_role 전용. 결과를 close_monitor_alerts 에 적재하고 요약을 반환.
--    ★ close_monitor_alerts 외 어떤 테이블에도 쓰지 않는다.
-- -----------------------------------------------------------------------------
create or replace function public.run_close_monitor(
  p_tenant_id uuid,
  p_period    text default null,     -- 'YYYY-MM', 기본값 = 지지난달이 아니라 **직전월**
  p_persist   boolean default true   -- false 면 적재 없이 조회만 (dryrun)
)
returns table (
  check_code   text,
  severity     text,
  category     text,
  hit_count    bigint,
  title        text,
  detail       jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id  uuid := gen_random_uuid();
  v_period  text;
  v_year    int;
  v_month   int;
  v_py      int;      -- 전월
  v_pm      int;
  v_prev    text;
  v_thr     numeric;
  v_sev     text;
  v_on      boolean;
begin
  -- 호출자 확인: service_role 만 허용
  if current_setting('request.jwt.claims', true) is not null
     and coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') <> 'service_role'
  then
    raise exception 'run_close_monitor 는 service_role 만 실행할 수 있습니다.';
  end if;

  -- ★ 시그니처는 'YYYY-MM' 을 유지하고, 내부에서 snap_year/snap_month 로 분해한다.
  v_period := coalesce(p_period, to_char(date_trunc('month', current_date - interval '1 month'), 'YYYY-MM'));
  if v_period !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'p_period 형식이 잘못되었습니다 (YYYY-MM): %', v_period;
  end if;
  v_year  := split_part(v_period, '-', 1)::int;
  v_month := split_part(v_period, '-', 2)::int;
  v_py    := case when v_month = 1 then v_year - 1 else v_year end;
  v_pm    := case when v_month = 1 then 12 else v_month - 1 end;
  v_prev  := to_char(make_date(v_py, v_pm, 1), 'YYYY-MM');

  create temp table _alert (
    check_code   text,
    severity     text,
    category     text,
    drug_code    text,
    drug_name    text,
    title        text,
    detail       jsonb,
    metric_value numeric,
    threshold    numeric
  ) on commit drop;

  -- ===========================================================================
  -- [무결성] C1. 마감 스냅샷 존재 여부
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'SNAPSHOT_MISSING';
  if coalesce(v_on, false) then
    if not exists (
      select 1 from monthly_snapshots
       where tenant_id = p_tenant_id and snap_year = v_year and snap_month = v_month
    ) then
      insert into _alert values (
        'SNAPSHOT_MISSING', v_sev, '무결성', null, null,
        format('%s 마감 스냅샷이 존재하지 않습니다.', v_period),
        jsonb_build_object('period', v_period), 0, v_thr
      );
    end if;
  end if;

  -- ===========================================================================
  -- [무결성] C2. 계통별 3중 대조
  --   (1) 스냅샷 closing_amount 합계 == actual_closing   → 약플로 내부 불일치
  --   (2) calc_closing + audit_adjust == actual_closing  → 총액 산식 오류
  --   (3) audit_adjust 절대값은 참고값 — 알림 아님. detail 에만 싣는다(C15 가 추적).
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'SNAPSHOT_AMOUNT_DIFF';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'SNAPSHOT_AMOUNT_DIFF', v_sev, '무결성', null, null,
      case
        when abs(x.snap_vs_actual) > v_thr
          then format('스냅샷 합계와 정본 총액이 %s원 어긋납니다 (약플로 내부 불일치).', to_char(x.snap_vs_actual, 'FM999,999,999.999'))
        else format('총액 산식이 어긋납니다: calc + audit ≠ actual (%s원).', to_char(x.formula_diff, 'FM999,999,999.999'))
      end,
      jsonb_build_object(
        'period',           v_period,
        'snapshot_total',   x.snapshot_total,   -- 스냅샷 closing_amount 합계
        'actual_closing',   x.actual_closing,   -- 약플로 정본
        'calc_closing',     x.calc_closing,     -- 결재 계통 산식
        'audit_adjust',     x.audit_adjust,     -- 실사 조정 (약플로 전용 · 참고값)
        'snap_vs_actual',   x.snap_vs_actual,
        'formula_diff',     x.formula_diff,
        'item_count',       x.item_count
      ),
      greatest(abs(x.snap_vs_actual), abs(x.formula_diff)), v_thr
    from (
      select
        coalesce(sum(s.closing_amount), 0)                                    as snapshot_total,
        coalesce(max(r.actual_closing), 0)                                    as actual_closing,
        coalesce(max(r.calc_closing), 0)                                      as calc_closing,
        coalesce(max(r.audit_adjust), 0)                                      as audit_adjust,
        coalesce(sum(s.closing_amount), 0) - coalesce(max(r.actual_closing), 0) as snap_vs_actual,
        coalesce(max(r.calc_closing), 0) + coalesce(max(r.audit_adjust), 0)
          - coalesce(max(r.actual_closing), 0)                                as formula_diff,
        count(*)                                                              as item_count
      from monthly_snapshots s
      left join monthly_report_totals r
             on r.tenant_id = s.tenant_id and r.snap_year = s.snap_year and r.snap_month = s.snap_month
      where s.tenant_id = p_tenant_id and s.snap_year = v_year and s.snap_month = v_month
    ) x
    where abs(x.snap_vs_actual) > v_thr or abs(x.formula_diff) > v_thr;
  end if;

  -- ===========================================================================
  -- [무결성] C3. 음수 재고
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'NEGATIVE_STOCK';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'NEGATIVE_STOCK', v_sev, '무결성', s.drug_code, d.drug_name,
      format('%s 마감 재고가 음수입니다 (%s).', coalesce(d.drug_name, s.drug_code), s.closing_qty),
      jsonb_build_object('period', v_period, 'closing_qty', s.closing_qty, 'closing_amount', s.closing_amount),
      s.closing_qty, v_thr
    from monthly_snapshots s
    left join drugs d on d.tenant_id = s.tenant_id and d.drug_code = s.drug_code
    where s.tenant_id = p_tenant_id and s.snap_year = v_year and s.snap_month = v_month
      and s.closing_qty < 0;
  end if;

  -- ===========================================================================
  -- [무결성] C4. 재고 이중 저장 괴리
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'STOCK_DUAL_MISMATCH';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'STOCK_DUAL_MISMATCH', v_sev, '무결성', v.drug_code, v.drug_name,
      format('%s 재고가 두 테이블에서 다릅니다 (stock %s / drugs %s).',
             coalesce(v.drug_name, v.drug_code), v.stock_qty, v.drug_qty),
      jsonb_build_object('stock_qty', v.stock_qty, 'drug_qty', v.drug_qty, 'diff', v.diff),
      abs(v.diff), v_thr
    from v_stock_dual_check v
    where v.tenant_id = p_tenant_id;
  end if;

  -- ===========================================================================
  -- [무결성] C5. 마감 이후 입력된 마감월 거래
  --   ★ 마감 시각은 monthly_report_totals.created_at (monthly_snapshots 에는 시각 컬럼이 없다)
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'POST_CLOSE_TX';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'POST_CLOSE_TX', v_sev, '무결성', null, null,
      format('마감 확정 이후에 %s월 거래 %s건이 입력되었습니다.', v_period, x.cnt),
      jsonb_build_object('period', v_period, 'count', x.cnt, 'closed_at', x.closed_at, 'sample', x.sample),
      x.cnt, v_thr
    from (
      select
        count(*)                                    as cnt,
        max(c.closed_at)                            as closed_at,
        jsonb_agg(jsonb_build_object(
          'tx_id', t.id, 'drug_code', t.drug_code,
          'qty', t.quantity, 'created_at', t.created_at
        ) order by t.created_at desc)               as sample
      from transactions t
      join (
        select max(created_at) as closed_at
          from monthly_report_totals
         where tenant_id = p_tenant_id and snap_year = v_year and snap_month = v_month
      ) c on c.closed_at is not null
      where t.tenant_id = p_tenant_id
        and extract(year  from t.transaction_date)::int = v_year
        and extract(month from t.transaction_date)::int = v_month
        and t.created_at > c.closed_at
    ) x
    where x.cnt > v_thr;
  end if;

  -- ===========================================================================
  -- [무결성] C6-1. 기초 연결 끊김 (구 ROLLFORWARD_DIFF 대체)
  --   당월 opening_qty ≠ 전월 closing_qty. runClose 폴백 흔적을 정확히 잡는다.
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'SNAPSHOT_CHAIN_BREAK';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'SNAPSHOT_CHAIN_BREAK', v_sev, '무결성', v.drug_code, v.drug_name,
      format('%s 기초가 전월 기말과 다릅니다 (기초 %s / 전월기말 %s).',
             coalesce(v.drug_name, v.drug_code), v.opening_qty, v.prev_closing_qty),
      jsonb_build_object(
        'period', v_period, 'prev_period', v_prev,
        'opening_qty', v.opening_qty, 'prev_closing_qty', v.prev_closing_qty,
        'diff', v.diff, 'closing_qty', v.closing_qty,
        'opening_eq_closing', v.opening_eq_closing   -- true 면 current_qty 폴백 흔적
      ),
      abs(v.diff), v_thr
    from v_close_chain v
    where v.tenant_id = p_tenant_id
      and v.snap_year = v_year and v.snap_month = v_month
      and abs(v.diff) > v_thr;
  end if;

  -- ===========================================================================
  -- [정합성] C6-2. 재고 흐름 편차
  --   전월 기말 + 당월 거래 순증 ≠ 당월 기말. threshold 1.0 = 인슐린 펜 분할 반올림 흡수.
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'STOCK_FLOW_DIFF';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'STOCK_FLOW_DIFF', v_sev, '정합성', v.drug_code, v.drug_name,
      format('%s 재고 변동이 거래로 설명되지 않습니다 (편차 %s).',
             coalesce(v.drug_name, v.drug_code), v.diff),
      jsonb_build_object(
        'period', v_period,
        'prev_closing', v.prev_closing_qty, 'in', v.qty_in, 'out', v.qty_out,
        'disposal', v.qty_disposal, 'return', v.qty_return, 'adjust', v.qty_adjust,
        'qty_unknown', v.qty_unknown, 'unknown_count', v.unknown_count,
        'closing', v.closing_qty, 'diff', v.diff, 'tx_count', v.tx_count
      ),
      abs(v.diff), v_thr
    from v_close_stock_flow v
    where v.tenant_id = p_tenant_id
      and v.snap_year = v_year and v.snap_month = v_month
      and abs(v.diff) > v_thr;
  end if;

  -- ===========================================================================
  -- [정합성] C7. 거래 없이 직접 변경된 재고 (INFO · 통지 제외)
  --   실사 조정이 정당한 경로임이 확인되어 추이 관측용으로만 둔다.
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'QTY_CHANGE_DIRECT';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'QTY_CHANGE_DIRECT', v_sev, '정합성', null, null,
      format('%s에 거래를 거치지 않은 재고 변경이 %s건 있습니다 (실사 조정 정상 경로).', v_period, x.cnt),
      jsonb_build_object('period', v_period, 'count', x.cnt, 'delta_sum', x.dsum, 'drug_count', x.dcnt),
      x.cnt, v_thr
    from (
      select count(*) as cnt, sum(a.delta) as dsum, count(distinct a.drug_code) as dcnt
        from drug_qty_audit a
       where a.tenant_id = p_tenant_id
         and a.path = '직접'
         and extract(year  from a.changed_at)::int = v_year
         and extract(month from a.changed_at)::int = v_month
    ) x
    where x.cnt > v_thr;
  end if;

  -- ===========================================================================
  -- [정합성] C7-B. 실사 세션과 연결되지 않은 직접 변경
  --   실사 조정이 정당해진 대신, 세션에 대응되지 않는 직접 변경은 여전히 이상이다.
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'QTY_DIRECT_UNLINKED';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'QTY_DIRECT_UNLINKED', v_sev, '정합성', null, null,
      format('%s 직접 변경 %s건이 실사 세션과 연결되지 않았습니다.', v_period, x.cnt),
      jsonb_build_object('period', v_period, 'count', x.cnt, 'drugs', x.drugs),
      x.cnt, v_thr
    from (
      select count(*) as cnt, jsonb_agg(distinct a.drug_code) as drugs
        from drug_qty_audit a
       where a.tenant_id = p_tenant_id
         and a.path = '직접'
         and extract(year  from a.changed_at)::int = v_year
         and extract(month from a.changed_at)::int = v_month
         and not exists (
           select 1
             from inventory_count_items i
             join inventory_counts c on c.id = i.count_id
            where c.tenant_id  = a.tenant_id
              and i.drug_code  = a.drug_code
              and c.count_date = (a.changed_at at time zone 'Asia/Seoul')::date
         )
    ) x
    where x.cnt > v_thr;
  end if;

  -- ===========================================================================
  -- [정합성] C8. 수량 × 단가 ≠ 금액
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'AMOUNT_FORMULA_DIFF';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'AMOUNT_FORMULA_DIFF', v_sev, '정합성', s.drug_code, d.drug_name,
      format('%s 마감 금액이 수량×단가와 다릅니다.', coalesce(d.drug_name, s.drug_code)),
      jsonb_build_object('closing_qty', s.closing_qty, 'purchase_price', d.purchase_price,
                         'expected', round(s.closing_qty * d.purchase_price, 2),
                         'actual', s.closing_amount),
      abs(s.closing_amount - round(s.closing_qty * d.purchase_price, 2)), v_thr
    from monthly_snapshots s
    join drugs d on d.tenant_id = s.tenant_id and d.drug_code = s.drug_code
    where s.tenant_id = p_tenant_id and s.snap_year = v_year and s.snap_month = v_month
      and d.purchase_price > 0
      and abs(s.closing_amount - round(s.closing_qty * d.purchase_price, 2)) > v_thr;
  end if;

  -- ===========================================================================
  -- [정합성] C9. 마약·향정 미대사
  --   NIMS 재고가 정본이므로 대사 자체를 가정하지 않고 "차이 존재"만 통지한다.
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'NARCOTIC_UNRECONCILED';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'NARCOTIC_UNRECONCILED', v_sev, '정합성', v.drug_code, v.drug_name,
      format('[마약·향정] %s 재고 흐름 편차 %s — NIMS 재고 대조 필요.',
             coalesce(v.drug_name, v.drug_code), v.diff),
      jsonb_build_object('prev_closing', v.prev_closing_qty, 'closing', v.closing_qty,
                         'diff', v.diff, 'requires_nims', true),
      abs(v.diff), v_thr
    from v_close_stock_flow v
    join drugs d on d.tenant_id = v.tenant_id and d.drug_code = v.drug_code
    where v.tenant_id = p_tenant_id
      and v.snap_year = v_year and v.snap_month = v_month
      and coalesce(d.is_narcotic, false) = true
      and abs(v.diff) > v_thr;
  end if;

  -- ===========================================================================
  -- [운영] C10. 마감 시점 미반영 실사 세션
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'COUNT_SESSION_OPEN';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'COUNT_SESSION_OPEN', v_sev, '운영', null, null,
      format('미반영 실사 세션이 %s건 있습니다. 마감 후에는 반영·되돌리기가 불가합니다.', x.cnt),
      jsonb_build_object('sessions', x.sessions), x.cnt, v_thr
    from (
      select count(*) as cnt,
             jsonb_agg(jsonb_build_object(
               'id', c.id, 'title', c.title,
               'count_date', c.count_date, 'status', c.status,
               'item_count', (select count(*) from inventory_count_items i where i.count_id = c.id)
             )) as sessions
        from inventory_counts c
       where c.tenant_id = p_tenant_id
         and c.applied_at is null
         and c.count_date < (make_date(v_year, v_month, 1) + interval '1 month')
    ) x
    where x.cnt > v_thr;
  end if;

  -- ===========================================================================
  -- [운영] C11. 사용 상태인데 구입단가 0
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'PRICE_ZERO_ACTIVE';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'PRICE_ZERO_ACTIVE', v_sev, '운영', s.drug_code, d.drug_name,
      format('%s 재고 %s개가 평가액 0으로 계상됩니다 (구입단가 0).', d.drug_name, s.closing_qty),
      jsonb_build_object('closing_qty', s.closing_qty, 'status', d.status,
                         'note', '무상 공급 품목이면 정상'),
      s.closing_qty, v_thr
    from monthly_snapshots s
    join drugs d on d.tenant_id = s.tenant_id and d.drug_code = s.drug_code
    where s.tenant_id = p_tenant_id and s.snap_year = v_year and s.snap_month = v_month
      and d.status = '사용'
      and coalesce(d.purchase_price, 0) = 0
      and s.closing_qty > 0;
  end if;

  -- ===========================================================================
  -- [운영] C12. reason 접두사 혼재
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'REASON_PREFIX_COLLIDE';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'REASON_PREFIX_COLLIDE', v_sev, '운영', null, null,
      'reason 접두사가 혼재합니다. LIKE ''실사%'' 조회 시 신규·기존이 섞입니다.',
      jsonb_build_object('legacy', x.legacy, 'applied', x.applied, 'reverted', x.reverted,
                         'hint', 'inventory_count_items.applied_tx_id 조인 또는 ''실사 반영 · %'' 정확 접두사 사용'),
      x.legacy + x.applied + x.reverted, v_thr
    from (
      select
        count(*) filter (where t.reason like '실사 결과 반영%')  as legacy,
        count(*) filter (where t.reason like '실사 반영 · %')     as applied,
        count(*) filter (where t.reason like '실사 되돌리기 · %') as reverted
      from transactions t
      where t.tenant_id = p_tenant_id and t.reason like '실사%'
    ) x
    where x.legacy > 0 and (x.applied > 0 or x.reverted > 0);
  end if;

  -- ===========================================================================
  -- [성능] C13. 거래량 급증
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'TX_GROWTH';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'TX_GROWTH', v_sev, '성능', null, null,
      format('거래 건수가 전월 대비 %s배 증가했습니다 (%s → %s).',
             round(x.ratio, 2), x.prev_cnt, x.cur_cnt),
      jsonb_build_object('prev_period', v_prev, 'prev_count', x.prev_cnt,
                         'period', v_period, 'count', x.cur_cnt, 'ratio', x.ratio),
      x.ratio, v_thr
    from (
      select
        count(*) filter (where extract(year from t.transaction_date)::int = v_year
                           and extract(month from t.transaction_date)::int = v_month) as cur_cnt,
        count(*) filter (where extract(year from t.transaction_date)::int = v_py
                           and extract(month from t.transaction_date)::int = v_pm)    as prev_cnt,
        case when count(*) filter (where extract(year from t.transaction_date)::int = v_py
                                     and extract(month from t.transaction_date)::int = v_pm) > 0
             then count(*) filter (where extract(year from t.transaction_date)::int = v_year
                                     and extract(month from t.transaction_date)::int = v_month)::numeric
                / count(*) filter (where extract(year from t.transaction_date)::int = v_py
                                     and extract(month from t.transaction_date)::int = v_pm)
             else 0 end as ratio
      from transactions t
      where t.tenant_id = p_tenant_id
    ) x
    where x.ratio > v_thr;
  end if;

  -- ===========================================================================
  -- [성능] C14. 테이블 팽창
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'TABLE_BLOAT';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'TABLE_BLOAT', v_sev, '성능', null, null,
      format('%s 테이블의 dead tuple 비율이 %s%% 입니다.', h.table_name, h.dead_pct),
      jsonb_build_object('table', h.table_name, 'live', h.live_rows,
                         'dead', h.dead_rows, 'dead_pct', h.dead_pct,
                         'size', h.total_size, 'last_autovacuum', h.last_autovacuum),
      h.dead_pct, v_thr
    from v_close_table_health h
    where h.dead_pct > v_thr;
  end if;

  -- ===========================================================================
  -- [운영] C15. 결재/약플로 2계통 격차 추적 (INFO · 통지 제외)
  --   ★ 운영 방침(2026-09): 실사 조정은 결재 파일에 반영하지 않는다.
  --     두 계통의 금액 차이는 오류가 아니라 설계된 상태다. 소급 해소하지 않는다.
  --     이 검사는 오류 탐지가 아니라 **격차 추이 기록**이다. 감사·결산 시 설명 근거로 조회한다.
  --     알림을 발생시키면 설계 오류다 — severity 는 반드시 INFO 이며 NOTIFY_LEVELS 에서 제외된다.
  -- ===========================================================================
  select t.threshold, t.severity, t.enabled into v_thr, v_sev, v_on
    from close_monitor_thresholds t where t.check_code = 'LEDGER_DIVERGENCE';
  if coalesce(v_on, false) then
    insert into _alert
    select
      'LEDGER_DIVERGENCE', v_sev, '운영', null, null,
      format('실사 조정 %s원 (약플로 전용). 누적 %s원.',
             to_char(x.audit_adjust, 'FM999,999,999.999'),
             to_char(x.ytd_adjust,   'FM999,999,999.999')),
      jsonb_build_object(
        'period',          v_period,
        'audit_adjust',    x.audit_adjust,    -- 당월 조정액
        'ytd_adjust',      x.ytd_adjust,      -- 연초부터 누적 조정액
        'adjusted_drugs',  x.adjusted_drugs,  -- 조정 품목 수
        'calc_closing',    x.calc_closing,
        'actual_closing',  x.actual_closing,
        'policy', '약플로=실재고 정본 / 결재파일=공식장부. 격차는 설계된 상태이며 오류가 아님. 소급 해소 금지.'
      ),
      abs(x.audit_adjust), v_thr
    from (
      select
        coalesce(r.audit_adjust, 0)   as audit_adjust,
        coalesce(r.calc_closing, 0)   as calc_closing,
        coalesce(r.actual_closing, 0) as actual_closing,
        coalesce((select sum(r2.audit_adjust) from monthly_report_totals r2
                   where r2.tenant_id = p_tenant_id and r2.snap_year = v_year
                     and r2.snap_month <= v_month), 0) as ytd_adjust,
        coalesce((select count(distinct a.drug_code) from drug_qty_audit a
                   where a.tenant_id = p_tenant_id and a.path = '직접'
                     and extract(year  from a.changed_at)::int = v_year
                     and extract(month from a.changed_at)::int = v_month), 0) as adjusted_drugs
      from monthly_report_totals r
      where r.tenant_id = p_tenant_id and r.snap_year = v_year and r.snap_month = v_month
    ) x
    where abs(x.audit_adjust) > v_thr;
  end if;

  -- ===========================================================================
  -- 적재 (p_persist = true 일 때만)
  -- ===========================================================================
  if p_persist then
    insert into close_monitor_alerts (
      tenant_id, period, check_code, severity, category,
      drug_code, drug_name, title, detail, metric_value, threshold, run_id
    )
    select
      p_tenant_id, v_period, a.check_code, a.severity, a.category,
      a.drug_code, a.drug_name, a.title, a.detail, a.metric_value, a.threshold, v_run_id
    from _alert a;
  end if;

  -- ===========================================================================
  -- 요약 반환
  -- ===========================================================================
  return query
  select
    a.check_code,
    max(a.severity) as severity,
    max(a.category) as category,
    count(*)        as hit_count,
    max(a.title)    as title,
    jsonb_build_object(
      'run_id', v_run_id, 'period', v_period, 'persisted', p_persist,
      'samples', jsonb_agg(a.detail)
    ) as detail
  from _alert a
  group by a.check_code
  order by
    case max(a.severity)
      when 'CRITICAL' then 1 when 'HIGH' then 2
      when 'MEDIUM'   then 3 when 'LOW'  then 4 else 5 end,
    count(*) desc;
end $$;

revoke all on function public.run_close_monitor(uuid, text, boolean) from public;
revoke all on function public.run_close_monitor(uuid, text, boolean) from authenticated;
revoke all on function public.run_close_monitor(uuid, text, boolean) from anon;
grant execute on function public.run_close_monitor(uuid, text, boolean) to service_role;

comment on function public.run_close_monitor is
  '월마감 무결성·정합성·성능 통합 검증 16종. service_role 전용. p_persist=false 로 dryrun 가능.';

commit;
