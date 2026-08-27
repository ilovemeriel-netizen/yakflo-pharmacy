// apply_0079.mjs — 금액 3컬럼 bigint→numeric 운영 적용(커밋). 승인 후 실행. 파일 그대로, 단일 트랜잭션.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0079_amount_columns_numeric.sql','utf8')
await c.connect()
try{
  const t0=Date.now()
  await q('begin')
  await q(ddl)
  await q('commit')
  const ms=Date.now()-t0
  const types=(await q(`select table_name,column_name,data_type from information_schema.columns where table_schema='public'
    and (table_name,column_name) in (('transactions','total_amount'),('drugs','current_amount'),('inventory_stock','current_amount')) order by table_name`)).rows
  console.log('APPLY 완료 (소요 %dms)', ms)
  for(const r of types) console.log(`  ${r.table_name}.${r.column_name}: ${r.data_type}`, r.data_type==='numeric'?'✅':'❌')
}catch(e){ try{await q('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
