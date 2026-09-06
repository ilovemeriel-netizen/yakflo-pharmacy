// dryrun_0088.mjs — drug_barcodes GRANT 보정 dryrun.
// BEGIN → GRANT → authenticated 롤 검증 → 전량 ROLLBACK(운영 무잔류). 무커밋.
//
// ★ 핵심은 「GRANT 가 붙었는가」가 아니라 「authenticated 로 실제 조회가 되는가」다.
//   0087 의 verify 는 소유자(postgres)로만 확인해 11/11 을 통과시켰고, 브라우저에서는
//   42501 로 막혔다. 같은 사고를 막으려면 롤을 바꿔서 봐야 한다(결함 72).
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]

const ddl=readFileSync('supabase/migrations/0088_drug_barcodes_grant.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}

/* savepoint 로 감싸 실패가 트랜잭션을 abort 시키지 않게 한다 */
async function probe(sql){
  await q('savepoint sp')
  try { const r=await q(sql); await q('release savepoint sp'); return { ok:true, row:r.rows[0] } }
  catch(e){ await q('rollback to savepoint sp'); return { ok:false, code:e.code, msg:e.message } }
}
const grants=async()=>(await q(`select grantee, privilege_type from information_schema.role_table_grants
  where table_schema='public' and table_name='drug_barcodes' and grantee in ('authenticated','service_role','anon')
  order by grantee, privilege_type`)).rows

await c.connect()
try{
  /* ── 사전 — 결함 재현 ─────────────────────────────────────── */
  const pre=await one(`select
    (select count(*)::int from public.drug_barcodes) bc,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  const preG=await grants()
  console.log(`사전 — 바코드 ${pre.bc}행 · 거래 ${pre.txs} · 약품 ${pre.drugs}`)
  console.log(`      GRANT(authenticated/service_role/anon) ${preG.length}건 ${preG.length?'':'← 결함'}`)

  await q('begin')
  await q('set local role authenticated')
  const before=await probe(`select count(*)::int n from public.drug_barcodes`)
  await q('reset role')
  P('A 결함 재현', !before.ok && before.code==='42501',
    before.ok ? `★ 조회가 됨(${JSON.stringify(before.row)}) — 결함이 이미 없다?` : `${before.code} ${before.msg}`)

  /* ── GRANT 적용 ───────────────────────────────────────────── */
  await q(ddl)

  /* ── B. GRANT 상태 ────────────────────────────────────────── */
  const g=await grants()
  const want=['DELETE','INSERT','SELECT','UPDATE']
  const byRole=r=>g.filter(x=>x.grantee===r).map(x=>x.privilege_type).sort()
  const au=byRole('authenticated'), sr=byRole('service_role'), an=byRole('anon')
  P('B GRANT', JSON.stringify(au)===JSON.stringify(want) && JSON.stringify(sr)===JSON.stringify(want) && an.length===0,
    `authenticated [${au}] · service_role [${sr}] · anon [${an.length?an:'없음(의도대로)'}]`)

  /* ── C. ★ authenticated 롤 실제 조회 ──────────────────────── */
  await q('set local role authenticated')
  const sel=await probe(`select count(*)::int n from public.drug_barcodes`)
  const ins=await probe(`insert into public.drug_barcodes (tenant_id,code,code_type,source) values ('00000000-0000-0000-0000-000000000000','09999999999996','GS1','학습') returning id`)
  await q('reset role')
  P('C authenticated 조회', sel.ok, sel.ok ? `SELECT 성공 · ${JSON.stringify(sel.row)} (RLS 로 tenant 격리되어 0행이 정상)` : `★ ${sel.code} ${sel.msg}`)
  /* INSERT 는 RLS(tenant 불일치)로 막히는 것이 정상.
     ★ SQLSTATE 로는 갈리지 않는다 — GRANT 거부와 RLS 위반이 **둘 다 42501** 이다.
       (마감월 차단과 재고 부족이 23514 를 공유하는 것과 같은 구조.)
       메시지로 판별한다:
         GRANT 거부 → 'permission denied for table …'
         RLS  위반 → 'new row violates row-level security policy …' */
  const rlsBlocked = !ins.ok && /row-level security/i.test(ins.msg || '')
  const grantBlocked = !ins.ok && /permission denied/i.test(ins.msg || '')
  P('C-2 RLS 유지', rlsBlocked,
    ins.ok ? '★ 남의 tenant 로 INSERT 가 됨 — RLS 확인 필요'
      : grantBlocked ? `★ GRANT 가 아직 막고 있다 — ${ins.msg}` : `RLS 가 막음 — ${ins.msg}`)

  /* ── D. 다른 테이블 무영향 ────────────────────────────────── */
  await q('set local role authenticated')
  const other=[]
  for(const t of ['inventory_counts','inventory_count_items','drugs','drug_master']){
    const r=await probe(`select count(*)::int n from public.${t}`); other.push(`${t}:${r.ok?'OK':'★'+r.code}`)
  }
  await q('reset role')
  P('D 타 테이블 무영향', other.every(x=>x.includes('OK')), other.join(' · '))

  /* ── E. 기존 무변동 ───────────────────────────────────────── */
  const post=await one(`select
    (select count(*)::int from public.drug_barcodes) bc,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('E 기존 무변동', post.bc===pre.bc&&post.txs===pre.txs&&post.drugs===pre.drugs&&post.snap7===pre.snap7&&post.snap8===pre.snap8,
    `바코드 ${post.bc} · 거래 ${post.txs} · 약품 ${post.drugs} · 1~7월 ${post.snap7} · 8월 ${post.snap8}`)

  await q('rollback')

  /* ── F. ROLLBACK 무잔류 ───────────────────────────────────── */
  const leftG=await grants()
  P('F ROLLBACK 무잔류', leftG.length===preG.length,
    `GRANT ${leftG.length}건 (사전 ${preG.length}건)`)

  console.log('\n' + '─'.repeat(72))
  let pass=0
  for(const [k,v] of Object.entries(R)){ console.log(`${v.ok?'  PASS':'★ FAIL'}  ${k.padEnd(18)} ${v.d}`); if(v.ok)pass++ }
  console.log('─'.repeat(72))
  console.log(`${pass}/${Object.keys(R).length} 통과 · 커밋 없음(ROLLBACK 완료)`)
  process.exitCode = pass===Object.keys(R).length ? 0 : 1
}catch(e){
  try{ await q('rollback') }catch{}
  console.error('★ 실패:', e.message)
  process.exitCode=1
}finally{ await c.end() }
