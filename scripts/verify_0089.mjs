// verify_0089.mjs — apply_0089 이후 운영 검증.
//
// ★★ 읽기 전용이다. INSERT·UPDATE·DELETE 를 일절 하지 않는다.
//    vaccine_events 에 append-only 가드가 걸려 있어 **테스트 데이터를 지울 수 없다**.
//    한 번 넣으면 원장에 영구히 남으므로 쓰기 검증은 하지 않는다.
//    쓰기 경로(로그인 계정 INSERT → 역부호 정정)는 사용자가 화면에서 1회 확인한다.
//
// ★ 세션 자체를 read only 로 잠가 실수로도 쓰지 못하게 한다.
// ★ 결함 72 규약 — authenticated 롤 조회를 포함한다(소유자만으로는 실사용 경로를 못 본다).
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const TBL=['vaccine_accounts','vaccine_categories','vaccine_events']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}

await c.connect()
try{
  /* ★ 쓰기 원천 차단 */
  await q('set session characteristics as transaction read only')

  /* 1. 구조 */
  const tb=(await q(`select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' and table_name = any($1) order by 1`,[TBL])).rows.map(x=>x.table_name)
  const vw=(await q(`select table_name from information_schema.views where table_schema='public' and table_name='v_vaccine_balance'`)).rows.length
  const pol=(await q(`select policyname from pg_policies where schemaname='public' and tablename = any($1)`,[TBL])).rows.length
  const trgs=(await q(`select cl.relname||'.'||t.tgname n from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
    where cl.relname = any($1) and not t.tgisinternal order by 1`,[TBL])).rows.map(x=>x.n)
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and indexname like 'vaccine_%_idx' order by 1`)).rows.map(x=>x.indexname)
  P('1 구조', tb.length===3&&vw===1&&pol===12&&trgs.length===4&&idx.length===5,
    `테이블 ${tb.length}/3 · 뷰 ${vw}/1 · 정책 ${pol}/12 · 트리거 ${trgs.length}/4 · 인덱스 ${idx.length}/5`)

  /* 2. CHECK 6종 */
  const want=['vaccine_accounts_funding_source_chk','vaccine_accounts_season_range_chk',
              'vaccine_events_category_chk','vaccine_events_container_chk',
              'vaccine_events_event_type_chk','vaccine_events_qty_chk']
  const chk=(await q(`select con.conname from pg_constraint con join pg_class r on r.oid=con.conrelid
    where r.relname = any($1) and con.contype='c' order by 1`,[TBL])).rows.map(x=>x.conname)
  const miss=want.filter(w=>!chk.includes(w))
  P('2 CHECK 6종', miss.length===0, `${chk.length}개${miss.length?' ★누락 '+miss.join(','):' — 전부 존재'}`)

  /* 3. ★ security_invoker */
  const si=(await one(`select c2.reloptions::text o from pg_class c2 join pg_namespace n on n.oid=c2.relnamespace
    where n.nspname='public' and c2.relname='v_vaccine_balance' and c2.relkind='v'`))
  P('3 ★ security_invoker', !!si && /security_invoker=(true|on)/i.test(si.o||''), si?`reloptions = ${si.o||'(없음)'}`:'★ 뷰 미존재')

  /* 4. ★ anon 권한 0 */
  const an=(await q(`select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee='anon' and (table_name = any($1) or table_name='v_vaccine_balance')`,[TBL])).rows
  P('4 ★ anon 권한 0', an.length===0, an.length?`★ ${an.length}건 — ${an.map(x=>x.table_name+':'+x.privilege_type).join(', ')}`:'0건 (의도대로)')

  /* 5. authenticated GRANT 4종 · TRUNCATE/REFERENCES/TRIGGER 없음 */
  const au=(await q(`select table_name, string_agg(privilege_type,',' order by privilege_type) p
    from information_schema.role_table_grants where table_schema='public' and grantee='authenticated'
      and table_name = any($1) group by 1 order by 1`,[TBL])).rows
  const vg=(await q(`select string_agg(privilege_type,',' order by privilege_type) p
    from information_schema.role_table_grants where table_schema='public' and grantee='authenticated'
      and table_name='v_vaccine_balance'`)).rows[0]
  const ok4=au.length===3 && au.every(x=>x.p==='DELETE,INSERT,SELECT,UPDATE')
  const noExtra=!au.some(x=>/TRUNCATE|REFERENCES|TRIGGER/.test(x.p)) && !/TRUNCATE|REFERENCES|TRIGGER/.test(vg?.p||'')
  P('5 authenticated GRANT', ok4 && noExtra && vg?.p==='SELECT',
    au.map(x=>x.table_name.replace('vaccine_','')+' ['+x.p+']').join(' · ')+` · 뷰 [${vg?.p||'없음'}]`)
  P('5-2 TRUNCATE/REFERENCES/TRIGGER 없음', noExtra, noExtra?'없음 (의도대로)':'★ 있음')

  /* 6. 가드 트리거 활성 */
  const g=(await one(`select t.tgname, t.tgenabled, p.proname,
      case when t.tgtype & 2 > 0 then 'BEFORE' else 'AFTER' end tm,
      concat_ws('/', case when t.tgtype & 8 > 0 then 'DELETE' end, case when t.tgtype & 16 > 0 then 'UPDATE' end) ev
    from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
    where cl.relname='vaccine_events' and t.tgname='trg_vaccine_events_append_only' and not t.tgisinternal`))
  P('6 가드 트리거 활성', !!g && g.tgenabled==='O' && g.tm==='BEFORE' && /DELETE/.test(g.ev) && /UPDATE/.test(g.ev),
    g?`${g.tgname} → ${g.proname} · ${g.tm} ${g.ev} · 활성 ${g.tgenabled}`:'★ 미존재')

  /* 7. ★ 기존 정본 무변동 */
  const k=await one(`select
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select count(*)::int from public.drug_barcodes) barcodes,
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') basetables,
    (select count(*)::int from information_schema.views where table_schema='public') views,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap7,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=8) snap8`)
  P('7 정본 무변동',
    k.txs===1411 && k.drugs===1118 && k.barcodes===2894 &&
    k.snap7.startsWith('885285628.424') && k.snap8.startsWith('101208155.9'),
    `거래 ${k.txs}/1411 · 약품 ${k.drugs}/1118 · 바코드 ${k.barcodes}/2894 · 1~7월 ${k.snap7} · 8월 ${k.snap8}`)
  /* ★ 지시서의 「47→50」은 뷰를 빼먹은 수치다. 실측은 BASE TABLE 43→46 · VIEW 4→5 · 합계 47→51 */
  P('7-2 객체 증가', k.basetables===46 && k.views===5 && k.tables===51 && k.policies===114,
    `BASE TABLE 43→${k.basetables} · VIEW 4→${k.views} · 합계 47→${k.tables} · 정책 102→${k.policies}`)

  /* 8. ★ authenticated 롤 조회 (결함 72 규약) — 읽기만 한다 */
  await q('begin'); await q('set transaction read only'); await q('set local role authenticated')
  const probe=async(sql)=>{ await q('savepoint sp')
    try{ const r=await q(sql); await q('release savepoint sp'); return {ok:true,row:r.rows[0]} }
    catch(e){ await q('rollback to savepoint sp'); return {ok:false,code:e.code,msg:(e.message||'').slice(0,70)} } }
  const s1=await probe(`select count(*)::int n from public.vaccine_accounts`)
  const s2=await probe(`select count(*)::int n from public.vaccine_events`)
  const s3=await probe(`select count(*)::int n from public.v_vaccine_balance`)
  await q('reset role'); await q('rollback')
  P('8 ★ authenticated 조회', s1.ok&&s2.ok&&s3.ok,
    `계정 ${s1.ok?s1.row.n+'행':'★'+s1.code} · 원장 ${s2.ok?s2.row.n+'행':'★'+s2.code} · 뷰 ${s3.ok?s3.row.n+'행':'★'+s3.code}  (RLS tenant 격리로 0행이 정상)`)

  /* 9. 뷰 컬럼 구성 */
  const cols=(await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='v_vaccine_balance' order by ordinal_position`)).rows.map(x=>x.column_name)
  const wantC=['account_id','tenant_id','season','drug_code','funding_source','allocated_qty','received_qty',
               'administered_qty','returned_qty','discarded_qty','pending_qty','balance_qty']
  P('9 뷰 컬럼 12종', wantC.every(x=>cols.includes(x)) && cols.length===12, cols.join(', '))

  console.log('─'.repeat(80))
  let pass=0, total=0
  for(const [key,v] of Object.entries(R)){ console.log(`${v.ok?'  PASS':'★ FAIL'}  ${key.padEnd(28)} ${v.d}`); if(v.ok)pass++; total++ }
  console.log('─'.repeat(80))
  console.log(`${pass}/${total} 통과 · ★ 읽기 전용 — INSERT·UPDATE·DELETE 0건`)
  process.exitCode = pass===total ? 0 : 1
}catch(e){ console.error('★ 실패:', e.message); process.exitCode=1 }
finally{ await c.end() }
