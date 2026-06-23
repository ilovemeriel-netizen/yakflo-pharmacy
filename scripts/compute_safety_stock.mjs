// ════════════════════════════════════════════════════════════════
// Yakflo · safety_stock / max_stock 자동 산출 (제안 — 실행 보류)
// 기준(제안 A): 최근 3개월(2026-03~05) 평균 사용량(total_out_qty) 기반.
//   safety_stock = ceil(avg_out_3m × 0.5)   // 약 반월(2주) 안전재고
//   max_stock    = ceil(avg_out_3m × 2.0)   // 약 2개월 상한
//   대상: status='사용' & 산출값>0 & 현재 safety_stock 미설정(0/NULL)만 (가산적·기존 수기값 보존)
// 정본: drugs(현 UI·RPC가 drugs.safety_stock 사용). inventory_stock은 트리거 미러.
//
// 실행: node scripts/compute_safety_stock.mjs           (미리보기·쓰기X)
//       node scripts/compute_safety_stock.mjs --commit  (RLS owner 세션 본 적용)
// ⚠ 합의된 기준 확정 + .owner-login.local 갱신 후에만 --commit. 현재는 제안/미리보기 전용.
// 가역: 적용분은 update drugs set safety_stock=0,max_stock=0 where drug_code in(...) 로 롤백(스크립트가 명단 출력).
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const SAFETY_FACTOR = 0.5   // 반월
const MAX_FACTOR = 2.0      // 2개월
const MONTHS = [3, 4, 5]    // 최근 3개월

function rd(p) { const o = {}; if (!existsSync(p)) return o; let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } return o }

async function main() {
  const env = rd('.env'), cred = rd('.owner-login.local')
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: aerr } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password })
  if (aerr) throw new Error('owner 로그인 실패(.owner-login.local 갱신 필요): ' + aerr.message)
  const { data: { user } } = await sb.auth.getUser()
  const { data: tm } = await sb.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle()
  const tid = tm.tenant_id
  console.log(`[모드] ${COMMIT ? '본 적용(--commit)' : '미리보기(쓰기 안 함)'} · 기준 최근3개월 평균사용 × (safety ${SAFETY_FACTOR} / max ${MAX_FACTOR})`)

  // 사용 약품 + 현 safety_stock
  const drugs = new Map()
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('drugs').select('drug_code,status,safety_stock').eq('tenant_id', tid).eq('status', '사용').range(from, from + 999)
    if (!data?.length) break
    for (const d of data) drugs.set(d.drug_code, d.safety_stock || 0)
    if (data.length < 1000) break
  }

  // 최근 3개월 사용량 평균
  const sumOut = new Map(), cnt = new Map()
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('monthly_snapshots').select('drug_code,total_out_qty,snap_month')
      .eq('tenant_id', tid).eq('snap_year', 2026).in('snap_month', MONTHS).range(from, from + 999)
    if (!data?.length) break
    for (const r of data) { sumOut.set(r.drug_code, (sumOut.get(r.drug_code) || 0) + Number(r.total_out_qty || 0)); cnt.set(r.drug_code, (cnt.get(r.drug_code) || 0) + 1) }
    if (data.length < 1000) break
  }

  const updates = []
  for (const [code, curSafety] of drugs) {
    if (curSafety > 0) continue                     // 기존 수기값 보존(가산적)
    const avg = (sumOut.get(code) || 0) / MONTHS.length
    const safety = Math.ceil(avg * SAFETY_FACTOR)
    const max = Math.ceil(avg * MAX_FACTOR)
    if (safety > 0) updates.push({ code, avg: Math.round(avg * 10) / 10, safety, max })
  }
  updates.sort((a, b) => b.safety - a.safety)

  console.log(`\n산출 대상 ${updates.length}종 (사용 약품 중 사용량>0·safety 미설정)`)
  console.log('drug_code\t평균사용/월\tsafety\tmax')
  for (const u of updates.slice(0, 12)) console.log(`${u.code}\t${u.avg}\t${u.safety}\t${u.max}`)
  if (updates.length > 12) console.log(`… 외 ${updates.length - 12}종`)
  console.log(`\n[롤백] update drugs set safety_stock=0,max_stock=0 where tenant_id='<cnc>' and drug_code in (${updates.slice(0, 3).map(u => `'${u.code}'`).join(',')} … ${updates.length}종);`)

  if (COMMIT) {
    let done = 0
    for (const u of updates) {
      const { error } = await sb.from('drugs').update({ safety_stock: u.safety, max_stock: u.max })
        .eq('tenant_id', tid).eq('drug_code', u.code).eq('safety_stock', 0)  // 가드: 여전히 미설정일 때만
      if (error) throw new Error(`update 실패 ${u.code}: ${error.message}`)
      done++
    }
    console.log(`✔ ${done}종 safety/max 적용`)
  } else console.log('\n미리보기 — 합의·자격증명 확정 후 --commit')
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })