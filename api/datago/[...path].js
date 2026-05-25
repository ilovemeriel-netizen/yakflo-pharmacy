/* 공공데이터포털 투명 프록시 — Vercel 진입점
   실제 로직: netlify/functions/datago.js (양 플랫폼 공유) */
import handler from '../../netlify/functions/datago.js'
import { vercelAdapter } from '../../lib/vercel-adapter.js'
export default vercelAdapter(handler)
