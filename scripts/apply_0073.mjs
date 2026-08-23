// apply_0073.mjs — 0073_calendar_events 운영 적용(커밋). 승인 후 실행.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0073_calendar_events.sql','utf8')
await c.connect()
try{
  await c.query(ddl)
  const q=async(s)=>(await c.query(s)).rows
  const tbl=(await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='calendar_events'`))[0].n
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and tablename='calendar_events'`)).map(r=>r.indexname)
  const trg=(await q(`select tgname from pg_trigger where tgrelid='public.calendar_events'::regclass and not tgisinternal`)).map(r=>r.tgname)
  const pol=(await q(`select cmd from pg_policies where schemaname='public' and tablename='calendar_events' order by cmd`)).map(r=>r.cmd)
  const rls=(await q(`select relrowsecurity r from pg_class where oid='public.calendar_events'::regclass`))[0].r
  const cnt=(await q(`select count(*)::int n from public.calendar_events`))[0].n
  console.log('APPLY 완료')
  console.log('  테이블:', tbl===1?'생성됨 ✅':'❌')
  console.log('  인덱스:', idx.join(', '))
  console.log('  트리거:', trg.join(', '))
  console.log('  RLS:', rls?'활성 ✅':'❌', '· 정책', pol.length+'종 ['+pol.join(',')+']', pol.length===4?'✅':'❌')
  console.log('  현재 행수:', cnt, cnt===0?'✅ 0건':'⚠')
}catch(e){ console.error('APPLY 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
