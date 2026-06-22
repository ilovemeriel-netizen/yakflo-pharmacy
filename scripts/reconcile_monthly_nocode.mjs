// ════════════════════════════════════════════════════════════════
// Yakflo · monthly_snapshots 2026-01~05 NOCODE 누락 회복 (출처명 대조+정규화)
// 근거: 월마감(연간보고서) 약품명 ↔ drugs 정본명(= NOCODE-#### 생성 출처) 대조.
//
// 실행 (repo 루트):
//   미리보기(쓰기X):  node scripts/reconcile_monthly_nocode.mjs
//   본 적용:          node scripts/reconcile_monthly_nocode.mjs --commit
//
// 원칙:
//  - 가산적(additive-only): 정규화로 새로 회복된 (snap_month, drug_code) 중
//    기존 DB·정확매칭에 없는 키만 upsert. 기존 적재·06 스냅샷·정본 무영향.
//  - append-only: monthly_snapshots는 upsert만. delete-reload 금지.
//  - 정규화·대조는 비교 전용 임시 처리 — 원본 약품명/정본 값 변경 없음.
//  - 모든 조회·쓰기 anon + owner 세션(RLS). service_role·비밀값 미사용.
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const DIR = 'supabase/seed/매칭소스'
const MONTHLY = `${DIR}/월마감_2026.csv`

// ── .env / .owner-login.local 로더 (anon키는 공개값, 출력 안 함) ──
function readEnvFile(path) {
  const o = {}
  if (!existsSync(path)) return o
  let txt = readFileSync(path, 'utf8'); if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1)
  for (const ln of txt.split(/\r?\n/)) { const m = ln.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return o
}

// ── CSV 파서 (BOM·따옴표·필드내 콤마/개행·_x000D_ 대응) — 로더와 동일 ──
function parseCsv(path) {
  let text = readFileSync(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c === '\r') { /* skip */ }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const header = rows.shift().map(h => h.replace(/_x000D_/g, '').trim())
  return rows.filter(r => r.some(v => v !== '')).map(r => {
    const o = {}; header.forEach((h, i) => (o[h] = (r[i] ?? '').replace(/_x000D_/g, '').trim())); return o
  })
}
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }

// ── 정규화 (비교 전용) ──
const norm1 = s => (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
const norm2 = s => norm1(s).replace(/[\s()[\]{}·∙•・,./\\\-_'"`~]+/g, '')
// 핵심명: 괄호 주석 제거(norm3), 그리고 '/' 앞부분만(norm4) — 변경/대체/중단 주석 제거용
const stripParen = s => (s || '').replace(/[(（[][^)）\]]*[)）\]]/g, ' ')
const norm3 = s => norm2(stripParen(s))
const norm4 = s => norm2(stripParen(s).split('/')[0])

async function main() {
  const env = { ...readEnvFile('.env') }
  const url = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('SUPABASE URL/ANON 키 필요(.env VITE_SUPABASE_*)')
  const cred = readEnvFile('.owner-login.local')
  if (!cred.email || !cred.password) throw new Error('.owner-login.local(email=,password=) 필요')

  const sb = createClient(url, anon, { auth: { persistSession: false } })
  const { error: aerr } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password })
  if (aerr) throw new Error('owner 로그인 실패: ' + aerr.message)
  const { data: { user } } = await sb.auth.getUser()
  const { data: tm } = await sb.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle()
  const tid = tm?.tenant_id
  if (!tid) throw new Error('owner tenant 매핑 없음(tenant_members)')
  console.log(`[모드] ${COMMIT ? '본 적용(--commit)' : '미리보기(쓰기 안 함)'}`)

  // ── drugs 정본: 이름 → 코드 (exact / norm1 / norm2) ──
  const exactName = new Map()
  const codeToName = new Map()
  const n1 = new Map(), n2 = new Map(), n3 = new Map(), n4 = new Map()   // norm키 → Set(code)
  const add = (map, k, code) => { if (k) { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(code) } }
  let drugCount = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('drugs').select('drug_code,drug_name').eq('tenant_id', tid).range(from, from + 999)
    if (error) throw new Error('drugs 조회 실패: ' + error.message)
    if (!data?.length) break
    for (const d of data) {
      drugCount++
      const nm = d.drug_name || ''
      codeToName.set(d.drug_code, nm)
      if (nm && !exactName.has(nm.trim())) exactName.set(nm.trim(), d.drug_code)
      add(n1, norm1(nm), d.drug_code); add(n2, norm2(nm), d.drug_code)
      add(n3, norm3(nm), d.drug_code); add(n4, norm4(nm), d.drug_code)
    }
    if (data.length < 1000) break
  }
  console.log(`drugs 정본 ${drugCount}종 로드`)

  const uniq = (map, k) => { const s = map.get(k); return s && s.size === 1 ? [...s][0] : null }

  // ── DB 기존 키(2026-01~05) — 가산성 보장용 ──
  const existing = new Set()  // `${mo}|${code}`
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('monthly_snapshots').select('snap_month,drug_code')
      .eq('tenant_id', tid).eq('snap_year', 2026).in('snap_month', [1, 2, 3, 4, 5]).range(from, from + 999)
    if (error) throw new Error('monthly 조회 실패: ' + error.message)
    if (!data?.length) break
    for (const r of data) existing.add(`${r.snap_month}|${r.drug_code}`)
    if (data.length < 1000) break
  }

  // ── 월마감 CSV 순회 ──
  const ms = parseCsv(MONTHLY)
  const recByKey = new Map()       // 회복행 dedup: `${mo}|${code}` → rec
  const recDbg = []                // 회복 매칭쌍 검증용: {mo, code, csvName, dbName, how}
  const residual = []              // 미복원: {mo, name, used, inq, disp, ret, close, open}
  const stat = {}                  // 월별 집계
  let viaCsvCode = 0, viaExact = 0, ambiguous = 0
  const viaNorm = { n1: 0, n2: 0, n3: 0, n4: 0 }
  const ambDbg = new Map()  // csvName → [후보 codes]
  for (const r of ms) {
    const m = (r.snapshot_month || '').match(/^(\d{4})-(\d{2})$/); if (!m) continue
    const yr = +m[1], mo = +m[2]
    if (yr !== 2026 || mo < 1 || mo > 5) continue
    stat[mo] = stat[mo] || { csv: 0, recovered: 0, residual: 0, 사용: 0, 휴면: 0, 중지: 0, names: { 사용: [], 휴면: [], 중지: [] } }
    stat[mo].csv++
    const name = r['약품명'] || ''

    // 매칭 우선순위: CSV코드 → 정확명 → norm1 → norm2 → norm3(괄호제거) → norm4('/'앞)
    let code = null, how = null
    if (r.drug_code && r.drug_code.trim()) { code = r.drug_code.trim(); how = 'csvcode' }
    else if (exactName.has(name.trim())) { code = exactName.get(name.trim()); how = 'exact' }
    else {
      for (const [tier, fn, map] of [['n1', norm1, n1], ['n2', norm2, n2], ['n3', norm3, n3], ['n4', norm4, n4]]) {
        const c = uniq(map, fn(name)); if (c) { code = c; how = tier; break }
      }
      if (!code) {
        for (const [, fn, map] of [['n1', norm1, n1], ['n2', norm2, n2], ['n3', norm3, n3], ['n4', norm4, n4]]) {
          const s = map.get(fn(name)); if (s && s.size > 1) { how = 'ambiguous'; ambDbg.set(name, [...s]); break }
        }
      }
    }

    if (how === 'csvcode') viaCsvCode++
    if (how === 'exact') viaExact++

    // 회복 대상 = 정규화로만 매칭된 신규 키 (기존 DB·정확매칭 미존재)
    if (['n1', 'n2', 'n3', 'n4'].includes(how) && code) {
      const key = `${mo}|${code}`
      if (existing.has(key) || recByKey.has(key)) {
        // 이미 적재됐거나 같은 배치서 중복 → 가산 대상 아님
      } else {
        viaNorm[how]++
        recDbg.push({ mo, code, csvName: name, dbName: codeToName.get(code), how })
        const open = num(r.opening_qty), inq = num(r.in_qty)
        recByKey.set(key, {
          tenant_id: tid, drug_code: code, snap_year: yr, snap_month: mo,
          opening_qty: open, opening_amount: num(r.opening_amt),
          total_in_qty: inq, total_in_amount: num(r.in_amt),
          subtotal_qty: open + inq, subtotal_amount: num(r.opening_amt) + num(r.in_amt),
          total_out_qty: num(r.used_qty), total_out_amount: num(r.used_amt),
          total_disp_qty: num(r.disposal_qty), total_ret_qty: num(r.return_qty),
          closing_qty: num(r.closing_qty), closing_amount: num(r.closing_amt),
        })
        stat[mo].recovered++
      }
      continue
    }

    // 코드가 있고(csvcode/exact) 적재 가능 → 누락 아님(기존 적재분). 통과.
    if (code) continue
    if (how === 'ambiguous') ambiguous++

    // 미복원 잔여 → 상태 분류 (월마감 활동 기준)
    const used = num(r.used_qty), inq = num(r.in_qty), disp = num(r.disposal_qty), ret = num(r.return_qty)
    const open = num(r.opening_qty), close = num(r.closing_qty)
    const activity = used > 0 || inq > 0 || disp > 0 || ret > 0
    const hasStock = close > 0 || open > 0
    const cls = activity ? '사용' : (hasStock ? '휴면' : '중지')
    stat[mo].residual++; stat[mo][cls]++
    stat[mo].names[cls].push(name)
    residual.push({ mo, name, cls, used, inq, disp, ret, open, close })
  }

  const recs = [...recByKey.values()]

  // ── 본 적용: upsert (append-only, 신규 키 한정) ──
  if (COMMIT && recs.length) {
    for (let i = 0; i < recs.length; i += 500) {
      const { error } = await sb.from('monthly_snapshots')
        .upsert(recs.slice(i, i + 500), { onConflict: 'tenant_id,snap_year,snap_month,drug_code' })
      if (error) throw new Error('monthly upsert 실패: ' + error.message)
    }
  }

  // ── 보고 ──
  console.log('\n── 매칭 요약 ──')
  console.log(`CSV코드 ${viaCsvCode} · 정확명 ${viaExact} · norm1 ${viaNorm.n1} · norm2 ${viaNorm.n2} · norm3(괄호) ${viaNorm.n3} · norm4('/') ${viaNorm.n4} · 모호(자동제외) ${ambiguous}`)
  console.log(`회복(신규 upsert 대상) ${recs.length}행`)

  console.log('\n── 회복 매칭쌍 검증 (월마감명 → 정본명) ──')
  for (const d of recDbg) console.log(`  [${d.how}] 2026-0${d.mo} ${d.code}\n     CSV: ${d.csvName}\n     정본: ${d.dbName}`)

  console.log('\n── 월별 회복/잔여 ──')
  for (const mo of [1, 2, 3, 4, 5]) {
    const s = stat[mo]; if (!s) continue
    console.log(`2026-0${mo}: CSV ${s.csv} · 회복 +${s.recovered} · 잔여 ${s.residual} (사용 ${s.사용}/휴면 ${s.휴면}/중지 ${s.중지})`)
  }

  // 완전성 표 (현재 DB + 회복분 반영 예상)
  const base = {}
  for (const k of existing) { const mo = +k.split('|')[0]; base[mo] = (base[mo] || 0) + 1 }
  console.log('\n── 완전성 표 (06=1103 기준) ──')
  console.log('월\t현재DB\t+회복\t예상\t06대비격차')
  for (const mo of [1, 2, 3, 4, 5]) {
    const cur = base[mo] || 0, rec = stat[mo]?.recovered || 0
    console.log(`2026-0${mo}\t${cur}\t+${rec}\t${cur + rec}\t${1103 - (cur + rec)}`)
  }
  console.log(`2026-06\t1103\t-\t1103\t0  (yakflo_data 완전 시드, 무영향)`)

  // 잔여 명단 (상태별, 월 무관 유니크 이름)
  const byCls = { 사용: new Set(), 휴면: new Set(), 중지: new Set() }
  for (const r of residual) byCls[r.cls].add(r.name)
  console.log('\n── 모호(다중 후보로 자동제외) ──')
  for (const [nm, codes] of ambDbg) console.log(`  · ${nm}\n     후보: ${codes.map(c => `${c}(${codeToName.get(c)})`).join(' | ')}`)

  console.log('\n── 잔여 미복원 명단(유니크) ──')
  for (const cls of ['사용', '휴면', '중지']) {
    const arr = [...byCls[cls]].sort()
    console.log(`[${cls}] ${arr.length}종`)
    for (const nm of arr) console.log(`   · ${nm}`)
  }

  if (!COMMIT) console.log('\n미리보기 모드 — 실제 적용은 --commit')
  console.log(`\n[롤백] 회복분만 제거 시: delete from monthly_snapshots where tenant_id='<cnc>' and snap_year=2026 and (snap_month,drug_code) in ( ${recs.slice(0,3).map(r => `(${r.snap_month},'${r.drug_code}')`).join(', ')} ... 총 ${recs.length}건 );`)
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })