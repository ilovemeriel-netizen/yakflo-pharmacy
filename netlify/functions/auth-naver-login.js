/* ════════════════════════════════════════════════════════════════
   네이버 OAuth 2.0 — 1단계: 인증 시작
   GET /api/auth/naver/login
   → HMAC 서명된 state 생성 후 네이버 인증 페이지로 302 리다이렉트
   환경변수: NAVER_CLIENT_ID, NAVER_STATE_SECRET, SITE_URL
   ════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto'

function signState(secret) {
  const payload = { nonce: crypto.randomBytes(16).toString('hex'), ts: Date.now() }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export default async (req) => {
  const clientId = process.env.NAVER_CLIENT_ID
  const stateSecret = process.env.NAVER_STATE_SECRET
  const siteUrl = process.env.SITE_URL || new URL(req.url).origin

  if (!clientId || !stateSecret) {
    return new Response(
      JSON.stringify({ ok: false, msg: '서버 환경변수(NAVER_CLIENT_ID, NAVER_STATE_SECRET)가 설정되지 않았습니다' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const state = signState(stateSecret)
  const redirectUri = `${siteUrl}/api/auth/naver/callback`
  const authUrl = new URL('https://nid.naver.com/oauth2.0/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)

  return new Response('', { status: 302, headers: { Location: authUrl.toString() } })
}

export const config = { path: '/api/auth/naver/login' }
