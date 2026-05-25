/* ════════════════════════════════════════════════════════════════
   네이버 OAuth 2.0 — 2단계: 콜백 처리
   GET /api/auth/naver/callback?code=...&state=...
   ────────────────────────────────────────────────────────────────
   1) state HMAC 서명 검증 (CSRF 방어, 5분 만료)
   2) code → access_token 교환 (네이버)
   3) access_token → 사용자 정보 조회 (네이버)
   4) Supabase: 동일 이메일 사용자 조회/생성 (admin API)
   5) magic link 발급 후 사용자 리다이렉트 → 자동 로그인 완료

   환경변수:
     NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, NAVER_STATE_SECRET, SITE_URL,
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   ════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const STATE_MAX_AGE_MS = 5 * 60 * 1000

function verifyState(state, secret) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return false
  const [body, sig] = state.split('.')
  if (!body || !sig) return false
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  /* timingSafeEqual은 두 Buffer 길이가 다르면 throw → 미리 길이 비교 */
  if (sigBuf.length !== expBuf.length) return false
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload?.ts !== 'number' || Date.now() - payload.ts > STATE_MAX_AGE_MS) return false
    return true
  } catch { return false }
}

function htmlRedirect(url, msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>로그인 처리 중...</title>
     <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#52524E;background:#F7F6F3;margin:0">
     <div style="text-align:center"><div style="font-size:14px">${msg || '로그인 처리 중...'}</div></div>
     <script>location.replace(${JSON.stringify(url)})</script></body>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export default async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorMsg = url.searchParams.get('error_description') || url.searchParams.get('error')

  const siteUrl = process.env.SITE_URL || url.origin
  const errPage = (m) => htmlRedirect(`${siteUrl}/?auth_error=${encodeURIComponent(m)}`, '로그인 실패 — 메인으로 돌아갑니다')

  if (errorMsg) return errPage(errorMsg)
  if (!code || !state) return errPage('잘못된 콜백 요청')

  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  const stateSecret = process.env.NAVER_STATE_SECRET
  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!clientId || !clientSecret || !stateSecret || !supaUrl || !supaSrv) {
    return errPage('서버 환경변수 누락 (관리자에게 문의)')
  }
  if (!verifyState(state, stateSecret)) return errPage('state 검증 실패 (만료 또는 위조)')

  /* 1) 코드 → 토큰 교환 */
  let accessToken
  try {
    const tokenUrl = new URL('https://nid.naver.com/oauth2.0/token')
    tokenUrl.searchParams.set('grant_type', 'authorization_code')
    tokenUrl.searchParams.set('client_id', clientId)
    tokenUrl.searchParams.set('client_secret', clientSecret)
    tokenUrl.searchParams.set('code', code)
    tokenUrl.searchParams.set('state', state)
    const r = await fetch(tokenUrl.toString(), { method: 'GET' })
    const j = await r.json()
    if (!j.access_token) return errPage('토큰 교환 실패')
    accessToken = j.access_token
  } catch (e) { return errPage('토큰 교환 오류: ' + e.message) }

  /* 2) 사용자 정보 조회 */
  let profile
  try {
    const r = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const j = await r.json()
    if (j.resultcode !== '00' || !j.response?.email) return errPage('네이버 사용자 정보 조회 실패 (이메일 동의 필요)')
    profile = j.response
  } catch (e) { return errPage('사용자 정보 오류: ' + e.message) }

  const email = profile.email.toLowerCase()
  const fullName = profile.nickname || profile.name || ''

  /* 3) Supabase 사용자 보장 (없으면 생성) + 4) magic link 발급 */
  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    /* listUsers로 이메일 검색 → 없으면 createUser */
    let existing = null
    let page = 1
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
      if (error) break
      existing = data.users.find(u => (u.email || '').toLowerCase() === email)
      if (existing || data.users.length < 100) break
      page += 1
    }
    if (!existing) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { provider: 'naver', full_name: fullName, naver_id: profile.id }
      })
      if (createErr) return errPage('가입 처리 실패: ' + createErr.message)
      existing = created.user
    } else {
      /* 메타데이터 갱신 (full_name이 비어있으면 채움) */
      await admin.auth.admin.updateUserById(existing.id, {
        user_metadata: { ...(existing.user_metadata || {}), provider: 'naver', full_name: fullName || existing.user_metadata?.full_name }
      })
    }

    /* magic link 생성 — 사용자가 이 링크로 자동 로그인됨 */
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: siteUrl }
    })
    if (linkErr || !linkData?.properties?.action_link) return errPage('세션 발급 실패')

    return htmlRedirect(linkData.properties.action_link, '로그인 처리 중...')
  } catch (e) {
    return errPage('처리 중 오류: ' + e.message)
  }
}

export const config = { path: '/api/auth/naver/callback' }
