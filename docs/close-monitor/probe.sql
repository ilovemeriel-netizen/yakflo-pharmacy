-- =============================================================================
-- probe.sql — 0086 적용 전 스키마 대조 (읽기 전용, SELECT 만)
--
-- ★ 2026-09-04 정정 — 최초 작성본은 tx_date · tx_type · period 를 가정해
--   그대로 실행하면 42703(컬럼 없음) 으로 죽었다. 실제 스키마로 정정했다.
--     transactions.tx_date  → transaction_date
--     transactions.tx_type  → type
--     monthly_snapshots.period → snap_year int + snap_month int
--     monthly_report_totals.period/closing_amount → snap_year+snap_month / actual_closing
-- =============================================================================

-- 1. 대상 테이블 컬럼 목록
select table_name, ordinal_position, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name in (
     'transactions','monthly_snapshots','monthly_report_totals',
     'drugs','inventory_stock','drug_qty_audit',
     'inventory_counts','inventory_count_items',
     'close_monitor_alerts','close_monitor_thresholds'
   )
 order by table_name, ordinal_position;

-- 2. transactions 유형 분포 — 롤포워드/흐름 분기 확인용
--    ★ 컬럼명은 type (tx_type 아님), 날짜는 transaction_date (tx_date 아님)
select type, count(*) as cnt,
       min(transaction_date) as first_at, max(transaction_date) as last_at
  from transactions
 group by 1
 order by 2 desc;

-- 3. reason 접두사 분포 — C12 판정 기준 확인용
select
  case
    when reason like '실사 결과 반영%'  then 'C: 실사 결과 반영 (기존)'
    when reason like '실사 반영 · %'     then 'A: 실사 반영 · (신규)'
    when reason like '실사 되돌리기 · %' then 'B: 실사 되돌리기 · (신규)'
    when reason like '실사%'             then 'X: 기타 실사 접두사'
    else 'Z: 실사 아님'
  end as prefix_group,
  count(*) as cnt
 from transactions
 group by 1
 order by 2 desc;

-- 4. 마약 구분 컬럼 — C9 조건 확인용
--    실측: is_narcotic boolean 존재 (true 29건 = narcotic_type 향정22+마약7 과 일치)
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'drugs'
   and (column_name ilike '%narcotic%'
     or column_name ilike '%class%'
     or column_name ilike '%category%');

select coalesce(narcotic_type,'(null)') as narcotic_type, count(*) from drugs group by 1 order by 2 desc;
select coalesce(is_narcotic::text,'(null)') as is_narcotic,  count(*) from drugs group by 1 order by 2 desc;

-- 5. monthly_snapshots 기간 표현 확인
--    ★ period text 가 아니라 snap_year int + snap_month int 다. created_at 컬럼은 없다.
select snap_year, snap_month, count(*) as rows, sum(closing_amount) as closing_total
  from monthly_snapshots
 group by 1,2
 order by 1,2;

-- 6. monthly_report_totals — 마감 시각·계통별 금액
--    ★ closing_amount 없음. actual_closing(약플로 정본) · calc_closing(결재 산식) · audit_adjust(실사 조정)
--    ★ C5 의 마감 시각은 monthly_snapshots 가 아니라 이 테이블의 created_at 을 쓴다.
select snap_year, snap_month, source,
       calc_closing, audit_adjust, actual_closing,
       calc_closing + audit_adjust - actual_closing as formula_diff,
       item_count, created_at
  from monthly_report_totals
 order by snap_year, snap_month;

-- 7. 함수 존재 확인
select proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc
 where proname in ('current_tenant_ids','is_admin',
                   'apply_tx_to_inventory','revert_tx_from_inventory',
                   'guard_closed_month_tx','log_drugs_qty','run_close_monitor')
 order by 1;

-- 8. drug_qty_audit.path 분포 — C7 · C7-B · C15 기준
select coalesce(path,'(null)') as path, count(*) as cnt,
       min(changed_at) as first_at, max(changed_at) as last_at
  from drug_qty_audit
 group by 1
 order by 2 desc;

-- 9. 현재 부하 기준점 (C14 임계 조정용)
select relname, n_live_tup, n_dead_tup,
       case when n_live_tup > 0
            then round(100.0 * n_dead_tup / n_live_tup, 2) else 0 end as dead_pct,
       pg_size_pretty(pg_total_relation_size(relid)) as size,
       last_autovacuum
  from pg_stat_user_tables
 where schemaname = 'public'
 order by pg_total_relation_size(relid) desc
 limit 15;
