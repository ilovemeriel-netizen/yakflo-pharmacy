// ════════════════════════════════════════════════════════════════
// Yakflo · 매칭소스 CSV 적재 로더 (2026-01~05) — anon+RLS 가역 적재
// 근거: supabase/seed/매칭소스/_적재안내.md (스키마 매핑·가역성·정리범위)
//
// 실행 (repo 루트):
//   미리보기(쓰기X):  node scripts/load_seed_2026.mjs
//   본 적용:          node scripts/load_seed_2026.mjs --commit
//
// 환경변수(셸 한정·커밋 금지):
//   SUPABASE_URL, SUPABASE_ANON_KEY
//   owner 로그인: .owner-login.local (email=…\npassword=…) — gitignored
//
// 원칙: 가산적(빈값/확인필요/미시드만), 유효값 덮어쓰기 금지, 식별 범위 정리.
//       inventory_stock=대조만, transactions=무삽입(0행 유지).
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const DIR = 'supabase/seed/매칭소스'
const TENANT_SLUG = 'cnc'
const FILES = {
  drugs:   `${DIR}/약품_정본.csv`,
  narc:    `${DIR}/보강_마약구분.csv`,
  presc:   `${DIR}/보강_전문일반.csv`,
  inv:     `${DIR}/초기재고.csv`,
  monthly: `${DIR}/월마감_2026.csv`,
}

// ── 최소 CSV 파서 (BOM 제거·따옴표 필드·필드내 콤마/개행·_x000D_) ──
function parseCsv(path) {
  let text = readFileSync(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)      // utf-8-sig BOM
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

// ── 인증: anon + owner 세션 (RLS 경유) ──
function ownerCreds() {
  const f = '.owner-login.local'
  if (!existsSync(f)) throw new Error('.owner-login.local 없음(owner 로그인 필요)')
  const o = {}; for (const ln of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = ln.match(/^(\w+)=(.+)$/); if (m) o[m[1]] = m[2] }
  return o
}
async function main() {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY 환경변수 필요')
  for (const [k, p] of Object.entries(FILES)) if (!existsSync(p)) throw new Error(`매칭소스 누락: ${p} (먼저 ${DIR}/에 정식 UTF-8-sig CSV 배치)`)

  const sb = createClient(url, anon, { auth: { persistSession: false } })
  const { email, password } = ownerCreds()
  const { error: aerr } = await sb.auth.signInWithPassword({ email, password })
  if (aerr) throw new Error('owner 로그인 실패: ' + aerr.message)

  const { data: tn } = await sb.from('tenants').select('id').eq('slug', TENANT_SLUG).single()
  const tid = tn.id
  console.log(`[모드] ${COMMIT ? '본 적용(--commit)' : '미리보기(쓰기 안 함)'} · tenant=${TENANT_SLUG}`)

  // drug_name → drug_code 맵 (NOCODE 합성코드 포함, DB의 정상 UTF-8 기준)
  const nameToCode = new Map()
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('drugs').select('drug_code,drug_name').eq('tenant_id', tid).range(from, from + 999)
    if (!data?.length) break
    for (const d of data) if (d.drug_name && !nameToCode.has(d.drug_name)) nameToCode.set(d.drug_name, d.drug_code)
    if (data.length < 1000) break
  }
  const resolveCode = (code, name) => (code && code.trim()) ? code.trim() : (nameToCode.get((name || '').trim()) || null)

  // ── Task2-a: narcotic_type 보강 (확인필요만) ──
  const narc = parseCsv(FILES.narc)
  let nNarc = 0
  for (const r of narc) {
    const code = resolveCode(r.drug_code, r['약품명'])
    const val = (r['보강값'] || '').trim()           // 일반 / 마약 …
    if (!code || !val) continue
    if (COMMIT) {
      const { error } = await sb.from('drugs').update({ narcotic_type: val })
        .eq('tenant_id', tid).eq('drug_code', code).eq('narcotic_type', '확인필요')
      if (error) console.warn('  narc update 경고', code, error.message)
    }
    nNarc++
  }

  // ── Task2-b: prescription_type 보강 (통합본 해소분만) ──
  const presc = parseCsv(FILES.presc)
  let nPresc = 0
  for (const r of presc) {
    const val = (r['보강값'] || '').trim()
    if (!(val === '일반의약품' || val === '전문의약품')) continue   // (미해소) 214건 skip
    const code = resolveCode(r.drug_code, r['약품명'])
    if (!code) continue
    if (COMMIT) {
      const { error } = await sb.from('drugs').update({ prescription_type: val })
        .eq('tenant_id', tid).eq('drug_code', code).eq('prescription_type', '확인필요')
      if (error) console.warn('  presc update 경고', code, error.message)
    }
    nPresc++
  }

  // ── Task3: inventory_stock 대조만 (덮어쓰기 없음) ──
  const inv = parseCsv(FILES.inv)
  let diffs = 0
  for (const r of inv) {
    const code = resolveCode(r.drug_code, r['약품명'])
    if (!code) continue
    const want = num(r.opening_qty)
    const { data } = await sb.from('inventory_stock').select('current_qty').eq('tenant_id', tid).eq('drug_code', code).maybeSingle()
    if (data && Math.abs(num(data.current_qty) - want) > 1e-6) { diffs++; if (diffs <= 10) console.log(`  ≠ ${code}: DB ${data.current_qty} vs CSV ${want}`) }
  }

  // ── Task4: monthly_snapshots upsert (2026-01~05) ──
  const ms = parseCsv(FILES.monthly)
  const perMonth = {}
  const recs = []
  for (const r of ms) {
    const sm = (r.snapshot_month || '').trim()         // 2026-01
    const m = sm.match(/^(\d{4})-(\d{2})$/); if (!m) continue
    const yr = +m[1], mo = +m[2]
    if (yr !== 2026 || mo < 1 || mo > 5) continue
    const code = resolveCode(r.drug_code, r['약품명']); if (!code) continue
    perMonth[sm] = (perMonth[sm] || 0) + 1
    const open = num(r.opening_qty), inq = num(r.in_qty)
    recs.push({
      tenant_id: tid, drug_code: code, snap_year: yr, snap_month: mo,
      opening_qty: open, opening_amount: num(r.opening_amt),
      total_in_qty: inq, total_in_amount: num(r.in_amt),
      subtotal_qty: open + inq, subtotal_amount: num(r.opening_amt) + num(r.in_amt),
      total_out_qty: num(r.used_qty), total_out_amount: num(r.used_amt),
      total_disp_qty: num(r.disposal_qty), total_ret_qty: num(r.return_qty),
      closing_qty: num(r.closing_qty), closing_amount: num(r.closing_amt),
    })
  }
  if (COMMIT) {
    for (let i = 0; i < recs.length; i += 500) {
      const { error } = await sb.from('monthly_snapshots')
        .upsert(recs.slice(i, i + 500), { onConflict: 'tenant_id,snap_year,snap_month,drug_code' })
      if (error) throw new Error('monthly upsert 실패: ' + error.message)
    }
  }

  console.log('\n── 요약 ──')
  console.log(`narcotic_type 보강 대상 ${nNarc}건 (확인필요만 적용)`)
  console.log(`prescription_type 보강 대상 ${nPresc}건 (통합본 해소분)`)
  console.log(`inventory_stock 차이 ${diffs}건 (대조만, 덮어쓰기 없음)`)
  console.log(`monthly_snapshots 대상 ${recs.length}행 · 월별 ` + JSON.stringify(perMonth))
  if (!COMMIT) console.log('\n미리보기 모드 — 실제 적용은 --commit')
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })