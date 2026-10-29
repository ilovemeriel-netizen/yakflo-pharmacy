// apply_0102.mjs — 0102(입력 제한 중 접수 표시)를 운영에 **반영한다(COMMIT)**.
//
// ★ --dry 를 주면 확인만 하고 ROLLBACK 한다(사전 점검).
// ★ 칸 하나를 더할 뿐이고 기본값이 거짓이라 기존 행·동작이 바뀌지 않는다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
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

const ddl = readFileSync('supabase/migrations/0102_vaccine_survey_locked_bypass.sql', 'utf8')
for (const line of ddl.split(/\r?\n/)) {
  if (/^\s*--/.test(line)) continue
  if (/drop\s+|truncate|delete\s+from|^\s*(grant|revoke)\b|update\s+public\./i.test(line)) {
    console.error('★ 중단 — 위험한 문장: ' + line.trim().slice(0, 70)); process.exit(1)
  }
}
console.log('보내기 전 검사 통과 — 칸 1개 추가 + 주석 + notify 뿐' + (DRY ? ' (사전 점검)' : ''))

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(44)} ${got}`) }

await c.connect()
let done = false
try {
  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_responses') rcols,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_attempts') acols`)
  console.log(`\n기준선 — 응답 ${before.resp}행 · 기록 ${before.audit}행 · 정책 ${before.pol} · responses 칸 ${before.rcols}`)

  await q('begin')
  await q(ddl)

  const r = await one(`select
    (select count(*)::int from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_responses' and column_name='locked_bypass') col,
    (select is_nullable from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_responses' and column_name='locked_bypass') nul,
    (select count(*)::int from public.vaccine_survey_responses where locked_bypass) on_,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from information_schema.columns
      where table_schema='public' and table_name='vaccine_survey_responses') rcols,
    (select count(*)::int from information_schema.columns
      where table_schema='public' and table_name='vaccine_survey_attempts') acols,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid
      where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only') ap`)
  gate('locked_bypass 칸이 생겼다', Number(r.col) === 1, r.col + '개')
  gate('NOT NULL + 기본값 거짓', r.nul === 'NO', String(r.nul))
  gate('기존 행은 전부 거짓', Number(r.on_) === 0, r.on_ + '행')
  gate('칸이 1개만 늘었다', Number(r.rcols) === Number(before.rcols) + 1, before.rcols + ' → ' + r.rcols)
  gate('정책 수 그대로', r.pol === before.pol, before.pol + ' → ' + r.pol)
  gate('응답 행 수 그대로', r.resp === before.resp, before.resp + ' → ' + r.resp)
  gate('기록 행 수 그대로', r.audit === before.audit, before.audit + ' → ' + r.audit)
  gate('★ 기존 attempts 칸 수 그대로', Number(r.acols) === Number(before.acols), before.acols + ' → ' + r.acols)
  gate('append-only 가드 그대로', Number(r.ap) === 1, r.ap + '개')

  const ng = checks.filter(x => !x[1])
  if (ng.length || DRY) {
    await q('rollback')
    done = true
    console.log(ng.length
      ? `\n★ ${ng.length}건 어긋나 ROLLBACK`
      : `\nROLLBACK 완료 — ${checks.length}/${checks.length} 통과 (사전 점검 · 운영 변경 없음)`)
    process.exitCode = ng.length ? 1 : 0
  } else {
    await q('commit')
    done = true
    console.log(`\nCOMMIT 완료 — ${checks.length}/${checks.length} 통과`)
  }
} catch (e) {
  try { await q('rollback') } catch { /* 이미 끝났다 */ }
  console.error('FATAL ' + String(e.message).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[REDACTED]'))
  process.exitCode = 1
} finally {
  if (!done) { try { await q('rollback') } catch { /* 무시 */ } }
  await c.end()
}
