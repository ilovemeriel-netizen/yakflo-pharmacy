// apply_0080.mjs — drug_idle_reviews 운영 생성(커밋). 승인 후 실행. 파일 그대로, 단일 트랜잭션.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s)=>(await c.query(s)).rows[0]
const ddl=readFileSync('supabase/migrations/0080_drug_idle_reviews.sql','utf8')
await c.connect()
try{
  await c.query('begin'); await c.query(ddl); await c.query('commit')
  const t=Number((await one(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='drug_idle_reviews'`)).n)
  const p=Number((await one(`select count(*)::int n from pg_policies where tablename='drug_idle_reviews'`)).n)
  console.log('APPLY 완료 — 테이블:', t?'✅':'❌', '· 정책:', p)
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
