// verify_0088.mjs — apply_0088 이후 운영 검증. 쓰기 없음(트랜잭션 전량 ROLLBACK).
//
// ★★ 이 스크립트의 존재 이유 — 결함 72
//   verify_0087.mjs 는 DATABASE_URL(postgres 소유자)로만 확인해 11/11 을 통과시켰다.
//   소유자는 RLS 와 GRANT 를 모두 우회하므로 **실제 사용 경로를 본 적이 없었고**,
//   브라우저(authenticated)에서 42501 permission denied 로 막혔다.
//   → RLS 테이블을 신설·변경할 때는 반드시 `set local role authenticated` 로 확인한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
async function probe(sql){
  await q('savepoint sp')
  try { const r=await q(sql); await q('release savepoint sp'); return { ok:true, row:r.rows[0] } }
  catch(e){ await q('rollback to savepoint sp'); return { ok:false, code:e.code, msg:e.message } }
}

await c.connect()
try{
  /* 1. GRANT 상태 */
  const g=(await q(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='drug_barcodes' and grantee in ('authenticated','service_role','anon')`)).rows
  const byRole=r=>g.filter(x=>x.grantee===r).map(x=>x.privilege_type).sort()
  const want=['DELETE','INSERT','SELECT','UPDATE']
  P('1 authenticated GRANT', JSON.stringify(byRole('authenticated'))===JSON.stringify(want), `[${byRole('authenticated')}]`)
  P('2 service_role GRANT',  JSON.stringify(byRole('service_role'))===JSON.stringify(want),  `[${byRole('service_role')}]`)
  P('3 anon 미부여',          byRole('anon').length===0, `[${byRole('anon').length?byRole('anon'):'없음(의도대로)'}]`)

  /* 4·5·6. ★ authenticated 롤 실제 동작 */
  await q('begin'); await q('set transaction read only'); await q('set local role authenticated')
  const sel=await probe(`select count(*)::int n from public.drug_barcodes`)
  const other=[]
  for(const t of ['inventory_counts','inventory_count_items','drugs','drug_master']){
    const r=await probe(`select count(*)::int n from public.${t}`); other.push(`${t}:${r.ok?'OK':'★'+r.code}`)
  }
  const fn1=await probe(`select public.gtin_check_ok('8806717068539') v`)
  const fn2=await probe(`select public.norm_barcode('(01)08806717068539','GS1') v`)
  await q('reset role'); await q('rollback')

  P('4 ★ authenticated SELECT', sel.ok, sel.ok?`성공 · ${JSON.stringify(sel.row)} (RLS tenant 격리로 0행이 정상)`:`★ ${sel.code} ${sel.msg}`)
  P('5 타 테이블 무영향', other.every(x=>x.includes('OK')), other.join(' · '))
  P('6 함수 EXECUTE', fn1.ok&&fn2.ok, `gtin_check_ok ${fn1.ok?fn1.row.v:'NG'} · norm_barcode ${fn2.ok?fn2.row.v:'NG'}`)

  /* 7. RLS 유지 — GRANT 가 열렸어도 남의 tenant 는 못 넣는다
        ★ SQLSTATE 는 GRANT 거부와 RLS 위반이 둘 다 42501 이라 메시지로 판별한다 */
  await q('begin'); await q('set local role authenticated')
  const ins=await probe(`insert into public.drug_barcodes (tenant_id,code,code_type,source)
    values ('00000000-0000-0000-0000-000000000000','09999999999996','GS1','학습') returning id`)
  await q('reset role'); await q('rollback')
  P('7 RLS 유지', !ins.ok && /row-level security/i.test(ins.msg||''),
    ins.ok?'★ 남의 tenant 로 INSERT 가 됨':`${/permission denied/i.test(ins.msg||'')?'★ GRANT 가 막음':'RLS 가 막음'} — ${(ins.msg||'').slice(0,64)}`)

  /* 8. RLS·정책 무변동 (0087 그대로) */
  const rls=(await one(`select relrowsecurity ok from pg_class where relname='drug_barcodes'`)).ok
  const pol=(await q(`select policyname, cmd, qual from pg_policies where schemaname='public' and tablename='drug_barcodes'`)).rows
  const del=pol.find(p=>p.cmd==='DELETE')
  P('8 RLS·정책 무변동', rls===true && pol.length===4 && !!del && /is_admin/.test(del.qual||''),
    `RLS ${rls?'on':'OFF'} · 정책 ${pol.length}/4 · DELETE is_admin ${del&&/is_admin/.test(del.qual||'')?'있음':'없음'}`)

  /* 9. 데이터·정본 무변동 */
  const k=await one(`select
    (select count(*)::int from public.drug_barcodes) bc,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('9 데이터·정본 무변동',
    k.bc===2894 && k.txs===1411 && k.drugs===1118 &&
    k.snap7.startsWith('885285628.424') && k.snap8.startsWith('101208155.9'),
    `바코드 ${k.bc}/2894 · 거래 ${k.txs}/1411 · 약품 ${k.drugs}/1118 · 1~7월 ${k.snap7} · 8월 ${k.snap8}`)

  console.log('─'.repeat(72))
  let pass=0, total=0
  for(const [key,v] of Object.entries(R)){ console.log(`${v.ok?'  PASS':'★ FAIL'}  ${key.padEnd(22)} ${v.d}`); if(v.ok)pass++; total++ }
  console.log('─'.repeat(72))
  console.log(`${pass}/${total} 통과`)
  process.exitCode = pass===total ? 0 : 1
}catch(e){ try{ await q('rollback') }catch{}; console.error('★ 실패:', e.message); process.exitCode=1 }
finally{ await c.end() }
