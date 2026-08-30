// apply_0084.mjs — ward_requests 비밀번호 컬럼 4개 운영 추가(커밋). 승인 후 실행. 파일 그대로, 단일 트랜잭션.
// ★ 접수 기간(ward_request_window.is_open)은 건드리지 않는다 — 이 스크립트는 DDL만 실행한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s,a)=>(await c.query(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0084_ward_requests_password.sql','utf8')
const NEW=['pw_hash','pw_salt','pw_fail','pw_locked_until']
await c.connect()
try{
  const pre=await one(`select
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests' and column_name = any($1)) newcols,
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ward_requests') cols,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7,
    (select bool_or(is_open) from public.ward_request_window) win_open`,[NEW])
  if(Number(pre.newcols)===4){ console.log('이미 적용됨 — 중단(무동작)'); process.exit(0) }
  console.log(`적용 전: ward_requests 컬럼 ${pre.cols} · 테이블 ${pre.tables} · 정책 ${pre.policies} · 접수기간 is_open=${pre.win_open}`)
  await c.query('begin'); await c.query(ddl); await c.query('commit')
  console.log('APPLY 완료 — 커밋됨\n')
  console.log('※ 이어서 verify_0084.mjs 로 검증하십시오.')
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
