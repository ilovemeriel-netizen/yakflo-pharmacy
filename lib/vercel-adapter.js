/* ════════════════════════════════════════════════════════════════
   Vercel Node Runtime ↔ Web Request/Response 어댑터
   ────────────────────────────────────────────────────────────────
   Netlify Functions(Web 표준 시그니처)를 Vercel Node Functions에서
   재사용하기 위한 1회용 변환 레이어. 같은 핵심 로직을 두 플랫폼이 공유.
   위치: api/ 폴더 외부 (Vercel이 Function으로 오인식하지 않도록)
   ════════════════════════════════════════════════════════════════ */

export function vercelAdapter(handler) {
  return async (req, res) => {
    try {
      /* Vercel Node req → Web Request 변환 */
      const host = req.headers.host || 'localhost'
      const protocol = req.headers['x-forwarded-proto'] || 'https'
      const fullUrl = `${protocol}://${host}${req.url}`

      let body
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        body = chunks.length ? Buffer.concat(chunks) : undefined
      }

      const headers = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v
        else if (Array.isArray(v)) headers[k] = v.join(', ')
      }

      const webReq = new Request(fullUrl, { method: req.method, headers, body, duplex: 'half' })
      const webRes = await handler(webReq)

      /* Web Response → Vercel Node res 변환 */
      res.statusCode = webRes.status
      webRes.headers.forEach((v, k) => res.setHeader(k, v))
      const buf = Buffer.from(await webRes.arrayBuffer())
      res.end(buf)
    } catch (e) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, msg: 'Vercel 어댑터 오류: ' + e.message }))
    }
  }
}
