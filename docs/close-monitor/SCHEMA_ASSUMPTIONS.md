# 스키마 대조표 — **대조 완료 (2026-09-04)**

이 문서는 원래 「적용 전 필독 — 스키마 가정 대조표」였습니다. 0086 코드는 DB를 조회하지 않고
작성되어 컬럼명 가정이 여럿 틀렸고, **Stage 0 대조에서 전부 확정**했습니다.
아래는 **확정된 실제 스키마**이며, 0086 SQL은 이미 여기에 맞춰져 있습니다.

## 대조 결과

| 테이블 | 코드가 가정한 컬럼 | **실제** | 조치 |
|---|---|---|---|
| `transactions` | `tx_date` | **`transaction_date`** | 정정 완료 |
| `transactions` | `tx_type` | **`type`** | 정정 완료 |
| `transactions` | `quantity`·`reason`·`drug_code`·`tenant_id`·`created_at` | 동일 | — |
| `transactions.type` 값 | 입고·출고·폐기·반품 + 그 외 조정 | **입고·출고·조정·폐기·반품 5종** | 5종 **명시 매칭** + 그 외는 `qty_unknown` 별도 집계 |
| `monthly_snapshots` | `period text 'YYYY-MM'` | **`snap_year int` + `snap_month int`** | 함수 시그니처는 `p_period text` 유지, 내부에서 분해 |
| `monthly_snapshots` | `opening_qty`·`closing_qty`·`closing_amount` | 동일 | — |
| `monthly_snapshots` | `created_at` (C5 마감 시각) | **★ 컬럼 없음** | `monthly_report_totals.created_at` 으로 대체 |
| `monthly_snapshots` | 조정 컬럼 | **없음** (`total_disp_amount`·`total_ret_amount` 도 없음) | 롤포워드 폐기 근거 |
| `monthly_report_totals` | `period`·`closing_amount` | **`snap_year`+`snap_month`** · **`actual_closing`** (+`calc_closing`·`audit_adjust`) | C2 3중 대조로 재작성 |
| `drugs` | `is_narcotic boolean` | **존재** (true 29건 = `narcotic_type` 향정22+마약7) | C9 그대로 사용 |
| `inventory_stock` | `drug_code`·`current_qty` | 동일 | — |
| `drug_qty_audit` | `path`·`changed_at`·`drug_code`·`delta` | 동일 (`path` ∈ `거래(trigger)`·`직접`) | — |
| `inventory_counts` / `_items` | `count_date`·`status`·`applied_at`·`title` / `count_id`·`book_qty`·`counted_qty`·`applied_tx_id` | 동일 | — |
| 함수 | `current_tenant_ids()`·`is_admin()` | 존재 | — |

## 폐기·신설된 검사

**폐기 — `ROLLFORWARD_DIFF` 와 `v_close_rollforward`**

이 스키마에서 롤포워드 항등식이 성립하지 않습니다. `closing_qty` 는 마감 시점
`drugs.current_qty` 스냅샷이고, 스냅샷에 조정 컬럼이 없습니다. 실측:

| 기간 | 구 롤포워드 식 편차 |
|---|---|
| 2026-07 | **369건** / 1,117 |
| 2026-08 | **61건** / 1,117 |

감사조정(`drug_qty_audit.path='직접'`) 항을 더하는 보정도 시도했으나 **8월이 61 → 155건으로 악화**했습니다.
직접 변경은 이미 `closing_qty`(= 현재고)에 반영되어 있어 다시 더하면 이중 계상되기 때문입니다
(기존식 정합인데 감사조정이 있는 품목 94종이 새로 깨짐, 28건은 조정거래와도 중복).

**신설 2종**

| check_code | 판정 | 8월 실측 |
|---|---|---|
| `SNAPSHOT_CHAIN_BREAK` | 당월 `opening_qty` ≠ 전월 `closing_qty` | **47종** (7월은 53종) |
| `STOCK_FLOW_DIFF` | 전월 `closing` + 당월 거래 순증 ≠ 당월 `closing` | **8건** (7월은 333건 — 시스템 마감 첫 달 전환기 잡음) |

`SNAPSHOT_CHAIN_BREAK` 는 `runClose()` 의 전월 스냅샷 조회 불완전 → `current_qty` 폴백을
정확히 잡습니다. **PR-A(`e4476bb`) 로 원인을 고쳤으므로 9월부터 0종이어야 하며, 그때 효과가 입증됩니다.**

## 운영 방침 (2026-09 확정)

> 약플로 = 실재고 정본, 결재 파일 = 공식 장부.
> 실사 조정은 결재 파일에 반영하지 않으므로 두 계통의 금액은 구조적으로 다르다.
> 이 격차는 오류가 아니라 설계된 상태다. 해소를 위한 소급 작업을 하지 말 것.

- `C15 LEDGER_DIVERGENCE` 가 이 격차를 **추적**합니다. severity `INFO` · **통지 제외** ·
  적재만. 오류 탐지가 아니라 **추이 기록**이며, 알림이 발생하면 설계 오류입니다.
- `C7 QTY_CHANGE_DIRECT` 도 같은 이유로 `INFO`입니다 — 실사 조정은 정당한 경로입니다.
- `C2 SNAPSHOT_AMOUNT_DIFF` 는 계통별 3중 대조입니다:
  ① 스냅샷 `closing_amount` 합계 == `actual_closing` (약플로 내부 불일치 → CRITICAL)
  ② `calc_closing` + `audit_adjust` == `actual_closing` (총액 산식 오류 → CRITICAL)
  ③ `audit_adjust` 절대값은 **참고값** — 알림이 아니라 `detail` 기록만

## 임계값 조정

`close_monitor_thresholds` 로 코드 수정 없이 조정할 수 있습니다.
**`enabled = false` 로 두면 함수가 해당 블록을 통째로 건너뜁니다**(각 블록 앞 게이트).

| check_code | 초기값 | 근거 |
|---|---|---|
| `STOCK_FLOW_DIFF` | 1.0 | 인슐린 4품목(애피드라·휴물린알·트레시바·피아스프) 펜 분할 반올림 흡수 |
| `SNAPSHOT_CHAIN_BREAK` | 0 | 폴백은 한 종도 허용하지 않는다 |
| `QTY_CHANGE_DIRECT` | 0 · **INFO** | 실사 조정 정상 경로. 추이 관측용, 통지 제외 |
| `LEDGER_DIVERGENCE` | 0 · **INFO** | 2계통 격차 추적. 통지 제외 |
| `TX_GROWTH` | 1.5 | 8월 거래 661건 기준. 병동 신청·실사 도입 영향 관찰 |
| `TABLE_BLOAT` | **50** | dead 비율(%). 소행수 테이블(`inventory_counts` 등)의 과민 검출을 줄이려 20 → 50 상향 (Stage 4) |
| `QTY_DIRECT_UNLINKED` | 0 · **INFO** | 구 재고조정 화면 경로가 실사 세션과 연결되지 않음(8월 139건). 신규 실사 화면 전환 후 HIGH 복귀 검토 (Stage 4) |

## 적용 절차

```bash
# 1. 스키마 대조 (읽기 전용)
supabase db execute --file docs/close-monitor/probe.sql

# 2. dryrun (★ supabase db push 를 쓰지 말 것 — 아래 「CLI 사용 시 주의」 참조)
node scripts/dryrun_0086.mjs

# 3. apply → verify
node scripts/apply_0086.mjs && node scripts/verify_0086.mjs

# 4. 함수 dryrun (적재 없이 검증만)
supabase db execute --command \
  "select * from run_close_monitor('<TENANT_UUID>', '2026-08', false);"

# 5. Edge Function 배포
supabase functions deploy close-monitor

# 6. 시크릿 등록 — 값은 절대 커밋·로그에 남기지 말 것
supabase secrets set --env-file .env.monitor
```

★ **`.env.monitor` 는 반드시 `.gitignore` 에 추가하고 파일 자체를 커밋하지 마십시오.**

```
CRON_SECRET=<임의 32자 이상>
TENANT_ID=<TENANT_UUID>
ALERT_WEBHOOK_URL=<선택>
ALERT_EMAIL_TO=<선택>
RESEND_API_KEY=<선택>
```

> ★ 알려진 제약 — 현재 `.env` 의 `SUPABASE_SERVICE_ROLE_KEY`(26자)·`SUPABASE_ANON_KEY`(18자)가
> JWT 형식이 아닙니다. 운영(Netlify 환경변수)에는 영향이 없으나 **로컬에서 `supabase secrets set`·
> REST 진단이 실패**합니다. Stage 5 착수 전 키 갱신이 필요합니다.

## 정기 실행

매월 1일 09:00 KST (= 00:00 UTC) 에 직전월을 검증합니다.

```sql
select cron.schedule(
  'close-monitor-monthly',
  '0 0 1 * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/close-monitor',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', current_setting('app.cron_secret', true)
               ),
    body    := '{}'::jsonb
  );
  $$
);
```

`app.cron_secret` 은 `alter database ... set app.cron_secret = '...'` 로 등록하십시오.
SQL 본문에 값을 직접 쓰면 `cron.job` 테이블에 평문으로 남습니다.

## 프론트엔드 연동

프론트엔드는 **Edge Function 을 호출하지 않습니다.** `close_monitor_alerts` 를
anon key + RLS 로 조회하기만 합니다. service_role 키는 번들에 들어가지 않습니다.

```js
// 미확인 경고 배지 — INFO 는 통지 대상이 아니므로 CRITICAL/HIGH 만 본다
const { data } = await supabase
  .from('close_monitor_alerts')
  .select('id, period, check_code, severity, title, drug_name, detected_at')
  .in('severity', ['CRITICAL', 'HIGH'])
  .is('acknowledged_at', null)
  .order('detected_at', { ascending: false });

// 확인 처리 — acknowledged_* 만 변경 가능 (trg_cma_ack_only 가 나머지 차단)
await supabase
  .from('close_monitor_alerts')
  .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
  .eq('id', alertId);
```

★ 알림 조회 화면(Stage 6)은 **이번 배포 범위 밖**입니다. 설계안은 승인됐으나 착수는 별도 지시 후입니다.

## 배포 상태 (2026-09-04)
- 마이그레이션 0086: **운영 적용 완료** (직접 pg 스크립트 방식)
- Edge Function `close-monitor`: **미배포**
  선결 조건 — `.env` 의 SUPABASE_SERVICE_ROLE_KEY 갱신 + BOM 제거

### 수동 실행 방법 (Edge Function 배포 전까지)
```sql
-- 검증만 (적재 없음)
select * from run_close_monitor('<TENANT_UUID>', '2026-09', false);

-- 적재까지
select * from run_close_monitor('<TENANT_UUID>', '2026-09', true);

-- 적재된 알림 조회
select period, check_code, severity, title, detail
  from close_monitor_alerts
 where severity in ('CRITICAL','HIGH')
   and acknowledged_at is null
 order by detected_at desc;
```

### CLI 사용 시 주의
`supabase db push` 를 사용하지 마십시오. `supabase_migrations.schema_migrations`
기록이 0건이라 0000~0085 를 전량 재적용하려 듭니다.
0083~0085 와 동일하게 `scripts/dryrun_*.mjs` → `apply_*.mjs` → `verify_*.mjs` 패턴을 쓰십시오.
