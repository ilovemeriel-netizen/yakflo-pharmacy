// dryrun_0089.mjs — 백신 모듈(vaccine_accounts·categories·events) 생성 dryrun.
// BEGIN → DDL → 검증 → ★ 전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
//
// ★ supabase db push 를 쓰지 않는 이유 — schema_migrations 0건 + 로컬 90건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
//
// ★ 결함 72 규약 — RLS 테이블 신설 시 `set local role authenticated` 조회를 반드시 넣는다.
//   0087 이 소유자(postgres)로만 검증해 11/11 을 통과시켰으나 브라우저에서 42501 로 막혔다.
//   소유자는 RLS·GRANT 를 모두 우회하므로 실사용 경로를 본 적이 없는 것과 같다.
//
// A.구조 B.제약 C.anon 권한 0 D.authenticated 동작 E.RESTRICT F.qty<>0 G.접종 카테고리 H.ROLLBACK
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]

/* 파일이 자체 begin/commit 을 갖고 있다 — 제거하고 우리 트랜잭션으로 감싼다 */
const ddl=readFileSync('supabase/migrations/0089_vaccine_module.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')

const T='5e0aa267-cf21-4227-af97-a27b32b04c07'
const TBL=['vaccine_accounts','vaccine_categories','vaccine_events']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}

/* 실패가 트랜잭션을 abort 시키지 않도록 savepoint 로 감싼다 */
async function probe(sql,args){
  await q('savepoint sp')
  try{ const r=await q(sql,args); await q('release savepoint sp'); return {ok:true,rows:r.rows,n:r.rowCount} }
  catch(e){ await q('rollback to savepoint sp'); return {ok:false,code:e.code,msg:(e.message||'').replace(/\s+/g,' ').slice(0,110)} }
}

await c.connect()
try{
  const pre=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  console.log(`사전 — 테이블 ${pre.tables} · 정책 ${pre.policies} · 거래 ${pre.txs} · 약품 ${pre.drugs}`)
  console.log(`      1~7월 ${pre.snap7} · 8월 ${pre.snap8}\n`)

  await q('begin')
  await q(ddl)

  /* ── A. 구조 ─────────────────────────────────────────────── */
  const tb=(await q(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,[TBL])).rows.length
  const pol=(await q(`select policyname from pg_policies where schemaname='public' and tablename = any($1)`,[TBL])).rows.length
  /* ★ 트리거는 4개다 — set_tenant_id 3개(계정·카테고리·원장) + append-only 가드 1개(원장).
     가드를 추가하기 전 기대값이 3이었는데, 고쳐야 하는 것은 코드가 아니라 이 기대값이다. */
  const trgs=(await q(`select cl.relname||'.'||t.tgname n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname = any($1) and not t.tgisinternal order by 1`,[TBL])).rows.map(x=>x.n)
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and indexname like 'vaccine_%_idx'`)).rows.length
  const vw0=(await q(`select table_name from information_schema.views where table_schema='public' and table_name='v_vaccine_balance'`)).rows.length
  P('A 구조', tb===3&&pol===12&&trgs.length===4&&idx===5&&vw0===1,
    `테이블 ${tb}/3 · 정책 ${pol}/12 · 트리거 ${trgs.length}/4 · 인덱스 ${idx}/5 · 뷰 ${vw0}/1`)
  P('A-2 트리거 구성', trgs.filter(n=>/append_only/.test(n)).length===1 && trgs.filter(n=>/set_tenant_id/.test(n)).length===3,
    trgs.map(n=>n.replace('vaccine_','')).join(' · '))

  /* ── B. CHECK 제약 6종 ───────────────────────────────────── */
  const want=['vaccine_accounts_funding_source_chk','vaccine_accounts_season_range_chk',
              'vaccine_events_event_type_chk','vaccine_events_container_chk',
              'vaccine_events_qty_chk','vaccine_events_category_chk']
  const got=(await q(`select con.conname from pg_constraint con join pg_class r on r.oid=con.conrelid
    where r.relname = any($1) and con.contype='c' order by 1`,[TBL])).rows.map(x=>x.conname)
  const miss=want.filter(w=>!got.includes(w))
  P('B CHECK 제약', miss.length===0, `${got.length}개 — ${got.join(', ')}${miss.length?' ★누락 '+miss.join(','):''}`)

  /* FK 삭제 동작이 RESTRICT 인지(confdeltype: r=restrict, c=cascade, a=no action) */
  const fk=(await q(`select con.conname, con.confdeltype from pg_constraint con join pg_class r on r.oid=con.conrelid
    where r.relname = any($1) and con.contype='f' order by 1`,[TBL])).rows
  const nonRestrict=fk.filter(x=>x.confdeltype!=='r' && !/tenant/.test(x.conname))
  P('B-2 FK RESTRICT', nonRestrict.length===0,
    fk.map(x=>`${x.conname.replace('vaccine_','')}:${x.confdeltype}`).join(' · ')+'  (r=restrict)')

  /* ── C. ★ anon 권한 0 ────────────────────────────────────── */
  const an=(await q(`select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee='anon' and table_name = any($1)`,[TBL])).rows
  P('C anon 권한 0', an.length===0, an.length?`★ ${an.length}건 — ${an.map(x=>x.table_name+':'+x.privilege_type).join(', ')}`:'0건 (의도대로)')
  const au=(await q(`select table_name, string_agg(privilege_type,',' order by privilege_type) p
    from information_schema.role_table_grants where table_schema='public' and grantee='authenticated'
    and table_name = any($1) group by 1 order by 1`,[TBL])).rows
  P('C-2 authenticated GRANT', au.length===3&&au.every(x=>x.p==='DELETE,INSERT,SELECT,UPDATE'),
    au.map(x=>x.table_name.replace('vaccine_','')+' ['+x.p+']').join(' · '))

  /* ── D. ★ authenticated 롤 실동작 (결함 72 규약) ─────────── */
  await q('set local role authenticated')
  const dSel=await probe(`select count(*)::int n from public.vaccine_accounts`)
  const dIns=await probe(`insert into public.vaccine_accounts (tenant_id,season,season_start,season_end,drug_code,funding_source)
    values ($1,'2026-2027','2026-09-01','2027-06-30','TETRA5','지자체') returning id`,[T])
  await q('reset role')
  P('D authenticated SELECT', dSel.ok, dSel.ok?`성공 · ${dSel.rows[0].n}행 (RLS tenant 격리)`:`★ ${dSel.code} ${dSel.msg}`)
  P('D-2 authenticated INSERT', !dIns.ok && /row-level security/i.test(dIns.msg||''),
    dIns.ok?'★ RLS 없이 들어감':`${/permission denied/i.test(dIns.msg||'')?'★ GRANT 가 막음':'RLS 가 막음(JWT 없어 정상)'} — ${dIns.code}`)

  /* ── 이후 검사용 표본 — 소유자 권한으로 넣는다(트랜잭션 안, 곧 롤백) ── */
  const acc=(await q(`insert into public.vaccine_accounts (tenant_id,season,season_start,season_end,drug_code,funding_source)
    values ($1,'2026-2027','2026-09-01','2027-06-30','TETRA5','지자체') returning id`,[T])).rows[0].id
  const cat=(await q(`insert into public.vaccine_categories (tenant_id,account_id,label) values ($1,$2,'어르신') returning id`,[T,acc])).rows[0].id
  await q(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty,event_date) values ($1,$2,'배정',100,'2026-09-01')`,[T,acc])

  /* ── E. ON DELETE RESTRICT 실동작 ────────────────────────── */
  const eAcc=await probe(`delete from public.vaccine_accounts where id=$1`,[acc])
  const eCat=await probe(`delete from public.vaccine_categories where id=$1`,[cat])
  /* 참조가 없는 카테고리는 지워져야 한다 — RESTRICT 는 참조가 있을 때만 막는다 */
  const cat2=(await q(`insert into public.vaccine_categories (tenant_id,account_id,label) values ($1,$2,'일반') returning id`,[T,acc])).rows[0].id
  const eCat2=await probe(`delete from public.vaccine_categories where id=$1`,[cat2])
  P('E RESTRICT — 계정', !eAcc.ok && eAcc.code==='23503', eAcc.ok?'★ 삭제됨(위험)':`${eAcc.code} ${eAcc.msg}`)
  P('E-2 RESTRICT — 참조없는 카테고리는 삭제 가능', eCat2.ok, eCat2.ok?'삭제됨(의도대로)':`★ ${eCat2.code} ${eCat2.msg}`)
  P('E-3 카테고리(참조 없음) 삭제', eCat.ok, eCat.ok?'삭제됨 — 이 카테고리를 쓰는 이벤트가 없어 정상':`${eCat.code} ${eCat.msg}`)

  /* ── F. qty <> 0 ─────────────────────────────────────────── */
  const f0=await probe(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty) values ($1,$2,'입고',0)`,[T,acc])
  const fN=await probe(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty) values ($1,$2,'입고',-5)`,[T,acc])
  P('F qty=0 거부', !f0.ok && f0.code==='23514', f0.ok?'★ 통과됨':`${f0.code} ${f0.msg}`)
  P('F-2 정정용 음수 허용', fN.ok, fN.ok?'−5 저장됨(의도대로)':`★ ${fN.code} ${fN.msg}`)

  /* ── G. 접종 시 카테고리 필수 ────────────────────────────── */
  const gN=await probe(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty) values ($1,$2,'접종',3)`,[T,acc])
  const cat3=(await q(`insert into public.vaccine_categories (tenant_id,account_id,label) values ($1,$2,'지자체') returning id`,[T,acc])).rows[0].id
  const gY=await probe(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty,category_id) values ($1,$2,'접종',3,$3)`,[T,acc,cat3])
  const gO=await probe(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty) values ($1,$2,'반납',2)`,[T,acc])
  P('G 접종+카테고리NULL 거부', !gN.ok && gN.code==='23514', gN.ok?'★ 통과됨':`${gN.code} ${gN.msg}`)
  P('G-2 접종+카테고리 있으면 통과', gY.ok, gY.ok?'저장됨':`★ ${gY.code} ${gY.msg}`)
  P('G-3 접종 외에는 카테고리 없어도 통과', gO.ok, gO.ok?'반납 저장됨':`★ ${gO.code} ${gO.msg}`)

  /* ── 8. ★ 뷰 security_invoker ─────────────────────────────
        기본값(security_definer)이면 뷰가 소유자 권한으로 돌아 RLS 를 우회한다. */
  const vw=await one(`select c.relname, c.reloptions::text opts
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='v_vaccine_balance' and c.relkind='v'`)
  P('8 ★ security_invoker', !!vw && /security_invoker=(true|on)/i.test(vw.opts||''),
    vw?`reloptions = ${vw.opts||'(없음)'}`:'★ 뷰 미존재')

  /* ── 9. 이벤트 0건 계정도 뷰에 나오는가 (LEFT JOIN) ──────── */
  const acc0=(await q(`insert into public.vaccine_accounts (tenant_id,season,season_start,season_end,drug_code,funding_source)
    values ($1,'2026-2027','2026-09-01','2027-06-30','TETRA6','보건소') returning id`,[T])).rows[0].id
  const v0=await one(`select allocated_qty, received_qty, pending_qty, balance_qty
    from public.v_vaccine_balance where account_id=$1`,[acc0])
  P('9 이벤트 0건 계정도 행 출력', !!v0 && Number(v0.balance_qty)===0 && Number(v0.pending_qty)===0,
    v0?`배정 ${v0.allocated_qty} · 입고 ${v0.received_qty} · 미입고 ${v0.pending_qty} · 잔량 ${v0.balance_qty}`:'★ 행 없음(INNER JOIN 의심)')

  /* ── 10. ★ 배정 100 · 입고 60 · 접종 20 → 미입고 40 · 잔량 40 ──
        balance_qty 가 140 이면 배정을 더한 것 = 실패 */
  const accS=(await q(`insert into public.vaccine_accounts (tenant_id,season,season_start,season_end,drug_code,funding_source)
    values ($1,'2026-2027','2026-09-01','2027-06-30','FLUBYVCV','일반') returning id`,[T])).rows[0].id
  const catS=(await q(`insert into public.vaccine_categories (tenant_id,account_id,label) values ($1,$2,'표본') returning id`,[T,accS])).rows[0].id
  await q(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty) values ($1,$2,'배정',100)`,[T,accS])
  await q(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty) values ($1,$2,'입고',60)`,[T,accS])
  await q(`insert into public.vaccine_events (tenant_id,account_id,event_type,qty,category_id) values ($1,$2,'접종',20,$3)`,[T,accS,catS])
  const vS=await one(`select allocated_qty a, received_qty r, administered_qty ad, returned_qty rt, discarded_qty d,
    pending_qty p, balance_qty b from public.v_vaccine_balance where account_id=$1`,[accS])
  P('10 ★ 잔량 수식', vS && Number(vS.p)===40 && Number(vS.b)===40,
    vS?`배정 ${vS.a} · 입고 ${vS.r} · 접종 ${vS.ad} → 미입고 ${vS.p}(40 기대) · 잔량 ${vS.b}(40 기대)${Number(vS.b)===140?' ★배정을 더했다':''}`:'★ 행 없음')

  /* ── 11·12·13. append-only 가드 ──────────────────────────── */
  const evId=(await q(`select id from public.vaccine_events where account_id=$1 and event_type='입고' limit 1`,[accS])).rows[0].id
  const uQty=await probe(`update public.vaccine_events set qty=99 where id=$1`,[evId])
  const uType=await probe(`update public.vaccine_events set event_type='폐기' where id=$1`,[evId])
  const uMemo=await probe(`update public.vaccine_events set memo='도착 확인' where id=$1`,[evId])
  const uLot=await probe(`update public.vaccine_events set lot_no='L-001', expiry_date='2027-06-30', container='PFS' where id=$1`,[evId])
  const dEv=await probe(`delete from public.vaccine_events where id=$1`,[evId])
  P('11 ★ qty UPDATE 차단', !uQty.ok && uQty.code==='23514', uQty.ok?'★ 통과됨':`${uQty.code} ${uQty.msg}`)
  P('11-2 event_type UPDATE 차단', !uType.ok && uType.code==='23514', uType.ok?'★ 통과됨':`${uType.code}`)
  P('12 memo UPDATE 허용', uMemo.ok, uMemo.ok?'통과(의도대로)':`★ ${uMemo.code} ${uMemo.msg}`)
  P('12-2 lot/유효기한/용기 허용', uLot.ok, uLot.ok?'통과(의도대로)':`★ ${uLot.code} ${uLot.msg}`)
  P('13 ★ DELETE 차단', !dEv.ok && dEv.code==='23514', dEv.ok?'★ 삭제됨':`${dEv.code} ${dEv.msg}`)

  /* ── 14. 뷰 anon 권한 0 ──────────────────────────────────── */
  const vg=(await q(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='v_vaccine_balance' order by grantee`)).rows
  const vAnon=vg.filter(x=>x.grantee==='anon')
  const vAuth=vg.filter(x=>x.grantee==='authenticated').map(x=>x.privilege_type)
  P('14 ★ 뷰 anon 권한 0', vAnon.length===0, vAnon.length?`★ ${vAnon.length}건`:'0건 (의도대로)')
  P('14-2 뷰 authenticated SELECT', vAuth.length===1 && vAuth[0]==='SELECT', `[${vAuth.join(',')}]`)

  /* ── 기존 무변동 ─────────────────────────────────────────── */
  const post=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('기존 무변동', post.txs===pre.txs&&post.drugs===pre.drugs&&post.snap7===pre.snap7&&post.snap8===pre.snap8,
    `거래 ${post.txs} · 약품 ${post.drugs} · 1~7월 ${post.snap7} · 8월 ${post.snap8}`)

  await q('rollback')

  /* ── H. ★ ROLLBACK 무잔류 ────────────────────────────────── */
  const left=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_name = any($1)) tb,
    (select count(*)::int from pg_policies where schemaname='public' and tablename = any($1)) pol,
    (select count(*)::int from pg_indexes where schemaname='public' and indexname like 'vaccine_%') idx,
    (select count(*)::int from information_schema.views where table_schema='public' and table_name like 'v_vaccine%') vw,
    (select count(*)::int from pg_proc p2 join pg_namespace n2 on n2.oid=p2.pronamespace where n2.nspname='public' and p2.proname like 'guard_vaccine%') fn,
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies`,[TBL])
  P('H ROLLBACK 무잔류', left.tb===0&&left.pol===0&&left.idx===0&&left.vw===0&&left.fn===0&&left.tables===pre.tables&&left.policies===pre.policies,
    `테이블 ${left.tb} · 정책 ${left.pol} · 인덱스 ${left.idx} · 뷰 ${left.vw} · 함수 ${left.fn} · 전체 테이블 ${left.tables}(사전 ${pre.tables}) · 전체 정책 ${left.policies}(사전 ${pre.policies})`)

  console.log('\n' + '─'.repeat(78))
  let pass=0
  for(const [k,v] of Object.entries(R)){ console.log(`${v.ok?'  PASS':'★ FAIL'}  ${k.padEnd(34)} ${v.d}`); if(v.ok)pass++ }
  console.log('─'.repeat(78))
  console.log(`${pass}/${Object.keys(R).length} 통과 · 커밋 없음(ROLLBACK 완료)`)
  process.exitCode = pass===Object.keys(R).length ? 0 : 1
}catch(e){
  try{ await q('rollback') }catch{}
  console.error('★ 실패:', e.message)
  process.exitCode=1
}finally{ await c.end() }
