/* dryrun_0115.mjs — 0115(주의 표시 3칸 + 기록 트리거) 시험 적용.
 *
 * ★ 전부 `begin … rollback` 안에서 돈다. 끝나면 **아무것도 남지 않는다.**
 * ★ 73종 반영은 여기서 하지 않는다. 몇 줄이 바뀔지 **세어 보기만** 한다.
 *
 * 쓰는 법:  node scripts/dryrun_0115.mjs
 *   .env 의 DATABASE_URL 을 쓴다(여러 줄이면 **뒤에 적힌 것**이 이긴다 — 앞줄은 DNS 가 안 풀린다).
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
function gate(title, ok, detail) {
  if (ok) { pass++; P('  ✅ ' + title + (detail ? '  — ' + detail : '')) }
  else { fail++; P('  ❌ ' + title + (detail ? '  — ' + detail : '')) }
}

const md5fn = async name => (await one(
  `select md5(pg_get_functiondef(p.oid)) m from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = $1`, [name]))?.m ?? '(없음)'

await c.connect()
P('■ 0115 dryrun — 주의 표시 3칸 + 기록 트리거')
P('   서버 시각 ' + (await one(`select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') t`)).t)
P('   접속 롤 session_user=' + (await one(`select session_user s`)).s)

/* ── 적용 전 상태 ─────────────────────────────────────────────── */
const before = {
  cols:   Number((await one(`select count(*) n from information_schema.columns
                              where table_schema='public' and table_name='drugs'`)).n),
  drugs:  Number((await one(`select count(*) n from public.drugs`)).n),
  audit:  Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  hi:     Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n),
  snapN:  Number((await one(`select count(*) n from public.monthly_snapshots`)).n),
  snapC:  String((await one(`select sum(closing_amount) s from public.monthly_snapshots`)).s),
  snapO:  String((await one(`select sum(coalesce(total_out_amount,0)) s from public.monthly_snapshots`)).s),
  fn: {
    log_drugs_usage:          await md5fn('log_drugs_usage'),
    enforce_usage_edit_owner: await md5fn('enforce_usage_edit_owner'),
    enforce_price_edit_role:  await md5fn('enforce_price_edit_role'),
    log_drugs_status:         await md5fn('log_drugs_status'),
    guard_drugs_qty_direct:   await md5fn('guard_drugs_qty_direct'),
  },
  trg: Number((await one(`select count(*) n from pg_trigger
                           where tgrelid='public.drugs'::regclass and not tgisinternal`)).n),
}
P('\n■ 적용 전 — 약품 ' + before.drugs + '종 · drugs 칸 ' + before.cols
  + ' · 감사표 ' + before.audit + '줄 · 트리거 ' + before.trg + '개 · 고위험 ' + before.hi + '종')

/* ── 시험 적용 (rollback 으로 되돌린다) ──────────────────────────── */
await c.query('begin')
try {
  const sqlRaw = readFileSync(resolve(ROOT, 'supabase/migrations/0115_drug_caution_flags.sql'), 'utf8')
  /* 파일 안의 begin;/commit; 은 떼어 낸다 — 이 스크립트가 거래를 쥐고 있어야 되돌릴 수 있다 */
  const sql = sqlRaw.replace(/^\s*(begin|commit)\s*;\s*$/gim, '')
  await c.query(sql)
  P('\n■ 0115 적용됨 (이 거래 안에서만)')

  /* ① 칸 3개가 생겼고 모양이 is_high_alert 와 같은가 */
  const cols = await q(`select column_name, data_type, is_nullable, column_default
                          from information_schema.columns
                         where table_schema='public' and table_name='drugs'
                           and column_name in ('caution_dose','caution_shape','caution_sound')
                         order by column_name`)
  gate('① 칸 3개가 생겼다', cols.length === 3, cols.map(r => r.column_name).join(', '))
  gate('② 셋 다 참/거짓·빈값 불가·기본 거짓 (고위험과 같은 모양)',
    cols.length === 3 && cols.every(r => r.data_type === 'boolean' && r.is_nullable === 'NO' && /false/i.test(r.column_default || '')),
    cols.map(r => r.column_name + '=' + r.data_type + '/' + r.is_nullable + '/' + r.column_default).join(' · '))

  /* ③ 기존 약품은 전부 꺼짐 — 값이 바뀐 약이 없어야 한다 */
  const on = await one(`select count(*) n from public.drugs
                         where caution_dose or caution_shape or caution_sound`)
  gate('③ 기존 약품은 전부 꺼짐 — 켜진 약 0종', Number(on.n) === 0, '켜진 약 ' + on.n + '종')
  const nDrugs = Number((await one(`select count(*) n from public.drugs`)).n)
  gate('④ 약품 줄 수 불변', nDrugs === before.drugs, before.drugs + ' → ' + nDrugs)

  /* ⑤ 기존 함수는 한 글자도 안 바뀌었다 */
  let same = true, detail = []
  for (const [k, v] of Object.entries(before.fn)) {
    const now = await md5fn(k)
    if (now !== v) { same = false; detail.push(k + ' 바뀜') }
  }
  gate('⑤ 기존 기록·가드 함수 5종 md5 불변', same, same ? 'log_drugs_usage · enforce_usage_edit_owner · enforce_price_edit_role · log_drugs_status · guard_drugs_qty_direct' : detail.join(', '))

  /* ⑥ 트리거는 하나만 늘었고 기존 배선은 그대로 */
  const trgs = await q(`select tgname, pg_get_triggerdef(oid) d from pg_trigger
                         where tgrelid='public.drugs'::regclass and not tgisinternal order by tgname`)
  gate('⑥ 트리거가 하나만 늘었다', trgs.length === before.trg + 1, before.trg + ' → ' + trgs.length)
  const newTrg = trgs.find(r => r.tgname === 'trg_log_drugs_caution')
  gate('⑦ 새 트리거는 주의 3칸이 바뀔 때만 깨어난다',
    !!newTrg && /AFTER UPDATE OF caution_dose, caution_shape, caution_sound/i.test(newTrg.d),
    newTrg ? newTrg.d.replace(/\s+/g, ' ').slice(0, 110) : '없음')

  /* ⑧ 감사표 기존 줄 불변 */
  const a0 = Number((await one(`select count(*) n from public.drug_usage_audit`)).n)
  gate('⑧ 기존 감사 줄 불변 (소급 기록 없음)', a0 === before.audit, before.audit + ' → ' + a0)

  /* ── 실제로 켜 보고 기록이 남는지 ──────────────────────────── */
  const target = await one(`select drug_code, drug_name, tenant_id from public.drugs
                             where drug_code = 'SGBRONNC10'`)
  P('\n  ▸ 시험 대상: ' + target.drug_code + ' ' + target.drug_name + ' (운영 실제 약품)')

  /* ⑨ 한 약에 주의 세 개가 동시에 켜지는가 */
  await c.query(`update public.drugs set caution_dose=true, caution_shape=true, caution_sound=true
                  where drug_code='SGBRONNC10'`)
  const three = await one(`select caution_dose d, caution_shape s, caution_sound n from public.drugs
                            where drug_code='SGBRONNC10'`)
  gate('⑨ 한 약에 주의 세 개가 동시에 켜진다', three.d && three.s && three.n,
    '용량=' + three.d + ' 모양=' + three.s + ' 발음=' + three.n)

  /* ⑩ 켠 기록이 세 줄 남는가 — 누가·언제 포함 */
  const newRows = await q(`select field, old_value, new_value, changed_by,
                                  to_char(changed_at at time zone 'Asia/Seoul','HH24:MI:SS') t
                             from public.drug_usage_audit
                            where drug_code='SGBRONNC10' and field like 'caution_%'
                            order by field`)
  gate('⑩ 켠 기록이 세 줄 남는다', newRows.length === 3,
    newRows.map(r => r.field + ' ' + r.old_value + '→' + r.new_value).join(' · '))
  gate('⑪ 언제 바뀌었는지가 남는다', newRows.every(r => !!r.t), newRows[0]?.t)
  P('     · 누가(changed_by) = ' + (newRows[0]?.changed_by ?? 'null')
    + '  ← 직접 접속(postgres)이라 auth.uid() 가 없다. 웹에서 누르면 그 사람 id 가 들어간다.')

  /* ⑫ 주의만 바꿨는데 사용량 기록이 생기지는 않는가 */
  const usageRows = await one(`select count(*) n from public.drug_usage_audit
                                where drug_code='SGBRONNC10' and field not like 'caution_%'
                                  and changed_at > now() - interval '1 minute'`)
  gate('⑫ 사용량 기록과 섞이지 않는다 (사용량 줄 0개)', Number(usageRows.n) === 0, '사용량 줄 ' + usageRows.n + '개')

  /* ⑬ 끄면 또 한 줄 남는가 */
  await c.query(`update public.drugs set caution_shape=false where drug_code='SGBRONNC10'`)
  const off = await one(`select old_value, new_value from public.drug_usage_audit
                          where drug_code='SGBRONNC10' and field='caution_shape'
                          order by changed_at desc limit 1`)
  gate('⑬ 끈 것도 기록된다', off?.old_value === 'true' && off?.new_value === 'false',
    (off?.old_value ?? '-') + ' → ' + (off?.new_value ?? '-'))

  /* ⑭ 주의 칸만 바꿀 때 기존 가드가 막지 않는가 */
  gate('⑭ 기존 가드(단가·사용량·수량)가 주의 저장을 막지 않는다', true, '위 ⑨·⑬ 이 오류 없이 통과했다')

  /* ⑮ 새 칸에 쓰기 권한이 따라붙는가 (열 단위 권한이면 안 붙는다) */
  const pr = await one(`select has_column_privilege('authenticated','public.drugs','caution_dose','UPDATE') u,
                               has_column_privilege('authenticated','public.drugs','caution_dose','SELECT') s`)
  gate('⑮ authenticated 가 새 칸을 읽고 쓸 수 있다 (열 단위 권한 문제 없음)', pr.u && pr.s,
    'UPDATE=' + pr.u + ' SELECT=' + pr.s)

  /* ⑯ 금액·마감값 불변 */
  const sn = await one(`select count(*) n, sum(closing_amount)::text c,
                               sum(coalesce(total_out_amount,0))::text o
                          from public.monthly_snapshots`)
  gate('⑯ 월 스냅샷 줄 수·기말합·출고합 불변',
    Number(sn.n) === before.snapN && sn.c === before.snapC && sn.o === before.snapO,
    sn.n + '줄 · 기말 ' + sn.c + ' · 출고 ' + sn.o)
  const hi = Number((await one(`select count(*) n from public.drugs where is_high_alert`)).n)
  gate('⑰ 고위험 지정 불변', hi === before.hi, before.hi + ' → ' + hi)

  /* ⑱ 73종을 반영하면 몇 줄이 바뀌는지 — 세어 보기만 한다(반영하지 않는다) */
  P('\n■ 73종 반영 미리보기 (여기서 반영하지 않는다 — 세어 보기만)')
  const found = JSON.parse(readFileSync(resolve(ROOT, 'scripts/_caution_rows.json'), 'utf8'))
  const codes = found.map(f => f.code)
  const have = new Set((await q(`select drug_code from public.drugs where drug_code = any($1)`, [codes])).map(r => r.drug_code))
  const hit = found.filter(f => have.has(f.code))
  const missRows = found.filter(f => !have.has(f.code))
  const byKind = {}
  for (const f of hit) byKind[f.kind] = (byKind[f.kind] || 0) + 1
  P('   엑셀 73종 중 코드가 그대로 맞는 약 : ' + hit.length + '종  (' +
    Object.entries(byKind).map(([k, v]) => k + ' ' + v).join(' · ') + ')')
  P('   코드가 안 맞아 보류 : ' + missRows.length + '종 → ' +
    missRows.map(f => f.code + ' 「' + f.name + '」').join(' · '))
  P('   → 반영하면 ' + hit.length + '줄이 바뀌고, 감사표에 ' + hit.length + '줄이 남는다.')

} finally {
  await c.query('rollback')
  P('\n■ rollback 완료 — 아무것도 남기지 않았다.')
}

/* ── 되돌아갔는지 확인 ───────────────────────────────────────── */
const after = {
  cols:  Number((await one(`select count(*) n from information_schema.columns
                             where table_schema='public' and table_name='drugs'`)).n),
  audit: Number((await one(`select count(*) n from public.drug_usage_audit`)).n),
  trg:   Number((await one(`select count(*) n from pg_trigger
                             where tgrelid='public.drugs'::regclass and not tgisinternal`)).n),
}
P('')
gate('⑲ 되돌아갔다 — drugs 칸 수', after.cols === before.cols, before.cols + ' → ' + after.cols)
gate('⑳ 되돌아갔다 — 감사표 줄 수', after.audit === before.audit, before.audit + ' → ' + after.audit)
gate('㉑ 되돌아갔다 — 트리거 수', after.trg === before.trg, before.trg + ' → ' + after.trg)
gate('㉒ 되돌아갔다 — 새 함수 없음', (await md5fn('log_drugs_caution')) === '(없음)', 'log_drugs_caution')

P('\n■ 결과: 통과 ' + pass + ' · 실패 ' + fail)
await c.end()
process.exit(fail ? 1 : 0)
