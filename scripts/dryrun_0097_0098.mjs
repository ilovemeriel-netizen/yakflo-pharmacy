// dryrun_0097_0098.mjs — 0097(칸 추가)·0098(기록) 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ 검증을 실제 사용자 권한에서 한다: SET LOCAL ROLE authenticated +
//   set_config('request.jwt.claims', …). 기본 연결(postgres)은 RLS 를 우회해서
//   아무것도 증명하지 못한다(0093 dryrun 이 그래서 0095 결함을 놓쳤다).
//
// ★ 운영 응답을 읽어서 쓴다. 새 회차·새 응답을 만들지 않는다.
//   바꾼 값은 전부 ROLLBACK 으로 사라진다.
//
// ★ 기준선은 시작할 때 읽은 값과 비교한다 — 고정 숫자를 적지 않는다.
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

const F97 = 'supabase/migrations/0097_vaccine_audit_changes_column.sql'
const F98 = 'supabase/migrations/0098_vaccine_audit_changes_record.sql'
const d97 = readFileSync(F97, 'utf8')
const d98 = readFileSync(F98, 'utf8')

/* ── 보내기 전 차단 검사 — 허용 밖 객체를 건드리면 멈춘다 ── */
{
  const all = (d97 + '\n' + d98)
    .split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  const banned = [
    [/drop\s+table/i, 'DROP TABLE'],
    [/drop\s+policy/i, 'DROP POLICY'],
    [/\b(grant|revoke)\b/i, 'GRANT/REVOKE'],
    [/append_only/i, 'append-only 가드'],
    [/truncate/i, 'TRUNCATE'],
    [/delete\s+from/i, 'DELETE'],
    [/update\s+public\.vaccine_survey_audit/i, '기록 소급 수정'],
  ]
  for (const [re, name] of banned) {
    if (re.test(all)) { console.error('★ 중단 — 허용 밖: ' + name); process.exit(1) }
  }
  console.log('보내기 전 검사 통과 — 칸 1개 추가 · 함수 3개 · 트리거 1개만 다룬다')
}

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(54)} ${got}`) }

async function asUser(uid) {
  await q('set local role authenticated')
  await q(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])
}
const asOwner = () => q('reset role')

async function call(sql, args) {
  await q('savepoint cc')
  try { const r = await q(sql, args); await q('release savepoint cc'); return { ok: true, rows: r.rows } }
  catch (e) { await q('rollback to savepoint cc'); return { ok: false, code: e.code, msg: e.message.replace(/\s+/g, ' ').slice(0, 90) } }
}

/* ★ 한 트랜잭션 안에서는 created_at(=now()) 이 모든 행에 똑같이 박힌다.
   「마지막 기록」을 시각으로 고를 수 없으므로, 호출 전 id 목록을 들고 있다가
   그 뒤에 늘어난 행만 집는다. */
const auditIds = async (rid) => (await q(
  'select id from public.vaccine_survey_audit where response_id=$1', [rid])).rows.map(r => r.id)
const newAudit = async (rid, prev) => (await q(
  `select action, changes from public.vaccine_survey_audit
     where response_id=$1 and not (id = any($2::uuid[]))`, [rid, prev])).rows

/* changes 안에 개인정보로 보이는 키가 있는가 */
const PII = ['name', 'name_key', 'emp_no', 'receipt_code', 'phone', 'pin_hash', 'pin_salt', 'consent_at', 'tenant_id', 'account_id']
const piiKeys = obj => Object.keys(obj || {}).filter(k => PII.includes(k))

await c.connect()
let rolledBack = false
try {
  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_survey_responses) responses,
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_audit') audit_cols`)
  console.log(`\n기준선 — 기록 ${before.audit_rows}행 · 응답 ${before.responses}행 · 정책 ${before.pol} · audit 칸 ${before.audit_cols}`)

  await q('begin')

  /* ── 1) 0097 적용 ─────────────────────────────────────────────────────── */
  await q(d97)
  const col = await one(`select data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='vaccine_survey_audit' and column_name='changes'`)
  gate('0097 — changes 칸이 생겼다', !!col && col.data_type === 'jsonb', col ? col.data_type : '(없음)')
  gate('0097 — NULL 허용이다', !!col && col.is_nullable === 'YES', col ? col.is_nullable : '-')
  const cols2 = Number((await one(`select count(*)::int n from information_schema.columns
     where table_schema='public' and table_name='vaccine_survey_audit'`)).n)
  gate('0097 — 칸 수가 1개만 늘었다', cols2 === before.audit_cols + 1, before.audit_cols + ' → ' + cols2)
  const oldNull = Number((await one(`select count(*)::int n from public.vaccine_survey_audit where changes is null`)).n)
  gate('0097 — 기존 기록은 전부 NULL(소급 없음)', oldNull === before.audit_rows, oldNull + '/' + before.audit_rows)

  /* ── 2) 0098 적용 ─────────────────────────────────────────────────────── */
  await q(d98)
  const fn = await one(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
     where s.nspname='public' and p.proname in
       ('edit_vaccine_survey_response','set_vaccine_survey_status','log_vaccine_survey_done_change')`)
  gate('0098 — 함수 3개가 있다', Number(fn.n) === 3, fn.n + '개')
  const tg = await one(`select count(*)::int n from pg_trigger t join pg_class k on k.oid=t.tgrelid
     where k.relname='vaccine_survey_responses' and t.tgname='trg_vaccine_survey_done_audit'`)
  gate('0098 — 접종완료 기록 트리거가 붙었다', Number(tg.n) === 1, tg.n + '개')
  const ap = await one(`select count(*)::int n from pg_trigger t join pg_class k on k.oid=t.tgrelid
     where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only'`)
  gate('append-only 가드가 그대로 있다', Number(ap.n) === 1, ap.n + '개')
  const pol2 = Number((await one(`select count(*)::int n from pg_policies where schemaname='public'`)).n)
  gate('정책 수 무변동', pol2 === before.pol, before.pol + ' → ' + pol2)

  /* ── 3) 실제 사용자 권한으로 시험 ───────────────────────────────────── */
  const admin = await one(`select user_id from public.vaccine_survey_audit order by created_at desc limit 1`)
  const target = await one(`select id, status, family_count, done_family, self_dose
     from public.vaccine_survey_responses order by created_at limit 1`)
  if (!admin || !target) { console.error('★ 중단 — 시험 대상(관리자·응답)을 찾지 못했다'); process.exit(1) }
  console.log(`\n시험 대상 — 응답 …${String(target.id).slice(-4)} (상태 ${target.status} · 가족 ${target.family_count}) · 관리자 …${String(admin.user_id).slice(-4)}`)
  await asUser(admin.user_id)

  /* (가) 수정 — 가족 수만 바꾼다 */
  const newFam = Number(target.family_count) === 5 ? 4 : 5
  let prev = await auditIds(target.id)
  let r = await call(`select public.edit_vaccine_survey_response($1, null, $2, null)`, [target.id, newFam])
  gate('수정이 통과한다(authenticated)', r.ok, r.ok ? 'ok' : (r.code + ' ' + r.msg))
  let got = await newAudit(target.id, prev)
  gate('수정 기록이 1건만 늘었다', got.length === 1, got.length + '건')
  let a = got[0]
  gate('수정 기록의 action 이 edit', a && a.action === 'edit', a ? a.action : '(없음)')
  gate('★ 바뀐 칸만 담긴다 — family_count·dose',
    !!a && JSON.stringify(Object.keys(a.changes || {}).sort()) === JSON.stringify(['dose', 'family_count']),
    a ? JSON.stringify(Object.keys(a.changes || {}).sort()) : '-')
  gate('★ from·to 가 실제 값이다',
    !!a && a.changes.family_count.from === target.family_count && a.changes.family_count.to === newFam,
    a ? JSON.stringify(a.changes.family_count) : '-')
  gate('★★ 개인정보 키가 없다', !!a && piiKeys(a.changes).length === 0, a ? (piiKeys(a.changes).join(',') || '없음') : '-')

  /* (나) 바뀐 것이 없으면 기록하지 않는다 */
  const n0 = Number((await one(`select count(*)::int n from public.vaccine_survey_audit where response_id=$1`, [target.id])).n)
  r = await call(`select public.edit_vaccine_survey_response($1, null, $2, null)`, [target.id, newFam])
  const n1 = Number((await one(`select count(*)::int n from public.vaccine_survey_audit where response_id=$1`, [target.id])).n)
  gate('같은 값으로 다시 저장하면 기록이 안 늘어난다', r.ok && n1 === n0, n0 + ' → ' + n1)

  /* (다) 취소 → 되살리기 — 띠의 [되돌리기] 가 쓰는 것과 같은 함수 */
  const want = target.status === 'cancelled' ? 'applied' : 'cancelled'
  const back = want === 'cancelled' ? 'applied' : 'cancelled'
  prev = await auditIds(target.id)
  r = await call(`select public.set_vaccine_survey_status($1, $2)`, [target.id, want])
  gate('상태 변경 1 통과', r.ok, r.ok ? target.status + ' → ' + want : (r.code + ' ' + r.msg))
  got = await newAudit(target.id, prev)
  gate('상태 변경 1 기록이 1건만 늘었다', got.length === 1, got.length + '건')
  a = got[0]
  gate('기록 action 이 ' + (want === 'cancelled' ? 'cancel' : 'restore'),
    !!a && a.action === (want === 'cancelled' ? 'cancel' : 'restore'), a ? a.action : '-')
  gate('★ changes 에 status from→to 가 담긴다',
    !!a && a.changes && a.changes.status && a.changes.status.from === target.status && a.changes.status.to === want,
    a ? JSON.stringify(a.changes) : '-')

  prev = await auditIds(target.id)
  r = await call(`select public.set_vaccine_survey_status($1, $2)`, [target.id, back])
  gate('상태 변경 2(되돌리기) 통과', r.ok, r.ok ? want + ' → ' + back : (r.code + ' ' + r.msg))
  got = await newAudit(target.id, prev)
  gate('상태 변경 2 기록이 1건만 늘었다', got.length === 1, got.length + '건')
  a = got[0]
  gate('되돌리기 기록 action 이 ' + (back === 'applied' ? 'restore' : 'cancel'),
    !!a && a.action === (back === 'applied' ? 'restore' : 'cancel'), a ? a.action : '-')
  const st = await one(`select status from public.vaccine_survey_responses where id=$1`, [target.id])
  gate('★ 원래 상태로 돌아왔다', st.status === target.status, target.status + ' → ' + st.status)
  const pair = await one(`select count(*)::int n from public.vaccine_survey_audit
     where response_id=$1 and action in ('cancel','restore')`, [target.id])
  gate('★ cancel·restore 기록 2건이 남았다', Number(pair.n) >= 2, pair.n + '건')

  /* (라) 접종 완료 수 — 화면과 같은 직접 UPDATE */
  const fam = Number((await one(`select family_count from public.vaccine_survey_responses where id=$1`, [target.id])).family_count)
  const newDone = Number(target.done_family) === 0 && fam > 0 ? 1 : 0
  prev = await auditIds(target.id)
  r = await call(`update public.vaccine_survey_responses set done_family=$2, updated_at=now() where id=$1`, [target.id, newDone])
  gate('접종 완료 수 직접 UPDATE 가 그대로 통과한다(경로 불변)', r.ok, r.ok ? target.done_family + ' → ' + newDone : (r.code + ' ' + r.msg))
  got = await newAudit(target.id, prev)
  gate('접종 완료 기록이 1건만 늘었다', got.length === 1, got.length + '건')
  a = got[0]
  gate('★ 접종 완료 변경도 기록된다',
    !!a && a.changes && 'done_family' in a.changes, a ? JSON.stringify(a.changes) : '-')
  gate('★★ 거기에도 개인정보 키가 없다', !!a && piiKeys(a.changes).length === 0, a ? (piiKeys(a.changes).join(',') || '없음') : '-')

  /* (마) 기록은 여전히 고칠 수 없다 */
  r = await call(`update public.vaccine_survey_audit set action='view_raw' where response_id=$1`, [target.id])
  gate('★ 기록 UPDATE 는 막힌다', !r.ok, r.ok ? '통과해 버렸다' : (r.code + ' ' + r.msg.slice(0, 40)))
  r = await call(`delete from public.vaccine_survey_audit where response_id=$1`, [target.id])
  gate('★ 기록 DELETE 는 막힌다', !r.ok, r.ok ? '통과해 버렸다' : (r.code + ' ' + r.msg.slice(0, 40)))

  /* (바) 새 기록 전수에 개인정보 키가 없다 */
  await asOwner()
  const allNew = await q(`select changes from public.vaccine_survey_audit where changes is not null`)
  const bad = allNew.rows.flatMap(x => piiKeys(x.changes))
  gate('★★ 새로 생긴 기록 전수에 개인정보 키 0개', bad.length === 0, allNew.rows.length + '행 검사 · ' + (bad.join(',') || '없음'))
  const stillNull = Number((await one(`select count(*)::int n from public.vaccine_survey_audit where changes is null`)).n)
  gate('기존 기록은 아직 NULL', stillNull === before.audit_rows, stillNull + '/' + before.audit_rows)

  await q('rollback')
  rolledBack = true
  const after = await one(`select
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_survey_responses) responses,
    (select count(*)::int from information_schema.columns
       where table_schema='public' and table_name='vaccine_survey_audit') audit_cols`)
  console.log(`\nROLLBACK 완료 — 기록 ${after.audit_rows}행 · 응답 ${after.responses}행 · audit 칸 ${after.audit_cols}`)
  gate('되돌림 확인 — 기록 행 수 그대로', after.audit_rows === before.audit_rows, before.audit_rows + ' → ' + after.audit_rows)
  gate('되돌림 확인 — changes 칸이 사라졌다', after.audit_cols === before.audit_cols, before.audit_cols + ' → ' + after.audit_cols)

  const ng = checks.filter(x => !x[1])
  console.log(`\n결과 ${checks.length - ng.length}/${checks.length} 통과`)
  if (ng.length) { console.log('★ 실패 항목:'); for (const x of ng) console.log('   - ' + x[0] + ' :: ' + x[2]) }
  process.exitCode = ng.length ? 1 : 0
} catch (e) {
  console.error('FATAL ' + String(e.message).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[REDACTED]'))
  process.exitCode = 1
} finally {
  if (!rolledBack) { try { await q('rollback') } catch { /* 이미 끝났다 */ } }
  await c.end()
}
