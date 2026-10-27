/* ═══════════════════════════════════════════════════════════════════════════
   비밀번호 4칸 입력 — 순수 함수 (React 없음)

   ★ 화면의 네 상자는 **장식일 뿐**이고 실제 입력은 숨긴 input 하나다.
     그래서 「무엇이 입력으로 인정되는가」를 여기 한 곳에 모아 단위 시험한다.

   ★ 숫자만 받는다 — 글자·공백·기호는 버린다. 길이를 넘기면 앞에서 자른다.
     붙여넣기도 같은 규칙을 지난다(브라우저가 onChange 로 값을 한 번에 넘기므로
     별도 onPaste 처리 없이 이 함수 하나로 충분하다).
   ═══════════════════════════════════════════════════════════════════════════ */

/* 입력값에서 숫자만 남기고 len 자리까지 자른다. null·undefined·숫자 타입도 받는다. */
export function sanitizePw(raw, len = 4) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, len)
}

/* 상자 칸별 채움 여부 — [true, true, false, false] 같은 모양.
   화면은 이 배열만 보고 테두리와 점을 그린다. */
export function boxFill(pw, len = 4) {
  const n = sanitizePw(pw, len).length
  return Array.from({ length: len }, (_, i) => i < n)
}

/* 보낼 수 있는 상태인가 — 정확히 len 자리 숫자일 때만 */
export function pwReady(pw, len = 4) {
  return sanitizePw(pw, len).length === len
}
