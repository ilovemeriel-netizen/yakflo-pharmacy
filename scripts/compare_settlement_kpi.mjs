// Task1 읽기전용: 결산 KPI(월별_검증_KPI.csv) ↔ DB monthly_snapshots 집계 대조. 쓰기 없음.
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

// 결산 KPI 로드
let kt=readFileSync('supabase/seed/결산매칭/월별_검증_KPI.csv','utf8');if(kt.charCodeAt(0)===0xfeff)kt=kt.slice(1)
const kpi={} // kpi[month][지표]=값
for(const l of kt.split(/\r?\n/).slice(1)){if(!l.trim())continue;const [m,k,v]=l.split(',');(kpi[m]=kpi[m]||{})[k]=Number(v)}

// DB monthly_snapshots 전체 로드
const rows=[]
for(let f=0;;f+=1000){const {data}=await sb.from('monthly_snapshots').select('drug_code,snap_month,opening_qty,opening_amount,total_in_qty,total_in_amount,total_out_qty,total_out_amount,total_disp_qty,total_ret_qty,closing_qty,closing_amount').eq('tenant_id',tid).eq('snap_year',2026).range(f,f+999);if(!data?.length)break;rows.push(...data);if(data.length<1000)break}

const months=['2026-01','2026-02','2026-03','2026-04','2026-05']
const num=x=>Number(x||0)
console.log('=== Task1: 월별 KPI 대조 (결산 vs DB) ===')
for(const ym of months){
  const mm=Number(ym.slice(5))
  const r=rows.filter(x=>x.snap_month===mm)
  const db={
    행수:r.length,
    관리품목수:r.filter(x=>num(x.opening_qty)||num(x.total_in_qty)||num(x.total_out_qty)||num(x.closing_qty)).length,
    전월재고:Math.round(r.reduce((s,x)=>s+num(x.opening_amount),0)),
    현재고:Math.round(r.reduce((s,x)=>s+num(x.closing_amount),0)*1000)/1000,
    입고건수:r.filter(x=>num(x.total_in_qty)>0).length,
    입고금액:Math.round(r.reduce((s,x)=>s+num(x.total_in_amount),0)),
    출고건수:r.filter(x=>num(x.total_out_qty)>0).length,
    출고금액:Math.round(r.reduce((s,x)=>s+num(x.total_out_amount),0)*1000)/1000,
    폐기건수:r.filter(x=>num(x.total_disp_qty)>0).length,
    반품건수:r.filter(x=>num(x.total_ret_qty)>0).length,
  }
  const k=kpi[ym]
  const d=(a,b)=>{const x=Math.round((num(a)-num(b))*1000)/1000;return x===0?'✓':(x>0?'+':'')+x}
  console.log(`\n[${ym}]`)
  console.log(`  관리품목수 결산 ${k['관리품목수']} | DB(활동행) ${db.관리품목수} (전체행 ${db.행수}) Δ${d(db.관리품목수,k['관리품목수'])}`)
  console.log(`  전월재고   결산 ${k['전월재고']} | DB ${db.전월재고} Δ${d(db.전월재고,k['전월재고'])}`)
  console.log(`  현재고     결산 ${k['현재고']} | DB ${db.현재고} Δ${d(db.현재고,k['현재고'])}`)
  console.log(`  입고건수   결산 ${k['입고건수']} | DB ${db.입고건수} Δ${d(db.입고건수,k['입고건수'])}`)
  console.log(`  입고금액   결산 ${k['입고금액']} | DB ${db.입고금액} Δ${d(db.입고금액,k['입고금액'])}`)
  console.log(`  출고건수   결산 ${k['출고건수']} | DB ${db.출고건수} Δ${d(db.출고건수,k['출고건수'])}`)
  console.log(`  출고금액   결산 ${k['출고금액']} | DB ${db.출고금액} Δ${d(db.출고금액,k['출고금액'])}`)
  console.log(`  폐기건수   결산 ${k['폐기건수']} | DB ${db.폐기건수} Δ${d(db.폐기건수,k['폐기건수'])}  (폐기금액 ${k['폐기금액']} DB컬럼없음)`)
  console.log(`  반품건수   결산 ${k['반품건수']} | DB ${db.반품건수} Δ${d(db.반품건수,k['반품건수'])}  (반품금액 ${k['반품금액']} DB컬럼없음)`)
}
console.log('\n=== 유효기간 버킷(결산 KPI는 월별 스냅샷, DB는 현재 drugs.expiry_date 기준 — 직접비교 부적합) ===')
console.log('결산 만료/긴급30/주의60/확인90 (월별): ',months.map(m=>`${m.slice(5)}:${kpi[m]['만료']}/${kpi[m]['긴급30일']}/${kpi[m]['주의60일']}/${kpi[m]['확인90일']}`).join('  '))
await sb.auth.signOut()
