/* cautionDefs.js — 주의 표시(용량·모양·발음)의 **정의 한 곳**.
 *
 * 색·차례·칸 이름을 여기서만 정한다. 그림(칩·아이콘)은 `src/CautionChips.jsx` 에 있다.
 * 둘로 나눈 이유는 한 파일이 부품과 상수를 같이 내보내면 화면 자동 새로고침이
 * 깨지기 때문이다(react-refresh 규칙).
 *
 * ── 색 (2026-11-06 이정화 님 확정) ───────────────────────────────────────
 *  고위험 : 바탕 #D9342B1A · 글씨 #D9342B — **지금 그대로. 바꾸지 않는다.**
 *           투명도 10% 라서 밝은 화면에서는 #FBEBEA, 어두운 화면에서는 #2D2531 로 섞인다.
 *  용량   : 바탕 t.blue   (밝은 #2E4A62 / 어두운 #92C8E0)
 *  모양   : 바탕 t.red    (밝은 #C62828 / 어두운 #F39E94)
 *  발음   : 바탕 t.yellow (양쪽 모두 #FFE082)
 *  글씨   : 밝은 화면 흰색 · 어두운 화면 검정. 발음은 바탕이 밝아 양쪽 모두 검정.
 *  ★ 새로 더한 색은 `yellow` 하나뿐이다. blue·red 는 팔레트에 이미 있던 값이라
 *    화면 모드에 따라 팔레트가 알아서 밝기를 바꾼다(어두운 화면에서 칩이 묻히지 않는다).
 *
 * ── 차례 (ⓐ 순서 고정) ──────────────────────────────────────────────────
 *  고위험 → 용량 → 모양 → 발음. 고위험은 **언제나 맨 앞**이다.
 *  고위험이 넷 중 가장 연한 칩이라, 자리로라도 먼저 눈에 들어오게 한다.
 */

export const HIGH_ALERT_BG = '#D9342B1A'
export const HIGH_ALERT_FG = '#D9342B'

/* 발음 체크박스만 바탕(#FFE082)이 밝아 흰 체크가 안 보인다 — 체크 표시만 검정.
   ★ 팔레트에 색을 더하지 않는다. 체크 표시 하나에만 쓰는 값이다. (2026-11-06 이정화 님 지정) */
export const SOUND_CHECK = '#1F1F1F'

export const CAUTION_ORDER = [
  { kind: 'dose', col: 'caution_dose', label: '용량' },
  { kind: 'shape', col: 'caution_shape', label: '모양' },
  { kind: 'sound', col: 'caution_sound', label: '발음' },
]

/* ── 차광 (2026-11-07 이정화 님 확정) ───────────────────────────────────
 *  바탕 #1F1F1F · 글씨 #FFE082 — **둘 다 이미 쓰던 값이다.**
 *    · #1F1F1F 은 위 SOUND_CHECK(발음 체크 표시)와 같은 값
 *    · #FFE082 는 팔레트 t.yellow(발음 칩 바탕)와 같은 값
 *  발음 칩(노란 바탕·검은 글씨)과 **정확히 뒤집힌 모양**이라 나란히 놓아도 갈린다.
 *  대비비 12.7 : 1.
 *
 *  ★ 화면 모드를 타지 않는다. 지금 차광 뱃지는 바탕 t.text · 글씨 t.navText 인데
 *    어두운 팔레트에서는 **둘 다 #E8E6E1** 이라 글씨가 사라져 있었다. 고정값으로 막는다.
 *
 *  ★ 차광 여부는 `storage_method` 에 「차광」이 들어 있는지로 본다(2026-11-07 승인).
 *    예전에는 `storage_light`(참/거짓)를 봤는데, 그 칸은 켜고 끌 화면이 없어
 *    ATC 카세트 약 9종만 손으로 찍힌 상태였다(보관방법 차광 155종의 부분집합).
 *    ★ `storage_light` 칸 자체는 **건드리지 않는다** — 읽지만 않는다. */
export const SHADE_BG = '#1F1F1F'
export const SHADE_FG = '#FFE082'
export const SHADE_LABEL = '차광'

export function isShade(d) {
  return String((d && d.storage_method) || '').includes('차광')
}

/* 화면이 어두운 쪽인지 — 팔레트가 스스로 밝힌다(themes.light/dark 의 mode) */
export function isDark(t) { return (t && t.mode) === 'dark' }

/* 칩 하나의 바탕·글씨 */
export function cautionChipColors(t, kind) {
  const fg = isDark(t) ? '#000000' : '#FFFFFF'
  if (kind === 'dose') return { bg: t.blue, fg }
  if (kind === 'shape') return { bg: t.red, fg }
  if (kind === 'sound') return { bg: t.yellow, fg: '#000000' }
  return { bg: HIGH_ALERT_BG, fg: HIGH_ALERT_FG }
}

/* 체크박스 표시 색 — 각 칩의 바탕색을 쓰되 발음만 예외 */
export function cautionCheckColor(t, kind) {
  if (kind === 'sound') return SOUND_CHECK
  return cautionChipColors(t, kind).bg
}

/* 약품 한 줄에서 켜진 주의를 **정해진 차례**로 돌려준다 */
export function cautionsOf(d) {
  if (!d) return []
  return CAUTION_ORDER.filter(x => d[x.col] === true)
}
