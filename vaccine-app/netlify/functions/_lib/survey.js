/* ════════════════════════════════════════════════════════════════
   수요조사 — 순수 규칙 (DB·네트워크 없음)

   ★ 신청번호 문자 집합은 DB CHECK 와 **글자 단위로 같아야** 한다.
     DB: receipt_code ~ '^[2-9A-HJKMNP-Z]{6}$'  (0093)
     혼동 문자 0 O 1 I L 을 뺀 대문자+숫자 31글자.
     한쪽만 고치면 INSERT 가 23514 로 터지므로 아래 상수를 정본으로 둔다.

   ★ 희망일 범위는 결정 4 — max(오늘(KST), vax_start) ~ vax_end.
     KST 자정 경계에서 어긋나지 않도록 날짜 계산은 전부 'YYYY-MM-DD' 문자열로 한다.

   ★ 제출 제한은 1시간 고정 창 30건(결정 ⓔ).
   ════════════════════════════════════════════════════════════════ */

/* ── 신청번호 ──────────────────────────────────────────────────────────── */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'   /* 31글자 — 0 O 1 I L 제외 */
export const CODE_LEN = 6
export const CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/                     /* DB CHECK 와 동일 */

/* randomInt 는 호출부가 넘긴다(node:crypto 를 이 파일에 묶지 않기 위해).
   n 미만의 정수를 균일하게 돌려주는 함수여야 한다. */
export function makeReceiptCode(randomInt) {
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}
export const validReceiptCode = v => typeof v === 'string' && CODE_RE.test(v)

/* ── 이름 비교 키 ───────────────────────────────────────────────────────
   결정 3 — 공백 제거 · 대소문자 무시.
   ★ JS 의 \s 는 전각 공백(U+3000)과 탭·줄바꿈을 **이미 포함**한다 — 따로 적지 않는다. */
export function nameKey(v) {
  return String(v ?? '').replace(/\s+/g, '').toLowerCase()
}

/* ── 희망일 ────────────────────────────────────────────────────────────── */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000
/* 오늘(KST) 'YYYY-MM-DD' */
export function kstToday(now = Date.now()) {
  const d = new Date(now + KST_OFFSET_MS)
  const p = n => String(n).padStart(2, '0')
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}
/* 고를 수 있는 범위 — 둘 다 'YYYY-MM-DD'. 범위가 비면 null */
export function wishRange(vaxStart, vaxEnd, now = Date.now()) {
  const today = kstToday(now)
  const from = today > vaxStart ? today : vaxStart       /* 문자열 비교로 충분한 형식이다 */
  if (from > vaxEnd) return null                          /* 접종 기간이 이미 지났다 */
  return { from, to: vaxEnd }
}
export function validWishDate(wish, vaxStart, vaxEnd, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(wish ?? ''))) return false
  const r = wishRange(vaxStart, vaxEnd, now)
  if (!r) return false
  return wish >= r.from && wish <= r.to
}

/* ── 도즈 ──────────────────────────────────────────────────────────────
   결정 1 — (본인 체크 1 또는 0) + 가족 수 */
export const MAX_FAMILY = 20
export function doseOf(selfDose, familyCount) {
  const f = Number(familyCount || 0)
  return (selfDose ? 1 : 0) + f
}
/* 숫자와 숫자 문자열만 받는다.
   ★ null·undefined·'' 를 거부하는 이유 — Number(null) 과 Number('') 가 **0** 이라
     그냥 통과시키면 「값이 안 왔다」와 「0명이다」가 구별되지 않는다.
     「가족 없음」은 호출부가 familyOf() 로 0 으로 정규화해서 넘긴다. */
export function validFamily(v) {
  if (v == null || v === '') return false
  if (typeof v !== 'number' && typeof v !== 'string') return false
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= MAX_FAMILY
}
/* 생략·빈 값을 0 으로 본다 — 「본인만 신청」이 가족 칸을 비우고 오는 경우 */
export function familyOf(v) {
  return v == null || v === '' ? 0 : Number(v)
}

/* ── 제출 본문 검증 ─────────────────────────────────────────────────────
   survey = { status, close_at, vax_start, vax_end }
   반환 null = 통과 / 문자열 = 거절 사유(응답 message 로 그대로 쓴다) */
export function validateSubmit(body, survey, now = Date.now()) {
  if (!survey) return '진행 중인 수요조사가 없습니다'
  if (survey.status !== 'open') return '진행 중인 수요조사가 없습니다'
  if (survey.close_at && Date.parse(survey.close_at) <= now) return '수요조사가 마감되었습니다'

  if (!body || typeof body !== 'object') return '잘못된 요청 본문'
  if (!body.consent) return '개인정보 수집·이용에 동의해 주세요'

  const name = String(body.name ?? '').trim()
  if (name.length < 1 || name.length > 40) return '성명을 입력해 주세요'
  if (!nameKey(name)) return '성명을 입력해 주세요'

  if (body.emp_no != null && String(body.emp_no).trim() !== '') {
    const e = String(body.emp_no).trim()
    if (e.length > 20) return '사번이 너무 깁니다'
    if (!/^[0-9A-Za-z-]+$/.test(e)) return '사번은 숫자·영문·하이픈만 쓸 수 있습니다'
  }

  const fam = familyOf(body.family_count)
  if (!validFamily(fam)) return `가족 수는 0~${MAX_FAMILY}명 사이로 입력해 주세요`
  if (doseOf(!!body.self_dose, fam) < 1) return '본인 접종 또는 가족을 1명 이상 선택해 주세요'

  if (!validWishDate(body.wish_date, survey.vax_start, survey.vax_end, now)) {
    const r = wishRange(survey.vax_start, survey.vax_end, now)
    return r ? `접종 희망일은 ${r.from} ~ ${r.to} 안에서 골라 주세요` : '접종 기간이 지났습니다'
  }
  return null
}

/* ── 제출 횟수 제한(1시간 고정 창) ───────────────────────────────────────
   row = { window_start, submit_count } 또는 null(첫 제출)
   반환 { allowed, next: { window_start, submit_count } } */
export const SUBMIT_WINDOW_MS = 60 * 60 * 1000
export const SUBMIT_MAX = 30
export function rateCheck(row, now = Date.now()) {
  const started = row && row.window_start ? Date.parse(row.window_start) : NaN
  const fresh = !row || Number.isNaN(started) || now - started >= SUBMIT_WINDOW_MS
  if (fresh) {
    return { allowed: true, next: { window_start: new Date(now).toISOString(), submit_count: 1 } }
  }
  const used = Number(row.submit_count || 0)
  if (used >= SUBMIT_MAX) {
    return { allowed: false, next: { window_start: row.window_start, submit_count: used } }
  }
  return { allowed: true, next: { window_start: row.window_start, submit_count: used + 1 } }
}

/* ── 확인번호 잠금 ──────────────────────────────────────────────────────
   vaccine-verify 와 같은 기준값(20회 → 10분). 한 응답 단위로 센다. */
export const PIN_MAX_FAIL = 20
export const PIN_LOCK_MIN = 10
/* row = { pin_fail, pin_locked_until } → { locked, mins } */
export function pinLockState(row, now = Date.now()) {
  const until = row && row.pin_locked_until ? Date.parse(row.pin_locked_until) : NaN
  if (!Number.isNaN(until) && until > now) {
    return { locked: true, mins: Math.max(1, Math.ceil((until - now) / 60000)) }
  }
  return { locked: false, mins: 0 }
}
/* 실패 1회 누적 결과 — 임계치에 닿으면 카운터를 0 으로 되돌리고 잠근다(verify 와 같은 방식) */
export function pinFailNext(row, now = Date.now()) {
  const next = Number(row?.pin_fail || 0) + 1
  const locked = next >= PIN_MAX_FAIL
  return {
    locked,
    patch: {
      pin_fail: locked ? 0 : next,
      pin_locked_until: locked ? new Date(now + PIN_LOCK_MIN * 60_000).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    },
  }
}

/* ── 응답 → 공개 화면이 받는 모양 ───────────────────────────────────────
   ★ 성명·사번·확인번호 해시는 **싣지 않는다**. 수정 화면이 채울 값만 돌려준다. */
export function publicView(r) {
  return {
    receipt_code: r.receipt_code,
    emp_no: r.emp_no ?? null,
    name: r.name,                         /* 본인이 확인번호로 열었으므로 본인 이름은 보여 준다 */
    self_dose: !!r.self_dose,
    family_count: Number(r.family_count || 0),
    wish_date: r.wish_date,
    status: r.status,
    dose: doseOf(r.self_dose, r.family_count),
  }
}
