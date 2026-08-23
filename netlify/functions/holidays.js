/* ════════════════════════════════════════════════════════════════
   공휴일 조회/동기화 — 한국천문연구원 특일정보(getRestDeInfo) 연 단위
   ─────────────────────────────────────────────────────────────────
   POST /api/holidays  { year: 2026 }   (Authorization: Bearer <access_token> 필수)
   흐름: JWT 검증(인증 사용자) → 특일정보 API(연 1회) → isHoliday='Y'만 holidays upsert(service_role).
   키 노출 없음: serviceKey는 서버 환경변수(HOLIDAY_API_KEY 우선, 없으면 DATA_API_KEY).
   응답: { ok, year, upserted, rows:[{date,name}], source }  또는 { ok:false, msg }
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
  if (req.method === 'OPTIONS') return new Response('', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, msg: 'POST only' }, 405, cors)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supaAnon = process.env.SUPABASE_ANON_KEY
  const apiKey = process.env.HOLIDAY_API_KEY || process.env.DATA_API_KEY // 특일정보 승인 키 우선, 없으면 공용 키
  if (!supaUrl || !supaSrv || !supaAnon) return json({ ok: false, msg: '서버 환경변수 누락(SUPABASE_*)' }, 500, cors)
  if (!apiKey) return json({ ok: false, msg: '서버에 HOLIDAY_API_KEY/DATA_API_KEY 미설정' }, 500, cors)

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json({ ok: false, msg: '인증 헤더 누락' }, 401, cors)

  let body = {}
  try { body = await req.json() } catch { return json({ ok: false, msg: '잘못된 요청 본문' }, 400, cors) }
  const year = parseInt(body.year, 10)
  if (!year || year < 2000 || year > 2100) return json({ ok: false, msg: '유효한 year 필요' }, 400, cors)

  /* 1) JWT 검증 — 인증 사용자만 (공유 레퍼런스 채우기, 남용 방지) */
  const userClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ ok: false, msg: '인증 실패 (만료된 세션)' }, 401, cors)

  /* 2) 특일정보 API 호출 (연 단위: solMonth 생략, numOfRows=100) */
  const base = 'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
  const params = new URLSearchParams({ serviceKey: apiKey, solYear: String(year), _type: 'json', numOfRows: '100' })
  let payload
  try {
    const up = await fetch(base + '?' + params.toString(), { method: 'GET' })
    const text = await up.text()
    try { payload = JSON.parse(text) } catch { return json({ ok: false, msg: '특일정보 응답 파싱 실패(비 JSON): ' + text.slice(0, 200) }, 502, cors) }
  } catch (e) { return json({ ok: false, msg: '특일정보 호출 실패: ' + e.message }, 502, cors) }

  /* API 자체 오류(NO_OPENAPI_SERVICE_ERROR=미승인 등) 확인 */
  const header = payload?.response?.header
  if (header && header.resultCode && header.resultCode !== '00') {
    return json({ ok: false, msg: `특일정보 오류: ${header.resultCode} ${header.resultMsg || ''}` }, 502, cors)
  }

  /* items 정규화(0/1/N건 모두 배열로) */
  const raw = payload?.response?.body?.items?.item
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  const rows = items
    .filter(it => String(it.isHoliday || '').toUpperCase() === 'Y')
    .map(it => {
      const s = String(it.locdate) // YYYYMMDD
      const date = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8)
      return { year, date, name: String(it.dateName || '').trim(), is_holiday: true }
    })
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.name)

  if (!rows.length) return json({ ok: true, year, upserted: 0, rows: [], source: 'api', msg: '수신 공휴일 0건' }, 200, cors)

  /* 3) service_role upsert (UNIQUE(date,name) 기준, 중복 방지) */
  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: upErr } = await admin
    .from('holidays')
    .upsert(rows.map(r => ({ ...r, fetched_at: new Date().toISOString() })), { onConflict: 'date,name' })
  if (upErr) return json({ ok: false, msg: 'holidays upsert 실패: ' + upErr.message }, 500, cors)

  return json({ ok: true, year, upserted: rows.length, rows: rows.map(r => ({ date: r.date, name: r.name })), source: 'api' }, 200, cors)
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export const config = { path: '/api/holidays' }
