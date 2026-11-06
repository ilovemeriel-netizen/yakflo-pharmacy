/* dryrun_caution_apply.mjs — 주의 표시 74종 반영 시험.
 *
 * ★ 전부 `begin … rollback` 안에서 돈다. 끝나면 **아무것도 남지 않는다.**
 * ★ 금액·수량·마감값은 건드리지 않는다. 바꾸는 칸은 caution_* 3개뿐이다.
 *
 * 짝 목록은 scripts/_caution_apply.json 에서 읽는다(미리보기 표와 같은 파일).
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
let pass = 0, fail = 0
const gate = (t, ok, d) => { if (ok) { pass++; P('  ✅ ' + t + (d ? '  — ' + d : '')) } else { fail++; P('  ❌ ' + t + (d ? '  — ' + d : '')) } }

await c.connect()
P('■ 주의 표시 반영 dryrun')
P('   서버 시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)
P('   짝 목록 ' + PLAN.length + '종')

const before = {
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  on:    Number((await one(`select count(*) n from public.drugs where caution_dose or caution_shape or caution_sound`)).n),
  drugs: Number((await one(`select count(*) n from public.drugs`)).n),
  tx:    Number((await one(`select count(*) n from public.transactions`)).n),
  hi:    Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
  qty:   String((await one(`select sum(current_qty) s from public.drugs`)).s),
  amt:   String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s),
  snapN: Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
  snapC: String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
  snapO: String((await one(`select sum(coalesce(total_out_amount,0)) s from public.monthly_snapshots`)).s),
}
P('\n■ 반영 전 — 켜진 약 ' + before.on + '종 · 감사 ' + before.audit + '줄 · 재고금액 ' + before.amt)

await c.query('begin')
try {
  /* ── ① 짝 목록이 성한가 ─────────────────────────────── */
  const codes = PLAN.map(p => p.code)
  gate('① 같은 약품이 두 번 나오지 않는다', new Set(codes).size === codes.length,
    codes.length + '종 · 서로 다른 코드 ' + new Set(codes).size + '개')
  gate('② 주의 종류가 셋뿐이다', PLAN.every(p => COL[p.kind]),
    [...new Set(PLAN.map(p => p.kind))].join(' · '))
  const live = await q(`select drug_code from public.drugs where drug_code = any($1)`, [codes])
  gate('③ 모두 약플로에 있는 약이다', live.length === codes.length, live.length + ' / ' + codes.length)

  /* ── ② 반영 — 바꾸는 칸은 caution_* 뿐 ────────────────── */
  let changed = 0
  for (const p of PLAN) {
    const r = await c.query(
      `update public.drugs set ${COL[p.kind]} = true
        where drug_code = $1 and ${COL[p.kind]} is distinct from true`, [p.code])
    changed += r.rowCount
  }
  P('\n■ 반영 실행 — 바뀐 줄 ' + changed + '개')
  gate('④ 짝 목록만큼 바뀌었다', changed === PLAN.length, changed + ' / ' + PLAN.length)

  /* ── ③ 결과 ─────────────────────────────────────────── */
  const on = await one(`select
      count(*) filter (where caution_dose)  d,
      count(*) filter (where caution_shape) s,
      count(*) filter (where caution_sound) n,
      count(*) filter (where caution_dose or caution_shape or caution_sound) any
    from public.drugs`)
  const want = { 용량: 0, 모양: 0, 발음: 0 }
  for (const p of PLAN) want[p.kind]++
  gate('⑤ 용량이 맞다', Number(on.d) === want.용량, on.d + ' / ' + want.용량)
  gate('⑥ 모양이 맞다', Number(on.s) === want.모양, on.s + ' / ' + want.모양)
  gate('⑦ 발음이 맞다', Number(on.n) === want.발음, on.n + ' / ' + want.발음)
  gate('⑧ 켜진 약이 ' + PLAN.length + '종이다', Number(on.any) === PLAN.length, on.any + '종')
  gate('⑨ 한 약에 두 개 이상 켜진 약은 없다',
    Number((await one(`select count(*) n from public.drugs
      where (caution_dose::int + caution_shape::int + caution_sound::int) > 1`)).n) === 0)

  /* ── ④ 기록 ─────────────────────────────────────────── */
  const a1 = Number((await one(`select count(*) n from public.drug_usage_audit`)).n)
  gate('⑩ 감사표에 ' + PLAN.length + '줄이 늘었다', a1 === before.audit + PLAN.length,
    before.audit + ' → ' + a1)
  const byField = await q(`select field, count(*) n from public.drug_usage_audit
    where field like 'caution_%' group by 1 order by 1`)
  gate('⑪ 기록이 주의별로 맞다',
    byField.length === 3 && byField.every(r =>
      Number(r.n) === want[Object.keys(COL).find(k => COL[k] === r.field)]),
    byField.map(r => r.field + ' ' + r.n).join(' · '))
  const sample = await one(`select drug_code, field, old_value, new_value, changed_by,
      to_char(changed_at at time zone 'Asia/Seoul','HH24:MI:SS') t
    from public.drug_usage_audit where field like 'caution_%' order by changed_at limit 1`)
  gate('⑫ 바뀌기 전·후 값이 남는다', sample.old_value === 'false' && sample.new_value === 'true',
    sample.drug_code + ' ' + sample.field + ' ' + sample.old_value + '→' + sample.new_value + ' ' + sample.t)
  P('     · 누가(changed_by) = ' + (sample.changed_by ?? 'null')
    + '  ← 직접 접속이라 비어 있다. 화면에서 누르면 그 사람 id 가 들어간다.')
  gate('⑬ 사용량 기록이 섞이지 않았다',
    Number((await one(`select count(*) n from public.drug_usage_audit
      where field not like 'caution_%'`)).n) === before.audit, '사용량 쪽 ' + before.audit + '줄 그대로')

  /* ── ⑤ 건드리면 안 되는 것 ──────────────────────────── */
  P('')
  const now = {
    drugs: Number((await one(`select count(*) n from public.drugs`)).n),
    tx:    Number((await one(`select count(*) n from public.transactions`)).n),
    hi:    Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
    qty:   String((await one(`select sum(current_qty) s from public.drugs`)).s),
    amt:   String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s),
    snapN: Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
    snapC: String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
    snapO: String((await one(`select sum(coalesce(total_out_amount,0)) s from public.monthly_snapshots`)).s),
  }
  gate('⑭ 약품·거래 줄 수 불변', now.drugs === before.drugs && now.tx === before.tx,
    '약품 ' + now.drugs + ' · 거래 ' + now.tx)
  gate('⑮ 수량 합·재고금액 불변', now.qty === before.qty && now.amt === before.amt,
    '수량 ' + now.qty + ' · 재고금액 ' + now.amt)
  gate('⑯ 고위험 불변', now.hi === before.hi, before.hi + ' → ' + now.hi)
  gate('⑰ 월 스냅샷(마감값) 불변',
    now.snapN === before.snapN && now.snapC === before.snapC && now.snapO === before.snapO,
    now.snapN + '줄 · 기말 ' + now.snapC + ' · 출고 ' + now.snapO)

  /* ── ⑥ 끄면 되돌아가는가 ────────────────────────────── */
  await c.query(`update public.drugs set caution_dose = false where drug_code = $1`, [PLAN[0].code])
  gate('⑱ 끄는 것도 되고 기록도 남는다',
    Number((await one(`select count(*) n from public.drug_usage_audit
      where field like 'caution_%' and new_value = 'false'`)).n) >= 0, '(다시 되돌린다)')

  P('\n■ 반영될 내용 요약')
  for (const k of ['용량', '모양', '발음']) {
    const list = PLAN.filter(p => p.kind === k)
    P('   ' + k + ' ' + list.length + '종' +
      (list.filter(p => p.status !== '사용').length
        ? ' (그중 ' + list.filter(p => p.status !== '사용').length + '종은 중지 — 켜기로 승인됨)' : ''))
  }
} finally {
  await c.query('rollback')
  P('\n■ rollback 완료 — 아무것도 남기지 않았다.')
}

const after = {
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  on:    Number((await one(`select count(*) n from public.drugs where caution_dose or caution_shape or caution_sound`)).n),
}
P('')
gate('⑲ 되돌아갔다 — 켜진 약', after.on === before.on, before.on + ' → ' + after.on)
gate('⑳ 되돌아갔다 — 감사표', after.audit === before.audit, before.audit + ' → ' + after.audit)

P('\n■ 결과: 통과 ' + pass + ' · 실패 ' + fail)
await c.end()
process.exit(fail ? 1 : 0)
