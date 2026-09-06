// dryrun_0087.mjs — drug_barcodes 테이블·함수·트리거·RLS 생성 + 심평원 적재 시뮬레이션.
// BEGIN → DDL → 적재 → 검증 → 전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
//
// ★ supabase db push 를 쓰지 않는 이유
//   supabase_migrations.schema_migrations 기록이 0건인데 로컬 파일은 89건이다.
//   CLI 로 push 하면 0000_baseline 부터 전부 재적용하려 든다 — 운영 파괴.
//   이 저장소는 0083·0084·0085·0086 모두 이 스크립트 패턴으로 적용해 왔다.
//
// A.구조 B.제약 C.인덱스 D.RLS·정책 E.정규화 함수 F.트리거 동작
// G.적재 시뮬레이션 H.실물 2건 I.대표행 규칙 J.기존 무변동 K.ROLLBACK 무잔류
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { loadCsv, buildRows, scopeStats, STD_VERSION } from './barcode_rows_0087.mjs'

function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]

/* 파일이 자체 begin/commit 을 갖고 있다 — 제거하고 우리 트랜잭션으로 감싼다 */
const ddl=readFileSync('supabase/migrations/0087_drug_barcodes.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')

const T='5e0aa267-cf21-4227-af97-a27b32b04c07'
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}

await c.connect()
try{
  /* ── 사전 상태 ─────────────────────────────────────────────── */
  const pre=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  console.log(`사전 — 테이블 ${pre.tables} · 정책 ${pre.policies} · 거래 ${pre.txs} · 약품 ${pre.drugs}`)
  console.log(`      1~7월 정본 ${pre.snap7} · 8월 ${pre.snap8}\n`)

  /* ── CSV 적재 (메모리) ─────────────────────────────────────── */
  console.time('CSV 로드')
  const csv=loadCsv()
  console.timeEnd('CSV 로드')
  const drugs=(await q(`select drug_code, drug_name, insurance_code, status from public.drugs`)).rows
  const sc=scopeStats(drugs,csv)
  console.log(`CSV ${sc.csvRows.toLocaleString()}행 · 제품코드 보유 ${sc.prodRows.toLocaleString()}행 · 원내 매칭 ${sc.matched.toLocaleString()}행\n`)

  const { rows, skip, stat }=buildRows(drugs,csv,T)

  await q('begin')
  await q(ddl)

  /* ── A. 구조 ───────────────────────────────────────────────── */
  const tb=(await one(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='drug_barcodes'`)).n
  const fn=(await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in ('norm_barcode','gtin_check_ok','trg_drug_barcodes_norm')`)).n
  const tg=(await one(`select count(*)::int n from pg_trigger where tgname='drug_barcodes_norm' and not tgisinternal`)).n
  P('A 구조', tb===1&&fn===3&&tg===1, `테이블 ${tb}/1 · 함수 ${fn}/3 · 트리거 ${tg}/1`)

  /* ── B. 제약 ───────────────────────────────────────────────── */
  const cons=(await q(`select con.conname from pg_constraint con join pg_class r on r.oid=con.conrelid
    where r.relname='drug_barcodes' and con.contype='c'`)).rows.map(x=>x.conname).sort()
  const want=['drug_barcodes_code_format','drug_barcodes_code_type_valid','drug_barcodes_rep_no_pack','drug_barcodes_source_valid']
  P('B 제약', want.every(w=>cons.includes(w)), `${cons.length}개 — ${cons.join(', ')}`)

  /* ── C. 인덱스 ─────────────────────────────────────────────── */
  const idx=(await q(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='drug_barcodes'`)).rows
  const uq=idx.find(i=>i.indexname==='drug_barcodes_code_uniq')
  P('C 인덱스', idx.length>=4 && !!uq && /UNIQUE/i.test(uq.indexdef) && /is_active/.test(uq.indexdef),
    `${idx.length}개 · unique(tenant_id,code) where is_active ${uq?'있음':'없음'}`)

  /* ── D. RLS·정책 ───────────────────────────────────────────── */
  const rls=(await one(`select relrowsecurity ok from pg_class where relname='drug_barcodes'`)).ok
  const pol=(await q(`select policyname, cmd, qual from pg_policies where schemaname='public' and tablename='drug_barcodes'`)).rows
  const del=pol.find(p=>p.cmd==='DELETE')
  P('D RLS·정책', rls===true && pol.length===4 && !!del && /is_admin/.test(del.qual||''),
    `RLS ${rls?'on':'OFF'} · 정책 ${pol.length}/4 · DELETE is_admin() ${del&&/is_admin/.test(del.qual||'')?'있음':'없음'}`)

  /* ── E. 정규화 함수 — 케이스별 ─────────────────────────────── */
  const nb=async(v,t)=>(await one(`select public.norm_barcode($1,$2) r`,[v,t])).r
  const eCase=[
    ['(01)08806717068539','GS1','08806717068539'],   // AI 접두 — 01 이 숫자에 섞이면 안 됨
    ['08806717068539',    'GS1','08806717068539'],   // 14자리 그대로
    ['8806717068539',     'GS1','08806717068539'],   // 13자리 → 좌측 0
    ['880671706853',      'GS1',null],               // 12자리는 UPC-A 규격 → lpad 대상
    ['88067170685',       'GS1',null],               // 11자리 = 규격 밖 → 거부
    ['  ABC-소분-01  ',   '자체','ABC-소분-01'],       // 자체는 btrim 만
    ['',                  '자체',null],
  ]
  eCase[3][2]='00880671706853'                        // 12자리는 허용 길이 → lpad
  const eRes=[]; for(const [v,t,exp] of eCase){ const got=await nb(v,t); eRes.push({v,t,exp,got,ok:got===exp}) }
  P('E 정규화 함수', eRes.every(x=>x.ok),
    eRes.map(x=>`${x.ok?'O':'X'} ${JSON.stringify(x.v)}/${x.t}→${x.got===null?'null':x.got}`).join(' · '))

  /* ── F. 트리거 동작 — 13자리 입력이 14자리로 저장되는가 / 오타 거부 ──
        ★ 실재 코드를 쓰면 이미 적재된 행과 unique 가 부딪친다. 시험용 코드를 쓴다. */
  const PROBE='9999999999996', PROBE14='09999999999996'
  await q(`insert into public.drug_barcodes (tenant_id,code,code_type,source,memo) values ($1,$2,'GS1','학습','dryrun probe')`,[T,PROBE])
  const f1=(await one(`select code from public.drug_barcodes where memo='dryrun probe'`)).code
  let f2='(예외 안 남)'
  try{ await q(`savepoint s1`); await q(`insert into public.drug_barcodes (tenant_id,code,code_type,source,memo) values ($1,'88067170685','GS1','학습','dryrun probe')`,[T]); await q(`release savepoint s1`) }
  catch(e){ f2=e.code; await q(`rollback to savepoint s1`) }
  await q(`delete from public.drug_barcodes where memo='dryrun probe'`)
  P('F 트리거', f1===PROBE14 && f2==='23514',
    `13자리 입력 → 저장 ${f1} · 11자리 오타 → errcode ${f2}(23514 기대)`)

  /* ── G. 적재 시뮬레이션 — ★ 증분. 이미 있는 code 는 넣지 않는다.
        최초 적용에서는 기존 0행이라 전량 적재와 같고, 재적용·월 갱신에서는
        새 코드만 들어간다. 전량 재적재는 unique 위반이 된다. ───────── */
  const have=new Set((await q(`select code from public.drug_barcodes`)).rows.map(r=>r.code))
  const fresh=rows.filter(r=>!have.has(r.code))
  console.log(`증분 — 기존 ${have.size.toLocaleString()}행 · 산출 ${rows.length.toLocaleString()}행 · 신규 ${fresh.length.toLocaleString()}행`)

  const COLS=['tenant_id','code','code_type','drug_code','insurance_code','product_name','pack_type','pack_qty','is_rep','source','std_version','memo']
  const CH=500
  for(let s=0;s<fresh.length;s+=CH){
    const part=fresh.slice(s,s+CH)
    const vals=[]; const ph=part.map((r,i)=>{
      const base=i*COLS.length
      COLS.forEach(cn=>vals.push(r[cn]))
      return '('+COLS.map((_,j)=>'$'+(base+j+1)).join(',')+')'
    }).join(',')
    await q(`insert into public.drug_barcodes (${COLS.join(',')}) values ${ph}`, vals)
  }
  const g=await one(`select count(*)::int n,
    count(*) filter (where code ~ '^[0-9]{14}$')::int fmt,
    count(*) filter (where left(code,1)='0')::int zero,
    count(*) filter (where source='심평원')::int src,
    count(*) filter (where code_type='GS1')::int gs1,
    count(*) filter (where is_rep)::int rep,
    count(*) filter (where drug_code is null)::int nodrug,
    count(distinct drug_code)::int drugs
    from public.drug_barcodes`)
  P('G 적재', g.n===rows.length && g.fmt===g.n && g.zero===g.n && g.src===g.n && g.gs1===g.n,
    `${g.n.toLocaleString()}행(기존 ${have.size}+신규 ${fresh.length}) · 14자리 ${g.fmt} · 0 시작 ${g.zero} · 심평원 ${g.src} · GS1 ${g.gs1} · 대표행 ${g.rep} · drug_code 보류 ${g.nodrug} · 연결약품 ${g.drugs}`)

  /* ── H. 실물 2건 ───────────────────────────────────────────── */
  const real=(await q(`select b.code, b.drug_code, d.drug_name, b.pack_type, b.pack_qty, b.is_rep, b.product_name
    from public.drug_barcodes b left join public.drugs d on d.drug_code=b.drug_code
    where b.code in ('08806717068539','08806536030014') order by b.code`)).rows
  const r1=real.find(x=>x.code==='08806717068539'), r2=real.find(x=>x.code==='08806536030014')
  P('H 실물 2건', !!r1 && !!r2 && r1.drug_code==='BTGR50' && Number(r1.pack_qty)===100,
    real.length? real.map(x=>`${x.code}→${x.drug_code||'(보류)'} ${x.drug_name||x.product_name} · ${x.pack_type||'-'} · ${x.pack_qty??'-'}`).join(' | ') : '조회 0건')

  /* ── I. 대표행 규칙 ────────────────────────────────────────── */
  const rep=await one(`select
    count(*) filter (where is_rep and (pack_type is not null or pack_qty is not null))::int bad,
    count(*) filter (where not is_rep and pack_type is null)::int nopack from public.drug_barcodes`)
  P('I 대표행 규칙', rep.bad===0, `대표행에 포장정보 있음 ${rep.bad}건(0 기대) · 포장행인데 포장형태 없음 ${rep.nopack}건`)

  /* ── J. 기존 무변동 ────────────────────────────────────────── */
  const post=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('J 기존 무변동', post.txs===pre.txs&&post.drugs===pre.drugs&&post.snap7===pre.snap7&&post.snap8===pre.snap8,
    `거래 ${post.txs} · 약품 ${post.drugs} · 1~7월 ${post.snap7} · 8월 ${post.snap8}`)

  await q('rollback')

  /* ── K. ROLLBACK 무잔류 ──────────────────────────────────────
        ★ 「테이블이 0개로 돌아왔는가」가 아니라 「사전 상태 그대로인가」를 본다.
          최초 적용 전에는 테이블이 없으니 0 이지만, 이미 적용된 뒤 재실행하면
          테이블·함수가 남아 있는 것이 정상이다. 판정 기준은 사전 상태 대조다.
          핵심은 drug_barcodes 행수가 늘지 않았는가이다. */
  const left=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.drug_barcodes) bc`)
  P('K ROLLBACK 무잔류', left.tables===pre.tables&&left.policies===pre.policies&&left.bc===have.size,
    `전체 테이블 ${left.tables}(사전 ${pre.tables}) · 정책 ${left.policies}(사전 ${pre.policies}) · drug_barcodes ${left.bc}행(사전 ${have.size}행)`)

  /* ── 결과 ──────────────────────────────────────────────────── */
  console.log('\n건너뜀 — ' + Object.entries(skip).map(([k,v])=>`${k} ${v.toLocaleString()}`).join(' · '))
  console.log('부가   — ' + Object.entries(stat).map(([k,v])=>`${k} ${v.toLocaleString()}`).join(' · '))
  console.log('\n' + '─'.repeat(72))
  let pass=0
  for(const [k,v] of Object.entries(R)){ console.log(`${v.ok?'  PASS':'★ FAIL'}  ${k.padEnd(16)} ${v.d}`); if(v.ok)pass++ }
  console.log('─'.repeat(72))
  console.log(`${pass}/${Object.keys(R).length} 통과 · 신규 적재 ${fresh.length.toLocaleString()}행(총 ${rows.length.toLocaleString()}행) · 커밋 없음(ROLLBACK 완료)`)
  process.exitCode = pass===Object.keys(R).length ? 0 : 1
}catch(e){
  try{ await q('rollback') }catch{}
  console.error('★ 실패:', e.message)
  process.exitCode=1
}finally{ await c.end() }
