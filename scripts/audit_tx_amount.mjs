// 거래 금액 정합 감사(읽기전용). transactions.total_amount vs quantity×purchase_price 대조.
// 통당단가(price_unit) 배율로 부풀려진 행 추출. 쓰기 없음. anon+RLS owner 세션.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'),cred=rd('.owner-login.local')
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
const {error}=await sb.auth.signInWithPassword({email:cred.email,password:cred.password})
if(error){console.error('LOGIN_FAIL',error.message);process.exit(1)}
const {data:{user}}=await sb.auth.getUser()
const {data:tm}=await sb.from('tenant_members').select('tenant_id').eq('user_id',user.id).limit(1).maybeSingle()
const tid=tm.tenant_id

// drugs 단가맵
const dmap=new Map()
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,drug_name,purchase_price,price_unit,edi_price').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;for(const d of data)dmap.set(d.drug_code,d);if(data.length<1000)break}

// transactions 전수
const txs=[]
for(let f=0;;f+=1000){const {data,error:e}=await sb.from('transactions').select('id,drug_code,type,quantity,unit_price,total_amount,transaction_date').eq('tenant_id',tid).range(f,f+999);if(e){console.error('TX_ERR',e.message);process.exit(1)}if(!data?.length)break;txs.push(...data);if(data.length<1000)break}

console.log('=== 거래 감사 (읽기전용) ===')
console.log('transactions 전수:',txs.length,'행')
if(txs.length===0){console.log('\n>>> 거래 0건 → 오염 0 확정. 보정 대상 없음.');await sb.auth.signOut();process.exit(0)}

const near=(a,b)=>b!==0&&Math.abs(a-b)/Math.abs(b)<0.02
const cats={clean:0,pack:0,unknown:0,nodrug:0,zero:0}
const polluted=[];const unknown=[]
for(const tx of txs){
  const q=Number(tx.quantity||0),ta=Number(tx.total_amount||0)
  const d=dmap.get(tx.drug_code)
  if(!d){cats.nodrug++;continue}
  const pp=Number(d.purchase_price||0),pu=Number(d.price_unit||0)
  const expPP=q*pp, expPU=q*pu
  if(q===0||ta===0){cats.zero++;continue}
  if(near(ta,expPP)){cats.clean++}
  else if(pu>pp && near(ta,expPU)){cats.pack++;polluted.push({...tx,pp,pu,expPP,ratio:pp>0?(pu/pp).toFixed(1):'∞'})}
  else {cats.unknown++;unknown.push({...tx,pp,pu,expPP})}
}
console.log('\n분류:')
console.log('  정상(≈qty×구입단가):',cats.clean)
console.log('  통당오염(≈qty×통당단가):',cats.pack)
console.log('  불명(둘다 불일치):',cats.unknown)
console.log('  수량/금액 0:',cats.zero,' · 약품매칭없음:',cats.nodrug)

if(polluted.length){
  polluted.sort((a,b)=>Number(b.total_amount)-Number(a.total_amount))
  console.log('\n=== 통당단가 오염 행 명단 (상위 30, 금액순) ===')
  console.log('id\t일자\t약품\ttype\tqty\t현금액\t→보정\t배율')
  for(const x of polluted.slice(0,30))console.log(`${String(x.id).slice(0,8)}\t${x.transaction_date}\t${(x.drug_name||x.drug_code||'').slice(0,12)}\t${x.type}\t${x.quantity}\t${Number(x.total_amount).toLocaleString()}\t${Math.round(x.expPP).toLocaleString()}\t${x.ratio}x`)
  const sumNow=polluted.reduce((s,x)=>s+Number(x.total_amount||0),0),sumFix=polluted.reduce((s,x)=>s+x.expPP,0)
  console.log(`\n오염 ${polluted.length}행 · 현 합계 ${Math.round(sumNow).toLocaleString()} → 보정 합계 ${Math.round(sumFix).toLocaleString()}`)
}
if(unknown.length){
  console.log('\n=== 불명 행(보정 제외·명단만, 상위 15) ===')
  console.log('id\t일자\t약품\ttype\tqty\t현금액\tunit_price\t구입단가')
  for(const x of unknown.slice(0,15))console.log(`${String(x.id).slice(0,8)}\t${x.transaction_date}\t${(x.drug_name||x.drug_code||'').slice(0,12)}\t${x.type}\t${x.quantity}\t${Number(x.total_amount).toLocaleString()}\t${x.unit_price}\t${x.pp}`)
}
console.log('\n[한계] 거래시점 단가 이력 부재 → 현재 drugs.purchase_price 기준 대조. 통당배율 정확 일치 행만 오염으로 분류, 불명은 명단만.')
await sb.auth.signOut()