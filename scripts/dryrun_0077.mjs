// dryrun_0077.mjs — profiles.role 가드(0077) dryrun. BEGIN→적용→검증 A~K→전량 ROLLBACK. 운영(phg). 무커밋.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const ROOT='c:/Users/iamam/OneDrive/바탕 화면/yakflo-pharmacy-main'
const env=rd(ROOT+'/.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const ddl=readFileSync(ROOT+'/supabase/migrations/0077_guard_profiles_role_direct.sql','utf8')
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const P=(k,v)=>console.log(String(k).padEnd(52),v)
await c.connect()
try{
  await q('begin')
  // 사전 상태
  const trgN0=Number((await one(`select count(*)::int n from pg_trigger where not tgisinternal`)).n)
  const polN0=Number((await one(`select count(*)::int n from pg_policies`)).n)
  const cnt0=Number((await one(`select count(*)::int n from public.profiles`)).n)
  const owner=await one(`select id, role, coalesce(full_name,'') fn, settings from public.profiles where role='admin' order by created_at limit 1`)
  const snap0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)

  await q(ddl) // 0077 적용(트리거+함수)

  // A. 트리거·함수 생성
  const gt=Number((await one(`select count(*)::int n from pg_trigger where tgrelid='public.profiles'::regclass and tgname='trg_guard_profiles_role_direct'`)).n)
  const gf=Number((await one(`select count(*)::int n from pg_proc where proname='guard_profiles_role_direct'`)).n)

  // B+C. role 미변경 update(settings 부분갱신) 통과 + drugCols/changeCols 보존
  let bOk=false,cKeep=false,bErr=''
  await q('savepoint bc'); try{
    await q(`update public.profiles set settings='{"drugCols":["c1","c2"],"changeCols":["x1"]}'::jsonb where id=$1`,[owner.id]) // postgres·role 미변경 → 통과
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id])
    await q(`update public.profiles set settings = settings || '{"favorites":["druglist","stock"]}'::jsonb where id=$1`,[owner.id]) // 스프레드 부분갱신
    await q(`reset role`)
    const s=(await one(`select settings from public.profiles where id=$1`,[owner.id])).settings
    bOk=Array.isArray(s.favorites)&&s.favorites.length===2
    cKeep=Array.isArray(s.drugCols)&&s.drugCols.length===2&&Array.isArray(s.changeCols)&&s.changeCols.length===1
  }catch(e){ bErr=e.code+' '+e.message.split('\n')[0].slice(0,70); try{await q('reset role')}catch{} } await q('rollback to savepoint bc')

  // D. 일반 사용자 자기 role 변경 → 차단(23514). owner를 postgres로 임시 'user' 강등(가드 통과) 후 authenticated로 자가승격 시도
  let dBlk=false,dInfo=''
  await q('savepoint d'); try{
    await q(`update public.profiles set role='user' where id=$1`,[owner.id]) // postgres·current_user≠authenticated → 통과
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id])
    try{ await q(`update public.profiles set role='admin' where id=$1`,[owner.id]) }catch(e){ dBlk=(e.code==='23514'); dInfo=e.code+' '+e.message.split('\n')[0].slice(0,80) }
    try{await q(`reset role`)}catch{}
  }catch(e){ dInfo='setup '+e.code+' '+e.message.split('\n')[0].slice(0,60); try{await q('reset role')}catch{} } await q('rollback to savepoint d')

  // E. admin의 role 변경 → 통과(is_admin). owner(admin) authenticated로 role='member' 변경
  let eOk=false,eInfo=''
  await q('savepoint e'); try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id])
    await q(`update public.profiles set role='member' where id=$1`,[owner.id]) // is_admin(owner=admin, BEFORE 시점)=true → 통과
    await q(`reset role`)
    eOk=((await one(`select role from public.profiles where id=$1`,[owner.id])).role==='member')
  }catch(e){ eInfo=e.code+' '+e.message.split('\n')[0].slice(0,70); try{await q('reset role')}catch{} } await q('rollback to savepoint e')

  // F. service_role의 role 변경 → 통과(current_user='service_role')
  let fOk=false,fInfo=''
  await q('savepoint f'); try{
    await q(`set local role service_role`)
    await q(`update public.profiles set role='member' where id=$1`,[owner.id])
    await q(`reset role`)
    fOk=((await one(`select role from public.profiles where id=$1`,[owner.id])).role==='member')
  }catch(e){ fInfo=e.code+' '+e.message.split('\n')[0].slice(0,70); try{await q('reset role')}catch{} } await q('rollback to savepoint f')

  // G. 다른 컬럼(full_name) update → 통과
  let gOk=false,gInfo=''
  await q('savepoint g'); try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[owner.id])
    await q(`update public.profiles set full_name='__dryrun__' where id=$1`,[owner.id])
    await q(`reset role`)
    gOk=((await one(`select full_name from public.profiles where id=$1`,[owner.id])).full_name==='__dryrun__')
  }catch(e){ gInfo=e.code+' '+e.message.split('\n')[0].slice(0,70); try{await q('reset role')}catch{} } await q('rollback to savepoint g')

  // H. INSERT 무영향 — 트리거 이벤트 확인(BEFORE UPDATE만)
  const tg=await one(`select tgtype from pg_trigger where tgname='trg_guard_profiles_role_direct'`)
  const tt=Number(tg.tgtype)
  const isRow=(tt&1)===1, isBefore=(tt&2)===2, onInsert=(tt&4)===4, onUpdate=(tt&16)===16, onDelete=(tt&8)===8
  const hOk=(isRow&&isBefore&&onUpdate&&!onInsert&&!onDelete)

  // I. profiles 행수
  const cnt1=Number((await one(`select count(*)::int n from public.profiles`)).n)
  // J. 다른 트리거·정책 변동(0077 = 트리거 +1, 정책 0)
  const trgN1=Number((await one(`select count(*)::int n from pg_trigger where not tgisinternal`)).n)
  const polN1=Number((await one(`select count(*)::int n from pg_policies`)).n)
  // K. 정본
  const snap1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const snap17=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month=7`)

  await q('rollback') // ★ 전량 롤백

  console.log('\n════════ 0077 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('A. 트리거·함수 생성', (gt&&gf)?'✅ trigger·function 존재':'❌ trg='+gt+' fn='+gf)
  P('B. role 미변경 update(settings favorites) 통과', bOk?'✅':'❌ '+bErr)
  P('C. settings 부분갱신 drugCols·changeCols 보존', cKeep?'✅':'❌')
  P('D. 일반 사용자 자기 role 변경 차단', dBlk?'✅ 차단(23514)':'❌ '+dInfo); P('   메시지', dInfo)
  P('E. admin의 role 변경 통과', eOk?'✅ role→member':'❌ '+eInfo)
  P('F. service_role의 role 변경 통과', fOk?'✅ role→member':'❌ '+fInfo)
  P('G. 다른 컬럼(full_name) update 통과', gOk?'✅':'❌ '+gInfo)
  P('H. 트리거 이벤트 = BEFORE UPDATE(INSERT 무영향)', hOk?('✅ before='+isBefore+' update='+onUpdate+' insert='+onInsert):'❌ tgtype='+tt)
  P('I. profiles 행수(전/후)', `${cnt0}→${cnt1} ${cnt0===cnt1?'✅':'❌'}`)
  P('J. 트리거 수(전/후)·정책 수(전/후)', `trg ${trgN0}→${trgN1}(+${trgN1-trgN0}) ${trgN1-trgN0===1?'✅':'❌'} · pol ${polN0}→${polN1} ${polN0===polN1?'✅':'❌'}`)
  P('K. 정본 1~7월(전/후)', `${Math.round(Number(snap0.s)).toLocaleString()}→${Math.round(Number(snap1.s)).toLocaleString()} ${Number(snap0.s)===Number(snap1.s)?'✅':'❌'} · 7월 ${Math.round(Number(snap17.s)).toLocaleString()} ${Math.round(Number(snap17.s))===106365758?'✅':'⚠'}`)
  P('   정본 1~7월 합', Math.round(Number(snap1.s)).toLocaleString()+(Math.round(Number(snap1.s))===885285628?' ✅':' ⚠(기준 885,285,628)'))
  console.log('══════════════════════════════════════════════════════')
}catch(e){ try{await q('rollback')}catch{}; console.error('DRYRUN 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
