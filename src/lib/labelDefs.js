/* labelDefs.js — 약품식별 라벨(85 × 45mm)의 **정의 한 곳**.
 *
 * 그림(부품)은 `src/DrugLabel.jsx`, 화면은 `src/LabelPrint.jsx` 에 있다.
 * 여기에는 색·차례·글자 크기·줄임 규칙만 둔다(순수 함수라 시험하기 쉽다).
 *
 * ★ 라벨 색은 **인쇄 전용**이다. 화면 팔레트(`themes`)와 **별개**로 둔다.
 *   화면 칩은 `src/lib/cautionDefs.js` 를 쓴다. 섞지 말 것 —
 *   화면은 모니터에서 읽히는 색이고, 라벨은 종이에 찍히는 색이라 기준이 다르다.
 *
 * 크기·양식 (2026-11-06 이정화 님 확정, 원내 양식 A안)
 *   85 × 45mm · 한 장 = 한 페이지 · 컬러 프린터 · 글씨 모두 검정
 *   바깥 이중선 · 글자는 테두리에서 2.5mm 안쪽
 *   표 2행 — 왼쪽 제목 칸(「약품명」「성분명」, 너비 17mm 고정) + 오른쪽 내용
 *   약품명: 가장 크게. 길면 자동 축소 + 줄바꿈. **말줄임 금지.**
 *   성분명: 1줄 영문(ingredient_en), 2줄 한글(ingredient_kr)
 *   함량·보관·복약지침·구분 칸은 **넣지 않는다**
 */

/* 라벨 바탕색 — 주의 종류별 */
export const LABEL_BG = {
  none: '#FFFFFF',
  dose: '#93C5FD',   /* 용량 — 연파랑 */
  sound: '#FDE047',  /* 발음 — 노랑 */
  shape: '#FCA5A5',  /* 모양 — 연빨강 */
}

/* 제목 칸 — 바탕보다 조금 연하게.
   ★ 흰 바탕은 흰색 그대로다. 지금 쓰는 원내 라벨과 같게 한다(ⓐ-2). */
export const LABEL_HEAD = {
  none: '#FFFFFF',
  dose: '#C9E2FE',
  sound: '#FEF0A3',
  shape: '#FDD2D2',
}

/* 바탕색 우선순위 — 발음 > 모양 > 용량.
   한 약에 주의가 여러 개면 **가장 높은 것 하나**가 바탕이 된다. */
export const LABEL_PRIORITY = ['sound', 'shape', 'dose']

export const CAUTION_COL = { dose: 'caution_dose', shape: 'caution_shape', sound: 'caution_sound' }
export const CAUTION_LABEL = { dose: '용량 주의', shape: '모양 주의', sound: '발음 주의' }

/* 이 약의 바탕을 정하는 주의 — 없으면 null */
export function bgKind(d) {
  if (!d) return null
  return LABEL_PRIORITY.find(k => d[CAUTION_COL[k]] === true) || null
}

/* 뱃지로 보여 줄 주의 — 우선순위 차례. 지금은 한 약에 하나뿐이지만
   여러 개가 켜지는 날을 위해 전부 돌려준다. */
export function badgeKinds(d) {
  if (!d) return []
  return LABEL_PRIORITY.filter(k => d[CAUTION_COL[k]] === true)
}

export function labelBg(d) { const k = bgKind(d); return k ? LABEL_BG[k] : LABEL_BG.none }
export function labelHead(d) { const k = bgKind(d); return k ? LABEL_HEAD[k] : LABEL_HEAD.none }

/* ── 약품명 글자 크기 (mm) ──────────────────────────────────────────────
   길수록 작아진다. **말줄임은 하지 않는다** — 약 이름이 잘리면 위험하다. */
export function nameSizeMm(name) {
  const n = String(name || '').length
  if (n <= 9) return 7.6
  if (n <= 12) return 6.4
  if (n <= 16) return 5.4
  if (n <= 21) return 4.5
  if (n <= 26) return 3.9
  return 3.4
}

/* ── 성분명 줄임 ───────────────────────────────────────────────────────
   ★ 영문·한글에 **같은 규칙**을 쓴다. 한쪽만 줄면 두 줄이 서로 다른 말을 한다.
     그래서 「둘 중 하나라도 길면 둘 다」 줄인다.
   한글은 글자 폭이 넓어 영문보다 기준을 짧게 잡는다. */
export const ING_LIMIT = { en: 80, kr: 44 }

/* 복합제는 「첫 성분 외 N종」. 단일 성분인데 긴 것은 끝을 … 로 막는다. */
export function shortenIngredient(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  const parts = s.split('/').map(x => x.trim()).filter(Boolean)
  if (parts.length > 1) {
    const head = parts[0].length > 30 ? parts[0].slice(0, 30) + '…' : parts[0]
    return head + ' 외 ' + (parts.length - 1) + '종'
  }
  return s.length > 60 ? s.slice(0, 60) + '…' : s
}

export function ingSizeMm(text) {
  const n = String(text || '').length
  if (n <= 34) return 3.1
  if (n <= 60) return 2.7
  return 2.4
}

/* 두 줄을 **함께** 정한다. 한쪽이 비면 그 줄은 null 이고,
   화면에서는 남은 줄을 가운데 정렬한다. */
export function ingredientPair(enRaw, krRaw) {
  const en0 = String(enRaw || '').trim()
  const kr0 = String(krRaw || '').trim()
  const cut = en0.length > ING_LIMIT.en || kr0.length > ING_LIMIT.kr
  const one = s => {
    if (!s) return null
    const text = cut ? shortenIngredient(s) : s
    return { text, sizeMm: ingSizeMm(text), cut }
  }
  return { en: one(en0), kr: one(kr0), cut }
}

/* ── 인쇄 규칙 ─────────────────────────────────────────────────────────
   한 장 = 한 페이지, 여백 0. 인쇄할 때만 라벨 하나만 보이게 한다.
   ★ 바탕색이 찍히려면 크롬 인쇄 창의 「배경 그래픽」도 켜야 한다. */
export function labelPrintCss() {
  return `@page { size: 85mm 45mm; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body * { visibility: hidden; }
  #yakflo-label, #yakflo-label * { visibility: visible; }
  #yakflo-label {
    position: absolute; left: 0; top: 0; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
}`
}

/* ── 라벨 인쇄 화면의 거르개 ──────────────────────────────────────────── */
export const LABEL_FILTERS = [
  { id: 'caution', l: '주의 있는 약만', test: d => badgeKinds(d).length > 0 },
  { id: 'all', l: '전체', test: () => true },
  { id: 'dose', l: '용량', test: d => d.caution_dose === true },
  { id: 'shape', l: '모양', test: d => d.caution_shape === true },
  { id: 'sound', l: '발음', test: d => d.caution_sound === true },
  { id: 'high', l: '고위험', test: d => d.is_high_alert === true },
]

/* 약품명·코드로 찾기 — 대소문자를 가리지 않는다 */
export function matchSearch(d, kw) {
  const k = String(kw || '').trim().toLowerCase()
  if (!k) return true
  return String(d?.drug_name || '').toLowerCase().includes(k)
    || String(d?.drug_code || '').toLowerCase().includes(k)
}
