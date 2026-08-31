// dryrun_0085.mjs — inventory_counts / inventory_count_items 생성 + drugs 컬럼 2개 dryrun.
// BEGIN→DDL→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
// A.구조 B.RLS·정책 C.GRANT(anon 0) D.authenticated 세션 생성(tenant 자동부여)
// E.authenticated 항목 적재 F.cascade G.anon 차단 H.조정 거래→재고 반영 경로
// I.역거래(A안) J.마감월 차단 K.기존 무변동 L.정본
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0085_inventory_counts.sql','utf8')
const T=['inventory_counts','inventory_count_items']
const NEWCOL=['gtin','unit_mgmt']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  const pre = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.drugs) drugs,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') drugcols,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  console.log('사전 상태 — 테이블', pre.tables, '· 정책', pre.policies, '· drugs', pre.drugs, '컬럼', pre.drugcols,
              '· 거래', pre.txs, '· 1~7월 정본', pre.snap)

  const tm = await one(`select user_id, tenant_id from public.tenant_members limit 1`)
  if(!tm) throw new Error('tenant_members 비어 있음 — dryrun 불가')

  await q('begin')
  await q(ddl)

  /* A. 구조 */
  const cols = (await q(`select table_name, column_name, data_type, is_nullable
    from information_schema.columns where table_schema='public' and table_name = any($1)
    order by table_name, ordinal_position`,[T])).rows
  const cnt = {}; cols.forEach(r=>{cnt[r.table_name]=(cnt[r.table_name]||0)+1})
  const dcols = (await q(`select column_name, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name = any($1)`,[NEWCOL])).rows
  P('A 구조', cnt.inventory_counts===12 && cnt.inventory_count_items===10
      && dcols.length===2 && dcols.every(r=>r.is_nullable==='YES' && r.column_default===null),
    `counts ${cnt.inventory_counts}컬럼 · items ${cnt.inventory_count_items}컬럼 · drugs +${dcols.map(r=>r.column_name+'('+(r.is_nullable==='YES'?'null허용':'NOT NULL')+',기본값'+(r.column_default===null?'없음':'있음')+')').join(' ')}`)

  /* CHECK 미부여 확인 */
  const chk = (await q(`select con.conname from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname = any($1) and con.contype='c'`,[T])).rows
  P('A-2 CHECK 미부여', chk.length===0, chk.length?chk.map(r=>r.conname).join(','):'0건')

  /* B. RLS·정책 */
  const rls = (await q(`select relname, relrowsecurity from pg_class where relname = any($1)`,[T])).rows
  const pol = (await q(`select tablename, cmd, policyname from pg_policies where schemaname='public' and tablename = any($1) order by tablename, cmd`,[T])).rows
  P('B RLS·정책', rls.every(r=>r.relrowsecurity) && pol.length===8,
    `RLS ${rls.map(r=>r.relname+':'+(r.relrowsecurity?'on':'OFF')).join(' ')} · 정책 ${pol.length}개(${pol.map(p=>p.tablename.replace('inventory_','')+'/'+p.cmd).join(' ')})`)

  /* C. GRANT — authenticated·service_role 4권한 · anon 0 */
  const gr = (await q(`select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name = any($1) and grantee in ('authenticated','service_role','anon')`,[T])).rows
  const has=(g,t,p)=>gr.some(r=>r.grantee===g&&r.table_name===t&&r.privilege_type===p)
  const gOk = T.every(t=>['SELECT','INSERT','UPDATE','DELETE'].every(p=>has('authenticated',t,p)&&has('service_role',t,p)))
  const anonN = gr.filter(r=>r.grantee==='anon').length
  P('C GRANT', gOk && anonN===0, `authenticated·service_role 4권한=${gOk} · anon ${anonN}건`)

  /* D. authenticated 세션 생성 — tenant_id 자동 부여(트리거) */
  await q('savepoint sp_d')
  let sess=null
  try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    sess = await one(`insert into public.inventory_counts (count_date, title)
      values (current_date, '__dryrun0085__ 정기실사') returning id, tenant_id, status, revert_reason`)
    P('D 세션 생성(tenant 자동부여)', sess.tenant_id===tm.tenant_id && sess.status==='작성중' && sess.revert_reason===null,
      `tenant 자동=${sess.tenant_id===tm.tenant_id} · status='${sess.status}' · revert_reason=null(선택 입력)`)
  }catch(e){ P('D 세션 생성(tenant 자동부여)', false, e.message) }
  await q(`reset role`)

  /* E. 항목 적재 — 수동·엑셀 두 source · 낱알/LOT 비어도 저장 */
  let itemIds=[]
  try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    const dc = (await one(`select drug_code from public.drugs where status='사용' limit 1`)).drug_code
    const ins = (await q(`insert into public.inventory_count_items (count_id, drug_code, counted_qty, source)
      values ($1,$2,10,'수동'), ($1,$2,5,'엑셀') returning id, lot_no, expiry_date, book_qty, applied_tx_id`,[sess.id,dc])).rows
    itemIds = ins.map(r=>r.id)
    P('E 항목 적재', ins.length===2 && ins.every(r=>r.lot_no===null&&r.expiry_date===null&&r.book_qty===null&&r.applied_tx_id===null),
      `2행(수동·엑셀) · LOT·유효기한·장부·applied_tx_id 전부 null 허용`)
  }catch(e){ P('E 항목 적재', false, e.message) }
  await q(`reset role`)

  /* F. cascade — 세션 삭제 시 항목 동반 삭제 */
  await q('savepoint sp_f')
  try{
    await q(`delete from public.inventory_counts where id=$1`,[sess.id])
    const left=(await one(`select count(*)::int n from public.inventory_count_items where count_id=$1`,[sess.id])).n
    P('F cascade', left===0, `세션 삭제 후 항목 ${left}행`)
  }catch(e){ P('F cascade', false, e.message) }
  await q('rollback to savepoint sp_f')

  /* G. anon 차단 */
  const gRes=[]
  for(const t of T){
    await q('savepoint sp_g')
    try{ await q(`set local role anon`); const n=(await one(`select count(*)::int n from public.${t}`)).n; gRes.push(`${t}:★${n}행 읽힘`) }
    catch(e){ gRes.push(`${t}:차단(${e.code})`) }
    await q('rollback to savepoint sp_g')
  }
  await q(`reset role`)
  P('G anon 차단', gRes.every(s=>s.includes('차단')), gRes.join(' · '))

  /* H. 재고반영 경로 — 조정 거래 INSERT 로 재고가 움직이는가(current_qty 직접 UPDATE 없이) */
  await q('savepoint sp_h')
  let txId=null
  try{
    const dc = (await one(`select drug_code from public.drugs where status='사용' limit 1`)).drug_code
    const before = (await one(`select coalesce(current_qty,0) v from public.inventory_stock where drug_code=$1 and tenant_id=$2`,[dc,tm.tenant_id]))?.v ?? 0
    const tx = await one(`insert into public.transactions (drug_code, type, quantity, transaction_date, reason, tenant_id)
      values ($1,'조정',7,current_date,'__dryrun0085__ 실사 반영',$2) returning id`,[dc,tm.tenant_id])
    txId = tx.id
    const after = (await one(`select coalesce(current_qty,0) v from public.inventory_stock where drug_code=$1 and tenant_id=$2`,[dc,tm.tenant_id])).v
    await q(`update public.inventory_count_items set applied_tx_id=$1 where id=$2`,[txId,itemIds[0]])
    const link = (await one(`select applied_tx_id from public.inventory_count_items where id=$1`,[itemIds[0]])).applied_tx_id
    P('H 재고반영 경로', Number(after)-Number(before)===7 && link===txId,
      `조정 +7 → 재고 ${before}→${after}(트리거 apply_tx_to_inventory) · applied_tx_id 기록=${link===txId}`)
  }catch(e){ P('H 재고반영 경로', false, e.message) }

  /* I. 역거래(A안) — 원 거래를 남긴 채 반대 부호 신규 생성 */
  try{
    const dc = (await one(`select drug_code from public.transactions where id=$1`,[txId])).drug_code
    const mid = (await one(`select coalesce(current_qty,0) v from public.inventory_stock where drug_code=$1 and tenant_id=$2`,[dc,tm.tenant_id])).v
    await one(`insert into public.transactions (drug_code, type, quantity, transaction_date, reason, tenant_id)
      values ($1,'조정',-7,current_date,'__dryrun0085__ 실사 되돌리기(역거래)',$2) returning id`,[dc,tm.tenant_id])
    const back = (await one(`select coalesce(current_qty,0) v from public.inventory_stock where drug_code=$1 and tenant_id=$2`,[dc,tm.tenant_id])).v
    const orig = (await one(`select count(*)::int n from public.transactions where id=$1`,[txId])).n
    P('I 역거래(A안)', Number(mid)-Number(back)===7 && orig===1,
      `역거래 -7 → 재고 ${mid}→${back} 복원 · ★ 원 거래 보존=${orig===1}(삭제 안 함)`)
  }catch(e){ P('I 역거래(A안)', false, e.message) }
  await q('rollback to savepoint sp_h')

  /* J. 마감월 차단 — 되돌리기를 마감월 날짜로 만들면 DB가 막는가 */
  await q('savepoint sp_j')
  try{
    const dc = (await one(`select drug_code from public.drugs where status='사용' limit 1`)).drug_code
    const closed = await one(`select snap_year y, snap_month m from public.monthly_snapshots where tenant_id=$1 order by snap_year desc, snap_month desc limit 1`,[tm.tenant_id])
    await q(`insert into public.transactions (drug_code, type, quantity, transaction_date, reason, tenant_id)
      values ($1,'조정',1, make_date($2,$3,15), '__dryrun0085__ 마감월', $4)`,[dc,closed.y,closed.m,tm.tenant_id])
    P('J 마감월 차단', false, `★ ${closed.y}-${closed.m} 거래가 통과함 — 차단되어야 한다`)
  }catch(e){ P('J 마감월 차단', e.code==='23514'||/마감된 월/.test(e.message), `guard_closed_month_tx 발동: ${e.message.slice(0,58)}`) }
  await q('rollback to savepoint sp_j')

  /* K·L. 기존 무변동 + 정본 */
  const mid2 = await one(`select
    (select count(*)::int from public.drugs) drugs,
    (select count(*)::int from public.transactions) txs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  P('K 기존 무변동', mid2.drugs===pre.drugs && mid2.txs===pre.txs, `drugs ${pre.drugs}→${mid2.drugs} · 거래 ${pre.txs}→${mid2.txs}`)
  P('L 정본 무변동', mid2.snap===pre.snap, `1~7월 ${mid2.snap}`)

  await q('rollback')

  const after = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_name = any($1)) t,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') drugcols,
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.transactions) txs`,[T])
  P('ROLLBACK 무잔류', after.t===0 && after.drugcols===pre.drugcols && after.tables===pre.tables
      && after.policies===pre.policies && after.txs===pre.txs,
    `신규 테이블 ${after.t}개 · drugs 컬럼 ${after.drugcols}(사전 ${pre.drugcols}) · 테이블 ${after.tables} · 정책 ${after.policies} · 거래 ${after.txs}`)

  console.log('\n=== dryrun 0085 결과 ===')
  let ng=0
  for(const [k,v] of Object.entries(R)){ if(!v.ok) ng++; console.log(`  ${v.ok?'OK  ':'FAIL'} ${k.padEnd(24)} ${v.d}`) }
  console.log(ng ? `\n■ 실패 ${ng}건 — apply 금지.` : `\n■ 전부 통과(${Object.keys(R).length}/${Object.keys(R).length}). 운영 무잔류. 승인 시 apply 가능.`)
  process.exitCode = ng ? 1 : 0
}catch(e){ try{await q('rollback')}catch{}; console.error('dryrun 오류:', e.message); process.exitCode=1 }
finally{ await c.end() }
