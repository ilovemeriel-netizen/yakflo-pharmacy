/* ════════════════════════════════════════════════════════════════
   병동 신청 — 약품 조회 (비회원 API)
   ─────────────────────────────────────────────────────────────────
   GET /api/ward/drugs?q=검색어
   흐름: 신청 기간 확인(ward_request_window.is_open) → drugs(status='사용') 검색 → 최소 필드만 반환.
   인증 없음(비회원). JWT 검증 단계는 두지 않고, 그 자리에 「기간 열림」 검사가 들어간다.
   ★ 반환 필드는 drug_code · drug_name 뿐 — 단가·재고·거래·보험코드·제조사·ATC 일체 미반환.
   ★ 응답에 키·스택트레이스·DB 오류 원문을 절대 싣지 않는다(서버 콘솔에만 기록).
   응답: { ok, items:[{drug_code, drug_name}], count } 또는 { ok:false, msg }
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'

const CLOSED_MSG = '접수 기간이 아닙니다 · 문의 약제과 내선 217'
const MAX_ROWS = 50   // 응답 상한(노출 범위·전송량 억제)

export default async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('', { headers: cors })
  if (req.method !== 'GET') return json({ ok: false, msg: 'GET only' }, 405, cors)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaSrv) return json({ ok: false, msg: '서버 설정 오류' }, 500, cors)

  /* 검색어: 1자 이상 필수 — 전량 덤프를 막고 노출 범위를 좁힌다(판단 근거는 PR 본문). */
  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  if (!q) return json({ ok: false, msg: '검색어를 입력해 주세요' }, 400, cors)
  if (q.length > 40) return json({ ok: false, msg: '검색어가 너무 깁니다' }, 400, cors)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 1) 신청 기간 확인 — is_open=true 행이 없으면 닫힘 */
  const win = await currentWindow(admin)
  if (win.error) { console.error('[ward-drugs] window 조회 실패:', win.error) ; return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }
  if (!win.row) return json({ ok: false, msg: CLOSED_MSG }, 403, cors)

  /* 2) 사용 중인 약품만 검색 — 반환 필드 2개 한정 */
  const like = '%' + q.replace(/[%_]/g, m => '\\' + m) + '%'
  const { data, error } = await admin
    .from('drugs')
    .select('drug_code, drug_name')
    .eq('tenant_id', win.row.tenant_id)
    .eq('status', '사용')
    .or(`drug_name.ilike.${like},drug_code.ilike.${like}`)
    .order('drug_name')
    .limit(MAX_ROWS)
  if (error) { console.error('[ward-drugs] drugs 조회 실패:', error.message); return json({ ok: false, msg: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요' }, 500, cors) }

  const items = (data || []).map(d => ({ drug_code: d.drug_code, drug_name: d.drug_name }))
  return json({ ok: true, items, count: items.length, capped: items.length >= MAX_ROWS }, 200, cors)
}

/* ── 공통 ── */

/* 열려 있는 신청 기간 1건. tenant_id는 이 행에서 얻는다(하드코딩 없음 — SaaS 확장 시 그대로 동작). */
export async function currentWindow(admin) {
  const { data, error } = await admin
    .from('ward_request_window')
    .select('id, tenant_id, season, request_year, opens_at, closes_at, notice')
    .eq('is_open', true)
    .order('request_year', { ascending: false })
    .limit(1)
  if (error) return { error: error.message }
  const row = (data || [])[0] || null
  if (!row) return { row: null }
  /* opens_at·closes_at이 있으면 시각 범위도 함께 본다(둘 다 선택 항목) */
  const now = Date.now()
  if (row.opens_at && now < Date.parse(row.opens_at)) return { row: null }
  if (row.closes_at && now > Date.parse(row.closes_at)) return { row: null }
  return { row }
}

/* 허용 오리진: WARD_ALLOWED_ORIGINS(콤마 구분). 미설정이면 CORS 헤더를 내리지 않는다
   → 브라우저 호출은 차단되고 서버/curl 점검은 가능. 값은 4단계(앱 도메인 확정) 때 설정. */
export function corsHeaders(req) {
  const origin = req.headers.get('origin') || ''
  const allow = (process.env.WARD_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const base = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
  if (origin && allow.includes(origin)) return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
  return base
}

export function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export const config = { path: '/api/ward/drugs' }
