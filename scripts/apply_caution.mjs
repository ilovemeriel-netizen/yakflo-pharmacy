/* apply_caution.mjs — 주의 표시 74종 운영 반영. 이정화 님 승인(B·2026-11-06).
 *
 * ★ 바꾸는 칸은 caution_dose / caution_shape / caution_sound 셋뿐이다.
 *   금액·수량·단가·마감값·상태는 한 글자도 건드리지 않는다.
 * ★ 하나의 거래로 묶는다 — 중간에 어긋나면 통째로 되돌린다.
 * ★ 이미 켜져 있으면 건너뛴다(`is distinct from true`) — 쓸데없는 감사 줄을 만들지 않는다.
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
const PLAN = JSON.parse(readFileSync(resolve(ROOT, 'scripts/_caution_apply.json'), 'utf8'))
const COL = { 용량: 'caution_dose', 모양: 'caution_shape', 발음: 'caution_sound' }

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await c.query(s, p)).rows
const one = async (s, p) => (await q(s, p))[0]
const P = (...a) => console.log(...a)
let fail = 0
const gate = (t, ok, d) => { if (!ok) fail++; P('  ' + (ok ? '✅' : '❌') + ' ' + t + (d ? '  — ' + d : '')) }

const measure = async () => ({
  drugs: Number((await one(`select count(*) n from public.drugs`)).n),
  tx:    Number((await one(`select count(*) n from public.transactions`)).n),
  hi:    Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  qty:   String((await one(`select sum(current_qty) s from public.drugs`)).s),
  amt:   String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s),
  snapN: Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
  snapC: String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
  snapO: String((await one(`select sum(coalesce(total_out_amount,0)) s from public.monthly_snapshots`)).s),
  use:   Number((await one(`select count(*) n from public.drug_usage_audit where field not like 'caution_%'`)).n),
})

await c.connect()
P('■ 주의 표시 74종 운영 반영')
P('   시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)
const b = await measure()
P('   반영 전 — 약품 ' + b.drugs + ' · 거래 ' + b.tx + ' · 감사 ' + b.audit + ' · 재고금액 ' + b.amt)

await c.query('begin')
let changed = 0
try {
  for (const p of PLAN) {
    const r = await c.query(
      `update public.drugs set ${COL[p.kind]} = true
        where drug_code = $1 and ${COL[p.kind]} is distinct from true`, [p.code])
    changed += r.rowCount
  }
  if (changed !== PLAN.length) throw new Error('바뀐 줄 ' + changed + ' ≠ 짝 목록 ' + PLAN.length + ' — 되돌린다')
  await c.query('commit')
  P('\n■ 반영 완료 — 바뀐 줄 ' + changed + '개')
} catch (e) {
  await c.query('rollback')
  P('\n■ ❌ 되돌렸다: ' + e.message)
  await c.end(); process.exit(1)
}

const a = await measure()
const on = await one(`select
    count(*) filter (where caution_dose)  d,
    count(*) filter (where caution_shape) s,
    count(*) filter (where caution_sound) n,
    count(*) filter (where caution_dose or caution_shape or caution_sound) any
  from public.drugs`)
const want = { 용량: 0, 모양: 0, 발음: 0 }
for (const p of PLAN) want[p.kind]++

P('\n■ 반영 후 확인')
gate('① 켜진 약이 ' + PLAN.length + '종', Number(on.any) === PLAN.length, on.any + '종')
gate('② 용량 ' + want.용량, Number(on.d) === want.용량, on.d + ' / ' + want.용량)
gate('③ 모양 ' + want.모양, Number(on.s) === want.모양, on.s + ' / ' + want.모양)
gate('④ 발음 ' + want.발음, Number(on.n) === want.발음, on.n + ' / ' + want.발음)
gate('⑤ 한 약에 두 개 이상 켜진 약 없음',
  Number((await one(`select count(*) n from public.drugs
    where (caution_dose::int + caution_shape::int + caution_sound::int) > 1`)).n) === 0)
gate('⑥ 감사표가 ' + b.audit + ' → ' + (b.audit + PLAN.length), a.audit === b.audit + PLAN.length,
  b.audit + ' → ' + a.audit)
const byField = await q(`select field, count(*) n from public.drug_usage_audit
  where field like 'caution_%' group by 1 order by 1`)
gate('⑦ 기록이 주의별로 맞다',
  byField.length === 3 && byField.every(r => Number(r.n) === want[Object.keys(COL).find(k => COL[k] === r.field)]),
  byField.map(r => r.field + ' ' + r.n).join(' · '))
gate('⑧ 사용량 기록이 섞이지 않았다', a.use === b.use, '사용량 쪽 ' + a.use + '줄 그대로')
gate('⑨ 약품·거래 줄 수 불변', a.drugs === b.drugs && a.tx === b.tx, '약품 ' + a.drugs + ' · 거래 ' + a.tx)
gate('⑩ 수량 합·재고금액 불변', a.qty === b.qty && a.amt === b.amt, '수량 ' + a.qty + ' · 재고금액 ' + a.amt)
gate('⑪ 고위험 불변', a.hi === b.hi, b.hi + ' → ' + a.hi)
gate('⑫ 월 스냅샷(마감값) 불변',
  a.snapN === b.snapN && a.snapC === b.snapC && a.snapO === b.snapO,
  a.snapN + '줄 · 기말 ' + a.snapC + ' · 출고 ' + a.snapO)

P('\n■ 켜진 약 목록 (주의별)')
for (const [k, col] of Object.entries(COL)) {
  const rows = await q(`select drug_code, drug_name, status from public.drugs where ${col} order by drug_name`)
  P('  ▸ ' + k + ' ' + rows.length + '종')
  for (const r of rows) P('     ' + r.drug_code.padEnd(12) + r.drug_name.padEnd(26) + (r.status === '사용' ? '' : '[' + r.status + ']'))
}
P('\n■ 결과: ' + (fail ? '❌ 실패 ' + fail + '건' : '✅ 모두 통과'))
await c.end()
process.exit(fail ? 1 : 0)
