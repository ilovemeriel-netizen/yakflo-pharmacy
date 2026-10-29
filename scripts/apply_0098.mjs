// apply_0098.mjs — 0098(바뀐 칸만 기록)을 운영에 **반영한다(COMMIT)**.
//
// ★ 0097 이 반영되고 **API 에서 changes 칸이 보이는 것까지 확인한 뒤에만** 돌린다
//   (scripts/check_0097_api.mjs). 순서를 바꾸면 없는 칸에 쓰려다 42703 으로 터진다.
// ★ 한 트랜잭션에서 적용하고 구조를 확인한 뒤 COMMIT 한다.
// ★ 시험 행을 만들지 않는다 — 함수·트리거만 바꾼다. 동작 시험은 dryrun 이 끝냈다.
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

const SQL = 'supabase/migrations/0098_vaccine_audit_changes_record.sql'
const ddl = readFileSync(SQL, 'utf8')

/* 보내기 전 차단 검사 */
{
  const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  for (const [re, name] of [[/drop\s+(table|policy|constraint)/i, 'DROP TABLE/POLICY/CONSTRAINT'],
    [/\b(grant|revoke)\b/i, 'GRANT/REVOKE'], [/delete\s+from/i, 'DELETE'],
    [/update\s+public\.vaccine_survey_audit/i, '기록 소급 수정'], [/append_only/i, 'append-only 가드']]) {
    if (re.test(body)) { console.error('★ 중단 — 0098 이 건드리면 안 되는 것: ' + name); process.exit(1) }
  }
  console.log('보내기 전 검사 통과 — 함수 3개 · 트리거 1개만 다룬다')
}

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(52)} ${got}`) }

await c.connect()
let committed = false
try {
  /* 선행 조건 — 0097 이 이미 반영돼 있어야 한다 */
  const pre = await one(`select count(*)::int n from information_schema.columns
     where table_schema='public' and table_name='vaccine_survey_audit' and column_name='changes'`)
  if (Number(pre.n) !== 1) { console.error('★ 중단 — 0097(changes 칸)이 먼저 반영돼 있어야 한다'); process.exit(1) }

  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_audit) rows,
    (select count(*)::int from public.vaccine_survey_audit where changes is null) nul,
    (select count(*)::int from pg_policies where schemaname='public') pol`)
  console.log(`\n기준선 — 기록 ${before.rows}행(NULL ${before.nul}) · 정책 ${before.pol}`)

  await q('begin')
  await q(ddl)

  const fn = await one(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
     where s.nspname='public' and p.proname in
       ('edit_vaccine_survey_response','set_vaccine_survey_status','log_vaccine_survey_done_change')`)
  gate('함수 3개가 있다', Number(fn.n) === 3, fn.n + '개')
  const src = await one(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
     where s.nspname='public' and p.proname in ('edit_vaccine_survey_response','set_vaccine_survey_status')
       and pg_get_functiondef(p.oid) like '%changes%'`)
  gate('두 함수가 changes 를 적는다', Number(src.n) === 2, src.n + '/2')
  const tg = await one(`select count(*)::int n from pg_trigger t join pg_class k on k.oid=t.tgrelid
     where k.relname='vaccine_survey_responses' and t.tgname='trg_vaccine_survey_done_audit'`)
  gate('접종완료 기록 트리거가 붙었다', Number(tg.n) === 1, tg.n + '개')
  const guard = await one(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
     where s.nspname='public' and p.proname='log_vaccine_survey_done_change'
       and pg_get_functiondef(p.oid) like '%auth.uid() is null%'`)
  gate('그 트리거는 로그인 사용자만 기록한다(공개 경로 보호)', Number(guard.n) === 1, guard.n + '개')
  const auth = await one(`select
    has_function_privilege('authenticated', 'public.edit_vaccine_survey_response(uuid,boolean,int,date)', 'EXECUTE') e,
    has_function_privilege('authenticated', 'public.set_vaccine_survey_status(uuid,text)', 'EXECUTE') s`)
  gate('authenticated 실행 권한 유지', auth.e === true && auth.s === true, 'edit=' + auth.e + ' status=' + auth.s)

  const after = await one(`select
    (select count(*)::int from public.vaccine_survey_audit) rows,
    (select count(*)::int from public.vaccine_survey_audit where changes is null) nul,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid
      where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only') ap`)
  gate('기록 행 수 그대로', after.rows === before.rows, before.rows + ' → ' + after.rows)
  gate('기존 기록은 아직 NULL', after.nul === before.nul, before.nul + ' → ' + after.nul)
  gate('정책 수 그대로', after.pol === before.pol, before.pol + ' → ' + after.pol)
  gate('append-only 가드 그대로', Number(after.ap) === 1, after.ap + '개')

  const ng = checks.filter(x => !x[1])
  if (ng.length) {
    await q('rollback')
    console.log(`\n★ ${ng.length}건 어긋나 ROLLBACK — 아무것도 반영하지 않았다`)
    for (const x of ng) console.log('   - ' + x[0] + ' :: ' + x[2])
    process.exitCode = 1
  } else {
    await q('commit')
    committed = true
    console.log(`\nCOMMIT 완료 — ${checks.length}/${checks.length} 통과`)
  }
} catch (e) {
  try { await q('rollback') } catch { /* 이미 끝났다 */ }
  console.error('FATAL ' + String(e.message).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[REDACTED]'))
  process.exitCode = 1
} finally {
  if (!committed && process.exitCode !== 1) { try { await q('rollback') } catch { /* 무시 */ } }
  await c.end()
}
