/* dryrun_0117.mjs — 0117(보관방법 변경 감사 기록) 시험 적용.
 * ★ 전부 `begin … rollback` 안에서 돈다. 끝나면 아무것도 남지 않는다.
 * ★ 운영 값은 **읽기만** 한다. 넣어 보는 것도 전부 되돌린다.
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

await c.connect()
P('■ 0117 dryrun — 보관방법(storage_method) 변경 감사 기록')
P('   서버 시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)
P('')

/* ── 적용 전 상태 ──────────────────────────────────────────────────── */
const md5Of = async () => {
  const rows = await q(`select proname, md5(pg_get_functiondef(oid)) m from pg_proc
     where proname = any($1) order by proname`, [WATCH])
  return Object.fromEntries(rows.map(r => [r.proname, r.m]))
}
const before = {
  fns: await md5Of(),
  trgs: Number((await one(`select count(*) n from pg_trigger
     where tgrelid='public.drugs'::regclass and not tgisinternal`)).n),
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  drugs: Number((await one(`select count(*) n from public.drugs`)).n),
  stock: (await one(`select round(sum(current_qty * purchase_price)::numeric, 3) v from public.drugs`)).v,
  snap: (await one(`select round(sum(closing_amount)::numeric, 3) v from public.monthly_snapshots`)).v,
  light: Number((await one(`select count(*) n from public.drugs where storage_light`)).n),
  shade: Number((await one(`select count(*) n from public.drugs where storage_method like '%차광%'`)).n),
  hasFn: Number((await one(`select count(*) n from pg_proc where proname='log_drugs_storage_method'`)).n),
}
P('■ 적용 전')
P('   drugs ' + before.drugs + '줄 · 감사표 ' + before.audit + '줄 · drugs 트리거 ' + before.trgs + '개')
P('   storage_light 참 ' + before.light + '종 · storage_method 에 차광 ' + before.shade + '종')
P('   현재고 총액 ' + before.stock + ' · 마감 기말 합 ' + before.snap)
P('   log_drugs_storage_method 함수 ' + (before.hasFn ? '있음' : '없음'))
P('')

await c.query('begin')
try {
  /* ── 적용 ────────────────────────────────────────────────────────── */
  const sql = readFileSync(resolve(ROOT, 'supabase/migrations/0117_drug_storage_method_audit.sql'), 'utf8')
  /* 파일 안의 begin/commit 은 바깥 트랜잭션과 겹치므로 뺀다(내용은 그대로) */
  const body = sql.replace(/^\s*begin;\s*$/m, '').replace(/^\s*commit;\s*$/m, '')
  await c.query(body)
  P('■ A. 적용')
  gate('함수 log_drugs_storage_method 가 생겼다',
    Number((await one(`select count(*) n from pg_proc where proname='log_drugs_storage_method'`)).n) === 1)
  const tg = await one(`select pg_get_triggerdef(oid) d from pg_trigger
     where tgrelid='public.drugs'::regclass and tgname='trg_log_drugs_storage_method'`)
  gate('트리거 trg_log_drugs_storage_method 가 생겼다', !!tg)
  gate('UPDATE OF storage_method 로만 깨어난다',
    !!tg && /AFTER UPDATE OF storage_method/i.test(tg.d), tg ? tg.d.replace(/^.*?(AFTER)/i, '$1').slice(0, 90) : '')
  gate('drugs 트리거가 ' + before.trgs + ' → ' + (before.trgs + 1) + ' 개',
    Number((await one(`select count(*) n from pg_trigger
       where tgrelid='public.drugs'::regclass and not tgisinternal`)).n) === before.trgs + 1)
  const fn = await one(`select prosecdef, proconfig from pg_proc where proname='log_drugs_storage_method'`)
  gate('SECURITY DEFINER 이고 search_path 가 public 로 고정됐다',
    fn.prosecdef === true && String(fn.proconfig).includes('search_path=public'))
  P('')

  /* ── B. 기존 함수 불변 ───────────────────────────────────────────── */
  P('■ B. 기존 함수·트리거 무변경')
  const afterFns = await md5Of()
  let same = 0
  for (const k of WATCH) {
    if (before.fns[k] === afterFns[k]) same++
    else gate(k + ' 가 바뀌었다', false, before.fns[k] + ' → ' + afterFns[k])
  }
  gate('기존 기록·검사 함수 ' + WATCH.length + '개 md5 가 한 글자도 안 바뀌었다', same === WATCH.length)
  gate('trg_log_drugs_location(0104) 배선 그대로',
    !!(await one(`select 1 x from pg_trigger where tgrelid='public.drugs'::regclass
       and tgname='trg_log_drugs_location'`)))
  gate('trg_log_drugs_caution(0115) 배선 그대로',
    !!(await one(`select 1 x from pg_trigger where tgrelid='public.drugs'::regclass
       and tgname='trg_log_drugs_caution'`)))
  P('')

  /* ── C. 실제로 기록이 남나 ───────────────────────────────────────── */
  /* ★ 차광 판정은 **아무것도 바꾸기 전에** 센다.
     아래 C 에서 한 약의 보관방법을 바꾸므로, 뒤에서 세면 그 약이 빠져 숫자가 틀린다. */
  P('■ C. 차광 판정이 바뀌는 것이 맞는지 (읽기만 · 손대기 전)')
  const cmp = await one(`select
      count(*) filter (where storage_light) a,
      count(*) filter (where storage_method like '%차광%') b,
      count(*) filter (where storage_method like '%차광%' and not storage_light) c,
      count(*) filter (where storage_light and storage_method not like '%차광%') d
    from public.drugs where atc_slot is not null or fsp_slot is not null`)
  gate('ATC 차광 8종 → 11종', Number(cmp.a) === 8 && Number(cmp.b) === 11,
    '늘어남 ' + cmp.c + '종 · 떨어짐 ' + cmp.d + '종')
  gate('떨어지는 약이 0건이다', Number(cmp.d) === 0)
  for (const r of await q(`select coalesce(atc_slot, fsp_slot) s, drug_code, drug_name, storage_method
     from public.drugs where (atc_slot is not null or fsp_slot is not null)
       and storage_method like '%차광%' and not storage_light order by drug_name`))
    P('     새로 붙는 약 — 슬롯 ' + String(r.s).padEnd(5) + r.drug_code.padEnd(11) + r.drug_name + '  「' + r.storage_method + '」')
  P('')

  P('■ D. 보관방법을 바꿔 본다 (되돌림)')
  const tgt = await one(`select drug_code, drug_name, storage_method, storage_light
     from public.drugs where atc_slot = '21'`)
  P('   대상 — ' + tgt.drug_code + ' ' + tgt.drug_name + ' (지금 「' + tgt.storage_method + '」)')
  const n0 = Number((await one(`select count(*) n from public.drug_usage_audit`)).n)
  await c.query(`update public.drugs set storage_method = '실온' where drug_code = $1`, [tgt.drug_code])
  const rows1 = await q(`select field, old_value, new_value, old_source, new_source, changed_by,
       to_char(changed_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t
     from public.drug_usage_audit where drug_code = $1 and field = 'storage_method'`, [tgt.drug_code])
  gate('기록이 1줄 생겼다', rows1.length === 1)
  gate('옛값·새값이 맞다',
    rows1.length === 1 && rows1[0].old_value === tgt.storage_method && rows1[0].new_value === '실온',
    rows1.length ? '「' + rows1[0].old_value + '」 → 「' + rows1[0].new_value + '」' : '')
  gate('field 가 storage_method 다', rows1.length === 1 && rows1[0].field === 'storage_method')
  gate('old_source/new_source 는 비어 있다',
    rows1.length === 1 && rows1[0].old_source === null && rows1[0].new_source === null)
  gate('changed_at 이 찍혔다', rows1.length === 1 && !!rows1[0].t, rows1.length ? rows1[0].t : '')
  P('   ※ changed_by 는 ' + (rows1.length && rows1[0].changed_by ? rows1[0].changed_by : '(빈값)')
    + ' — psql 직접접속에는 로그인 사용자가 없어 비는 것이 정상이다.')
  P('      운영 화면(브라우저)에서는 auth.uid() 가 들어간다(0115 에서 실증됨).')
  P('')

  P('■ E. 엉뚱한 기록이 생기지 않는다')
  await c.query(`update public.drugs set storage_method = '실온' where drug_code = $1`, [tgt.drug_code])
  gate('같은 값으로 다시 저장하면 기록이 늘지 않는다',
    Number((await one(`select count(*) n from public.drug_usage_audit
       where drug_code = $1 and field = 'storage_method'`, [tgt.drug_code])).n) === 1)
  await c.query(`update public.drugs set memo = coalesce(memo,'') where drug_code = $1`, [tgt.drug_code])
  gate('보관방법을 안 건드린 저장에는 기록이 안 생긴다',
    Number((await one(`select count(*) n from public.drug_usage_audit
       where drug_code = $1 and field = 'storage_method'`, [tgt.drug_code])).n) === 1)
  const nAll = Number((await one(`select count(*) n from public.drug_usage_audit`)).n)
  gate('감사표가 ' + n0 + ' → ' + nAll + ' 줄 (늘어난 것은 1줄뿐)', nAll === n0 + 1)
  P('')

  P('■ F. 운영 값 무변경 (이 파일은 drugs 를 바꾸지 않는다)')
  gate('drugs 줄 수 그대로',
    Number((await one(`select count(*) n from public.drugs`)).n) === before.drugs)
  gate('storage_light 참 ' + before.light + '종 그대로 (지우지도 고치지도 않았다)',
    Number((await one(`select count(*) n from public.drugs where storage_light`)).n) === before.light)
  gate('storage_method 에 차광 ' + before.shade + '종 그대로 (바꾼 1종은 아래에서 되돌림)',
    Number((await one(`select count(*) n from public.drugs where storage_method like '%차광%'`)).n)
      === before.shade - (String(tgt.storage_method).includes('차광') ? 1 : 0))
  gate('마감 기말 합 그대로',
    String((await one(`select round(sum(closing_amount)::numeric,3) v from public.monthly_snapshots`)).v) === String(before.snap))
  P('')
} finally {
  await c.query('rollback')
}

/* ── 되돌아갔는지 ────────────────────────────────────────────────────── */
P('■ G. 되돌림 확인 (rollback 뒤 실제 운영 상태)')
gate('함수가 없다 (적용 전과 같다)',
  Number((await one(`select count(*) n from pg_proc where proname='log_drugs_storage_method'`)).n) === before.hasFn)
gate('drugs 트리거 ' + before.trgs + '개 그대로',
  Number((await one(`select count(*) n from pg_trigger
     where tgrelid='public.drugs'::regclass and not tgisinternal`)).n) === before.trgs)
gate('감사표 ' + before.audit + '줄 그대로',
  Number((await one(`select count(*) n from public.drug_usage_audit`)).n) === before.audit)
gate('storage_light 참 ' + before.light + '종 그대로',
  Number((await one(`select count(*) n from public.drugs where storage_light`)).n) === before.light)
gate('storage_method 차광 ' + before.shade + '종 그대로',
  Number((await one(`select count(*) n from public.drugs where storage_method like '%차광%'`)).n) === before.shade)
gate('현재고 총액 ' + before.stock + ' 그대로',
  String((await one(`select round(sum(current_qty * purchase_price)::numeric,3) v from public.drugs`)).v) === String(before.stock))
gate('마감 기말 합 ' + before.snap + ' 그대로',
  String((await one(`select round(sum(closing_amount)::numeric,3) v from public.monthly_snapshots`)).v) === String(before.snap))
const nowFns = await md5Of()
gate('기존 함수 md5 8개 그대로', WATCH.every(k => before.fns[k] === nowFns[k]))
P('')
P('■ 결과 — 통과 ' + pass + ' · 실패 ' + fail)
await c.end()
process.exit(fail ? 1 : 0)
