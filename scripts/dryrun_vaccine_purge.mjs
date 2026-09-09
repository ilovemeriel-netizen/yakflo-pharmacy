// dryrun_vaccine_purge.mjs — 백신 테스트 데이터 전량 삭제 사전 검증.
//
// ★★ dryrun 전용이다. 반드시 ROLLBACK 한다. 운영에 아무것도 남기지 않는다.
//    BEGIN → 실측 → 삭제 → 검증 → ROLLBACK → **독립 세션**으로 원상 확인.
//
// ★ 삭제 대상은 복구할 수 없다. 1단계 실측 출력이 **유일한 흔적**이므로
//   보고서에 전문을 옮겨 적는다.
//
// ★ 트리거는 DISABLE/ENABLE 만 한다 — 정의를 고치지 않고,
//   가드에 영구 우회 경로(current_setting 예외 등)를 만들지 않는다.
//
// ★ transactions·drugs·inventory_stock·monthly_snapshots·inventory_counts 미접촉.
import { createRequire } from 'node:module'
const REPO = 'c:/Users/iamam/OneDrive/바탕 화면/yakflo-pharmacy-main/'
const pg = createRequire(REPO + 'package.json')('pg')
import { readFileSync, existsSync } from 'node:fs'

function rd(p) { const o = {}; if (!existsSync(p)) return o; let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } return o }
const env = rd(REPO + '.env'); let url = env.DATABASE_URL || ''; if (/\/postgre$/.test(url)) url += 's'
const conn = () => new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const EXPECT = { accounts: 1, categories: 3, events: 4 }
const TRG = 'trg_vaccine_events_append_only'
const R = []; const P = (k, ok, d) => R.push({ k, ok, d })

const c = conn()
let rolledBack = false
await c.connect()
try {
  const q = (s, a) => c.query(s, a)
  const one = async (s, a) => (await q(s, a)).rows[0]
  /* 제약 위반을 savepoint 로 격리 — 실패해도 트랜잭션이 죽지 않는다 */
  async function probe(sql, args) {
    await q('savepoint sp')
    try { const r = await q(sql, args); await q('release savepoint sp'); return { ok: true, n: r.rowCount } }
    catch (e) { await q('rollback to savepoint sp'); return { ok: false, code: e.code, msg: (e.message || '').split('\n')[0].slice(0, 100) } }
  }

  await q('begin')

  /* ══ 1단계 — 삭제 전 실측 (복구 불가이므로 전문 기록) ══ */
  console.log('═══ 1단계 · 삭제 대상 실측 ═══')
  const accs = (await q(`select id, tenant_id, season, season_start::text, season_end::text, drug_code,
      funding_source, settlement_body, storage_location, admin_end::text, return_due::text, is_active,
      created_at::text from public.vaccine_accounts order by created_at`)).rows
  console.log('\n── vaccine_accounts (' + accs.length + '행) ──')
  for (const r of accs) console.log('  ' + JSON.stringify(r))

  const cats = (await q(`select id, tenant_id, account_id, label, sort_order, is_active, created_at::text
      from public.vaccine_categories order by account_id, sort_order, label`)).rows
  console.log('\n── vaccine_categories (' + cats.length + '행) ──')
  for (const r of cats) console.log('  ' + JSON.stringify(r))

  const evts = (await q(`select id, tenant_id, account_id, event_type, qty, event_date::text, category_id,
      lot_no, expiry_date::text, container, memo, created_at::text
      from public.vaccine_events order by created_at`)).rows
  console.log('\n── vaccine_events (' + evts.length + '행) ──')
  for (const r of evts) console.log('  ' + JSON.stringify(r))

  const bal = (await q(`select * from public.v_vaccine_balance`)).rows
  console.log('\n── v_vaccine_balance (' + bal.length + '행) ──')
  for (const r of bal) console.log('  ' + JSON.stringify(r))

  P('1 실측 건수', accs.length === EXPECT.accounts && cats.length === EXPECT.categories && evts.length === EXPECT.events,
    `계정 ${accs.length}/${EXPECT.accounts} · 카테고리 ${cats.length}/${EXPECT.categories} · 이벤트 ${evts.length}/${EXPECT.events}`)
  if (accs.length !== EXPECT.accounts || cats.length !== EXPECT.categories || evts.length !== EXPECT.events) {
    console.log('\n★★ 예상과 다르다 — 삭제를 진행하지 않고 ROLLBACK 한다.')
    await q('rollback'); rolledBack = true
    throw new Error('STOP_COUNT_MISMATCH')
  }

  const tenant = accs[0].tenant_id
  console.log('\n  tenant_id = ' + tenant)

  /* 삭제 전 정본 */
  const base = await one(`select
    (select count(*)::int from public.transactions)  txs,
    (select count(*)::int from public.drugs)         drugs,
    (select count(*)::int from public.drug_barcodes) barcodes,
    (select count(*)::int from public.transactions where type='조정') adj,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8,
    (select count(*)::int from public.inventory_counts) cnts,
    (select count(*)::int from public.inventory_count_items) citems`)

  /* 트리거 사전 상태 */
  const trgBefore = await one(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])
  console.log('  트리거 사전 상태 tgenabled = ' + (trgBefore ? trgBefore.tgenabled : '★ 미존재'))

  /* ══ 2단계 — 삭제 (순서 엄수: 이벤트 → 카테고리 → 계정) ══ */
  console.log('\n═══ 2단계 · 삭제 ═══')
  await q(`alter table public.vaccine_events disable trigger ${TRG}`)
  const dOff = await one(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])
  console.log('  DISABLE 후 tgenabled = ' + dOff.tgenabled + '  (D = 비활성)')

  const dE = await q(`delete from public.vaccine_events     where tenant_id = $1`, [tenant])
  const dC = await q(`delete from public.vaccine_categories where tenant_id = $1`, [tenant])
  const dA = await q(`delete from public.vaccine_accounts   where tenant_id = $1`, [tenant])
  console.log(`  삭제 — 이벤트 ${dE.rowCount} · 카테고리 ${dC.rowCount} · 계정 ${dA.rowCount}`)

  await q(`alter table public.vaccine_events enable trigger ${TRG}`)

  /* ══ 3단계 — 검증 ══ */
  console.log('\n═══ 3단계 · 검증 ═══')
  const after = await one(`select
    (select count(*)::int from public.vaccine_accounts)   a,
    (select count(*)::int from public.vaccine_categories) c,
    (select count(*)::int from public.vaccine_events)     e,
    (select count(*)::int from public.v_vaccine_balance)  v`)
  P('3-1 세 테이블 0행', after.a === 0 && after.c === 0 && after.e === 0,
    `계정 ${after.a} · 카테고리 ${after.c} · 이벤트 ${after.e}`)
  P('3-2 뷰 0행', after.v === 0, `v_vaccine_balance ${after.v}행`)

  const trgAfter = await one(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])
  P('3-3 ★ 트리거 재활성', !!trgAfter && trgAfter.tgenabled === 'O',
    `tgenabled = ${trgAfter ? trgAfter.tgenabled : '★ 미존재'}  (O = 활성 · D = 비활성)`)

  /* 3-4 가드 복구 실증 — 임시 계정·이벤트를 넣고 DELETE 가 막히는지 본다.
     ★ 이 임시 행도 ROLLBACK 으로 함께 사라진다. */
  const tmpAcc = await one(`insert into public.vaccine_accounts
      (tenant_id, season, season_start, season_end, drug_code, funding_source)
      values ($1,'DRYRUN','2099-01-01','2099-12-31','DRYRUN-PURGE','일반') returning id`, [tenant])
  const tmpEv = await one(`insert into public.vaccine_events
      (tenant_id, account_id, event_type, qty, event_date)
      values ($1,$2,'입고',1,'2099-01-01') returning id`, [tenant, tmpAcc.id])
  const del = await probe(`delete from public.vaccine_events where id = $1`, [tmpEv.id])
  P('3-4 ★ 가드 DELETE 차단', del.ok === false && del.code === '23514',
    `예상 23514 · 실제 ${del.ok ? '통과(★ 가드 미복구)' : del.code} — ${del.msg || ''}`)
  const upd = await probe(`update public.vaccine_events set qty = 2 where id = $1`, [tmpEv.id])
  P('3-4b 가드 UPDATE 차단', upd.ok === false && upd.code === '23514',
    `예상 23514 · 실제 ${upd.ok ? '통과(★)' : upd.code} — ${upd.msg || ''}`)
  const updOk = await probe(`update public.vaccine_events set memo = 'dryrun' where id = $1`, [tmpEv.id])
  P('3-4c 허용 컬럼은 통과', updOk.ok === true, 'memo 는 사후 보정 허용 컬럼 — 가드가 선별 차단임을 확인')

  const now = await one(`select
    (select count(*)::int from public.transactions)  txs,
    (select count(*)::int from public.drugs)         drugs,
    (select count(*)::int from public.drug_barcodes) barcodes,
    (select count(*)::int from public.transactions where type='조정') adj,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8,
    (select count(*)::int from public.inventory_counts) cnts,
    (select count(*)::int from public.inventory_count_items) citems`)
  P('3-5 정본 무변동',
    now.txs === 1411 && now.drugs === 1118 && now.barcodes === 2894 && now.adj === 75
    && now.snap7.startsWith('885285628.424') && now.snap8.startsWith('101208155.9'),
    `거래 ${now.txs}/1411 · 약품 ${now.drugs}/1118 · 바코드 ${now.barcodes}/2894 · 조정 ${now.adj}/75 · 1~7월 ${now.snap7} · 8월 ${now.snap8}`)
  P('3-5b 실사 계통 미접촉', now.cnts === base.cnts && now.citems === base.citems,
    `inventory_counts ${now.cnts}/${base.cnts} · items ${now.citems}/${base.citems}`)

  /* ══ 4단계 — ROLLBACK ══ */
  await q('rollback'); rolledBack = true
  console.log('\n═══ 4단계 · ROLLBACK 완료 ═══')

  const back = await one(`select
    (select count(*)::int from public.vaccine_accounts)   a,
    (select count(*)::int from public.vaccine_categories) c,
    (select count(*)::int from public.vaccine_events)     e`)
  const trgBack = await one(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])
  P('4-1 같은 세션 원상', back.a === EXPECT.accounts && back.c === EXPECT.categories && back.e === EXPECT.events,
    `계정 ${back.a} · 카테고리 ${back.c} · 이벤트 ${back.e}`)
  P('4-2 트리거 원상', !!trgBack && trgBack.tgenabled === 'O', `tgenabled = ${trgBack ? trgBack.tgenabled : '★'}`)
  P('4-3 임시행 잔류 0', (await one(`select count(*)::int n from public.vaccine_accounts where drug_code='DRYRUN-PURGE'`)).n === 0,
    'DRYRUN-PURGE 계정 0건')
  await c.end()

  /* ══ 독립 세션 재확인 ══ */
  const c2 = conn(); await c2.connect()
  await c2.query('set session characteristics as transaction read only')
  const ind = (await c2.query(`select
    (select count(*)::int from public.vaccine_accounts)   a,
    (select count(*)::int from public.vaccine_categories) c,
    (select count(*)::int from public.vaccine_events)     e,
    (select count(*)::int from public.v_vaccine_balance)  v`)).rows[0]
  const t2 = (await c2.query(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])).rows[0]
  await c2.end()
  P('4-4 ★ 독립 세션 원상', ind.a === EXPECT.accounts && ind.c === EXPECT.categories && ind.e === EXPECT.events && ind.v === 1,
    `계정 ${ind.a} · 카테고리 ${ind.c} · 이벤트 ${ind.e} · 뷰 ${ind.v}행`)
  P('4-5 독립 세션 트리거 활성', !!t2 && t2.tgenabled === 'O', `tgenabled = ${t2 ? t2.tgenabled : '★'}`)

  console.log('\n' + '─'.repeat(88))
  let pass = 0
  for (const x of R) { console.log((x.ok ? '  통과' : '★ 실패') + '  ' + x.k.padEnd(22) + ' ' + x.d); if (x.ok) pass++ }
  console.log('─'.repeat(88))
  console.log(`${pass}/${R.length} 통과 · ★ ROLLBACK 완료 — 운영 잔류 0건`)
  process.exitCode = pass === R.length ? 0 : 1
} catch (e) {
  if (e.message === 'STOP_COUNT_MISMATCH') {
    console.log('\n★ 건수 불일치로 중단했다. 삭제를 수행하지 않았다.')
    for (const x of R) console.log((x.ok ? '  통과' : '★ 실패') + '  ' + x.k + ' ' + x.d)
  } else console.error('★ 실패:', e.message)
  process.exitCode = 1
} finally {
  if (!rolledBack) { try { await c.query('rollback'); console.error('★ 예외 경로 ROLLBACK 수행') } catch { /* 이미 닫힘 */ } }
  try { await c.end() } catch { /* 이미 닫힘 */ }
}
