// dryrun_0084.mjs — ward_requests 비밀번호 컬럼 4개 추가 dryrun.
// BEGIN→DDL→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
// A.컬럼 B.기본값·null허용 C.GRANT D.기존 INSERT 경로 무파손(service_role, 5필드)
// E.authenticated INSERT(트리거 tenant 자동부여 · 함정 #23) F.pw UPDATE·조회
// G.anon 차단 H.기존 무변동 I.정본
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0084_ward_requests_password.sql','utf8')
const NEW=['pw_hash','pw_salt','pw_fail','pw_locked_until']
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  const pre = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests') cols,
    (select count(*)::int from public.drugs) drugs,
    (select count(*)::int from public.ward_requests) reqs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)
  const tm = await one(`select user_id, tenant_id from public.tenant_members limit 1`)

  await q('begin'); await q(ddl)

  // A. 컬럼 4개 추가 · 타입
  const cc = (await q(`select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema='public' and table_name='ward_requests' and column_name = any($1)
    order by column_name`,[NEW])).rows
  const byName = Object.fromEntries(cc.map(r=>[r.column_name,r]))
  P('A_컬럼', cc.length===4
      && byName.pw_hash?.data_type==='text'
      && byName.pw_salt?.data_type==='text'
      && byName.pw_fail?.data_type==='smallint'
      && byName.pw_locked_until?.data_type==='timestamp with time zone',
    cc.map(r=>`${r.column_name}:${r.data_type}`).join(' · '))

  // B. nullable / default — 기존 INSERT 경로를 깨지 않는 전제
  const nullOk = byName.pw_hash?.is_nullable==='YES' && byName.pw_salt?.is_nullable==='YES'
              && byName.pw_locked_until?.is_nullable==='YES'
  const failOk = byName.pw_fail?.is_nullable==='NO' && String(byName.pw_fail?.column_default||'').startsWith('0')
  P('B_null·기본값', nullOk && failOk,
    `pw_hash/salt/locked_until nullable=${nullOk} · pw_fail NOT NULL default 0=${failOk}`)

  // B-2. CHECK 미부여 확인
  const chk = (await one(`select count(*)::int n from information_schema.constraint_column_usage u
    join information_schema.table_constraints t on t.constraint_name=u.constraint_name
    where u.table_schema='public' and u.table_name='ward_requests'
      and t.constraint_type='CHECK' and u.column_name = any($1)`,[NEW])).n
  P('B2_CHECK없음', Number(chk)===0, `새 컬럼에 걸린 CHECK ${chk}건(0이어야 함)`)

  // C. GRANT — 컬럼 추가는 테이블 권한을 물려받는다. 명시 재선언까지 확인
  const gr = (await q(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='ward_requests' and grantee in ('authenticated','service_role','anon')`)).rows
  const has = (g,p)=>gr.some(r=>r.grantee===g && r.privilege_type===p)
  const grantOk = ['SELECT','INSERT','UPDATE','DELETE'].every(p=>has('authenticated',p) && has('service_role',p))
  const anonN = gr.filter(r=>r.grantee==='anon').length
  P('C_GRANT', grantOk && anonN===0, `authenticated·service_role 4권한=${grantOk} · anon 부여 ${anonN}건(0이어야 함)`)

  // D. ★ 기존 INSERT 경로 무파손 — ward-submit의 5필드 INSERT가 그대로 통과해야 한다
  let hdr=null, dOk=false, dErr=null, dFail=null
  await q('savepoint sp_d')
  try{
    await q(`set local role service_role`)
    hdr = await one(`insert into public.ward_requests (tenant_id, ward, requester_name, season, request_year)
                     values ($1,'3','__dryrun0084__','설',2026) returning id, tenant_id, pw_fail, pw_hash, pw_salt, pw_locked_until`,[tm.tenant_id])
    dFail = hdr.pw_fail
    dOk = hdr.tenant_id===tm.tenant_id && Number(hdr.pw_fail)===0
       && hdr.pw_hash===null && hdr.pw_salt===null && hdr.pw_locked_until===null
  }catch(e){ dErr=e.message.slice(0,110) }
  try{ await q('reset role') }catch{}
  P('D_기존INSERT무파손', dOk, dErr || `비밀번호 컬럼 없이 INSERT 성공 · pw_fail 기본값 ${dFail} · 나머지 3컬럼 null · tenant 명시값 유지`)

  // E. authenticated INSERT — 함정 #23: postgres 롤이면 set_tenant_id 무발동
  let eOk=false, eErr=null, eTid=null
  await q('savepoint sp_e')
  try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    const r = await one(`insert into public.ward_requests (ward, requester_name, season, request_year)
                         values ('4','__dryrun0084_auth__','설',2026) returning tenant_id, pw_fail`)
    eTid = r.tenant_id
    eOk = r.tenant_id===tm.tenant_id && Number(r.pw_fail)===0
  }catch(e){ eErr=e.message.slice(0,110) }
  try{ await q('reset role') }catch{}
  await q('rollback to savepoint sp_e')
  P('E_auth_INSERT', eOk, eErr || `트리거가 tenant_id 자동 부여(${String(eTid).slice(0,8)}…) · pw_fail 0`)

  // F. 비밀번호 UPDATE·조회 (Function이 할 동작)
  let fOk=false, fErr=null, fRow=null
  await q('savepoint sp_f')
  try{
    await q(`set local role service_role`)
    await q(`update public.ward_requests set pw_hash=$2, pw_salt=$3 where id=$1`,[hdr.id,'a'.repeat(128),'b'.repeat(32)])
    await q(`update public.ward_requests set pw_fail = pw_fail + 1 where id=$1`,[hdr.id])
    await q(`update public.ward_requests set pw_locked_until = now() + interval '10 minutes' where id=$1`,[hdr.id])
    fRow = await one(`select length(pw_hash) h, length(pw_salt) s, pw_fail, (pw_locked_until > now()) locked from public.ward_requests where id=$1`,[hdr.id])
    await q(`update public.ward_requests set pw_fail=0, pw_locked_until=null where id=$1`,[hdr.id])
    const after = await one(`select pw_fail, pw_locked_until from public.ward_requests where id=$1`,[hdr.id])
    fOk = Number(fRow.h)===128 && Number(fRow.s)===32 && Number(fRow.pw_fail)===1 && fRow.locked===true
       && Number(after.pw_fail)===0 && after.pw_locked_until===null
  }catch(e){ fErr=e.message.slice(0,110) }
  try{ await q('reset role') }catch{}
  await q('rollback to savepoint sp_f')
  P('F_pw_UPDATE', fOk, fErr || `해시128·salt32 저장 · pw_fail 1 · 잠금 활성 · 초기화 시 0/null 복귀`)

  // G. anon 차단 — 비밀번호 컬럼이 생겨도 anon은 여전히 못 읽어야 한다
  let gRes='?'
  await q('savepoint sp_g')
  try{ await q(`set local role anon`); const n=(await one(`select count(*)::int n from public.ward_requests`)).n; gRes=`${n}행 조회됨(문제)` }
  catch(e){ gRes=e.code }
  try{ await q('reset role') }catch{}
  await q('rollback to savepoint sp_g')
  P('G_anon차단', gRes==='42501', `anon SELECT → ${gRes}`)

  // H. 기존 무변동 — 테이블·정책 수 그대로, ward_requests 컬럼만 +4
  const post = await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests') cols,
    (select count(*)::int from public.drugs) drugs`)
  P('H_기존무변동',
    post.tables===pre.tables && post.policies===pre.policies && post.cols===pre.cols+4 && post.drugs===pre.drugs,
    `테이블 ${pre.tables}→${post.tables} · 정책 ${pre.policies}→${post.policies} · ward_requests 컬럼 ${pre.cols}→${post.cols} · drugs ${pre.drugs}`)

  // I. 정본 무오차
  const snap = await one(`select
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) s,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) s7`)
  P('I_정본', snap.s===pre.snap && snap.s7===pre.snap7, `1~7월 ${snap.s} · 7월 ${snap.s7} (변동 없음)`)

  await q('rollback')
  console.log('\n※ 전량 ROLLBACK 완료 — 운영에 아무것도 남기지 않았습니다.\n')
  const pad=s=>s.padEnd(20)
  let allOk=true
  for(const [k,v] of Object.entries(R)){ if(!v.ok) allOk=false; console.log(`${v.ok?'✅':'❌'} ${pad(k)} ${v.d}`) }
  console.log(`\n종합: ${allOk?'✅ 전 항목 통과 — apply 승인 요청 가능':'❌ 실패 항목 있음 — apply 금지'}`)
  process.exit(allOk?0:1)
}catch(e){
  try{ await q('rollback') }catch{}
  console.error('dryrun 중단:', e.message)
  process.exit(1)
} finally { await c.end() }
