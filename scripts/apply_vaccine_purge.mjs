// apply_vaccine_purge.mjs — 백신 테스트 데이터 전량 삭제 (운영 적용).
//
// ★★ 이 스크립트는 COMMIT 한다. 삭제된 행은 복구할 수 없다.
//    dryrun_vaccine_purge.mjs 가 13/14 통과한 뒤 승인을 받아 실행한다.
//    삭제 대상 전문은 dryrun 보고서에 남아 있다 — 그것이 유일한 흔적이다.
//
// ★ 실행 직전에 삭제 대상을 **다시 실측**해 dryrun 결과와 대조한다.
//   다르면 COMMIT 하지 않고 ROLLBACK 후 중단한다(그 사이 누가 넣었을 수 있다).
//
// ★ 트리거는 DISABLE/ENABLE 만 한다 — 정의를 고치지 않고,
//   가드에 영구 우회 경로를 만들지 않는다. 같은 트랜잭션 안에서 되살린다.
//
// ★ transactions·drugs·inventory_stock·monthly_snapshots·inventory_counts 미접촉.
//   ★ drugs 의 FLUBYVCV 를 찾거나 만들거나 지우지 않는다.
import { createRequire } from 'node:module'
const REPO = 'c:/Users/iamam/OneDrive/바탕 화면/yakflo-pharmacy-main/'
const pg = createRequire(REPO + 'package.json')('pg')
import { readFileSync, existsSync } from 'node:fs'

function rd(p) { const o = {}; if (!existsSync(p)) return o; let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } return o }
const env = rd(REPO + '.env'); let url = env.DATABASE_URL || ''; if (/\/postgre$/.test(url)) url += 's'

/* dryrun 실측값 (2026-09-09) — 이것과 다르면 중단한다 */
const EXPECT = { accounts: 1, categories: 3, events: 4 }
const EXPECT_IDS = {
  account: '3a38060a-2f0e-491c-a069-e94887187217',
  events: ['492b11bf-258b-4874-b104-e2e1ecdc0f2e', '8b89b4aa-03a8-48bb-931e-93f86b148c40',
    '0681f012-5414-427d-ae59-382ae0984bd8', '013db669-8371-4d50-a5cf-0139a8e20e42'],
}
const TRG = 'trg_vaccine_events_append_only'

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const t0 = Date.now()
let done = false
await c.connect()
try {
  const q = (s, a) => c.query(s, a)
  const one = async (s, a) => (await q(s, a)).rows[0]

  await q('begin')

  /* ── 1. 실행 직전 대조 ───────────────────────────────────────────────── */
  console.log('═══ 실행 직전 대조 ═══')
  const pre = await one(`select
    (select count(*)::int from public.vaccine_accounts)   a,
    (select count(*)::int from public.vaccine_categories) c,
    (select count(*)::int from public.vaccine_events)     e`)
  console.log(`  계정 ${pre.a}/${EXPECT.accounts} · 카테고리 ${pre.c}/${EXPECT.categories} · 이벤트 ${pre.e}/${EXPECT.events}`)

  const ids = (await q(`select id from public.vaccine_events order by created_at`)).rows.map(r => r.id)
  const accId = (await q(`select id from public.vaccine_accounts`)).rows.map(r => r.id)
  const sameIds = ids.length === EXPECT_IDS.events.length && ids.every((x, i) => x === EXPECT_IDS.events[i])
  const sameAcc = accId.length === 1 && accId[0] === EXPECT_IDS.account
  console.log('  이벤트 id 동일 = ' + sameIds + ' · 계정 id 동일 = ' + sameAcc)

  if (pre.a !== EXPECT.accounts || pre.c !== EXPECT.categories || pre.e !== EXPECT.events || !sameIds || !sameAcc) {
    console.log('\n★★ dryrun 과 다르다 — COMMIT 하지 않고 중단한다.')
    await q('rollback'); done = true
    process.exitCode = 1
  } else {
    const tenant = (await one(`select tenant_id from public.vaccine_accounts limit 1`)).tenant_id
    console.log('  tenant_id = ' + tenant)

    /* ── 2. 삭제 (순서 엄수) ─────────────────────────────────────────────── */
    console.log('\n═══ 삭제 ═══')
    await q(`alter table public.vaccine_events disable trigger ${TRG}`)
    console.log('  트리거 DISABLE — tgenabled = ' +
      (await one(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
        where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])).tgenabled)

    const dE = await q(`delete from public.vaccine_events     where tenant_id = $1`, [tenant])
    const dC = await q(`delete from public.vaccine_categories where tenant_id = $1`, [tenant])
    const dA = await q(`delete from public.vaccine_accounts   where tenant_id = $1`, [tenant])
    console.log(`  이벤트 ${dE.rowCount} · 카테고리 ${dC.rowCount} · 계정 ${dA.rowCount} 삭제`)

    await q(`alter table public.vaccine_events enable trigger ${TRG}`)
    const tg = (await one(`select t.tgenabled from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
      where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])).tgenabled
    console.log('  트리거 ENABLE — tgenabled = ' + tg)

    /* ── 3. COMMIT 전 최종 게이트 ───────────────────────────────────────── */
    const post = await one(`select
      (select count(*)::int from public.vaccine_accounts)   a,
      (select count(*)::int from public.vaccine_categories) c,
      (select count(*)::int from public.vaccine_events)     e,
      (select count(*)::int from public.v_vaccine_balance)  v,
      (select count(*)::int from public.transactions)       txs,
      (select count(*)::int from public.drugs)              drugs,
      (select count(*)::int from public.inventory_counts)   cnts`)
    const gateOk = post.a === 0 && post.c === 0 && post.e === 0 && post.v === 0 && tg === 'O'
      && post.txs === 1411 && post.drugs === 1119 && post.cnts === 2
    console.log('\n═══ COMMIT 게이트 ═══')
    console.log(`  0행 ${post.a}/${post.c}/${post.e} · 뷰 ${post.v} · 트리거 ${tg} · 거래 ${post.txs} · 약품 ${post.drugs} · 실사 ${post.cnts}`)

    if (!gateOk) { console.log('\n★★ 게이트 불통과 — ROLLBACK 한다.'); await q('rollback'); done = true; process.exitCode = 1 }
    else { await q('commit'); done = true; console.log('\n★ COMMIT 완료 · 소요 ' + ((Date.now() - t0) / 1000).toFixed(2) + '초') }
  }
} catch (e) {
  console.error('★ 실패:', e.message)
  try { await c.query('rollback'); console.error('★ ROLLBACK 수행 — 운영 무변경') } catch { /* 이미 닫힘 */ }
  done = true; process.exitCode = 1
} finally {
  if (!done) { try { await c.query('rollback'); console.error('★ 안전 ROLLBACK') } catch { /* noop */ } }
  await c.end()
}
