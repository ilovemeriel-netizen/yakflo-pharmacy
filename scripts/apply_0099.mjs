// apply_0099.mjs — 0099 를 운영에 **반영한다(COMMIT)**.
//
// ★ dryrun_0099_0100.mjs 가 전부 통과한 뒤에만 돌린다.
// ★ 한 트랜잭션에서 적용하고 구조를 확인한 뒤 COMMIT 한다. 어긋나면 ROLLBACK.
// ★ 자료를 바꾸지 않는다. 기존 vaccine_survey_attempts 는 **건드리지 않는다**
//   (배포된 코드가 그 PK 로 upsert 한다 — 바꾸면 제출 제한이 조용히 멈춘다).
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

const ddl = readFileSync('supabase/migrations/0099_vaccine_survey_dup_policy.sql', 'utf8')

/* 보내기 전 차단 검사 */
{
  for (const line of ddl.split(/\r?\n/)) {
    if (/^\s*--/.test(line)) continue
    if (/drop\s+(table|policy)|truncate/i.test(line)) { console.error('★ 중단 — 위험한 문장: ' + line.trim().slice(0, 70)); process.exit(1) }
    if (/\b(grant|revoke)\b/i.test(line) || /delete\s+from/i.test(line)) {
      if (!/vaccine_survey_claim_attempts/.test(line)) { console.error('★ 중단 — 기존 객체를 건드린다: ' + line.trim().slice(0, 70)); process.exit(1) }
    }
    if (/alter\s+table\s+public\.vaccine_survey_attempts/i.test(line)) { console.error('★ 중단 — 기존 attempts 표를 건드린다'); process.exit(1) }
  }
  console.log('보내기 전 검사 통과')
}

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(48)} ${got}`) }

await c.connect()
let committed = false
try {
  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_responses') rcols,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_attempts') acols,
    (select string_agg(a.attname, ',' order by k.ord)
       from pg_constraint ct
       join lateral unnest(ct.conkey) with ordinality k(attnum, ord) on true
       join pg_attribute a on a.attrelid = ct.conrelid and a.attnum = k.attnum
      where ct.conrelid='public.vaccine_survey_attempts'::regclass and ct.contype='p') apk`)
  console.log(`\n기준선 — 응답 ${before.resp}행 · 기록 ${before.audit}행 · 정책 ${before.pol} · responses 칸 ${before.rcols} · attempts 칸 ${before.acols} · attempts PK ${before.apk}`)

  await q('begin')
  await q(ddl)

  const r = await one(`select
    (select count(*)::int from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_responses' and column_name in ('dept','dup_declared','dup_checked_at','dup_checked_by')) newc,
    (select is_nullable from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_responses' and column_name='dept') dnull,
    (select count(*)::int from information_schema.tables where table_schema='public'
      and table_name='vaccine_survey_claim_attempts') tbl,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='purge_vaccine_survey_claim_attempts') fn,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from pg_policies where schemaname='public' and tablename='vaccine_survey_claim_attempts') polnew,
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from information_schema.columns
      where table_schema='public' and table_name='vaccine_survey_attempts') acols,
    (select string_agg(a.attname, ',' order by k.ord)
       from pg_constraint ct
       join lateral unnest(ct.conkey) with ordinality k(attnum, ord) on true
       join pg_attribute a on a.attrelid = ct.conrelid and a.attnum = k.attnum
      where ct.conrelid='public.vaccine_survey_attempts'::regclass and ct.contype='p') apk,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid
      where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only') ap,
    (select count(*)::int from public.vaccine_survey_responses where dept is not null or dup_declared) dirty`)
  gate('responses 새 칸 4개', Number(r.newc) === 4, r.newc + '개')
  gate('dept 는 NULL 허용', r.dnull === 'YES', String(r.dnull))
  gate('확인번호 시도 표가 생겼다', Number(r.tbl) === 1, r.tbl + '개')
  gate('청소 함수가 생겼다', Number(r.fn) === 1, r.fn + '개')
  gate('새 표에 정책 0개(service_role 전용)', Number(r.polnew) === 0, r.polnew + '개')
  gate('정책 수 그대로', r.pol === before.pol, before.pol + ' → ' + r.pol)
  gate('★ 기존 attempts PK 그대로', r.apk === before.apk, String(before.apk) + ' → ' + String(r.apk))
  gate('★ 기존 attempts 칸 수 그대로', Number(r.acols) === Number(before.acols), before.acols + ' → ' + r.acols)
  gate('응답 행 수 그대로', r.resp === before.resp, before.resp + ' → ' + r.resp)
  gate('기록 행 수 그대로', r.audit === before.audit, before.audit + ' → ' + r.audit)
  gate('append-only 가드 그대로', Number(r.ap) === 1, r.ap + '개')
  gate('기존 행은 손대지 않았다(dept·선언 모두 비었음)', Number(r.dirty) === 0, r.dirty + '행')

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
