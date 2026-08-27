// verify_0079.mjs — 0079 apply 후 운영 재검증. 검증용 조정은 전부 savepoint/ROLLBACK(운영 무잔류). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(46),v)
await c.connect()
try{
  const tm=await one(`select user_id, tenant_id from public.tenant_members limit 1`)
  const today=(await one(`select current_date d`)).d
  const asAuth=async()=>{ await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id]) }

  // 1. 타입
  const types=(await q(`select data_type from information_schema.columns where table_schema='public'
    and (table_name,column_name) in (('transactions','total_amount'),('drugs','current_amount'),('inventory_stock','current_amount'))`)).rows
  const r1=types.length===3 && types.every(r=>r.data_type==='numeric')
  // 2. 합계
  const s=await one(`select coalesce(sum(total_amount),0)::text tx from public.transactions`)
  const sd=await one(`select coalesce(sum(current_amount),0)::text dg from public.drugs`)
  const si=await one(`select coalesce(sum(current_amount),0)::text iv from public.inventory_stock`)
  const r2=(s.tx==='88402339'&&sd.dg==='0'&&si.iv==='106823959')
  // 3. 정본
  const snap=await one(`select coalesce(sum(closing_amount),0)::text s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::text s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)
  const r3=(snap.s==='885285628.424000000014'&&snap7.s==='106365758.46920000003')
  // 4. 소수 문자열 INSERT
  let r4=false,v4=null
  await q('begin'); await q('savepoint a'); try{ await asAuth()
    await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('ADLT','입고',1,'781091.5',$1,$2)`,[today,tm.tenant_id])
    v4=(await one(`select total_amount from public.transactions where drug_code='ADLT' and total_amount=781091.5 limit 1`))?.total_amount; r4=(String(v4)==='781091.5')
    await q('reset role')
  }catch(e){ v4='ERR '+e.code; try{await q('reset role')}catch{} } await q('rollback to savepoint a'); await q('rollback')
  // 5. bulk_stock_adjust
  let r5=false
  await q('begin'); await q('savepoint b'); try{ await asAuth()
    const fr=await one(`select drug_code,current_qty from public.drugs where current_qty<>floor(current_qty) and purchase_price>0 and tenant_id=$1 limit 1`,[tm.tenant_id])
    const a=await q(`select public.bulk_stock_adjust($1::jsonb,$2::date,$3) r`,[JSON.stringify([{drug_code:fr.drug_code,target_qty:Math.floor(Number(fr.current_qty))-50}]),today,'실사'])
    const b=await q(`select public.bulk_stock_adjust($1::jsonb,$2::date,$3) r`,[JSON.stringify([{drug_code:'ADLT',target_qty:200}]),today,'실사'])
    r5=(a.rows[0].r.ok===true&&b.rows[0].r.ok===true); await q('reset role')
  }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint b'); await q('rollback')
  // 6. 0009 트리거
  let r6=false
  await q('begin'); await q('savepoint c'); try{ await asAuth()
    const bq=Number((await one(`select current_qty from public.drugs where drug_code='ADLT'`)).current_qty)
    await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('ADLT','입고',5,1565,$1,$2)`,[today,tm.tenant_id])
    r6=(Number((await one(`select current_qty from public.drugs where drug_code='ADLT'`)).current_qty)===bq+5); await q('reset role')
  }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint c'); await q('rollback')
  // 7. 마감 가드
  let r7=false
  await q('begin'); await q('savepoint d'); try{ await asAuth()
    try{ await q(`insert into public.transactions(drug_code,type,quantity,total_amount,transaction_date,tenant_id) values('ADLT','입고',1,313,'2026-07-15',$1)`,[tm.tenant_id]) }
    catch(e){ r7=(e.code==='23514'||/마감/.test(e.message)) } try{await q('reset role')}catch{}
  }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint d'); await q('rollback')
  // 8. 0055 가드
  let r8=false
  await q('begin'); await q('savepoint e'); try{ await asAuth()
    try{ await q(`update public.drugs set current_qty=current_qty+1 where drug_code='ADLT'`) }
    catch(e){ r8=(e.code==='23514'||/qty_via_tx|거래|재고/i.test(e.message)) } try{await q('reset role')}catch{}
  }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint e'); await q('rollback')
  // 9. 행수
  const n=await one(`select (select count(*) from public.transactions)::int tx,(select count(*) from public.drugs)::int dg,(select count(*) from public.inventory_stock)::int iv`)
  const r9=(n.tx===962&&n.dg===1114&&n.iv===1120)
  // 10. 인덱스
  const idx=Number((await one(`select count(*)::int n from pg_index x join pg_class t on t.oid=x.indrelid where t.relname in ('transactions','drugs','inventory_stock')`)).n)
  const r10=(idx===7)
  // 11. 무잔류 — ADLT 150 유지·소수약품 원복
  const adlt=(await one(`select current_qty::text q from public.drugs where drug_code='ADLT'`)).q
  const r11=(adlt==='150.0'||adlt==='150')

  console.log('\n════════ 0079 apply 재검증 (검증분 전량 ROLLBACK) ════════')
  P('1. 3컬럼 타입 numeric', r1?'✅':'❌')
  P('2. 합계 보존(tx/dg/iv)', r2?('✅ '+s.tx+'/'+sd.dg+'/'+si.iv):('❌ '+s.tx+'/'+sd.dg+'/'+si.iv))
  P('3. 정본 1~7월/7월 무변동', r3?('✅ '+snap.s+'/'+snap7.s):('❌ '+snap.s+'/'+snap7.s))
  P('4. 소수 문자열 INSERT 통과', r4?('✅ '+v4):('❌ '+v4))
  P('5. bulk_stock_adjust(소수·정수)', r5?'✅':'❌')
  P('6. 0009 거래→재고 트리거', r6?'✅':'❌')
  P('7. 마감 가드(2026-07 차단)', r7?'✅':'❌')
  P('8. 0055 가드(직접 UPDATE 차단)', r8?'✅':'❌')
  P('9. 행수 무변동', r9?('✅ '+n.tx+'/'+n.dg+'/'+n.iv):('❌ '+n.tx+'/'+n.dg+'/'+n.iv))
  P('10. 인덱스 7개 유지', r10?('✅ '+idx):('❌ '+idx))
  P('11. 무잔류(ADLT 150 유지)', r11?('✅ '+adlt):('⚠ '+adlt))
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('재검증 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
