// 읽기 전용: safety 구분별 계수 표본 검증(Task1) + 수기 대상 명단(Task3). 쓰기 없음.
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

// drugs
const drugs=[]
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,drug_name,category,status,safety_stock,max_stock,current_qty,price_unit,price_pack,edi_price,is_narcotic,narcotic_type').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;drugs.push(...data);if(data.length<1000)break}
// 3개월 사용량
const sumOut=new Map()
for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,total_out_qty').eq('tenant_id',tid).eq('snap_year',2026).in('snap_month',[3,4,5]).range(f,f+999);if(!data?.length)break;for(const r of data)sumOut.set(r.drug_code,(sumOut.get(r.drug_code)||0)+Number(r.total_out_qty||0));if(data.length<1000)break}

const norm=c=>{c=(c||'').trim();if(c.includes('경구'))return '경구';if(c.includes('주사'))return '주사';if(c.includes('수액'))return '수액';if(c.includes('외용'))return '외용';if(c.includes('영양'))return '영양';if(c.includes('외품'))return '의약외품';return c||'미분류'}
const price=d=>Number(d.price_unit||d.edi_price||d.price_pack||0)
const use=drugs.filter(d=>d.status==='사용')
for(const d of use){d.cat=norm(d.category);d.avg=Math.round((sumOut.get(d.drug_code)||0)/3*10)/10}

// 구분별 분포(현 safety>0 적재분)
const cats=['경구','주사','수액','외용','영양','의약외품','미분류']
console.log('=== 구분별 safety 적재 분포(status=사용) ===')
console.log('구분\t전체\tsafety적재\t미적재\tavg(safety>0)\tavg사용/월(safety>0)')
for(const c of cats){const g=use.filter(d=>d.cat===c);if(!g.length)continue;const loaded=g.filter(d=>(d.safety_stock||0)>0);const ms=loaded.length?Math.round(loaded.reduce((s,d)=>s+(d.safety_stock||0),0)/loaded.length):0;const mu=loaded.length?Math.round(loaded.reduce((s,d)=>s+d.avg,0)/loaded.length):0;console.log(`${c}\t${g.length}\t${loaded.length}\t${g.length-loaded.length}\t${ms}\t${mu}`)}

// 표본 15종: 구분별 사용량 상위에서 현 safety vs 제안계수 대조
function proposed(cat,avg){const fl=(v)=>Math.max(v,5);
  if(cat==='경구'||cat==='외용')return {s075:Math.ceil(avg*0.5),s100:Math.ceil(avg*0.5)};
  if(cat==='주사'||cat==='수액')return {s075:fl(Math.ceil(avg*0.75)),s100:fl(Math.ceil(avg*1.0))};
  return {s075:Math.ceil(avg*0.5),s100:Math.ceil(avg*0.5)}}
console.log('\n=== 표본 15종: 현 safety(×0.5) vs 제안계수 vs 회전 ===')
console.log('code\t구분\t명\tavg사용/월\t현재고\t현safety\t제안×0.75\t제안×1.0\t판정')
const pick=[]
for(const [c,n] of [['경구',4],['주사',5],['수액',3],['외용',3]]){
  const g=use.filter(d=>d.cat===c&&d.avg>0&&(d.safety_stock||0)>0).sort((a,b)=>b.avg-a.avg).slice(0,n);pick.push(...g)}
for(const d of pick){const p=proposed(d.cat,d.avg);const cover=d.safety_stock/(d.avg||1);
  let verdict='적정';if((d.cat==='주사'||d.cat==='수액')&&d.safety_stock<p.s075)verdict='과소→상향';else if(d.safety_stock>p.s100*1.5)verdict='과다';
  console.log(`${d.drug_code}\t${d.cat}\t${d.drug_name.slice(0,12)}\t${d.avg}\t${d.current_qty}\t${d.safety_stock}\t${p.s075}\t${p.s100}\t${verdict}`)}

// 계수 적용 시 변경분 추정(경구·외용 ×0.5는 현행과 동일 → 변경 0; 주사·수액만 변경)
const changed=use.filter(d=>(d.safety_stock||0)>0&&d.avg>0&&(d.cat==='주사'||d.cat==='수액')).map(d=>{const p=proposed(d.cat,d.avg);return {...d,n075:p.s075,n100:p.s100}}).filter(d=>d.n075!==d.safety_stock||d.n100!==d.safety_stock)
console.log(`\n=== 계수 재산출 영향(주사·수액, 현 safety>0) ===`)
console.log(`주사·수액 적재종 중 변경 후보: ${changed.length}종 (경구·외용은 ×0.5 유지 → 변경 0)`)

// Task3: 미적재(safety=0) 중 마약·고가
const unloaded=use.filter(d=>(d.safety_stock||0)===0)
const narco=unloaded.filter(d=>d.is_narcotic)
const highprice=unloaded.filter(d=>!d.is_narcotic&&price(d)>=1000).sort((a,b)=>price(b)-price(a)).slice(0,12)
console.log(`\n=== Task3 수기 대상: 미적재 ${unloaded.length}종 중 마약 ${narco.length}·고가(단가≥1000원) 상위 ===`)
console.log('구분\tcode\t명\t현재고\tavg사용/월\t단가\tnarcotic_type')
for(const d of narco)console.log(`마약\t${d.drug_code}\t${d.drug_name.slice(0,16)}\t${d.current_qty}\t${d.avg}\t${price(d)}\t${d.narcotic_type||''}`)
for(const d of highprice)console.log(`고가\t${d.drug_code}\t${d.drug_name.slice(0,16)}\t${d.current_qty}\t${d.avg}\t${price(d)}\t`)

// SACFN 현황
const sac=drugs.find(d=>d.drug_code==='SACFN')
if(sac)console.log(`\n=== SACFN 현황 ===\ncode=SACFN cat=${norm(sac.category)} current_qty=${sac.current_qty} safety=${sac.safety_stock} status=${sac.status} avg=${Math.round((sumOut.get('SACFN')||0)/3*10)/10}`)
await sb.auth.signOut()
