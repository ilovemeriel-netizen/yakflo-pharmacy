// verify_0085.mjs — apply 후 운영 검증(읽기 전용 + savepoint 로 되돌리는 쓰기 테스트).
// 테이블 2개·컬럼·정책 8개·GRANT·anon 차단·조정거래 경로·역거래·마감월 차단·기존 무변동·정본.
// ★ 실제 데이터는 남기지 않는다 — 쓰기 테스트는 전부 savepoint/rollback 으로 되돌린다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const T=['inventory_counts','inventory_count_items']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  // 1) 테이블·컬럼
  const cols=(await q(`select table_name, count(*)::int n from information_schema.columns
    where table_schema='public' and table_name = any($1) group by 1`,[T])).rows
  const m=Object.fromEntries(cols.map(r=>[r.table_name,r.n]))
  P('1 테이블·컬럼', m.inventory_counts===12 && m.inventory_count_items===10,
    `counts ${m.inventory_counts}컬럼 · items ${m.inventory_count_items}컬럼`)

  // 2) drugs 신규 컬럼 2개 — nullable·기본값 없음
  const dc=(await q(`select column_name, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name in ('gtin','unit_mgmt') order by column_name`)).rows
  P('2 drugs 컬럼', dc.length===2 && dc.every(r=>r.is_nullable==='YES' && r.column_default===null),
    dc.map(r=>`${r.column_name}(${r.is_nullable==='YES'?'null허용':'NOT NULL'},기본값${r.column_default===null?'없음':'있음'})`).join(' · '))

  // 3) 정책 8개 · RLS on
  const pol=(await q(`select tablename, cmd from pg_policies where schemaname='public' and tablename = any($1)`,[T])).rows
  const rls=(await q(`select relname, relrowsecurity from pg_class where relname = any($1)`,[T])).rows
  P('3 RLS·정책', pol.length===8 && rls.every(r=>r.relrowsecurity),
    `정책 ${pol.length}개 · RLS ${rls.map(r=>r.relname.replace('inventory_','')+':'+(r.relrowsecurity?'on':'OFF')).join(' ')}`)

  // 4) GRANT · anon 0
  const gr=(await q(`select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name = any($1) and grantee in ('authenticated','service_role','anon')`,[T])).rows
  const has=(g,t,p)=>gr.some(r=>r.grantee===g&&r.table_name===t&&r.privilege_type===p)
  const gOk=T.every(t=>['SELECT','INSERT','UPDATE','DELETE'].every(p=>has('authenticated',t,p)&&has('service_role',t,p)))
  const anonN=gr.filter(r=>r.grantee==='anon').length
  P('4 GRANT', gOk && anonN===0, `authenticated·service_role 4권한=${gOk} · anon ${anonN}건`)

  // 5) CHECK 미부여
  const chk=(await q(`select con.conname from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname = any($1) and con.contype='c'`,[T])).rows
  P('5 CHECK 미부여', chk.length===0, `${chk.length}건`)

  const tm=await one(`select user_id, tenant_id from public.tenant_members limit 1`)

  await q('begin')

  // 6) anon 차단
  const gRes=[]
  for(const t of T){
    await q('savepoint sp6')
    try{ await q(`set local role anon`); const n=(await one(`select count(*)::int n from public.${t}`)).n; gRes.push(`${t}:★${n}행`) }
    catch(e){ gRes.push(`${t.replace('inventory_','')}:차단(${e.code})`) }
    await q('rollback to savepoint sp6')
  }
  try{ await q('reset role') }catch{}
  P('6 anon 차단', gRes.every(s=>s.includes('차단')), gRes.join(' · '))

  // 7) 전 경로 — 세션 생성(tenant 자동) → 항목 → 조정거래 반영 → 역거래 되돌림
  await q('savepoint sp7')
  try{
    await q(`set local role authenticated`)
    await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    const s=await one(`insert into public.inventory_counts (count_date,title)
      values (current_date,'__verify0085__') returning id, tenant_id, status`)
    const dcode=(await one(`select drug_code from public.drugs where status='사용' limit 1`)).drug_code
    const it=await one(`insert into public.inventory_count_items (count_id,drug_code,counted_qty,source)
      values ($1,$2,3,'수동') returning id, book_qty, lot_no, applied_tx_id`,[s.id,dcode])
    await q('reset role')
    const before=(await one(`select coalesce(current_qty,0) v from public.inventory_stock
      where drug_code=$1 and tenant_id=$2`,[dcode,tm.tenant_id]))?.v ?? 0
    const tx=await one(`insert into public.transactions (drug_code,type,quantity,transaction_date,reason,tenant_id)
      values ($1,'조정',3,current_date,'__verify0085__ 반영',$2) returning id`,[dcode,tm.tenant_id])
    const mid=(await one(`select coalesce(current_qty,0) v from public.inventory_stock
      where drug_code=$1 and tenant_id=$2`,[dcode,tm.tenant_id])).v
    await q(`update public.inventory_count_items set applied_tx_id=$1 where id=$2`,[tx.id,it.id])
    await one(`insert into public.transactions (drug_code,type,quantity,transaction_date,reason,tenant_id)
      values ($1,'조정',-3,current_date,'__verify0085__ 역거래',$2) returning id`,[dcode,tm.tenant_id])
    const back=(await one(`select coalesce(current_qty,0) v from public.inventory_stock
      where drug_code=$1 and tenant_id=$2`,[dcode,tm.tenant_id])).v
    const orig=(await one(`select count(*)::int n from public.transactions where id=$1`,[tx.id])).n
    P('7 전 경로',
      s.tenant_id===tm.tenant_id && s.status==='작성중' && it.book_qty===null
      && Number(mid)-Number(before)===3 && Number(mid)-Number(back)===3 && orig===1,
      `tenant 자동 · status='작성중' · 재고 ${before}→${mid}→${back} · ★ 원 거래 보존=${orig===1}`)
  }catch(e){ P('7 전 경로', false, e.message) }
  try{ await q('reset role') }catch{}
  await q('rollback to savepoint sp7')

  // 8) 마감월 차단(최후 방어선)
  await q('savepoint sp8')
  try{
    const dcode=(await one(`select drug_code from public.drugs where status='사용' limit 1`)).drug_code
    const cl=await one(`select snap_year y, snap_month m from public.monthly_snapshots
      where tenant_id=$1 order by snap_year desc, snap_month desc limit 1`,[tm.tenant_id])
    await q(`insert into public.transactions (drug_code,type,quantity,transaction_date,reason,tenant_id)
      values ($1,'조정',1,make_date($2,$3,15),'__verify0085__',$4)`,[dcode,cl.y,cl.m,tm.tenant_id])
    P('8 마감월 차단', false, '★ 통과함 — 차단되어야 한다')
  }catch(e){ P('8 마감월 차단', /마감된 월/.test(e.message), e.message.slice(0,52)) }
  await q('rollback to savepoint sp8')

  await q('rollback')

  // 9~11) 기존 무변동 + 정본 + 잔류 0
  const fin=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') drugcols,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.inventory_counts) cnts,
    (select count(*)::int from public.inventory_count_items) items,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)
  P('9 기준값', fin.tables===40 && fin.policies===95 && fin.drugcols===73 && fin.txs===964,
    `테이블 ${fin.tables}(38→40) · 정책 ${fin.policies}(87→95) · drugs 컬럼 ${fin.drugcols}(71→73) · 거래 ${fin.txs}(무변동)`)
  P('10 정본 무변동', fin.snap==='885285628.424000000014',
    `1~7월 ${fin.snap} · 7월 기말 ${fin.snap7}`)
  P('11 잔류 0', fin.cnts===0 && fin.items===0, `counts ${fin.cnts}행 · items ${fin.items}행 (테스트 무잔류)`)

  console.log('=== verify 0085 결과 ===')
  let ng=0
  for(const [k,v] of Object.entries(R)){ if(!v.ok) ng++; console.log(`  ${v.ok?'OK  ':'FAIL'} ${k.padEnd(15)} ${v.d}`) }
  console.log(ng?`\n■ 실패 ${ng}건`:`\n■ 전부 통과(${Object.keys(R).length}/${Object.keys(R).length}).`)
  process.exitCode=ng?1:0
}catch(e){ try{await q('rollback')}catch{}; console.error('verify 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
