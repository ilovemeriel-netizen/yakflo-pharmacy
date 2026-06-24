// drugs.atc_*(대/중/소분류·ATC코드) 적재 = 마스터 약품_정본.csv. 약품코드 단위 UPDATE. 가역.
// dry-run: 매칭·커버리지 검증. --commit: anon+RLS owner UPDATE(atc_* 4컬럼만). 단가·수량 무수정.
// 역롤백: update drugs set atc_code=null,atc_l1=null,atc_l2=null,atc_l3=null; 또는 0022 rollback(drop column).
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
const COMMIT=process.argv.includes('--commit')
function rdkv(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
function rd(p){let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);return t}
function parseCSV(t){const rows=[];let row=[],cur='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}else{if(c==='"')q=true;else if(c===','){row.push(cur);cur=''}else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur=''}else if(c==='\r'){}else cur+=c}}if(cur.length||row.length){row.push(cur);rows.push(row)}return rows}
function toObj(rows){const H=rows[0];return rows.slice(1).filter(r=>r.length>1).map(r=>{const o={};H.forEach((h,i)=>o[h]=r[i]);return o})}
const env=rdkv('.env'),cred=rdkv('.owner-login.local')
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
const {error}=await sb.auth.signInWithPassword({email:cred.email,password:cred.password})
if(error){console.error('LOGIN_FAIL',error.message);process.exit(1)}
const {data:{user}}=await sb.auth.getUser()
const {data:tm}=await sb.from('tenant_members').select('tenant_id').eq('user_id',user.id).limit(1).maybeSingle()
const tid=tm.tenant_id
const drugs=[]
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,status').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;drugs.push(...data);if(data.length<1000)break}
const codes=new Set(drugs.map(d=>d.drug_code))
const J=toObj(parseCSV(rd('supabase/seed/매칭소스/약품_정본.csv')))
const upd=[]
for(const r of J){if(!codes.has(r.drug_code))continue
  upd.push({code:r.drug_code,atc_code:(r['ATC번호']||'').trim()||null,atc_l1:(r['대분류']||'').trim()||null,atc_l2:(r['중분류']||'').trim()||null,atc_l3:(r['소분류']||'').trim()||null})}
const main=new Set(drugs.filter(d=>['사용','휴면'].includes(d.status)).map(d=>d.drug_code))
const mainUpd=upd.filter(u=>main.has(u.code))
const l1ok=mainUpd.filter(u=>u.atc_l1).length
console.log(`drugs ${drugs.length} · 마스터 매칭 적재대상 ${upd.length} · 사용+휴면 ${main.size} 중 대분류 채움 ${l1ok}`)
console.log('표본:',JSON.stringify(upd.slice(0,2)))
if(!COMMIT){console.log('\n[dry-run] --commit 으로 적용. 역롤백: atc_* = null 또는 0022 drop column.');process.exit(0)}
let done=0
for(const u of upd){const {error:e}=await sb.from('drugs').update({atc_code:u.atc_code,atc_l1:u.atc_l1,atc_l2:u.atc_l2,atc_l3:u.atc_l3}).eq('tenant_id',tid).eq('drug_code',u.code)
  if(e){console.error('UPD',u.code,e.message);process.exit(1)}done++;if(done%200===0)console.log('  ...',done)}
console.log(`✔ ${done}종 atc_* 적재 완료(RLS). 단가·수량 무수정.`)
// 검증
const chk=[]
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,status,atc_l1').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;chk.push(...data);if(data.length<1000)break}
const m=chk.filter(d=>['사용','휴면'].includes(d.status));const filled=m.filter(d=>d.atc_l1&&d.atc_l1.trim()).length
console.log(`검증: 사용+휴면 ${m.length} 중 atc_l1 채움 ${filled} (${(filled/m.length*100).toFixed(1)}%)`)
await sb.auth.signOut()