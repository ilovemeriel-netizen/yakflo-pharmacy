// apply_0081.mjs — drugs.efficacy_class 운영 추가(커밋). 승인 후 실행. 파일 그대로, 단일 트랜잭션.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s)=>(await c.query(s)).rows[0]
const ddl=readFileSync('supabase/migrations/0081_drugs_efficacy_class.sql','utf8')
await c.connect()
try{
  const pre=await one(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='drugs' and column_name='efficacy_class'`)
  if(Number(pre.n)!==0){ console.log('이미 적용됨 — 중단(무동작)'); process.exit(0) }
  await c.query('begin'); await c.query(ddl); await c.query('commit')
  const a=await one(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name='efficacy_class'`)
  console.log('APPLY 완료 —', a ? `${a.data_type} · nullable=${a.is_nullable} · default=${a.column_default}` : '❌ 컬럼 없음')
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
