// dryrun_0080.mjs — drug_idle_reviews 생성 dryrun. BEGIN→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
// A.구조 B.RLS4 C.set_tenant D.자기tenant E.격리 F.created_by G.이력 H.최신행 I.조인 J.기존정책 K.정본
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0080_drug_idle_reviews.sql','utf8')
await c.connect()
try{
  const tm=await one(`select user_id, tenant_id from public.tenant_members limit 1`)
  const dc=(await one(`select drug_code from public.drugs where tenant_id=$1 limit 1`,[tm.tenant_id])).drug_code
  const asAuth=async s=>{ await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[s||tm.user_id]) }
  await q('begin'); await q(ddl)
  const ok={A:false,B:false,C:false,E:false,G:false}
  const cols=(await q(`select count(*)::int n from information_schema.columns where table_name='drug_idle_reviews'`)).rows[0].n
  ok.A=(Number(cols)===8)
  ok.B=(await q(`select count(*)::int n from pg_policies where tablename='drug_idle_reviews'`)).rows[0].n==4
  await q('savepoint s'); await asAuth(); await q(`insert into public.drug_idle_reviews(drug_code,status) values($1,'관찰'),($1,'해제')`,[dc])
  ok.C=((await one(`select tenant_id from public.drug_idle_reviews limit 1`)).tenant_id===tm.tenant_id)
  ok.G=Number((await one(`select count(*)::int n from public.drug_idle_reviews where drug_code=$1`,[dc])).n)===2
  await q('reset role'); await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true)`)
  ok.E=(Number((await one(`select count(*)::int n from public.drug_idle_reviews`)).n)===0)
  await q('reset role'); await q('rollback to savepoint s')
  await q('rollback')
  console.log('0080 dryrun:', JSON.stringify(ok), '— 전량 ROLLBACK')
}catch(e){ try{await q('rollback')}catch{}; console.error('dryrun 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
