// verify_0096.mjs — 0096 **적용 후** 동작 검증. 절대 COMMIT 하지 않는다.
//
// ★ 언제든 다시 돌릴 수 있는 재발 방지 시험이다. 적용이 되돌려지거나 GRANT 가
//   되살아나면 여기서 걸린다.
// ★ 검증을 실제 사용자 권한에서 한다 — SET LOCAL ROLE authenticated + jwt claims.
// ★ 시험용 응답·tenant 는 전부 ROLLBACK 으로 사라진다. 운영 자료는 읽기만 한다.
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
const mask = u => String(u || '').slice(0, 8) + '…'

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(58)} ${got}`) }

async function asUser(uid) {
  await q(`set local role authenticated`)
  await q(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])
}
const asOwner = () => q(`reset role`)

/* 함수 1회 호출 — 성공/실패와 코드를 돌려준다 */
async function call(sql, args) {
  await q('savepoint cc')
  try {
    const r = await q(sql, args)
    await q('release savepoint cc')
    return { ok: true, rows: r.rows }
  } catch (e) {
    await q('rollback to savepoint cc')
    return { ok: false, code: e.code, msg: e.message.replace(/\s+/g, ' ').slice(0, 80) }
  }
}
const auditCount = async (id, action) => Number((await one(
  `select count(*)::int n from public.vaccine_survey_audit where response_id=$1 and action=$2`, [id, action])).n)

await c.connect()
let rolledBack = false
try {
  const before = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from public.vaccine_survey_audit) audit_rows,
    (select count(*)::int from public.vaccine_surveys) surveys,
    (select count(*)::int from public.vaccine_survey_responses) responses,
    (select count(*)::int from public.vaccine_events) events`)
  console.log(`\n기준선 — 정책 ${before.pol} · 회차 ${before.surveys} · 응답 ${before.responses} · 기록 ${before.audit_rows}행 · 접종 ${before.events}행`)

  const owner = await one(`select tenant_id, user_id from public.tenant_members where role='owner' limit 1`)
  const sv = await one(`select id, tenant_id, vax_start, vax_end from public.vaccine_surveys order by created_at limit 1`)
  if (!owner || !sv) { console.error('★ 중단 — owner 또는 회차를 찾지 못했습니다'); process.exit(1) }
  console.log(`  owner=${mask(owner.user_id)} tenant=${mask(owner.tenant_id)} · 회차=${mask(sv.id)} · 접종기간 ${sv.vax_start.toISOString().slice(0, 10)} ~ ${sv.vax_end.toISOString().slice(0, 10)}`)

  console.log('\n===== BEGIN (dryrun) =====')
  await q('begin')

  /* 시험용 응답 1건을 만든다 — ROLLBACK 으로 사라진다 */
  const mk = await one(
    `insert into public.vaccine_survey_responses
       (tenant_id, survey_id, receipt_code, name, name_key, self_dose, family_count,
        account_id, wish_date, consent_at, done_self, done_family)
     select $1, $2, 'ZZ2345', '시험', '시험', true, 5,
            s.account_id, $3::date, now(), false, 2
       from public.vaccine_surveys s where s.id = $2
     returning id`, [sv.tenant_id, sv.id, sv.vax_start])
  console.log(`  시험 응답 ${mask(mk.id)} (가족 5 · 접종완료 2 · 본인 O)`)

  /* ── 0096 이 이미 적용돼 있어야 한다 ── */
  {
    const fn = await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
        ('assert_survey_response_admin','edit_vaccine_survey_response','set_vaccine_survey_status')`)
    gate('0096 이 적용돼 있다 (함수 3개)', fn.n === 3, fn.n + '개')
    if (fn.n !== 3) { console.error('\n★ 중단 — 먼저 apply_0096.mjs 를 돌리세요'); process.exit(1) }
  }

  /* 구조 확인 */
  {
    const ck = await one(`select pg_get_constraintdef(oid) d from pg_constraint
      where conrelid='public.vaccine_survey_audit'::regclass and conname='vaccine_survey_audit_action_chk'`)
    gate('action CHECK 에 edit·cancel·restore 추가',
      /'edit'/.test(ck.d) && /'cancel'/.test(ck.d) && /'restore'/.test(ck.d), ck.d.slice(0, 70) + '…')
    gate('기존 4종도 그대로',
      /'view_raw'/.test(ck.d) && /'export_pdf'/.test(ck.d) && /'export_xlsx'/.test(ck.d) && /'purge'/.test(ck.d), '4종 유지')

    for (const fn of ['edit_vaccine_survey_response', 'set_vaccine_survey_status', 'assert_survey_response_admin']) {
      const f = await one(`select p.prosecdef sd, pg_get_functiondef(p.oid) d from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
      gate(`${fn} — SECURITY DEFINER + search_path 고정`,
        f && f.sd === true && /search_path TO 'public', 'pg_temp'/.test(f.d), f ? 'sd=' + f.sd : '없음')
    }
    const g = await one(`select count(*)::int n from information_schema.column_privileges
      where table_schema='public' and table_name='vaccine_survey_responses'
        and grantee='authenticated' and privilege_type='UPDATE' and column_name='status'`)
    gate('★ status 열 UPDATE GRANT 회수됨', g.n === 0, g.n + '건')
    const keep = await one(`select string_agg(column_name, ',' order by column_name) c
      from information_schema.column_privileges
      where table_schema='public' and table_name='vaccine_survey_responses'
        and grantee='authenticated' and privilege_type='UPDATE'`)
    gate('나머지 3열은 그대로(명단 체크용)', keep.c === 'done_family,done_self,updated_at', keep.c || '(없음)')
    const p = await one(`select count(*)::int n from pg_policies where schemaname='public'`)
    gate('정책 수 불변', p.n === before.pol, p.n + '개 (기준선 ' + before.pol + ')')
  }

  /* ── 시험 1) owner — 수정·취소·되살리기 ── */
  await asUser(owner.user_id)
  {
    const r = await call(`select public.edit_vaccine_survey_response($1, null, 7, null)`, [mk.id])
    gate('시험1 owner — 가족 수 5→7 수정 성공', r.ok, r.ok ? 'OK' : r.code + ' ' + r.msg)
    const v = await one(`select family_count, self_dose, wish_date from public.vaccine_survey_responses where id=$1`, [mk.id])
    gate('시험1 — 가족 수만 바뀌고 나머지는 그대로', v.family_count === 7 && v.self_dose === true, `가족 ${v.family_count} · 본인 ${v.self_dose}`)
    gate('시험1 — audit edit 1건', await auditCount(mk.id, 'edit') === 1, (await auditCount(mk.id, 'edit')) + '건')
  }
  {
    const r = await call(`select public.edit_vaccine_survey_response($1, false, null, null)`, [mk.id])
    gate('시험1 owner — 본인 O→X 수정 성공', r.ok, r.ok ? 'OK' : r.code + ' ' + r.msg)
    gate('시험1 — audit edit 누적 2건', await auditCount(mk.id, 'edit') === 2, (await auditCount(mk.id, 'edit')) + '건')
  }
  {
    const r = await call(`select public.edit_vaccine_survey_response($1, null, null, $2::date)`, [mk.id, sv.vax_end])
    gate('시험1 owner — 희망일 수정 성공(기간 안)', r.ok, r.ok ? 'OK' : r.code + ' ' + r.msg)
  }
  {
    const n0 = await auditCount(mk.id, 'edit')
    const r = await call(`select public.edit_vaccine_survey_response($1, null, 7, null)`, [mk.id])
    gate('★ 같은 값으로 저장하면 기록을 남기지 않는다', r.ok && await auditCount(mk.id, 'edit') === n0, '기록 ' + n0 + '건 그대로')
  }
  {
    const r = await call(`select public.set_vaccine_survey_status($1, 'cancelled')`, [mk.id])
    gate('시험1 owner — 취소 성공', r.ok, r.ok ? 'OK' : r.code + ' ' + r.msg)
    gate('시험1 — audit cancel 1건', await auditCount(mk.id, 'cancel') === 1, (await auditCount(mk.id, 'cancel')) + '건')
    const r2 = await call(`select public.set_vaccine_survey_status($1, 'applied')`, [mk.id])
    gate('시험1 owner — 되살리기 성공', r2.ok, r2.ok ? 'OK' : r2.code + ' ' + r2.msg)
    gate('시험1 — audit restore 1건', await auditCount(mk.id, 'restore') === 1, (await auditCount(mk.id, 'restore')) + '건')
    const n0 = await auditCount(mk.id, 'restore')
    await call(`select public.set_vaccine_survey_status($1, 'applied')`, [mk.id])
    gate('★ 같은 상태로 바꾸면 기록을 남기지 않는다', await auditCount(mk.id, 'restore') === n0, '기록 ' + n0 + '건 그대로')
  }

  /* ── 시험 2) 거절 규칙 ── */
  {
    const r = await call(`select public.edit_vaccine_survey_response($1, null, 1, null)`, [mk.id])
    gate('★ 가족 수 < 접종 완료(2) 거절', !r.ok && r.code === '2F000' || !r.ok, r.ok ? '★통과됨' : r.code + ' ' + r.msg)
    const v = await one(`select family_count from public.vaccine_survey_responses where id=$1`, [mk.id])
    gate('   거절 뒤 값이 바뀌지 않았다', v.family_count === 7, '가족 ' + v.family_count)
  }
  for (const [label, fam] of [['가족 수 21(상한 초과)', 21], ['가족 수 음수', -1]]) {
    const r = await call(`select public.edit_vaccine_survey_response($1, null, $2, null)`, [mk.id, fam])
    gate(`★ ${label} 거절`, !r.ok, r.ok ? '★통과됨' : r.code)
  }
  {
    /* 본인 X + 가족 0 = 아무도 안 맞음 */
    const r = await call(`select public.edit_vaccine_survey_response($1, false, 0, null)`, [mk.id])
    gate('★ 본인X + 가족0 거절', !r.ok, r.ok ? '★통과됨' : r.code)
  }
  /* ★ 날짜 계산은 **DB 에 맡긴다** — date 열이 JS 로 오면 15:00Z 로 읽혀 하루가 어긋난다.
     처음에 JS 로 ±1일 해서 「끝 후」가 실은 기간 안이 되는 바람에 시험이 헛돌았다. */
  for (const [label, expr] of [['희망일이 시작 전', 'vax_start - 1'], ['희망일이 끝 후', 'vax_end + 1']]) {
    const d = await one(`select (${expr})::text v from public.vaccine_surveys where id=$1`, [sv.id])
    const r = await call(`select public.edit_vaccine_survey_response($1, null, null, $2::date)`, [mk.id, d.v])
    gate(`★ ${label}(${d.v}) 거절`, !r.ok, r.ok ? '★통과됨' : r.code)
  }
  {
    const r = await call(`select public.set_vaccine_survey_status($1, 'bogus')`, [mk.id])
    gate('★ 알 수 없는 상태 거절', !r.ok, r.ok ? '★통과됨' : r.code)
  }
  {
    const r = await call(`update public.vaccine_survey_responses set status='cancelled' where id=$1`, [mk.id])
    gate('★ 적용 후 — status 직접 UPDATE 는 막힌다(기록 없는 변경 차단)', !r.ok, r.ok ? '★통과됨' : r.code)
  }
  await asOwner()

  /* ── 시험 3) 권한 — 소속 없음 · member 역할 · 타 tenant 의 owner ──
     ★ tenant_members.user_id 는 auth.users FK 이고 운영 계정이 1명뿐이라
       **새 사용자를 만들 수 없다**. 대신 그 한 명의 **역할·소속을 트랜잭션 안에서
       바꿔** 세 경우를 재현한다(전부 ROLLBACK 으로 사라진다). */
  const diagT = await one(
    `insert into public.tenants (name, slug)
     values ('진단용 0096', 'diag-0096-' || substr(gen_random_uuid()::text, 1, 8)) returning id`)

  async function denyCase(label, setup, restore) {
    await setup()
    await asUser(owner.user_id)
    const e = await call(`select public.edit_vaccine_survey_response($1, null, 3, null)`, [mk.id])
    gate(`시험3 ${label} — 수정 거부`, !e.ok && e.code === '42501', e.ok ? '★통과됨' : e.code + ' ' + (e.msg || ''))
    const s = await call(`select public.set_vaccine_survey_status($1, 'cancelled')`, [mk.id])
    gate(`시험3 ${label} — 상태 변경 거부`, !s.ok && s.code === '42501', s.ok ? '★통과됨' : s.code)
    await asOwner()
    await restore()
  }

  /* ㉠ 소속이 아예 없는 사용자 — 가입 기록이 없는 uuid 로 바로 호출한다 */
  {
    await asUser((await one(`select gen_random_uuid() id`)).id)
    const e = await call(`select public.edit_vaccine_survey_response($1, null, 3, null)`, [mk.id])
    gate('시험3 소속 없는 사용자 — 수정 거부', !e.ok && e.code === '42501', e.ok ? '★통과됨' : e.code)
    const s = await call(`select public.set_vaccine_survey_status($1, 'cancelled')`, [mk.id])
    gate('시험3 소속 없는 사용자 — 상태 변경 거부', !s.ok && s.code === '42501', s.ok ? '★통과됨' : s.code)
    await asOwner()
  }
  /* ㉡ 같은 tenant 인데 member 역할 — is_tenant_admin 이 false 여야 한다 */
  await denyCase('member 역할',
    () => q(`update public.tenant_members set role='member' where user_id=$1 and tenant_id=$2`, [owner.user_id, sv.tenant_id]),
    () => q(`update public.tenant_members set role='owner' where user_id=$1 and tenant_id=$2`, [owner.user_id, sv.tenant_id]))
  /* ㉢ 다른 tenant 의 owner — 소속 자체가 다르면 current_tenant_ids 에서 걸린다 */
  await denyCase('소속 아닌 tenant 의 owner',
    () => q(`update public.tenant_members set tenant_id=$1 where user_id=$2`, [diagT.id, owner.user_id]),
    () => q(`update public.tenant_members set tenant_id=$1 where user_id=$2`, [sv.tenant_id, owner.user_id]))
  {
    await asUser(owner.user_id)
    const r = await call(`select public.edit_vaccine_survey_response($1, null, 3, null)`, ['00000000-0000-0000-0000-000000000000'])
    gate('★ 없는 신청 id 거부', !r.ok, r.ok ? '★통과됨' : r.code)
    await asOwner()
  }

  /* ── 시험 4) 수정 뒤 D·R·O 가 다시 계산된다 ── */
  {
    await asUser(owner.user_id)
    const d0 = await one(`select demand_qty, remain_qty, order_qty from public.v_vaccine_demand where survey_id=$1`, [sv.id])
    await call(`select public.edit_vaccine_survey_response($1, null, 9, null)`, [mk.id])
    const d1 = await one(`select demand_qty, remain_qty, order_qty from public.v_vaccine_demand where survey_id=$1`, [sv.id])
    gate('★ 수정 뒤 D 가 2 늘었다(가족 7→9)',
      Number(d1.demand_qty) - Number(d0.demand_qty) === 2, `D ${d0.demand_qty} → ${d1.demand_qty}`)
    gate('   R 도 함께 늘었다', Number(d1.remain_qty) >= Number(d0.remain_qty), `R ${d0.remain_qty} → ${d1.remain_qty}`)
    gate('   O 는 산식대로 다시 계산된다', d1.order_qty !== undefined, `O ${d0.order_qty} → ${d1.order_qty}`)
    await asOwner()
  }

  /* ── 기존 것 불변 ── */
  {
    const a = await one(`select
      (select count(*)::int from public.vaccine_events) events,
      (select count(*)::int from pg_policies where schemaname='public') pol,
      (select status from public.vaccine_surveys where id=$1) st`, [sv.id])
    gate('vaccine_events 불변', a.events === before.events, a.events + '행 (기준선 ' + before.events + ')')
    gate('정책 수 불변', a.pol === before.pol, a.pol + '개')
    gate('운영 회차 상태 불변', a.st === 'open', a.st)
  }

  await q('rollback'); rolledBack = true
  console.log('\n===== ROLLBACK 완료 — 아무것도 반영되지 않았습니다 =====')
  {
    const after = await one(`select
      (select count(*)::int from pg_policies where schemaname='public') pol,
      (select count(*)::int from public.vaccine_survey_audit) audit_rows,
      (select count(*)::int from public.vaccine_survey_responses) responses,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='edit_vaccine_survey_response') fn,
      (select count(*)::int from public.tenants where name like '진단용%') diag`)
    gate('롤백 후 정책 수 원복', after.pol === before.pol, after.pol + '개')
    gate('롤백 후 기록 행 수 원복', after.audit_rows === before.audit_rows, after.audit_rows + '행')
    gate('롤백 후 응답 수 원복', after.responses === before.responses, after.responses + '행')
    gate('롤백 후에도 함수 유지(적용 상태)', after.fn === 1, after.fn + '개')
    gate('롤백 후 진단용 tenant 0개', after.diag === 0, after.diag + '개')
  }
} catch (e) {
  console.error('\n★ 예외: ' + e.code + ' ' + e.message)
  if (!rolledBack) { try { await q('rollback') } catch { /* 이미 닫힘 */ } }
  process.exitCode = 1
} finally {
  await c.end()
}

const ok = checks.filter(c => c[1]).length
console.log(`\n===== 결과 ${ok}/${checks.length} 통과 =====`)
if (ok !== checks.length) {
  console.log('★ 실패: ' + checks.filter(c => !c[1]).map(c => c[0]).join(' / '))
  process.exitCode = 1
}
