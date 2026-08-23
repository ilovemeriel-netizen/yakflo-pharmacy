// dryrun_0055.mjs — 0055 current_qty 직접 UPDATE 가드 dryrun (BEGIN → 0055 적용 → 검증 A~L → ROLLBACK). 운영(phg). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0055_guard_drugs_qty_direct.sql','utf8') // begin/commit 없음 → 통째로 tx 내 실행
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(50),v)
await c.connect()
try{
  await q('begin')
  const cnt0=Number((await one(`select count(*)::int n from public.drugs`)).n)
  const snap0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)
  const tgt=await one(`select drug_code, tenant_id, current_qty, coalesce(purchase_price,0) pp from public.drugs where current_qty is not null order by drug_code limit 1`)
  const owner=await one(`select user_id from public.tenant_members where role='owner' limit 1`)
  await q(ddl) // 0055 전체(apply_tx/revert_tx 재정의 + 가드 트리거)

  // A
  const gt=(await one(`select count(*)::int n from pg_trigger where tgrelid='public.drugs'::regclass and tgname='trg_guard_drugs_qty_direct'`)).n
  const gf=(await one(`select count(*)::int n from pg_proc where proname='guard_drugs_qty_direct'`)).n
  const flag=/set_config\('app\.qty_via_tx'/.test((await one(`select pg_get_functiondef(oid) d from pg_proc where proname='apply_tx_to_inventory' limit 1`)).d)
  // B. 신규 INSERT(current_qty:0)
  let bOk=false,bErr=''
  await q('savepoint b'); try{ await q(`insert into public.drugs(drug_code,drug_name,category,status,current_qty,tenant_id) values('__DRYRUN_NEW__','드라이런신규','경구제','사용',0,$1)`,[tgt.tenant_id]); bOk=true }catch(e){ bErr=e.code+' '+e.message.split('\n')[0].slice(0,60) } await q('rollback to savepoint b')
  // C. 직접 current_qty UPDATE → 차단
  let cBlk=false,cInfo=''
  await q('savepoint cc'); try{ await q(`update public.drugs set current_qty = coalesce(current_qty,0)+1 where drug_code=$1`,[tgt.drug_code]) }catch(e){ cBlk=(e.code==='23514'); cInfo=e.code+' '+e.message.split('\n')[0].slice(0,70) } await q('rollback to savepoint cc')
  // D. 다른 컬럼만 UPDATE(atc_exclude_reason) → 통과
  let dOk=false,dErr=''
  await q('savepoint d'); try{ await q(`update public.drugs set atc_exclude_reason='__dryrun__' where drug_code=$1`,[tgt.drug_code]); dOk=true }catch(e){ dErr=e.code+' '+e.message.split('\n')[0].slice(0,60) } await q('rollback to savepoint d')
  // E. 대량 patch(current_qty 미포함, memo만) → 통과
  let eOk=false,eErr=''
  await q('savepoint e'); try{ await q(`update public.drugs set memo='__dryrun__' where drug_code=$1`,[tgt.drug_code]); eOk=true }catch(e){ eErr=e.code+' '+e.message.split('\n')[0].slice(0,60) } await q('rollback to savepoint e')
  // F. transactions INSERT → apply_tx로 current_qty 반영 + I(감사) + J(inventory)
  let fOk=false,fErr='',fDelta=null,iAudit=null,jInv=null
  await q('savepoint f'); try{
    const audB=Number((await one(`select count(*)::int n from public.drug_qty_audit where drug_code=$1`,[tgt.drug_code])).n)
    await q(`insert into public.transactions(drug_code,type,quantity,tenant_id,transaction_date) values($1,'입고',7,$2,'2026-08-15')`,[tgt.drug_code,tgt.tenant_id])
    const after=Number((await one(`select current_qty n from public.drugs where drug_code=$1`,[tgt.drug_code])).n)
    fDelta=after-Number(tgt.current_qty); fOk=(fDelta===7)
    iAudit=Number((await one(`select count(*)::int n from public.drug_qty_audit where drug_code=$1`,[tgt.drug_code])).n)-audB
    jInv=(await one(`select current_qty n from public.inventory_stock where drug_code=$1 and tenant_id=$2`,[tgt.drug_code,tgt.tenant_id]))?.n
  }catch(e){ fErr=e.code+' '+e.message.split('\n')[0].slice(0,70) } await q('rollback to savepoint f')
  // G. bulk_stock_adjust RPC (조정거래 경유)
  let gOk=false,gInfo=''
  await q('savepoint g'); try{
    await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.user_id])
    const r=await one(`select public.bulk_stock_adjust($1::jsonb,'2026-08-15','dryrun') res`,[JSON.stringify([{drug_code:tgt.drug_code,target_qty:Number(tgt.current_qty)+5}])])
    const after=Number((await one(`select current_qty n from public.drugs where drug_code=$1`,[tgt.drug_code])).n)
    gOk=(after===Number(tgt.current_qty)+5); gInfo='res='+JSON.stringify(r.res).slice(0,60)+' cur→'+after
  }catch(e){ gInfo=e.code+' '+e.message.split('\n')[0].slice(0,70) } await q('rollback to savepoint g')
  // H. service_role 경로(거래 insert)
  let hOk=false,hErr=''
  await q('savepoint h'); try{
    await q(`set local role service_role`)
    await q(`insert into public.transactions(drug_code,type,quantity,tenant_id,transaction_date) values($1,'입고',3,$2,'2026-08-15')`,[tgt.drug_code,tgt.tenant_id])
    hOk=true
  }catch(e){ hErr=e.code+' '+e.message.split('\n')[0].slice(0,70) } await q('rollback to savepoint h')
  // K,L
  const cnt1=Number((await one(`select count(*)::int n from public.drugs`)).n)
  const snap1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  await q('rollback')

  console.log('\n════════ 0055 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('A. 가드 트리거·함수 생성', (gt&&gf)?'✅':'❌', ); P('   apply_tx에 flag(app.qty_via_tx) 주입', flag?'✅':'❌')
  P('B. 신규 INSERT(current_qty:0) 통과', bOk?'✅':'❌ '+bErr)
  P('C. 직접 current_qty UPDATE 차단', cBlk?'✅ 차단(23514)':'❌ '+cInfo); P('   메시지', cInfo)
  P('D. 다른 컬럼만 UPDATE 통과', dOk?'✅':'❌ '+dErr)
  P('E. 대량 patch(current_qty 미포함) 통과', eOk?'✅':'❌ '+eErr)
  P('F. transactions INSERT→current_qty 반영', fOk?('✅ Δ'+fDelta):'❌ '+fErr)
  P('I. 0056 감사 기록 생성', iAudit>=1?('✅ +'+iAudit+'행'):'❌ '+iAudit)
  P('J. inventory_stock 반영', jInv!=null?('✅ inv='+jInv):'❌')
  P('G. bulk_stock_adjust RPC 정상', gOk?('✅ '+gInfo):'❌ '+gInfo)
  P('H. service_role 경로 정상', hOk?'✅':'❌ '+hErr)
  P('K. drugs 행수(전/후)', `${cnt0}→${cnt1} ${cnt0===cnt1?'✅':'❌'}`)
  P('L. 정본 1~7월(전/후)', `${Math.round(Number(snap0.s)).toLocaleString()}→${Math.round(Number(snap1.s)).toLocaleString()} ${Number(snap0.s)===Number(snap1.s)?'✅':'❌'} · 7월 ${Math.round(Number(snap7.s)).toLocaleString()}${Math.round(Number(snap7.s))===106365758?'✅':'⚠'}`)
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('DRYRUN 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
