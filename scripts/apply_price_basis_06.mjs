// 06월 금액 구입단가 보정. 수량 불변·금액만. dry-run: 명단·롤백생성. --commit: RLS UPDATE.
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
const N=x=>Number(x||0), r4=x=>Math.round(x*10000)/10000

// 클린월(5→1) 단가맵: drug_code -> {unit, src}
const cleanUnit=new Map()
for(const mm of [5,4,3,2,1]){
  for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).eq('snap_month',mm).range(f,f+999);if(!data?.length)break
    for(const r of data){if(cleanUnit.has(r.drug_code))continue;const q=N(r.closing_qty);if(q>0)cleanUnit.set(r.drug_code,{unit:N(r.closing_amount)/q,src:mm})}
    if(data.length<1000)break}
}
// edi_price 폴백맵
const edi=new Map()
for(let f=0;;f+=1000){const {data}=await sb.from('drugs').select('drug_code,edi_price').eq('tenant_id',tid).range(f,f+999);if(!data?.length)break;for(const d of data)edi.set(d.drug_code,N(d.edi_price));if(data.length<1000)break}

// 06월 로드
const m6=[]
for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('id,drug_code,opening_qty,opening_amount,subtotal_qty,subtotal_amount,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).eq('snap_month',6).range(f,f+999);if(!data?.length)break;m6.push(...data);if(data.length<1000)break}

const changes=[],hold=[]; let excl=0, intOK=0, intFrac=0
for(const r of m6){
  let cu=cleanUnit.get(r.drug_code), unit=null, src=''
  if(cu){unit=cu.unit;src='M'+cu.src} else if(edi.get(r.drug_code)>0){unit=edi.get(r.drug_code);src='edi'}
  if(unit==null){hold.push(r.drug_code);continue}
  if(Number.isInteger(Math.round(unit*10000)/10000===Math.round(unit)?unit:NaN)||Number.isInteger(unit))intOK++;else intFrac++
  const nc=r4(N(r.closing_qty)*unit), no=r4(N(r.opening_qty)*unit), ns=r4(N(r.subtotal_qty)*unit)
  const cur=N(r.closing_amount)
  // 정상행 제외: 현 closing이 목표와 0.5% 이내
  if(Math.abs(nc-cur)<=Math.max(1,cur*0.005)){excl++;continue}
  changes.push({id:r.id,code:r.drug_code,unit:Math.round(unit*100)/100,src,
    oq:N(r.opening_qty),oa:N(r.opening_amount),no,
    sq:N(r.subtotal_qty),sa:N(r.subtotal_amount),ns,
    cq:N(r.closing_qty),ca:cur,nc})
}
const sumBefore=m6.reduce((s,r)=>s+N(r.closing_amount),0)
const sumAfter=sumBefore - changes.reduce((s,c)=>s+(c.ca-c.nc),0)
console.log(`[모드] ${COMMIT?'본적용(--commit)':'dry-run'}`)
console.log(`06월 행 ${m6.length} | 오염(보정대상) ${changes.length} | 정상제외 ${excl} | 단가불가(보류) ${hold.length}`)
console.log(`구입단가 정수성: 정수 ${intOK} · 소수 ${intFrac}(소수qty약품 등 — 단가는 클린월 역산 그대로 사용)`)
if(hold.length)console.log('보류 명단(클린월qty0+edi0):',hold.join(','))
console.log(`06 closing 합: ${Math.round(sumBefore).toLocaleString()} → ${Math.round(sumAfter).toLocaleString()}`)
console.log('\n오염 표본 8:')
for(const c of changes.slice(0,8))console.log(`  ${c.code}(${c.src}) 단가${c.unit} qty${c.cq}: closing ${Math.round(c.ca).toLocaleString()}→${Math.round(c.nc).toLocaleString()}`)

if(!COMMIT){
  const rb=['-- 06월 금액 보정 롤백(원본 opening/subtotal/closing_amount 복원). tenant=cnc',
    ...changes.map(c=>`update public.monthly_snapshots set opening_amount=${c.oa}, subtotal_amount=${c.sa}, closing_amount=${c.ca} where id='${c.id}';`)].join('\n')
  writeFileSync('supabase/seed/매칭소스/_금액단가_06_롤백.sql',rb+'\n')
  const fw=['-- 06월 금액 보정 forward(구입단가 재계산). BEGIN/ROLLBACK 검증용. 가드: closing_amount=원값',
    ...changes.map(c=>`update public.monthly_snapshots set opening_amount=${c.no}, subtotal_amount=${c.ns}, closing_amount=${c.nc} where id='${c.id}' and closing_amount=${c.ca};`)].join('\n')
  writeFileSync('scripts/_price06_forward.sql',fw+'\n')
  console.log(`\n롤백 SQL → _금액단가_06_롤백.sql (${changes.length}행) · forward → scripts/_price06_forward.sql`)
} else {
  let done=0
  for(const c of changes){
    const {error}=await sb.from('monthly_snapshots').update({opening_amount:c.no,subtotal_amount:c.ns,closing_amount:c.nc})
      .eq('id',c.id).eq('closing_amount',c.ca)  // 가드: 현 값 일치시만(멱등)
    if(error)throw new Error('update '+c.code+': '+error.message)
    done++
  }
  console.log(`\n✔ ${done}행 06 금액 보정(RLS)`)
}
await sb.auth.signOut()
