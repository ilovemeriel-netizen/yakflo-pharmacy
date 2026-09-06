// verify_0087.mjs — apply_0087 이후 운영 DB 검증. **읽기 전용(SELECT 만).**
// 지시하신 Stage 3 체크리스트 11항목을 그대로 검사한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { loadCsv, buildRows, STD_VERSION } from './barcode_rows_0087.mjs'

function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}

await c.connect()
try{
  await q('set session characteristics as transaction read only')   // ★ 쓰기 원천 차단

  /* 1. 적재 행수가 Stage 0 결정과 일치 — 스크립트가 산출한 수와 대조 */
  const csv=loadCsv()
  const drugs=(await q(`select drug_code, drug_name, insurance_code, status from public.drugs`)).rows
  const { rows: want }=buildRows(drugs,csv,'x')
  const n=(await one(`select count(*)::int n from public.drug_barcodes`)).n
  P('1 적재 행수', n===want.length, `DB ${n.toLocaleString()} · 산출 ${want.length.toLocaleString()}`)

  /* 2. gtin 전량 14자리 · 좌측 0 시작 (GS1 한정) */
  const f=await one(`select
    count(*) filter (where code_type='GS1')::int gs1,
    count(*) filter (where code_type='GS1' and code ~ '^[0-9]{14}$')::int fmt,
    count(*) filter (where code_type='GS1' and left(code,1)='0')::int zero from public.drug_barcodes`)
  P('2 코드 형식', f.gs1===f.fmt && f.gs1===f.zero, `GS1 ${f.gs1} · 14자리 ${f.fmt} · 0 시작 ${f.zero}`)

  /* 3. unique 위반 0건 */
  const u=(await one(`select count(*)::int n from (
    select tenant_id, code from public.drug_barcodes where is_active group by 1,2 having count(*)>1) x`)).n
  P('3 unique 위반', u===0, `중복 ${u}건`)

  /* 4. is_rep=true 행의 pack_type·pack_qty 전량 NULL */
  const rep=await one(`select count(*) filter (where is_rep)::int rep,
    count(*) filter (where is_rep and (pack_type is not null or pack_qty is not null))::int bad
    from public.drug_barcodes`)
  P('4 대표행 규칙', rep.bad===0, `대표행 ${rep.rep} · 포장정보 있음 ${rep.bad}(0 기대)`)

  /* 5. 실물 2건 조회 성공 */
  const real=(await q(`select b.code, b.drug_code, d.drug_name, b.pack_type, b.pack_qty
    from public.drug_barcodes b left join public.drugs d on d.drug_code=b.drug_code
    where b.code in ('08806717068539','08806536030014') order by b.code`)).rows
  const a=real.find(x=>x.code==='08806717068539'), b=real.find(x=>x.code==='08806536030014')
  P('5 실물 2건',
    !!a && a.drug_code==='BTGR50' && a.pack_type==='병' && Number(a.pack_qty)===100 &&
    !!b && b.pack_type==='병' && Number(b.pack_qty)===1,
    real.map(x=>`${x.code}→${x.drug_code} ${x.drug_name} · ${x.pack_type} · ${x.pack_qty}`).join(' | ')||'조회 0건')

  /* 6. source 전량 '심평원' */
  const s=await one(`select count(*)::int n, count(*) filter (where source='심평원')::int ok,
    count(*) filter (where std_version=$1)::int ver from public.drug_barcodes`,[STD_VERSION])
  P('6 source·버전', s.n===s.ok && s.n===s.ver, `심평원 ${s.ok}/${s.n} · std_version ${s.ver}/${s.n}`)

  /* 7. RLS 활성 · DELETE 에 is_admin() */
  const rls=(await one(`select relrowsecurity ok from pg_class where relname='drug_barcodes'`)).ok
  const pol=(await q(`select policyname, cmd, qual from pg_policies where schemaname='public' and tablename='drug_barcodes'`)).rows
  const del=pol.find(p=>p.cmd==='DELETE')
  P('7 RLS·정책', rls===true && pol.length===4 && !!del && /is_admin/.test(del.qual||''),
    `RLS ${rls?'on':'OFF'} · 정책 ${pol.length}/4 · DELETE is_admin ${del&&/is_admin/.test(del.qual||'')?'있음':'없음'}`)

  /* 8. 함수·트리거 존재 */
  const fn=(await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in ('norm_barcode','gtin_check_ok','trg_drug_barcodes_norm')`)).n
  const tg=(await one(`select count(*)::int n from pg_trigger where tgname='drug_barcodes_norm' and not tgisinternal`)).n
  P('8 함수·트리거', fn===3 && tg===1, `함수 ${fn}/3 · 트리거 ${tg}/1`)

  /* 9. 정규화 함수 동작 (읽기 전용에서도 호출 가능) */
  const nb=async(v,t)=>(await one(`select public.norm_barcode($1,$2) r`,[v,t])).r
  const e1=await nb('(01)08806717068539','GS1'), e2=await nb('8806717068539','GS1')
  const e3=await nb('88067170685','GS1'),        e4=await nb('  L-소분-01  ','자체')
  P('9 정규화 함수', e1==='08806717068539'&&e2==='08806717068539'&&e3===null&&e4==='L-소분-01',
    `(01)→${e1} · 13자리→${e2} · 11자리→${e3} · 자체→${e4}`)

  /* 10. 기존 무변동 */
  const k=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('10 기존 무변동',
    k.txs===1411 && k.drugs===1118 &&
    k.snap7.startsWith('885285628.424') && k.snap8.startsWith('101208155.9'),
    `거래 ${k.txs}/1411 · 약품 ${k.drugs}/1118 · 1~7월 ${k.snap7} · 8월 ${k.snap8}`)

  /* 11. 적재 내용 요약(참고) */
  const sum=await one(`select count(distinct drug_code)::int drugs,
    count(*) filter (where drug_code is null)::int hold,
    count(*) filter (where memo like '취소예정%')::int cancel,
    count(*) filter (where code_type='자체')::int own from public.drug_barcodes`)
  P('11 적재 요약', true, `연결 약품 ${sum.drugs} · drug_code 보류 ${sum.hold} · 취소예정 ${sum.cancel} · 자체번호 ${sum.own}`)

  console.log('─'.repeat(72))
  let pass=0, total=0
  for(const [key,v] of Object.entries(R)){ console.log(`${v.ok?'  PASS':'★ FAIL'}  ${key.padEnd(14)} ${v.d}`); if(v.ok)pass++; total++ }
  console.log('─'.repeat(72))
  console.log(`${pass}/${total} 통과`)
  process.exitCode = pass===total ? 0 : 1
}catch(e){ console.error('★ 실패:', e.message); process.exitCode=1 }
finally{ await c.end() }
