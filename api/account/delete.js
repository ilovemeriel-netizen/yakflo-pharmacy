/* 회원 탈퇴 — Vercel 진입점
   실제 로직: netlify/functions/account-delete.js (양 플랫폼 공유) */
import handler from '../../netlify/functions/account-delete.js'
import { vercelAdapter } from '../../lib/vercel-adapter.js'
export default vercelAdapter(handler)
