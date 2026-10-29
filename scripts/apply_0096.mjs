// apply_0096.mjs — 0096 을 운영에 **반영한다(COMMIT)**.
//
// ★ dryrun_0096.mjs 가 48/48 통과한 뒤에만 돌린다.
// ★ 한 트랜잭션 안에서 적용하고, 적용 직후 구조를 확인한 뒤 COMMIT 한다.
//   확인 중 하나라도 어긋나면 ROLLBACK 하고 아무것도 반영하지 않는다.
// ★ 시험 행을 만들지 않는다 — 운영 자료를 건드리지 않는다.
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

const ddl = readFileSync('supabase/migrations/0096_vaccine_survey_admin_edit.sql', 'utf8')

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(56)} ${got}`) }

await c.connect()
let done = false
try {
  const before = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_survey_responses) responses,
    (select count(*)::int from public.vaccine_events) events`)
  console.log(`기준선 — 정책 ${before.pol} · 응답 ${before.responses} · 기록 ${before.audit_rows}행 · 접종 ${before.events}행`)

  await q('begin')
  await q(ddl)
  console.log('0096 실행 완료 — 확인 중')

  const ck = await one(`select pg_get_constraintdef(oid) d from pg_constraint
    where conrelid='public.vaccine_survey_audit'::regclass and conname='vaccine_survey_audit_action_chk'`)
  gate('action CHECK 7종', ck && ["'view_raw'", "'export_pdf'", "'export_xlsx'", "'purge'", "'edit'", "'cancel'", "'restore'"]
    .every(a => ck.d.includes(a)), ck ? '7종 확인' : '없음')

  for (const fn of ['assert_survey_response_admin', 'edit_vaccine_survey_response', 'set_vaccine_survey_status']) {
    const f = await one(`select p.prosecdef sd, pg_get_functiondef(p.oid) d from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
    gate(`${fn} 생성 + SECURITY DEFINER + search_path`,
      f && f.sd === true && /search_path TO 'public', 'pg_temp'/.test(f.d), f ? 'sd=' + f.sd : '없음')
  }

  const ex = await one(`select
    (select count(*)::int from information_schema.routine_privileges
      where routine_schema='public' and routine_name='edit_vaccine_survey_response' and grantee='authenticated') a,
    (select count(*)::int from information_schema.routine_privileges
      where routine_schema='public' and routine_name='set_vaccine_survey_status' and grantee='authenticated') b`)
  gate('두 함수에 authenticated EXECUTE', ex.a > 0 && ex.b > 0, `edit=${ex.a} status=${ex.b}`)

  const g = await one(`select coalesce(string_agg(column_name, ',' order by column_name),'(없음)') c
    from information_schema.column_privileges
    where table_schema='public' and table_name='vaccine_survey_responses'
      and grantee='authenticated' and privilege_type='UPDATE'`)
  gate('★ status 회수 · 나머지 3열 유지', g.c === 'done_family,done_self,updated_at', g.c)

  const after = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_survey_responses) responses,
    (select count(*)::int from public.vaccine_events) events`)
  gate('정책 수 불변', after.pol === before.pol, `${after.pol} (기준선 ${before.pol})`)
  gate('기록 행 수 불변(시험 행 0건)', after.audit_rows === before.audit_rows, after.audit_rows + '행')
  gate('응답 수 불변', after.responses === before.responses, after.responses + '행')
  gate('접종 행 수 불변', after.events === before.events, after.events + '행')

  const bad = checks.filter(x => !x[1])
  if (bad.length) {
    await q('rollback')
    console.error('\n★ 확인 실패 — ROLLBACK 했습니다: ' + bad.map(x => x[0]).join(' / '))
    process.exitCode = 1
  } else {
    await q('commit'); done = true
    console.log('\n===== COMMIT 완료 — 0096 이 운영에 반영되었습니다 =====')
  }
} catch (e) {
  console.error('\n★ 예외: ' + e.code + ' ' + e.message)
  try { await q('rollback') } catch { /* 이미 닫힘 */ }
  process.exitCode = 1
} finally {
  await c.end()
}
const ok = checks.filter(x => x[1]).length
console.log(`결과 ${ok}/${checks.length}${done ? ' · 반영됨' : ' · 반영 안 됨'}`)
