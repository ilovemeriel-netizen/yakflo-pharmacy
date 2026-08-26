// verify_0077.mjs — 0077 apply 후 운영 재검증. role-변경 시도는 전부 savepoint로 원복(운영 무잔류). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(50),v)
await c.connect()
try{
  const gt=Number((await one(`select count(*)::int n from pg_trigger where tgrelid='public.profiles'::regclass and tgname='trg_guard_profiles_role_direct'`)).n)
  const gf=Number((await one(`select count(*)::int n from pg_proc where proname='guard_profiles_role_direct'`)).n)
  const owner=await one(`select id, role, settings from public.profiles where role='admin' order by created_at limit 1`)
  const cnt=Number((await one(`select count(*)::int n from public.profiles`)).n)
  const polN=Number((await one(`select count(*)::int n from pg_policies`)).n)
  const trgN=Number((await one(`select count(*)::int n from pg_trigger where not tgisinternal`)).n)
  const snap=Number((await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)).s)
  const snap7=Number((await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)).s)

  // 2+3. role 미변경 settings update 통과 + drugCols/changeCols 보존 — savepoint로 원복(운영 무잔류)
  let s2=false,s3=false
  await q('begin'); await q('savepoint v'); try{
    await q(`update public.profiles set settings='{"drugCols":["c1","c2"],"changeCols":["x1"]}'::jsonb where id=$1`,[owner.id])
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id])
    await q(`update public.profiles set settings = settings || '{"favorites":["druglist"]}'::jsonb where id=$1`,[owner.id])
    await q(`reset role`)
    const s=(await one(`select settings from public.profiles where id=$1`,[owner.id])).settings
    s2=Array.isArray(s.favorites)&&s.favorites.length===1; s3=Array.isArray(s.drugCols)&&s.drugCols.length===2&&Array.isArray(s.changeCols)
  }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint v'); await q('rollback')

  // 4. 일반 사용자 role 변경 차단(23514)
  let d4=false,dmsg=''
  await q('begin'); await q('savepoint d'); try{
    await q(`update public.profiles set role='user' where id=$1`,[owner.id]) // postgres 통과(강등 셋업)
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id])
    try{ await q(`update public.profiles set role='admin' where id=$1`,[owner.id]) }catch(e){ d4=(e.code==='23514'); dmsg=e.code }
    try{await q(`reset role`)}catch{}
  }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint d'); await q('rollback')

  // 5. admin role 변경 통과 / 6. service_role 통과 — 각 savepoint 원복
  let e5=false,f6=false
  await q('begin'); await q('savepoint e'); try{ await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id]); await q(`update public.profiles set role='member' where id=$1`,[owner.id]); await q(`reset role`); e5=((await one(`select role from public.profiles where id=$1`,[owner.id])).role==='member') }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint e'); await q('rollback')
  await q('begin'); await q('savepoint f'); try{ await q(`set local role service_role`); await q(`update public.profiles set role='member' where id=$1`,[owner.id]); await q(`reset role`); f6=((await one(`select role from public.profiles where id=$1`,[owner.id])).role==='member') }catch(e){ try{await q('reset role')}catch{} } await q('rollback to savepoint f'); await q('rollback')

  // 원복 확인
  const after=await one(`select role, settings from public.profiles where id=$1`,[owner.id])
  const restored=(after.role==='admin' && !(after.settings&&after.settings.favorites))

  console.log('\n════════ 0077 apply 재검증 (운영·검증분 전량 원복) ════════')
  P('1. 트리거·함수 존재', (gt&&gf)?'✅':'❌')
  P('2. role 미변경 settings update 통과', s2?'✅':'❌')
  P('3. drugCols·changeCols 보존', s3?'✅':'❌')
  P('4. 일반 사용자 role 변경 23514 차단', d4?'✅ '+dmsg:'❌')
  P('5. admin role 변경 통과', e5?'✅':'❌')
  P('6. service_role role 변경 통과', f6?'✅':'❌')
  P('7. profiles 행수', cnt+(cnt===1?' ✅':' ❌'))
  P('8. 정책 수·트리거 수', 'pol '+polN+(polN===71?' ✅':' ⚠')+' · trg '+trgN)
  P('9. 정본 1~7월 / 7월', Math.round(snap).toLocaleString()+(Math.round(snap)===885285628?' ✅':' ⚠')+' / '+Math.round(snap7).toLocaleString()+(Math.round(snap7)===106365758?' ✅':' ⚠'))
  P('★ 검증분 원복 확인(owner=admin·favorites 없음)', restored?'✅ 원상':'❌ 잔류!')
  console.log('══════════════════════════════════════════════════════')
}catch(e){ console.error('재검증 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
