// dryrun_0093.mjs — 0093+0094(백신 수요조사) 사전 점검. **절대 COMMIT 하지 않는다.**
//
// ★ supabase db push 를 쓰지 않는다 — schema_migrations 0행 + 로컬 95건이라
//   CLI push 는 0000_baseline 부터 전량 재적용한다(운영 파괴).
// ★ BEGIN … ROLLBACK 안에서만 돌린다. 끝에서 반드시 rollback 한다.
// ★ 두 SQL 은 파일 그대로 쓴다. 이 스크립트가 내용을 바꾸지 않는다.
// ★ 기존 객체를 건드리는 구문이 섞여 있으면 보내기 전에 중단한다.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

function rd(p) {
  const o = {}; if (!existsSync(p)) return o
  let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return o
}
const env = rd('.env'); let url = env.DATABASE_URL || ''; if (/\/postgre$/.test(url)) url += 's'
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const q = (s, a) => c.query(s, a)
const one = async (s, a) => (await q(s, a)).rows[0]
const rows = async (s, a) => (await q(s, a)).rows

const F1 = 'supabase/migrations/0093_vaccine_survey.sql'
const F2 = 'supabase/migrations/0094_vaccine_survey_grants.sql'
const ddl1 = readFileSync(F1, 'utf8')
const ddl2 = readFileSync(F2, 'utf8')

/* ── 보내기 전 차단 검사 ───────────────────────────────────────────────────
   기존 테이블·뷰·정책을 건드리는 구문이 있으면 멈춘다. 새 객체 이름만 허용한다. */
const NEW = ['vaccine_surveys', 'vaccine_survey_responses', 'vaccine_survey_audit',
  'vaccine_survey_attempts', 'v_vaccine_demand', 'purge_vaccine_survey',
  'is_tenant_admin', 'guard_vaccine_survey_cats', 'guard_vaccine_survey_response',
  'guard_vaccine_survey_audit_append_only']
const body = (ddl1 + '\n' + ddl2).split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')
{
  /* 기존 객체 대상 ALTER/DROP 이 섞였는지 — 새 이름이 들어 있지 않은 alter/drop 은 전부 의심 */
  const touches = body.split(/\r?\n/).filter(l =>
    /^\s*(alter|drop)\s+(table|view|policy|trigger|function|index)/i.test(l))
  const bad = touches.filter(l => !NEW.some(n => l.includes(n)))
  if (bad.length) {
    console.error('★ 중단 — 기존 객체를 건드리는 구문:\n' + bad.map(x => '   ' + x.trim()).join('\n'))
    process.exit(1)
  }
  if (/\bto\s+anon\b/i.test(body)) { console.error('★ 중단 — anon 대상 GRANT 발견'); process.exit(1) }
  /* ★ 「언급」이 아니라 「대상」만 본다 — comment on … is '…vaccine_public_attempts…' 같은
     설명 문구까지 잡으면 오탐이 난다(첫 실행에서 실제로 걸렸다). */
  const PROTECTED = ['vaccine_public_attempts', 'vaccine_public_settings',
    'vaccine_events', 'vaccine_accounts', 'vaccine_categories', 'tenant_members', 'tenants']
  {
    const targeted = []
    for (const stmt of body.split(';')) {
      const s = stmt.trim(); if (!s) continue
      const m = s.match(/^(alter|drop|create(?:\s+or\s+replace)?)\s+(table|view|policy|trigger|index|materialized\s+view)\s+(?:if\s+exists\s+|if\s+not\s+exists\s+)?([^\s(]+)/i)
      if (m) {
        /* trigger·policy 는 「on <table>」 가 대상이다 */
        const onTbl = (s.match(/\bon\s+(?:public\.)?([a-z_]+)/i) || [])[1]
        const tgt = /trigger|policy|index/i.test(m[2]) ? onTbl : m[3].replace(/^public\./, '')
        if (tgt && PROTECTED.includes(tgt)) targeted.push(s.slice(0, 90).replace(/\s+/g, ' '))
      }
      const g = s.match(/^(grant|revoke)\b[\s\S]*?\bon\s+(?:table\s+)?(?:public\.)?([a-z_]+)/i)
      if (g && PROTECTED.includes(g[2])) targeted.push(s.slice(0, 90).replace(/\s+/g, ' '))
    }
    if (targeted.length) {
      console.error('★ 중단 — 기존 객체를 대상으로 하는 구문:\n' + targeted.map(x => '   ' + x).join('\n'))
      process.exit(1)
    }
    console.log('  보호 객체 대상 구문 0건 — ' + PROTECTED.join(' · '))
  }
  console.log('  보내기 전 검사 통과 — 새 객체만 다루고 anon 대상 GRANT 는 없다')
}

const checks = []
const gate = (n, ok, got) => { checks.push([n, ok, got]); console.log(`  ${ok ? 'OK ' : '★NG'}  ${String(n).padEnd(52)} ${got}`) }

/* 단계 0 실측 기준선 */
const BASE_POLICIES = 114
const PAID_ACCOUNT = '5dcb9b9f-d1bf-4bca-b2ac-1d11f6b5e173'
const CAT_STAFF = 'e16bad4b-39a3-4d8b-87c7-1f045eb058e7'   // 직원(무료)
const CAT_FAMILY = '01ef2368-d8ec-48a5-94d3-71341739d515'  // 직원가족&간병사(30000)
const CAT_OUT = 'a82483fd-f6a9-4a9e-b889-c9c34758f1e1'     // 외래&입원(35000) — 제외 대상

await c.connect()
let rolledBack = false
try {
  const before = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from public.vaccine_events) events,
    (select count(*)::int from public.vaccine_public_attempts) pub_attempts,
    (select count(*)::int from public.vaccine_categories) cats`)
  console.log(`\n기준선 — 정책 ${before.policies} · events ${before.events} · 0091잠금 ${before.pub_attempts}행 · 분류 ${before.cats}`)
  if (before.policies !== BASE_POLICIES) {
    console.error(`\n★ 중단 — 정책 수 ${before.policies} (기대 ${BASE_POLICIES})`); process.exit(1)
  }

  console.log('\n===== BEGIN (dryrun) =====')
  await q('begin')
  await q(ddl1); console.log('0093 실행 완료')
  await q(ddl2); console.log('0094 실행 완료')

  console.log('\n===== 검증 =====')

  /* 1~4) 테이블 4개 */
  for (const t of ['vaccine_surveys', 'vaccine_survey_responses', 'vaccine_survey_audit', 'vaccine_survey_attempts']) {
    const r = await one(`select c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=$1 and c.relkind='r'`, [t])
    gate(`${t} 생성 + RLS on`, !!r && r.rls === true, r ? ('rls=' + r.rls) : '없음')
  }

  /* 5) 뷰 + security_invoker */
  {
    const r = await one(`select coalesce(reloptions::text,'') o from pg_class where oid='public.v_vaccine_demand'::regclass`)
    gate('v_vaccine_demand + security_invoker=true', /security_invoker=true/.test(r?.o || ''), r?.o || '없음')
  }

  /* 6) anon 권한 0건 */
  {
    const r = await rows(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee='anon'
        and table_name in ('vaccine_surveys','vaccine_survey_responses','vaccine_survey_audit','vaccine_survey_attempts','v_vaccine_demand')`)
    gate('anon 권한 0건', r.length === 0, r.length ? '★' + r.map(x => x.table_name + ':' + x.privilege_type).join(',') : '0건')
  }

  /* 7) service_role GRANT */
  {
    const want = {
      vaccine_surveys: ['SELECT'],
      vaccine_survey_responses: ['SELECT', 'INSERT', 'UPDATE'],
      vaccine_survey_attempts: ['SELECT', 'INSERT', 'UPDATE'],
    }
    const miss = []
    for (const [t, ps] of Object.entries(want))
      for (const p of ps) {
        const r = await one(`select has_table_privilege('service_role', $1, $2) ok`, ['public.' + t, p])
        if (!r.ok) miss.push(t + ':' + p)
      }
    gate('service_role 필요 GRANT 전부', miss.length === 0, miss.length ? '★부족 ' + miss.join(',') : '전부 true')
  }

  /* 8) service_role 과잉 금지 — responses DELETE · audit 전부 */
  {
    const d = await one(`select has_table_privilege('service_role','public.vaccine_survey_responses','DELETE') d,
                                has_table_privilege('service_role','public.vaccine_survey_audit','SELECT') a,
                                has_table_privilege('service_role','public.vaccine_survey_attempts','DELETE') ad`)
    gate('service_role 과잉 권한 없음', d.d === false && d.a === false && d.ad === false,
      `responses.DELETE=${d.d} audit.SELECT=${d.a} attempts.DELETE=${d.ad}`)
  }

  /* 9) authenticated 열 단위 UPDATE — 4개만 */
  {
    const cols = await rows(`select column_name from information_schema.column_privileges
      where table_schema='public' and table_name='vaccine_survey_responses'
        and grantee='authenticated' and privilege_type='UPDATE' order by 1`)
    const got = cols.map(x => x.column_name)
    const want = ['done_family', 'done_self', 'status', 'updated_at']
    gate('responses UPDATE 는 4개 열만', JSON.stringify(got) === JSON.stringify(want), got.join(','))
  }
  {
    const r = await one(`select has_column_privilege('authenticated','public.vaccine_survey_responses','name','UPDATE') nm,
                                has_table_privilege('authenticated','public.vaccine_survey_responses','INSERT') ins,
                                has_table_privilege('authenticated','public.vaccine_survey_responses','DELETE') del`)
    gate('responses 의 name UPDATE·INSERT·DELETE 불가', r.nm === false && r.ins === false && r.del === false,
      `name=${r.nm} insert=${r.ins} delete=${r.del}`)
  }
  {
    const r = await one(`select has_table_privilege('authenticated','public.vaccine_survey_attempts','SELECT') s`)
    gate('authenticated 는 attempts 접근 불가', r.s === false, 'select=' + r.s)
  }

  /* 10) 부분 UNIQUE 2개 */
  {
    const idx = await rows(`select indexname, indexdef from pg_indexes
      where schemaname='public' and indexdef like '%WHERE%' and (tablename='vaccine_surveys' or tablename='vaccine_survey_responses')
      order by 1`)
    const open1 = idx.find(x => x.indexname === 'vaccine_surveys_one_open_idx')
    const emp1 = idx.find(x => x.indexname === 'vaccine_survey_responses_emp_uniq')
    gate('부분 UNIQUE — 열린 회차 1건', !!open1 && /status = 'open'/.test(open1.indexdef), open1 ? 'OK' : '없음')
    gate('부분 UNIQUE — 사번 1회', !!emp1 && /emp_no IS NOT NULL/.test(emp1.indexdef), emp1 ? 'OK' : '없음')
  }

  /* 11) audit UPDATE·DELETE 거부 */
  {
    const tenant = (await one(`select tenant_id from public.vaccine_accounts limit 1`)).tenant_id
    const sv = await one(`insert into public.vaccine_surveys
      (tenant_id,title,season,account_id,category_ids,vax_start,vax_end)
      values ($1,'dryrun','2026-2027',$2,array[$3::uuid,$4::uuid],current_date,current_date+30) returning id`,
      [tenant, PAID_ACCOUNT, CAT_STAFF, CAT_FAMILY])
    const au = await one(`insert into public.vaccine_survey_audit (tenant_id,survey_id,user_id,action,row_count)
      values ($1,$2,gen_random_uuid(),'view_raw',1) returning id`, [tenant, sv.id])
    let upBlocked = false, delBlocked = false
    try { await q(`savepoint s1`); await q(`update public.vaccine_survey_audit set row_count=2 where id=$1`, [au.id]) }
    catch { upBlocked = true } finally { await q(`rollback to savepoint s1`) }
    try { await q(`savepoint s2`); await q(`delete from public.vaccine_survey_audit where id=$1`, [au.id]) }
    catch { delBlocked = true } finally { await q(`rollback to savepoint s2`) }
    gate('audit UPDATE 거부', upBlocked, upBlocked ? '막힘' : '★통과됨')
    gate('audit DELETE 거부', delBlocked, delBlocked ? '막힘' : '★통과됨')

    /* 12) category_ids 트리거 — 다른 계정 분류 거부 */
    let catBlocked = false
    try {
      await q(`savepoint s3`)
      await q(`update public.vaccine_surveys set category_ids = array[gen_random_uuid()] where id=$1`, [sv.id])
    } catch { catBlocked = true } finally { await q(`rollback to savepoint s3`) }
    gate('category_ids 트리거 — 없는 분류 거부', catBlocked, catBlocked ? '막힘' : '★통과됨')

    /* 13) cardinality CHECK */
    let emptyBlocked = false
    try { await q(`savepoint s4`); await q(`update public.vaccine_surveys set category_ids='{}' where id=$1`, [sv.id]) }
    catch { emptyBlocked = true } finally { await q(`rollback to savepoint s4`) }
    gate('category_ids 빈 배열 거부', emptyBlocked, emptyBlocked ? '막힘' : '★통과됨')

    /* 14) 열린 회차 1건 제약 */
    await q(`update public.vaccine_surveys set status='open', open_at=now() where id=$1`, [sv.id])
    let twoOpenBlocked = false
    try {
      await q(`savepoint s5`)
      await q(`insert into public.vaccine_surveys (tenant_id,title,season,account_id,category_ids,vax_start,vax_end,status,open_at)
        values ($1,'dryrun2','2026-2027',$2,array[$3::uuid],current_date,current_date+30,'open',now())`,
        [tenant, PAID_ACCOUNT, CAT_STAFF])
    } catch { twoOpenBlocked = true } finally { await q(`rollback to savepoint s5`) }
    gate('열린 회차 2건 거부', twoOpenBlocked, twoOpenBlocked ? '막힘' : '★통과됨')

    /* 15) purge 조건 거부 — 열린 회차 */
    let purgeOpenBlocked = false
    try { await q(`savepoint s6`); await q(`select public.purge_vaccine_survey($1)`, [sv.id]) }
    catch (e) { purgeOpenBlocked = /닫은 뒤|권한|관리자/.test(e.message) } finally { await q(`rollback to savepoint s6`) }
    gate('purge 거부 — 열린 회차', purgeOpenBlocked, purgeOpenBlocked ? '막힘' : '★통과됨')

    /* 16) purge 조건 거부 — 끝날 이전 */
    await q(`update public.vaccine_surveys set status='closed' where id=$1`, [sv.id])
    let purgeEarlyBlocked = false
    try { await q(`savepoint s7`); await q(`select public.purge_vaccine_survey($1)`, [sv.id]) }
    catch (e) { purgeEarlyBlocked = /끝날|권한|관리자/.test(e.message) } finally { await q(`rollback to savepoint s7`) }
    gate('purge 거부 — 접종 끝날 이전', purgeEarlyBlocked, purgeEarlyBlocked ? '막힘' : '★통과됨')

    /* 17) 응답 가드 — 희망일 범위 밖 거부 */
    let wishBlocked = false
    try {
      await q(`savepoint s8`)
      await q(`insert into public.vaccine_survey_responses
        (tenant_id,survey_id,receipt_code,name,name_key,self_dose,family_count,account_id,wish_date,consent_at)
        values ($1,$2,'AB2345','x','x',true,0,$3,current_date-1,now())`, [tenant, sv.id, PAID_ACCOUNT])
    } catch { wishBlocked = true } finally { await q(`rollback to savepoint s8`) }
    gate('응답 가드 — 희망일 범위 밖 거부', wishBlocked, wishBlocked ? '막힘' : '★통과됨')

    /* 18) 신청번호 문자 집합 — 혼동 문자 거부 */
    let codeBlocked = false
    try {
      await q(`savepoint s9`)
      await q(`insert into public.vaccine_survey_responses
        (tenant_id,survey_id,receipt_code,name,name_key,self_dose,family_count,account_id,wish_date,consent_at)
        values ($1,$2,'AB01IL','x','x',true,0,$3,current_date,now())`, [tenant, sv.id, PAID_ACCOUNT])
    } catch { codeBlocked = true } finally { await q(`rollback to savepoint s9`) }
    gate('신청번호 혼동 문자(0 1 I L) 거부', codeBlocked, codeBlocked ? '막힘' : '★통과됨')

    /* 19) 본인·가족 둘 다 0 거부 */
    let doseBlocked = false
    try {
      await q(`savepoint s10`)
      await q(`insert into public.vaccine_survey_responses
        (tenant_id,survey_id,receipt_code,name,name_key,self_dose,family_count,account_id,wish_date,consent_at)
        values ($1,$2,'AB2345','x','x',false,0,$3,current_date,now())`, [tenant, sv.id, PAID_ACCOUNT])
    } catch { doseBlocked = true } finally { await q(`rollback to savepoint s10`) }
    gate('본인X·가족0 거부', doseBlocked, doseBlocked ? '막힘' : '★통과됨')

    /* 20) ★ A 산식 실측 검산 — 선택 분류 2개만 잡히고 외래&입원은 빠지는지 */
    await q(`update public.vaccine_surveys
      set status='open', open_at=(timestamp '2026-09-01 00:00+09')::timestamptz,
          category_ids=array[$2::uuid,$3::uuid]
      where id=$1`, [sv.id, CAT_STAFF, CAT_FAMILY])
    const a2 = await one(`select administered_qty, demand_qty, balance_qty, remain_qty, safety_qty, gap_qty, order_qty, demand_status
      from public.v_vaccine_demand where survey_id=$1`, [sv.id])
    /* 같은 조건을 직접 집계해 대조 */
    const direct = await one(`select
      coalesce(sum(qty) filter (where category_id = any(array[$1::uuid,$2::uuid])),0)::numeric sel,
      coalesce(sum(qty) filter (where category_id = $3::uuid),0)::numeric outq
      from public.vaccine_events
      where event_type='접종' and account_id=$4 and event_date >= date '2026-09-01'`,
      [CAT_STAFF, CAT_FAMILY, CAT_OUT, PAID_ACCOUNT])
    gate('A 산식 = 선택 분류 2개 합', String(a2.administered_qty) === String(direct.sel),
      `뷰 A=${a2.administered_qty} · 직접집계=${direct.sel}`)
    gate('A 에 외래&입원 제외', Number(direct.outq) > 0 && Number(a2.administered_qty) !== Number(direct.sel) + Number(direct.outq),
      `외래&입원=${direct.outq} (A 에 포함 안 됨)`)
    /* ★ 고정 숫자(=== 31)로 비교하지 않는다 — 잔량은 입고·접종이 생기면 매일 바뀌고,
       그러면 재고와 무관한 이 시험이 거짓 NG 를 낸다. 같은 조건을 직접 읽어 대조한다. */
    const bLive = Number((await one(
      `select coalesce(balance_qty,0)::numeric q from public.v_vaccine_balance where account_id=$1`,
      [PAID_ACCOUNT]))?.q ?? 0)
    gate('B = v_vaccine_balance 그대로', Number(a2.balance_qty) === bLive,
      `B=${a2.balance_qty} · 잔량뷰=${bLive}`)

    /* 21) 산식 검산 — D=60, A=0 → O=40 */
    await q(`update public.vaccine_surveys set open_at=now() where id=$1`, [sv.id])  /* A=0 으로 되돌림 */
    /* 가족 수 상한이 20 이므로 (본인 1 + 가족 19) × 3건 = 60 으로 만든다 */
    for (let i = 0; i < 3; i++) {
      await q(`insert into public.vaccine_survey_responses
        (tenant_id,survey_id,receipt_code,name,name_key,self_dose,family_count,account_id,wish_date,consent_at)
        values ($1,$2,$3,'검산','검산',true,19,$4,current_date,now())`,
        [tenant, sv.id, 'AB234' + (i + 2), PAID_ACCOUNT])
    }
    const v = await one(`select demand_qty,administered_qty,remain_qty,safety_qty,gap_qty,order_qty,demand_status,balance_qty,
      safety_ratio,safety_min,order_unit
      from public.v_vaccine_demand where survey_id=$1`, [sv.id])
    /* ★ 기대값을 고정 숫자로 적지 않는다 — A(오늘 접종)와 B(잔량)는 운영 데이터다.
       ① 원재료(A·B)는 뷰가 아닌 곳에서 **직접 집계**해 가져오고
       ② R·S·G·O·상태는 0093 의 산식대로 JS 에서 다시 계산해 뷰와 맞춘다.
       D 만 60 으로 고정할 수 있다 — 이 트랜잭션에서 만든 회차의 신청뿐이라 자립적이다. */
    const aLive = Number((await one(`select coalesce(sum(qty),0)::numeric q from public.vaccine_events
      where event_type='접종' and account_id=$1 and category_id = any(array[$2::uuid,$3::uuid])
        and event_date >= (now() at time zone 'Asia/Seoul')::date`,
      [PAID_ACCOUNT, CAT_STAFF, CAT_FAMILY])).q)
    const D = 60
    const B = bLive
    const R = Math.max(0, D - aLive)
    const S = Math.max(Number(v.safety_min), Math.ceil(R * Number(v.safety_ratio)))
    const G = Math.max(0, R + S - B)
    const unit = Number(v.order_unit)
    const O = Math.ceil(G / unit) * unit
    const ST = B >= R + S ? '충분' : B >= R ? '주의' : '부족'
    gate(`검산 D=${D}`, Number(v.demand_qty) === D, 'D=' + v.demand_qty)
    gate(`검산 A=${aLive} (직접집계와 같다)`, Number(v.administered_qty) === aLive, 'A=' + v.administered_qty)
    gate(`검산 R=${R} (D−A)`, Number(v.remain_qty) === R, 'R=' + v.remain_qty)
    gate(`검산 S=${S} (max(${v.safety_min}, ceil(R×${v.safety_ratio})))`, Number(v.safety_qty) === S, 'S=' + v.safety_qty)
    gate(`검산 G=${G} (R+S−B, B=${B})`, Number(v.gap_qty) === G, 'G=' + v.gap_qty)
    gate(`검산 O=${O} (ceil(G/${unit})×${unit})`, Number(v.order_qty) === O, 'O=' + v.order_qty)
    gate(`검산 상태=${ST}`, v.demand_status === ST, v.demand_status)
  }

  /* 22) 정책 수 = 114 + 7 */
  {
    const r = await one(`select count(*)::int p from pg_policies where schemaname='public'`)
    gate('정책 수 = 114 + 7', r.p === BASE_POLICIES + 7, `${r.p}개 (기존 ${BASE_POLICIES} + 신규 ${r.p - BASE_POLICIES})`)
  }

  /* 23) 기존 것 불변 */
  {
    const a2 = await one(`select
      (select count(*)::int from public.vaccine_events) events,
      (select count(*)::int from public.vaccine_public_attempts) pub_attempts,
      (select count(*)::int from public.vaccine_categories) cats,
      (select count(*)::int from pg_policies where schemaname='public' and tablename in ('vaccine_events','vaccine_accounts','vaccine_categories')) old_pol`)
    gate('기존 vaccine_events 행 수 불변', a2.events === before.events, `${a2.events}행`)
    gate('0091 잠금 테이블 행 수 불변', a2.pub_attempts === before.pub_attempts, `${a2.pub_attempts}행`)
    gate('기존 vaccine_* 정책 12개 불변', a2.old_pol === 12, `${a2.old_pol}개`)
  }

  await q('rollback'); rolledBack = true
  console.log('\n===== ROLLBACK 완료 — 아무것도 반영되지 않았습니다 =====')

  const after = await one(`select
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname like 'vaccine_survey%') survey_objs`)
  gate('롤백 후 정책 수 원복', after.policies === BASE_POLICIES, `${after.policies}개`)
  gate('롤백 후 새 테이블 0개', after.survey_objs === 0, `${after.survey_objs}개`)

  const ng = checks.filter(x => !x[1])
  console.log(`\n===== 결과 ${checks.length - ng.length}/${checks.length} 통과 =====`)
  if (ng.length) { console.error('★ 실패: ' + ng.map(x => x[0]).join(', ')); process.exitCode = 1 }
  else console.log('dryrun 통과 — apply 는 별도 지시로만 진행합니다.')
} catch (e) {
  if (!rolledBack) { try { await q('rollback'); console.error('\n★ ROLLBACK 완료') } catch { console.error('\n★ ROLLBACK 시도 실패') } }
  console.error('★ dryrun 실패:', e.message)
  process.exitCode = 1
} finally { await c.end() }
