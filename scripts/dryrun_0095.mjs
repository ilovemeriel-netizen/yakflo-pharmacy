// dryrun_0095.mjs — 0095 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ 핵심 — 검증을 **실제 사용자 권한에서** 한다:
//     SET LOCAL ROLE authenticated + set_config('request.jwt.claims', …)
//   0093 dryrun 이 기본 연결(postgres = 테이블 소유자)로 돌아 **RLS 를 우회**해
//   이 결함을 놓쳤다. 같은 실수를 반복하지 않는다.
//
// ★ 운영에는 이정화 님의 실제 회차(status=open)와 신청이 있다.
//   시험용 회차를 새로 열지 않는다 — 「tenant 당 open 1건」 제약에 걸리고,
//   운영 중인 조사를 건드리면 안 된다. 기존 회차를 **읽어서** 쓴다.
// ★ 임시로 만드는 tenant·membership·응답은 전부 ROLLBACK 으로 사라진다.
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
const mask = u => String(u || '').slice(0, 8) + '…'

const SQL = 'supabase/migrations/0095_vaccine_survey_audit_fill.sql'
const ddl = readFileSync(SQL, 'utf8')

/* ── 보내기 전 차단 검사 ── */
{
  const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
  if (/create\s+policy|drop\s+policy|alter\s+policy/i.test(body)) {
    console.error('★ 중단 — 정책을 건드리는 구문 발견(정책은 바꾸지 않는다)'); process.exit(1)
  }
  if (/\bto\s+(anon|authenticated|service_role)\b/i.test(body)) {
    console.error('★ 중단 — GRANT 구문 발견(0095 는 트리거만 다룬다)'); process.exit(1)
  }
  if (/append_only/i.test(body.replace(/^.*건드리지 않는다.*$/gm, ''))) {
    console.error('★ 중단 — append-only 가드를 건드리는 구문 발견'); process.exit(1)
  }
  const allowed = ['fill_vaccine_survey_audit', 'trg_vaccine_survey_audit_fill', 'trg_set_tenant_id']
  for (const stmt of body.split(';')) {
    const s = stmt.trim(); if (!s) continue
    const m = s.match(/^(create(?:\s+or\s+replace)?|drop)\s+(trigger|function)\s+(?:if\s+exists\s+)?([^\s(]+)/i)
    if (m && !allowed.some(a => s.includes(a))) {
      console.error('★ 중단 — 허용 밖 객체: ' + s.slice(0, 70)); process.exit(1)
    }
  }
  console.log('  보내기 전 검사 통과 — 트리거·함수만 다루고 정책·GRANT·append-only 는 손대지 않는다')
}

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(56)} ${got}`) }

const BASE_POLICIES = 121

/* authenticated 권한으로 전환 */
async function asUser(uid) {
  await q(`set local role authenticated`)
  await q(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])
}
const asOwner = () => q(`reset role`)

/* audit INSERT 1회 시도 — 성공/실패와 저장된 값을 돌려준다 */
async function tryAudit({ surveyId, action, sendTenant, sendUser, responseId, rowCount }) {
  await q('savepoint ia')
  try {
    const cols = ['survey_id', 'action']
    const vals = [surveyId, action]
    if (sendTenant !== undefined) { cols.push('tenant_id'); vals.push(sendTenant) }
    if (sendUser !== undefined) { cols.push('user_id'); vals.push(sendUser) }
    if (responseId !== undefined) { cols.push('response_id'); vals.push(responseId) }
    if (rowCount !== undefined) { cols.push('row_count'); vals.push(rowCount) }
    const ph = vals.map((_, i) => '$' + (i + 1)).join(',')
    const r = await one(
      `insert into public.vaccine_survey_audit (${cols.join(',')}) values (${ph}) returning tenant_id, user_id, action`, vals)
    await q('rollback to savepoint ia')
    return { ok: true, row: r }
  } catch (e) {
    await q('rollback to savepoint ia')
    return { ok: false, code: e.code, msg: e.message.replace(/\s+/g, ' ').slice(0, 72) }
  }
}

await c.connect()
let rolledBack = false
try {
  const before = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_surveys) surveys,
    (select count(*)::int from public.vaccine_survey_responses) responses`)
  console.log(`\n기준선 — 정책 ${before.pol} · 회차 ${before.surveys} · 응답 ${before.responses} · 기록 ${before.audit_rows}행`)
  if (before.pol !== BASE_POLICIES) {
    console.error(`\n★ 중단 — 정책 수 ${before.pol} (기대 ${BASE_POLICIES})`); process.exit(1)
  }

  const owner = await one(`select tenant_id, user_id from public.tenant_members where role='owner' limit 1`)
  const sv = await one(`select id, tenant_id from public.vaccine_surveys order by created_at limit 1`)
  if (!owner || !sv) { console.error('★ 중단 — owner 또는 회차를 찾지 못했습니다'); process.exit(1) }
  console.log(`  owner=${mask(owner.user_id)} tenant=${mask(owner.tenant_id)} · 회차=${mask(sv.id)}`)

  console.log('\n===== BEGIN (dryrun) =====')
  await q('begin')

  /* ── 적용 전: 화면 코드대로 보내면 막히는지(결함 재현) ── */
  await asUser(owner.user_id)
  const beforeFix = await tryAudit({ surveyId: sv.id, action: 'export_xlsx', sendTenant: sv.tenant_id, rowCount: 3 })
  gate('적용 전 — 화면 코드(user_id 누락)는 42501 로 막힌다',
    !beforeFix.ok && beforeFix.code === '42501', beforeFix.ok ? '★통과됨' : beforeFix.code)
  await asOwner()

  /* ── 0095 적용 ── */
  await q(ddl)
  console.log('0095 실행 완료 (함수 1 · 트리거 교체)')

  /* 구조 확인 */
  {
    const tg = await one(`select t.tgname, p.proname from pg_trigger t
      join pg_class cl on cl.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
      where cl.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_fill'`)
    gate('채움 트리거 생성', !!tg, tg ? tg.tgname + ' → ' + tg.proname : '없음')
    const old = await one(`select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
      where cl.relname='vaccine_survey_audit' and t.tgname='trg_set_tenant_id'`)
    gate('범용 tenant 트리거 제거', old.n === 0, old.n + '개')
    const ao = await one(`select count(*)::int n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
      where cl.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only'`)
    gate('append-only 가드 그대로', ao.n === 1, ao.n + '개')
    const sd = await one(`select p.prosecdef sd, pg_get_functiondef(p.oid) d from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='fill_vaccine_survey_audit'`)
    gate('함수가 SECURITY DEFINER + search_path 고정',
      sd && sd.sd === true && /search_path TO 'public', 'pg_temp'/.test(sd.d), sd ? 'sd=' + sd.sd : '없음')
  }
  {
    const wc = await one(`select with_check from pg_policies
      where schemaname='public' and tablename='vaccine_survey_audit' and cmd='INSERT'`)
    gate('INSERT 정책 WITH CHECK 무변경(세 조건 그대로)',
      /current_tenant_ids/.test(wc.with_check) && /is_tenant_admin/.test(wc.with_check) && /user_id = auth\.uid\(\)/.test(wc.with_check),
      '조건 3개 유지')
    const p = await one(`select count(*)::int n from pg_policies where schemaname='public'`)
    gate('정책 수 121 불변', p.n === BASE_POLICIES, p.n + '개')
  }

  /* ── 시험 1) owner JWT 로 3가지 action 전부 성공 ── */
  const rsp = await one(`select id from public.vaccine_survey_responses where survey_id=$1 limit 1`, [sv.id])
  await asUser(owner.user_id)
  for (const [action, extra] of [['export_xlsx', { rowCount: 3 }], ['export_pdf', { rowCount: 3 }],
    ['view_raw', { responseId: rsp?.id }]]) {
    /* 화면 코드대로 **tenant_id·user_id 를 보내지 않고** 넣는다 */
    const r = await tryAudit({ surveyId: sv.id, action, ...extra })
    gate(`시험1 owner — ${action} INSERT 성공`, r.ok,
      r.ok ? `tenant=${mask(r.row.tenant_id)} user=${mask(r.row.user_id)}` : r.code + ' ' + r.msg)
    if (r.ok) {
      gate(`시험1 ${action} — 서버가 채운 값이 맞다`,
        r.row.tenant_id === sv.tenant_id && r.row.user_id === owner.user_id, '회차 tenant · auth.uid()')
    }
  }
  /* 클라이언트가 **엉뚱한 값을 보내도** 서버 값이 이기는지 */
  {
    const r = await tryAudit({
      surveyId: sv.id, action: 'export_pdf', rowCount: 1,
      sendTenant: '00000000-0000-0000-0000-000000000000',
      sendUser: '11111111-1111-1111-1111-111111111111',
    })
    gate('시험1 — 클라이언트가 보낸 엉뚱한 tenant_id·user_id 를 덮어쓴다',
      r.ok && r.row.tenant_id === sv.tenant_id && r.row.user_id === owner.user_id,
      r.ok ? `tenant=${mask(r.row.tenant_id)} user=${mask(r.row.user_id)}` : r.code + ' ' + r.msg)
  }
  await asOwner()

  /* ── 시험 2) owner·admin 이 아닌 JWT 는 실패 ── */
  /* ㉠ tenant_members 행이 아예 없는 사용자 */
  const stranger = (await one(`select gen_random_uuid() u`)).u
  await asUser(stranger)
  for (const action of ['export_xlsx', 'export_pdf', 'view_raw']) {
    const r = await tryAudit({ surveyId: sv.id, action, rowCount: 1 })
    gate(`시험2㉠ 소속 없는 사용자 — ${action} 거부`, !r.ok, r.ok ? '★통과됨' : r.code)
  }
  await asOwner()

  /* ㉡ 같은 tenant 의 'member' 역할 — 임시 tenant 에 owner 를 member 로 넣어 재현한다
     (tenant_members.user_id 는 auth.users FK 라 새 사용자를 만들 수 없다) */
  const t2 = await one(`insert into public.tenants (name, slug) values ('진단용T2','diag-t2-rollback') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'member')`, [t2.id, owner.user_id])
  const acc2 = await one(`select id from public.vaccine_accounts limit 1`)
  const cat2 = await one(`select id from public.vaccine_categories where account_id=$1 limit 1`, [acc2.id])
  /* T2 의 회차 — account·category 는 T1 것이라 가드에 걸리므로 트리거를 피해 직접 넣지 않고,
     대신 T2 소속 account·category 를 함께 만든다 */
  const acc2b = await one(`insert into public.vaccine_accounts
    (tenant_id, season, season_start, season_end, drug_code, funding_source, is_active)
    values ($1,'2026-2027',current_date,current_date+200,'DIAG','일반',true) returning id`, [t2.id])
  const cat2b = await one(`insert into public.vaccine_categories (tenant_id, account_id, label, sort_order, is_active)
    values ($1,$2,'진단분류',0,true) returning id`, [t2.id, acc2b.id])
  const sv2 = await one(`insert into public.vaccine_surveys
    (tenant_id,title,season,account_id,category_ids,vax_start,vax_end)
    values ($1,'진단용T2(롤백됨)','2026-2027',$2,array[$3::uuid],current_date,current_date+30) returning id`,
    [t2.id, acc2b.id, cat2b.id])
  void cat2
  await asUser(owner.user_id)
  for (const action of ['export_xlsx', 'export_pdf', 'view_raw']) {
    const r = await tryAudit({ surveyId: sv2.id, action, rowCount: 1 })
    gate(`시험2㉡ member 역할 — ${action} 거부(is_tenant_admin false)`, !r.ok, r.ok ? '★통과됨' : r.code)
  }
  await asOwner()

  /* ── 시험 3) 소속되지 않은 다른 tenant 의 survey_id → 실패 ── */
  const t3 = await one(`insert into public.tenants (name, slug) values ('진단용T3','diag-t3-rollback') returning id`)
  const acc3 = await one(`insert into public.vaccine_accounts
    (tenant_id, season, season_start, season_end, drug_code, funding_source, is_active)
    values ($1,'2026-2027',current_date,current_date+200,'DIAG3','일반',true) returning id`, [t3.id])
  const cat3 = await one(`insert into public.vaccine_categories (tenant_id, account_id, label, sort_order, is_active)
    values ($1,$2,'진단분류3',0,true) returning id`, [t3.id, acc3.id])
  const sv3 = await one(`insert into public.vaccine_surveys
    (tenant_id,title,season,account_id,category_ids,vax_start,vax_end)
    values ($1,'진단용T3(롤백됨)','2026-2027',$2,array[$3::uuid],current_date,current_date+30) returning id`,
    [t3.id, acc3.id, cat3.id])
  await asUser(owner.user_id)
  for (const action of ['export_xlsx', 'export_pdf', 'view_raw']) {
    const r = await tryAudit({ surveyId: sv3.id, action, rowCount: 1 })
    gate(`시험3 소속 아닌 tenant 회차 — ${action} 거부`, !r.ok, r.ok ? '★통과됨' : r.code)
  }
  /* 없는 회차를 가리키면 FK 또는 트리거가 막는다 */
  {
    const r = await tryAudit({ surveyId: '00000000-0000-0000-0000-000000000000', action: 'view_raw' })
    gate('시험3 — 없는 survey_id 거부', !r.ok, r.ok ? '★통과됨' : r.code)
  }
  await asOwner()

  /* ── 기존 것 불변 ── */
  {
    const a = await one(`select
      (select count(*)::int from public.vaccine_survey_audit) audit_rows,
      (select count(*)::int from public.vaccine_events) events,
      (select count(*)::int from pg_policies where schemaname='public') pol,
      (select status from public.vaccine_surveys where id=$1) st`, [sv.id])
    gate('기록 행 수 불변(시험은 전부 되돌렸다)', a.audit_rows === before.audit_rows, a.audit_rows + '행')
    gate('vaccine_events 불변', a.events === 43, a.events + '행')
    gate('정책 수 불변', a.pol === BASE_POLICIES, a.pol + '개')
    gate('운영 회차 상태 불변', a.st === 'open', a.st)
  }

  await q('rollback'); rolledBack = true
  console.log('\n===== ROLLBACK 완료 — 아무것도 반영되지 않았습니다 =====')

  {
    const after = await one(`select
      (select count(*)::int from pg_policies where schemaname='public') pol,
      (select count(*)::int from public.tenants where slug like 'diag-%') diag_tenants,
      (select count(*)::int from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
        where cl.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_fill') fill_tg`)
    gate('롤백 후 정책 수 원복', after.pol === BASE_POLICIES, after.pol + '개')
    gate('롤백 후 진단용 tenant 0개', after.diag_tenants === 0, after.diag_tenants + '개')
    gate('롤백 후 채움 트리거 0개(아직 적용 전)', after.fill_tg === 0, after.fill_tg + '개')
  }

  const ng = checks.filter(x => !x[1])
  console.log(`\n===== 결과 ${checks.length - ng.length}/${checks.length} 통과 =====`)
  if (ng.length) { console.error('★ 실패: ' + ng.map(x => x[0]).join(', ')); process.exitCode = 1 }
  else console.log('dryrun 통과 — apply 는 별도 지시로만 진행합니다.')
} catch (e) {
  if (!rolledBack) { try { await q('reset role'); await q('rollback'); console.error('\n★ ROLLBACK 완료') } catch { console.error('\n★ ROLLBACK 시도 실패') } }
  console.error('★ dryrun 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
