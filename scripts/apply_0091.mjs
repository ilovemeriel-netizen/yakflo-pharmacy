// apply_0091.mjs — 백신 공개 조회 DB 준비(0091) 운영 적용. **COMMIT 한다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 91건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ 반드시 dryrun_0091.mjs 가 13/13 통과한 뒤에 실행한다.
// ★ 0091 SQL 은 dryrun 통과본 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ 실패하면 자동 ROLLBACK 하고 즉시 중단한다. 임의 보정하지 않는다.
// ★ 기준선(BASE TABLE 46 · 정책 114 · 이벤트 39 · 계정 5)이 다르면 보내기 전에 멈춘다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

function rd(p) {
  const o = {}; if (!existsSync(p)) return o
  let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return o
}
const env = rd('.env'); let url = env.DATABASE_URL || ''; if (/\/postgre$/.test(url)) url += 's'
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const q = (s, a) => c.query(s, a)
const one = async (s, a) => (await q(s, a)).rows[0]

const SQL = 'supabase/migrations/0091_vaccine_public_access.sql'
const ddl = readFileSync(SQL, 'utf8')
  .replace(/^\s*begin;\s*$/mi, '').replace(/^\s*commit;\s*$/mi, '')

/* ── 보내기 전 차단 검사 — dryrun_0091.mjs 와 같은 규칙 ──
   주석(-- …)을 걷어낸 실행 본문만 본다(롤백 안내 주석의 drop 을 오탐하지 않기 위해서다). */
const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
const BANNED = [
  [/\bvaccine_events\b/i, 'vaccine_events 접촉'],
  [/\bv_vaccine_balance\b/i, 'v_vaccine_balance 접촉'],
  [/\bgrant\b/i, 'grant'],
  [/\brevoke\b/i, 'revoke'],
  [/\bcreate\s+policy\b/i, 'create policy'],
  [/\bdrop\s+policy\b/i, 'drop policy'],
  [/\bcreate\s+trigger\b/i, 'create trigger'],
  [/\bdrop\s+table\b/i, 'drop table'],
  [/\btruncate\b/i, 'truncate'],
  [/\bdelete\s+from\b/i, 'delete from'],
]
const hit = BANNED.filter(([re]) => re.test(body)).map(([, n]) => n)
if (hit.length) { console.error('★ 중단 — 실행 구문에 금지 대상: ' + hit.join(', ')); process.exit(1) }
console.log('보내기 전 차단 검사 통과 — 금지 구문 없음 (검사 대상 ' + body.split(';').filter(s => s.trim()).length + '문장)')

const EXPECT_LABEL = {
  'TT-FLU44': '독감(유료)',
  'TETRA6': '독감(국가무료)',
  'TETRA5': '독감(지자체)',
  'SPIKVX': '코로나(모더나)',
  'CMNTLP': '코로나(화이자)',
}
const EXPECT_BAL = { CMNTLP: 16, SPIKVX: 0, TETRA6: 30, 'TT-FLU44': 32, TETRA5: 20 }
const NEW_TBL = ['vaccine_public_settings', 'vaccine_public_attempts']
/* 지시서가 고정한 기준선 — 다르면 보내지 않는다 */
const BASELINE = { basetables: 46, policies: 114, events: 39, accounts: 5 }

/* [검증] 1~11 — apply 트랜잭션 안과 commit 후 verify 에서 같은 함수를 쓴다 */
async function runChecks(tag) {
  const out = []
  const gate = (n, ok, got) => { out.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(38)} ${got}`) }

  const col = await one(`select data_type, is_nullable from information_schema.columns
    where table_schema='public' and table_name='vaccine_accounts' and column_name='public_label'`)
  gate('1. public_label 컬럼 (text·nullable)', !!col && col.data_type === 'text' && col.is_nullable === 'YES',
    col ? `${col.data_type} / nullable=${col.is_nullable}` : '없음')

  const chk = await one(`select pg_get_constraintdef(oid) d from pg_constraint
    where conrelid='public.vaccine_accounts'::regclass and conname='vaccine_accounts_public_label_chk'`)
  gate('2. CHECK 제약 (1~30자)', !!chk && /char_length/.test(chk.d), chk ? '존재' : '없음')

  const lbl = (await q(`select a.drug_code, a.public_label from public.vaccine_accounts a
    join public.tenants t on t.id=a.tenant_id
    where t.slug='cnc' and a.season='2026-2027' order by a.drug_code`)).rows
  const labelOk = lbl.length === 5 && lbl.every(r => EXPECT_LABEL[r.drug_code] === r.public_label)
  gate('3. cnc 2026-2027 표시명 5행 일치', labelOk, `${lbl.length}행`)
  lbl.forEach(r => console.log(`         ${String(r.drug_code).padEnd(10)} ${r.public_label}${EXPECT_LABEL[r.drug_code] === r.public_label ? '' : '  ★기대 ' + EXPECT_LABEL[r.drug_code]}`))

  const filled = await one(`select count(*)::int n from public.vaccine_accounts where public_label is not null`)
  gate('4. public_label NOT NULL 행 = 5', filled.n === 5, `${filled.n}행`)

  let i = 5
  for (const t of NEW_TBL) {
    const r = await one(`select relrowsecurity rls from pg_class where oid=('public.'||$1)::regclass`, [t])
    const p = await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename=$1`, [t])
    gate(`${i}. ${t} RLS on + 정책 0`, !!r && r.rls === true && p.n === 0, `rls=${r ? r.rls : '?'} / 정책 ${p.n}개`)
    i++
  }

  const gr = await q(`select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated')`, [NEW_TBL])
  gate('7. anon·authenticated 권한 0건', gr.rows.length === 0, `${gr.rows.length}건`)
  gr.rows.forEach(r => console.log(`         ★ ${r.grantee} / ${r.table_name} / ${r.privilege_type}`))

  const bal = {}
  for (const r of (await q(`select drug_code, balance_qty::int bq from public.v_vaccine_balance`)).rows) bal[r.drug_code] = r.bq
  const balOk = Object.keys(EXPECT_BAL).length === Object.keys(bal).length
    && Object.entries(EXPECT_BAL).every(([k, v]) => bal[k] === v)
  gate('8. v_vaccine_balance 5행 불변', balOk, Object.entries(bal).map(([k, v]) => `${k}:${v}`).join(' · '))

  const ev = await one(`select count(*)::int n from public.vaccine_events`)
  gate('9. vaccine_events 39행 불변', ev.n === BASELINE.events, `${ev.n}행`)

  const pol = await one(`select count(*)::int n from pg_policies where schemaname='public'`)
  gate('10. 기존 정책 수 114 불변', pol.n === BASELINE.policies, `${pol.n}개`)

  const bt = await one(`select count(*)::int n from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE'`)
  gate('11. BASE TABLE 48', bt.n === BASELINE.basetables + 2, `${bt.n}개`)

  const ng = out.filter(x => !x[1])
  console.log(`\n  ${tag} 결과 ${out.length - ng.length}/${out.length} 통과${ng.length ? ' — 실패: ' + ng.map(x => x[0]).join(', ') : ''}`)
  return ng
}

const t0 = Date.now()
await c.connect()
let committed = false
try {
  /* ── 재실행 방지 ── */
  const ex = await one(`select
    (select count(*)::int from information_schema.columns
      where table_schema='public' and table_name='vaccine_accounts' and column_name='public_label') col,
    (select count(*)::int from information_schema.tables
      where table_schema='public' and table_name = any($1)) tbl`, [NEW_TBL])
  if (ex.col > 0 || ex.tbl > 0) {
    console.error(`★ 중단 — 이미 적용됨 (public_label ${ex.col}개 · 신규 테이블 ${ex.tbl}개). 재적용하지 않습니다.`)
    process.exitCode = 1; await c.end(); process.exit()
  }

  /* ── apply 직전 기준선 재측정 — 다르면 보내지 않는다 ── */
  const base = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') basetables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events,
    (select count(*)::int from public.vaccine_accounts) accounts`)
  console.log('\n===== apply 직전 기준선 재측정 =====')
  let drift = []
  for (const k of Object.keys(BASELINE)) {
    const ok = base[k] === BASELINE[k]
    if (!ok) drift.push(`${k} ${base[k]} (기대 ${BASELINE[k]})`)
    console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(k).padEnd(12)} ${base[k]}  (기대 ${BASELINE[k]})`)
  }
  if (drift.length) {
    console.error('\n★ 중단 — 기준선이 다릅니다: ' + drift.join(' · ') + '. 판단 없이 멈춥니다.')
    process.exitCode = 1; await c.end(); process.exit()
  }

  /* ── 트랜잭션 ── */
  console.log('\n===== BEGIN =====')
  await q('begin')

  const res = await q(ddl)
  /* 0091 의 마지막 문장이 UPDATE 다 — 영향 행 수가 5가 아니면 멈춘다 */
  const last = Array.isArray(res) ? res[res.length - 1] : res
  const affected = last && typeof last.rowCount === 'number' ? last.rowCount : null
  console.log(`0091 본문 실행 완료 — UPDATE 영향 행 수 = ${affected === null ? '(미확인)' : affected}`)
  if (affected !== 5) {
    await q('rollback')
    console.error(`★ ROLLBACK 완료 — UPDATE 영향 행 수가 ${affected} 입니다(기대 5). 판단 없이 멈춥니다.`)
    process.exitCode = 1; await c.end(); process.exit()
  }

  console.log('\n===== 트랜잭션 내 검증 =====')
  const ng = await runChecks('트랜잭션 내')

  if (ng.length) {
    await q('rollback')
    console.error(`\n★ ROLLBACK 완료 — ${ng.map(x => x[0]).join(', ')} 실패. 임의 수정하지 않고 중단합니다.`)
    process.exitCode = 1
  } else {
    await q('commit'); committed = true
    console.log('\n===== COMMIT 완료 =====')
    console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(2)}초`)
  }
} catch (e) {
  if (!committed) { try { await q('rollback'); console.error('\n★ ROLLBACK 완료') } catch { console.error('\n★ ROLLBACK 시도 실패') } }
  console.error('★ 적용 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }

/* ── COMMIT 후 별도 연결로 재검증 ── */
if (committed) {
  const c2 = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c2.connect()
  const prev = c.query.bind(c)
  c.query = c2.query.bind(c2)   /* runChecks 가 쓰는 q/one 을 새 연결로 돌린다 */
  try {
    console.log('\n===== COMMIT 후 verify (별도 연결) =====')
    const ng2 = await runChecks('verify')
    if (ng2.length) { console.error('★ verify 실패 — 수동 확인이 필요합니다.'); process.exitCode = 1 }
    else console.log('\nverify 통과 — 0091 적용 완료.')
  } finally { c.query = prev; await c2.end() }
}
