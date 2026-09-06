// apply_0089.mjs — 백신 모듈(0089) 운영 적용. **COMMIT 한다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 90건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ 반드시 dryrun_0089.mjs 가 28/28 통과한 뒤에 실행한다.
// ★ 0089 SQL 은 dryrun 통과본 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ 실패하면 자동 ROLLBACK 하고 즉시 중단한다. 임의 보정하지 않는다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]

const ddl=readFileSync('supabase/migrations/0089_vaccine_module.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const TBL=['vaccine_accounts','vaccine_categories','vaccine_events']

/* ★ information_schema.tables 는 **뷰도 센다**(실측: BASE TABLE 43 + VIEW 4 = 47).
   0089 는 테이블 3 + 뷰 1 을 만들므로 tables 는 +4 가 되고 47 → 51 이 된다.
   지시서의 「47→50(신규 3)」은 뷰 1개를 빼먹은 수치다 — 게이트는 실측 기준으로 둔다.
   BASE TABLE 과 VIEW 를 따로 세어 각각 +3 / +1 을 확인한다. */
const snap=async()=>one(`select
  (select count(*)::int from information_schema.tables where table_schema='public') tables,
  (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') basetables,
  (select count(*)::int from information_schema.views  where table_schema='public') views,
  (select count(*)::int from pg_policies where schemaname='public') policies,
  (select count(*)::int from public.transactions) txs,
  (select count(*)::int from public.drugs) drugs,
  (select count(*)::int from public.drug_barcodes) barcodes,
  (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
  (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)

const t0=Date.now()
await c.connect()
try{
  /* 재실행 방지 — 이미 적용됐으면 멈춘다 */
  const ex=(await one(`select count(*)::int n from information_schema.tables
    where table_schema='public' and table_name = any($1)`,[TBL])).n
  if(ex>0){ console.error(`★ 중단 — vaccine_* 테이블이 이미 ${ex}개 있습니다. 재적용하지 않습니다.`); process.exitCode=1; await c.end(); process.exit() }

  const pre=await snap()
  console.log(`사전 — BASE TABLE ${pre.basetables} · 뷰 ${pre.views} (tables 합계 ${pre.tables}) · 정책 ${pre.policies}`)
  console.log(`      거래 ${pre.txs} · 약품 ${pre.drugs} · 바코드 ${pre.barcodes}`)
  console.log(`      1~7월 ${pre.snap7} · 8월 ${pre.snap8}\n`)

  await q('begin')
  await q(ddl)

  /* ── 커밋 직전 게이트 — 하나라도 어긋나면 ROLLBACK ── */
  const tb=(await q(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,[TBL])).rows.length
  const vw=(await q(`select table_name from information_schema.views where table_schema='public' and table_name='v_vaccine_balance'`)).rows.length
  const pol=(await q(`select policyname from pg_policies where schemaname='public' and tablename = any($1)`,[TBL])).rows.length
  const trg=(await q(`select t.tgname from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname = any($1) and not t.tgisinternal`,[TBL])).rows.length
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and indexname like 'vaccine_%_idx'`)).rows.length
  const chk=(await q(`select con.conname from pg_constraint con join pg_class r on r.oid=con.conrelid
    where r.relname = any($1) and con.contype='c'`,[TBL])).rows.length
  const si=(await one(`select c2.reloptions::text o from pg_class c2 join pg_namespace n on n.oid=c2.relnamespace
    where n.nspname='public' and c2.relname='v_vaccine_balance'`)).o || ''
  const an=(await q(`select table_name from information_schema.role_table_grants
    where table_schema='public' and grantee='anon' and (table_name = any($1) or table_name='v_vaccine_balance')`,[TBL])).rows.length
  const post=await snap()

  const gate=[
    ['테이블 3',        tb===3,                                    `${tb}/3`],
    ['뷰 1',            vw===1,                                    `${vw}/1`],
    ['정책 12',         pol===12,                                  `${pol}/12`],
    ['트리거 4',        trg===4,                                   `${trg}/4`],
    ['인덱스 5',        idx===5,                                   `${idx}/5`],
    ['CHECK 6',         chk===6,                                   `${chk}/6`],
    ['security_invoker', /security_invoker=(true|on)/i.test(si),   si || '(없음)'],
    ['★ anon 권한 0',   an===0,                                    `${an}건`],
    ['거래 무변동',     post.txs===pre.txs,                        `${post.txs}`],
    ['약품 무변동',     post.drugs===pre.drugs,                    `${post.drugs}`],
    ['바코드 무변동',   post.barcodes===pre.barcodes,              `${post.barcodes}`],
    ['1~7월 정본',      post.snap7===pre.snap7,                    post.snap7],
    ['8월 정본',        post.snap8===pre.snap8,                    post.snap8],
    ['BASE TABLE +3',   post.basetables===pre.basetables+3,        `${pre.basetables} → ${post.basetables}`],
    ['VIEW +1',         post.views===pre.views+1,                  `${pre.views} → ${post.views}`],
    ['tables 합계 +4',  post.tables===pre.tables+4,                `${pre.tables} → ${post.tables} (뷰 포함)`],
    ['정책 +12',        post.policies===pre.policies+12,           `${pre.policies} → ${post.policies}`],
  ]
  const bad=gate.filter(x=>!x[1])
  gate.forEach(([k,ok,d])=>console.log(`  ${ok?'OK  ':'★ NG'} ${k.padEnd(18)} ${d}`))

  if(bad.length){
    await q('rollback')
    console.error(`\n★ ROLLBACK 완료 — ${bad.map(x=>x[0]).join(', ')} 실패. 임의 수정하지 않고 중단합니다.`)
    process.exitCode=1
  } else {
    await q('commit')
    console.log(`\n커밋 완료 — vaccine_accounts · vaccine_categories · vaccine_events · v_vaccine_balance`)
    console.log(`소요 ${((Date.now()-t0)/1000).toFixed(2)}초`)
  }
}catch(e){
  try{ await q('rollback'); console.error('\n★ ROLLBACK 완료') }catch{ console.error('\n★ ROLLBACK 시도 실패') }
  console.error('★ 적용 실패:', e.message)
  process.exitCode=1
}finally{ await c.end() }
