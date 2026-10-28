// diag_audit_rls.mjs — audit INSERT RLS 위반 진단. **읽기/재현만, 전부 ROLLBACK.**
//
// ★ 운영에 남는 변경이 없다 — BEGIN … ROLLBACK 안에서만 돌고 끝에서 반드시 rollback 한다.
// ★ 실제 사용자 권한을 흉내낸다: SET LOCAL ROLE authenticated + request.jwt.claims.
//   그래야 RLS 가 적용된다. 기본 연결(postgres)은 **테이블 소유자라 RLS 를 우회**한다 —
//   그래서 0093 dryrun 이 이 결함을 못 잡았다.
// ★ 사용자 UUID 는 앞 8자만 출력한다.
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
const one = async (s, a) => (await c.query(s, a)).rows[0]
const rows = async (s, a) => (await c.query(s, a)).rows
const mask = u => String(u || '').slice(0, 8) + '…'

await c.connect()
try {
  /* ── 1) 정책·기본값·트리거 ── */
  console.log('■ vaccine_survey_audit INSERT 정책')
  for (const r of await rows(`select policyname, cmd, roles::text, coalesce(with_check,'') wc
    from pg_policies where schemaname='public' and tablename='vaccine_survey_audit' order by cmd, policyname`)) {
    console.log('   ' + r.policyname + '  [' + r.cmd + '] ' + r.roles)
    if (r.wc) console.log('     WITH CHECK: ' + r.wc.replace(/\s+/g, ' '))
  }

  console.log('\n■ tenant_id · user_id 기본값 / NOT NULL')
  for (const r of await rows(`select column_name, is_nullable, coalesce(column_default,'(없음)') dflt
    from information_schema.columns
    where table_schema='public' and table_name='vaccine_survey_audit'
      and column_name in ('tenant_id','user_id','survey_id','action','row_count','response_id')
    order by ordinal_position`)) {
    console.log('   ' + r.column_name.padEnd(13) + 'nullable=' + r.is_nullable.padEnd(4) + ' default=' + r.dflt)
  }

  console.log('\n■ BEFORE INSERT 트리거')
  for (const r of await rows(`select t.tgname, p.proname,
      case when (t.tgtype & 2) > 0 then 'BEFORE' else 'AFTER' end whn,
      case when (t.tgtype & 4) > 0 then 'INSERT' else '' end ins,
      case when (t.tgtype & 16) > 0 then 'UPDATE' else '' end upd,
      case when (t.tgtype & 8) > 0 then 'DELETE' else '' end del
    from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
    where cl.relname='vaccine_survey_audit' and not t.tgisinternal order by t.tgname`)) {
    console.log('   ' + r.tgname.padEnd(40) + r.whn + ' ' + [r.ins, r.upd, r.del].filter(Boolean).join('/') + ' → ' + r.proname)
  }

  /* ── 2) owner 찾기 ── */
  const owner = await one(`select tenant_id, user_id, role from public.tenant_members where role='owner' limit 1`)
  if (!owner) { console.error('\n★ owner 행을 찾지 못했습니다'); process.exit(1) }
  console.log('\n■ 재현에 쓸 계정: role=' + owner.role + ' · user_id=' + mask(owner.user_id) + ' · tenant=' + mask(owner.tenant_id))

  /* ── 3) 실제 사용자 권한으로 재현 ── */
  console.log('\n■ authenticated 권한 재현 (BEGIN … ROLLBACK)')
  await c.query('begin')

  /* 회차가 0건이라 FK 대상이 없다 — 트랜잭션 안에서만 만든다(롤백으로 사라진다) */
  const acc = await one(`select id, tenant_id from public.vaccine_accounts where funding_source='일반' limit 1`)
  const cat = await one(`select id from public.vaccine_categories where account_id=$1 limit 1`, [acc.id])
  const sv = await one(`insert into public.vaccine_surveys
    (tenant_id,title,season,account_id,category_ids,vax_start,vax_end)
    values ($1,'진단용(롤백됨)','2026-2027',$2,array[$3::uuid],current_date,current_date+30)
    returning id, tenant_id`, [acc.tenant_id, acc.id, cat.id])
  const rsp = await one(`insert into public.vaccine_survey_responses
    (tenant_id,survey_id,receipt_code,name,name_key,self_dose,family_count,account_id,wish_date,consent_at)
    values ($1,$2,'AB2345','진단','진단',true,0,$3,current_date,now()) returning id`,
    [acc.tenant_id, sv.id, acc.id])

  /* 다른 tenant 를 하나 찾아 둔다(교차 tenant 시험용). 없으면 건너뛴다. */
  const other = await one(`select id from public.tenants where id <> $1 limit 1`, [owner.tenant_id])

  await c.query(`set local role authenticated`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: owner.user_id, role: 'authenticated' })])

  const ctx = await one(`select auth.uid()::text uid,
    (select count(*)::int from public.current_tenant_ids()) tenants,
    public.is_tenant_admin($1) admin`, [owner.tenant_id])
  console.log('   auth.uid()            = ' + mask(ctx.uid) + (ctx.uid === owner.user_id ? '  (owner 와 일치)' : '  ★불일치'))
  console.log('   current_tenant_ids()  = ' + ctx.tenants + '건')
  console.log('   is_tenant_admin()     = ' + ctx.admin)

  /* 화면과 **똑같은** INSERT — user_id 에 undefined 가 가서 열이 빠진 상황을 재현한다 */
  const trials = [
    {
      name: '화면 현재 코드 (user_id 열 자체가 빠짐)',
      sql: `insert into public.vaccine_survey_audit (tenant_id, survey_id, action, row_count)
            values ($1,$2,'export_xlsx',3)`,
      args: [sv.tenant_id, sv.id],
    },
    {
      name: 'user_id = NULL 을 명시',
      sql: `insert into public.vaccine_survey_audit (tenant_id, survey_id, user_id, action, row_count)
            values ($1,$2,null,'export_xlsx',3)`,
      args: [sv.tenant_id, sv.id],
    },
    {
      name: 'user_id = auth.uid() 를 올바로 넣음',
      sql: `insert into public.vaccine_survey_audit (tenant_id, survey_id, user_id, action, row_count)
            values ($1,$2,auth.uid(),'export_xlsx',3)`,
      args: [sv.tenant_id, sv.id],
    },
    {
      name: '원문 보기(view_raw) — 화면 현재 코드',
      sql: `insert into public.vaccine_survey_audit (tenant_id, survey_id, action, response_id)
            values ($1,$2,'view_raw',$3)`,
      args: [sv.tenant_id, sv.id, rsp.id],
    },
    {
      name: '원문 보기(view_raw) — user_id 올바로',
      sql: `insert into public.vaccine_survey_audit (tenant_id, survey_id, user_id, action, response_id)
            values ($1,$2,auth.uid(),'view_raw',$3)`,
      args: [sv.tenant_id, sv.id, rsp.id],
    },
  ]
  for (const t of trials) {
    await c.query('savepoint sp')
    try {
      await c.query(t.sql, t.args)
      console.log('   성공   ' + t.name)
    } catch (e) {
      console.log('   ★실패  ' + t.name)
      console.log('            ' + e.code + ' ' + e.message.replace(/\s+/g, ' ').slice(0, 100))
    } finally { await c.query('rollback to savepoint sp') }
  }

  /* WITH CHECK 의 세 조건을 하나씩 평가 — 어느 것이 false 인지 */
  console.log('\n■ WITH CHECK 세 조건 개별 평가 (화면 현재 코드가 보내는 값 기준)')
  const cond = await one(`select
    ($1::uuid in (select public.current_tenant_ids()))      as c_tenant,
    public.is_tenant_admin($1::uuid)                        as c_admin,
    (null::uuid = auth.uid())                               as c_user_null,
    (auth.uid() = auth.uid())                               as c_user_ok`, [sv.tenant_id])
  console.log('   tenant_id IN current_tenant_ids()  = ' + cond.c_tenant)
  console.log('   is_tenant_admin(tenant_id)         = ' + cond.c_admin)
  console.log('   user_id = auth.uid()  [user_id NULL] = ' + cond.c_user_null + '   ← ★ 이것이 원인(NULL 은 false 로 취급)')
  console.log('   user_id = auth.uid()  [올바른 값]     = ' + cond.c_user_ok)

  /* 교차 tenant — 다른 tenant 의 회차를 참조하면 막히는지 */
  if (other) {
    console.log('\n■ 다른 tenant 참조 (' + mask(other.id) + ')')
    await c.query('savepoint sp2')
    try {
      await c.query(`insert into public.vaccine_survey_audit (tenant_id, survey_id, user_id, action)
        values ($1,$2,auth.uid(),'export_pdf')`, [other.id, sv.id])
      console.log('   ★ 성공해 버렸다 — 막혀야 한다')
    } catch (e) {
      console.log('   막힘  ' + e.code + ' ' + e.message.replace(/\s+/g, ' ').slice(0, 80))
    } finally { await c.query('rollback to savepoint sp2') }
  } else {
    console.log('\n■ 다른 tenant 없음 — 교차 tenant 시험 건너뜀')
  }

  await c.query('reset role')
  await c.query('rollback')
  console.log('\n===== ROLLBACK 완료 — 운영에 남은 변경 없음 =====')
} catch (e) {
  try { await c.query('reset role'); await c.query('rollback') } catch { /* 무시 */ }
  console.error('★ 진단 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
