// verify_0084.mjs — apply 후 운영 검증(읽기 전용 + 롤백되는 트랜잭션 테스트).
// 컬럼 4개 · GRANT · anon 42501 · 기존 INSERT 경로 정상 · 테이블/정책 수 · 1~7월 정본 무변동.
// ★ 접수 기간을 열거나 닫지 않는다. INSERT 테스트는 savepoint로 되돌린다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const NEW=['pw_hash','pw_salt','pw_fail','pw_locked_until']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  // 1) 컬럼 4개
  const cc=(await q(`select column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema='public' and table_name='ward_requests'
      and column_name = any($1) order by column_name`,[NEW])).rows
  const b=Object.fromEntries(cc.map(r=>[r.column_name,r]))
  P('컬럼4개', cc.length===4 && b.pw_hash?.data_type==='text' && b.pw_salt?.data_type==='text'
      && b.pw_fail?.data_type==='smallint' && b.pw_locked_until?.data_type==='timestamp with time zone',
    cc.map(r=>`${r.column_name}:${r.data_type}/${r.is_nullable==='YES'?'null허용':'NOT NULL'}`).join(' · '))

  // 2) GRANT
  const gr=(await q(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='ward_requests' and grantee in ('authenticated','service_role','anon')`)).rows
  const has=(g,p)=>gr.some(r=>r.grantee===g&&r.privilege_type===p)
  const gOk=['SELECT','INSERT','UPDATE','DELETE'].every(p=>has('authenticated',p)&&has('service_role',p))
  const anonN=gr.filter(r=>r.grantee==='anon').length
  P('GRANT', gOk && anonN===0, `authenticated·service_role 4권한=${gOk} · anon ${anonN}건`)

  // 3) anon 차단
  let g='?'
  await q('begin')
  try{ await q(`set local role anon`); const n=(await one(`select count(*)::int n from public.ward_requests`)).n; g=`${n}행(문제)` }
  catch(e){ g=e.code }
  try{ await q('reset role') }catch{}
  await q('rollback')
  P('anon차단', g==='42501', `anon SELECT → ${g}`)

  // 4) 기존 INSERT 경로 정상 (5필드) — savepoint로 되돌린다
  let iOk=false, iErr=null, iRow=null
  const tm=await one(`select tenant_id from public.tenant_members limit 1`)
  await q('begin')
  try{
    await q(`set local role service_role`)
    iRow=await one(`insert into public.ward_requests (tenant_id, ward, requester_name, season, request_year)
                    values ($1,'3','__verify0084__','설',2026) returning pw_fail, pw_hash, pw_salt, pw_locked_until`,[tm.tenant_id])
    iOk = Number(iRow.pw_fail)===0 && iRow.pw_hash===null && iRow.pw_salt===null && iRow.pw_locked_until===null
  }catch(e){ iErr=e.message.slice(0,110) }
  try{ await q('reset role') }catch{}
  await q('rollback')
  P('기존INSERT경로', iOk, iErr || `5필드 INSERT 성공 · pw_fail=${iRow?.pw_fail} · 나머지 3컬럼 null (롤백됨)`)

  // 5) 테이블·정책 수 · 컬럼 수
  const s=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests') cols`)
  P('구조', s.tables===38 && s.policies===87 && s.cols===13, `테이블 ${s.tables}(기대 38) · 정책 ${s.policies}(기대 87) · ward_requests 컬럼 ${s.cols}(기대 13)`)

  // 6) 정본
  const sn=await one(`select
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) s,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) s7`)
  P('정본', sn.s==='885285628.424000000014' && sn.s7==='106365758.46920000003', `1~7월 ${sn.s} · 7월 ${sn.s7}`)

  // 7) 접수 기간 무변경 확인(읽기만)
  const w=(await q(`select season, request_year, is_open from public.ward_request_window`)).rows
  P('접수기간_무변경', true, w.map(r=>`${r.request_year} ${r.season} is_open=${r.is_open}`).join(' · ') + ' (읽기만 — 변경하지 않음)')

  const pad=x=>x.padEnd(18); let all=true
  for(const [k,v] of Object.entries(R)){ if(!v.ok) all=false; console.log(`${v.ok?'✅':'❌'} ${pad(k)} ${v.d}`) }
  console.log(`\n종합: ${all?'✅ 전 항목 통과':'❌ 실패 항목 있음'}`)
  process.exit(all?0:1)
}catch(e){ console.error('verify 중단:', e.message); process.exit(1) }
finally{ await c.end() }
