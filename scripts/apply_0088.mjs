// apply_0088.mjs — drug_barcodes GRANT 보정 적용. **COMMIT 한다.**
// ★ 반드시 dryrun_0088.mjs 가 7/7 통과한 뒤에 실행한다.
// ★ GRANT 는 멱등이라 재실행에 안전하다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0088_drug_barcodes_grant.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')

async function probe(sql){
  await q('savepoint sp')
  try { const r=await q(sql); await q('release savepoint sp'); return { ok:true, row:r.rows[0] } }
  catch(e){ await q('rollback to savepoint sp'); return { ok:false, code:e.code, msg:e.message } }
}

await c.connect()
try{
  const pre=await one(`select
    (select count(*)::int from public.drug_barcodes) bc,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  console.log(`사전 — 바코드 ${pre.bc}행 · 거래 ${pre.txs} · 약품 ${pre.drugs}`)

  await q('begin')
  await q(ddl)

  /* ── 커밋 직전 검증 — ★ authenticated 롤로 실제 조회한다 ── */
  const g=(await q(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='drug_barcodes' and grantee in ('authenticated','service_role','anon')`)).rows
  const byRole=r=>g.filter(x=>x.grantee===r).map(x=>x.privilege_type).sort()
  const want=['DELETE','INSERT','SELECT','UPDATE']

  await q('set local role authenticated')
  const sel=await probe(`select count(*)::int n from public.drug_barcodes`)
  await q('reset role')

  const post=await one(`select
    (select count(*)::int from public.drug_barcodes) bc,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)

  const gate=[
    ['authenticated GRANT', JSON.stringify(byRole('authenticated'))===JSON.stringify(want), `[${byRole('authenticated')}]`],
    ['service_role GRANT',  JSON.stringify(byRole('service_role'))===JSON.stringify(want),  `[${byRole('service_role')}]`],
    ['anon 미부여',          byRole('anon').length===0,                                     `[${byRole('anon').length?byRole('anon'):'없음'}]`],
    ['★ authenticated 조회', sel.ok,                                                        sel.ok?'SELECT 성공':`${sel.code} ${sel.msg}`],
    ['바코드 무변동',        post.bc===pre.bc,                                              `${post.bc}`],
    ['거래 무변동',          post.txs===pre.txs,                                            `${post.txs}`],
    ['약품 무변동',          post.drugs===pre.drugs,                                        `${post.drugs}`],
    ['1~7월 정본',           post.snap7===pre.snap7,                                        post.snap7],
    ['8월 정본',             post.snap8===pre.snap8,                                        post.snap8],
  ]
  const bad=gate.filter(x=>!x[1])
  gate.forEach(([k,ok,d])=>console.log(`  ${ok?'OK  ':'★ NG'} ${k.padEnd(20)} ${d}`))
  if(bad.length){ await q('rollback'); console.error(`★ ROLLBACK — ${bad.map(x=>x[0]).join(', ')} 실패`); process.exitCode=1 }
  else { await q('commit'); console.log('\n커밋 완료 — drug_barcodes GRANT 보정') }
}catch(e){
  try{ await q('rollback') }catch{}
  console.error('★ 실패(ROLLBACK):', e.message); process.exitCode=1
}finally{ await c.end() }
