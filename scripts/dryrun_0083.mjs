// dryrun_0083.mjs — ward_requests / ward_request_items / ward_request_window 생성 dryrun.
// BEGIN→DDL→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
// A.구조 B.RLS·정책 C.GRANT(anon 0) D.service_role tenant 명시 INSERT(Function 경로)
// E.authenticated SELECT F.authenticated UPDATE G.anon 차단 H.cascade I.기존 무변동 J.정본
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0083_ward_requests.sql','utf8')
const T=['ward_requests','ward_request_items','ward_request_window']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  const pre = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)
  const tm = await one(`select user_id, tenant_id from public.tenant_members limit 1`)

  await q('begin'); await q(ddl)

  // A. 구조 — 테이블·PK·FK·인덱스
  const cols = await one(`select
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests') a,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_request_items') b,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_request_window') c`)
  const fk = (await one(`select count(*)::int n from information_schema.table_constraints
    where table_schema='public' and table_name='ward_request_items' and constraint_type='FOREIGN KEY'`)).n
  const idx = (await one(`select count(*)::int n from pg_indexes where schemaname='public' and tablename = any($1)`,[T])).n
  P('A_구조', cols.a===9 && cols.b===9 && cols.c===9 && Number(fk)>=1 && Number(idx)>=6,
     `컬럼 헤더${cols.a}/품목${cols.b}/기간${cols.c} · FK ${fk} · 인덱스(PK포함) ${idx}`)

  // B. RLS on · 정책 4×3
  const rls = (await q(`select c.relname, c.relrowsecurity,
      (select count(*)::int from pg_policies p where p.schemaname='public' and p.tablename=c.relname) pol
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any($1) order by 1`,[T])).rows
  P('B_RLS', rls.length===3 && rls.every(r=>r.relrowsecurity===true && Number(r.pol)===4),
     rls.map(r=>`${r.relname}:RLS${r.relrowsecurity?'on':'off'}/정책${r.pol}`).join(' · '))

  // C. GRANT authenticated 4종 · anon 0
  const g = (await q(`select table_name, grantee, count(*)::int n from information_schema.role_table_grants
    where table_schema='public' and table_name = any($1) and grantee in ('authenticated','anon')
    group by 1,2 order by 1,2`,[T])).rows
  const authOk = T.every(t=>g.find(x=>x.table_name===t && x.grantee==='authenticated' && Number(x.n)===4))
  const anonN = g.filter(x=>x.grantee==='anon').length
  P('C_GRANT', authOk && anonN===0, `authenticated 4종×3 ${authOk?'✅':'❌'} · anon ${anonN}건(0이어야 정상)`)

  // D. service_role로 tenant_id 명시 INSERT (Function 경로 = 비회원 신청 재현)
  let dOk=false, dErr=null, hdr=null, tenantKept=null
  await q('savepoint sp_d')
  try{
    await q(`set local role service_role`)
    hdr = (await one(`insert into public.ward_requests (tenant_id, ward, requester_name, season, request_year)
                      values ($1,'3','__dryrun__','설',2026) returning id, tenant_id`,[tm.tenant_id]))
    tenantKept = hdr.tenant_id===tm.tenant_id
    await q(`insert into public.ward_request_items (request_id, drug_code, drug_name, qty, unit, sort_order)
             values ($1,'SGBRONNC10','가바로닌캡슐100mg',2,'병',1), ($1,null,'목록에 없는 약',1,'포',2)`,[hdr.id])
    const n=(await one(`select count(*)::int n from public.ward_request_items where request_id=$1`,[hdr.id])).n
    dOk = tenantKept && Number(n)===2
  }catch(e){ dErr=e.message.slice(0,90) }
  try{ await q('reset role') }catch{}
  P('D_service_role', dOk, dErr || `tenant 명시값 유지=${tenantKept} · 품목 2건(drug_code null 1건 포함) — 트리거가 덮어쓰지 않음`)

  // E. authenticated SELECT (관리 화면)
  let eOk=false, eErr=null, eCnt=null
  await q('savepoint sp_e')
  try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    eCnt = (await one(`select count(*)::int n from public.ward_requests`)).n
    const it = (await one(`select count(*)::int n from public.ward_request_items`)).n
    eOk = Number(eCnt)===1 && Number(it)===2
  }catch(e){ eErr=e.message.slice(0,90) }
  try{ await q('reset role') }catch{}
  await q('rollback to savepoint sp_e')
  P('E_auth_SELECT', eOk, eErr || `헤더 ${eCnt}건·품목 2건 조회됨(자기 tenant)`)

  // F. authenticated UPDATE (사용량 기입·상태 변경)
  let fOk=false, fErr=null
  await q('savepoint sp_f')
  try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    await q(`update public.ward_requests set status='처리중' where id=$1`,[hdr.id])
    await q(`update public.ward_request_items set usage_qty=1.5 where request_id=$1 and drug_code is not null`,[hdr.id])
    const r=(await one(`select status from public.ward_requests where id=$1`,[hdr.id])).status
    const u=(await one(`select usage_qty::text u from public.ward_request_items where request_id=$1 and drug_code is not null`,[hdr.id])).u
    fOk = r==='처리중' && u==='1.5'
  }catch(e){ fErr=e.message.slice(0,90) }
  try{ await q('reset role') }catch{}
  await q('rollback to savepoint sp_f')
  P('F_auth_UPDATE', fOk, fErr || `status→처리중 · usage_qty→1.5 반영`)

  // G. anon 차단
  const gRes=[]
  for(const t of T){
    await q('savepoint sp_g')
    try{ await q(`set local role anon`); const n=(await one(`select count(*)::int n from public."${t}"`)).n; gRes.push(`${t}:${n}행`) }
    catch(e){ gRes.push(`${t}:${e.code}`) }
    try{ await q('reset role') }catch{}
    await q('rollback to savepoint sp_g')
  }
  P('G_anon차단', gRes.every(x=>x.includes('42501')), gRes.join(' · '))

  // H. cascade
  await q('savepoint sp_h')
  await q(`delete from public.ward_requests where id=$1`,[hdr.id])
  const left=(await one(`select count(*)::int n from public.ward_request_items where request_id=$1`,[hdr.id])).n
  P('H_cascade', Number(left)===0, `헤더 삭제 후 품목 잔여 ${left}건`)
  await q('rollback to savepoint sp_h')

  // I. 기존 테이블·정책 무변동 (+3 테이블 / +12 정책만)
  const post = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.drugs) drugs`)
  P('I_기존무변동', post.tables===pre.tables+3 && post.policies===pre.policies+12 && post.drugs===pre.drugs,
     `테이블 ${pre.tables}→${post.tables}(+3) · 정책 ${pre.policies}→${post.policies}(+12) · drugs ${post.drugs} 무변동`)

  // J. 정본
  const j = await one(`select
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)
  P('J_정본', j.snap===pre.snap && j.snap7===pre.snap7, `${j.snap} / ${j.snap7}`)

  await q('rollback')

  const after = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_name = any($1)) t,
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies`,[T])
  P('ROLLBACK', after.t===0 && after.tables===pre.tables && after.policies===pre.policies,
     `신규 테이블 ${after.t}(0=제거) · 전체 ${after.tables} · 정책 ${after.policies} — 원상복귀`)

  console.log(JSON.stringify({ allOk:Object.values(R).every(x=>x.ok), pre, R }, null, 1))
}catch(e){ try{await q('rollback')}catch{}; console.error('dryrun 오류:', e.message); process.exitCode=1 }
finally{ await c.end() }
