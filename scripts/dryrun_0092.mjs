// dryrun_0092.mjs — 0092(백신 공개 조회 service_role GRANT) 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 92건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ BEGIN … ROLLBACK 안에서만 돌린다. 끝에서 반드시 rollback 한다.
// ★ 0092 SQL 은 파일 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ GRANT 외의 구문이 섞여 있으면 보내기 전에 중단한다.
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

/* ── 보내기 전 차단 검사 — GRANT 외 구문 금지 ── */
const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
const stmts = body.split(';').map(s => s.trim()).filter(Boolean)
const bad = stmts.filter(s => !/^grant\s+[a-z, ]+\s+on\s+public\.[a-z_]+\s+to\s+service_role$/i.test(s))
if (bad.length) { console.error('★ 중단 — GRANT 외 구문: ' + bad.map(s => s.slice(0, 60)).join(' | ')); process.exit(1) }
if (/\banon\b|\bauthenticated\b|\bpublic\s+to\b/i.test(body)) { console.error('★ 중단 — anon·authenticated 대상 구문 발견'); process.exit(1) }
console.log('  보내기 전 검사 통과 — GRANT ' + stmts.length + '문장, 대상은 service_role 뿐')

/* 함수 코드에서 뽑은 "필요한 동작" — 1번 조사 표와 같다 */
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

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(46)} ${got}`) }

async function privTable(tag) {
  console.log(`\n  [${tag}] service_role 권한`)
  console.log('    객체'.padEnd(28) + ALL.map(p => p.slice(0, 3)).join('   ') + '   필요분 충족')
  const out = {}
  for (const o of OBJS) {
    const r = await one(
      `select ${ALL.map(p => `has_table_privilege('service_role','public.${o}','${p}') as ${p.toLowerCase()}`).join(', ')}`)
    out[o] = r
    const ok = NEED[o].every(p => r[p.toLowerCase()] === true)
    console.log('    ' + o.padEnd(26) + ALL.map(p => (r[p.toLowerCase()] ? 'T' : 'f') + '     ').join('').slice(0, 24) + '  ' + (ok ? 'OK' : '★부족'))
  }
  return out
}

async function roleGrants(role) {
  const r = await q(`select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee=$1 and table_name = any($2) order by 1,2`, [role, OBJS])
  return r.rows.map(x => x.table_name + ':' + x.privilege_type).join(',')
}

await c.connect()
let rolledBack = false
try {
  const before = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events`)
  console.log(`\n기준선 — 정책 ${before.policies}개 · vaccine_events ${before.events}행`)

  const anonBefore = await roleGrants('anon')
  const authBefore = await roleGrants('authenticated')
  console.log(`  anon 권한(대상 6객체): ${anonBefore || '(없음)'}`)
  console.log(`  authenticated 권한: ${authBefore.split(',').length}건`)

  await privTable('적용 전')

  console.log('\n===== BEGIN (dryrun) =====')
  await q('begin')
  await q(ddl)
  console.log('0092 본문 실행 완료 (트랜잭션 안)')

  console.log('\n===== 검증 =====')
  const after = await privTable('적용 후')
  for (const o of OBJS) {
    const miss = NEED[o].filter(p => after[o][p.toLowerCase()] !== true)
    gate(`${o} — 필요 권한 ${NEED[o].join('/')}`, miss.length === 0, miss.length ? '부족: ' + miss.join(',') : '전부 true')
  }

  /* 과잉 부여 확인 — 필요 없는 권한이 붙지 않았는지(이미 있던 것은 제외) */
  gate('vaccine_public_settings DELETE 미부여', after.vaccine_public_settings.delete === false, 'delete=' + after.vaccine_public_settings.delete)
  for (const o of ['vaccine_accounts', 'vaccine_events', 'v_vaccine_balance']) {
    const extra = ['INSERT', 'UPDATE', 'DELETE'].filter(p => after[o][p.toLowerCase()] === true)
    gate(`${o} 쓰기 권한 미부여`, extra.length === 0, extra.length ? '★' + extra.join(',') : '없음')
  }

  /* anon·authenticated 불변 */
  const anonAfter = await roleGrants('anon'), authAfter = await roleGrants('authenticated')
  gate('anon 권한 변화 0건', anonAfter === anonBefore, anonAfter === anonBefore ? '불변' : '★변경')
  gate('authenticated 권한 변화 0건', authAfter === authBefore, authAfter === authBefore ? '불변' : '★변경')

  /* 구조 불변 */
  const a2 = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events,
    (select reloptions::text from pg_class where oid='public.v_vaccine_balance'::regclass) viewopts`)
  gate('정책 수 114 불변', a2.policies === 114 && a2.policies === before.policies, `${a2.policies}개`)
  gate('vaccine_events 행 수 불변', a2.events === before.events, `${a2.events}행 (기준 ${before.events})`)
  gate('v_vaccine_balance security_invoker 불변', /security_invoker=true/.test(a2.viewopts || ''), a2.viewopts)

  await q('rollback'); rolledBack = true
  console.log('\n===== ROLLBACK 완료 — 아무것도 반영되지 않았습니다 =====')

  const back = await privTable('롤백 후')
  const restored = OBJS.filter(o => o !== 'tenant_members').every(o => ALL.every(p => back[o][p.toLowerCase()] === false))
  gate('롤백 후 권한이 원래대로(없음)', restored, restored ? 'OK' : '★남아 있음')

  const ng = checks.filter(x => !x[1])
  console.log(`\n===== 결과 ${checks.length - ng.length}/${checks.length} 통과 =====`)
  if (ng.length) { console.error('★ 실패: ' + ng.map(x => x[0]).join(', ')); process.exitCode = 1 }
  else console.log('dryrun 통과 — apply 는 별도 지시로만 진행합니다.')
} catch (e) {
  if (!rolledBack) { try { await q('rollback'); console.error('\n★ ROLLBACK 완료') } catch { console.error('\n★ ROLLBACK 시도 실패') } }
  console.error('★ dryrun 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
