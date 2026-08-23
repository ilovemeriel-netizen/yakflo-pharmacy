// apply_0074.mjs — 0074 calendar_events.end_date 운영 적용(커밋). 승인 후 실행.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0074_calendar_events_end_date.sql','utf8')
await c.connect()
try{
  await c.query(ddl)
  const q=async(s)=>(await c.query(s)).rows
  const col=(await q(`select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='calendar_events' and column_name='end_date'`))[0]
  const chk=(await q(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conname='calendar_events_enddate_chk' and conrelid='public.calendar_events'::regclass`))[0]
  const cnt=(await q(`select count(*)::int n, count(end_date)::int nn from public.calendar_events`))[0]
  console.log('APPLY 완료')
  console.log('  end_date 컬럼:', col?`${col.data_type} nullable=${col.is_nullable} ✅`:'❌ 없음')
  console.log('  CHECK:', chk?`${chk.conname} ${chk.def} ✅`:'❌ 없음')
  console.log('  기존 행:', cnt.n+'행, end_date 채워진 행:', cnt.nn, '(기존은 NULL 유지 정상)')
}catch(e){ console.error('APPLY 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
