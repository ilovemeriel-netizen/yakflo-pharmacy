// dryrun_0091.mjs — 0091(백신 공개 조회 DB 준비) 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 91건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ BEGIN … ROLLBACK 안에서만 돌린다. 끝에서 반드시 rollback 한다.
// ★ 0091 SQL 은 파일 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ UPDATE 영향 행 수가 정확히 5 가 아니면 게이트 실패로 본다.
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
const q = (s, a) => c.query(s, a)
const one = async (s, a) => (await q(s, a)).rows[0]

const SQL = 'supabase/migrations/0091_vaccine_public_access.sql'
const ddl = readFileSync(SQL, 'utf8')
  .replace(/^\s*begin;\s*$/mi, '').replace(/^\s*commit;\s*$/mi, '')

/* ★ 실행 구문에 금지 대상이 섞이지 않았는지 보낸 뒤가 아니라 보내기 전에 검사한다.
   주석(-- …)을 걷어낸 본문만 본다 — 롤백 안내 주석의 drop 을 오탐하지 않기 위해서다. */
const body = ddl.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
const BANNED = [
  [/\bvaccine_events\b/i, 'vaccine_events 접촉'],
  [/\bv_vaccine_balance\b/i, 'v_vaccine_balance 접촉'],
  [/\bgrant\b/i, 'grant'],
  [/\brevoke\b/i, 'revoke'],
  [/\bcreate\s+policy\b/i, 'create policy'],
  [/\bdrop\s+policy\b/i, 'drop policy'],
  [/\bcreate\s+trigger\b/i, 'create trigger'],
  [/\bdrop\s+table\b/i, 'drop table'],
  [/\btruncate\b/i, 'truncate'],
  [/\bdelete\s+from\b/i, 'delete from'],
]
const hit = BANNED.filter(([re]) => re.test(body)).map(([, n]) => n)
if (hit.length) { console.error('★ 중단 — 실행 구문에 금지 대상: ' + hit.join(', ')); process.exit(1) }
console.log('사전 검사 통과 — 금지 구문 없음 (검사 대상 ' + body.split(';').filter(s => s.trim()).length + '문장)')

const EXPECT_LABEL = {
  'TT-FLU44': '독감(유료)',
  'TETRA6': '독감(국가무료)',
  'TETRA5': '독감(지자체)',
  'SPIKVX': '코로나(모더나)',
  'CMNTLP': '코로나(화이자)',
}
const EXPECT_BAL = { CMNTLP: 16, SPIKVX: 0, TETRA6: 30, 'TT-FLU44': 32, TETRA5: 20 }
const NEW_TBL = ['vaccine_public_settings', 'vaccine_public_attempts']

const checks = []
const gate = (name, ok, got) => { checks.push([name, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${name}  ${got}`) }

await c.connect()
let rolledBack = false
try {
  /* ── 변경 전 기준선 ── */
  const before = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') basetables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events,
    (select count(*)::int from public.vaccine_accounts) accounts`)
  console.log(`\n기준선 — BASE TABLE ${before.basetables} · 정책 ${before.policies} · vaccine_events ${before.events}행 · 계정 ${before.accounts}건`)

  const balBefore = {}
  for (const r of (await q(`select drug_code, balance_qty::int bq from public.v_vaccine_balance`)).rows) balBefore[r.drug_code] = r.bq

  console.log('\n===== BEGIN (dryrun) =====')
  await q('begin')

  /* 0091 본문을 한 번에 보낸다 — 파일 그대로 */
  await q(ddl)
  console.log('0091 본문 실행 완료 (트랜잭션 안)')

  /* ── 검증 ─────────────────────────────────────────────── */
  console.log('\n===== 검증 =====')

  /* 1) public_label 컬럼 */
  const col = await one(`select data_type, is_nullable from information_schema.columns
    where table_schema='public' and table_name='vaccine_accounts' and column_name='public_label'`)
  gate('public_label 컬럼 존재', !!col && col.data_type === 'text' && col.is_nullable === 'YES',
    col ? `${col.data_type} / nullable=${col.is_nullable}` : '없음')

  /* 2) CHECK 제약 */
  const chk = await one(`select pg_get_constraintdef(oid) d from pg_constraint
    where conrelid='public.vaccine_accounts'::regclass and conname='vaccine_accounts_public_label_chk'`)
  gate('public_label CHECK 제약', !!chk, chk ? chk.d : '없음')

  /* 3) UPDATE 영향 5행 — 표시명이 기대와 정확히 일치하는지 */
  const lbl = (await q(`select a.drug_code, a.public_label from public.vaccine_accounts a
    join public.tenants t on t.id=a.tenant_id
    where t.slug='cnc' and a.season='2026-2027' order by a.drug_code`)).rows
  const labelOk = lbl.length === 5 && lbl.every(r => EXPECT_LABEL[r.drug_code] === r.public_label)
  gate('cnc 2026-2027 표시명 5행 일치', labelOk, `${lbl.length}행`)
  console.log('      drug_code   public_label')
  lbl.forEach(r => console.log(`      ${String(r.drug_code).padEnd(11)} ${r.public_label}  ${EXPECT_LABEL[r.drug_code] === r.public_label ? '' : '★기대 ' + EXPECT_LABEL[r.drug_code]}`))

  /* 3b) 범위 밖 행이 물들지 않았는지 — public_label 이 채워진 전체 행 수 */
  const filled = await one(`select count(*)::int n from public.vaccine_accounts where public_label is not null`)
  gate('public_label 채워진 행이 정확히 5', filled.n === 5, `${filled.n}행`)

  /* 4) 신규 테이블 2개 — RLS on, 정책 0 */
  for (const t of NEW_TBL) {
    const r = await one(`select relrowsecurity rls from pg_class where oid=('public.'||$1)::regclass`, [t])
    const p = await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename=$1`, [t])
    gate(`${t} RLS on + 정책 0개`, r && r.rls === true && p.n === 0, `rls=${r ? r.rls : '?'} / 정책 ${p.n}개`)
  }

  /* 5) anon·authenticated 권한 0건 */
  const gr = await q(`select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema='public' and table_name = any($1) and grantee in ('anon','authenticated')`, [NEW_TBL])
  gate('anon·authenticated 권한 0건', gr.rows.length === 0, `${gr.rows.length}건`)
  gr.rows.forEach(r => console.log(`      ★ ${r.grantee} / ${r.table_name} / ${r.privilege_type}`))

  /* 6) v_vaccine_balance 불변 */
  const balAfter = {}
  for (const r of (await q(`select drug_code, balance_qty::int bq from public.v_vaccine_balance`)).rows) balAfter[r.drug_code] = r.bq
  const balSame = Object.keys(EXPECT_BAL).every(k => balAfter[k] === EXPECT_BAL[k] && balBefore[k] === balAfter[k])
  gate('v_vaccine_balance 5행 불변', balSame && Object.keys(balAfter).length === 5,
    Object.entries(balAfter).map(([k, v]) => `${k}:${v}`).join(' · '))

  /* 7) vaccine_events 무접촉 */
  const ev = await one(`select count(*)::int n from public.vaccine_events`)
  gate('vaccine_events 행 수 불변', ev.n === before.events, `${ev.n}행 (기준 ${before.events})`)

  /* 8) 기존 정책 수 불변 + BASE TABLE +2 */
  const after = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') basetables,
    (select count(*)::int from pg_policies where schemaname='public') policies`)
  gate('기존 RLS 정책 수 불변', after.policies === before.policies, `${after.policies} (기준 ${before.policies})`)
  gate('BASE TABLE +2', after.basetables === before.basetables + 2, `${after.basetables} (기준 ${before.basetables})`)

  /* ── 반드시 롤백 ── */
  await q('rollback'); rolledBack = true
  console.log('\n===== ROLLBACK 완료 — 아무것도 반영되지 않았습니다 =====')

  /* 롤백이 실제로 먹었는지 별도 확인 */
  const gone = await one(`select count(*)::int n from information_schema.columns
    where table_schema='public' and table_name='vaccine_accounts' and column_name='public_label'`)
  const gone2 = await one(`select count(*)::int n from information_schema.tables
    where table_schema='public' and table_name = any($1)`, [NEW_TBL])
  gate('롤백 후 public_label 사라짐', gone.n === 0, `${gone.n}개`)
  gate('롤백 후 신규 테이블 사라짐', gone2.n === 0, `${gone2.n}개`)

  const ng = checks.filter(x => !x[1])
  console.log(`\n===== 결과 ${checks.length - ng.length}/${checks.length} 통과 =====`)
  if (ng.length) { console.error('★ 실패: ' + ng.map(x => x[0]).join(', ')); process.exitCode = 1 }
  else console.log('dryrun 통과 — apply 는 별도 지시로만 진행합니다.')
} catch (e) {
  if (!rolledBack) { try { await q('rollback'); console.error('\n★ ROLLBACK 완료') } catch { console.error('\n★ ROLLBACK 시도 실패') } }
  console.error('★ dryrun 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
