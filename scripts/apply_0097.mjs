// apply_0097.mjs — 0097(감사 기록 changes 칸 추가)을 운영에 **반영한다(COMMIT)**.
//
// ★ dryrun_0097_0098.mjs 가 전부 통과한 뒤에만 돌린다.
// ★ 한 트랜잭션에서 적용하고, 구조를 확인한 뒤 COMMIT 한다.
//   확인 중 하나라도 어긋나면 ROLLBACK 하고 아무것도 반영하지 않는다.
// ★ 자료를 건드리지 않는다 — 칸만 만든다. 기존 기록은 NULL 로 남는다.
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

const SQL = 'supabase/migrations/0097_vaccine_audit_changes_column.sql'
const ddl = readFileSync(SQL, 'utf8')

/* 보내기 전 차단 검사 */
{
  const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  for (const [re, name] of [[/drop\s+/i, 'DROP'], [/\b(grant|revoke)\b/i, 'GRANT/REVOKE'],
    [/delete\s+from/i, 'DELETE'], [/update\s+/i, 'UPDATE'], [/create\s+or\s+replace\s+function/i, '함수 변경']]) {
    if (re.test(body)) { console.error('★ 중단 — 0097 이 건드리면 안 되는 것: ' + name); process.exit(1) }
  }
  if (!/add column if not exists changes jsonb/i.test(body)) { console.error('★ 중단 — 칸 추가문이 없다'); process.exit(1) }
  console.log('보내기 전 검사 통과 — 칸 1개 추가 + 주석 + notify 뿐')
}

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(50)} ${got}`) }

await c.connect()
let committed = false
try {
  const before = await one(`select
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_audit') cols,
    (select count(*)::int from public.vaccine_survey_audit) rows,
    (select count(*)::int from pg_policies where schemaname='public') pol`)
  console.log(`\n기준선 — audit 칸 ${before.cols} · 기록 ${before.rows}행 · 정책 ${before.pol}`)

  await q('begin')
  await q(ddl)

  const col = await one(`select data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='vaccine_survey_audit' and column_name='changes'`)
  gate('changes 칸이 jsonb 로 생겼다', !!col && col.data_type === 'jsonb', col ? col.data_type : '(없음)')
  gate('NULL 허용이다', !!col && col.is_nullable === 'YES', col ? col.is_nullable : '-')
  const after = await one(`select
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_audit') cols,
    (select count(*)::int from public.vaccine_survey_audit) rows,
    (select count(*)::int from public.vaccine_survey_audit where changes is null) nul,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid
      where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only') ap`)
  gate('칸이 1개만 늘었다', after.cols === before.cols + 1, before.cols + ' → ' + after.cols)
  gate('기록 행 수 그대로', after.rows === before.rows, before.rows + ' → ' + after.rows)
  gate('기존 기록은 전부 NULL(소급 없음)', after.nul === before.rows, after.nul + '/' + before.rows)
  gate('정책 수 그대로', after.pol === before.pol, before.pol + ' → ' + after.pol)
  gate('append-only 가드 그대로', Number(after.ap) === 1, after.ap + '개')

  const ng = checks.filter(x => !x[1])
  if (ng.length) {
    await q('rollback')
    console.log(`\n★ ${ng.length}건 어긋나 ROLLBACK — 아무것도 반영하지 않았다`)
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
