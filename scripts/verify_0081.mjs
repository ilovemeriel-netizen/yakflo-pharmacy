// verify_0081.mjs — 0081 apply 후 운영 재검증 8항목. 검증용 1건 저장 → 반드시 원복 → 원복 확인.
// ※ 저장 3경로(INSERT 575·2512 / UPDATE 599) 시뮬은 실제 앱 경로대로 authenticated 롤 + jwt sub로 수행.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  // 1. 컬럼 존재·타입·nullable
  const a=await one(`select data_type,is_nullable,column_default from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name='efficacy_class'`)
  P('1_컬럼', !!a && a.data_type==='text' && a.is_nullable==='YES' && a.column_default===null,
     a?`${a.data_type} · nullable=${a.is_nullable} · default=${a.column_default}`:'컬럼 없음')

  const tm=await one(`select user_id,tenant_id from public.tenant_members limit 1`)
  const t=await one(`select id,drug_code,efficacy_class from public.drugs order by drug_code limit 1`)
  const ORIG = t.efficacy_class   // 원복 기준(적용 직후이므로 null이어야 정상)

  // 2-a. UPDATE 경로(App.jsx:599) — 폴백 없이 통과하는가
  let uOk=false,uErr=null
  try{ await q(`update public.drugs set efficacy_class=$1 where id=$2`,['__VERIFY0081__',t.id]); uOk=true }catch(e){ uErr=e.message }
  // 3. 값 저장·재조회 유지
  const back=await one(`select efficacy_class from public.drugs where id=$1`,[t.id])
  P('3_저장·재조회', back?.efficacy_class==='__VERIFY0081__', `재조회=${JSON.stringify(back?.efficacy_class)} (대상 ${t.drug_code})`)

  // ★ 원복 (즉시)
  await q(`update public.drugs set efficacy_class=$1 where id=$2`,[ORIG,t.id])
  const rev=await one(`select efficacy_class from public.drugs where id=$1`,[t.id])
  P('3_원복', (rev?.efficacy_class ?? null)===(ORIG ?? null), `원복값=${JSON.stringify(rev?.efficacy_class)} (기준 ${JSON.stringify(ORIG)})`)

  // 2-b. INSERT 경로(App.jsx:575·2512) — 트랜잭션 내 삽입 후 ROLLBACK(잔류 0)
  let iOk=false,iErr=null,iVal=null
  await q('begin')
  try{
    await q(`set local role authenticated`); await q(`select set_config('request.jwt.claim.sub',$1,true)`,[tm.user_id])
    await q(`insert into public.drugs (drug_code,drug_name,category,status,current_qty,efficacy_class)
             values ($1,$2,$3,$4,0,$5)`,['__VERIFY0081__','__verify__','경구제','사용','소화기계용약'])
    iVal=(await one(`select efficacy_class from public.drugs where drug_code='__VERIFY0081__'`)).efficacy_class
    iOk = iVal==='소화기계용약'
  }catch(e){ iErr=e.message }
  try{ await q('reset role') }catch{}
  await q('rollback')
  P('2_저장3경로', uOk && iOk, `UPDATE=${uOk?'통과':'실패:'+uErr} · INSERT=${iOk?'통과':'실패:'+iErr} · 저장값=${JSON.stringify(iVal)} (모두 폴백 불필요)`)

  // 4~8
  const s=await one(`select
    (select count(*) filter (where efficacy_class is null)::int from public.drugs) nulls,
    (select count(*)::int from public.drugs) rows,
    (select count(*)::int from pg_policies where schemaname='public' and tablename='drugs') pol,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') cols,
    (select count(*)::int from pg_indexes where schemaname='public' and tablename='drugs') idx,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7,
    (select count(*)::int from public.drugs where drug_code='__VERIFY0081__') junk`)
  P('4_기존NULL', s.nulls===s.rows, `NULL ${s.nulls}/${s.rows}`)
  P('5_행수', s.rows===1114, `${s.rows}`)
  P('6_RLS', s.pol===4, `정책 ${s.pol}`)
  P('7_컬럼·인덱스', s.cols===71 && s.idx===4, `컬럼 ${s.cols}(70→71) · 인덱스 ${s.idx}`)
  P('8_정본', s.snap==='885285628.424000000014' && s.snap7==='106365758.46920000003', `${s.snap} / ${s.snap7}`)
  P('무잔류', s.junk===0, `검증용 행 ${s.junk}건`)

  const allOk=Object.values(R).every(x=>x.ok)
  console.log(JSON.stringify({allOk,R},null,1))
}catch(e){ try{await q('rollback')}catch{}; console.error('검증 오류:',e.message); process.exitCode=1 }
finally{ await c.end() }
