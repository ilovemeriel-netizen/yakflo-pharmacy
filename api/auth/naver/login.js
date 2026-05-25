/* 네이버 OAuth 시작 — Vercel 진입점
   실제 로직: netlify/functions/auth-naver-login.js (양 플랫폼 공유) */
import handler from '../../../netlify/functions/auth-naver-login.js'
import { vercelAdapter } from '../../../lib/vercel-adapter.js'
export default vercelAdapter(handler)
