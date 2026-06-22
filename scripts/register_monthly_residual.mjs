// ════════════════════════════════════════════════════════════════
// Yakflo · 월마감 잔여 10종 전부 등록 (모호 4 후보배정 + 신규 6 정본등재)
// 정책: 중복이 아닌 한 모든 기초데이터 등록(사용자 정본). 판단으로 누락하지 않음.
//   - 모호(정본 동일/유사명 복수후보): 동일 후보군 내 정렬 1:1 전역 배정(결정적). 신규코드 없음.
//   - 신규(정본 미존재): NOCODE-#### 연번 부여 → drugs 정본 등재(status=중지) → monthly 적재.
//   - 공란 필드는 추후 공공데이터포털 API로 보완(현재 최소필드).
// 실행: node scripts/register_monthly_residual.mjs          (미리보기·쓰기X)
//       node scripts/register_monthly_residual.mjs --commit (본 적용)
// 가역: 신규 drugs는 drug_code로 식별 삭제, monthly는 (월,코드) 키로 삭제. append-only upsert.
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const MONTHLY = 'supabase/seed/매칭소스/월마감_2026.csv'

function rd(p) { const o = {}; if (!existsSync(p)) return o; let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } return o }
function parseCsv(path) {
  let text = readFileSync(path, 'utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) { const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c === '\r') { } else cur += c }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const header = rows.shift().map(h => h.replace(/_x000D_/g, '').trim())
  return rows.filter(r => r.some(v => v !== '')).map(r => { const o = {}; header.forEach((h, i) => (o[h] = (r[i] ?? '').replace(/_x000D_/g, '').trim())); return o })
}
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }
const norm1 = s => (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
const norm2 = s => norm1(s).replace(/[\s()[\]{}·∙•・,./\\\-_'"`~]+/g, '')
const stripParen = s => (s || '').replace(/[(（[][^)）\]]*[)）\]]/g, ' ')
const norm3 = s => norm2(stripParen(s))
const norm4 = s => norm2(stripParen(s).split('/')[0])
const monthlyRec = (tid, code, yr, mo, r) => { const open = num(r.opening_qty), inq = num(r.in_qty); return {
  tenant_id: tid, drug_code: code, snap_year: yr, snap_month: mo,
  opening_qty: open, opening_amount: num(r.opening_amt), total_in_qty: inq, total_in_amount: num(r.in_amt),
  subtotal_qty: open + inq, subtotal_amount: num(r.opening_amt) + num(r.in_amt),
  total_out_qty: num(r.used_qty), total_out_amount: num(r.used_amt),
  total_disp_qty: num(r.disposal_qty), total_ret_qty: num(r.return_qty),
  closing_qty: num(r.closing_qty), closing_amount: num(r.closing_amt) } }

async function main() {
  const env = rd('.env'), cred = rd('.owner-login.local')
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  await sb.auth.signInWithPassword({ email: cred.email, password: cred.password })
  const { data: { user } } = await sb.auth.getUser()
  const { data: tm } = await sb.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle()
  const tid = tm.tenant_id
  console.log(`[모드] ${COMMIT ? '본 적용(--commit)' : '미리보기(쓰기 안 함)'}`)

  // drugs: exact/norm 후보 + codeToName + max NOCODE
  const exact = new Map(), codeToName = new Map()
  const N = [new Map(), new Map(), new Map(), new Map()]  // n1,n2,n3,n4 → Set
  const fns = [norm1, norm2, norm3, norm4]
  const addN = (i, k, c) => { if (k) { if (!N[i].has(k)) N[i].set(k, new Set()); N[i].get(k).add(c) } }
  let maxNoc = 0
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('drugs').select('drug_code,drug_name').eq('tenant_id', tid).range(from, from + 999)
    if (!data?.length) break
    for (const d of data) { const nm = d.drug_name || ''
      codeToName.set(d.drug_code, nm); if (nm && !exact.has(nm.trim())) exact.set(nm.trim(), d.drug_code)
      fns.forEach((f, i) => addN(i, f(nm), d.drug_code))
      if (d.drug_code.startsWith('NOCODE-')) { const n = +(d.drug_code.split('-')[1] || 0); if (n > maxNoc) maxNoc = n } }
    if (data.length < 1000) break
  }
  const uniq = (i, name) => { const s = N[i].get(fns[i](name)); return s && s.size === 1 ? [...s][0] : null }
  const matched = name => exact.get(name.trim()) || uniq(0, name) || uniq(1, name) || uniq(2, name) || uniq(3, name)
  const candidates = name => { for (let i = 0; i < 4; i++) { const s = N[i].get(fns[i](name)); if (s && s.size > 1) return [...s].sort() } return null }

  // 기존 (월|코드) 키
  const existing = new Set()
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('monthly_snapshots').select('snap_month,drug_code').eq('tenant_id', tid).eq('snap_year', 2026).in('snap_month', [1, 2, 3, 4, 5]).range(from, from + 999)
    if (!data?.length) break
    for (const r of data) existing.add(`${r.snap_month}|${r.drug_code}`)
    if (data.length < 1000) break
  }

  // 월마감 잔여 행 수집 (코드 없음 & 단일매칭 안 됨)
  const ms = parseCsv(MONTHLY)
  const ambRows = [], newRows = []          // {mo, name, r, cands?}
  const ambNames = new Map(), newNames = new Set()  // name → candSet[]
  for (const r of ms) {
    const m = (r.snapshot_month || '').match(/^(\d{4})-(\d{2})$/); if (!m) continue
    const yr = +m[1], mo = +m[2]; if (yr !== 2026 || mo < 1 || mo > 5) continue
    if (r.drug_code && r.drug_code.trim()) continue
    const name = r['약품명'] || ''
    if (matched(name)) continue                 // 이미 reconcile 단계서 처리
    const cands = candidates(name)
    if (cands) { ambRows.push({ mo, name, r, cands }); ambNames.set(name, cands) }
    else { newRows.push({ mo, name, r }); newNames.add(name) }
  }

  // ── 모호: 동일 후보군별 전역 1:1 배정 (정렬 결정적) ──
  const groups = new Map()  // candKey → Set(name)
  for (const [name, cands] of ambNames) { const k = cands.join('|'); if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(name) }
  const nameToCode = new Map()
  for (const [k, names] of groups) {
    const codes = k.split('|'); const ns = [...names].sort()
    ns.forEach((nm, i) => { nameToCode.set(nm, codes[Math.min(i, codes.length - 1)]) })
  }

  // ── 신규: NOCODE 연번 부여 (이미 등재됐으면 기존 코드 재사용=멱등) ──
  let next = maxNoc
  const newCode = new Map(), newDrugs = []
  for (const nm of [...newNames].sort()) {
    if (exact.has(nm.trim())) { newCode.set(nm, exact.get(nm.trim())); continue }  // 이전 실행서 등재됨
    next += 1; const code = `NOCODE-${String(next).padStart(4, '0')}`
    newCode.set(nm, code)
    newDrugs.push({ tenant_id: tid, drug_code: code, drug_name: nm, status: '중지', is_narcotic: false, current_qty: 0, current_amount: 0 })
  }

  // ── monthly 레코드 빌드 (모호+신규), 기존키/중복 제외 ──
  const recByKey = new Map()
  const assign = (name) => nameToCode.get(name) || newCode.get(name)
  for (const x of [...ambRows, ...newRows]) {
    const code = assign(x.name); if (!code) continue
    const key = `${x.mo}|${code}`
    if (existing.has(key) || recByKey.has(key)) continue
    recByKey.set(key, monthlyRec(tid, code, 2026, x.mo, x.r))
  }
  const recs = [...recByKey.values()]

  // ── 보고 ──
  console.log(`\n[모호 4종 → 후보 배정]`)
  for (const [nm, code] of nameToCode) console.log(`  · ${nm}  →  ${code} (${codeToName.get(code)})`)
  console.log(`\n[신규 ${newCode.size}종 → 정본 등재]`)
  for (const [nm, code] of newCode) console.log(`  · ${nm}  →  ${code}${newDrugs.find(d => d.drug_code === code) ? ' (신규 INSERT)' : ' (기존 재사용)'}`)
  console.log(`\nmonthly 신규 upsert ${recs.length}행 · drugs 신규 INSERT ${newDrugs.length}행`)

  if (COMMIT) {
    if (newDrugs.length) { const { error } = await sb.from('drugs').insert(newDrugs); if (error) throw new Error('drugs insert 실패: ' + error.message); console.log(`✔ drugs ${newDrugs.length}행 등재`) }
    for (let i = 0; i < recs.length; i += 500) { const { error } = await sb.from('monthly_snapshots').upsert(recs.slice(i, i + 500), { onConflict: 'tenant_id,snap_year,snap_month,drug_code' }); if (error) throw new Error('monthly upsert 실패: ' + error.message) }
    if (recs.length) console.log(`✔ monthly ${recs.length}행 upsert`)
  } else console.log('\n미리보기 — 본 적용은 --commit')

  console.log(`\n[롤백] delete from drugs where tenant_id='<cnc>' and drug_code in (${newDrugs.map(d => `'${d.drug_code}'`).join(',')});`)
  console.log(`        delete from monthly_snapshots where tenant_id='<cnc>' and snap_year=2026 and snap_month in(1..5) and drug_code in (위 신규코드 + 모호배정코드);`)
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })