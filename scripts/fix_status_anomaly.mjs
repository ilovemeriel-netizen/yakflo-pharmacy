// ════════════════════════════════════════════════════════════════
// Yakflo · drugs 비정규 status 보정 (가역) — 사용/중지/휴면 외 값 교정
// 현황: DWASPI100 status='??'(hex 3f3f, qty 1500) 1건. 기본 보정값 '사용'(qty>0·활성 정황).
//   가산적: status가 정규 3종 외인 행만, 지정 NEW_STATUS로 보정. 정상 행 무변경.
//   조회·쓰기 anon+RLS owner 세션. BEGIN/ROLLBACK은 단건이라 사전 미리보기+가드로 대체.
// 실행: node scripts/fix_status_anomaly.mjs            (미리보기·쓰기X)
//       node scripts/fix_status_anomaly.mjs --commit   (RLS owner 본 적용)
//       node scripts/fix_status_anomaly.mjs --commit --status=중지   (보정값 지정)
// ⚠ .owner-login.local 갱신 후에만 --commit 가능(미갱신 시 LOGIN_FAIL로 정지).
// 가역: 스크립트가 보정 전 원본 status를 롤백 SQL로 출력.
// ════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const VALID = ['사용', '중지', '휴면']
const argStatus = (process.argv.find(a => a.startsWith('--status=')) || '').split('=')[1]
const NEW_STATUS = argStatus || '사용'
if (!VALID.includes(NEW_STATUS)) throw new Error(`보정값은 ${VALID.join('/')} 중 하나여야 함: ${NEW_STATUS}`)

function rd(p) { const o = {}; if (!existsSync(p)) return o; let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } return o }

async function main() {
  const env = rd('.env'), cred = rd('.owner-login.local')
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: aerr } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password })
  if (aerr) throw new Error('owner 로그인 실패(.owner-login.local 갱신 필요): ' + aerr.message)
  const { data: { user } } = await sb.auth.getUser()
  const { data: tm } = await sb.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle()
  const tid = tm.tenant_id
  console.log(`[모드] ${COMMIT ? '본 적용(--commit)' : '미리보기(쓰기 안 함)'} · 보정값 '${NEW_STATUS}'`)

  // 비정규 status 전수
  const { data: rows, error } = await sb.from('drugs').select('drug_code,drug_name,status,current_qty')
    .eq('tenant_id', tid).not('status', 'in', `(${VALID.map(v => `"${v}"`).join(',')})`)
  if (error) throw new Error('조회 실패: ' + error.message)
  const targets = (rows || [])

  console.log(`\n비정규 status ${targets.length}건`)
  for (const r of targets) console.log(`  ${r.drug_code}\tstatus='${r.status}'\tqty=${r.current_qty}\t→ '${NEW_STATUS}'`)
  console.log('\n[롤백]')
  for (const r of targets) console.log(`  update drugs set status='${r.status}' where tenant_id='<cnc>' and drug_code='${r.drug_code}';`)

  if (COMMIT) {
    let done = 0
    for (const r of targets) {
      const { error: uerr } = await sb.from('drugs').update({ status: NEW_STATUS })
        .eq('tenant_id', tid).eq('drug_code', r.drug_code).eq('status', r.status) // 가드: 원본값 그대로일 때만
      if (uerr) throw new Error(`update 실패 ${r.drug_code}: ${uerr.message}`)
      done++
    }
    console.log(`\n✔ ${done}건 status='${NEW_STATUS}' 보정`)
  } else console.log('\n미리보기 — 자격증명 갱신 후 --commit')
  await sb.auth.signOut()
}
main().catch(e => { console.error('오류:', e.message); process.exit(1) })