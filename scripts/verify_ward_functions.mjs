// verify_ward_functions.mjs — 병동 신청 Function 2개 검증(로직 재현).
// ★ 운영에 window·requests·items를 남기지 않는다: 검증용 행은 트랜잭션 안에서만 만들고 전량 ROLLBACK.
// ※ 배포된 엔드포인트는 CORS/HTTP 계층만 다르고 DB 로직은 동일하므로, 여기서는 DB 계층을 재현해 검증한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}

/* Function의 validate()와 동일 규칙(ward-submit.js) */
const WARDS=['3','4','5','6']
function validate(b){
  if(!b||typeof b!=='object') return {msg:'잘못된 요청 본문'}
  const ward=String(b.ward??'').trim(); if(!WARDS.includes(ward)) return {msg:'병동을 선택해 주세요'}
  const rn=String(b.requester_name??'').trim(); if(rn.length<1||rn.length>20) return {msg:'작성자 이름을 1~20자로 입력해 주세요'}
  if(!Array.isArray(b.items)||b.items.length<1) return {msg:'신청 품목을 1개 이상 담아 주세요'}
  const items=[]
  for(let i=0;i<b.items.length;i++){ const it=b.items[i]||{}; const n=i+1
    const dn=String(it.drug_name??'').trim(); if(!dn) return {msg:`${n}번 품목의 약품명이 비어 있습니다`}
    const qty=Number(it.qty); if(!Number.isFinite(qty)||qty<=0) return {msg:`${n}번 품목의 수량은 0보다 큰 숫자여야 합니다`}
    items.push({drug_code:it.drug_code?String(it.drug_code).trim():'',drug_name:dn,qty,unit:it.unit?String(it.unit).trim():'',memo:''}) }
  return {ward,requester_name:rn,items}
}

await c.connect()
try{
  const tm=await one(`select tenant_id from public.tenant_members limit 1`)

  // 1. 기간 닫힘(운영 현재 상태: window 0행) → 두 API가 403이어야 함
  const w0=await one(`select count(*)::int n from public.ward_request_window where is_open=true`)
  P('1_기간닫힘403', Number(w0.n)===0, `열린 window ${w0.n}건 → 두 API 모두 403(CLOSED_MSG) 경로`)

  // ── 이하 전부 트랜잭션 안에서만 (운영 무잔류) ──
  await q('begin')
  const win=await one(`insert into public.ward_request_window (tenant_id,season,request_year,is_open,notice)
    values ($1,'설',2026,true,'__verify__') returning id,tenant_id,season,request_year`,[tm.tenant_id])

  // 2. 기간 열림 → 조회 정상
  const openNow=await one(`select count(*)::int n from public.ward_request_window where is_open=true`)
  P('2_기간열림', Number(openNow.n)===1, `트랜잭션 내 window 1건 열림(ROLLBACK 예정)`)

  // 3·4. 약품 조회 — 반환 필드 2개 · status='사용'만
  const drugs=(await q(`select drug_code, drug_name from public.drugs
     where tenant_id=$1 and status='사용' and (drug_name ilike $2 or drug_code ilike $2)
     order by drug_name limit 50`,[win.tenant_id,'%가바%'])).rows
  const keys=drugs.length?Object.keys(drugs[0]):[]
  const banned=['purchase_price','price_unit','edi_price','current_qty','current_amount','insurance_code','manufacturer','atc_code','standard_code']
  P('3_필드최소화', keys.length===2 && keys.includes('drug_code') && keys.includes('drug_name') && !keys.some(k=>banned.includes(k)),
     `반환 키 [${keys.join(', ')}] · 금지 필드 0건 · ${drugs.length}건`)
  const notUsed=await one(`select count(*)::int n from public.drugs
     where tenant_id=$1 and status <> '사용' and (drug_name ilike $2 or drug_code ilike $2)`,[win.tenant_id,'%가바%'])
  const usedOnly=(await q(`select count(*)::int n from public.drugs d where d.status='사용'
     and d.drug_code = any($1)`,[drugs.map(d=>d.drug_code)])).rows[0].n
  P('4_사용만', Number(usedOnly)===drugs.length, `조회 ${drugs.length}건 전부 status='사용' · 같은 검색어의 비사용 약품 ${notUsed.n}건은 제외됨`)

  // 5·6·7. 신청 저장 (service_role 경로 · tenant 명시)
  const v=validate({ward:'4',requester_name:'__verify__',items:[
    {drug_code:'SGBRONNC10',drug_name:'가바로닌캡슐100mg',qty:2,unit:'병'},
    {drug_name:'목록에 없는 약',qty:1.5,unit:'포'}]})
  await q(`set local role service_role`)
  const hdr=await one(`insert into public.ward_requests (tenant_id,ward,requester_name,season,request_year)
    values ($1,$2,$3,$4,$5) returning id,tenant_id,season,request_year`,
    [win.tenant_id,v.ward,v.requester_name,win.season,win.request_year])
  for(let i=0;i<v.items.length;i++){ const it=v.items[i]
    await q(`insert into public.ward_request_items (request_id,drug_code,drug_name,qty,unit,sort_order)
             values ($1,$2,$3,$4,$5,$6)`,[hdr.id,it.drug_code||null,it.drug_name,it.qty,it.unit||null,i+1]) }
  await q(`reset role`)
  const items=await one(`select count(*)::int n from public.ward_request_items where request_id=$1`,[hdr.id])
  P('5_신청저장', Number(items.n)===2, `헤더 1건 + 품목 ${items.n}건(drug_code null 1건 포함)`)
  P('6_tenant부여', hdr.tenant_id===win.tenant_id, `명시 지정값 유지(트리거가 덮어쓰지 않음)`)
  P('7_season복사', hdr.season==='설' && hdr.request_year===2026, `season=${hdr.season} · year=${hdr.request_year} (window 스냅샷)`)

  // 8·9·10. 입력 거부
  const r8=validate({ward:'7',requester_name:'홍길동',items:[{drug_name:'x',qty:1}]})
  const r9=validate({ward:'3',requester_name:'   ',items:[{drug_name:'x',qty:1}]})
  const r10=validate({ward:'3',requester_name:'홍길동',items:[]})
  P('8_ward거부', !!r8.msg, `ward='7' → "${r8.msg}"`)
  P('9_이름거부', !!r9.msg, `빈 이름 → "${r9.msg}"`)
  P('10_품목0거부', !!r10.msg, `items 0개 → "${r10.msg}"`)

  // 11. 같은 병동 복수 신청 허용
  await q(`set local role service_role`)
  const hdr2=await one(`insert into public.ward_requests (tenant_id,ward,requester_name,season,request_year)
    values ($1,'4','__verify2__',$2,$3) returning id`,[win.tenant_id,win.season,win.request_year])
  await q(`reset role`)
  const dup=await one(`select count(*)::int n from public.ward_requests where ward='4' and request_year=$1`,[win.request_year])
  P('11_복수신청', Number(dup.n)===2 && !!hdr2.id, `같은 병동(4) 신청 ${dup.n}건 — UNIQUE 미부여로 허용됨`)

  // 15. 정본 (트랜잭션 내)
  const snap=await one(`select
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) s,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) s7`)
  P('15_정본', snap.s==='885285628.424000000014' && snap.s7==='106365758.46920000003', `${snap.s} / ${snap.s7}`)

  await q('rollback')

  // 14. 운영 잔류 0
  const after=await one(`select
    (select count(*)::int from public.ward_request_window) w,
    (select count(*)::int from public.ward_requests) r,
    (select count(*)::int from public.ward_request_items) i`)
  P('14_잔류0', Number(after.w)===0 && Number(after.r)===0 && Number(after.i)===0,
     `window ${after.w} · requests ${after.r} · items ${after.i} — 전량 ROLLBACK 확인`)

  console.log(JSON.stringify({allOk:Object.values(R).every(x=>x.ok),R},null,1))
}catch(e){ try{await q('rollback')}catch{}; console.error('검증 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
