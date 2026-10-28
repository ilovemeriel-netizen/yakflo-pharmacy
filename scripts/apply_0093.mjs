// apply_0093.mjs — 0093+0094(백신 수요조사) 운영 적용. **COMMIT 한다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 95건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ 반드시 dryrun_0093.mjs 가 39/39 통과한 뒤에 실행한다.
// ★ 두 SQL 은 dryrun 통과본 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ **시험 행을 넣지 않는다** — dryrun 이 동작 검증(거부 트리거·검산)을 이미 했고,
//   apply 는 COMMIT 하므로 시험 데이터가 운영에 남으면 안 된다.
//   여기서는 구조·권한·정책만 확인한다.
// ★ 실패하면 자동 ROLLBACK 하고 즉시 중단한다. 임의 보정하지 않는다.
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
const rows = async (s, a) => (await q(s, a)).rows

const ddl1 = readFileSync('supabase/migrations/0093_vaccine_survey.sql', 'utf8')
const ddl2 = readFileSync('supabase/migrations/0094_vaccine_survey_grants.sql', 'utf8')

/* ── 보내기 전 차단 검사 — dryrun 과 같은 규칙 ── */
const PROTECTED = ['vaccine_public_attempts', 'vaccine_public_settings', 'vaccine_events',
  'vaccine_accounts', 'vaccine_categories', 'tenant_members', 'tenants']
{
  const body = (ddl1 + '\n' + ddl2).split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  if (/\bto\s+anon\b/i.test(body)) { console.error('★ 중단 — anon 대상 GRANT 발견'); process.exit(1) }
  const targeted = []
  for (const stmt of body.split(';')) {
    const s = stmt.trim(); if (!s) continue
    const m = s.match(/^(alter|drop|create(?:\s+or\s+replace)?)\s+(table|view|policy|trigger|index|materialized\s+view)\s+(?:if\s+exists\s+|if\s+not\s+exists\s+)?([^\s(]+)/i)
    if (m) {
      const onTbl = (s.match(/\bon\s+(?:public\.)?([a-z_]+)/i) || [])[1]
      const tgt = /trigger|policy|index/i.test(m[2]) ? onTbl : m[3].replace(/^public\./, '')
      if (tgt && PROTECTED.includes(tgt)) targeted.push(s.slice(0, 90).replace(/\s+/g, ' '))
    }
    const g = s.match(/^(grant|revoke)\b[\s\S]*?\bon\s+(?:table\s+)?(?:public\.)?([a-z_]+)/i)
    if (g && PROTECTED.includes(g[2])) targeted.push(s.slice(0, 90).replace(/\s+/g, ' '))
  }
  if (targeted.length) {
    console.error('★ 중단 — 기존 객체를 대상으로 하는 구문:\n' + targeted.map(x => '   ' + x).join('\n'))
    process.exit(1)
  }
  console.log('보내기 전 검사 통과 — 보호 객체 대상 구문 0건 · anon 대상 GRANT 0건')
}

const BASE_POLICIES = 114
const NEW_TABLES = ['vaccine_surveys', 'vaccine_survey_responses', 'vaccine_survey_audit', 'vaccine_survey_attempts']

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(50)} ${got}`) }

/* 구조·권한 검증 — 트랜잭션 안과 COMMIT 후 verify 에서 같은 함수를 쓴다 */
async function runChecks(tag, baseline) {
  checks.length = 0
  console.log(`\n===== ${tag} =====`)

  for (const t of NEW_TABLES) {
    const r = await one(`select c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=$1 and c.relkind='r'`, [t])
    gate(`${t} 생성 + RLS on`, !!r && r.rls === true, r ? 'rls=' + r.rls : '없음')
  }
  {
    const r = await one(`select coalesce(reloptions::text,'') o from pg_class where oid='public.v_vaccine_demand'::regclass`)
    gate('v_vaccine_demand + security_invoker=true', /security_invoker=true/.test(r?.o || ''), r?.o || '없음')
  }
  {
    const r = await rows(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee='anon'
        and table_name in ('vaccine_surveys','vaccine_survey_responses','vaccine_survey_audit','vaccine_survey_attempts','v_vaccine_demand')`)
    gate('anon 권한 0건', r.length === 0, r.length ? '★' + r.map(x => x.table_name + ':' + x.privilege_type).join(',') : '0건')
  }
  {
    const want = {
      vaccine_surveys: ['SELECT'],
      vaccine_survey_responses: ['SELECT', 'INSERT', 'UPDATE'],
      vaccine_survey_attempts: ['SELECT', 'INSERT', 'UPDATE'],
    }
    const miss = []
    for (const [t, ps] of Object.entries(want))
      for (const p of ps) {
        const r = await one(`select has_table_privilege('service_role',$1,$2) ok`, ['public.' + t, p])
        if (!r.ok) miss.push(t + ':' + p)
      }
    gate('service_role 필요 GRANT 전부', miss.length === 0, miss.length ? '★부족 ' + miss.join(',') : '전부 true')
  }
  {
    const d = await one(`select has_table_privilege('service_role','public.vaccine_survey_responses','DELETE') d,
                                has_table_privilege('service_role','public.vaccine_survey_audit','SELECT') a,
                                has_table_privilege('service_role','public.vaccine_survey_attempts','DELETE') ad`)
    gate('service_role 과잉 권한 없음', d.d === false && d.a === false && d.ad === false,
      `responses.DELETE=${d.d} audit.SELECT=${d.a} attempts.DELETE=${d.ad}`)
  }
  {
    const cols = await rows(`select column_name from information_schema.column_privileges
      where table_schema='public' and table_name='vaccine_survey_responses'
        and grantee='authenticated' and privilege_type='UPDATE' order by 1`)
    const got = cols.map(x => x.column_name)
    gate('responses UPDATE 는 4개 열만', JSON.stringify(got) === JSON.stringify(['done_family', 'done_self', 'status', 'updated_at']), got.join(','))
  }
  {
    const r = await one(`select has_column_privilege('authenticated','public.vaccine_survey_responses','name','UPDATE') nm,
                                has_table_privilege('authenticated','public.vaccine_survey_responses','INSERT') ins,
                                has_table_privilege('authenticated','public.vaccine_survey_responses','DELETE') del,
                                has_table_privilege('authenticated','public.vaccine_survey_attempts','SELECT') at,
                                has_table_privilege('authenticated','public.v_vaccine_demand','SELECT') vw`)
    gate('responses name UPDATE·INSERT·DELETE 불가', r.nm === false && r.ins === false && r.del === false,
      `name=${r.nm} insert=${r.ins} delete=${r.del}`)
    gate('authenticated 는 attempts 접근 불가', r.at === false, 'select=' + r.at)
    gate('authenticated 는 v_vaccine_demand 읽기 가능', r.vw === true, 'select=' + r.vw)
  }
  {
    const idx = await rows(`select indexname, indexdef from pg_indexes
      where schemaname='public' and indexname in ('vaccine_surveys_one_open_idx','vaccine_survey_responses_emp_uniq')`)
    const open1 = idx.find(x => x.indexname === 'vaccine_surveys_one_open_idx')
    const emp1 = idx.find(x => x.indexname === 'vaccine_survey_responses_emp_uniq')
    gate('부분 UNIQUE — 열린 회차 1건', !!open1 && /status = 'open'/.test(open1.indexdef), open1 ? 'OK' : '없음')
    gate('부분 UNIQUE — 사번 1회', !!emp1 && /emp_no IS NOT NULL/.test(emp1.indexdef), emp1 ? 'OK' : '없음')
  }
  {
    const tg = await rows(`select c.relname t, tg.tgname from pg_trigger tg
      join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname like 'vaccine_survey%' and not tg.tgisinternal order by 1,2`)
    const names = tg.map(x => x.t + '/' + x.tgname)
    const need = ['vaccine_survey_audit/trg_set_tenant_id', 'vaccine_survey_audit/trg_vaccine_survey_audit_append_only',
      'vaccine_survey_responses/trg_vaccine_survey_response_guard',
      'vaccine_surveys/trg_set_tenant_id', 'vaccine_surveys/trg_vaccine_survey_cats']
    gate('트리거 5개', need.every(x => names.includes(x)) && names.length === need.length, names.length + '개')
  }
  {
    const fn = await rows(`select p.proname, p.prosecdef sd from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('is_tenant_admin','purge_vaccine_survey') order by 1`)
    gate('함수 2개 + SECURITY DEFINER', fn.length === 2 && fn.every(f => f.sd === true),
      fn.map(f => f.proname + '(sd=' + f.sd + ')').join(' · '))
  }
  {
    const r = await one(`select count(*)::int p from pg_policies where schemaname='public'`)
    gate('정책 수 = 114 + 7', r.p === BASE_POLICIES + 7, `${r.p}개 (기존 ${BASE_POLICIES} + 신규 ${r.p - BASE_POLICIES})`)
  }
  {
    const r = await one(`select count(*)::int p from pg_policies where schemaname='public' and tablename='vaccine_survey_attempts'`)
    gate('attempts 정책 0건(service_role 전용)', r.p === 0, r.p + '개')
  }
  {
    const a = await one(`select
      (select count(*)::int from public.vaccine_events) events,
      (select count(*)::int from public.vaccine_public_attempts) pub_attempts,
      (select count(*)::int from public.vaccine_categories) cats,
      (select count(*)::int from pg_policies where schemaname='public' and tablename in ('vaccine_events','vaccine_accounts','vaccine_categories')) old_pol`)
    gate('기존 vaccine_events 행 수 불변', a.events === baseline.events, a.events + '행')
    gate('0091 잠금 테이블 행 수 불변', a.pub_attempts === baseline.pub_attempts, a.pub_attempts + '행')
    gate('기존 분류 행 수 불변', a.cats === baseline.cats, a.cats + '개')
    gate('기존 vaccine_* 정책 12개 불변', a.old_pol === 12, a.old_pol + '개')
  }
  {
    const r = await one(`select count(*)::int n from public.vaccine_surveys`)
    gate('새 테이블에 시험 행 0건', r.n === 0, r.n + '행')
  }

  const ng = checks.filter(x => !x[1])
  console.log(`\n  ${tag} 결과 ${checks.length - ng.length}/${checks.length} 통과${ng.length ? ' — 실패: ' + ng.map(x => x[0]).join(', ') : ''}`)
  return ng.map(x => x[0])
}

const t0 = Date.now()
await c.connect()
let committed = false
try {
  /* 재실행 방지 */
  const pre = await one(`select count(*)::int n from pg_class c join pg_namespace n2 on n2.oid=c.relnamespace
    where n2.nspname='public' and c.relname = any($1)`, [NEW_TABLES])
  if (pre.n > 0) {
    console.error(`★ 중단 — 새 테이블이 이미 ${pre.n}개 있습니다. 재적용하지 않습니다.`)
    process.exitCode = 1; await c.end(); process.exit()
  }

  const baseline = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events,
    (select count(*)::int from public.vaccine_public_attempts) pub_attempts,
    (select count(*)::int from public.vaccine_categories) cats`)
  console.log('\n===== apply 직전 기준선 =====')
  console.log('  정책 수            ' + baseline.policies + '  (기대 ' + BASE_POLICIES + ')  ' + (baseline.policies === BASE_POLICIES ? 'OK' : '★NG'))
  console.log('  vaccine_events     ' + baseline.events + '행')
  console.log('  0091 잠금 테이블    ' + baseline.pub_attempts + '행')
  console.log('  vaccine_categories ' + baseline.cats + '개')
  if (baseline.policies !== BASE_POLICIES) {
    console.error('\n★ 중단 — 정책 수가 기준선과 다릅니다. 판단 없이 멈춥니다.')
    process.exitCode = 1; await c.end(); process.exit()
  }

  console.log('\n===== BEGIN =====')
  await q('begin')
  await q(ddl1); console.log('0093 실행 완료 (테이블 4 · 뷰 1 · 함수 3 · 정책 7)')
  await q(ddl2); console.log('0094 실행 완료 (GRANT)')

  const ng = await runChecks('트랜잭션 내 검증', baseline)
  if (ng.length) {
    await q('rollback')
    console.error(`\n★ ROLLBACK 완료 — ${ng.join(', ')} 실패. 임의 수정하지 않고 중단합니다.`)
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
  const c2 = mk(); await c2.connect()
  const prev = c
  c = c2
  try {
    const ng2 = await runChecks('COMMIT 후 verify (별도 연결)', globalThis.__baseline)
    if (ng2.length) { console.error('★ verify 실패 — 수동 확인이 필요합니다.'); process.exitCode = 1 }
    else console.log('\nverify 통과 — 0093 · 0094 적용 완료.')
  } finally { c = prev; await c2.end() }
}
