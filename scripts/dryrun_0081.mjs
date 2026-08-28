// dryrun_0081.mjs — drugs.efficacy_class 추가 dryrun. BEGIN→ALTER→검증→전량 ROLLBACK(운영 무잔류). 무커밋·무apply.
// A.컬럼·타입 B.저장 3경로 폴백없이 통과 C.값 저장·재조회 유지 D.폴백 미발생(코드판정) E.기존 1114건 NULL
// F.행수 무변동 G.RLS 무변동 H.다른 컬럼·인덱스 무변동 I.정본 무변동
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env'); let url=env.DATABASE_URL||''; if(/\/postgre$/.test(url))url+='s'
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})
const q=(s,a)=>c.query(s,a); const one=async(s,a)=>(await q(s,a)).rows[0]
const ddl=readFileSync('supabase/migrations/0081_drugs_efficacy_class.sql','utf8')
const R={}; const P=(k,ok,d)=>{R[k]={ok,d}}
await c.connect()
try{
  // ── 사전(적용 전) 기준값
  const pre = await one(`select
    (select count(*)::int from public.drugs) rows,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') cols,
    (select count(*)::int from pg_indexes where schemaname='public' and tablename='drugs') idx,
    (select count(*)::int from pg_policies where schemaname='public' and tablename='drugs') pol,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs' and column_name='efficacy_class') has_col,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)

  await q('begin')
  await q(ddl)

  // A. 컬럼 생성·타입
  const a = await one(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='drugs' and column_name='efficacy_class'`)
  P('A', !!a && a.data_type==='text' && a.is_nullable==='YES' && a.column_default===null,
      a ? `text=${a.data_type} nullable=${a.is_nullable} default=${a.column_default}` : '컬럼 없음')

  // 검증 대상 1건(운영 데이터 — 트랜잭션 내 변경 후 전량 ROLLBACK)
  const t = await one(`select id, drug_code, efficacy_class from public.drugs order by drug_code limit 1`)

  // B-1. UPDATE 경로(App.jsx:599 ud 병합) — 폴백 없이 통과하는지
  let bUpd=false, bUpdErr=null
  try { await q(`update public.drugs set efficacy_class=$1 where id=$2`, ['소화기계용약', t.id]); bUpd=true }
  catch(e){ bUpdErr=e.message }
  P('B-update', bUpd, bUpdErr || 'UPDATE 통과(폴백 불필요)')

  // C. 값 저장·재조회 유지
  const cRow = await one(`select efficacy_class from public.drugs where id=$1`, [t.id])
  P('C', cRow?.efficacy_class==='소화기계용약', `재조회=${JSON.stringify(cRow?.efficacy_class)}`)

  // B-2. INSERT 경로(App.jsx:575·2512 row payload) — efficacy_class 포함 신규행
  //  ※ 실제 앱은 authenticated 롤이라 trg_set_tenant_id가 tenant_id를 채운다(0059 NOT NULL 충족).
  //    dryrun은 postgres 롤이라 트리거가 비어 있는 tenant를 못 찾으므로, 그 경로를 그대로 재현하기 위해
  //    dryrun_0080과 같이 role=authenticated + jwt sub를 세팅해 INSERT한다.
  const tm = await one(`select user_id, tenant_id from public.tenant_members limit 1`)
  let bIns=false, bInsErr=null, insVal=null, insTenant=null
  await q('savepoint sp_ins')
  try {
    await q(`set local role authenticated`)
    await q(`select set_config('request.jwt.claim.sub',$1,true)`, [tm.user_id])
    await q(`insert into public.drugs (drug_code, drug_name, category, status, current_qty, efficacy_class)
             values ($1,$2,$3,$4,0,$5)`, ['__DRYRUN0081__','__dryrun__','경구제','사용','해열·진통·소염제'])
    const r = await one(`select efficacy_class, tenant_id from public.drugs where drug_code='__DRYRUN0081__'`)
    insVal = r?.efficacy_class; insTenant = r?.tenant_id
    bIns = insVal==='해열·진통·소염제' && insTenant===tm.tenant_id
  } catch(e){ bInsErr=e.message }
  try{ await q(`reset role`) }catch{}
  await q('rollback to savepoint sp_ins')
  P('B-insert', bIns, bInsErr || `INSERT 통과·저장값=${JSON.stringify(insVal)}·tenant 자동부여=${insTenant===tm.tenant_id}`)

  // D. 빈값(NULL) 저장 — 코드가 `|| null`로 보내므로 NOT NULL이면 실패할 경로
  let dNull=false, dErr=null
  await q('savepoint sp_null')
  try { await q(`update public.drugs set efficacy_class=null where id=$1`, [t.id]); dNull=true } catch(e){ dErr=e.message }
  await q('rollback to savepoint sp_null')
  P('D', dNull, dErr || 'NULL 저장 통과 → 코드의 `|| null`과 정합(폴백 불필요)')

  // E. 기존 행은 NULL로 시작
  const e5 = await one(`select count(*) filter (where efficacy_class is null)::int nulls, count(*)::int total from public.drugs`)
  P('E', e5.nulls === e5.total - 1, `NULL ${e5.nulls}/${e5.total} (검증용 1건만 값 보유)`)

  // F~H. 행수·인덱스·정책·컬럼수(+1)
  const post = await one(`select
    (select count(*)::int from public.drugs) rows,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs') cols,
    (select count(*)::int from pg_indexes where schemaname='public' and tablename='drugs') idx,
    (select count(*)::int from pg_policies where schemaname='public' and tablename='drugs') pol`)
  P('F', post.rows===pre.rows, `행수 ${pre.rows} → ${post.rows}`)
  P('G', post.pol===pre.pol, `RLS 정책 ${pre.pol} → ${post.pol}`)
  P('H', post.idx===pre.idx && post.cols===pre.cols+1, `인덱스 ${pre.idx}→${post.idx} · 컬럼 ${pre.cols}→${post.cols}(+1)`)

  // I. 정본 무변동
  const i9 = await one(`select
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7) snap,
    (select coalesce(sum(closing_amount),0)::text from public.monthly_snapshots where snap_year=2026 and snap_month=7) snap7`)
  P('I', i9.snap===pre.snap && i9.snap7===pre.snap7, `${i9.snap} / ${i9.snap7}`)

  await q('rollback')

  // 사후(ROLLBACK 후) 무잔류 확인
  const after = await one(`select
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='drugs' and column_name='efficacy_class') has_col,
    (select count(*)::int from public.drugs) rows,
    (select count(*)::int from public.drugs where drug_code='__DRYRUN0081__') junk`)
  P('ROLLBACK', after.has_col===0 && after.rows===pre.rows && after.junk===0,
     `컬럼 ${after.has_col}(0=제거) · 행수 ${after.rows} · 잔여 검증행 ${after.junk}`)
  P('사전 has_col', pre.has_col===0, `적용 전 컬럼 존재 ${pre.has_col}(0=없음이 정상)`)

  const allOk = Object.values(R).every(x=>x.ok)
  console.log(JSON.stringify({ allOk, pre, R }, null, 1))
}catch(e){ try{await q('rollback')}catch{}; console.error('dryrun 오류:', e.message); process.exitCode=1 }
finally{ await c.end() }
