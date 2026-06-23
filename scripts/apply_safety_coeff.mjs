// safety 구분별 계수 재산출(주사 ×1.0 / 수액 ×0.75 + floor5). 경구·외용 ×0.5 유지(변경0).
// 대상: status=사용 & 구분 주사·수액 & 현 safety_stock>0 & 3개월 avg>0. 변경분만 갱신.
// dry-run: 명단·롤백SQL·forward SQL 출력(쓰기X). --commit: RLS owner 세션 본 적용(guard=현 safety값).
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
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
const norm=c=>{c=(c||'').trim();if(c.includes('주사'))return '주사';if(c.includes('수액'))return '수액';return 'other'}
const drugs=[]
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,drug_name,category,status,safety_stock').eq('tenant_id',tid).eq('status','사용').range(f,f+999);if(!data?.length)break;drugs.push(...data);if(data.length<1000)break}
const sumOut=new Map()
for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,total_out_qty').eq('tenant_id',tid).eq('snap_year',2026).in('snap_month',[3,4,5]).range(f,f+999);if(!data?.length)break;for(const r of data)sumOut.set(r.drug_code,(sumOut.get(r.drug_code)||0)+Number(r.total_out_qty||0));if(data.length<1000)break}
const FACTOR={주사:1.0,수액:0.75},FLOOR=5
const ch=[]
for(const d of drugs){const cat=norm(d.category);if(!(cat in FACTOR))continue;const cur=Number(d.safety_stock||0);if(cur<=0)continue;const avg=(sumOut.get(d.drug_code)||0)/3;if(avg<=0)continue;const nv=Math.max(Math.ceil(avg*FACTOR[cat]),FLOOR);if(nv!==cur)ch.push({code:d.drug_code,name:d.drug_name,cat,avg:Math.round(avg*10)/10,old:cur,nv})}
ch.sort((a,b)=>(b.nv-b.old)-(a.nv-a.old))
console.log(`[모드] ${COMMIT?'본적용(--commit)':'dry-run'} · 주사×1.0 / 수액×0.75 + floor${FLOOR} · 변경 ${ch.length}종`)
console.log('code\t구분\tavg/월\told\tnew\t증감')
for(const c of ch)console.log(`${c.code}\t${c.cat}\t${c.avg}\t${c.old}\t${c.nv}\t${c.nv-c.old>=0?'+':''}${c.nv-c.old}`)
// 롤백 + forward SQL 파일
const rb=['-- safety 계수 재산출 롤백(원 safety_stock 복원). tenant=cnc',...ch.map(c=>`update public.drugs set safety_stock=${c.old} where tenant_id='${tid}' and drug_code='${c.code}';`)].join('\n')
const fw=['-- safety 계수 재산출 forward(주사×1.0/수액×0.75+floor5). BEGIN/ROLLBACK 검증용',...ch.map(c=>`update public.drugs set safety_stock=${c.nv} where tenant_id='${tid}' and drug_code='${c.code}' and safety_stock=${c.old};`)].join('\n')
if(!COMMIT){writeFileSync('supabase/seed/매칭소스/_safety_계수_롤백.sql',rb+'\n');writeFileSync('scripts/_safety_coeff_forward.sql',fw+'\n');console.log('\n롤백SQL→ _safety_계수_롤백.sql, forwardSQL→ scripts/_safety_coeff_forward.sql 기록')}
if(COMMIT){let done=0;for(const c of ch){const {error,count}=await sb.from('drugs').update({safety_stock:c.nv},{count:'exact'}).eq('tenant_id',tid).eq('drug_code',c.code).eq('safety_stock',c.old);if(error)throw new Error('update '+c.code+': '+error.message);done++}console.log(`\n✔ ${done}종 safety_stock 갱신(RLS)`)}
await sb.auth.signOut()
