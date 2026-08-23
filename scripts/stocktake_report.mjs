// ════════════════════════════════════════════════════════════════
// Yakflo · 9월 재고 실사 대조표 산출 (읽기 전용·쓰기 없음)
//   기준: 시스템재고 current_qty (거래누적 차이=로드 opening, 오류 아님·기준 아님)
//   금액: purchase_price 로만 계산 (price_unit 금지)
//   출력: xlsx 2시트(실사대조 전체 / 우선대조 = 08월 직접변동 110약품)
//   실행: node scripts/stocktake_report.mjs  → xlsx 경로 콘솔 출력
//   ※ 어떤 행도 변경하지 않음. anon+RLS owner 세션. PostgREST 1,000행 캡 → range 청크.
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import XLSX from 'xlsx'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'),cred=rd('.owner-login.local')
const OUT = process.argv[2] || 'stocktake_2026-09.xlsx' // 경로 인자로 지정 가능(스크래치패드 권장)
const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
await sb.auth.signInWithPassword({email:cred.email,password:cred.password})
const {data:{user}}=await sb.auth.getUser()
const {data:tm}=await sb.from('tenant_members').select('tenant_id').eq('user_id',user.id).limit(1).maybeSingle()
const tid=tm.tenant_id
async function loadAll(tbl,cols){let out=[],f=0;while(true){const{data,error}=await sb.from(tbl).select(cols).eq('tenant_id',tid).range(f,f+999);if(error)throw new Error(tbl+': '+error.message);if(!data||!data.length)break;out=out.concat(data);if(data.length<1000)break;f+=1000}return out}
// 1) drugs (전 약품)
const drugs=await loadAll('drugs','drug_code,drug_name,category,status,storage_location,unit,packaging,current_qty,purchase_price')
// 2) transactions → 약품별 거래누적 Σdelta
const txs=await loadAll('transactions','drug_code,type,quantity')
const txDelta={}; for(const t of txs){const s=t.type==='입고'||t.type==='조정'?1:(t.type==='출고'||t.type==='폐기'||t.type==='반품'?-1:0);txDelta[t.drug_code]=(txDelta[t.drug_code]||0)+s*(Number(t.quantity)||0)}
// 3) drug_qty_audit 직접(08월 변동) 약품 집합 — authenticated 미권한(0056=service_role 전용) → 읽기 전용 pg로 조회
const directSet=new Set()
{ let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
  const pc=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}}); await pc.connect()
  const r=await pc.query(`select distinct drug_code from public.drug_qty_audit where path='직접' and tenant_id=$1`,[tid])
  r.rows.forEach(x=>directSet.add(x.drug_code)); await pc.end() }
// 행 구성
const num=v=>Number(v)||0
const rows=drugs.map(d=>{const cq=num(d.current_qty),pp=num(d.purchase_price),td=num(txDelta[d.drug_code]);return{
  code:d.drug_code,name:d.drug_name||'',cat:d.category||'',status:d.status||'',loc:d.storage_location||'',
  cq,unit:d.unit||d.packaging||'',pp,amt:Math.round(cq*pp),
  td,opening:cq-td,direct:directSet.has(d.drug_code)?'Y':'N'
}})
// 정렬: 사용 우선 → 보관위치(없으면 뒤) → 약품코드
const rank=s=>s==='사용'?0:1
rows.sort((a,b)=>rank(a.status)-rank(b.status)||(a.loc?0:1)-(b.loc?0:1)||String(a.loc).localeCompare(String(b.loc),'ko')||String(a.code).localeCompare(String(b.code)))
const HEADER=['약품코드','약품명','구분','상태','보관위치','시스템재고','단위','구입단가','평가금액','실사수량','차이','비고','참고|거래누적','참고|opening추정','참고|08월직접변동']
const INFO='※ 실사 대조 기준 = 시스템재고(current_qty). 「참고|거래누적」과의 차이는 로드 opening 잔고이며 오류가 아닙니다(정정 금지). 평가금액=시스템재고×구입단가(purchase_price). 실사수량·차이·비고 열은 현장 기입용 빈칸입니다.'
function sheet(rws){
  const aoa=[[INFO],[],HEADER]
  let totRaw=0,cnt=0
  for(const r of rws){aoa.push([r.code,r.name,r.cat,r.status,r.loc,r.cq,r.unit,r.pp,r.amt,'','','',r.td,r.opening,r.direct]);totRaw+=r.cq*r.pp;cnt++}
  const tot=Math.round(totRaw) // 재고현황 화면과 동일: 미반올림 합 → 최종 1회 반올림
  aoa.push([]); aoa.push(['합계',cnt+'종','','','','','','',tot,'','','','','',''])
  const ws=XLSX.utils.aoa_to_sheet(aoa); ws['!cols']=HEADER.map((h,i)=>({wch:i===1?26:i===0?12:i>=12?12:10}))
  return {ws,tot,cnt}
}
const wb=XLSX.utils.book_new()
const s1=sheet(rows); XLSX.utils.book_append_sheet(wb,s1.ws,'실사대조')
const prio=rows.filter(r=>r.direct==='Y'); const s2=sheet(prio); XLSX.utils.book_append_sheet(wb,s2.ws,'우선대조')
XLSX.writeFile(wb,OUT)
console.log('산출 완료:',OUT)
console.log('실사대조 시트:',s1.cnt,'종 · 평가금액 총계',s1.tot.toLocaleString())
console.log('우선대조 시트(08월 직접변동):',s2.cnt,'종 · 평가금액',s2.tot.toLocaleString())
console.log('상태 분포:',JSON.stringify(rows.reduce((m,r)=>{m[r.status]=(m[r.status]||0)+1;return m},{})))
console.log('drugs 로드:',drugs.length,'· transactions 로드:',txs.length,'· audit직접 약품:',directSet.size)
