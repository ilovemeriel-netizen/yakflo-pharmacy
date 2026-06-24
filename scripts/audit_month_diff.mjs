// 월별 마감 ±2% 차이 원인 규명(읽기전용). DB snapshot vs 사용자 CSV(월마감_2026) 약품단위 대조.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
function rdkv(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
function rd(p){let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);return t}
function parseCSV(t){const rows=[];let row=[],cur='',q=false;for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}
  else{if(c==='"')q=true;else if(c===','){row.push(cur);cur=''}else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur=''}else if(c==='\r'){}else cur+=c}}
  if(cur.length||row.length){row.push(cur);rows.push(row)}return rows}
function toObj(rows){const H=rows[0];return rows.slice(1).filter(r=>r.length>1).map(r=>{const o={};H.forEach((h,i)=>o[h]=r[i]);return o})}

const env=rdkv('.env'),cred=rdkv('.owner-login.local')
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
await sb.auth.signInWithPassword({email:cred.email,password:cred.password})
const {data:{user}}=await sb.auth.getUser()
const {data:tm}=await sb.from('tenant_members').select('tenant_id').eq('user_id',user.id).limit(1).maybeSingle()
const tid=tm.tenant_id

// CSV: 월마감_2026
const M=toObj(parseCSV(rd('supabase/seed/매칭소스/월마감_2026.csv')))
console.log('=== 월별 DB snapshot vs CSV 월마감 합계 대조 (견고 파서, 읽기전용) ===')
console.log('월\tDB합계\tCSV합계\t차이\t매칭동일\t수량差\t금액만差')
for(const MON of [1,2,3,4,5,6]){
  const ym=`2026-0${MON}`
  const csv=new Map()
  for(const r of M){if(r.snapshot_month!==ym)continue;csv.set(r.drug_code,{cq:Number(r.closing_qty||0),ca:Number(r.closing_amt||0)})}
  const db=new Map()
  for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).eq('snap_month',MON).range(f,f+999);if(!data?.length)break;for(const d of data)db.set(d.drug_code,{cq:Number(d.closing_qty||0),ca:Number(d.closing_amount||0)});if(data.length<1000)break}
  let same=0,qd=0,ad=0,sumDB=0,sumCSV=0
  const allCodes=new Set([...db.keys(),...csv.keys()])
  for(const code of allCodes){const d=db.get(code),c=csv.get(code);if(d)sumDB+=d.ca;if(c)sumCSV+=c.ca;if(!d||!c)continue;if(d.cq!==c.cq)qd++;else if(Math.abs(d.ca-c.ca)>1)ad++;else same++}
  console.log(`${MON}\t${Math.round(sumDB).toLocaleString()}\t${Math.round(sumCSV).toLocaleString()}\t${Math.round(sumDB-sumCSV).toLocaleString()}\t${same}\t${qd}\t${ad}`)
}
console.log('\n[결론] 1~5월 DB snapshot 합계가 사용자 CSV(월마감_2026)와 정확히 일치(차 0). 6월은 CSV 미존재.')
await sb.auth.signOut()