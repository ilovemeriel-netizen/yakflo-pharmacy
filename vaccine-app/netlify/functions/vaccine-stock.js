/* ════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 잔량 목록 (비회원 API)
   GET /api/vaccine/stock   Authorization: Bearer <토큰>
   ─────────────────────────────────────────────────────────────────
   ★ service_role 은 RLS 를 우회한다 — 모든 조회에 tenant_id 조건을 **직접** 건다.

   ★ 토큰 4중 확인 — 서명(timingSafeEqual) · exp · t === VACCINE_TENANT_ID · v === 현재 updated_at.
     v 가 어긋나면 401 이다. 즉 **비밀번호를 바꾸는 순간 기존 토큰이 전부 무효**가 된다.

   ★ 조회·판정은 ./_lib/stock.js 한 곳에 있다 — vaccine-verify 의 `initial` 과 같은 코드를 쓴다.
     상태 임계값(LOW_QTY · WARN_RATIO)과 잔량 수식도 그 파일에만 둔다.

   ★ 반환 필드 최소화 — { season, updated_at, items:[{label, qty, status}] } 가 전부다.
     drug_code · 약품명 · 입고량 · 배정량 · LOT · 유효기간은 **일절 싣지 않는다**.
     공개 화면이라 품목 식별 정보가 새면 안 된다.

   ★ CORS 헤더를 내리지 않는다(같은 사이트 전용) · Cache-Control: no-store.
   환경변수: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · VACCINE_TOKEN_SECRET · VACCINE_TENANT_ID
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { readToken, kstToday, json } from './vaccine-verify.js'
import { loadStock } from './_lib/stock.js'

export default async (req) => {
  if (req.method !== 'GET') return json({ ok: false, message: 'GET 만 받습니다' }, 405)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const secret = process.env.VACCINE_TOKEN_SECRET
  const tenantId = process.env.VACCINE_TENANT_ID
  if (!supaUrl || !supaSrv || !secret || !tenantId) return json({ ok: false, message: '서버 설정 오류' }, 500)

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  /* 1) 서명·만료 확인 — 실패 사유는 응답에 싣지 않는다(401 하나로 통일) */
  const read = readToken(secret, token)
  if (!read.ok) return json({ ok: false, message: '다시 로그인해 주세요' }, 401)
  if (read.payload.t !== tenantId) return json({ ok: false, message: '다시 로그인해 주세요' }, 401)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 2) v 확인 — 현재 비밀번호 버전과 같아야 한다.
     ★ 이 조회는 데이터 조회보다 **먼저** 끝나야 한다 — 무효 토큰에 잔량을 읽어 주지 않기 위해서다.
       그래서 여기만 직렬이고, 그 뒤 조회는 loadStock 안에서 동시에 나간다. */
  const { data: sets, error: sErr } = await admin
    .from('vaccine_public_settings').select('updated_at').eq('tenant_id', tenantId).limit(1)
  if (sErr) { console.error('[vaccine-stock] 설정 조회 실패:', sErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }
  const curV = Date.parse((sets || [])[0]?.updated_at || '') || 0
  if (!curV || read.payload.v !== curV) return json({ ok: false, message: '다시 로그인해 주세요' }, 401)

  /* 3) 잔량 목록 — 계정 → (잔량 ∥ 마지막시각). 자세한 순서는 _lib/stock.js 주석 참고 */
  const got = await loadStock(admin, tenantId, kstToday())
  if (!got.ok) {
    console.error('[vaccine-stock] ' + got.step + ' 조회 실패:', got.message)
    return json({ ok: false, message: '일시적인 오류입니다' }, 500)
  }

  return json(got.data, 200)
}

export const config = { path: '/api/vaccine/stock' }
