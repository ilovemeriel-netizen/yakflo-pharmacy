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
   응답: { ok:true, wards:['3','4'], msg } 또는 { ok:false }
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { currentWindow, corsHeaders, json } from './ward-drugs.js'
import { DUP_MSG } from './ward-submit.js'

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
  /* 기간이 닫혀 있으면 표시할 것이 없다 — 오류가 아니므로 빈 배열로 정상 응답 */
  if (!win.row) return json({ ok: true, wards: [], msg: DUP_MSG }, 200, cors)

  const { data, error } = await admin
    .from('ward_requests')
    .select('ward')                                   // ★ 병동명 한 컬럼만
    .eq('tenant_id', win.row.tenant_id)
    .eq('season', win.row.season)
    .eq('request_year', win.row.request_year)
  if (error) { console.error('[ward-status] 신청 조회 실패:', error.message); return json({ ok: false }, 500, cors) }

  const wards = [...new Set((data || []).map(r => String(r.ward)))].sort()
  return json({ ok: true, wards, msg: DUP_MSG }, 200, cors)
}

export const config = { path: '/api/ward/status' }
