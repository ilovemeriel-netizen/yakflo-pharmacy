/* ════════════════════════════════════════════════════════════════
   공공데이터포털(data.go.kr) 투명 프록시 — 모든 API 단일 진입점
   ─────────────────────────────────────────────────────────────────
   클라이언트는 원래 path를 그대로 사용하되, ServiceKey 파라미터는 첨부하지 않음.
     예) /api/datago/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?itemName=마그밀&type=json&numOfRows=3
   서버는 path를 그대로 https://apis.data.go.kr/{path}에 매핑하고,
   환경변수 DATA_API_KEY를 serviceKey로 자동 첨부한 후 응답을 투명하게 반환.

   응답 Content-Type을 그대로 유지하여 JSON/XML 모두 지원.
   환경변수: Netlify Dashboard → Site settings → Environment variables → DATA_API_KEY
   ════════════════════════════════════════════════════════════════ */

const ALLOWED_HOSTS = ['apis.data.go.kr']
const ALLOWED_PREFIXES = ['1471000/', 'B551182/']

export default async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  if (req.method === 'OPTIONS') return new Response('', { headers: corsHeaders })

  const apiKey = process.env.DATA_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ ok: false, msg: '서버에 DATA_API_KEY가 설정되지 않았습니다 (Netlify 환경변수 확인)' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const url = new URL(req.url)
  /* path 추출: /api/datago/이후의 경로 */
  const m = url.pathname.match(/^\/api\/datago\/(.+)$/)
  if (!m) {
    return new Response(
      JSON.stringify({ ok: false, msg: '잘못된 요청 경로' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  const targetPath = m[1]

  /* 화이트리스트 검증: 1471000/, B551182/ 접두사만 허용 (SSRF 방지) */
  if (!ALLOWED_PREFIXES.some(p => targetPath.startsWith(p))) {
    return new Response(
      JSON.stringify({ ok: false, msg: '허용되지 않은 API 경로' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  /* 쿼리 파라미터에 serviceKey 첨부 (클라이언트가 보낸 값은 무시) */
  const params = new URLSearchParams(url.search)
  params.delete('serviceKey'); params.delete('ServiceKey')
  params.set('serviceKey', apiKey)

  const targetUrl = `https://apis.data.go.kr/${targetPath}?${params.toString()}`

  try {
    const upstream = await fetch(targetUrl, { method: 'GET' })
    const text = await upstream.text()
    const ct = upstream.headers.get('content-type') || 'application/json'
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': ct, 'Cache-Control': 'no-store' }
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, msg: '업스트림 호출 실패: ' + e.message }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

export const config = { path: '/api/datago/*' }
