// ════════════════════════════════════════════════════════════════
// Yakflo · inventory_stock 분할단위 42종 소수 재고 보정 (0013 numeric 적용 후)
// 정책: 가산적 — CSV 실값과 다른 분할단위 42행만 보정, 그 외 전부 무변경.
//   조회·쓰기 anon+RLS owner 세션(inventory_stock UPDATE 정책 경유). 멱등(이미 일치 시 skip).
//   소수는 CSV raw 문자열로 전달(부동소수 잡음 방지). 롤백용 원본값 _inventory_보정_롤백.sql 생성.
// 실행: node scripts/fix_inventory_decimals.mjs           (미리보기·쓰기X)
//       node scripts/fix_inventory_decimals.mjs --commit  (본 적용)
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const INV = 'supabase/seed/매칭소스/초기재고.csv'
const ROLLBACK = 'supabase/seed/매칭소스/_inventory_보정_롤백.sql'

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
const numOf = s => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }
const rawNum = s => String(s ?? '').replace(/,/g, '').trim()   // CSV raw(콤마만 제거) → numeric 문자열

async function main() {
  const env = rd('.env'), cred = rd('.owner-login.local')
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: aerr } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password })
  if (aerr) throw new Error('owner 로그인 실패: ' + aerr.message)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('세션 user 없음(로그인 미완료)')
  const { data: tm } = await sb.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle()
  const tid = tm.tenant_id
  console.log(`[모드] ${COMMIT ? '본 적용(--commit)' : '미리보기(쓰기 안 함)'}`)

  const nameToCode = new Map()
  for (let from = 0; ; from += 1000) { const { data } = await sb.from('drugs').select('drug_code,drug_name').eq('tenant_id', tid).range(from, from + 999); if (!data?.length) break; for (const d of data) if (d.drug_name && !nameToCode.has(d.drug_name.trim())) nameToCode.set(d.drug_name.trim(), d.drug_code); if (data.length < 1000) break }
  const dbStock = new Map()
  for (let from = 0; ; from += 1000) { const { data } = await sb.from('inventory_stock').select('drug_code,current_qty').eq('tenant_id', tid).range(from, from + 999); if (!data?.length) break; for (const r of data) dbStock.set(r.drug_code, r.current_qty); if (data.length < 1000) break }

  const inv = parseCsv(INV)
  const targets = []
  for (const r of inv) {
    const code = (r.drug_code && r.drug_code.trim()) || nameToCode.get((r['약품명'] || '').trim())
    if (!code || !dbStock.has(code)) continue
    const want = numOf(r.opening_qty), have = numOf(dbStock.get(code))
    if (Math.abs(have - want) > 1e-6 && want % 1 !== 0) targets.push({ code, name: r['약품명'], before: dbStock.get(code), after: rawNum(r.opening_qty) })
  }

  console.log(`\n보정 대상 ${targets.length}건 (분할단위 소수)`)
  console.log('drug_code\t전(정수)\t후(소수)\t약품명')
  for (const t of targets.slice(0, 10)) console.log(`${t.code}\t${t.before}\t${t.after}\t${t.name}`)
  if (targets.length > 10) console.log(`… 외 ${targets.length - 10}건`)

  // 롤백 SQL 생성(원본 정수값 복원)
  const rb = ['-- inventory_stock 42종 소수 보정 롤백 (원본 정수값 복원) — ⚠ 0013 numeric은 별도 롤백',
    `-- 생성: register/fix_inventory_decimals.mjs · tenant=cnc(${tid})`]
  for (const t of targets) rb.push(`update public.inventory_stock set current_qty = ${t.before} where tenant_id = '${tid}' and drug_code = '${t.code}';`)
  writeFileSync(ROLLBACK, rb.join('\n') + '\n', 'utf8')
  console.log(`\n롤백 SQL → ${ROLLBACK} (${targets.length}행)`)

  if (COMMIT) {
    let done = 0
    for (const t of targets) {
      const { error } = await sb.from('inventory_stock').update({ current_qty: t.after }).eq('tenant_id', tid).eq('drug_code', t.code)
      if (error) throw new Error(`update 실패 ${t.code}: ${error.message}`)
      done++
    }
    console.log(`✔ ${done}행 보정 완료`)
  } else console.log('\n미리보기 — 본 적용은 --commit')
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })