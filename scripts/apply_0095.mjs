// apply_0095.mjs — 0095 운영 적용. **COMMIT 한다.**
//
// ★ 반드시 dryrun_0095.mjs 가 31/31 통과한 뒤 실행한다.
// ★ 운영에는 이정화 님의 **진행 중인 회차(status=open)와 신청 2건**이 있다.
//   이 스크립트는 그 데이터를 읽기만 하고, 시험 행을 **COMMIT 하지 않는다**.
//   동작 검증(실제 권한에서의 INSERT 성공/거부)은 dryrun 과 verify 가 맡는다.
// ★ 실패하면 자동 ROLLBACK 하고 즉시 중단한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

function rd(p) {
  const o = {}; if (!existsSync(p)) return o
  let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return o
}
const env = rd('.env'); let url = env.DATABASE_URL || ''; if (/\/postgre$/.test(url)) url += 's'
const mk = () => new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
let c = mk()
const q = (s, a) => c.query(s, a)
const one = async (s, a) => (await q(s, a)).rows[0]

const ddl = readFileSync('supabase/migrations/0095_vaccine_survey_audit_fill.sql', 'utf8')

/* ── 보내기 전 차단 검사 — dryrun 과 같은 규칙 ── */
{
  const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  if (/create\s+policy|drop\s+policy|alter\s+policy/i.test(body)) {
    console.error('★ 중단 — 정책을 건드리는 구문 발견'); process.exit(1)
  }
  if (/\bto\s+(anon|authenticated|service_role)\b/i.test(body)) {
    console.error('★ 중단 — GRANT 구문 발견'); process.exit(1)
  }
  const allowed = ['fill_vaccine_survey_audit', 'trg_vaccine_survey_audit_fill', 'trg_set_tenant_id']
  for (const stmt of body.split(';')) {
    const s = stmt.trim(); if (!s) continue
    const m = s.match(/^(create(?:\s+or\s+replace)?|drop)\s+(trigger|function)\s+(?:if\s+exists\s+)?([^\s(]+)/i)
    if (m && !allowed.some(a => s.includes(a))) {
      console.error('★ 중단 — 허용 밖 객체: ' + s.slice(0, 70)); process.exit(1)
    }
  }
  console.log('보내기 전 검사 통과 — 트리거·함수만, 정책·GRANT 무변경')
}

const BASE_POLICIES = 121
const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(50)} ${got}`) }

async function runChecks(tag, baseline) {
  checks.length = 0
  console.log(`\n===== ${tag} =====`)
  {
    const tg = await one(`select t.tgname, p.proname from pg_trigger t
      join pg_class cl on cl.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
      where cl.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_fill'`)
    gate('채움 트리거 존재', !!tg, tg ? tg.tgname + ' → ' + tg.proname : '없음')
  }
  {
    const n = await one(`select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
      where cl.relname='vaccine_survey_audit' and t.tgname='trg_set_tenant_id'`)
    gate('범용 tenant 트리거 제거', n.n === 0, n.n + '개')
  }
  {
    const n = await one(`select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
      where cl.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only'`)
    gate('append-only 가드 그대로', n.n === 1, n.n + '개')
  }
  {
    const f = await one(`select p.prosecdef sd, pg_get_functiondef(p.oid) d from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='fill_vaccine_survey_audit'`)
    gate('함수 SECURITY DEFINER + search_path 고정',
      !!f && f.sd === true && /search_path TO 'public', 'pg_temp'/.test(f.d), f ? 'sd=' + f.sd : '없음')
    gate('함수가 tenant_id·user_id 를 덮어쓴다',
      !!f && /new\.tenant_id\s*:=/.test(f.d) && /new\.user_id\s*:=\s*auth\.uid\(\)/.test(f.d), '대입 2곳')
  }
  {
    const wc = await one(`select coalesce(with_check,'') w from pg_policies
      where schemaname='public' and tablename='vaccine_survey_audit' and cmd='INSERT'`)
    gate('INSERT 정책 WITH CHECK 세 조건 유지',
      /current_tenant_ids/.test(wc.w) && /is_tenant_admin/.test(wc.w) && /user_id = auth\.uid\(\)/.test(wc.w),
      '느슨해지지 않음')
  }
  {
    const a = await one(`select
      (select count(*)::int from pg_policies where schemaname='public') pol,
      (select count(*)::int from public.vaccine_survey_audit) audit_rows,
      (select count(*)::int from public.vaccine_surveys) surveys,
      (select count(*)::int from public.vaccine_survey_responses) responses,
      (select count(*)::int from public.vaccine_events) events,
      (select count(*)::int from public.tenants) tenants`)
    gate('정책 수 121 불변', a.pol === BASE_POLICIES, a.pol + '개')
    gate('운영 회차 수 불변', a.surveys === baseline.surveys, a.surveys + '건')
    gate('운영 신청 수 불변', a.responses === baseline.responses, a.responses + '건')
    gate('기록 행 수 불변(시험 행 없음)', a.audit_rows === baseline.audit_rows, a.audit_rows + '행')
    gate('vaccine_events 불변', a.events === baseline.events, a.events + '행')
    gate('tenants 수 불변(진단용 tenant 없음)', a.tenants === baseline.tenants, a.tenants + '개')
  }
  const ng = checks.filter(x => !x[1])
  console.log(`\n  ${tag} 결과 ${checks.length - ng.length}/${checks.length} 통과${ng.length ? ' — 실패: ' + ng.map(x => x[0]).join(', ') : ''}`)
  return ng.map(x => x[0])
}

const t0 = Date.now()
await c.connect()
let committed = false
try {
  const pre = await one(`select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_fill'`)
  if (pre.n > 0) {
    console.error('★ 중단 — 채움 트리거가 이미 있습니다. 재적용하지 않습니다.')
    process.exitCode = 1; await c.end(); process.exit()
  }

  const baseline = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_surveys) surveys,
    (select count(*)::int from public.vaccine_survey_responses) responses,
    (select count(*)::int from public.vaccine_events) events,
    (select count(*)::int from public.tenants) tenants`)
  console.log('\n===== apply 직전 기준선 =====')
  console.log('  정책 ' + baseline.pol + ' · 회차 ' + baseline.surveys + ' · 신청 ' + baseline.responses
    + ' · 기록 ' + baseline.audit_rows + ' · events ' + baseline.events + ' · tenants ' + baseline.tenants)
  if (baseline.pol !== BASE_POLICIES) {
    console.error('\n★ 중단 — 정책 수가 기준선과 다릅니다.')
    process.exitCode = 1; await c.end(); process.exit()
  }

  console.log('\n===== BEGIN =====')
  await q('begin')
  await q(ddl)
  console.log('0095 실행 완료')

  const ng = await runChecks('트랜잭션 내 검증', baseline)
  if (ng.length) {
    await q('rollback')
    console.error(`\n★ ROLLBACK 완료 — ${ng.join(', ')} 실패.`)
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

if (committed) {
  const c2 = mk(); await c2.connect()
  const prev = c; c = c2
  try {
    const ng2 = await runChecks('COMMIT 후 verify (별도 연결)', globalThis.__baseline)
    if (ng2.length) { console.error('★ verify 실패 — 수동 확인이 필요합니다.'); process.exitCode = 1 }
    else console.log('\nverify 통과 — 0095 적용 완료. 동작 확인은 verify_0095.mjs 로 한다.')
  } finally { c = prev; await c2.end() }
}
