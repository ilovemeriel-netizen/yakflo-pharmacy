/* ════════════════════════════════════════════════════════════════
   병동 신청 — 신청완료 병동 조회 (비회원 API)
   ─────────────────────────────────────────────────────────────────
   GET /api/ward/status
   흐름: 열려 있는 기간(window) 확인 → 그 (tenant·season·year)로 이미 들어온 신청의 **병동명만** 수집.
   ★ 반환 필드는 병동명 배열뿐 — 작성자·품목·수량·시각·건수·id 일체 미반환.
     SELECT도 ward 한 컬럼만 건다(과다 조회 자체를 만들지 않는다).
   ★ season·request_year는 ward-submit.js와 **같은 헬퍼** currentWindow()로 얻는다
     → 두 경로가 항상 같은 기간을 본다(산출식 중복 없음).
   ★ 안내 문구는 ward-submit.js의 DUP_MSG를 그대로 실어 보낸다
     → 화면 안내와 409 응답이 글자 단위로 동일해진다(상수 1개 공유).
   ★ 이 API는 **표시용 편의**일 뿐이다. 진짜 방어선은 ward-submit의 409다.
     화면이 fail-open으로 동작하도록, 실패해도 신청 자체를 막는 응답을 주지 않는다.
   ★ 응답에 키·스택트레이스·DB 오류 원문을 절대 싣지 않는다(서버 콘솔에만 기록).
   응답: { ok:true, open:true|false, wards:['3','4'], msg } 또는 { ok:false }
   ★ open — 마감 여부. false 면 화면이 마감 배너를 띄운다. wards 는 open 과 무관하게
     「이미 신청한 병동」을 그대로 낸다(마감 후에도 재방문 조회 경로가 살아 있어야 한다).
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { currentWindow, corsHeaders, json } from './ward-drugs.js'
import { DUP_MSG, CLOSED_MSG } from './ward-submit.js'

/* ★ 닫힘 표시용 — 관문(currentWindow)이 아니다. is_open 을 보지 않고
   최신 window 1행에서 (tenant·season·year) 만 얻어 「이미 신청한 병동」을 그대로 낸다.
   ★ 이 조회는 신청을 허용하지 않는다 — 진짜 차단은 ward-drugs·ward-submit 이 한다.
   ★ 왜 필요한가 — 마감 후에도 재방문 조회(내역 보기) 배너가 떠야 하는데,
     그 배너는 화면의 locked(= wards 에 그 병동이 있음)로 뜬다. wards 를 비우면 경로가 사라진다. */
async function latestWindowMeta(admin) {
  const { data, error } = await admin.from('ward_request_window')
    .select('tenant_id, season, request_year')
    .order('request_year', { ascending: false }).limit(1)
  if (error) return { error: error.message }
  return { row: (data || [])[0] || null }
}

export default async (req) => {
  const cors = corsHeaders()
  if (req.method !== 'GET') return json({ ok: false }, 405, cors)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  /* 환경변수는 기존 두 Function과 동일 — 신규 변수 없음 */
  if (!supaUrl || !supaSrv) return json({ ok: false }, 500, cors)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  const win = await currentWindow(admin)
  if (win.error) { console.error('[ward-status] window 조회 실패:', win.error); return json({ ok: false }, 500, cors) }

  /* ★ 마감 여부는 open 플래그가 전담한다. wards 는 열림·닫힘과 무관하게
     「이미 신청한 병동」이라는 뜻을 유지한다 — 비우면 재방문 조회 경로가 사라진다. */
  const open = !!win.row
  let meta = win.row
  if (!meta) {
    const m = await latestWindowMeta(admin)
    if (m.error) { console.error('[ward-status] window 메타 조회 실패:', m.error); return json({ ok: false }, 500, cors) }
    meta = m.row
    /* window 행 자체가 없는 초기 상태 — 표시할 병동이 없다.
       ★ 그래도 open:false 는 유지한다. 배너가 떠야 한다. */
    if (!meta) return json({ ok: true, open: false, wards: [], msg: CLOSED_MSG }, 200, cors)
  }

  const { data, error } = await admin
    .from('ward_requests')
    .select('ward')                                   // ★ 병동명 한 컬럼만
    .eq('tenant_id', meta.tenant_id)
    .eq('season', meta.season)
    .eq('request_year', meta.request_year)
  if (error) { console.error('[ward-status] 신청 조회 실패:', error.message); return json({ ok: false }, 500, cors) }

  const wards = [...new Set((data || []).map(r => String(r.ward)))].sort()
  return json({ ok: true, open, wards, msg: open ? DUP_MSG : CLOSED_MSG }, 200, cors)
}

export const config = { path: '/api/ward/status' }
