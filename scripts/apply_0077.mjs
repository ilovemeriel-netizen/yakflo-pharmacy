// apply_0077.mjs — profiles.role 가드(0077) 운영 적용(커밋). 승인 후 실행. 파일 그대로, 단일 트랜잭션.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0077_guard_profiles_role_direct.sql','utf8')
await c.connect()
try{
  await c.query('begin')
  await c.query(ddl)
  await c.query('commit')
  const q=async(s)=>(await c.query(s)).rows; const one=async s=>(await q(s))[0]
  const gt=(await one(`select count(*)::int n from pg_trigger where tgrelid='public.profiles'::regclass and tgname='trg_guard_profiles_role_direct'`)).n
  const gf=(await one(`select count(*)::int n from pg_proc where proname='guard_profiles_role_direct'`)).n
  console.log('APPLY 완료')
  console.log('  가드 트리거 trg_guard_profiles_role_direct:', gt?'존재 ✅':'❌')
  console.log('  함수 guard_profiles_role_direct:', gf?'존재 ✅':'❌')
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
