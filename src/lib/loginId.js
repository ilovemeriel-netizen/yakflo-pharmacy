/* 아이디 ↔ 내부 주소 — 화면과 Edge Function 이 **같은 규칙**을 써야 한다. (2026-11-12)
 *
 * ★ 왜 가짜 주소인가
 *   Supabase 계정은 이메일이 꼭 있어야 한다. 병원 안에서 쓰는 계정은 메일이 없으므로
 *   아이디를 **메일이 갈 수 없는 주소**로 바꿔 만든다.
 *
 * ★ 왜 `.invalid` 인가
 *   국제 규약(RFC 2606)이 `.invalid` 를 **영원히 없는 이름**으로 못 박았다.
 *   누가 DNS 를 잘못 건드려도 메일이 **갈 곳이 없다** — 실수로 진짜 메일이 나갈 수 없다.
 *   (우리 도메인 아래에 두면 뒷날 메일 설정이 붙었을 때 샐 수 있다.)
 *
 * ★ 로그인 — 「@」가 없으면 아이디로 본다. 이메일 로그인은 **전혀 안 바뀐다.**
 */

export const ID_DOMAIN = 'id.yakflo.invalid'

/* 영문 소문자·숫자 4~20자 · 첫 글자는 영문 (Edge Function 과 같은 규칙) */
export const ID_RE = /^[a-z][a-z0-9]{3,19}$/

export const ID_RULE_TEXT = '영문 소문자·숫자 4~20자 · 첫 글자는 영문'

/** 아이디로 쓸 수 있는 글자인가 */
export function isLoginId(v) {
  return ID_RE.test(String(v || '').trim().toLowerCase())
}

/** 아이디 → 내부 주소 */
export function idToEmail(id) {
  return String(id || '').trim().toLowerCase() + '@' + ID_DOMAIN
}

/** 내부 주소면 아이디만, 아니면 null */
export function emailToId(email) {
  const s = String(email || '').trim().toLowerCase()
  const suffix = '@' + ID_DOMAIN
  return s.endsWith(suffix) ? s.slice(0, -suffix.length) : null
}

/** 화면에 보일 이름 — 아이디 계정이면 아이디, 아니면 이메일 그대로 */
export function displayAccount(email) {
  return emailToId(email) || String(email || '')
}

/* ── 아이디 자동 만들기 (2026-11-12 이정화 님 승인) ─────────────────
 * 역할을 고르면 「접두어 + 두 자리 번호」를 넣어 준다. 관리자가 고쳐 쓸 수 있다.
 * ★ 대표(owner)는 자동으로 넣지 않는다 — 아무나 대표가 되지 않게 손으로 적게 한다.
 * ★ 비어 있는 **가장 작은** 번호를 쓴다(지운 계정 번호도 다시 쓴다).
 * ★ 99까지 차면 자동을 멈춘다 — 화면이 「직접 적어 주세요」라고 안내한다.
 * ★ 비밀번호는 **자동으로 만들지 않는다.**
 */
export const ROLE_PREFIX = { admin: 'admin', member: 'user', viewer: 'viewer' }
export const ID_MAX_NO = 99

/** 역할의 접두어 — 대표(owner)나 모르는 역할이면 null */
export function rolePrefix(role) {
  return ROLE_PREFIX[String(role || '')] || null
}

/**
 * 비어 있는 가장 작은 번호로 아이디를 짓는다.
 *   taken: 이미 쓰는 아이디 목록(글자 배열)
 *   돌려주는 값: 'viewer01' 같은 글자, 자동이 안 되면 null
 */
export function nextLoginId(role, taken) {
  const p = rolePrefix(role)
  if (!p) return null
  const used = new Set((taken || []).map(x => String(x || '').trim().toLowerCase()))
  for (let n = 1; n <= ID_MAX_NO; n++) {
    const cand = p + String(n).padStart(2, '0')
    if (!used.has(cand)) return cand
  }
  return null
}

/**
 * 로그인 칸에 적은 글자를 **실제 로그인 주소**로 바꾼다.
 *   · 「@」가 있으면 이메일 그대로 (기존 동작 그대로)
 *   · 「@」가 없고 아이디 꼴이면 내부 주소로
 *   · 둘 다 아니면 null (화면이 「아이디 또는 이메일을 확인해 주세요」를 띄운다)
 */
export function toLoginEmail(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (s.includes('@')) return s
  const id = s.toLowerCase()
  return isLoginId(id) ? idToEmail(id) : null
}
