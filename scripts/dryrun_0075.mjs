// dryrun_0075.mjs — 0075 holidays dryrun (BEGIN → 생성 → 검증 A~D → ROLLBACK). 운영(phg). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
let ddl=readFileSync('supabase/migrations/0075_holidays.sql','utf8').replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const q=(s,a)=>client.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(46),v)
await client.connect()
try{
  await q('begin')
  const snapAll0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s, count(*)::int n from public.monthly_snapshots where snap_year=2026 and snap_month=7`)
  await q(ddl)
  // A. 구조
  const tbl=Number((await one(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='holidays'`)).n)
  const cols=(await q(`select column_name from information_schema.columns where table_schema='public' and table_name='holidays' order by ordinal_position`)).rows.map(r=>r.column_name)
  const hasTenant=cols.includes('tenant_id')
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and tablename='holidays'`)).rows.map(r=>r.indexname).sort()
  const uniq=(await q(`select conname from pg_constraint where conname='holidays_date_name_key' and conrelid='public.holidays'::regclass`)).rows.length
  const rls=(await one(`select relrowsecurity r from pg_class where oid='public.holidays'::regclass`)).r
  const pol=(await q(`select policyname, cmd, roles::text from pg_policies where schemaname='public' and tablename='holidays'`)).rows
  // B. INSERT + 중복 차단
  await q(`insert into public.holidays(year,date,name) values (2026,'2026-09-25','추석')`)
  let dupBlocked=false, dupMsg=''
  await q('savepoint sp_dup'); try{ await q(`insert into public.holidays(year,date,name) values (2026,'2026-09-25','추석')`) }catch(e){ dupBlocked=true; dupMsg=e.message.split('\n')[0] } ; await q('rollback to savepoint sp_dup')
  const cntPg=Number((await one(`select count(*)::int n from public.holidays`)).n)
  // C. 인증 사용자 SELECT 가능 + 쓰기 차단
  const own=await one(`select user_id from public.tenant_members limit 1`)
  await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[own.user_id])
  const selN=Number((await one(`select count(*)::int n from public.holidays`)).n)
  let writeBlocked=false, wMsg=''
  await q('savepoint sp_w'); try{ await q(`insert into public.holidays(year,date,name) values (2026,'2026-01-01','신정')`) }catch(e){ writeBlocked=true; wMsg=(e.message.split('\n')[0]) } ; await q('rollback to savepoint sp_w')
  await q('reset role')
  // D. 정본 무변동
  const snapAll1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  await q('rollback')

  console.log('\n════════ 0075 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('A. holidays 테이블 생성', tbl===1?'✅':'❌')
  P('   tenant_id 없음(공유)', hasTenant?'❌ tenant_id 있음':'✅ 없음')
  P('   컬럼', cols.join(', '))
  P('   인덱스', idx.join(', ')+((idx.includes('idx_holidays_year')&&idx.includes('idx_holidays_date'))?' ✅':' ❌'))
  P('   UNIQUE(date,name)', uniq?'✅':'❌')
  P('   RLS 활성', rls?'✅':'❌')
  P('   SELECT 정책(authenticated)', pol.length?('✅ '+pol.map(p=>p.policyname+'/'+p.cmd).join(',')):'❌')
  P('B. INSERT(service_role/postgres)', cntPg>=1?'✅':'❌')
  P('   중복(date,name) 차단', dupBlocked?'✅ '+dupMsg.slice(0,40):'❌ 미차단')
  P('C. 인증 사용자 SELECT', selN>=1?('✅ '+selN+'행 조회'):'❌')
  P('   인증 사용자 쓰기 차단', writeBlocked?'✅ 차단('+wMsg.slice(0,30)+')':'❌ 쓰기됨')
  P('D. 정본 1~7월 closing 합(전/후)', `${Math.round(Number(snapAll0.s)).toLocaleString()} → ${Math.round(Number(snapAll1.s)).toLocaleString()} ${Number(snapAll0.s)===Number(snapAll1.s)?'✅ 무변동':'❌'}`)
  P('   7월 기말(스냅 '+snap7.n+'행)', `${Math.round(Number(snap7.s)).toLocaleString()} ${Math.round(Number(snap7.s))===106365758?'✅ 정본 일치':'⚠'}`)
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('DRYRUN 오류:',e.message); process.exitCode=1 }
finally{ await client.end() }
