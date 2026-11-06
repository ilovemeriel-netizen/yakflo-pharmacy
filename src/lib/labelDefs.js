/* labelDefs.js — 약품식별 라벨(85 × 45mm)의 **정의 한 곳**.
 *
 * 그림(부품)은 `src/DrugLabel.jsx`, 화면은 `src/LabelPrint.jsx` 에 있다.
 * 여기에는 색·차례·글자 크기·줄임 규칙·종이 배치만 둔다(순수 함수라 시험하기 쉽다).
 *
 * ★ 라벨 색은 **인쇄 전용**이다. 화면 팔레트(`themes`)와 **별개**로 둔다.
 *   화면 칩은 `src/lib/cautionDefs.js` 를 쓴다. 섞지 말 것 —
 *   모니터에서 읽히는 색과 종이에 찍히는 색은 기준이 다르다.
 *
 * 크기·양식 (2026-11-06 이정화 님 확정, 원내 양식 A안)
 *   85 × 45mm · 한 장 = 한 페이지 · 컬러 프린터 · 글씨 모두 검정
 *   바깥 이중선 · 글자는 테두리에서 2.5mm 안쪽
 *   표 2행 — 왼쪽 제목 칸(「약품명」「성분명」, 너비 17mm 고정) + 오른쪽 내용
 *   뱃지는 **왼쪽 「약품명」 제목 칸 아래**. 약품명 칸은 이름만 쓴다(겹치지 않게).
 *   약품명: 가장 크게. 길면 **낱말을 끊지 않고** 자동 축소. **말줄임 금지.**
 *   성분명: 1줄 영문(ingredient_en), 2줄 한글(ingredient_kr)
 *   함량·보관·복약지침·구분 칸은 **넣지 않는다**
 */

/* 주의 3종 바탕색 */
export const LABEL_BG = {
  none: '#FFFFFF',
  dose: '#93C5FD',   /* 용량 — 연파랑 */
  sound: '#FDE047',  /* 발음 — 노랑 */
  shape: '#FCA5A5',  /* 모양 — 연빨강 */
}

/* 고위험 바탕색 — 원내 게시물 규칙 (2026-11-06 확정).
   ★ 갈래 이름은 DB(`drugs.high_alert_class`)에 있고, **색 값은 여기에만** 있다.
     색을 바꾸고 싶으면 DB 1,133줄이 아니라 이 줄만 고친다. */
export const HIGH_ALERT_BG = {
  electrolyte_na: '#86EFAC',  /* 나트륨 — 초록 */
  electrolyte_k: '#EF4444',   /* 칼륨 — 빨강 */
  insulin: '#FED7AA',         /* 인슐린 — 살구 */
}

/* 제목 칸은 바탕보다 조금 연하게. 흰 바탕은 흰색 그대로(ⓐ-2). */
export function lighten(hex, p) {
  const m = String(hex || '').replace('#', '').match(/../g)
  if (!m || m.length < 3) return '#FFFFFF'
  return '#' + m.slice(0, 3)
    .map(v => Math.round(parseInt(v, 16) + (255 - parseInt(v, 16)) * p).toString(16).padStart(2, '0'))
    .join('').toUpperCase()
}
export const HEAD_LIGHTEN = 0.45

/* 바탕색 우선순위 — 주의 3종끼리는 발음 > 모양 > 용량 */
export const LABEL_PRIORITY = ['sound', 'shape', 'dose']

export const CAUTION_COL = { dose: 'caution_dose', shape: 'caution_shape', sound: 'caution_sound' }
export const CAUTION_LABEL = { dose: '용량 주의', shape: '모양 주의', sound: '발음 주의' }
export const CAUTION_SHORT = { dose: '용량', shape: '모양', sound: '발음', high: '고위험' }

/* 이 약의 주의 가운데 바탕을 정하는 것 — 없으면 null */
export function bgKind(d) {
  if (!d) return null
  return LABEL_PRIORITY.find(k => d[CAUTION_COL[k]] === true) || null
}

/* ★ 라벨 바탕색 — **고위험이 주의 3종보다 먼저**다.
   고위험인데 갈래가 비어 있으면 흰 바탕으로 떨어진다(안전한 기본값, 뱃지는 그대로 붙는다). */
export function labelBg(d) {
  if (!d) return LABEL_BG.none
  if (d.is_high_alert === true) {
    const hi = HIGH_ALERT_BG[d.high_alert_class]
    if (hi) return hi
    return LABEL_BG.none
  }
  const k = bgKind(d)
  return k ? LABEL_BG[k] : LABEL_BG.none
}
export function labelHead(d) { return lighten(labelBg(d), HEAD_LIGHTEN) }

/* 뱃지 차례 — **고위험이 언제나 맨 앞**, 그 뒤 발음 > 모양 > 용량 */
export function badgeKinds(d) {
  if (!d) return []
  const out = d.is_high_alert === true ? ['high'] : []
  return out.concat(LABEL_PRIORITY.filter(k => d[CAUTION_COL[k]] === true))
}

/* ── 약품명 글자 크기 ───────────────────────────────────────────────────
   ★ 길이로 어림잡지 않고 **칸에 들어갈 때까지 줄인다**(부품이 재어서 쓴다).
     여기서는 시작값과 하한만 정한다. 말줄임은 하지 않는다. */
export const NAME_MM = { start: 7.0, min: 2.6, step: 0.2 }

/* ── 성분명 줄임 ───────────────────────────────────────────────────────
   ★ 영문·한글에 **같은 규칙**을 쓴다. 한쪽만 줄면 두 줄이 서로 다른 말을 한다.
     그래서 「둘 중 하나라도 길면 둘 다」 줄인다. 한글은 글자 폭이 넓어 기준이 짧다. */
export const ING_LIMIT = { en: 80, kr: 44 }

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
   ★ 한 장(85×45) 과 A4 모음을 **따로** 쓴다. 무엇을 뽑는지에 따라 용지가 다르다.
   ★ `position: fixed !important` 인 이유 — 인쇄할 한 장은 화면 밖 상자 안에 있다.
     `absolute` 로는 그 상자가 기준이 되어 종이 밖(−99999px)에 그려지고,
     라벨 뿌리의 인라인 `position` 이 규칙을 이겨 버린다. 2026-11-06 실측으로 확인했다
     (고치기 전에는 글꼴 0개짜리 빈 PDF 가 나왔다). */
export function labelPrintCss() {
  return `@page { size: 85mm 45mm; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body * { visibility: hidden; }
  #yakflo-label, #yakflo-label * { visibility: visible; }
  #yakflo-label {
    position: fixed !important; left: 0 !important; top: 0 !important; margin: 0 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
}`
}

/* ── A4 모음 (2열 × 6행 = 12칸) ────────────────────────────────────────
   ★ 간격은 **설정값 하나**로 둔다. 시험 인쇄에서 맨 아래 줄이 잘리면
     `SHEET_GAP_MM` 을 0 으로 바꾸기만 하면 선 공유안이 된다(여백이 13.5mm 로 넓어진다).
     프린터마다 인쇄하지 못하는 가장자리 띠가 달라서다(레이저 4~5mm, 잉크젯 9~15mm). */
export const SHEET = { cols: 2, rows: 6, w: 85, h: 45, paperW: 210, paperH: 297 }
export const SHEET_GAP_MM = 3
export const SHEET_PER_PAGE = SHEET.cols * SHEET.rows   /* 12 */

/* 간격에 따라 여백이 정해진다 — 가운데에 오게 */
export function sheetMargins(gap = SHEET_GAP_MM) {
  const gx = (SHEET.cols - 1) * gap
  const gy = (SHEET.rows - 1) * gap
  return {
    x: Math.round((SHEET.paperW - SHEET.w * SHEET.cols - gx) / 2 * 10) / 10,
    y: Math.round((SHEET.paperH - SHEET.h * SHEET.rows - gy) / 2 * 10) / 10,
  }
}

/* 고른 약과 장수를 A4 쪽으로 나눈다. 같은 약이 여러 장이면 그만큼 되풀이한다. */
export const QTY_MAX = 99
export function expandForSheet(drugs, qtyMap) {
  const out = []
  for (const d of drugs || []) {
    const n = Math.max(1, Math.min(QTY_MAX, Number((qtyMap || {})[d.drug_code]) || 1))
    for (let i = 0; i < n; i++) out.push(d)
  }
  return out
}
export function paginate(items, per = SHEET_PER_PAGE) {
  const pages = []
  for (let i = 0; i < (items || []).length; i += per) pages.push(items.slice(i, i + per))
  return pages
}

export function sheetPrintCss(gap = SHEET_GAP_MM) {
  const m = sheetMargins(gap)
  return `@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body * { visibility: hidden; }
  #yakflo-sheet, #yakflo-sheet * { visibility: visible; }
  #yakflo-sheet {
    position: fixed !important; left: 0 !important; top: 0 !important; margin: 0 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  #yakflo-sheet .yp-page {
    width: ${SHEET.paperW}mm; height: ${SHEET.paperH}mm;
    padding: ${m.y}mm ${m.x}mm; gap: ${gap}mm;
    page-break-after: always; break-after: page;
  }
  #yakflo-sheet .yp-page:last-child { page-break-after: auto; break-after: auto; }
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

export function matchSearch(d, kw) {
  const k = String(kw || '').trim().toLowerCase()
  if (!k) return true
  return String(d?.drug_name || '').toLowerCase().includes(k)
    || String(d?.drug_code || '').toLowerCase().includes(k)
}
