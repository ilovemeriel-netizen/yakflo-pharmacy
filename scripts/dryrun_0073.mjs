// dryrun_0073.mjs — 0073_calendar_events dryrun (BEGIN → 생성 → 검증 A~D → ROLLBACK). 운영(phg). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
let ddl=readFileSync('supabase/migrations/0073_calendar_events.sql','utf8').replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const q=(s,a)=>client.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(46),v)
await client.connect()
try{
  await q('begin')
  // 베이스라인(정본)
  const snapAll0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s, count(*)::int n from public.monthly_snapshots where snap_year=2026 and snap_month=7`)
  // 생성
  await q(ddl)
  // A. 구조
  const tbl=Number((await one(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='calendar_events'`)).n)
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and tablename='calendar_events'`)).rows.map(r=>r.indexname)
  const pol=(await q(`select cmd from pg_policies where schemaname='public' and tablename='calendar_events' order by cmd`)).rows.map(r=>r.cmd)
  const rls=(await one(`select relrowsecurity r from pg_class where oid='public.calendar_events'::regclass`)).r
  // 소유자 uid/tenant
  const own=await one(`select user_id, tenant_id from public.tenant_members where role='owner' limit 1`)
  // B. tenant 자동 충전(claim 설정 → auth.uid())
  await q(`select set_config('request.jwt.claim.sub',$1,true)`,[own.user_id])
  await q(`insert into public.calendar_events(title,event_date,category,memo) values ('dryrun 발주','2026-08-25','발주','테스트')`)
  const rowB=await one(`select tenant_id, title, event_date, category from public.calendar_events where title='dryrun 발주' limit 1`)
  const bOk=rowB && rowB.tenant_id && String(rowB.tenant_id)===String(own.tenant_id)
  // C. 타 tenant 조회 차단 — 임시 2번째 tenant + 이벤트 생성(postgres) 후 authenticated로 격리 확인
  const t2=await one(`insert into public.tenants(id,name,slug,plan,created_at) values (gen_random_uuid(),'dryrun-t2','dryrun-t2-'||substr(md5(random()::text),1,8),'free',now()) returning id`)
  await q(`insert into public.calendar_events(tenant_id,title,event_date,category) values ($1,'타테넌트 일정','2026-08-26','기타')`,[t2.id])
  const totalPg=Number((await one(`select count(*)::int n from public.calendar_events`)).n) // postgres 시점(전부 보임) = 2
  await q(`set local role authenticated`)
  await q(`select set_config('request.jwt.claim.sub',$1,true)`,[own.user_id])
  const visOwn=Number((await one(`select count(*)::int n from public.calendar_events where tenant_id=$1`,[own.tenant_id])).n)
  const visOther=Number((await one(`select count(*)::int n from public.calendar_events where tenant_id=$1`,[t2.id])).n)
  const visAll=Number((await one(`select count(*)::int n from public.calendar_events`)).n)
  await q(`reset role`)
  // D. 정본 무변동
  const snapAll1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  await q('rollback')

  console.log('\n════════ 0073 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('A. calendar_events 테이블 생성', tbl===1?'✅':'❌')
  P('   인덱스 idx_calendar_events_tenant_date', idx.includes('idx_calendar_events_tenant_date')?'✅ ['+idx.join(', ')+']':'❌ ['+idx.join(', ')+']')
  P('   RLS 활성', rls?'✅':'❌')
  P('   RLS 정책 4종', `${pol.length}종 [${pol.join(',')}] ${pol.length===4?'✅':'❌'}`)
  P('B. INSERT tenant_id 자동 충전', bOk?`✅ (${String(rowB.tenant_id).slice(0,8)}.. = 소유자 tenant)`:'❌ '+JSON.stringify(rowB))
  P('   저장값 확인', rowB?`title='${rowB.title}' date=${rowB.event_date&&rowB.event_date.toISOString?rowB.event_date.toISOString().slice(0,10):rowB.event_date} cat='${rowB.category}' ✅`:'❌')
  P('C. postgres 시점 전체 행수', totalPg+'행 (내 tenant 1 + 타 tenant 1)')
  P('   authenticated(소유자) 내 tenant 조회', visOwn+'행 '+(visOwn>=1?'✅':'❌'))
  P('   authenticated 타 tenant 조회 차단', visOther+'행 '+(visOther===0?'✅ 차단':'❌ 노출'))
  P('   authenticated 전체 가시 행수', visAll+'행 '+(visAll===visOwn?'✅ (타 tenant 불가시)':'❌'))
  P('D. 정본 1~7월 closing 합 (전/후)', `${Math.round(Number(snapAll0.s)).toLocaleString()} → ${Math.round(Number(snapAll1.s)).toLocaleString()} ${Number(snapAll0.s)===Number(snapAll1.s)?'✅ 무변동':'❌'}`)
  P('   7월 기말(스냅 '+snap7.n+'행)', `${Math.round(Number(snap7.s)).toLocaleString()} ${Math.round(Number(snap7.s))===106365758?'✅ 정본 일치':'⚠'}`)
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('DRYRUN 오류:',e.message); process.exitCode=1 }
finally{ await client.end() }
