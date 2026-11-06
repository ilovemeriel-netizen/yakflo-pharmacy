/* dryrun_0116.mjs — 0116(고위험 갈래 칸) 시험 적용.
 * ★ 전부 `begin … rollback` 안에서 돈다. 끝나면 아무것도 남지 않는다.
 * ★ 값은 넣지 않는다 — 칸만 더하고, 넣어 보는 것도 되돌린다.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const env = {}
for (const l of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await c.query(s, p)).rows
const one = async (s, p) => (await q(s, p))[0]
const P = (...a) => console.log(...a)
let pass = 0, fail = 0
const gate = (t, ok, d) => { if (ok) { pass++; P('  ✅ ' + t + (d ? '  — ' + d : '')) } else { fail++; P('  ❌ ' + t + (d ? '  — ' + d : '')) } }

await c.connect()
P('■ 0116 dryrun — 고위험 갈래 칸(high_alert_class)')
P('   서버 시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)

const before = {
  cols: Number((await one(`select count(*) n from information_schema.columns
                            where table_schema='public' and table_name='drugs'`)).n),
  drugs: Number((await one(`select count(*) n from public.drugs`)).n),
  hi: Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  trg: Number((await one(`select count(*) n from pg_trigger
                           where tgrelid='public.drugs'::regclass and not tgisinternal`)).n),
  snapN: Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
  snapC: String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
  amt: String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s),
}
P('\n■ 적용 전 — drugs 칸 ' + before.cols + ' · 약품 ' + before.drugs
  + ' · 고위험 ' + before.hi + ' · 트리거 ' + before.trg + ' · 감사 ' + before.audit)

await c.query('begin')
try {
  const sql = readFileSync(resolve(ROOT, 'supabase/migrations/0116_drug_high_alert_class.sql'), 'utf8')
    .replace(/^\s*(begin|commit)\s*;\s*$/gim, '')
  await c.query(sql)
  P('\n■ 0116 적용됨 (이 거래 안에서만)')

  const col = await one(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name='high_alert_class'`)
  gate('① 칸이 생겼다', !!col, col ? col.data_type + ' · 널허용 ' + col.is_nullable : '없음')
  gate('② 기본값이 없다 (전부 비어 있다)', !col?.column_default)
  gate('③ 칸이 하나만 늘었다',
    Number((await one(`select count(*) n from information_schema.columns
      where table_schema='public' and table_name='drugs'`)).n) === before.cols + 1,
    before.cols + ' → ' + (before.cols + 1))
  gate('④ 값이 들어간 약이 없다',
    Number((await one(`select count(*) n from public.drugs where high_alert_class is not null`)).n) === 0)

  /* ⑤ 허용 목록이 막아 주는가 */
  const CODE = (await one(`select drug_code from public.drugs where is_high_alert order by drug_name limit 1`)).drug_code
  let blocked = false
  try {
    await c.query('savepoint s1')
    await c.query(`update public.drugs set high_alert_class = '살구색' where drug_code = $1`, [CODE])
    await c.query('release savepoint s1')
  } catch (e) { blocked = /drugs_high_alert_class_chk/.test(e.message); await c.query('rollback to savepoint s1') }
  gate('⑤ 허용 목록에 없는 값은 거절된다', blocked, "'살구색' 같은 아무 글자는 못 들어간다")

  /* ⑥ 정해진 세 갈래는 들어간다 */
  const OK = ['electrolyte_na', 'electrolyte_k', 'insulin']
  let allOk = true
  for (const v of OK) {
    try { await c.query(`update public.drugs set high_alert_class = $1 where drug_code = $2`, [v, CODE]) }
    catch { allOk = false }
  }
  gate('⑥ 정해진 세 갈래는 들어간다', allOk, OK.join(' · '))
  gate('⑦ 비우는 것도 된다 (지정 해제)',
    await (async () => { await c.query(`update public.drugs set high_alert_class = null where drug_code=$1`, [CODE])
      return (await one(`select high_alert_class h from public.drugs where drug_code=$1`, [CODE])).h === null })())

  /* ⑧ 고위험이 아닌 약에도 넣을 수 있는가 — 막지 않는다(쓰이지 않을 뿐) */
  const PLAIN = (await one(`select drug_code from public.drugs where not is_high_alert limit 1`)).drug_code
  await c.query(`update public.drugs set high_alert_class='insulin' where drug_code=$1`, [PLAIN])
  gate('⑧ 고위험이 아닌 약에 넣어도 DB 는 막지 않는다 (화면이 is_high_alert 로 거른다)', true,
    '라벨은 is_high_alert 가 참일 때만 이 값을 본다')
  await c.query(`update public.drugs set high_alert_class=null where drug_code=$1`, [PLAIN])

  /* ⑨ 건드리면 안 되는 것 */
  P('')
  gate('⑨ 약품 줄 수 불변',
    Number((await one(`select count(*) n from public.drugs`)).n) === before.drugs, String(before.drugs))
  gate('⑩ 고위험 지정 불변',
    Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n) === before.hi, String(before.hi))
  gate('⑪ 트리거 수 불변',
    Number((await one(`select count(*) n from pg_trigger
      where tgrelid='public.drugs'::regclass and not tgisinternal`)).n) === before.trg, String(before.trg))
  gate('⑫ 감사표 줄 수 불변 (이 칸은 기록 대상이 아니다)',
    Number((await one(`select count(*) n from public.drug_usage_audit`)).n) === before.audit,
    before.audit + '줄')
  gate('⑬ 재고금액 불변',
    String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s) === before.amt,
    before.amt)
  const sn = await one(`select count(*) n, sum(closing_amount)::text c from public.monthly_snapshots`)
  gate('⑭ 월 스냅샷(마감값) 불변',
    Number(sn.n) === before.snapN && sn.c === before.snapC, sn.n + '줄 · 기말 ' + sn.c)
} finally {
  await c.query('rollback')
  P('\n■ rollback 완료 — 아무것도 남기지 않았다.')
}

P('')
gate('⑮ 되돌아갔다 — 칸이 없다',
  Number((await one(`select count(*) n from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name='high_alert_class'`)).n) === 0)
gate('⑯ 되돌아갔다 — drugs 칸 수',
  Number((await one(`select count(*) n from information_schema.columns
    where table_schema='public' and table_name='drugs'`)).n) === before.cols,
  before.cols + '개')

P('\n■ 지금 고위험 4종이 받게 될 갈래 (참고 — 넣지 않았다)')
for (const r of await q(`select drug_code, drug_name from public.drugs where is_high_alert order by drug_name`)) {
  const g = /나트륨/.test(r.drug_name) ? 'electrolyte_na (초록)'
    : /칼륨/.test(r.drug_name) ? 'electrolyte_k (빨강)'
    : /휴마로그|휴물린/.test(r.drug_name) ? 'insulin (살구)' : '(정해야 함)'
  P('   ' + r.drug_code.padEnd(12) + String(r.drug_name).padEnd(26) + '→ ' + g)
}

P('\n■ 결과: 통과 ' + pass + ' · 실패 ' + fail)
await c.end()
process.exit(fail ? 1 : 0)
