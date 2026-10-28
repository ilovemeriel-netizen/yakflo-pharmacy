// A 산식 실측 검산 + 정책 상태 — 읽기 전용(BEGIN READ ONLY … ROLLBACK), 개인 행 출력 없음
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
const one = async s => (await c.query(s)).rows[0]
const rows = async s => (await c.query(s)).rows

const PAID = '5dcb9b9f-d1bf-4bca-b2ac-1d11f6b5e173'
const STAFF = 'e16bad4b-39a3-4d8b-87c7-1f045eb058e7'
const FAM = '01ef2368-d8ec-48a5-94d3-71341739d515'
const OUT = 'a82483fd-f6a9-4a9e-b889-c9c34758f1e1'

await c.connect()
try {
  await c.query('begin read only')

  console.log('■ A 산식 실측 검산 — open_at = 2026-09-01 로 둔 시뮬레이션')
  const r = await one(`
    with sel as (select coalesce(sum(qty),0)::numeric q from public.vaccine_events
      where event_type='접종' and account_id='${PAID}'
        and category_id = any(array['${STAFF}'::uuid,'${FAM}'::uuid])
        and event_date >= (timestamptz '2026-09-01 00:00+09' at time zone 'Asia/Seoul')::date),
    outq as (select coalesce(sum(qty),0)::numeric q from public.vaccine_events
      where event_type='접종' and account_id='${PAID}' and category_id='${OUT}'
        and event_date >= date '2026-09-01'),
    allq as (select coalesce(sum(qty),0)::numeric q from public.vaccine_events
      where event_type='접종' and account_id='${PAID}' and event_date >= date '2026-09-01')
    select (select q from sel) sel, (select q from outq) outq, (select q from allq) allq`)
  console.log('   선택 분류 2개(직원(무료)·직원가족&간병사(30000)) = ' + r.sel)
  console.log('   외래&입원(35000)                              = ' + r.outq + '  ← A 에 들어가면 안 된다')
  console.log('   계정 전체 접종                                 = ' + r.allq)
  console.log('   sel + outq = allq ?            ' + (Number(r.sel) + Number(r.outq) === Number(r.allq) ? 'OK' : '★NG'))
  console.log('   A 가 외래&입원을 제외했나 ?      ' + (Number(r.sel) < Number(r.allq) ? 'OK (' + r.outq + '도즈 제외)' : '★NG'))

  console.log('\n■ 조사 연 날 경계 (결정 ⓒ — 당일 포함, >= 사용)')
  const b = await rows(`
    select d.lbl, coalesce(sum(e.qty),0)::numeric q from (values
      ('open=2026-09-21 (첫 접종일 당일)', '2026-09-21'),
      ('open=2026-09-22 (첫 접종일 다음날)', '2026-09-22')) d(lbl, dt)
    left join public.vaccine_events e
      on e.event_type='접종' and e.account_id='${PAID}'
     and e.category_id = any(array['${STAFF}'::uuid,'${FAM}'::uuid])
     and e.event_date >= d.dt::date
    group by 1 order by 1`)
  for (const x of b) console.log('   ' + String(x.lbl).padEnd(34) + 'A = ' + x.q)
  console.log('   당일을 포함하면 A 가 더 크다 ?   ' + (Number(b[0].q) > Number(b[1].q) ? 'OK' : '★NG'))

  console.log('\n■ 새 객체·정책 상태 (적용 후)')
  const s = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') pol,
    (select count(*)::int from pg_policies where schemaname='public' and tablename like 'vaccine_survey%') newpol,
    (select count(*)::int from public.vaccine_surveys) sv,
    (select count(*)::int from public.vaccine_survey_responses) rs,
    (select count(*)::int from public.vaccine_survey_audit) au,
    (select count(*)::int from public.vaccine_survey_attempts) at,
    (select count(*)::int from public.vaccine_public_attempts) oldat,
    (select count(*)::int from public.vaccine_events) ev,
    (select count(*)::int from public.vaccine_categories) cats`)
  console.log('   정책 ' + s.pol + ' (신규 ' + s.newpol + ')')
  console.log('   surveys ' + s.sv + ' · responses ' + s.rs + ' · audit ' + s.au + ' · attempts ' + s.at + '  ← 전부 0 이어야 한다(시험 데이터 없음)')
  console.log('   0091 잠금 ' + s.oldat + '행 · vaccine_events ' + s.ev + '행 · 분류 ' + s.cats + '개  ← 불변')

  console.log('\n■ is_tenant_admin 정의')
  const f = await one(`select pg_get_functiondef(p.oid) d from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='is_tenant_admin'`)
  console.log(f.d.split('\n').filter(l => /role|tenant_members|search_path|SECURITY|STABLE/i.test(l)).map(l => '   ' + l.trim()).join('\n'))

  console.log('\n■ 새 테이블 권한 요약')
  for (const t of ['vaccine_surveys', 'vaccine_survey_responses', 'vaccine_survey_audit', 'vaccine_survey_attempts']) {
    const g = await rows(`select grantee, string_agg(distinct privilege_type, ',' order by privilege_type) p
      from information_schema.role_table_grants
      where table_schema='public' and table_name='${t}' and grantee in ('anon','authenticated','service_role')
      group by grantee order by grantee`)
    console.log('   ' + t.padEnd(26) + (g.length ? g.map(x => x.grantee + '=' + x.p).join(' · ') : '(없음)'))
  }

  await c.query('rollback')
  console.log('\n===== ROLLBACK 완료 — 읽기만 했습니다 =====')
} catch (e) {
  try { await c.query('rollback') } catch { /* 무시 */ }
  console.error('★ 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
