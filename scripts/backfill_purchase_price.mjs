// drugs.purchase_price 백필 = 검증된 클린월(05→01) 구입단가(closing_amount/closing_qty). 가역.
// dry-run: 명단·재고금액 검증. --commit: RLS UPDATE(purchase_price만). edi_price·수량 무수정.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'
const COMMIT=process.argv.includes('--commit')
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'),cred=rd('.owner-login.local')
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
const {error}=await sb.auth.signInWithPassword({email:cred.email,password:cred.password})
if(error){console.error('LOGIN_FAIL',error.message);process.exit(1)}
const {data:{user}}=await sb.auth.getUser()
const {data:tm}=await sb.from('tenant_members').select('tenant_id').eq('user_id',user.id).limit(1).maybeSingle()
const tid=tm.tenant_id
const N=x=>Number(x||0)
// 클린월 단가맵(05→01 폴백)
const unit=new Map()
for(const mm of [5,4,3,2,1]){for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).eq('snap_month',mm).range(f,f+999);if(!data?.length)break;for(const r of data){if(unit.has(r.drug_code))continue;const q=N(r.closing_qty);if(q>0)unit.set(r.drug_code,Math.round(N(r.closing_amount)/q*10000)/10000)}if(data.length<1000)break}}
const drugs=[]
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,status,current_qty,purchase_price').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;drugs.push(...data);if(data.length<1000)break}
const upd=drugs.filter(d=>unit.has(d.drug_code)).map(d=>({code:d.drug_code,u:unit.get(d.drug_code)}))
const noU=drugs.filter(d=>!unit.has(d.drug_code))
const act=drugs.filter(d=>d.status==='사용')
const stockVal=act.reduce((a,d)=>a+(unit.has(d.drug_code)?N(d.current_qty)*unit.get(d.drug_code):0),0)
console.log(`[모드] ${COMMIT?'본적용(--commit)':'dry-run'}`)
console.log(`백필 대상 ${upd.length}종(클린월단가 보유) · 단가없음 ${noU.length}종(null 유지)`) 
console.log(`검증: 사용약품 재고금액(current_qty×purchase_price) = ${Math.round(stockVal).toLocaleString()} (기대 ~1.12억 / 05마감 113,063,588)`) 
console.log('표본:',['SGBRONNC10','SGBRONNC30','ADLT','SALMARL1','NS1'].map(c=>`${c}=${unit.get(c)}`).join(' '))
if(COMMIT){let done=0;for(const u of upd){const {error}=await sb.from('drugs').update({purchase_price:u.u}).eq('tenant_id',tid).eq('drug_code',u.code);if(error)throw new Error('upd '+u.code+': '+error.message);done++;if(done%200===0)console.log('  ...',done)}console.log(`✔ ${done}종 purchase_price 백필(RLS)`)}
else console.log('\n역롤백: 0018 rollback(alter table drugs drop column purchase_price) 또는 update drugs set purchase_price=null.')
await sb.auth.signOut()
