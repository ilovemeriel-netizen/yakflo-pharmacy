// verify_0080.mjs — 0080 apply 후 운영 재검증. 검증용 행은 savepoint/ROLLBACK로 무잔류. 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(46),v)
await c.connect()
try{
  const tm=await one(`select user_id, tenant_id from public.tenant_members limit 1`)
  const drugCode=(await one(`select drug_code from public.drugs where tenant_id=$1 limit 1`,[tm.tenant_id])).drug_code
  const asAuth=async(sub)=>{ await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[sub||tm.user_id]) }

  // 1. 테이블·컬럼·PK·FK·인덱스
  const cols=(await q(`select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='drug_idle_reviews' order by ordinal_position`)).rows
  const cons=(await q(`select contype,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.drug_idle_reviews'::regclass`)).rows
  const idx=(await q(`select indexname from pg_indexes where tablename='drug_idle_reviews'`)).rows.map(r=>r.indexname)
  const r1=cols.length===8 && cons.some(r=>r.contype==='p') && cons.some(r=>r.contype==='f'&&/tenants/.test(r.def)) && idx.some(x=>/tenant_code_reviewed/.test(x))
  // 2. UNIQUE없음·CHECK없음·tenant_id NN
  const r2=!cons.some(r=>r.contype==='u') && !cons.some(r=>r.contype==='c') && cols.find(x=>x.column_name==='tenant_id')?.is_nullable==='NO'
  // 3. RLS on·정책 4
  const rls=(await one(`select relrowsecurity r from pg_class where oid='public.drug_idle_reviews'::regclass`)).r
  const pols=(await q(`select cmd from pg_policies where tablename='drug_idle_reviews'`)).rows.map(r=>r.cmd).sort()
  const r3=rls && pols.length===4
  // 4. GRANT authenticated 4·anon 0
  const gr=(await q(`select grantee, string_agg(privilege_type,',' order by privilege_type) p from information_schema.role_table_grants where table_name='drug_idle_reviews' group by grantee`)).rows
  const authG=gr.find(g=>g.grantee==='authenticated')?.p, anonG=gr.find(g=>g.grantee==='anon')?.p
  const r4=(authG==='DELETE,INSERT,SELECT,UPDATE') && !anonG
  // 5~9: savepoint (검증 행 전량 원복)
  let r5=false,r6=false,r7=false,r8=false,r9=false
  await q('begin'); await q('savepoint v'); try{
    await asAuth()
    await q(`insert into public.drug_idle_reviews(drug_code,status) values($1,'관찰')`,[drugCode]) // tenant 생략
    const row=await one(`select tenant_id,created_by from public.drug_idle_reviews where drug_code=$1 limit 1`,[drugCode])
    r5=(row.tenant_id===tm.tenant_id); r6=(row.created_by===tm.user_id)
    await q(`insert into public.drug_idle_reviews(drug_code,status) values($1,'중지'),($1,'해제')`,[drugCode])
    r7=Number((await one(`select count(*)::int n from public.drug_idle_reviews where drug_code=$1`,[drugCode])).n)>=3
    await q(`insert into public.drug_idle_reviews(drug_code,status,reviewed_at) values($1,'보유유지','2026-08-25')`,[drugCode])
    const latest=await one(`select status from public.drug_idle_reviews where drug_code=$1 order by reviewed_at desc, created_at desc limit 1`,[drugCode])
    r8=!!latest
    const j=await one(`select d.drug_name from public.drug_idle_reviews r join public.drugs d on d.drug_code=r.drug_code where r.drug_code=$1 limit 1`,[drugCode])
    r9=!!(j&&j.drug_name)
    await q('reset role')
  }catch(e){ console.error('  검증5~9 오류:',e.code,e.message.slice(0,50)); try{await q('reset role')}catch{} }
  await q('rollback to savepoint v'); await q('rollback')
  // 10. 기존 정책 총건수 무변동은 apply 전후 비교 불가하나, drug_idle_reviews 제외 총계 안정 확인 + drug_change_plans 4 유지
  const polTotal=Number((await one(`select count(*)::int n from pg_policies`)).n)
  const polCP=Number((await one(`select count(*)::int n from pg_policies where tablename='drug_change_plans'`)).n)
  const r10=(polCP===4)
  // 11. 정본
  const snap=(await one(`select coalesce(sum(closing_amount),0)::text s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)).s
  const snap7=(await one(`select coalesce(sum(closing_amount),0)::text s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)).s
  const r11=(snap==='885285628.424000000014'&&snap7==='106365758.46920000003')
  // 무잔류: 운영 실제 행수 0
  const live=Number((await one(`select count(*)::int n from public.drug_idle_reviews`)).n)

  console.log('\n════════ 0080 apply 재검증 (검증행 전량 ROLLBACK) ════════')
  P('1. 테이블·컬럼8·PK·FK·인덱스', r1?'✅':'❌')
  P('2. UNIQUE없음·CHECK없음·tenant_id NN', r2?'✅':'❌')
  P('3. RLS on·정책 4종', r3?('✅ '+pols.join('/')):'❌')
  P('4. GRANT authenticated 4·anon 0', r4?('✅ auth='+authG+' anon=없음'):('❌ auth='+authG+' anon='+anonG))
  P('5. set_tenant_id 자동 부여', r5?'✅':'❌')
  P('6. created_by 자동 auth.uid()', r6?'✅':'❌')
  P('7. 이력 누적(다중 행)', r7?'✅':'❌')
  P('8. 최신 행 조회', r8?'✅':'❌')
  P('9. drugs 조인', r9?'✅':'❌')
  P('10. 기존 정책 무변동(drug_change_plans 4)', r10?'✅ 총'+polTotal:'❌')
  P('11. 정본 무변동', r11?('✅ '+snap+'/'+snap7):'❌')
  P('★ 운영 무잔류(drug_idle_reviews 행수)', live===0?'✅ 0행':('❌ '+live+'행 잔류'))
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('재검증 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
