// apply_0087.mjs — 0087_drug_barcodes.sql 적용 + 심평원 표준코드 적재. **COMMIT 한다.**
//
// ★ supabase db push 를 쓰지 않는다(0083~0086 과 동일한 이유는 dryrun_0087 헤더 참조).
// ★ 반드시 dryrun_0087.mjs 가 11/11 통과한 뒤에 실행한다.
// ★ 적재 규칙은 barcode_rows_0087.mjs 한 곳에만 있다 — dryrun 과 같은 행을 넣는다.
//
// 재실행 안전장치
//   · drug_barcodes 가 이미 있고 행이 있으면 멈춘다(중복 적재 방지).
//   · DDL 은 create ... if not exists / create or replace 라 재적용에 안전하다.
//   · 커밋 직전에 핵심 검증을 다시 돌리고, 하나라도 어긋나면 ROLLBACK 한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { loadCsv, buildRows } from './barcode_rows_0087.mjs'

function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]

const ddl=readFileSync('supabase/migrations/0087_drug_barcodes.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const T='5e0aa267-cf21-4227-af97-a27b32b04c07'

await c.connect()
try{
  /* ── 증분 적재 ─────────────────────────────────────────────────
     ★ 재실행을 막지 않는다. 이미 있는 code 는 건너뛰고 새 코드만 넣는다.
       월 갱신(자료가 매월 바뀐다)이 같은 경로를 쓰므로 처음부터 증분이어야 한다.
     ★ source='학습' 행은 사람이 확정한 매핑이라 배치가 덮으면 안 된다.
       code 로 이미 존재하면 건너뛰므로 자연히 보호된다. */
  const ex=(await one(`select count(*)::int n from information_schema.tables
    where table_schema='public' and table_name='drug_barcodes'`)).n
  if(ex) console.log('· drug_barcodes 존재 — 증분 적재로 진행합니다.')

  const pre=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  console.log(`사전 — 거래 ${pre.txs} · 약품 ${pre.drugs} · 1~7월 ${pre.snap7} · 8월 ${pre.snap8}`)

  const csv=loadCsv()
  const drugs=(await q(`select drug_code, drug_name, insurance_code, status from public.drugs`)).rows
  const { rows, skip, stat }=buildRows(drugs,csv,T)
  console.log(`적재 예정 ${rows.length.toLocaleString()}행 (대표행 ${stat.대표행} · 포장행 ${stat.포장행} · 취소예정 ${stat.취소예정} · 중복보류 ${stat.중복보류})`)

  await q('begin')
  await q(ddl)

  const have=new Set((await q(`select code from public.drug_barcodes`)).rows.map(r=>r.code))
  const fresh=rows.filter(r=>!have.has(r.code))
  console.log(`증분 — 기존 ${have.size.toLocaleString()}행 · 신규 ${fresh.length.toLocaleString()}행`)

  const COLS=['tenant_id','code','code_type','drug_code','insurance_code','product_name','pack_type','pack_qty','is_rep','source','std_version','memo']
  const CH=500
  for(let s=0;s<fresh.length;s+=CH){
    const part=fresh.slice(s,s+CH); const vals=[]
    const ph=part.map((r,i)=>{ const base=i*COLS.length; COLS.forEach(cn=>vals.push(r[cn]))
      return '('+COLS.map((_,j)=>'$'+(base+j+1)).join(',')+')' }).join(',')
    await q(`insert into public.drug_barcodes (${COLS.join(',')}) values ${ph}`, vals)
  }

  /* ── 커밋 직전 검증 — 하나라도 어긋나면 ROLLBACK ───────────── */
  const g=await one(`select count(*)::int n,
    count(*) filter (where code ~ '^[0-9]{14}$')::int fmt,
    count(*) filter (where source='심평원')::int src,
    count(*) filter (where is_rep and (pack_type is not null or pack_qty is not null))::int repbad
    from public.drug_barcodes`)
  const real=(await q(`select code, drug_code, pack_qty from public.drug_barcodes
    where code in ('08806717068539','08806536030014')`)).rows
  const post=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)

  const gate=[
    ['적재 행수',   g.n===rows.length,                       `${g.n}/${rows.length} (기존 ${have.size}+신규 ${fresh.length})`],
    ['14자리 형식', g.fmt===g.n,                             `${g.fmt}/${g.n}`],
    ['source',      g.src===g.n,                             `${g.src}/${g.n}`],
    ['대표행 규칙', g.repbad===0,                            `위반 ${g.repbad}`],
    ['실물 2건',    real.length===2,                         `${real.length}/2`],
    ['거래 무변동', post.txs===pre.txs,                      `${post.txs}`],
    ['약품 무변동', post.drugs===pre.drugs,                  `${post.drugs}`],
    ['1~7월 정본',  post.snap7===pre.snap7,                  post.snap7],
    ['8월 정본',    post.snap8===pre.snap8,                  post.snap8],
  ]
  const bad=gate.filter(x=>!x[1])
  gate.forEach(([k,ok,d])=>console.log(`  ${ok?'OK  ':'★ NG'} ${k.padEnd(12)} ${d}`))
  if(bad.length){ await q('rollback'); console.error(`★ ROLLBACK — ${bad.map(x=>x[0]).join(', ')} 실패`); process.exitCode=1 }
  else { await q('commit'); console.log(`\n커밋 완료 — drug_barcodes ${g.n.toLocaleString()}행`) }
  console.log('건너뜀 — ' + Object.entries(skip).map(([k,v])=>`${k} ${v.toLocaleString()}`).join(' · '))
}catch(e){
  try{ await q('rollback') }catch{}
  console.error('★ 실패(ROLLBACK):', e.message)
  process.exitCode=1
}finally{ await c.end() }
