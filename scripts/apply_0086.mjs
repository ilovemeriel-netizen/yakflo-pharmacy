// apply_0086.mjs — 월마감 모니터링(테이블 2 · 뷰 4 · 함수 1) 운영 적용(커밋).
// 승인 후 실행. 파일 그대로, 단일 트랜잭션. 멱등 가드 있음.
//
// ★ supabase db push 를 쓰지 않는다.
//   supabase_migrations.schema_migrations 기록이 0건인데 로컬 마이그레이션은 89건이라,
//   CLI push 는 0000_baseline 부터 전부 재적용하려 든다(운영 파괴).
//   이 저장소는 0083·0084·0085 모두 이 스크립트 패턴으로 적용해 왔다.
//
// ★ 운영 데이터를 건드리지 않는다 — DDL 과 임계값 seed 뿐이다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s,a)=>(await c.query(s,a)).rows[0]
/* 파일이 자체 begin/commit 을 갖고 있다 — 제거하고 이 스크립트가 트랜잭션을 관리한다 */
const ddl=readFileSync('supabase/migrations/0086_close_monitor.sql','utf8')
  .replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')
await c.connect()
try{
  const pre=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_name in ('close_monitor_alerts','close_monitor_thresholds')) newtables,
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from information_schema.views  where table_schema='public') views,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  if(Number(pre.newtables)===2){ console.log('이미 적용됨 — 중단(무동작)'); process.exit(0) }
  console.log(`적용 전: 테이블 ${pre.tables} · 뷰 ${pre.views} · 정책 ${pre.policies} · 거래 ${pre.txs} · 약품 ${pre.drugs}`)
  console.log(`         1~7월 정본 ${pre.snap}`)

  await c.query('begin'); await c.query(ddl); await c.query('commit')

  const post=await one(`select
    (select count(*)::int from information_schema.tables where table_schema='public') tables,
    (select count(*)::int from information_schema.views  where table_schema='public') views,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.close_monitor_thresholds) thr,
    (select count(*)::int from public.close_monitor_alerts) alerts,
    (select count(*)::int from public.transactions) txs,
    (select count(*)::int from public.drugs) drugs,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap`)
  console.log('APPLY 완료 — 커밋됨')
  console.log(`적용 후: 테이블 ${pre.tables}→${post.tables} · 뷰 ${pre.views}→${post.views} · 정책 ${pre.policies}→${post.policies}`)
  console.log(`         임계값 ${post.thr}행 · 알림 ${post.alerts}행(적재 전이므로 0이 정상)`)
  console.log(`         거래 ${pre.txs}→${post.txs} · 약품 ${pre.drugs}→${post.drugs} (무변동 기대)`)
  console.log(`         정본 ${post.snap}`)
  console.log('\n※ 이어서 verify_0086.mjs 로 검증하십시오.')
}catch(e){ try{await c.query('rollback')}catch{}; console.error('APPLY 오류(중단, 롤백됨):', e.message); if(e.position) console.error('  position:', e.position); process.exitCode=1 }
finally{ await c.end() }
