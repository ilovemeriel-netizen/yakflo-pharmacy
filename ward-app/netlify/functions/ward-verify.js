/* ════════════════════════════════════════════════════════════════
   병동 신청 — 비밀번호로 내 신청 내역 조회 (비회원 API)
   ─────────────────────────────────────────────────────────────────
   POST /api/ward/verify  { ward, pw }
   ※ season·request_year는 받지 않는다 — currentWindow() 헬퍼로 산출해 ward-submit과 같은 기간을 본다.

   ★ 반환 필드 최소화 — 성공 시 items의 drug_name·qty·unit·memo **네 개뿐**.
     작성자·id·tenant_id·시각·상태는 일절 싣지 않는다. 조회는 **읽기 전용**이며 수정 경로가 없다.
   ★ 타이밍·문구 동일화 — 「병동이 없음」과 「비밀번호 틀림」을 구분하지 않는다.
     문구는 FAIL_MSG 하나로 통일하고, 행이 없을 때도 **더미 해시 검증을 수행**해
     응답 시간이 눈에 띄게 갈리지 않도록 한다(scrypt 비용을 양쪽 모두 치른다).
   ★ 레이트 리미팅 — 연속 실패 PW_MAX_FAIL회면 PW_LOCK_MIN분 잠금.
     상태를 행(pw_fail·pw_locked_until)에 둔다 — 비회원이라 세션이 없고,
     Function 인스턴스가 요청마다 갈려 메모리 카운터를 쓸 수 없다(0084 (d)).
   ★ pw_hash가 null인 행(0084 이전 신청)은 잠금 대상이 아니라 **안내 대상**이다 — NOPW_MSG.
   ★ tenant_id는 window 행에서 가져와 **명시 지정**해 조회한다(set_tenant_id는 비회원 경로에서 무발동).
   ★ 응답에 키·스택트레이스·DB 오류 원문을 절대 싣지 않는다(서버 콘솔에만 기록).
   응답: { ok:true, items:[{drug_name, qty, unit, memo}] } 또는 { ok:false, msg }
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { currentWindow, corsHeaders, json } from './ward-drugs.js'
import { validPw, hashPw, verifyPw, makeSalt, PW_MSG } from './ward-submit.js'

const CLOSED_MSG = '접수 기간이 아닙니다 · 문의 약제과 내선 217'
/* ★ 실패 문구는 하나 — 병동 유무와 비밀번호 오류를 구분하지 않는다 */
const FAIL_MSG = '병동 또는 비밀번호가 올바르지 않습니다'
const NOPW_MSG = '이 신청은 비밀번호가 없습니다 · 약제과 내선 217로 문의해 주세요'
export const PW_MAX_FAIL = 10
export const PW_LOCK_MIN = 10
const LOCK_MSG = `여러 번 틀렸습니다 · ${PW_LOCK_MIN}분 후 다시 시도해 주세요`
const WARDS = ['3', '4', '5', '6']

export default async (req) => {
  const cors = corsHeaders()
  if (req.method !== 'POST') return json({ ok: false, msg: 'POST only' }, 405, cors)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaSrv) return json({ ok: false, msg: '서버 설정 오류' }, 500, cors)

  let body
  try { body = await req.json() } catch { return json({ ok: false, msg: '잘못된 요청 본문' }, 400, cors) }

  const ward = String(body?.ward ?? '').trim()
  const pw = String(body?.pw ?? '')
  if (!WARDS.includes(ward)) return json({ ok: false, msg: '병동을 선택해 주세요' }, 400, cors)
  if (!validPw(pw)) return json({ ok: false, msg: PW_MSG }, 400, cors)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  const win = await currentWindow(admin)
  if (win.error) { console.error('[ward-verify] window 조회 실패:', win.error); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }
  if (!win.row) return json({ ok: false, msg: CLOSED_MSG }, 403, cors)

  const { data: rows, error: rErr } = await admin
    .from('ward_requests')
    .select('id, pw_hash, pw_salt, pw_fail, pw_locked_until')
    .eq('tenant_id', win.row.tenant_id)
    .eq('ward', ward)
    .eq('season', win.row.season)
    .eq('request_year', win.row.request_year)
    .limit(1)
  if (rErr) { console.error('[ward-verify] 조회 실패:', rErr.message); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }

  const row = (rows || [])[0] || null

  /* ★ 행이 없어도 scrypt 비용을 치른다 — 「없는 병동」이 빨리 돌아와 존재 여부가 새는 것을 막는다.
     결과는 버리고 FAIL_MSG로 통일한다. */
  if (!row) {
    try { await hashPw(pw, makeSalt()) } catch { /* 타이밍 보정용이라 실패해도 무시 */ }
    return json({ ok: false, msg: FAIL_MSG }, 401, cors)
  }

  /* 잠금 중 — 비밀번호를 보지 않고 거부한다(잠금 상태를 알리는 것은 의도된 안내) */
  if (row.pw_locked_until && Date.parse(row.pw_locked_until) > Date.now()) {
    return json({ ok: false, msg: LOCK_MSG }, 429, cors)
  }

  /* 비밀번호 미설정(0084 이전 신청) — 실패 카운트를 올리지 않는다. 맞출 수 있는 값이 없다. */
  if (!row.pw_hash || !row.pw_salt) {
    return json({ ok: false, msg: NOPW_MSG }, 409, cors)
  }

  let ok = false
  try { ok = await verifyPw(pw, row.pw_salt, row.pw_hash) }
  catch (e) { console.error('[ward-verify] 해시 검증 실패:', e.message); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }

  if (!ok) {
    /* 실패 누적 — 임계치에 닿으면 잠근다. 갱신 실패는 조회 거부를 막지 않는다(로그만). */
    const nextFail = Number(row.pw_fail || 0) + 1
    const patch = { pw_fail: nextFail }
    if (nextFail >= PW_MAX_FAIL) patch.pw_locked_until = new Date(Date.now() + PW_LOCK_MIN * 60_000).toISOString()
    const { error: uErr } = await admin.from('ward_requests').update(patch).eq('id', row.id)
    if (uErr) console.error('[ward-verify] 실패 카운트 갱신 실패:', uErr.message)
    if (nextFail >= PW_MAX_FAIL) return json({ ok: false, msg: LOCK_MSG }, 429, cors)
    return json({ ok: false, msg: FAIL_MSG }, 401, cors)
  }

  /* 성공 — 카운터·잠금 초기화 후 품목만 돌려준다 */
  const { error: cErr } = await admin.from('ward_requests').update({ pw_fail: 0, pw_locked_until: null }).eq('id', row.id)
  if (cErr) console.error('[ward-verify] 카운터 초기화 실패:', cErr.message)

  const { data: items, error: iErr } = await admin
    .from('ward_request_items')
    .select('drug_name, qty, unit, memo')   // ★ 이 네 개뿐 — id·request_id·sort_order·usage_qty 미반환
    .eq('request_id', row.id)
    .order('sort_order')
  if (iErr) { console.error('[ward-verify] 품목 조회 실패:', iErr.message); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }

  return json({ ok: true, items: items || [] }, 200, cors)
}

export const config = { path: '/api/ward/verify' }
