/* 수요조사 화면용 날짜 유틸 — 서버(_lib/survey.js)와 **같은 규칙**을 쓴다.

   ★ 화면과 서버가 서로 다른 「오늘」을 쓰면 달력에서 고를 수 있는 날짜를 서버가 거절한다.
     그래서 KST 기준 계산을 양쪽에서 같은 방식으로 한다(UTC epoch + 9시간 → 날짜 부분).
   ★ 브라우저 시간대에 기대지 않는다 — 해외 출장 중이거나 시간대가 잘못 설정된 기기에서도
     병원 기준(KST)으로 동작해야 한다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/* 오늘(KST) 'YYYY-MM-DD' */
export function kstToday(now = Date.now()) {
  const d = new Date(now + KST_OFFSET_MS)
  const p = n => String(n).padStart(2, '0')
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}

/* 고를 수 있는 범위 — max(오늘, 접종 시작) ~ 접종 끝날. 기간이 지났으면 null */
export function pickRange(vaxStart, vaxEnd, now = Date.now()) {
  const today = kstToday(now)
  const from = today > vaxStart ? today : vaxStart
  if (from > vaxEnd) return null
  return { from, to: vaxEnd }
}

/* ── 표시용 날짜 ───────────────────────────────────────────────────────────
   ★ 화면에 보이는 날짜는 전부 이 모양이다 — '2026. 9. 21.' (0 을 붙이지 않는다). */
export function fmtDotDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''))
  if (!m) return ''
  return `${Number(m[1])}. ${Number(m[2])}. ${Number(m[3])}.`
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']

/* KST 기준 요일 한 글자 — 'YYYY-MM-DD' 또는 ISO 시각을 받는다 */
export function kstDow(value) {
  const s = String(value ?? '')
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00+09:00' : s
  const ms = Date.parse(ymd)
  if (Number.isNaN(ms)) return ''
  return DOW[new Date(ms + KST_OFFSET_MS).getUTCDay()]
}

/* 마감 시각 — '2026. 10. 31.(토) 18:00' (KST) */
export function fmtCloseLong(iso) {
  const ms = Date.parse(String(iso ?? ''))
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms + KST_OFFSET_MS)
  const p = n => String(n).padStart(2, '0')
  const ymd = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  return `${fmtDotDate(ymd)}(${DOW[d.getUTCDay()]}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
