/* 성분명 한 줄 「영문 (한글)」 — ATC 배치 목록·인쇄·가루약 분리번호가 **같이 쓴다**.
 *
 * ★ 2026-11-07 이정화 님 지시로 ATC 화면(AtcView)에 만든 함수다.
 *   2026-11-11 가루약 분리번호 화면도 같은 모양이 필요해져 **이 자리로 옮겼다.**
 *   옮기기만 했고 **식은 한 글자도 바꾸지 않았다** — 두 벌로 베끼면 언젠가 어긋난다.
 *
 * 규칙
 *   · 모양은 「영문 (한글)」 — **괄호 앞에 빈칸 하나**
 *   · 복합제는 「첫 성분 영문 (첫 성분 한글) 외 N종」
 *   · N 은 **영문 기준 한 번만** 센다 (한글 개수가 달라도 숫자가 흔들리지 않게)
 *   · 한쪽이 비면 괄호를 쓰지 않는다 · 둘 다 비면 빈 글자(화면에서는 「-」)
 */

/** 성분 글자를 「/」로 쪼개 앞뒤 빈칸을 턴다 */
export const ingParts = s => String(s || '').split('/').map(x => x.trim()).filter(Boolean)

/** 성분이 몇 가지인가 — 영문 기준, 영문이 없으면 한글 기준 */
export const ingCount = d => (ingParts(d && d.ingredient_en).length || ingParts(d && d.ingredient_kr).length)

/** 한 언어만 줄인다 — 「첫 성분 외 N종」 */
export const ingShort = (s, cnt) => {
  const p = ingParts(s)
  if (!p.length) return ''
  return cnt > 1 ? p[0] + ' 외 ' + (cnt - 1) + '종' : p[0]
}

/** 한 줄 「영문 (한글)」 — 복합제는 「… 외 N종」 */
export const ingOne = d => {
  const cnt = ingCount(d)
  const fe = ingParts(d && d.ingredient_en)[0] || ''
  const fk = ingParts(d && d.ingredient_kr)[0] || ''
  const first = fe && fk ? fe + ' (' + fk + ')' : (fe || fk)
  return cnt > 1 ? first + ' 외 ' + (cnt - 1) + '종' : first
}
