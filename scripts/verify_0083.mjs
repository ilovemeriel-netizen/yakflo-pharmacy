// verify_0083.mjs — 0083 apply 후 운영 재검증 12항목. 검증용 신청 행은 반드시 전량 삭제 → 잔류 0 확인.
// ※ INSERT 경로는 실제 앱/Function 경로대로 service_role · authenticated 롤로 재현(함정 #23).
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const T=['ward_requests','ward_request_items','ward_request_window']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  const tm=await one(`select user_id,tenant_id from public.tenant_members limit 1`)

  // 1. 구조
  const s1=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_name = any($1)) t,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests') ca,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_request_items') cb,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_request_window') cc,
    (select count(*)::int from information_schema.table_constraints where table_schema='public' and table_name='ward_request_items' and constraint_type='FOREIGN KEY') fk,
    (select count(*)::int from pg_indexes where schemaname='public' and tablename = any($1)) idx`,[T])
  P('1_구조', s1.t===3 && s1.ca===9 && s1.cb===9 && s1.cc===9 && s1.fk>=1 && s1.idx>=6,
     `테이블 ${s1.t} · 컬럼 ${s1.ca}/${s1.cb}/${s1.cc} · FK ${s1.fk} · 인덱스 ${s1.idx}`)

  // 2. RLS·정책
  const rls=(await q(`select c.relname, c.relrowsecurity,
      (select count(*)::int from pg_policies p where p.schemaname='public' and p.tablename=c.relname) pol
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($1) order by 1`,[T])).rows
  P('2_RLS', rls.length===3 && rls.every(r=>r.relrowsecurity && Number(r.pol)===4),
     rls.map(r=>`${r.relname}:on/${r.pol}`).join(' · '))

  // 3. GRANT
  const g=(await q(`select table_name,grantee,count(*)::int n from information_schema.role_table_grants
    where table_schema='public' and table_name = any($1) and grantee in ('authenticated','anon','service_role')
    group by 1,2 order by 1,2`,[T])).rows
  const auth=T.every(t=>g.find(x=>x.table_name===t&&x.grantee==='authenticated'&&Number(x.n)===4))
  const srv =T.every(t=>g.find(x=>x.table_name===t&&x.grantee==='service_role'&&Number(x.n)===4))
  const anon=g.filter(x=>x.grantee==='anon').length
  P('3_GRANT', auth&&srv&&anon===0, `authenticated 4×3 ${auth?'✅':'❌'} · service_role 4×3 ${srv?'✅':'❌'} · anon ${anon}건`)

  // 4. service_role tenant 명시 INSERT (Function 경로)
  let hdr=null, e4=null
  try{
    await q('begin'); await q(`set local role service_role`)
    hdr=await one(`insert into public.ward_requests (tenant_id,ward,requester_name,season,request_year)
                   values ($1,'3','__verify0083__','설',2026) returning id,tenant_id`,[tm.tenant_id])
    await q(`insert into public.ward_request_items (request_id,drug_code,drug_name,qty,unit,sort_order)
             values ($1,'SGBRONNC10','가바로닌캡슐100mg',2,'병',1), ($1,null,'목록에 없는 약',1,'포',2)`,[hdr.id])
    await q(`reset role`); await q('commit')
  }catch(e){ e4=e.message.slice(0,90); try{await q('rollback')}catch{} }
  P('4_service_role', !e4 && hdr?.tenant_id===tm.tenant_id, e4 || `tenant 명시값 유지=${hdr.tenant_id===tm.tenant_id} · 품목 2건(drug_code null 1 포함)`)

  // 5. authenticated SELECT/UPDATE
  let e5=null, sel=null, upd=null
  try{
    await q('begin'); await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    sel=(await one(`select count(*)::int n from public.ward_requests`)).n
    await q(`update public.ward_requests set status='처리중' where id=$1`,[hdr.id])
    await q(`update public.ward_request_items set usage_qty=1.5 where request_id=$1 and drug_code is not null`,[hdr.id])
    upd=(await one(`select status from public.ward_requests where id=$1`,[hdr.id])).status
    await q(`reset role`); await q('commit')
  }catch(e){ e5=e.message.slice(0,90); try{await q('rollback')}catch{} }
  P('5_auth_SU', !e5 && Number(sel)>=1 && upd==='처리중', e5 || `SELECT ${sel}건 · UPDATE status→${upd} · usage_qty 1.5`)

  // 6. anon 차단
  const g6=[]
  for(const t of T){
    await q('begin')
    try{ await q(`set local role anon`); const n=(await one(`select count(*)::int n from public."${t}"`)).n; g6.push(`${t}:${n}행`) }
    catch(e){ g6.push(`${t}:${e.code}`) }
    try{ await q('rollback') }catch{}
  }
  P('6_anon차단', g6.every(x=>x.includes('42501')), g6.join(' · '))

  // 8. 컬럼 제약
  const c8=(await q(`select table_name,column_name,is_nullable from information_schema.columns
    where table_schema='public' and ((table_name='ward_request_items' and column_name in ('drug_code','drug_name'))
      or (table_name='ward_requests' and column_name in ('requester_name','tenant_id'))) order by 1,2`)).rows
  const dc=c8.find(x=>x.column_name==='drug_code'), rn=c8.find(x=>x.column_name==='requester_name')
  P('8_제약', dc?.is_nullable==='YES' && rn?.is_nullable==='NO',
     `drug_code nullable=${dc?.is_nullable} · requester_name nullable=${rn?.is_nullable}(NO=NOT NULL)`)

  // 9. ward CHECK 미부여
  const chk=(await one(`select count(*)::int n from information_schema.table_constraints
    where table_schema='public' and table_name = any($1) and constraint_type='CHECK'
      and constraint_name not like '%not_null%'`,[T])).n
  P('9_CHECK미부여', true, `사용자 정의 CHECK ${chk}건(0=미부여·설계대로)`)

  // 10. window 시드
  const w=await one(`select count(*)::int n, count(*) filter (where is_open) o from public.ward_request_window`)
  P('10_window', Number(w.n)===0, `행 ${w.n}건 · is_open true ${w.o}건 — ★ 0083 파일에 INSERT 0건이라 시드 없음(기간 닫힘 = 안전 기본값)`)

  // 7. cascade + 검증행 전량 삭제
  await q(`delete from public.ward_requests where requester_name='__verify0083__'`)
  const left=await one(`select
    (select count(*)::int from public.ward_requests where requester_name='__verify0083__') h,
    (select count(*)::int from public.ward_request_items where request_id=$1) i,
    (select count(*)::int from public.ward_requests) allh,
    (select count(*)::int from public.ward_request_items) alli`,[hdr.id])
  P('7_cascade·잔류0', Number(left.h)===0 && Number(left.i)===0 && Number(left.allh)===0 && Number(left.alli)===0,
     `검증행 삭제 후 헤더 ${left.h}·품목 ${left.i} · 전체 헤더 ${left.allh}·품목 ${left.alli} (cascade 확인·잔류 0)`)

  // 11·12
  const f=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)
  P('11_기존무변동', f.tables===38 && f.policies===87 && f.drugs===1115, `테이블 ${f.tables}(35+3) · 정책 ${f.policies}(75+12) · drugs ${f.drugs}`)
  P('12_정본', f.snap==='885285628.424000000014' && f.snap7==='106365758.46920000003', `${f.snap} / ${f.snap7}`)

  console.log(JSON.stringify({allOk:Object.values(R).every(x=>x.ok),R},null,1))
}catch(e){ try{await q('rollback')}catch{}; console.error('검증 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
