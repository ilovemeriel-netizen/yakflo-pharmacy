/* ════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 잔량 목록 (비회원 API)
   GET /api/vaccine/stock   Authorization: Bearer <토큰>
   ─────────────────────────────────────────────────────────────────
   ★ service_role 은 RLS 를 우회한다 — 모든 조회에 tenant_id 조건을 **직접** 건다.

   ★ 토큰 4중 확인 — 서명(timingSafeEqual) · exp · t === VACCINE_TENANT_ID · v === 현재 updated_at.
     v 가 어긋나면 401 이다. 즉 **비밀번호를 바꾸는 순간 기존 토큰이 전부 무효**가 된다.

   ★ 잔량 수식을 새로 만들지 않는다 — v_vaccine_balance 의 balance_qty · received_qty 를 그대로 쓴다.
     (뷰 정의: 입고 − 접종 − 반납 − 폐기. 0089 에서 한 번만 정의한다)

   ★ 반환 필드 최소화 — { season, updated_at, items:[{label, qty, status}] } 가 전부다.
     drug_code · 약품명 · 입고량 · 배정량 · LOT · 유효기간은 **일절 싣지 않는다**.
     공개 화면이라 품목 식별 정보가 새면 안 된다.

   ★ CORS 헤더를 내리지 않는다(같은 사이트 전용) · Cache-Control: no-store.
   환경변수: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · VACCINE_TOKEN_SECRET · VACCINE_TENANT_ID
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { readToken, kstToday, json } from './vaccine-verify.js'

/* ── 상태 임계값 — ★ 이 파일 한 곳에만 둔다 ──────────────────────────────
   소진: 남은 게 없다 / 부족: 열 개 이하 / 주의: 입고분의 1/4 아래로 떨어졌다 / 그 외 충분.
   received 가 0 이면 비율을 낼 수 없으므로 '주의' 판정을 건너뛴다(0 으로 나누지 않는다). */
export const LOW_QTY = 10
export const WARN_RATIO = 0.25
export function stockStatus(balance, received) {
  const b = Number(balance || 0), r = Number(received || 0)
  if (b <= 0) return '소진'
  if (b <= LOW_QTY) return '부족'
  if (r > 0 && b < r * WARN_RATIO) return '주의'
  return '충분'
}

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

  /* 2) v 확인 — 현재 비밀번호 버전과 같아야 한다 */
  const { data: sets, error: sErr } = await admin
    .from('vaccine_public_settings').select('updated_at').eq('tenant_id', tenantId).limit(1)
  if (sErr) { console.error('[vaccine-stock] 설정 조회 실패:', sErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }
  const curV = Date.parse((sets || [])[0]?.updated_at || '') || 0
  if (!curV || read.payload.v !== curV) return json({ ok: false, message: '다시 로그인해 주세요' }, 401)

  /* 3) 대상 계정 — tenant · 활성 · 오늘(KST)이 절기 안 · 공개 표시명 있음 */
  const today = kstToday()
  const { data: accs, error: aErr } = await admin
    .from('vaccine_accounts')
    .select('id, season, public_label')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('season_start', today)
    .gte('season_end', today)
    .not('public_label', 'is', null)
  if (aErr) { console.error('[vaccine-stock] 계정 조회 실패:', aErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }

  const list = accs || []
  if (!list.length) return json({ season: null, updated_at: null, items: [] }, 200)

  const ids = list.map(a => a.id)

  /* 4) 잔량 — v_vaccine_balance 를 그대로 읽는다(계산 재작성 금지) */
  const { data: bals, error: bErr } = await admin
    .from('v_vaccine_balance')
    .select('account_id, balance_qty, received_qty')
    .eq('tenant_id', tenantId)
    .in('account_id', ids)
  if (bErr) { console.error('[vaccine-stock] 잔량 조회 실패:', bErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }
  const balOf = {}
  for (const b of (bals || [])) balOf[b.account_id] = b

  /* 5) 마지막 입력 시각 — 대상 계정 이벤트의 max(created_at).
     집계 함수를 PostgREST 로 바로 쓰기 어려우므로 created_at 내림차순 1행만 받는다. */
  const { data: last, error: eErr } = await admin
    .from('vaccine_events')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .in('account_id', ids)
    .order('created_at', { ascending: false })
    .limit(1)
  if (eErr) { console.error('[vaccine-stock] 시각 조회 실패:', eErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }

  const items = list.map(a => {
    const b = balOf[a.id] || {}
    const qty = Number(b.balance_qty || 0)
    return { label: String(a.public_label), qty, status: stockStatus(qty, b.received_qty) }
  }).sort((x, y) => x.label.localeCompare(y.label, 'ko'))

  /* ★ season 은 대상 계정의 값. 여럿이면 첫 번째를 쓴다(현재 운영은 한 절기만 열린다). */
  return json({
    season: list[0].season || null,
    updated_at: (last || [])[0]?.created_at || null,
    items,
  }, 200)
}

export const config = { path: '/api/vaccine/stock' }
