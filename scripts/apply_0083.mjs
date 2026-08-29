// apply_0083.mjs — ward_requests / ward_request_items / ward_request_window 운영 생성(커밋).
// 승인 후 실행. 파일 그대로, 단일 트랜잭션. ※ 0083 파일에는 시드 INSERT가 없다(테이블만 생성).
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s)=>(await c.query(s)).rows[0]
const ddl=readFileSync('supabase/migrations/0083_ward_requests.sql','utf8')
await c.connect()
try{
  const pre=await one(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'ward_%'`)
  if(Number(pre.n)!==0){ console.log('이미 적용됨(ward_* '+pre.n+'개) — 중단(무동작)'); process.exit(0) }
  await c.query('begin'); await c.query(ddl); await c.query('commit')
  const r=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_name like 'ward_%') t,
    (select count(*)::int from pg_policies where schemaname='public' and tablename like 'ward_%') p,
    (select count(*)::int from public.ward_request_window) w`)
  console.log('APPLY 완료 — 테이블', r.t, '· 정책', r.p, '· window 행', r.w, '(시드 없음이 정상: 파일에 INSERT 0건 → 기간 닫힘 상태)')
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
