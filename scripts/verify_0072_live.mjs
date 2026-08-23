// verify_0072_live.mjs — apply 후 운영에서 status 변경 실증(BEGIN → UPDATE → 확인 → ROLLBACK, 무변동)
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env')
let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const one=async(s,a)=>(await client.query(s,a)).rows[0]
await client.connect()
try{
  await client.query('begin')
  const trg=(await client.query(`select tgname, tgenabled from pg_trigger where tgrelid='public.drugs'::regclass and tgname='trg_log_drugs_status'`)).rows
  const t=await one(`select drug_code, status from public.drugs where status='사용' order by drug_code limit 1`)
  const c0=Number((await one('select count(*)::int n from public.drug_status_audit')).n)
  await client.query(`update public.drugs set status='휴면' where drug_code=$1`,[t.drug_code])
  const c1=Number((await one('select count(*)::int n from public.drug_status_audit')).n)
  const row=await one(`select drug_code, old_status, new_status, tenant_id, changed_at from public.drug_status_audit where drug_code=$1 order by changed_at desc limit 1`,[t.drug_code])
  await client.query('rollback')
  const c2=Number((await one('select count(*)::int n from public.drug_status_audit')).n)
  console.log('실증 결과 (ROLLBACK 완료 · 운영 무변동)')
  console.log('  트리거 존재/활성:', trg.length?`✅ ${trg[0].tgname} (tgenabled=${trg[0].tgenabled})`:'❌ 없음')
  console.log('  대상:', t.drug_code, `status ${t.status}→휴면`)
  console.log('  이력 기록:', `${c0}→${c1}`, c1-c0===1?'✅ +1행':'❌')
  console.log('  기록 내용:', row?`old='${row.old_status}' new='${row.new_status}' tenant=${row.tenant_id?'채워짐✅':'NULL❌'} at=${row.changed_at?.toISOString?.()||row.changed_at}`:'없음❌')
  console.log('  ROLLBACK 후 행수:', c2, c2===c0?'✅ 원복(0건 유지)':'❌')
}catch(e){try{await client.query('rollback')}catch{};console.error('오류:',e.message);process.exitCode=1}
finally{await client.end()}
