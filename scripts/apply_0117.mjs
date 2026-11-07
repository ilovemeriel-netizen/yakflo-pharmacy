/* apply_0117.mjs — 0117(보관방법 변경 감사 기록) 운영 적용.
 * 2026-11-07 이정화 님 승인(A). dryrun 30개 통과 뒤.
 * ★ drugs 의 값은 건드리지 않는다. 함수 1개 + 트리거 1개만 더한다.
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

const WATCH = ['log_drugs_caution', 'log_drugs_location', 'log_drugs_status', 'log_drugs_qty',
  'log_drugs_usage', 'log_drug_price_change', 'enforce_usage_edit_owner', 'enforce_price_edit_role']
/* dryrun 때 잰 값 — 적용 뒤에도 같아야 한다 */
const EXPECT = {
  log_drugs_caution: 'f2152376c6cd54143d215d58eefda399',
  log_drugs_location: '2cc872db9907619a418b0ac8584b98cd',
  log_drugs_status: 'c9c6e2285179efd17778b4a31b9f6e73',
  log_drugs_qty: '92f920c8df1a03b0f7ff75f387dea8f7',
  log_drugs_usage: '2d94cdb8c213eacdb1197bddbb1c9f7f',
  log_drug_price_change: 'fedade152c8aa2f9a189554345f011f0',
  enforce_usage_edit_owner: 'f324cb9ea7af6ee08decf0df25c8b48c',
  enforce_price_edit_role: '84711337516e2c3f193b01aa1f7836b6',
}

await c.connect()
P('■ 0117 운영 적용')
P('   서버 시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)
const before = {
  trgs: Number((await one(`select count(*) n from pg_trigger where tgrelid='public.drugs'::regclass and not tgisinternal`)).n),
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  drugs: Number((await one(`select count(*) n from public.drugs`)).n),
  stock: (await one(`select round(sum(current_qty * purchase_price)::numeric,3) v from public.drugs`)).v,
  snap: (await one(`select count(*) n, round(sum(closing_amount)::numeric,3) v from public.monthly_snapshots`)),
  light: Number((await one(`select count(*) n from public.drugs where storage_light`)).n),
  shade: Number((await one(`select count(*) n from public.drugs where storage_method like '%차광%'`)).n),
}
P('   적용 전 — 트리거 ' + before.trgs + '개 · 감사표 ' + before.audit + '줄 · drugs ' + before.drugs + '줄')
P('')

const sql = readFileSync(resolve(ROOT, 'supabase/migrations/0117_drug_storage_method_audit.sql'), 'utf8')
await c.query(sql)
P('■ 적용했다')
P('')

P('■ 1. 함수·트리거')
const fn = await one(`select md5(pg_get_functiondef(oid)) m, prosecdef, proconfig
   from pg_proc where proname='log_drugs_storage_method'`)
gate('함수 log_drugs_storage_method 가 있다', !!fn, fn ? 'md5 ' + fn.m : '')
gate('SECURITY DEFINER · search_path=public',
  !!fn && fn.prosecdef === true && String(fn.proconfig).includes('search_path=public'))
const tg = await one(`select pg_get_triggerdef(oid) d from pg_trigger
   where tgrelid='public.drugs'::regclass and tgname='trg_log_drugs_storage_method'`)
gate('트리거가 있다 · UPDATE OF storage_method 로만',
  !!tg && /AFTER UPDATE OF storage_method/i.test(tg.d))
gate('drugs 트리거가 ' + before.trgs + ' → ' + (before.trgs + 1) + '개',
  Number((await one(`select count(*) n from pg_trigger where tgrelid='public.drugs'::regclass and not tgisinternal`)).n) === before.trgs + 1)
P('')

P('■ 2. 기존 함수 md5 — 한 글자도 안 바뀌었는지')
for (const r of await q(`select proname, md5(pg_get_functiondef(oid)) m from pg_proc
   where proname = any($1) order by proname`, [WATCH]))
  gate(r.proname, r.m === EXPECT[r.proname], r.m)
P('')

P('■ 3. 운영 값 무변경')
gate('drugs ' + before.drugs + '줄 그대로',
  Number((await one(`select count(*) n from public.drugs`)).n) === before.drugs)
gate('감사표 ' + before.audit + '줄 그대로 (소급 기록 없음)',
  Number((await one(`select count(*) n from public.drug_usage_audit`)).n) === before.audit)
gate('storage_light 참 ' + before.light + '종 그대로 (지우지 않음)',
  Number((await one(`select count(*) n from public.drugs where storage_light`)).n) === before.light)
gate('storage_method 차광 ' + before.shade + '종 그대로',
  Number((await one(`select count(*) n from public.drugs where storage_method like '%차광%'`)).n) === before.shade)
gate('현재고 총액 ' + before.stock + ' 그대로',
  String((await one(`select round(sum(current_qty * purchase_price)::numeric,3) v from public.drugs`)).v) === String(before.stock))
const sn = await one(`select count(*) n, round(sum(closing_amount)::numeric,3) v from public.monthly_snapshots`)
gate('마감 스냅샷 ' + before.snap.n + '줄 · 기말 합 ' + before.snap.v + ' 그대로',
  String(sn.n) === String(before.snap.n) && String(sn.v) === String(before.snap.v))
P('')
P('■ 결과 — 통과 ' + pass + ' · 실패 ' + fail)
await c.end()
process.exit(fail ? 1 : 0)
