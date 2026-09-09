// verify_vaccine_purge.mjs — apply_vaccine_purge 이후 운영 검증.
//
// ★★ 거의 전부 읽기 전용이다. 단 하나의 예외가 4번(가드 복구 실증)으로,
//    트랜잭션 안에서 임시행 1건을 넣고 DELETE 가 23514 로 막히는지 본 뒤
//    **반드시 ROLLBACK** 한다. 데이터가 0행이라 이 방법 외에는 가드를
//    실증할 길이 없다(0행 DELETE 는 행 트리거를 발화시키지 않는다).
//
// ★ 정본 기준일 2026-09-09 — 약품 1,119 는 LVT5 신규 등록분이 반영된 값이다.
//   이 값은 **변동값**이므로 다음에 읽을 때 기준일과 함께 확인할 것.
import { createRequire } from 'node:module'
const REPO = 'c:/Users/iamam/OneDrive/바탕 화면/yakflo-pharmacy-main/'
const pg = createRequire(REPO + 'package.json')('pg')
import { readFileSync, existsSync } from 'node:fs'

function rd(p) { const o = {}; if (!existsSync(p)) return o; let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } return o }
const env = rd(REPO + '.env'); let url = env.DATABASE_URL || ''; if (/\/postgre$/.test(url)) url += 's'
const TRG = 'trg_vaccine_events_append_only'
const R = []; const P = (k, ok, d) => R.push({ k, ok, d })

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  const q = (s, a) => c.query(s, a)
  const one = async (s, a) => (await q(s, a)).rows[0]

  /* ── 1·2. 세 테이블 · 뷰 0행 ── */
  const n = await one(`select
    (select count(*)::int from public.vaccine_accounts)   a,
    (select count(*)::int from public.vaccine_categories) c,
    (select count(*)::int from public.vaccine_events)     e,
    (select count(*)::int from public.v_vaccine_balance)  v`)
  P('1 세 테이블 0행', n.a === 0 && n.c === 0 && n.e === 0, `계정 ${n.a} · 카테고리 ${n.c} · 이벤트 ${n.e}`)
  P('2 뷰 0행', n.v === 0, `v_vaccine_balance ${n.v}행`)

  /* ── 3. 트리거 활성 ── */
  const tg = await one(`select t.tgname, t.tgenabled, p.proname,
      case when t.tgtype & 2 > 0 then 'BEFORE' else 'AFTER' end tm,
      concat_ws('/', case when t.tgtype & 8 > 0 then 'DELETE' end, case when t.tgtype & 16 > 0 then 'UPDATE' end) ev
    from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
    where cl.relname='vaccine_events' and t.tgname=$1 and not t.tgisinternal`, [TRG])
  P('3 ★ 트리거 활성', !!tg && tg.tgenabled === 'O' && tg.tm === 'BEFORE' && /DELETE/.test(tg.ev) && /UPDATE/.test(tg.ev),
    tg ? `${tg.tgname} → ${tg.proname} · ${tg.tm} ${tg.ev} · tgenabled=${tg.tgenabled}` : '★ 미존재')

  /* ── 4. ★ 가드 복구 실증 — 임시행 1건 → DELETE 시도 → 전량 ROLLBACK ── */
  await q('begin')
  let guard = { del: null, upd: null, memo: null }
  try {
    const tenant = (await one(`select id from public.tenants limit 1`)).id
    const acc = await one(`insert into public.vaccine_accounts
        (tenant_id, season, season_start, season_end, drug_code, funding_source)
        values ($1,'VERIFY','2099-01-01','2099-12-31','VERIFY-PURGE','일반') returning id`, [tenant])
    const ev = await one(`insert into public.vaccine_events
        (tenant_id, account_id, event_type, qty, event_date)
        values ($1,$2,'입고',1,'2099-01-01') returning id`, [tenant, acc.id])
    const probe = async (sql, args) => { await q('savepoint sp')
      try { await q(sql, args); await q('release savepoint sp'); return { ok: true } }
      catch (e) { await q('rollback to savepoint sp'); return { ok: false, code: e.code, msg: (e.message || '').split('\n')[0].slice(0, 90) } } }
    guard.del = await probe(`delete from public.vaccine_events where id=$1`, [ev.id])
    guard.upd = await probe(`update public.vaccine_events set qty=2 where id=$1`, [ev.id])
    guard.memo = await probe(`update public.vaccine_events set memo='verify' where id=$1`, [ev.id])
  } finally { await q('rollback') }   /* ★ 임시행 전량 소멸 */

  P('4 ★ 가드 DELETE 차단', guard.del && guard.del.ok === false && guard.del.code === '23514',
    `예상 23514 · 실제 ${guard.del?.ok ? '통과(★ 가드 미복구)' : guard.del?.code} — ${guard.del?.msg || ''}`)
  P('4-2 가드 UPDATE 차단', guard.upd && guard.upd.ok === false && guard.upd.code === '23514',
    `예상 23514 · 실제 ${guard.upd?.ok ? '통과(★)' : guard.upd?.code} — ${guard.upd?.msg || ''}`)
  P('4-3 허용 컬럼 통과', guard.memo && guard.memo.ok === true, 'memo 는 사후 보정 허용 — 선별 차단 확인')

  /* ★ 임시행이 남지 않았는지 */
  const leftover = await one(`select
    (select count(*)::int from public.vaccine_accounts where drug_code='VERIFY-PURGE') a,
    (select count(*)::int from public.vaccine_events)  e`)
  P('4-4 임시행 잔류 0', leftover.a === 0 && leftover.e === 0, `VERIFY-PURGE 계정 ${leftover.a} · 이벤트 ${leftover.e}`)

  /* ── 5. 정본 대조 (기준일 2026-09-09) ── */
  const k = await one(`select
    (select count(*)::int from public.transactions)  txs,
    (select count(*)::int from public.drugs)         drugs,
    (select count(*)::int from public.drug_barcodes) barcodes,
    (select count(*)::int from public.transactions where type='조정') adj,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('5 정본 무변동 (2026-09-09)',
    k.txs === 1411 && k.drugs === 1119 && k.barcodes === 2894 && k.adj === 75
    && k.snap7.startsWith('885285628.424') && k.snap8.startsWith('101208155.9'),
    `거래 ${k.txs}/1411 · 약품 ${k.drugs}/1119 · 바코드 ${k.barcodes}/2894 · 조정 ${k.adj}/75 · 1~7월 ${k.snap7} · 8월 ${k.snap8}`)

  /* ── 6. 실사 계통 미접촉 ── */
  const inv = await one(`select
    (select count(*)::int from public.inventory_counts)      cnts,
    (select count(*)::int from public.inventory_count_items) citems`)
  P('6 실사 계통 미접촉', inv.cnts === 2 && inv.citems === 1, `inventory_counts ${inv.cnts}/2 · items ${inv.citems}/1`)

  /* 구조 무변동 — 테이블·뷰·정책이 그대로인지(삭제는 데이터만) */
  const st = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') bt,
    (select count(*)::int from information_schema.views  where table_schema='public') vw,
    (select count(*)::int from pg_policies where schemaname='public') pol`)
  P('6-2 구조 무변동', st.bt === 46 && st.vw === 5 && st.pol === 114,
    `BASE TABLE ${st.bt}/46 · VIEW ${st.vw}/5 · 정책 ${st.pol}/114`)

  console.log('─'.repeat(88))
  let pass = 0
  for (const x of R) { console.log((x.ok ? '  통과' : '★ 실패') + '  ' + x.k.padEnd(24) + ' ' + x.d); if (x.ok) pass++ }
  console.log('─'.repeat(88))
  console.log(`${pass}/${R.length} 통과 · 기준일 2026-09-09`)
  process.exitCode = pass === R.length ? 0 : 1
} catch (e) { console.error('★ 실패:', e.message); process.exitCode = 1 }
finally { await c.end() }
