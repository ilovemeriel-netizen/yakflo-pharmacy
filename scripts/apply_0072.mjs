// apply_0072.mjs — 0072_drug_status_audit 운영 적용(커밋). 승인 후 실행.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env')
let url=env.DATABASE_URL||''
if(/\/postgre$/.test(url))url+='s'
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync('supabase/migrations/0072_drug_status_audit.sql','utf8') // begin;/commit; 포함 — 파일 그대로 적용
await client.connect()
try{
  await client.query(ddl) // 파일 내부 begin;…commit; 로 원자 적용
  const tbl=(await client.query(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='drug_status_audit'`)).rows[0].n
  const trg=(await client.query(`select tgname from pg_trigger where tgrelid='public.drugs'::regclass and tgname='trg_log_drugs_status'`)).rows.map(r=>r.tgname)
  const pol=(await client.query(`select cmd from pg_policies where schemaname='public' and tablename='drug_status_audit' order by cmd`)).rows.map(r=>r.cmd)
  const cnt=(await client.query(`select count(*)::int n from public.drug_status_audit`)).rows[0].n
  console.log('APPLY 완료')
  console.log('  drug_status_audit 테이블:', tbl===1?'생성됨 ✅':'❌')
  console.log('  트리거 trg_log_drugs_status:', trg.length?('부착됨 ✅ ['+trg.join(',')+']'):'❌')
  console.log('  RLS 정책:', pol.length+'종 ['+pol.join(',')+']', pol.length===4?'✅':'❌')
  console.log('  현재 이력 행수(소급 없음):', cnt, cnt===0?'✅ 0건':'⚠')
}catch(e){
  console.error('APPLY 오류:',e.message);process.exitCode=1
}finally{
  await client.end()
}
