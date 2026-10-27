// apply_0092.mjs — 백신 공개 조회 service_role GRANT(0092) 운영 적용. **COMMIT 한다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 92건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ 반드시 dryrun_0092.mjs 가 16/16 통과한 뒤에 실행한다.
// ★ 0092 SQL 은 dryrun 통과본 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ 실패하면 자동 ROLLBACK 하고 즉시 중단한다. 임의 보정하지 않는다.
// ★ 기준선(정책 114 · anon/authenticated 권한 목록)이 다르면 보내기 전에 멈춘다.
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

const SQL = 'supabase/migrations/0092_vaccine_public_grants.sql'
const ddl = readFileSync(SQL, 'utf8').replace(/^\s*begin;\s*$/mi, '').replace(/^\s*commit;\s*$/mi, '')

/* ── 보내기 전 차단 검사 — GRANT 5문장, 대상 service_role 뿐 ── */
const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
const stmts = body.split(';').map(s => s.trim()).filter(Boolean)
const bad = stmts.filter(s => !/^grant\s+[a-z, ]+\s+on\s+public\.[a-z_]+\s+to\s+service_role$/i.test(s))
if (bad.length) { console.error('★ 중단 — GRANT 외 구문: ' + bad.map(s => s.slice(0, 60)).join(' | ')); process.exit(1) }
if (stmts.length !== 5) { console.error(`★ 중단 — 실행 문장 ${stmts.length}개 (기대 5)`); process.exit(1) }
if (/\banon\b|\bauthenticated\b/i.test(body)) { console.error('★ 중단 — anon·authenticated 대상 구문 발견'); process.exit(1) }
console.log('보내기 전 차단 검사 통과 — GRANT 5문장, 대상은 service_role 뿐')

const NEED = {
  vaccine_public_settings: ['SELECT', 'INSERT', 'UPDATE'],
  vaccine_public_attempts: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  vaccine_accounts: ['SELECT'],
  vaccine_events: ['SELECT'],
  v_vaccine_balance: ['SELECT'],
  tenant_members: ['SELECT'],
}
const OBJS = Object.keys(NEED)
const ALL = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const READONLY_OBJS = ['vaccine_accounts', 'vaccine_events', 'v_vaccine_balance']
/* dryrun 기준선 — 다르면 보내지 않는다 */
const BASE_POLICIES = 114

async function privOf() {
  const out = {}
  for (const o of OBJS) {
    out[o] = await one(`select ${ALL.map(p => `has_table_privilege('service_role','public.${o}','${p}') as ${p.toLowerCase()}`).join(', ')}`)
  }
  return out
}
function printPriv(tag, p) {
  console.log(`\n  [${tag}] service_role 권한`)
  console.log('    ' + '객체'.padEnd(26) + 'SEL  INS  UPD  DEL   필요분')
  for (const o of OBJS) {
    const r = p[o]
    const ok = NEED[o].every(x => r[x.toLowerCase()] === true)
    console.log('    ' + o.padEnd(26) + ALL.map(x => (r[x.toLowerCase()] ? 'T' : 'f') + '    ').join('').slice(0, 21) + '  ' + (ok ? 'OK' : '★부족'))
  }
}
async function roleGrants(role) {
  const r = await q(`select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee=$1 and table_name = any($2) order by 1,2`, [role, OBJS])
  return r.rows.map(x => x.table_name + ':' + x.privilege_type).join(',')
}

/* [검증] 1~15 — 트랜잭션 안과 commit 후 verify 에서 같은 함수를 쓴다 */
async function runChecks(tag, baseline) {
  const out = []
  const gate = (n, ok, got) => { out.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(46)} ${got}`) }
  const p = await privOf()
  printPriv(tag, p)
  console.log('')

  for (const o of OBJS) {
    const miss = NEED[o].filter(x => p[o][x.toLowerCase()] !== true)
    gate(`${o} — 필요 권한 ${NEED[o].join('/')}`, miss.length === 0, miss.length ? '부족: ' + miss.join(',') : '전부 true')
  }
  gate('vaccine_public_settings DELETE 미부여', p.vaccine_public_settings.delete === false, 'delete=' + p.vaccine_public_settings.delete)
  for (const o of READONLY_OBJS) {
    const extra = ['INSERT', 'UPDATE', 'DELETE'].filter(x => p[o][x.toLowerCase()] === true)
    gate(`${o} 쓰기 권한 미부여`, extra.length === 0, extra.length ? '★' + extra.join(',') : '없음')
  }
  const anonNow = await roleGrants('anon'), authNow = await roleGrants('authenticated')
  gate('anon 권한 변화 0건', anonNow === baseline.anon, anonNow === baseline.anon ? '불변' : '★변경')
  gate('authenticated 권한 변화 0건', authNow === baseline.auth, authNow === baseline.auth ? '불변' : '★변경')

  const s = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events,
    (select reloptions::text from pg_class where oid='public.v_vaccine_balance'::regclass) viewopts`)
  gate('정책 수 114 불변', s.policies === BASE_POLICIES, `${s.policies}개`)
  gate('vaccine_events 행 수 불변', s.events === baseline.events, `${s.events}행 (기준 ${baseline.events})`)
  gate('v_vaccine_balance security_invoker 불변', /security_invoker=true/.test(s.viewopts || ''), s.viewopts)

  const ng = out.filter(x => !x[1])
  console.log(`\n  ${tag} 결과 ${out.length - ng.length}/${out.length} 통과${ng.length ? ' — 실패: ' + ng.map(x => x[0]).join(', ') : ''}`)
  return ng
}

const t0 = Date.now()
await c.connect()
let committed = false
try {
  /* ── 재실행 방지 — 이미 전부 부여돼 있으면 멈춘다 ── */
  const pre = await privOf()
  const already = OBJS.every(o => NEED[o].every(x => pre[o][x.toLowerCase()] === true))
  if (already) {
    console.error('★ 중단 — 필요한 권한이 이미 전부 부여돼 있습니다. 재적용하지 않습니다.')
    process.exitCode = 1; await c.end(); process.exit()
  }

  /* ── apply 직전 기준선 재측정 ── */
  const baseline = {
    anon: await roleGrants('anon'),
    auth: await roleGrants('authenticated'),
    ...(await one(`select
      (select count(*)::int from pg_policies where schemaname='public') policies,
      (select count(*)::int from public.vaccine_events) events`)),
  }
  console.log('\n===== apply 직전 기준선 재측정 =====')
  console.log('  정책 수            ' + baseline.policies + '  (기대 ' + BASE_POLICIES + ')  ' + (baseline.policies === BASE_POLICIES ? 'OK' : '★NG'))
  console.log('  vaccine_events     ' + baseline.events + '행')
  console.log('  anon 권한(6객체)   ' + (baseline.anon ? baseline.anon.split(',').length + '건' : '0건'))
  console.log('  authenticated 권한 ' + (baseline.auth ? baseline.auth.split(',').length + '건' : '0건'))
  if (baseline.policies !== BASE_POLICIES) {
    console.error('\n★ 중단 — 정책 수가 기준선과 다릅니다. 판단 없이 멈춥니다.')
    process.exitCode = 1; await c.end(); process.exit()
  }
  printPriv('적용 전', pre)

  /* ── 트랜잭션 ── */
  console.log('\n===== BEGIN =====')
  await q('begin')
  await q(ddl)
  console.log('0092 본문 실행 완료 (GRANT 5문장)')

  console.log('\n===== 트랜잭션 내 검증 =====')
  const ng = await runChecks('트랜잭션 내', baseline)

  if (ng.length) {
    await q('rollback')
    console.error(`\n★ ROLLBACK 완료 — ${ng.map(x => x[0]).join(', ')} 실패. 임의 수정하지 않고 중단합니다.`)
    process.exitCode = 1
  } else {
    await q('commit'); committed = true
    console.log('\n===== COMMIT 완료 =====')
    console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(2)}초`)
    globalThis.__baseline = baseline
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
    const ng2 = await runChecks('verify', globalThis.__baseline)
    if (ng2.length) { console.error('★ verify 실패 — 수동 확인이 필요합니다.'); process.exitCode = 1 }
    else console.log('\nverify 통과 — 0092 적용 완료.')
  } finally { c.query = prev; await c2.end() }
}
