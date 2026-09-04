// dryrun_0086.mjs — close_monitor_alerts / _thresholds + 뷰 3 + run_close_monitor 생성 dryrun.
// BEGIN→DDL→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
//
// ★ supabase db push 를 쓰지 않는 이유
//   supabase_migrations.schema_migrations 기록이 0건인데 로컬 파일은 89건이다.
//   CLI 로 push 하면 0000_baseline 부터 전부 재적용하려 든다 — 운영 파괴.
//   이 저장소는 0083·0084·0085 모두 이 스크립트 패턴으로 적용해 왔다.
//
// A.구조 B.RLS·정책 C.GRANT·EXECUTE D.enabled 게이트 E.함수 실행(7·8월)
// F.적재 억제(persist=false) G.기존 무변동 H.정본 무변동 I.ROLLBACK 무잔류
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
/* 파일이 자체 begin/commit 을 갖고 있다 — 제거하고 우리 트랜잭션으로 감싼다 */
const ddl=readFileSync('supabase/migrations/0086_close_monitor.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const T='5e0aa267-cf21-4227-af97-a27b32b04c07'
const TBL=['close_monitor_alerts','close_monitor_thresholds']
const VW=['v_close_chain','v_close_stock_flow','v_stock_dual_check','v_close_table_health']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  const pre=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from information_schema.views  where table_schema='public') views,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  console.log(`사전 — 테이블 ${pre.tables} · 뷰 ${pre.views} · 정책 ${pre.policies} · 거래 ${pre.txs} · 약품 ${pre.drugs}`)
  console.log(`      1~7월 정본 ${pre.snap}\n`)

  await q('begin')
  await q(ddl)

  /* A. 구조 */
  const t=(await q(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,[TBL])).rows.length
  const v=(await q(`select table_name from information_schema.views where table_schema='public' and table_name = any($1)`,[VW])).rows.length
  const thr=(await one(`select count(*)::int n from public.close_monitor_thresholds`)).n
  P('A 구조', t===2 && v===4 && thr===17, `테이블 ${t}/2 · 뷰 ${v}/4 · 임계값 ${thr}/17`)

  /* A-2. 폐기 항목 부재 */
  const gone=(await one(`select count(*)::int n from public.close_monitor_thresholds where check_code in ('ROLLFORWARD_DIFF','INDEX_UNUSED','USAGE_MANUAL_STALE')`)).n
  const rfView=(await one(`select count(*)::int n from information_schema.views where table_schema='public' and table_name='v_close_rollforward'`)).n
  P('A-2 폐기 확인', gone===0 && rfView===0, `폐기 seed ${gone}건 · v_close_rollforward ${rfView}건 (둘 다 0이어야 정상)`)

  /* B. RLS·정책 */
  const rls=(await q(`select relname, relrowsecurity from pg_class where relname = any($1)`,[TBL])).rows
  const pol=(await q(`select tablename, cmd from pg_policies where schemaname='public' and tablename = any($1)`,[TBL])).rows
  const ins=pol.filter(p=>p.tablename==='close_monitor_alerts'&&['INSERT','DELETE'].includes(p.cmd)).length
  P('B RLS·정책', rls.every(r=>r.relrowsecurity) && ins===0,
    `RLS ${rls.map(r=>r.relname.replace('close_monitor_','')+':'+(r.relrowsecurity?'on':'OFF')).join(' ')} · alerts INSERT/DELETE 정책 ${ins}건(0이어야 service_role 전용)`)

  /* C. EXECUTE 권한 */
  const ex=(await q(`select r.rolname, has_function_privilege(r.rolname,'public.run_close_monitor(uuid,text,boolean)','execute') ok
    from pg_roles r where r.rolname in ('anon','authenticated','service_role')`)).rows
  const m=Object.fromEntries(ex.map(r=>[r.rolname,r.ok]))
  P('C EXECUTE', m.service_role===true && m.anon===false && m.authenticated===false,
    `service_role ${m.service_role} · anon ${m.anon} · authenticated ${m.authenticated}`)

  /* D. enabled 게이트 — 하나를 끄면 결과에서 사라지는가 */
  await q('savepoint sp_d')
  const onBefore=(await q(`select * from public.run_close_monitor($1,'2026-08',false)`,[T])).rows
  await q(`update public.close_monitor_thresholds set enabled=false where check_code='SNAPSHOT_CHAIN_BREAK'`)
  const onAfter=(await q(`select * from public.run_close_monitor($1,'2026-08',false)`,[T])).rows
  const had=onBefore.some(r=>r.check_code==='SNAPSHOT_CHAIN_BREAK')
  const gone2=!onAfter.some(r=>r.check_code==='SNAPSHOT_CHAIN_BREAK')
  P('D enabled 게이트', had && gone2, `켰을 때 검출=${had} · 껐을 때 미검출=${gone2}`)
  await q('rollback to savepoint sp_d')

  /* E. 함수 실행 — 7월·8월 */
  const runs={}
  for(const per of ['2026-07','2026-08']){
    runs[per]=(await q(`select check_code, severity, category, hit_count, title from public.run_close_monitor($1,$2,false)`,[T,per])).rows
  }
  console.log('■ Stage 3 미리보기 — run_close_monitor dryrun (persist=false)\n')
  const codes=[...new Set([...runs['2026-07'],...runs['2026-08']].map(r=>r.check_code))].sort()
  const sev={}; [...runs['2026-07'],...runs['2026-08']].forEach(r=>{sev[r.check_code]=r.severity})
  console.log('  check_code                severity   2026-07   2026-08')
  for(const cc of codes){
    const a=runs['2026-07'].find(r=>r.check_code===cc), b=runs['2026-08'].find(r=>r.check_code===cc)
    console.log(`  ${cc.padEnd(24)} ${String(sev[cc]).padEnd(10)} ${String(a?a.hit_count:0).padStart(7)}   ${String(b?b.hit_count:0).padStart(7)}`)
  }
  P('E 함수 실행', true, `7월 ${runs['2026-07'].length}종 · 8월 ${runs['2026-08'].length}종 검출`)

  /* E-2. 통지 대상 분리 */
  const notify8=runs['2026-08'].filter(r=>['CRITICAL','HIGH'].includes(r.severity)).map(r=>r.check_code)
  const info8=runs['2026-08'].filter(r=>r.severity==='INFO').map(r=>r.check_code)
  const leak=notify8.filter(x=>['LEDGER_DIVERGENCE','QTY_CHANGE_DIRECT'].includes(x))
  P('E-2 통지 분리', leak.length===0,
    `통지대상(CRITICAL·HIGH) ${notify8.length}종 · INFO ${info8.length}종(${info8.join(',')}) · INFO 누출 ${leak.length}건`)

  /* F. persist=false 는 적재하지 않는다 */
  const cnt=(await one(`select count(*)::int n from public.close_monitor_alerts`)).n
  P('F 적재 억제', cnt===0, `close_monitor_alerts ${cnt}행 (persist=false 이므로 0이어야 정상)`)

  /* G·H. 기존 무변동 */
  const mid=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  P('G 기존 무변동', mid.txs===pre.txs && mid.drugs===pre.drugs, `거래 ${pre.txs}→${mid.txs} · 약품 ${pre.drugs}→${mid.drugs}`)
  P('H 정본 무변동', mid.snap===pre.snap, `1~7월 ${mid.snap}`)

  await q('rollback')

  const post=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from information_schema.views  where table_schema='public') views,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.transactions) txs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  P('I ROLLBACK 무잔류', post.tables===pre.tables && post.views===pre.views && post.policies===pre.policies
      && post.txs===pre.txs && post.snap===pre.snap,
    `테이블 ${post.tables} · 뷰 ${post.views} · 정책 ${post.policies} · 거래 ${post.txs}`)

  console.log('\n=== dryrun 0086 결과 ===')
  let ng=0
  for(const [k,vv] of Object.entries(R)){ if(!vv.ok) ng++; console.log(`  ${vv.ok?'OK  ':'FAIL'} ${k.padEnd(18)} ${vv.d}`) }
  console.log(ng ? `\n■ 실패 ${ng}건 — apply 금지.` : `\n■ 전부 통과(${Object.keys(R).length}/${Object.keys(R).length}). 운영 무잔류. 승인 시 apply 가능.`)
  process.exitCode = ng ? 1 : 0
}catch(e){ try{await q('rollback')}catch{}; console.error('dryrun 오류:', e.message); if(e.position) console.error('  position:', e.position); process.exitCode=1 }
finally{ await c.end() }
