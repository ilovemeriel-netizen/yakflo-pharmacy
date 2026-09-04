// verify_0086.mjs — apply 후 운영 검증(읽기 전용 + savepoint 로 되돌리는 적재 테스트).
// 구조 · RLS · 권한 · enabled 게이트 · 함수 실행(7·8월) · 통지 분리 · 적재 · 기존 무변동 · 정본.
// ★ close_monitor_alerts 에 남는 데이터가 없도록 적재 테스트는 savepoint 로 되돌린다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const T='5e0aa267-cf21-4227-af97-a27b32b04c07'
const TBL=['close_monitor_alerts','close_monitor_thresholds']
const VW=['v_close_chain','v_close_stock_flow','v_stock_dual_check','v_close_table_health']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  // 1) 구조
  const t=(await q(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,[TBL])).rows.length
  const v=(await q(`select table_name from information_schema.views  where table_schema='public' and table_name = any($1)`,[VW])).rows.length
  const thr=(await one(`select count(*)::int n from public.close_monitor_thresholds`)).n
  P('1 구조', t===2 && v===4 && thr===17, `테이블 ${t}/2 · 뷰 ${v}/4 · 임계값 ${thr}/17`)

  // 2) 폐기 항목 부재
  const gone=(await one(`select count(*)::int n from public.close_monitor_thresholds
    where check_code in ('ROLLFORWARD_DIFF','INDEX_UNUSED','USAGE_MANUAL_STALE')`)).n
  const rfv=(await one(`select count(*)::int n from information_schema.views where table_schema='public' and table_name='v_close_rollforward'`)).n
  P('2 폐기 확인', gone===0 && rfv===0, `폐기 seed ${gone}건 · v_close_rollforward ${rfv}건`)

  // 3) RLS · INSERT/DELETE 정책 부재
  const rls=(await q(`select relname, relrowsecurity from pg_class where relname = any($1)`,[TBL])).rows
  const pol=(await q(`select tablename, cmd from pg_policies where schemaname='public' and tablename = any($1)`,[TBL])).rows
  const idp=pol.filter(p=>p.tablename==='close_monitor_alerts' && ['INSERT','DELETE'].includes(p.cmd)).length
  P('3 RLS·정책', rls.every(r=>r.relrowsecurity) && idp===0,
    `RLS ${rls.map(r=>r.relname.replace('close_monitor_','')+':'+(r.relrowsecurity?'on':'OFF')).join(' ')} · alerts INSERT/DELETE 정책 ${idp}건`)

  // 4) EXECUTE 권한
  const ex=Object.fromEntries((await q(`select r.rolname, has_function_privilege(r.rolname,'public.run_close_monitor(uuid,text,boolean)','execute') ok
    from pg_roles r where r.rolname in ('anon','authenticated','service_role')`)).rows.map(r=>[r.rolname,r.ok]))
  P('4 EXECUTE', ex.service_role===true && ex.anon===false && ex.authenticated===false,
    `service_role ${ex.service_role} · anon ${ex.anon} · authenticated ${ex.authenticated}`)

  await q('begin')

  // 5) enabled 게이트
  await q('savepoint sp5')
  const before=(await q(`select check_code from public.run_close_monitor($1,'2026-08',false)`,[T])).rows.map(r=>r.check_code)
  await q(`update public.close_monitor_thresholds set enabled=false where check_code='SNAPSHOT_CHAIN_BREAK'`)
  const after=(await q(`select check_code from public.run_close_monitor($1,'2026-08',false)`,[T])).rows.map(r=>r.check_code)
  P('5 enabled 게이트', before.includes('SNAPSHOT_CHAIN_BREAK') && !after.includes('SNAPSHOT_CHAIN_BREAK'),
    `켜짐 검출=${before.includes('SNAPSHOT_CHAIN_BREAK')} · 꺼짐 미검출=${!after.includes('SNAPSHOT_CHAIN_BREAK')}`)
  await q('rollback to savepoint sp5')

  // 6) 함수 실행 7·8월
  const runs={}
  for(const per of ['2026-07','2026-08'])
    runs[per]=(await q(`select check_code, severity, hit_count, detail from public.run_close_monitor($1,$2,false)`,[T,per])).rows
  const cb8=runs['2026-08'].find(r=>r.check_code==='SNAPSHOT_CHAIN_BREAK')
  const cb7=runs['2026-07'].find(r=>r.check_code==='SNAPSHOT_CHAIN_BREAK')
  P('6 CHAIN_BREAK 기대값', Number(cb7?.hit_count)===53 && Number(cb8?.hit_count)===47,
    `7월 ${cb7?cb7.hit_count:0}종(기대 53) · 8월 ${cb8?cb8.hit_count:0}종(기대 47)`)
  const sf8=runs['2026-08'].find(r=>r.check_code==='STOCK_FLOW_DIFF')
  P('6-2 STOCK_FLOW_DIFF', Number(sf8?.hit_count||0)<=12, `8월 ${sf8?sf8.hit_count:0}건 (기대 12 이하)`)

  // 7) 통지 분리 — INFO 가 CRITICAL/HIGH 에 섞이지 않는가
  const notify=runs['2026-08'].filter(r=>['CRITICAL','HIGH'].includes(r.severity)).map(r=>r.check_code)
  const info  =runs['2026-08'].filter(r=>r.severity==='INFO').map(r=>r.check_code)
  const leak=notify.filter(x=>['LEDGER_DIVERGENCE','QTY_CHANGE_DIRECT'].includes(x))
  P('7 통지 분리', leak.length===0,
    `통지대상 ${notify.length}종(${notify.join(',')}) · INFO ${info.length}종(${info.join(',')}) · 누출 ${leak.length}건`)

  // 8) 적재 동작 (savepoint 로 되돌린다)
  await q('savepoint sp8')
  await q(`select * from public.run_close_monitor($1,'2026-08',true)`,[T])
  const ins=await one(`select count(*)::int n,
      count(*) filter (where severity='INFO')::int info,
      count(*) filter (where severity in ('CRITICAL','HIGH'))::int notify,
      count(*) filter (where notified_at is not null)::int notified
    from public.close_monitor_alerts`)
  P('8 적재 동작', ins.n>0 && ins.notified===0,
    `적재 ${ins.n}행 (통지대상 ${ins.notify} · INFO ${ins.info}) · notified_at 기록 ${ins.notified}건(Function 전이므로 0이 정상)`)
  await q('rollback to savepoint sp8')

  await q('rollback')

  // 9) 기존 무변동 · 정본 · 잔류
  const fin=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select count(*)::int from public.close_monitor_alerts) alerts,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('9 기존 무변동', fin.txs===1409 && fin.drugs===1118, `거래 ${fin.txs} · 약품 ${fin.drugs}`)
  P('10 정본 무변동', fin.snap==='885285628.424000000014', `1~7월 ${fin.snap} · 8월 ${fin.snap8}`)
  P('11 잔류 0', fin.alerts===0, `close_monitor_alerts ${fin.alerts}행 (테스트 무잔류)`)

  console.log('=== verify 0086 결과 ===')
  let ng=0
  for(const [k,x] of Object.entries(R)){ if(!x.ok) ng++; console.log(`  ${x.ok?'OK  ':'FAIL'} ${k.padEnd(22)} ${x.d}`) }
  console.log(ng?`\n■ 실패 ${ng}건`:`\n■ 전부 통과(${Object.keys(R).length}/${Object.keys(R).length}).`)
  process.exitCode=ng?1:0
}catch(e){ try{await q('rollback')}catch{}; console.error('verify 오류:', e.message); process.exitCode=1 }
finally{ await c.end() }
