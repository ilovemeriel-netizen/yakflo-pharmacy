// diag_panel_rls.mjs — 수요 현황 패널이 쓰는 **모든 RLS 경로**를 실제 사용자 권한으로 점검.
//
// ★ 왜 필요한가 — 0093 dryrun 은 기본 연결(postgres = 테이블 소유자)로 돌아 **RLS 를 우회**했다.
//   그래서 audit INSERT 결함을 못 잡았다. 같은 사각지대에 다른 경로도 있을 수 있어 전수 확인한다.
// ★ 전부 BEGIN … ROLLBACK 안에서 돌고 끝에서 rollback 한다. 운영에 남는 변경이 없다.
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
const mask = u => String(u || '').slice(0, 8) + '…'

const out = []
async function step(name, fn) {
  await c.query('savepoint sp')
  try {
    const info = await fn()
    out.push([name, true, info || ''])
    console.log('   성공   ' + name.padEnd(52) + (info || ''))
    await c.query('release savepoint sp')
  } catch (e) {
    out.push([name, false, e.code + ' ' + e.message.replace(/\s+/g, ' ').slice(0, 70)])
    console.log('   ★실패  ' + name.padEnd(52) + e.code + ' ' + e.message.replace(/\s+/g, ' ').slice(0, 70))
    await c.query('rollback to savepoint sp')
  }
}

await c.connect()
try {
  const owner = await one(`select tenant_id, user_id from public.tenant_members where role='owner' limit 1`)
  const acc = await one(`select id, tenant_id, season from public.vaccine_accounts where funding_source='일반' limit 1`)
  const cat = await one(`select id from public.vaccine_categories where account_id=$1 limit 1`, [acc.id])
  console.log('■ 재현 계정 owner=' + mask(owner.user_id) + ' tenant=' + mask(owner.tenant_id))

  await c.query('begin')
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: owner.user_id, role: 'authenticated' })])

  console.log('\n■ 수요 현황 패널의 RLS 경로 (authenticated + owner JWT)')

  let svId = null
  await step('① 회차 만들기 — 화면 코드대로 tenant_id 를 안 보냄', async () => {
    const r = await one(`insert into public.vaccine_surveys
      (title, season, account_id, category_ids, vax_start, vax_end)
      values ('진단용(롤백됨)', $1, $2, array[$3::uuid], current_date, current_date+30)
      returning id, tenant_id`, [acc.season, acc.id, cat.id])
    svId = r.id
    return 'tenant_id=' + mask(r.tenant_id)
  })

  if (!svId) {
    /* ①이 막히면 뒤 단계를 못 보므로 postgres 로 만들어 두고 계속한다 */
    await c.query('reset role')
    const r = await one(`insert into public.vaccine_surveys
      (tenant_id,title,season,account_id,category_ids,vax_start,vax_end)
      values ($1,'진단용(롤백됨)',$2,$3,array[$4::uuid],current_date,current_date+30) returning id`,
      [acc.tenant_id, acc.season, acc.id, cat.id])
    svId = r.id
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: owner.user_id, role: 'authenticated' })])
    console.log('     (①이 막혀 회차는 postgres 로 만들어 두고 이어갑니다)')
  }

  await step('② 회차 수정 — 조사 열기(status·open_at)', async () => {
    await c.query(`update public.vaccine_surveys set status='open', open_at=now(), updated_at=now() where id=$1`, [svId])
    return ''
  })

  await step('③ 회차 목록 SELECT', async () =>
    (await one(`select count(*)::int n from public.vaccine_surveys`)).n + '행')

  await step('④ v_vaccine_demand SELECT', async () => {
    const r = await one(`select demand_qty, administered_qty, balance_qty, order_qty, demand_status
      from public.v_vaccine_demand where survey_id=$1`, [svId])
    return r ? `D=${r.demand_qty} A=${r.administered_qty} B=${r.balance_qty} O=${r.order_qty} ${r.demand_status}` : '0행'
  })

  /* 응답은 service_role 이 넣는다 — 패널은 읽기·일부 수정만 한다.
     시험용 행은 postgres 로 만든다(공개 함수 역할을 대신). */
  await c.query('reset role')
  const rsp = await one(`insert into public.vaccine_survey_responses
    (tenant_id,survey_id,receipt_code,name,name_key,self_dose,family_count,account_id,wish_date,consent_at)
    values ($1,$2,'AB2345','진단','진단',true,2,$3,current_date,now()) returning id`,
    [acc.tenant_id, svId, acc.id])
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: owner.user_id, role: 'authenticated' })])

  await step('⑤ 명단 SELECT', async () =>
    (await one(`select count(*)::int n from public.vaccine_survey_responses where survey_id=$1`, [svId])).n + '행')

  await step('⑥ 명단 — 상태 변경 UPDATE', async () => {
    await c.query(`update public.vaccine_survey_responses set status='cancelled', updated_at=now() where id=$1`, [rsp.id])
    return ''
  })
  await step('⑦ 명단 — 접종 완료 체크 UPDATE', async () => {
    await c.query(`update public.vaccine_survey_responses set done_self=true, done_family=1, updated_at=now() where id=$1`, [rsp.id])
    return ''
  })
  await step('⑧ 명단 — 성명 UPDATE 는 막혀야 한다', async () => {
    await c.query(`update public.vaccine_survey_responses set name='해킹' where id=$1`, [rsp.id])
    return '★ 통과해 버렸다'
  })

  for (const [act, extra] of [['export_xlsx', 'row_count'], ['export_pdf', 'row_count'], ['view_raw', 'response_id']]) {
    await step(`⑨ audit INSERT ${act} — 화면 현재 코드(user_id 누락)`, async () => {
      if (extra === 'row_count') {
        await c.query(`insert into public.vaccine_survey_audit (tenant_id, survey_id, action, row_count)
          values ($1,$2,$3,3)`, [acc.tenant_id, svId, act])
      } else {
        await c.query(`insert into public.vaccine_survey_audit (tenant_id, survey_id, action, response_id)
          values ($1,$2,$3,$4)`, [acc.tenant_id, svId, act, rsp.id])
      }
      return '★ 통과해 버렸다'
    })
  }

  await step('⑩ audit SELECT', async () =>
    (await one(`select count(*)::int n from public.vaccine_survey_audit`)).n + '행')

  await step('⑪ purge RPC — 조건 미달이라 거부되어야 한다(권한 오류가 아니어야)', async () => {
    await c.query(`select public.purge_vaccine_survey($1)`, [svId])
    return '★ 통과해 버렸다'
  })

  await c.query('reset role')
  await c.query('rollback')

  console.log('\n■ 요약')
  const bad = out.filter(([n, ok]) => {
    const shouldFail = /막혀야|거부되어야/.test(n)
    return shouldFail ? ok : !ok
  })
  console.log('   확인 ' + out.length + '건 · 뜻대로 동작하지 않은 것 ' + bad.length + '건')
  for (const [n, , info] of bad) console.log('     ★ ' + n + '  → ' + info)
  console.log('\n===== ROLLBACK 완료 — 운영에 남은 변경 없음 =====')
} catch (e) {
  try { await c.query('reset role'); await c.query('rollback') } catch { /* 무시 */ }
  console.error('★ 진단 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
