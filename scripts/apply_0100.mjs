// apply_0100.mjs — 사번 1회 제한을 applied 건에만 건다.
//
// ★ CONCURRENTLY 는 트랜잭션 안에서 돌지 않는다 → **문장을 하나씩, 트랜잭션 없이** 보낸다.
// ★ 순서가 안전의 전부다: **새 인덱스를 먼저 만들고**, 유효한지 확인한 **뒤에**
//   옛 인덱스를 지운다. 이 순서면 전환 중 제약은 「옛 것 ∧ 새 것」이라
//   느슨해지는 순간이 없다 — 접수가 열려 있어도 안전하다.
// ★ CONCURRENTLY 는 실패해도 **쓸 수 없는 인덱스를 남긴다**(indisvalid=false).
//   그래서 만들고 나서 유효성을 반드시 확인한다.
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

const NEW = 'vaccine_survey_responses_emp_applied_uniq'
const OLD = 'vaccine_survey_responses_emp_uniq'
const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(48)} ${got}`) }
const idxState = async name => await one(
  `select i.indisvalid, pg_get_indexdef(i.indexrelid) def
     from pg_index i join pg_class k on k.oid = i.indexrelid
     join pg_namespace n on n.oid = k.relnamespace
    where n.nspname='public' and k.relname=$1`, [name])

await c.connect()
try {
  const before = await one(`select
    (select count(*)::int from public.vaccine_survey_responses) resp,
    (select count(*)::int from pg_policies where schemaname='public') pol`)
  console.log(`기준선 — 응답 ${before.resp}행 · 정책 ${before.pol}`)

  /* ── 1) 새 인덱스 ────────────────────────────────────────────────────── */
  console.log('\n① 새 인덱스를 만든다(CONCURRENTLY — 쓰기를 막지 않는다)')
  await q(`create unique index concurrently if not exists ${NEW}
    on public.vaccine_survey_responses (survey_id, emp_no)
    where emp_no is not null and status = 'applied'`)
  const neu = await idxState(NEW)
  gate('새 인덱스가 있다', !!neu, neu ? '있음' : '없음')
  gate('★ 새 인덱스가 유효하다(쓸 수 있다)', !!neu && neu.indisvalid === true, String(neu && neu.indisvalid))
  gate('조건에 applied 가 들어 있다', !!neu && /status = 'applied'/.test(neu.def), (neu ? neu.def : '').slice(-52))
  if (checks.some(x => !x[1])) {
    console.log('\n★ 새 인덱스가 성한 상태가 아니다 — 옛 인덱스를 지우지 않는다.')
    console.log('   되돌리려면: drop index concurrently if exists public.' + NEW)
    process.exitCode = 1
  } else {
    /* ── 2) 옛 인덱스 ──────────────────────────────────────────────────── */
    console.log('\n② 새 인덱스가 자리 잡았다 — 이제 옛 인덱스를 지운다')
    await q(`drop index concurrently if exists public.${OLD}`)
    const old = await idxState(OLD)
    gate('옛 인덱스가 사라졌다', !old, old ? '아직 있음' : '없음')
    const after = await one(`select
      (select count(*)::int from public.vaccine_survey_responses) resp,
      (select count(*)::int from pg_policies where schemaname='public') pol,
      (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid
        where k.relname='vaccine_survey_audit' and t.tgname='trg_vaccine_survey_audit_append_only') ap`)
    gate('응답 행 수 그대로', after.resp === before.resp, before.resp + ' → ' + after.resp)
    gate('정책 수 그대로', after.pol === before.pol, before.pol + ' → ' + after.pol)
    gate('append-only 가드 그대로', Number(after.ap) === 1, after.ap + '개')
    const ng = checks.filter(x => !x[1])
    console.log(`\n결과 ${checks.length - ng.length}/${checks.length} 통과`)
    process.exitCode = ng.length ? 1 : 0
  }
} catch (e) {
  console.error('FATAL ' + String(e.message).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[REDACTED]'))
  console.error('★ 중간에 멈췄다 — 아래로 상태를 확인할 것:')
  console.error("   select relname, indisvalid from pg_index i join pg_class k on k.oid=i.indexrelid where relname like 'vaccine_survey_responses_emp%'")
  process.exitCode = 1
} finally { await c.end() }
