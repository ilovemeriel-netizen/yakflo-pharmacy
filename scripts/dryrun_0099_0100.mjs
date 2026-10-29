// dryrun_0099_0100.mjs — 0099·0100 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ 0100 은 CONCURRENTLY 라 트랜잭션 안에서 못 돈다 → dryrun 은 그 낱말을 빼고
//   같은 인덱스를 만들어 **제약의 효과**를 확인한다. 실제 적용은 apply 가
//   CONCURRENTLY 로, 트랜잭션 밖에서, 「새로 만들고 옛 것 지우는」 순서로 한다.
// ★ 시험 행은 전부 가상 이름이다. 실제 신청 자료를 읽거나 바꾸지 않는다.
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

const d99 = readFileSync('supabase/migrations/0099_vaccine_survey_dup_policy.sql', 'utf8')
const d100raw = readFileSync('supabase/migrations/0100_vaccine_survey_emp_uniq_applied.sql', 'utf8')
const d100 = d100raw.replace(/\s+concurrently\b/gi, '')   /* 트랜잭션 안에서 돌리려고 */

/* 보내기 전 차단 검사 */
for (const [name, body] of [['0099', d99], ['0100', d100raw]]) {
  const t = body.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  for (const [re, what] of [[/drop\s+table/i, 'DROP TABLE'], [/drop\s+policy/i, 'DROP POLICY'],
    [/\b(grant|revoke)\b/i, 'GRANT/REVOKE'], [/delete\s+from/i, 'DELETE'],
    [/append_only/i, 'append-only 가드'], [/truncate/i, 'TRUNCATE'],
    [/update\s+public\./i, '자료 수정']]) {
    if (re.test(t)) { console.error('★ 중단 — ' + name + ' 이 건드리면 안 되는 것: ' + what); process.exit(1) }
  }
}
console.log('보내기 전 검사 통과 — 칸 추가·CHECK·PK·인덱스만 다룬다')

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(50)} ${got}`) }
async function call(sql, args) {
  await q('savepoint s')
  try { const r = await q(sql, args); await q('release savepoint s'); return { ok: true, rows: r.rows } }
  catch (e) { await q('rollback to savepoint s'); return { ok: false, code: e.code, msg: e.message.replace(/\s+/g, ' ').slice(0, 80) } }
}

await c.connect()
let rolledBack = false
try {
  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_responses') rcols,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_attempts') acols`)
  console.log(`\n기준선 — 응답 ${before.resp}행 · 기록 ${before.audit}행 · 정책 ${before.pol} · responses 칸 ${before.rcols} · attempts 칸 ${before.acols}`)

  await q('begin')
  await q(d99)

  /* ── 0099 확인 ───────────────────────────────────────────────────────── */
  const cols = await one(`select
    (select count(*)::int from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_responses' and column_name in ('dept','dup_declared','dup_checked_at','dup_checked_by')) r,
    (select count(*)::int from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_attempts' and column_name in ('kind','last_seen')) a,
    (select is_nullable from information_schema.columns where table_schema='public'
      and table_name='vaccine_survey_responses' and column_name='dept') dnull`)
  gate('0099 — responses 새 칸 4개', Number(cols.r) === 4, cols.r + '개')
  gate('0099 — attempts 새 칸 2개', Number(cols.a) === 2, cols.a + '개')
  gate('0099 — dept 는 NULL 허용', cols.dnull === 'YES', String(cols.dnull))
  const pk = await one(`select string_agg(a.attname, ',' order by k.ord) cols
    from pg_constraint ct
    join lateral unnest(ct.conkey) with ordinality k(attnum, ord) on true
    join pg_attribute a on a.attrelid = ct.conrelid and a.attnum = k.attnum
   where ct.conrelid='public.vaccine_survey_attempts'::regclass and ct.contype='p'`)
  gate('0099 — attempts PK 에 kind 포함', pk.cols === 'tenant_id,ip_hash,kind', String(pk.cols))

  /* 소속 허용값 */
  const survey = await one(`select id, tenant_id, account_id, vax_start, vax_end from public.vaccine_surveys order by created_at limit 1`)
  const mk = (code, emp, status, dept, name) => q(
    `insert into public.vaccine_survey_responses
       (tenant_id, survey_id, receipt_code, emp_no, name, name_key, self_dose, family_count,
        account_id, wish_date, status, consent_at, dept, dup_declared)
     values ($1,$2,$3,$4,$5,$6,true,0,$7, greatest($8::date, current_date), $9, now(), $10, $11)`,
    [survey.tenant_id, survey.id, code, emp, name, name.toLowerCase(), survey.account_id,
      survey.vax_start, status, dept, dept != null])

  let r = await call(`select 1 from (select 1) x where $1 is null`, [null])
  r = await (async () => { try { await mk('AAAAA2', null, 'applied', '약제과', '가상환자갑'); return { ok: true } } catch (e) { return { ok: false, code: e.code, msg: e.message.slice(0, 70) } } })()
  gate('0099 — 허용 소속은 들어간다', r.ok, r.ok ? '약제과' : (r.code + ' ' + r.msg))
  await q('savepoint s2')
  let bad
  try { await mk('AAAAA3', null, 'applied', '없는부서', '가상환자을'); bad = { ok: true } }
  catch (e) { bad = { ok: false, code: e.code } }
  await q('rollback to savepoint s2')
  gate('0099 — 허용 밖 소속은 막힌다', !bad.ok && bad.code === '23514', bad.ok ? '들어가 버렸다' : bad.code)

  /* attempts 용도별 행 */
  const a1 = await call(`insert into public.vaccine_survey_attempts (tenant_id, ip_hash, kind, submit_count) values ($1,'dryrun-hash','submit',1)`, [survey.tenant_id])
  const a2 = await call(`insert into public.vaccine_survey_attempts (tenant_id, ip_hash, kind, submit_count) values ($1,'dryrun-hash','claim_ip',1)`, [survey.tenant_id])
  gate('0099 — 같은 IP 라도 용도가 다르면 따로 센다', a1.ok && a2.ok, 'submit=' + a1.ok + ' claim_ip=' + a2.ok)
  const a3 = await call(`insert into public.vaccine_survey_attempts (tenant_id, ip_hash, kind, submit_count) values ($1,'dryrun-hash','nope',1)`, [survey.tenant_id])
  gate('0099 — 모르는 용도는 막힌다', !a3.ok, a3.ok ? '들어가 버렸다' : a3.code)

  /* ── 0100 확인 ───────────────────────────────────────────────────────── */
  await q(d100)
  const idx = await one(`select
    (select count(*)::int from pg_indexes where schemaname='public' and indexname='vaccine_survey_responses_emp_applied_uniq') neu,
    (select count(*)::int from pg_indexes where schemaname='public' and indexname='vaccine_survey_responses_emp_uniq') old`)
  gate('0100 — 새 인덱스가 생겼다', Number(idx.neu) === 1, idx.neu + '개')
  gate('0100 — 옛 인덱스가 사라졌다', Number(idx.old) === 0, idx.old + '개')
  const pred = await one(`select indexdef from pg_indexes where schemaname='public' and indexname='vaccine_survey_responses_emp_applied_uniq'`)
  gate('0100 — 조건에 applied 가 들어 있다', /status = 'applied'/.test(pred.indexdef || ''), (pred.indexdef || '').slice(-54))

  /* 사번 중복 동작 */
  const EMP = 'DRYRUN-EMP-0100'
  const e1 = await call(`insert into public.vaccine_survey_responses
      (tenant_id, survey_id, receipt_code, emp_no, name, name_key, self_dose, family_count,
       account_id, wish_date, status, consent_at)
     values ($1,$2,'BBBBB2',$3,'가상환자병','가상환자병',true,0,$4, greatest($5::date, current_date),'applied',now())`,
  [survey.tenant_id, survey.id, EMP, survey.account_id, survey.vax_start])
  gate('0100 — 첫 신청은 들어간다', e1.ok, e1.ok ? 'ok' : (e1.code + ' ' + e1.msg))
  const e2 = await call(`insert into public.vaccine_survey_responses
      (tenant_id, survey_id, receipt_code, emp_no, name, name_key, self_dose, family_count,
       account_id, wish_date, status, consent_at)
     values ($1,$2,'BBBBB3',$3,'가상환자정','가상환자정',true,0,$4, greatest($5::date, current_date),'applied',now())`,
  [survey.tenant_id, survey.id, EMP, survey.account_id, survey.vax_start])
  gate('★ 0100 — 같은 사번 두 번째 applied 는 막힌다', !e2.ok && e2.code === '23505', e2.ok ? '들어가 버렸다' : e2.code)
  await call(`update public.vaccine_survey_responses set status='cancelled' where receipt_code='BBBBB2'`)
  const e3 = await call(`insert into public.vaccine_survey_responses
      (tenant_id, survey_id, receipt_code, emp_no, name, name_key, self_dose, family_count,
       account_id, wish_date, status, consent_at)
     values ($1,$2,'BBBBB4',$3,'가상환자무','가상환자무',true,0,$4, greatest($5::date, current_date),'applied',now())`,
  [survey.tenant_id, survey.id, EMP, survey.account_id, survey.vax_start])
  gate('★ 0100 — 취소한 뒤에는 같은 사번으로 다시 신청된다', e3.ok, e3.ok ? 'ok' : (e3.code + ' ' + e3.msg))

  /* ── 건드리지 않았는가 ───────────────────────────────────────────────── */
  const after = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid
      where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only') ap,
    (select count(*)::int from public.vaccine_survey_audit) audit`)
  gate('정책 수 그대로', after.pol === before.pol, before.pol + ' → ' + after.pol)
  gate('append-only 가드 그대로', Number(after.ap) === 1, after.ap + '개')
  gate('기록 행 수 그대로', after.audit === before.audit, before.audit + ' → ' + after.audit)

  await q('rollback')
  rolledBack = true
  const final = await one(`select
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_responses') rcols,
    (select count(*)::int from pg_indexes where schemaname='public' and indexname='vaccine_survey_responses_emp_uniq') old`)
  console.log(`\nROLLBACK 완료 — 응답 ${final.resp}행 · responses 칸 ${final.rcols} · 옛 인덱스 ${final.old}개`)
  gate('되돌림 — 응답 행 수 그대로', final.resp === before.resp, before.resp + ' → ' + final.resp)
  gate('되돌림 — 칸 수 그대로', final.rcols === before.rcols, before.rcols + ' → ' + final.rcols)
  gate('되돌림 — 옛 인덱스 살아 있다', Number(final.old) === 1, final.old + '개')

  const ng = checks.filter(x => !x[1])
  console.log(`\n결과 ${checks.length - ng.length}/${checks.length} 통과`)
  if (ng.length) { console.log('★ 실패:'); for (const x of ng) console.log('   - ' + x[0] + ' :: ' + x[2]) }
  process.exitCode = ng.length ? 1 : 0
} catch (e) {
  try { await q('rollback') } catch { /* 이미 끝났다 */ }
  console.error('FATAL ' + String(e.message).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[REDACTED]'))
  process.exitCode = 1
} finally {
  if (!rolledBack) { try { await q('rollback') } catch { /* 무시 */ } }
  await c.end()
}
