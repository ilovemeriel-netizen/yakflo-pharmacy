// dryrun_0074.mjs — 0074 calendar_events.end_date dryrun (BEGIN → ALTER → 검증 A~D → ROLLBACK). 운영(phg). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
let ddl=readFileSync('supabase/migrations/0074_calendar_events_end_date.sql','utf8').replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
const q=(s,a)=>client.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(46),v)
await client.connect()
try{
  await q('begin')
  const snapAll0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s, count(*)::int n from public.monthly_snapshots where snap_year=2026 and snap_month=7`)
  const existBefore=Number((await one(`select count(*)::int n from public.calendar_events`)).n)
  const own=await one(`select user_id, tenant_id from public.tenant_members where role='owner' limit 1`)
  await q(`select set_config('request.jwt.claim.sub',$1,true)`,[own.user_id])
  // 기존 단일 날짜 행(컬럼 추가 전) — 호환성 확인용
  await q(`insert into public.calendar_events(title,event_date,category) values ('dryrun 단일','2026-09-10','발주')`)
  // ALTER (end_date + CHECK)
  await q(ddl)
  // A. 기존 행 end_date NULL
  const rA=await one(`select end_date from public.calendar_events where title='dryrun 단일' limit 1`)
  const colNull=(await one(`select is_nullable from information_schema.columns where table_schema='public' and table_name='calendar_events' and column_name='end_date'`))?.is_nullable
  // B. 기간 일정 INSERT (event_date < end_date)
  let bOk=false, bErr=''
  try{ await q(`insert into public.calendar_events(title,event_date,end_date,category) values ('dryrun 기간','2026-09-24','2026-09-26','근무')`); bOk=true }catch(e){ bErr=e.message }
  const rB=await one(`select event_date, end_date from public.calendar_events where title='dryrun 기간' limit 1`)
  // C. end_date < event_date → CHECK 차단
  let cBlocked=false, cMsg=''
  await q('savepoint sp_c')
  try{ await q(`insert into public.calendar_events(title,event_date,end_date,category) values ('dryrun 역전','2026-09-26','2026-09-24','휴일')`) }catch(e){ cBlocked=true; cMsg=e.message.split('\n')[0] }
  await q('rollback to savepoint sp_c')
  // 제약 존재 확인
  const chk=(await q(`select conname from pg_constraint where conname='calendar_events_enddate_chk' and conrelid='public.calendar_events'::regclass`)).rows.length
  // D. 정본 무변동
  const snapAll1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  await q('rollback')

  console.log('\n════════ 0074 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('사전 calendar_events 행수(운영)', existBefore+'행')
  P('A. end_date 컬럼 nullable', colNull==='YES'?'✅':'❌ '+colNull)
  P('A. 기존(추가 전) 행 end_date', (rA && rA.end_date===null)?'✅ NULL':'❌ '+JSON.stringify(rA))
  P('B. 기간 일정 INSERT 성공', bOk?'✅':'❌ '+bErr)
  P('   저장값(event~end)', rB?`${rB.event_date&&rB.event_date.toISOString?rB.event_date.toISOString().slice(0,10):rB.event_date} ~ ${rB.end_date&&rB.end_date.toISOString?rB.end_date.toISOString().slice(0,10):rB.end_date} ✅`:'❌')
  P('C. end_date<event_date CHECK 차단', cBlocked?'✅ 차단':'❌ 통과됨')
  P('   차단 메시지', cMsg||'(없음)')
  P('   CHECK 제약 존재', chk?'✅ calendar_events_enddate_chk':'❌')
  P('D. 정본 1~7월 closing 합(전/후)', `${Math.round(Number(snapAll0.s)).toLocaleString()} → ${Math.round(Number(snapAll1.s)).toLocaleString()} ${Number(snapAll0.s)===Number(snapAll1.s)?'✅ 무변동':'❌'}`)
  P('   7월 기말(스냅 '+snap7.n+'행)', `${Math.round(Number(snap7.s)).toLocaleString()} ${Math.round(Number(snap7.s))===106365758?'✅ 정본 일치':'⚠'}`)
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('DRYRUN 오류:',e.message); process.exitCode=1 }
finally{ await client.end() }
