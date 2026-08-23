// dryrun_0072.mjs — 0072_drug_status_audit dryrun (BEGIN → 생성 → 검증 A~G → ROLLBACK)
// 운영(phg) 접속. 어떤 변경도 커밋하지 않음(마지막 ROLLBACK).
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
function rd(p){const o={};if(!existsSync(p))return o;let t=readFileSync(p,'utf8');if(t.charCodeAt(0)===0xfeff)t=t.slice(1);for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env=rd('.env')
let url=env.DATABASE_URL||''
if(/\/postgre$/.test(url))url+='s'   // 풀러 URL 오타 보정 /postgre → /postgres
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}})

// 마이그레이션 파일에서 begin;/commit; 제거한 본문(내 트랜잭션 안에서 실행)
let ddl=readFileSync('supabase/migrations/0072_drug_status_audit.sql','utf8')
ddl=ddl.replace(/^\s*begin;\s*$/mi,'').replace(/^\s*commit;\s*$/mi,'')

const q=(s,a)=>client.query(s,a)
const one=async(s,a)=>(await q(s,a)).rows[0]
const log=(...a)=>console.log(...a)

await client.connect()
try{
  await q('begin')

  // 베이스라인
  const drugsN0=Number((await one('select count(*)::int n from public.drugs')).n)
  const snap7=await one(`select coalesce(sum(closing_amount),0)::numeric s, count(*)::int n from public.monthly_snapshots where snap_year=2026 and snap_month=7`)
  const snapAll0=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)
  const auditTblBefore=Number((await one(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='drug_status_audit'`)).n)

  // 생성(마이그레이션 DDL 실행)
  await q(ddl)

  // 검증 대상 약품 1건(상태 '사용')
  const target=await one(`select drug_code, status, tenant_id from public.drugs where status='사용' order by drug_code limit 1`)

  const auditCnt=async()=>Number((await one('select count(*)::int n from public.drug_status_audit')).n)
  const c_created=await auditCnt() // 생성 직후(소급 없음 → 0 이어야)

  // B. status 변경 UPDATE → 1행 기록, old/new 정확
  await q(`update public.drugs set status='중지' where drug_code=$1`,[target.drug_code])
  const cB=await auditCnt()
  const rowB=await one(`select drug_code, old_status, new_status, tenant_id, changed_at from public.drug_status_audit order by changed_at desc limit 1`)

  // C. 동일 값 UPDATE(status='중지' 재설정) → 미기록
  await q(`update public.drugs set status='중지' where drug_code=$1`,[target.drug_code])
  const cC=await auditCnt()

  // D. 다른 컬럼 UPDATE(단가/수량 가드 없는 텍스트 컬럼 atc_exclude_reason) → 미기록
  await q(`update public.drugs set atc_exclude_reason='__dryrun__' where drug_code=$1`,[target.drug_code])
  const cD=await auditCnt()

  // NULL↔값 확인(status nullable 인 경우만)
  const statusNullable=(await one(`select is_nullable from information_schema.columns where table_schema='public' and table_name='drugs' and column_name='status'`)).is_nullable==='YES'
  let nullTest='status NOT NULL → 스킵(‘is distinct from’이 NULL 처리 보장)'
  if(statusNullable){
    await q('savepoint sp_null')
    try{
      const before=await auditCnt()
      await q(`update public.drugs set status=null where drug_code=$1`,[target.drug_code])
      const after=await auditCnt()
      const rowN=await one(`select old_status, new_status from public.drug_status_audit where new_status is null limit 1`)
      nullTest=`값→NULL +${after-before}행, old='${rowN?.old_status}' new=${rowN&&rowN.new_status===null?'NULL':`'${rowN?.new_status}'`}  ${after-before===1&&rowN&&rowN.new_status===null?'✅':'❌'}`
    }catch(e){nullTest='값→NULL 시도 실패(제약): '+e.message}
    await q('rollback to savepoint sp_null')
  }

  // A. drugs 행수 무변동
  const drugsN1=Number((await one('select count(*)::int n from public.drugs')).n)

  // E. tenant_id 자동 충전(트리거가 drugs행 tenant 전달 → NOT NULL, 원천과 일치)
  const eOk = rowB && rowB.tenant_id && String(rowB.tenant_id)===String(target.tenant_id)

  // F. RLS 정책 4종
  const pol=(await q(`select policyname, cmd from pg_policies where schemaname='public' and tablename='drug_status_audit' order by cmd`)).rows
  const rlsOn=(await one(`select relrowsecurity from pg_class where oid='public.drug_status_audit'::regclass`)).relrowsecurity

  // G. 정본 무변동(1~7월 closing 합 · 7월 기말)
  const snapAll1=await one(`select coalesce(sum(closing_amount),0)::numeric s from public.monthly_snapshots where snap_year=2026 and snap_month between 1 and 7`)

  await q('rollback')

  // ── 결과 표 ──
  const P=(k,v)=>log(String(k).padEnd(46),v)
  log('\n════════ 0072 dryrun 결과 (전량 ROLLBACK 완료) ════════')
  P('A. drugs 행수 (전/후)', `${drugsN0} → ${drugsN1}  ${drugsN0===drugsN1?'✅ 무변동':'❌'}`)
  P('   (기준 1,111행 일치)', drugsN0===1111?'✅':`⚠ 실측 ${drugsN0}`)
  P('   생성 직후 audit 행수 (소급 없음)', `${c_created}  ${c_created===0?'✅ 0건':'❌'}`)
  P('B. status 변경 → 이력 기록', `+${cB-c_created}행  ${cB-c_created===1?'✅':'❌'}`)
  P('   old/new 정확', `old='${rowB?.old_status}' new='${rowB?.new_status}'  ${rowB?.old_status==='사용'&&rowB?.new_status==='중지'?'✅':'❌'}`)
  P('C. 동일 값 UPDATE → 미기록', `${cC===cB?'✅ 변화없음':'❌ +'+(cC-cB)}`)
  P('D. 다른 컬럼(atc_exclude_reason) → 미기록', `${cD===cB?'✅ 변화없음':'❌ +'+(cD-cB)}`)
  P('E. tenant_id 자동 충전(원천 일치·NOT NULL)', eOk?'✅':'❌')
  P('F. RLS 활성', rlsOn?'✅':'❌')
  P('   RLS 정책 수', `${pol.length}종 [${pol.map(p=>p.cmd).join(',')}]  ${pol.length===4?'✅':'❌'}`)
  P('G. 정본 1~7월 closing 합 (전/후)', `${Math.round(Number(snapAll0.s)).toLocaleString()} → ${Math.round(Number(snapAll1.s)).toLocaleString()}  ${Number(snapAll0.s)===Number(snapAll1.s)?'✅ 무변동':'❌'}`)
  P('   7월 기말(스냅 '+snap7.n+'행)', `${Math.round(Number(snap7.s)).toLocaleString()}  ${Math.round(Number(snap7.s))===106365758?'✅ 정본 일치':'⚠ 확인'}`)
  P('   NULL↔값', nullTest)
  log('══════════════════════════════════════════════════════')
}catch(e){
  try{await q('rollback')}catch{}
  console.error('DRYRUN 오류:',e.message)
  process.exitCode=1
}finally{
  await client.end()
}
