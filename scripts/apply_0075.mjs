// apply_0075.mjs — 0075 holidays 운영 적용(커밋). 승인 후 실행.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0075_holidays.sql','utf8')
await c.connect()
try{
  await c.query(ddl)
  const q=async(s)=>(await c.query(s)).rows
  const tbl=(await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='holidays'`))[0].n
  const cols=(await q(`select column_name from information_schema.columns where table_schema='public' and table_name='holidays' order by ordinal_position`)).map(r=>r.column_name)
  const idx=(await q(`select indexname from pg_indexes where schemaname='public' and tablename='holidays'`)).map(r=>r.indexname).sort()
  const pol=(await q(`select policyname,cmd from pg_policies where schemaname='public' and tablename='holidays'`)).map(r=>r.policyname+'/'+r.cmd)
  const rls=(await q(`select relrowsecurity r from pg_class where oid='public.holidays'::regclass`))[0].r
  const cnt=(await q(`select count(*)::int n from public.holidays`))[0].n
  console.log('APPLY 완료')
  console.log('  테이블:', tbl===1?'생성됨 ✅':'❌', '· tenant_id 없음:', cols.includes('tenant_id')?'❌':'✅')
  console.log('  컬럼:', cols.join(', '))
  console.log('  인덱스:', idx.join(', '))
  console.log('  RLS:', rls?'활성 ✅':'❌', '· 정책:', pol.join(',')||'(없음)')
  console.log('  현재 행수:', cnt)
}catch(e){ console.error('APPLY 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
