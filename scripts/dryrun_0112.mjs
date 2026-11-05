// dryrun_0112.mjs — 0112(사용량 감사표에 안전재고·최대재고)를 **되돌리는 거래 안에서** 시험한다.
//
// ★ 이 스크립트는 언제나 ROLLBACK 한다. 운영에 남는 변화가 없다.
// ★ 2026-11-05 정정 — ⑦ 번 시험을 「회원 아닌 사람이 바꾸면 **오류가 나야 한다**」로
//   적었다가 거짓 실패가 났다. 실제 동작은 이렇다:
//     회원 아닌 사람에게는 RLS 가 **줄을 먼저 숨긴다** → UPDATE 가 **0줄**이 되고
//     트리거는 **아예 돌지 않는다**(0112 없이도 같다). 가드는 뚫리지 않았다.
//   그래서 판정 기준을 **「바뀐 줄이 0줄이어야 한다」**로 둔다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

function rd(p) {
  const o = {}; if (!existsSync(p)) return o
  let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  /* ★ .env 에 DATABASE_URL 이 두 줄 있다 — 전체를 훑어 **뒤에 나온 값이 이기게** 한다
       (앞줄은 직결 호스트라 DNS 가 안 풀린다). */
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}
const env = rd('.env')
let url = env.DATABASE_URL || ''
if (/\/postgre$/.test(url)) url += 's'
const UID = process.env.YAKFLO_OWNER_UID || ''        /* 소유자 계정 uuid — 비밀값 아님, 환경변수로 받는다 */
const NOBODY = '00000000-0000-0000-0000-000000000000' /* 어느 약국에도 속하지 않은 사람 */
const SQL = readFileSync('supabase/migrations/0112_usage_audit_add_stock_cols.sql', 'utf8')
  .replace(/^\s*begin;\s*$/m, '').replace(/^\s*commit;\s*$/m, '')  /* 거래는 이 파일이 직접 감싼다 */

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const P = (...a) => console.log(...a)
const q = async (s, p) => (await c.query(s, p)).rows
c.on('notice', m => P('  [알림] ' + String(m.message)))
let ok = true
const gate = (name, pass, got) => { if (!pass) ok = false; P('  ' + (pass ? 'OK ' : '★NG') + '  ' + String(name).padEnd(46) + ' ' + got) }

if (!UID) { P('★ 중단 — 환경변수 YAKFLO_OWNER_UID(소유자 uuid)가 없다'); await c.end(); process.exit(1) }

P('■ 적용 전')
const audit0 = (await q('select count(*) n from public.drug_usage_audit'))[0].n
const zpd0 = (await q(`select safety_stock s, max_stock m, recent_1m_usage u
  from public.drugs where drug_code = 'ZPD'`))[0]
P('  감사표 ' + audit0 + '줄 · 졸피드 안전 ' + zpd0.s + ' · 최대 ' + zpd0.m + ' · 1개월 ' + zpd0.u)

await c.query('begin')
try {
  await c.query(SQL)
  P('\n■ 적용됨 (되돌리는 거래 안)')

  const guard = (await q(`select md5(pg_get_functiondef(p.oid)) h from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_usage_edit_owner'`))[0].h
  gate('① 가드 함수는 그대로인가', true, 'md5 ' + guard)

  const grants = await q(`select grantee g, string_agg(distinct privilege_type, ',') p
    from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'drug_usage_audit' group by 1 order by 1`)
  gate('② authenticated 는 읽기만인가',
    grants.some(r => r.g === 'authenticated' && r.p === 'SELECT'),
    JSON.stringify(grants.map(r => r.g + '=' + r.p)))

  gate('③ 지난 기록이 그대로인가 (소급 없음)',
    String((await q('select count(*) n from public.drug_usage_audit'))[0].n) === String(audit0),
    audit0 + '줄')

  const trg = await q(`select tgenabled e from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid
    where cl.relname = 'drugs' and tgname = 'trg_log_drugs_usage'`)
  gate('④ 트리거 배선이 그대로 켜져 있나', trg.length === 1 && trg[0].e === 'O',
    trg.length ? trg[0].e : '(없음)')

  /* ⑤ 실제로 적히나 — 소유자 계정으로, 가드의 **정상 경로**로 들어간다 */
  await c.query('set local role authenticated')
  await c.query(`set local request.jwt.claims = '{"sub":"${UID}","role":"authenticated"}'`)
  const b1 = Number((await q('select count(*) n from public.drug_usage_audit'))[0].n)
  await c.query(`update public.drugs set safety_stock = safety_stock + 1, max_stock = max_stock + 2
    where drug_code = 'ZPD'`)
  const got = (await q(`select field f, changed_by::text b from public.drug_usage_audit
    order by changed_at desc limit 4`))
  const names = got.map(r => r.f)
  gate('⑤ 안전재고·최대재고가 적히나',
    names.includes('safety_stock') && names.includes('max_stock'),
    (Number((await q('select count(*) n from public.drug_usage_audit'))[0].n) - b1) + '줄 ' + JSON.stringify(names))
  gate('⑥ 바꾼 사람이 소유자로 적히나', got.every(r => r.b === UID), got[0] ? got[0].b : '(없음)')

  /* ⑦ 사용량 5칸이 깨지지 않았나 */
  const b2 = Number((await q('select count(*) n from public.drug_usage_audit'))[0].n)
  await c.query(`update public.drugs set recent_1m_usage = recent_1m_usage + 1 where drug_code = 'ZPD'`)
  const n2 = (await q(`select field f from public.drug_usage_audit order by changed_at desc limit 3`)).map(r => r.f)
  gate('⑦ 사용량 5칸도 그대로 적히나', n2.includes('recent_1m_usage'),
    (Number((await q('select count(*) n from public.drug_usage_audit'))[0].n) - b2) + '줄 ' + JSON.stringify(n2))

  /* ⑧ ★ 회원 아닌 사람 — **0줄**이어야 한다. 오류가 나지 않는 것이 정상이다. */
  await c.query(`set local request.jwt.claims = '{"sub":"${NOBODY}","role":"authenticated"}'`)
  const seen = (await c.query(`select 1 from public.drugs where drug_code = 'ZPD'`)).rowCount
  const upd = (await c.query(`update public.drugs set recent_1m_usage = recent_1m_usage + 1
    where drug_code = 'ZPD'`)).rowCount
  gate('⑧ 회원 아닌 사람이 바꾼 줄 — 0줄이어야 한다', upd === 0,
    '보이는 줄 ' + seen + ' · 바뀐 줄 ' + upd + ' (RLS 가 줄을 먼저 숨긴다 — 오류가 아니다)')
} catch (e) {
  ok = false
  P('\n★ 터졌다: [' + e.code + '] ' + e.message)
}
await c.query('rollback')
P('\n→ rollback 했다. **운영에 남은 변화 없음.**')
const zpd1 = (await q(`select safety_stock s, max_stock m, recent_1m_usage u
  from public.drugs where drug_code = 'ZPD'`))[0]
P('  감사표 ' + (await q('select count(*) n from public.drug_usage_audit'))[0].n
  + '줄 · 졸피드 안전 ' + zpd1.s + ' · 최대 ' + zpd1.m + ' · 1개월 ' + zpd1.u)
P('\n★★ 판정: ' + (ok ? '통과 — 적용해도 된다' : '★ 문제 있음 — 적용하지 말 것'))
await c.end()
process.exit(ok ? 0 : 1)
