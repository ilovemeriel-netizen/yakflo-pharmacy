// apply_0085.mjs — inventory_counts / inventory_count_items 생성 + drugs 컬럼 2개 운영 적용(커밋).
// 승인 후 실행. 파일 그대로, 단일 트랜잭션. 멱등 가드 있음.
// ★ 기존 테이블·정책·거래·정본은 건드리지 않는다 — 이 스크립트는 DDL만 실행한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s,a)=>(await c.query(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0085_inventory_counts.sql','utf8')
const T=['inventory_counts','inventory_count_items']
await c.connect()
try{
  const pre=await one(`select
    (select count(*)::int from information_schema.tables  where table_schema='public' and table_name = any($1)) newtables,
    (select count(*)::int from information_schema.tables  where table_schema='public') tables,
    (select count(*)::int from pg_policies                where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') drugcols,
    (select count(*)::int from public.transactions) txs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`,[T])
  if(Number(pre.newtables)===2){ console.log('이미 적용됨 — 중단(무동작)'); process.exit(0) }
  console.log(`적용 전: 테이블 ${pre.tables} · 정책 ${pre.policies} · drugs 컬럼 ${pre.drugcols} · 거래 ${pre.txs} · 1~7월 정본 ${pre.snap}`)
  await c.query('begin'); await c.query(ddl); await c.query('commit')
  const post=await one(`select
    (select count(*)::int from information_schema.tables  where table_schema='public') tables,
    (select count(*)::int from pg_policies                where schemaname='public') policies,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') drugcols,
    (select count(*)::int from public.transactions) txs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  console.log(`APPLY 완료 — 커밋됨`)
  console.log(`적용 후: 테이블 ${pre.tables}→${post.tables} · 정책 ${pre.policies}→${post.policies} · drugs 컬럼 ${pre.drugcols}→${post.drugcols}`)
  console.log(`         거래 ${pre.txs}→${post.txs}(무변동 기대) · 정본 ${post.snap}`)
  console.log('\n※ 이어서 verify_0085.mjs 로 검증하십시오.')
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):',e.message); process.exitCode=1 }
finally{ await c.end() }
