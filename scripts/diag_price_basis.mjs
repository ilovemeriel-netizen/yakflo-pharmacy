// Task1 읽기전용: 금액 단가 기준(통당 vs 구입) 진단. 쓰기 없음.
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

// (b) drugs 단가 컬럼: 표본
const codes=['SGBRONNC10','GRD2','SMOSAPIT5','NS1','YCFTZ1','MEPEM1']
const {data:dg}=await sb.from('drugs').select('drug_code,drug_name,standard,price_pack,price_unit,price_per_bottle,edi_price,current_qty,current_amount').in('drug_code',codes).eq('tenant_id',tid)
console.log('=== (b) drugs 단가 컬럼 표본 ===')
console.log('code\tprice_pack\tprice_unit\tprice_per_bottle\tedi_price\tcur_qty\tcur_amount\tcur_amt/qty')
for(const d of dg){const r=d.current_qty?Math.round(d.current_amount/d.current_qty*100)/100:0;console.log(`${d.drug_code}\t${d.price_pack}\t${d.price_unit}\t${d.price_per_bottle}\t${d.edi_price}\t${d.current_qty}\t${d.current_amount}\t${r}`)}

// (a) monthly_snapshots 표본 단가: SGBRONNC10 월별 closing_amount/closing_qty
console.log('\n=== (a) monthly_snapshots SGBRONNC10 월별 단가(closing_amount/closing_qty) ===')
const {data:ms}=await sb.from('monthly_snapshots').select('snap_month,opening_qty,opening_amount,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).eq('drug_code','SGBRONNC10').order('snap_month')
const dgmap=Object.fromEntries(dg.map(d=>[d.drug_code,d]))
for(const r of ms){const u=r.closing_qty?Math.round(r.closing_amount/r.closing_qty*100)/100:0;console.log(`${r.snap_month}월 closing ${r.closing_qty}개 ${r.closing_amount}원 → 단가 ${u} (drugs price_unit=${dgmap.SGBRONNC10?.price_unit} price_pack=${dgmap.SGBRONNC10?.price_pack})`)}

// 월별 전체: 단가 분류(구입=price_unit 근사 / 통당=price_pack 근사)
console.log('\n=== (a) 월별 closing 단가 기준 분류 (전 행) ===')
// drugs 단가맵 전체 로드
const dall=new Map()
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,price_unit,price_pack,price_per_bottle').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;for(const d of data)dall.set(d.drug_code,d);if(data.length<1000)break}
const rows=[]
for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('snap_month,drug_code,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).range(f,f+999);if(!data?.length)break;rows.push(...data);if(data.length<1000)break}
const near=(a,b)=>b>0&&Math.abs(a-b)/b<0.02
console.log('월\t합계금액\t행(qty>0)\t구입단가행\t통당단가행\t기타')
for(const mm of [1,2,3,4,5,6]){
  const r=rows.filter(x=>x.snap_month===mm&&Number(x.closing_qty)>0)
  let buy=0,pack=0,oth=0
  for(const x of r){const u=x.closing_amount/x.closing_qty;const d=dall.get(x.drug_code);if(!d){oth++;continue}
    if(near(u,Number(d.price_unit)))buy++;else if(near(u,Number(d.price_pack))||near(u,Number(d.price_per_bottle)))pack++;else oth++}
  const sum=Math.round(rows.filter(x=>x.snap_month===mm).reduce((s,x)=>s+Number(x.closing_amount||0),0))
  console.log(`${mm}\t${sum}\t${r.length}\t${buy}\t${pack}\t${oth}`)
}
await sb.auth.signOut()
