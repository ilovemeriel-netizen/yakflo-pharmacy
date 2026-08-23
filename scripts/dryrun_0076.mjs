// dryrun_0076.mjs — 0076 공유 레퍼런스 6개 RLS 정렬 dryrun (BEGIN → 실행 → 검증 A~J → ROLLBACK). 운영(phg). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
let ddl=readFileSync('supabase/migrations/0076_shared_ref_rls.sql','utf8').replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(52),v)
const T6=['drug_discontinuation','drug_harmful','drug_status_alerts','dur_age_contraindication','dur_elderly_caution','dur_pregnancy_contraindication']
const priv=async(role,t,a)=>(await one(`select has_table_privilege($1,$2,$3) v`,[role,'public.'+t,a])).v
const polCnt=async t=>{const r=await q(`select cmd from pg_policies where schemaname='public' and tablename=$1`,[t]);return r.rows}
const rlsOn=async t=>(await one(`select relrowsecurity r from pg_class where oid=('public.'||$1)::regclass`,[t])).r
await c.connect()
try{
  await q('begin')
  // 베이스라인(before)
  const beforePriv={}; for(const t of T6){beforePriv[t]={anon:[],auth:[]};for(const a of['SELECT','INSERT','UPDATE','DELETE']){if(await priv('anon',t,a))beforePriv[t].anon.push(a[0]);if(await priv('authenticated',t,a))beforePriv[t].auth.push(a[0])}}
  const dmPolB=(await polCnt('drug_master')).length, hlPolB=(await polCnt('holidays')).length
  const dmAnonSelB=await priv('anon','drug_master','SELECT'), hlAuthSelB=await priv('authenticated','holidays','SELECT')
  const opsB={}; for(const t of['drugs','inventory_stock','monthly_snapshots','transactions']){opsB[t]={rls:await rlsOn(t),pol:(await polCnt(t)).length}}
  const snap0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)

  await q(ddl) // 0076 실행

  // A. RLS on
  let aOk=true; for(const t of T6){if(!await rlsOn(t))aOk=false}
  // B. SELECT 1종·쓰기 0종
  let bOk=true, bDetail=[]; for(const t of T6){const cmds=(await polCnt(t)).map(r=>r.cmd);const sel=cmds.filter(x=>x==='SELECT').length;const wr=cmds.filter(x=>x!=='SELECT').length;bDetail.push(`${t}:S${sel}/W${wr}`);if(sel!==1||wr!==0)bOk=false}
  // C. anon 전부 회수 / D. auth SELECT만
  let cOk=true,dOk=true,afterPriv={}; for(const t of T6){afterPriv[t]={anon:[],auth:[]};for(const a of['SELECT','INSERT','UPDATE','DELETE']){if(await priv('anon',t,a)){afterPriv[t].anon.push(a[0]);cOk=false}const av=await priv('authenticated',t,a);if(av)afterPriv[t].auth.push(a[0])}const au=afterPriv[t].auth.join('');if(au!=='S')dOk=false}
  // E/F/G: 역할별 동작 (샘플 테이블 1개)
  const st=T6[0]
  let eOk=false,eErr='',fBlk=false,fErr='',gOk=false,gErr=''
  // E: authenticated SELECT (savepoint 롤백이 set local role까지 원복 → reset role 불요)
  await q('savepoint sp1'); try{await q(`set local role authenticated`);await q(`select set_config('request.jwt.claim.sub',(select user_id::text from public.tenant_members limit 1),true)`);await one(`select count(*)::int n from public.${st}`);eOk=true}catch(e){eErr=e.code+' '+e.message.split('\n')[0].slice(0,50)}
  await q('rollback to savepoint sp1')
  // F: authenticated INSERT → 42501 차단
  await q('savepoint sp2'); try{await q(`set local role authenticated`);await q(`select set_config('request.jwt.claim.sub',(select user_id::text from public.tenant_members limit 1),true)`);await q(`insert into public.${st} default values`)}catch(e){fBlk=(e.code==='42501');fErr=e.code+' '+e.message.split('\n')[0].slice(0,50)}
  await q('rollback to savepoint sp2')
  // G: service_role INSERT (42501만 아니면 쓰기 경로 보존 — NOT NULL 등은 grant/RLS 통과 방증)
  await q('savepoint sp3'); try{await q(`set local role service_role`);await q(`insert into public.${st} default values`);gOk=true}catch(e){gOk=(e.code!=='42501');gErr=e.code+' '+e.message.split('\n')[0].slice(0,50)}
  await q('rollback to savepoint sp3')
  // H. drug_master/holidays 무변동
  const dmPolA=(await polCnt('drug_master')).length, hlPolA=(await polCnt('holidays')).length
  const hOk=(dmPolA===dmPolB)&&(hlPolA===hlPolB)&&(await priv('anon','drug_master','SELECT'))===dmAnonSelB&&(await priv('authenticated','holidays','SELECT'))===hlAuthSelB
  // I. 운영 4개 무변동
  let iOk=true,iDetail=[]; for(const t of['drugs','inventory_stock','monthly_snapshots','transactions']){const rls=await rlsOn(t),pol=(await polCnt(t)).length;if(rls!==opsB[t].rls||pol!==opsB[t].pol)iOk=false;iDetail.push(`${t}:RLS${rls?'on':'off'}/${pol}pol`)}
  // J. 정본
  const snap1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)

  await q('rollback')

  console.log('\n════════ 0076 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('A. 6개 전부 RLS on', aOk?'✅':'❌')
  P('B. 6개 SELECT 1종·쓰기 0종', (bOk?'✅ ':'❌ ')+bDetail.join(' '))
  P('C. anon S/I/U/D 전부 회수', cOk?'✅':'❌ 잔존')
  P('D. authenticated SELECT만(IUD 회수)', dOk?'✅':'❌')
  P('E. authenticated SELECT 가능', eOk?'✅':'❌ '+fErr)
  P('F. authenticated INSERT 차단(42501)', fBlk?'✅ 차단':'❌ '+fErr)
  P('G. service_role INSERT 가능(쓰기 보존)', gOk?('✅ '+(gErr?'(grant OK, '+gErr+')':'insert OK')):'❌ '+gErr)
  P('H. drug_master·holidays 무변동', hOk?'✅':'❌')
  P('I. 운영 4개 테이블 무변동', (iOk?'✅ ':'❌ ')+iDetail.join(' '))
  P('J. 정본 1~7월(전/후)', `${Math.round(Number(snap0.s)).toLocaleString()}→${Math.round(Number(snap1.s)).toLocaleString()} ${Number(snap0.s)===Number(snap1.s)?'✅':'❌'} · 7월 ${Math.round(Number(snap7.s)).toLocaleString()}${Math.round(Number(snap7.s))===106365758?'✅':'⚠'}`)
  console.log('\n── 권한 before → after (6개) ──')
  for(const t of T6){P('  '+t, `anon[${beforePriv[t].anon.join('')||'-'}]→[${afterPriv[t].anon.join('')||'-'}] · auth[${beforePriv[t].auth.join('')||'-'}]→[${afterPriv[t].auth.join('')||'-'}]`)}
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('DRYRUN 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
