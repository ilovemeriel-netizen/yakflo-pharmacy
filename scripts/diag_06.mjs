import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'),cred=rd('.owner-login.local')
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
await sb.auth.signInWithPassword({email:cred.email,password:cred.password})
const {data:{user}}=await sb.auth.getUser()
const {data:tm}=await sb.from('tenant_members').select('tenant_id').eq('user_id',user.id).limit(1).maybeSingle()
const tid=tm.tenant_id
// drugs.current_amount 전부 0인지
const {count:caN}=await sb.from('drugs').select('drug_code',{count:'exact',head:true}).eq('tenant_id',tid).neq('current_amount',0)
console.log('drugs.current_amount != 0 행수:',caN)
// 05·06 스냅샷
const load=async(m)=>{const o=new Map();for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,closing_qty,closing_amount,opening_qty,opening_amount,total_in_qty,total_out_qty').eq('tenant_id',tid).eq('snap_year',2026).eq('snap_month',m).range(f,f+999);if(!data?.length)break;for(const r of data)o.set(r.drug_code,r);if(data.length<1000)break}return o}
const m5=await load(5),m6=await load(6)
// 06 in/out 합(이월이면 0)
let in6=0,out6=0;for(const r of m6.values()){in6+=Number(r.total_in_qty||0);out6+=Number(r.total_out_qty||0)}
console.log('06월 입고합',in6,'출고합',out6,'(0이면 순수 이월)')
// 약품별 05 vs 06 단가비교
let infl=0,inflSum06=0,correctedSum=0,total06=0,noBase=0
for(const [code,r6] of m6){const q6=Number(r6.closing_qty||0);const a6=Number(r6.closing_amount||0);total06+=a6;if(q6<=0)continue
  const u6=a6/q6;const r5=m5.get(code);const q5=Number(r5?.closing_qty||0);const u5=q5>0?Number(r5.closing_amount)/q5:null
  if(u5){const ratio=u6/u5;if(ratio>1.5){infl++;inflSum06+=a6;correctedSum+=q6*u5}else correctedSum+=a6}
  else {noBase++;correctedSum+=a6}}
console.log(`\n06월 행 ${m6.size} | 단가 부풀림(06u/05u>1.5) ${infl}행`)
console.log(`현재 06 closing 합 ${Math.round(total06).toLocaleString()}`)
console.log(`└ 부풀림행 현재합 ${Math.round(inflSum06).toLocaleString()}`)
console.log(`05단가로 보정 시 06 closing 합 ≈ ${Math.round(correctedSum).toLocaleString()} (05기준 클린단가, 05미존재 ${noBase}행은 현값 유지)`)
const sum5=[...m5.values()].reduce((s,r)=>s+Number(r.closing_amount||0),0)
console.log(`참고 05월 closing 합 ${Math.round(sum5).toLocaleString()} (이월이면 06≈05)`)
// 부풀림 표본 5
console.log('\n부풀림 표본(code: 05단가→06단가, 06qty, 06금액):')
let n=0;for(const [code,r6] of m6){if(n>=6)break;const q6=Number(r6.closing_qty||0);if(q6<=0)continue;const r5=m5.get(code);const q5=Number(r5?.closing_qty||0);if(q5<=0)continue;const u5=Number(r5.closing_amount)/q5,u6=Number(r6.closing_amount)/q6;if(u6/u5>1.5){console.log(`  ${code}: ${Math.round(u5)}→${Math.round(u6)} (×${Math.round(u6/u5*10)/10}), qty ${q6}, 금액 ${Math.round(Number(r6.closing_amount)).toLocaleString()}`);n++}}
await sb.auth.signOut()
