// dryrun_0079.mjs — 금액 3컬럼 bigint→numeric 전환 dryrun. BEGIN→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
// A. 타입 numeric · B. 합계 보존 · C. 정본 무변동 · D. 소수 금액 문자열 INSERT 통과 · E. bulk_stock_adjust ·
// F. 0009 트리거 · G. 마감 가드 · H. 0055 가드 · K. 행수 · L. 인덱스. (I/J=코드 판정: runClose 프론트·numeric→JS number)
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(46),v)
const ddl=readFileSync('supabase/migrations/0079_amount_columns_numeric.sql','utf8')
await c.connect()
try{
  const tm=await one(`select user_id, tenant_id from public.tenant_members limit 1`)
  const today=(await one(`select current_date d`)).d
  const asAuth=async()=>{ await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id]) }
  const base=await one(`select
    (select coalesce(sum(total_amount),0)::text from public.transactions) tx,
    (select coalesce(sum(current_amount),0)::text from public.drugs) dg,
    (select coalesce(sum(current_amount),0)::text from public.inventory_stock) iv,
    (select count(*)::int from public.transactions) txn,
    (select count(*)::int from public.drugs) dgn,
    (select count(*)::int from public.inventory_stock) ivn,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) s17,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) s7`)
  const idxBase=Number((await one(`select count(*)::int n from pg_index x join pg_class t on t.oid=x.indrelid where t.relname in ('transactions','drugs','inventory_stock')`)).n)
  // 사전: bigint에 소수 문자열 → 22P02
  let preFail=false
  try{ await q('begin'); await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('__X__','입고',1,'781091.5',$1,$2)`,[today,tm.tenant_id]) }
  catch(e){ preFail=(e.code==='22P02') } finally { try{await q('rollback')}catch{} }

  await q('begin'); await q(ddl)
  const A=(await q(`select data_type from information_schema.columns where table_schema='public' and (table_name,column_name) in (('transactions','total_amount'),('drugs','current_amount'),('inventory_stock','current_amount'))`)).rows.every(r=>r.data_type==='numeric')
  const after=await one(`select (select coalesce(sum(total_amount),0)::text from public.transactions) tx,(select coalesce(sum(current_amount),0)::text from public.drugs) dg,(select coalesce(sum(current_amount),0)::text from public.inventory_stock) iv`)
  const B=(after.tx===base.tx&&after.dg===base.dg&&after.iv===base.iv)
  const snapA=await one(`select coalesce(sum(closing_amount),0)::text s17,(select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) s7 from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const C=(snapA.s17===base.s17&&snapA.s7===base.s7)
  let D=false; await q('savepoint d'); try{ await asAuth(); await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('ADLT','입고',1,'781091.5',$1,$2)`,[today,tm.tenant_id]); D=(String((await one(`select total_amount from public.transactions where drug_code='ADLT' and total_amount=781091.5 limit 1`))?.total_amount)==='781091.5'); await q('reset role') }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint d')
  let E=false; await q('savepoint e'); try{ await asAuth(); const fr=await one(`select drug_code,current_qty from public.drugs where current_qty<>floor(current_qty) and purchase_price>0 and tenant_id=$1 limit 1`,[tm.tenant_id]); const a=await q(`select public.bulk_stock_adjust($1::jsonb,$2::date,$3) r`,[JSON.stringify([{drug_code:fr.drug_code,target_qty:Math.floor(Number(fr.current_qty))-50}]),today,'실사']); const b=await q(`select public.bulk_stock_adjust($1::jsonb,$2::date,$3) r`,[JSON.stringify([{drug_code:'ADLT',target_qty:200}]),today,'실사']); E=(a.rows[0].r.ok&&b.rows[0].r.ok); await q('reset role') }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint e')
  let F=false; await q('savepoint f'); try{ await asAuth(); const bq=Number((await one(`select current_qty from public.drugs where drug_code='ADLT'`)).current_qty); await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('ADLT','입고',5,1565,$1,$2)`,[today,tm.tenant_id]); F=(Number((await one(`select current_qty from public.drugs where drug_code='ADLT'`)).current_qty)===bq+5); await q('reset role') }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint f')
  let G=false; await q('savepoint g'); try{ await asAuth(); try{ await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('ADLT','입고',1,313,'2026-07-15',$1)`,[tm.tenant_id]) }catch(e){ G=(e.code==='23514'||/마감/.test(e.message)) } try{await q('reset role')}catch{} }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint g')
  let H=false; await q('savepoint h'); try{ await asAuth(); try{ await q(`update public.drugs set current_qty=current_qty+1 where drug_code='ADLT'`) }catch(e){ H=(e.code==='23514'||/qty_via_tx|거래|재고/i.test(e.message)) } try{await q('reset role')}catch{} }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint h')
  const K=(Number((await one(`select count(*)::int n from public.transactions`)).n)===base.txn&&Number((await one(`select count(*)::int n from public.drugs`)).n)===base.dgn&&Number((await one(`select count(*)::int n from public.inventory_stock`)).n)===base.ivn)
  const L=(Number((await one(`select count(*)::int n from pg_index x join pg_class t on t.oid=x.indrelid where t.relname in ('transactions','drugs','inventory_stock')`)).n)===idxBase)
  await q('rollback')
  const revert=(await one(`select data_type from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='total_amount'`)).data_type

  console.log('\n════════ 0079 dryrun (전량 ROLLBACK·운영 무잔류) ════════')
  P('(사전) bigint 소수 문자열 → 22P02', preFail?'✅ 재현':'⚠')
  P('A. 3컬럼 numeric', A?'✅':'❌'); P('B. 합계 보존', B?('✅ '+after.tx+'/'+after.dg+'/'+after.iv):'❌')
  P('C. 정본 무변동', C?('✅ '+snapA.s17+'/'+snapA.s7):'❌'); P('D. 소수 문자열 INSERT', D?'✅':'❌')
  P('E. bulk_stock_adjust', E?'✅':'❌'); P('F. 0009 트리거', F?'✅':'❌')
  P('G. 마감 가드', G?'✅':'❌'); P('H. 0055 가드', H?'✅':'❌')
  P('I. 월마감', 'runClose=프론트·스냅샷 numeric·current_amount 미참조 → 무영향')
  P('J. 보고서', 'numeric→JS number(정본 산출 입증) → 합계/표시 무영향')
  P('K. 행수 무변동', K?'✅':'❌'); P('L. 인덱스 무변동', L?'✅':'❌')
  P('★ ROLLBACK 원복', revert==='bigint'?'✅ bigint':'⚠ '+revert)
  console.log('════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('dryrun 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
