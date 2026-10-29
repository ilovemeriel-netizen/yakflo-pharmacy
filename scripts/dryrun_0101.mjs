// dryrun_0101.mjs — 0101 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ 한 트랜잭션 안에서 ① DDL 적용 → ② **savepoint 로 동작 시험** → 시험만 되돌리고
//   ③ 구조가 성하면 COMMIT 한다. 시험 흔적은 남지 않는다.
// ★ 시험은 authenticated 롤 + JWT 클레임으로 한다 — postgres 로는 아무것도 증명 못 한다.
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

const ddl = readFileSync('supabase/migrations/0101_vaccine_survey_dup_checked.sql', 'utf8')
for (const line of ddl.split(/\r?\n/)) {
  if (/^\s*--/.test(line)) continue
  if (/drop\s+(table|policy|constraint)|truncate|delete\s+from/i.test(line)) { console.error('★ 중단: ' + line.trim().slice(0, 70)); process.exit(1) }
  /* ★ 문장 **시작**만 본다 — 주석 본문에 「GRANT」 라는 낱말이 들어가도 걸리지 않게 */
  if (/^\s*(grant|revoke)\b/i.test(line) && !/mark_vaccine_survey_dup_checked/.test(line)) { console.error('★ 중단 — 다른 객체 권한: ' + line.trim().slice(0, 70)); process.exit(1) }
}
console.log('보내기 전 검사 통과 — 함수 1개 + 그 함수의 EXECUTE 뿐')

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(50)} ${got}`) }
async function call(sql, args) {
  await q('savepoint cc')
  try { const r = await q(sql, args); await q('release savepoint cc'); return { ok: true, rows: r.rows } }
  catch (e) { await q('rollback to savepoint cc'); return { ok: false, code: e.code, msg: e.message.replace(/\s+/g, ' ').slice(0, 80) } }
}

await c.connect()
let committed = false
try {
  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_responses where dup_checked_at is not null) checked`)
  console.log(`\n기준선 — 기록 ${before.audit}행 · 정책 ${before.pol} · 확인완료 ${before.checked}건`)

  await q('begin')
  await q(ddl)

  const fn = await one(`select count(*)::int n,
      bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) auth
    from pg_proc p join pg_namespace s on s.oid=p.pronamespace
   where s.nspname='public' and p.proname='mark_vaccine_survey_dup_checked'`)
  gate('함수가 생겼다', Number(fn.n) === 1, fn.n + '개')
  gate('authenticated 가 실행할 수 있다', fn.auth === true, String(fn.auth))

  /* ── 동작 시험 — savepoint 로 감싸고 끝에 되돌린다 ───────────────────── */
  await q('savepoint trial')
  const admin = await one(`select user_id from public.vaccine_survey_audit order by created_at desc limit 1`)
  const survey = await one(`select id, tenant_id, account_id, vax_start from public.vaccine_surveys order by created_at limit 1`)
  const ins = await one(`insert into public.vaccine_survey_responses
      (tenant_id, survey_id, receipt_code, name, name_key, self_dose, family_count,
       account_id, wish_date, status, consent_at, dept, dup_declared)
    values ($1,$2,'ZZZZZ2','시험_가상','시험_가상',true,0,$3, greatest($4::date, current_date),'applied',now(),'약제과',true)
    returning id`, [survey.tenant_id, survey.id, survey.account_id, survey.vax_start])

  await q('set local role authenticated')
  await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: admin.user_id, role: 'authenticated' })])

  let r = await call(`select public.mark_vaccine_survey_dup_checked($1, true)`, [ins.id])
  gate('확인 완료 처리가 통과한다', r.ok, r.ok ? 'ok' : (r.code + ' ' + r.msg))
  const row = await one(`select dup_checked_at is not null ck, dup_checked_by is not null by_ from public.vaccine_survey_responses where id=$1`, [ins.id])
  gate('확인 시각·처리자가 찍힌다', row.ck === true && row.by_ === true, 'at=' + row.ck + ' by=' + row.by_)
  const au = await one(`select changes from public.vaccine_survey_audit where response_id=$1 and changes ? 'dup_checked' limit 1`, [ins.id])
  gate('★ 기록에 바뀐 값이 담긴다', !!au && au.changes.dup_checked.to === true, au ? JSON.stringify(au.changes) : '(없음)')

  const n0 = Number((await one(`select count(*)::int n from public.vaccine_survey_audit where response_id=$1`, [ins.id])).n)
  r = await call(`select public.mark_vaccine_survey_dup_checked($1, true)`, [ins.id])
  const n1 = Number((await one(`select count(*)::int n from public.vaccine_survey_audit where response_id=$1`, [ins.id])).n)
  gate('같은 값으로 또 부르면 기록이 안 늘어난다', r.ok && n1 === n0, n0 + ' → ' + n1)

  r = await call(`select public.mark_vaccine_survey_dup_checked($1, false)`, [ins.id])
  const row2 = await one(`select dup_checked_at is null ck from public.vaccine_survey_responses where id=$1`, [ins.id])
  gate('되돌리기(확인 취소)도 된다', r.ok && row2.ck === true, r.ok ? 'ok' : (r.code + ' ' + r.msg))

  /* 선언되지 않은 건에는 못 쓴다 */
  await q('reset role')
  const ins2 = await one(`insert into public.vaccine_survey_responses
      (tenant_id, survey_id, receipt_code, name, name_key, self_dose, family_count,
       account_id, wish_date, status, consent_at)
    values ($1,$2,'ZZZZZ3','시험_가상2','시험_가상2',true,0,$3, greatest($4::date, current_date),'applied',now())
    returning id`, [survey.tenant_id, survey.id, survey.account_id, survey.vax_start])
  await q('set local role authenticated')
  await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: admin.user_id, role: 'authenticated' })])
  r = await call(`select public.mark_vaccine_survey_dup_checked($1, true)`, [ins2.id])
  gate('★ 동명이인이 아닌 건에는 막힌다', !r.ok, r.ok ? '통과해 버렸다' : r.code)

  await q('reset role')
  await q('rollback to savepoint trial')
  const back = await one(`select
    (select count(*)::int from public.vaccine_survey_audit) audit,
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from public.vaccine_survey_responses where dup_checked_at is not null) checked`)
  gate('시험 흔적이 사라졌다 — 기록', back.audit === before.audit, before.audit + ' → ' + back.audit)
  gate('시험 흔적이 사라졌다 — 확인완료', back.checked === before.checked, before.checked + ' → ' + back.checked)
  const pol = Number((await one(`select count(*)::int n from pg_policies where schemaname='public'`)).n)
  gate('정책 수 그대로', pol === before.pol, before.pol + ' → ' + pol)

  const ng = checks.filter(x => !x[1])
  if (ng.length) {
    await q('rollback')
    console.log(`\n★ ${ng.length}건 어긋나 ROLLBACK`)
    for (const x of ng) console.log('   - ' + x[0] + ' :: ' + x[2])
    process.exitCode = 1
  } else {
    await q('rollback')   /* ★ 사전 점검이다 — 통과해도 반영하지 않는다 */
    console.log(`\nROLLBACK 완료 — ${checks.length}/${checks.length} 통과 (운영 변경 없음)`)
  }
} catch (e) {
  try { await q('rollback') } catch { /* 이미 끝났다 */ }
  console.error('FATAL ' + String(e.message).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[REDACTED]'))
  process.exitCode = 1
} finally {
  if (!committed && process.exitCode !== 1) { try { await q('rollback') } catch { /* 무시 */ } }
  await c.end()
}
