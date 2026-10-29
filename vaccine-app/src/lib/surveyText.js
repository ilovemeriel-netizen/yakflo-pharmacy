/* 수요조사 화면 표시용 문구 — 값은 서버가 준 것을 **보여 줄 때만** 다듬는다.
   ★ 저장되는 값이나 서버로 보내는 값은 건드리지 않는다. 표시 전용이다. */

/* 절기 표기 — '2026-2027' → '2026~2027절기'.
   ★ 하이픈을 물결로 바꾸는 이유 — 날짜(2026-10-31)와 절기가 한 화면에 함께 나와
     둘 다 하이픈이면 범위인지 날짜인지 헷갈린다. */
export function seasonLabel(season) {
  const s = String(season ?? '').trim()
  if (!s) return ''
  return s.replace(/-/g, '~') + '절기'
}

/* 수요조사 탭에서 쓰는 백신 이름 — 표시명에서 괄호 부분을 뺀다.
   '독감(유료)' → '독감' · '독감(국가무료)' → '독감'
   ★ 잔량 탭 카드는 그대로 둔다(결정 ②) — 거기서는 재원 구분이 보여야 한다.
   ★ 괄호가 없으면 한 글자도 바꾸지 않는다. 괄호를 떼고 남는 것이 없으면 원래 이름을 쓴다. */
export function shortVaccineName(label) {
  const src = String(label ?? '').trim()
  if (!src) return ''
  const cut = src.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim()
  return cut || src
}
