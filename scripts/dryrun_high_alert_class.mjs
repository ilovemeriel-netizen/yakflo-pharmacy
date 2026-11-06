/* dryrun_high_alert_class.mjs — 고위험 4종에 갈래 값을 넣는 시험.
 *
 * ★ 전부 `begin … rollback` 안에서 돈다. 끝나면 아무것도 남지 않는다.
 * ★ 바꾸는 칸은 `high_alert_class` 하나뿐이다. 금액·수량·마감값·주의 표시는 건드리지 않는다.
 * ★ 짝 목록은 scripts/_high_alert_class.json 에서 읽는다(화면 코드에 약품코드를 박지 않기 위함).
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
const PLAN = JSON.parse(readFileSync(resolve(ROOT, 'scripts/_high_alert_class.json'), 'utf8'))
/* 색 값은 labelDefs 한 곳에만 있다 — 보고에 쓰려고 여기서도 읽는다 */
const DEFS = readFileSync(resolve(ROOT, 'src/lib/labelDefs.js'), 'utf8')
const colorOf = k => (DEFS.match(new RegExp(k + ":\\s*'(#[0-9A-Fa-f]{6})'")) || [])[1] || '(못 읽음)'
const KO = { electrolyte_na: '나트륨 · 초록', electrolyte_k: '칼륨 · 빨강', insulin: '인슐린 · 살구' }

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = async (s, p) => (await c.query(s, p)).rows
const one = async (s, p) => (await q(s, p))[0]
const P = (...a) => console.log(...a)
let pass = 0, fail = 0
const gate = (t, ok, d) => { if (ok) { pass++; P('  ✅ ' + t + (d ? '  — ' + d : '')) } else { fail++; P('  ❌ ' + t + (d ? '  — ' + d : '')) } }

await c.connect()
P('■ 고위험 갈래 값 넣기 — 미리보기 + dryrun')
P('   서버 시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)

/* ── 미리보기 (읽기만) ─────────────────────────────────────── */
P('\n■ ① 미리보기 — 넣을 값')
P('   코드          약품명                     갈래              색        지금 값')
const codes = PLAN.map(p => p.code)
const now = new Map((await q(`select drug_code, drug_name, is_high_alert, high_alert_class,
    caution_dose, caution_shape, caution_sound
  from public.drugs where drug_code = any($1)`, [codes])).map(d => [d.drug_code, d]))
for (const p of PLAN) {
  const d = now.get(p.code)
  P('   ' + p.code.padEnd(13) + String(d?.drug_name ?? '(없음)').padEnd(26)
    + (KO[p.class] || p.class).padEnd(16) + colorOf(p.class).padEnd(10)
    + (d?.high_alert_class ?? '(비어 있음)'))
}

P('\n■ ② 고위험인데 갈래를 안 넣는 약이 있나')
const left = await q(`select drug_code, drug_name from public.drugs
  where is_high_alert and not (drug_code = any($1)) order by drug_name`, [codes])
gate('고위험 전부가 짝 목록에 있다', left.length === 0,
  left.length ? left.map(x => x.drug_code).join(' · ') : '고위험 4종 모두 들어 있다')

const before = {
  drugs: Number((await one(`select count(*) n from public.drugs`)).n),
  hi: Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
  cau: Number((await one(`select count(*) n from public.drugs where caution_dose or caution_shape or caution_sound`)).n),
  cls: Number((await one(`select count(*) n from public.drugs where high_alert_class is not null`)).n),
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  qty: String((await one(`select sum(current_qty) s from public.drugs`)).s),
  amt: String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s),
  snapN: Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
  snapC: String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
  snapO: String((await one(`select sum(coalesce(total_out_amount,0)) s from public.monthly_snapshots`)).s),
  tx: Number((await one(`select count(*) n from public.transactions`)).n),
}
P('\n■ 넣기 전 — 갈래 들어간 약 ' + before.cls + '종 · 고위험 ' + before.hi + ' · 주의 ' + before.cau)

/* ── dryrun ─────────────────────────────────────────────────── */
await c.query('begin')
try {
  let changed = 0
  for (const p of PLAN) {
    const r = await c.query(
      `update public.drugs set high_alert_class = $1
        where drug_code = $2 and high_alert_class is distinct from $1`, [p.class, p.code])
    changed += r.rowCount
  }
  P('\n■ 넣어 봄 — 바뀐 줄 ' + changed + '개')
  gate('③ 짝 목록만큼 바뀌었다', changed === PLAN.length, changed + ' / ' + PLAN.length)

  const got = await q(`select drug_code, high_alert_class from public.drugs
    where high_alert_class is not null order by drug_code`)
  gate('④ 값이 들어간 약이 4종뿐이다', got.length === PLAN.length,
    got.map(g => g.drug_code + '=' + g.high_alert_class).join(' · '))
  gate('⑤ 넣은 값이 짝 목록과 같다',
    PLAN.every(p => got.find(g => g.drug_code === p.code)?.high_alert_class === p.class))

  gate('⑥ ★ 다른 약은 하나도 안 바뀌었다',
    Number((await one(`select count(*) n from public.drugs
      where high_alert_class is not null and not (drug_code = any($1))`, [codes])).n) === 0)
  gate('⑦ ★ 고위험이 아닌 약에는 값이 없다',
    Number((await one(`select count(*) n from public.drugs
      where high_alert_class is not null and not is_high_alert`)).n) === 0)

  const after = {
    drugs: Number((await one(`select count(*) n from public.drugs`)).n),
    hi: Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
    cau: Number((await one(`select count(*) n from public.drugs where caution_dose or caution_shape or caution_sound`)).n),
    audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
    qty: String((await one(`select sum(current_qty) s from public.drugs`)).s),
    amt: String((await one(`select sum(current_qty * coalesce(purchase_price,0)) s from public.drugs`)).s),
    snapN: Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
    snapC: String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
    snapO: String((await one(`select sum(coalesce(total_out_amount,0)) s from public.monthly_snapshots`)).s),
    tx: Number((await one(`select count(*) n from public.transactions`)).n),
  }
  P('')
  gate('⑧ 약품·거래 줄 수 불변', after.drugs === before.drugs && after.tx === before.tx,
    '약품 ' + after.drugs + ' · 거래 ' + after.tx)
  gate('⑨ 고위험·주의 표시 불변', after.hi === before.hi && after.cau === before.cau,
    '고위험 ' + after.hi + ' · 주의 ' + after.cau)
  gate('⑩ ★ 수량 합·재고금액 불변', after.qty === before.qty && after.amt === before.amt,
    '수량 ' + after.qty + ' · 재고금액 ' + after.amt)
  gate('⑪ ★ 월 스냅샷(마감값) 불변',
    after.snapN === before.snapN && after.snapC === before.snapC && after.snapO === before.snapO,
    after.snapN + '줄 · 기말 ' + after.snapC + ' · 출고 ' + after.snapO)
  gate('⑫ 감사표 불변 (이 칸은 기록 대상이 아니다)', after.audit === before.audit, after.audit + '줄')
} finally {
  await c.query('rollback')
  P('\n■ rollback 완료 — 아무것도 남기지 않았다.')
}

P('')
gate('⑬ 되돌아갔다 — 갈래 들어간 약 0종',
  Number((await one(`select count(*) n from public.drugs where high_alert_class is not null`)).n) === before.cls,
  before.cls + '종')

P('\n■ 결과: 통과 ' + pass + ' · 실패 ' + fail)
await c.end()
process.exit(fail ? 1 : 0)
