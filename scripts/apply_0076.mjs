// apply_0076.mjs — 0076 공유 레퍼런스 6개 RLS 정렬 운영 적용(커밋). 승인 후 실행. 파일 그대로 적용.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0076_shared_ref_rls.sql','utf8')
const T6=['drug_discontinuation','drug_harmful','drug_status_alerts','dur_age_contraindication','dur_elderly_caution','dur_pregnancy_contraindication']
await c.connect()
try{
  await c.query(ddl)
  const q=async(s,a)=>(await c.query(s,a)).rows
  const one=async(s,a)=>(await q(s,a))[0]
  console.log('APPLY 완료')
  for(const t of T6){
    const rls=(await one(`select relrowsecurity r from pg_class where oid=('public.'||$1)::regclass`,[t])).r
    const cmds=(await q(`select cmd from pg_policies where schemaname='public' and tablename=$1`,[t])).map(r=>r.cmd)
    const sel=cmds.filter(x=>x==='SELECT').length, wr=cmds.filter(x=>x!=='SELECT').length
    const aS=(await one(`select has_table_privilege('anon','public.'||$1,'SELECT') v`,[t])).v
    const auS=(await one(`select has_table_privilege('authenticated','public.'||$1,'SELECT') v`,[t])).v
    const auI=(await one(`select has_table_privilege('authenticated','public.'||$1,'INSERT') v`,[t])).v
    console.log(`  ${t}: RLS ${rls?'on':'off'} · SELECT정책 ${sel}·쓰기 ${wr} · anonSEL ${aS?'O':'-'} · authSEL ${auS?'O':'-'} · authINS ${auI?'O':'-'}`)
  }
}catch(e){ console.error('APPLY 오류(중단):',e.message); process.exitCode=1 }
finally{ await c.end() }
