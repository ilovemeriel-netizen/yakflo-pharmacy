// ════════════════════════════════════════════════════════════════
// Yakflo · inventory_stock vs 초기재고.csv 차이 덤프 (대조 전용·쓰기 없음)
// 목적: DB 정수 current_qty ↔ CSV opening_qty(소수 포함) 차이 42건 목록 보관.
//   ※ 어떤 행도 변경하지 않는다(보고만). anon+RLS owner 세션.
// 실행: node scripts/dump_inventory_diff.mjs
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const DIR = 'supabase/seed/매칭소스'
const INV = `${DIR}/초기재고.csv`

function readEnvFile(path) {
  const o = {}; if (!existsSync(path)) return o
  let txt = readFileSync(path, 'utf8'); if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1)
  for (const ln of txt.split(/\r?\n/)) { const m = ln.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return o
}
function parseCsv(path) {
  let text = readFileSync(path, 'utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c === '\r') { /* skip */ }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const header = rows.shift().map(h => h.replace(/_x000D_/g, '').trim())
  return rows.filter(r => r.some(v => v !== '')).map(r => { const o = {}; header.forEach((h, i) => (o[h] = (r[i] ?? '').replace(/_x000D_/g, '').trim())); return o })
}
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }

async function main() {
  const env = readEnvFile('.env')
  const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
  const cred = readEnvFile('.owner-login.local')
  const sb = createClient(url, anon, { auth: { persistSession: false } })
  await sb.auth.signInWithPassword({ email: cred.email, password: cred.password })
  const { data: { user } } = await sb.auth.getUser()
  const { data: tm } = await sb.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle()
  const tid = tm.tenant_id

  const nameToCode = new Map()
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('drugs').select('drug_code,drug_name').eq('tenant_id', tid).range(from, from + 999)
    if (!data?.length) break
    for (const d of data) if (d.drug_name && !nameToCode.has(d.drug_name.trim())) nameToCode.set(d.drug_name.trim(), d.drug_code)
    if (data.length < 1000) break
  }
  const dbStock = new Map()
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('inventory_stock').select('drug_code,current_qty').eq('tenant_id', tid).range(from, from + 999)
    if (!data?.length) break
    for (const r of data) dbStock.set(r.drug_code, num(r.current_qty))
    if (data.length < 1000) break
  }

  const inv = parseCsv(INV)
  const diffs = []
  for (const r of inv) {
    const code = (r.drug_code && r.drug_code.trim()) || nameToCode.get((r['약품명'] || '').trim())
    if (!code || !dbStock.has(code)) continue
    const want = num(r.opening_qty), have = dbStock.get(code)
    if (Math.abs(have - want) > 1e-6) diffs.push({ code, name: r['약품명'], db: have, csv: want, frac: want % 1 !== 0 })
  }
  console.log(`inventory 차이 ${diffs.length}건 (DB current_qty vs CSV opening_qty)`)
  console.log('drug_code\tDB(정수)\tCSV(소수)\t분할단위')
  for (const d of diffs.sort((a, b) => a.code.localeCompare(b.code)))
    console.log(`${d.code}\t${d.db}\t${d.csv}\t${d.frac ? 'Y' : ''}\t${d.name}`)
  console.log(`\n분할단위(소수) 차이: ${diffs.filter(d => d.frac).length}건 / 정수 차이: ${diffs.filter(d => !d.frac).length}건`)
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })