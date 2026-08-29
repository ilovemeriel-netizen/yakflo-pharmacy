/* ════════════════════════════════════════════════════════════════
   병동 신청 — 신청 저장 (비회원 API)
   ─────────────────────────────────────────────────────────────────
   POST /api/ward/submit  { ward, requester_name, items:[{drug_code?, drug_name, qty}] }
   ※ unit·memo는 신청 화면에서 입력받지 않는다(약제과가 관리 화면에서 채움). 컬럼은 유지·null 저장.
   흐름: 기간 확인 → 입력 검증 → ward_requests + ward_request_items INSERT(service_role).
   ★ tenant_id는 window 행에서 가져와 **명시 지정**한다 — set_tenant_id_from_user()는 auth.uid() 기반이라
     비회원 경로에서 무발동. 트리거는 `new.tenant_id is null`일 때만 채우므로 명시값을 덮어쓰지 않는다(0083).
   ★ season·request_year는 window 값을 스냅샷 복사한다(window가 바뀌어도 과거 신청 소속 유지).
   ★ 병동당 1회 — 같은 (병동·season·year) 조합이 이미 있으면 409로 거부한다. DB UNIQUE는 두지 않는다(0083)
     — 약제과가 관리 화면에서 추가 등록할 여지를 남기고, 제한은 이 비회원 경로에서만 건다.
   ★ 신청번호(uuid)는 반환하지 않는다 — 병동당 1회라 불필요. 키·스택트레이스·DB 오류 원문도 절대 싣지 않는다.
   ★ period(「2026 추석」)만 함께 돌려준다 — 완료 화면 표시용. window의 공개 정보이며 uuid와 무관하다.
   응답: { ok:true, period } 또는 { ok:false, msg }
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { currentWindow, corsHeaders, json } from './ward-drugs.js'

const CLOSED_MSG = '접수 기간이 아닙니다 · 문의 약제과 내선 217'
/* ★ ward-status.js가 이 상수를 그대로 가져다 응답에 실어, 화면 안내와 409 문구가
   **글자 단위로 같은 하나의 상수**를 쓰게 한다. 정의는 여기 한 곳뿐이다. 409 로직은 변경 없음.
   ★ 217 표기는 전 경로 통일 — 구분자 `·` + 「내선 217」. 괄호로 감싸는 표기는 쓰지 않는다
     (CLOSED_MSG·화면 안내와 같은 형식). 문장 내용·길이는 그대로 두고 표기만 맞췄다. */
export const DUP_MSG = '이미 신청이 접수되었습니다. 수정이 필요하면 약제과 담당자에게 연락해 주세요 · 내선 217'
const WARDS = ['3', '4', '5', '6']          // ward CHECK 미부여(0083) → 여기서 검증
const MAX_ITEMS = 100

export default async (req) => {
  const cors = corsHeaders()
  if (req.method !== 'POST') return json({ ok: false, msg: 'POST only' }, 405, cors)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaSrv) return json({ ok: false, msg: '서버 설정 오류' }, 500, cors)

  let body
  try { body = await req.json() } catch { return json({ ok: false, msg: '잘못된 요청 본문' }, 400, cors) }

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 1) 기간 확인 */
  const win = await currentWindow(admin)
  if (win.error) { console.error('[ward-submit] window 조회 실패:', win.error); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }
  if (!win.row) return json({ ok: false, msg: CLOSED_MSG }, 403, cors)

  /* 2) 입력 검증 */
  const v = validate(body)
  if (v.msg) return json({ ok: false, msg: v.msg }, 400, cors)

  /* 2-1) 병동당 1회 — 같은 (병동·season·year) 조합이 이미 있으면 거부.
     ★ DB UNIQUE 제약은 두지 않는다(0083 설계) — 약제과가 관리 화면에서 추가 등록할 여지를 남기고,
     제한은 이 경로(비회원 신청)에서만 건다. */
  const { data: dup, error: dErr } = await admin
    .from('ward_requests')
    .select('id')
    .eq('tenant_id', win.row.tenant_id)
    .eq('ward', v.ward)
    .eq('season', win.row.season)
    .eq('request_year', win.row.request_year)
    .limit(1)
  if (dErr) { console.error('[ward-submit] 중복 확인 실패:', dErr.message); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }
  if ((dup || []).length) return json({ ok: false, msg: DUP_MSG }, 409, cors)

  /* 3) 헤더 INSERT — tenant_id 명시 지정 · season/year는 window 스냅샷 */
  const { data: hdr, error: hErr } = await admin
    .from('ward_requests')
    .insert([{
      tenant_id: win.row.tenant_id,
      ward: v.ward,
      requester_name: v.requester_name,
      season: win.row.season,
      request_year: win.row.request_year,
    }])
    .select('id')
    .single()
  if (hErr || !hdr) { console.error('[ward-submit] 헤더 INSERT 실패:', hErr?.message); return json({ ok: false, msg: '저장에 실패했습니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }

  /* 4) 품목 INSERT — 실패 시 헤더를 되돌린다(보상 삭제).
        supabase-js에는 다중 테이블 트랜잭션이 없고, 이번 범위에서 DB 함수(RPC) 추가가 금지돼 있어
        「헤더 생성 → 품목 실패 → 헤더 삭제」로 원자성에 준하는 동작을 만든다. */
  const rows = v.items.map((it, i) => ({
    request_id: hdr.id,
    drug_code: it.drug_code || null,
    drug_name: it.drug_name,
    qty: it.qty,
    unit: it.unit || null,
    memo: it.memo || null,
    sort_order: i + 1,
  }))
  const { error: iErr } = await admin.from('ward_request_items').insert(rows)
  if (iErr) {
    console.error('[ward-submit] 품목 INSERT 실패(헤더 되돌림):', iErr.message)
    const { error: dErr } = await admin.from('ward_requests').delete().eq('id', hdr.id)
    if (dErr) console.error('[ward-submit] 헤더 되돌림 실패(고아 헤더 잔류):', dErr.message)
    return json({ ok: false, msg: '저장에 실패했습니다. 잠시 후 다시 시도해 주세요' }, 500, cors)
  }

  /* ★ 신청번호(uuid) 미반환 — 병동당 1회라 번호가 불필요하고, 화면은 병동·작성자·명절로 안내한다 */
  return json({ ok: true, period: `${win.row.request_year} ${win.row.season}` }, 200, cors)
}

/* ── 입력 검증: 타입·길이·범위 ── */
function validate(b) {
  if (!b || typeof b !== 'object') return { msg: '잘못된 요청 본문' }

  const ward = String(b.ward ?? '').trim()
  if (!WARDS.includes(ward)) return { msg: '병동을 선택해 주세요' }

  const requester_name = String(b.requester_name ?? '').trim()
  if (requester_name.length < 1 || requester_name.length > 20) return { msg: '작성자 이름을 1~20자로 입력해 주세요' }

  if (!Array.isArray(b.items) || b.items.length < 1) return { msg: '신청 품목을 1개 이상 담아 주세요' }
  if (b.items.length > MAX_ITEMS) return { msg: `신청 품목은 ${MAX_ITEMS}개까지 가능합니다` }

  const items = []
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i] || {}
    const n = i + 1

    const drug_name = String(it.drug_name ?? '').trim()
    if (!drug_name) return { msg: `${n}번 품목의 약품명이 비어 있습니다` }
    if (drug_name.length > 100) return { msg: `${n}번 품목의 약품명이 너무 깁니다` }

    const qty = Number(it.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { msg: `${n}번 품목의 수량은 0보다 큰 숫자여야 합니다` }
    if (qty > 1e6) return { msg: `${n}번 품목의 수량이 너무 큽니다` }

    const drug_code = it.drug_code == null ? '' : String(it.drug_code).trim()
    if (drug_code.length > 40) return { msg: `${n}번 품목의 약품코드가 너무 깁니다` }

    const unit = it.unit == null ? '' : String(it.unit).trim()
    if (unit.length > 20) return { msg: `${n}번 품목의 단위가 너무 깁니다` }

    const memo = it.memo == null ? '' : String(it.memo).trim()
    if (memo.length > 200) return { msg: `${n}번 품목의 메모가 너무 깁니다` }

    items.push({ drug_code, drug_name, qty, unit, memo })
  }
  return { ward, requester_name, items }
}

export const config = { path: '/api/ward/submit' }
