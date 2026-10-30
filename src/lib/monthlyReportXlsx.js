/* 월간보고서 결산 엑셀 — 쓰기 계층.
   dto(순수 값) 를 받아 기준 양식과 같은 모양의 통합문서를 만들고 Blob 으로 돌려준다.

   ★ exceljs 는 함수 안에서 동적으로 불러온다.
     SheetJS 무료판은 배경색·테두리·행 높이를 쓸 수 없어 이 양식을 만들 수 없다. 그렇다고
     exceljs(약 1MB)를 메인 번들에 넣으면 첫 화면이 느려지므로, 버튼을 누른 그 순간에만
     내려오게 한다.

   ★ 서식 표는 이 파일이 들고 있고, 스펙 파일(src/lib/__fixtures__/report_layout_spec.json)은
     시험에서 **대조 기준**으로만 쓴다. 스펙을 직접 읽어 쓰면 「내가 만든 것과 내가 만든 것」을
     맞춰 보는 셈이 되어 시험이 아무것도 보증하지 못한다.

   ★ 색은 엑셀 파일 안에서만 쓴다 — 화면 색은 건드리지 않는다.
     흑백판({mono:true})은 배경을 지우고 글자를 검정으로 바꾼다. 굵기·크기·테두리·정렬·병합·
     열 너비·행 높이·숫자 형식은 컬러판과 한 글자도 다르지 않다. */

const BLACK = 'FF000000'

/* 스펙(openpyxl)의 세로 정렬 「center」는 엑셀 파일에서 「middle」이다.
   그대로 넘기면 엑셀이 알아보지 못해 정렬이 조용히 사라진다. */
export const V_ALIGN = { center: 'middle' }

/* ── 요약 시트 ─────────────────────────────────────────────────────────── */
export const SUMMARY_WIDTHS = { A: 3.44, B: 13.55, C: 16.33, D: 9.55, E: 14.66, F: 16.78 }
export const SUMMARY_HEIGHTS = { 1: 26.25, 6: 20.25, 7: 20.25, 11: 20.25, 12: 20.25, 13: 20.25, 16: 20.25, 17: 20.25, 18: 20.25, 22: 20.25, 23: 20.25 }
export const SUMMARY_MERGES = ['B1:F1', 'B2:C2', 'D2:F2', 'B4:F4', 'B9:F9', 'B15:F15', 'B20:F20']

const ALL = ['left', 'right', 'top', 'bottom']
const GEN = 'General'
const WON = '#,##0"원"'
const WON_PM = '\\+#,##0"원";\\-#,##0"원";0"원"'
const CNT = '#,##0"건"'
const CNT_PM = '\\+#,##0"건";\\-#,##0"건";0"건"'
const ITEM = '#,##0"품목"'

/* 머리칸(라벨)과 값칸을 한 표에 적는다.
     label   고정 글자
     key     dto.summary 에서 꺼낼 값
     formula 엑셀 수식
   fill 이 null 이면 배경 없음. */
export const SUMMARY_CELLS = {
  B1: { label: '씨엔씨재활의학과병원 약품관리 월간보고서', numFmt: GEN, h: 'center', v: 'center', border: [], fill: 'FF804A87', fontColor: 'FFFFFFFF', bold: true, size: 18 },
  B2: { label: '▶ 보고월:', numFmt: GEN, h: 'right', v: 'center', border: [], fill: null, fontColor: BLACK, bold: true, size: 11 },
  D2: { key: '_period', numFmt: GEN, h: 'left', v: 'center', border: [], fill: null, fontColor: 'FF804A87', bold: true, size: 12 },

  B4: { label: '[재고 현황]', numFmt: GEN, h: 'left', v: 'center', border: [], fill: 'FF019748', fontColor: 'FFFFFFFF', bold: true, size: 12 },
  B6: { label: '관리 품목수', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FF7FD9A8', fontColor: BLACK, bold: true, size: 11 },
  C6: { key: 'itemCount', numFmt: ITEM, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  E6: { label: '전월재고', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FF7FD9A8', fontColor: BLACK, bold: true, size: 11 },
  F6: { key: 'opening', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  B7: { label: '현재고', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FF7FD9A8', fontColor: BLACK, bold: true, size: 11 },
  C7: { key: 'closing', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  E7: { label: '증감', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FF7FD9A8', fontColor: BLACK, bold: true, size: 11 },
  F7: { key: 'delta', numFmt: WON_PM, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF019748', bold: true, size: 14 },

  /* ★ 보정① — 띠(B9:F9) 안에 글자를 넣는다. 기준 양식은 글자가 B10 에 흰색으로 있어
     배경 없는 칸에 흰 글자가 되어 보이지 않았다. B10 은 비운다. */
  B9: { label: '[입출고 현황]', numFmt: GEN, h: 'left', v: 'center', border: [], fill: 'FF019748', fontColor: 'FFFFFFFF', bold: true, size: 12 },

  B11: { label: '입고', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFBFA6D9', fontColor: BLACK, bold: true, size: 11 },
  C11: { key: 'inCount', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 11 },
  E11: { label: '입고금액', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFBFA6D9', fontColor: BLACK, bold: true, size: 11 },
  F11: { key: 'inAmount', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  B12: { label: '출고', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFE2A6D4', fontColor: BLACK, bold: true, size: 11 },
  C12: { key: 'outCount', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 11 },
  E12: { label: '출고금액', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFE2A6D4', fontColor: BLACK, bold: true, size: 11 },
  F12: { key: 'outAmount', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  /* ★ 보정④ — 순입고·순입고금액은 수식으로 둔다. 셀을 고쳐도 아래가 따라온다. */
  B13: { label: '순입고', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFD7D7D7', fontColor: BLACK, bold: true, size: 11 },
  C13: { formula: 'C11-C12', numFmt: CNT_PM, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 11 },
  E13: { label: '순입고금액', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFD7D7D7', fontColor: BLACK, bold: true, size: 11 },
  F13: { formula: 'F11-F12', numFmt: WON_PM, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF019748', bold: true, size: 14 },

  B15: { label: '[폐기·반품 현황]', numFmt: GEN, h: 'left', v: 'center', border: [], fill: 'FF804A87', fontColor: 'FFFFFFFF', bold: true, size: 12 },
  B16: { label: '폐기', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFF39E94', fontColor: BLACK, bold: true, size: 11 },
  C16: { key: 'dispCount', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 11 },
  E16: { label: '폐기금액', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFF39E94', fontColor: BLACK, bold: true, size: 11 },
  F16: { key: 'dispAmount', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  B17: { label: '반품', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFFDF6A3', fontColor: BLACK, bold: true, size: 11 },
  C17: { key: 'retCount', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 11 },
  E17: { label: '반품금액', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFFDF6A3', fontColor: BLACK, bold: true, size: 11 },
  F17: { key: 'retAmount', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: null, fontColor: 'FF804A87', bold: true, size: 14 },
  B18: { label: '합계', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FF804A87', fontColor: 'FFFFFFFF', bold: true, size: 11 },
  C18: { key: '_lossCount', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: 'FF804A87', fontColor: 'FFFFFFFF', bold: true, size: 11 },
  D18: { label: null, numFmt: GEN, h: null, v: 'center', border: ALL, fill: 'FF804A87', fontColor: null, bold: false, size: 12 },
  E18: { label: null, numFmt: GEN, h: null, v: 'center', border: ALL, fill: 'FF804A87', fontColor: null, bold: false, size: 12 },
  F18: { key: '_lossAmount', numFmt: WON, h: 'center', v: 'center', border: ALL, fill: 'FF804A87', fontColor: 'FFFFFFFF', bold: true, size: 14 },

  B20: { label: '[유효기간 관리]', numFmt: GEN, h: 'left', v: 'center', border: [], fill: 'FF019748', fontColor: 'FFFFFFFF', bold: true, size: 12 },
  B22: { label: '만료', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFDC3545', fontColor: 'FFFFFFFF', bold: true, size: 11 },
  C22: { key: 'expExpired', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 14 },
  E22: { label: '주의(60일)', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFFD7E14', fontColor: 'FFFFFFFF', bold: true, size: 11 },
  F22: { key: 'expCaution60', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 14 },
  B23: { label: '긴급(30일)', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FFFFC107', fontColor: BLACK, bold: true, size: 11 },
  C23: { key: 'expUrgent30', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 14 },
  E23: { label: '확인(90일)', numFmt: GEN, h: 'center', v: 'center', border: ALL, fill: 'FF016033', fontColor: 'FFFFFFFF', bold: true, size: 11 },
  F23: { key: 'expCheck90', numFmt: CNT, h: 'center', v: 'center', border: ALL, fill: null, fontColor: BLACK, bold: true, size: 14 },

  /* ★ 보정⑤ — 작성 시각과 새 저작권 문구 */
  B25: { key: '_stamp', numFmt: GEN, h: null, v: null, border: [], fill: null, fontColor: null, bold: false, size: 12 },
  B26: { key: '_copyright', numFmt: GEN, h: null, v: null, border: [], fill: null, fontColor: null, bold: false, size: 12 },
}

/* ★ 보정② — 기준 양식에 있던 숨은 흰 글씨. 배경 없는 칸에 흰 글자라 화면에도 인쇄에도
   보이지 않지만, 복사해 붙이면 되살아나 같은 라벨이 두 번 나온다. 넣지 않는다. */
export const SUMMARY_DROPPED = ['B5', 'B21', 'B10']

/* ── 약품목록 시트 ─────────────────────────────────────────────────────── */
export const LIST_HEADERS = ['약품코드', '약품명', '구분', '전월재고수', '전월재고금액', '입고수량', '입고금액', '출고수량', '출고금액', '폐기수량', '반품수량', '기말재고수', '기말재고금액', '유효기한']
export const LIST_WIDTHS = { A: 14.78, B: 40.78, C: 8.78, D: 11.78, E: 14.78, F: 11.78, G: 14.78, H: 11.78, I: 14.78, J: 9.78, K: 9.78, L: 12.78, M: 14.78, N: 12.78 }
/* ★ 역슬래시는 엑셀의 「다음 한 글자를 글자 그대로」 표시다. 기준 양식이 그렇게 저장돼 있어
   스펙과 같은 글자로 적어 둔다.
   ★ 다만 exceljs 는 파일로 쓸 때 이 역슬래시를 떼어낸다(`\(` → `(`). 엑셀에서 + - ( ) 는
     역슬래시 없이도 글자 그대로 표시되므로 **보이는 모양은 같다**. 저장된 글자만 다르다. */
/* 수량 6열 — 정수도 .00 까지 보인다(1,038 → 1,038.00). 음수는 괄호. */
export const QTY_FMT = '#,##0.00;\\(#,##0.00\\)'
export const QTY_COLS = ['D', 'F', 'H', 'J', 'K', 'L']
/* 금액 4열 — 원본값을 담고 표시만 1원 단위로 끊는다. */
export const AMT_FMT = '#,##0;\\(#,##0\\)'
export const AMT_COLS = ['E', 'G', 'I', 'M']
export const LIST_FREEZE_X = 1          /* A열 고정 */

const LIST_KEYS = ['code', 'name', 'category', 'openingQty', 'openingAmount', 'inQty', 'inAmount',
  'outQty', 'outAmount', 'dispQty', 'retQty', 'closingQty', 'closingAmount', 'expiry']

/* ── 그리기 도우미 ─────────────────────────────────────────────────────── */
function paint(cell, s, mono) {
  if (s.fill && !mono) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } }
  const font = {}
  if (s.bold) font.bold = true
  if (s.size) font.size = s.size
  const color = mono ? (s.fontColor ? BLACK : null) : s.fontColor
  if (color) font.color = { argb: color }
  if (Object.keys(font).length) cell.font = font
  if (s.numFmt && s.numFmt !== 'General') cell.numFmt = s.numFmt
  if (s.h || s.v) {
    cell.alignment = {
      ...(s.h ? { horizontal: s.h } : {}),
      ...(s.v ? { vertical: V_ALIGN[s.v] || s.v } : {}),
    }
  }
  if (s.border && s.border.length) {
    const b = {}
    for (const side of s.border) b[side] = { style: 'thin' }
    cell.border = b
  }
}

function buildSummary(ws, dto, mono) {
  for (const [col, width] of Object.entries(SUMMARY_WIDTHS)) ws.getColumn(col).width = width
  for (const [row, height] of Object.entries(SUMMARY_HEIGHTS)) ws.getRow(Number(row)).height = height

  const vals = {
    ...dto.summary,
    _period: dto.year + '년 ' + dto.month + '월',
    _lossCount: dto.summary.dispCount + dto.summary.retCount,
    _lossAmount: dto.summary.dispAmount + dto.summary.retAmount,
    _stamp: dto.stamp,
    _copyright: dto.copyright,
  }
  for (const [addr, s] of Object.entries(SUMMARY_CELLS)) {
    const cell = ws.getCell(addr)
    if (s.formula) cell.value = { formula: s.formula }
    else if (s.key) { const v = vals[s.key]; if (v !== undefined && v !== null) cell.value = v }
    else if (s.label != null) cell.value = s.label
    paint(cell, s, mono)
  }
  for (const r of SUMMARY_MERGES) ws.mergeCells(r)
}

function buildList(ws, dto, mono) {
  for (const [col, width] of Object.entries(LIST_WIDTHS)) ws.getColumn(col).width = width

  /* 머리글 — 기준 양식에는 서식이 없다. 글자·굵기·크기·색·정렬은 그대로 두고
     ★ 테두리만 데이터 칸과 같게 넣는다. 데이터에만 선이 있으면 머리글만 떠 보인다. */
  const head = ws.getRow(1)
  LIST_HEADERS.forEach((h, i) => {
    const cell = head.getCell(i + 1)
    cell.value = h
    cell.border = { left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } }
  })

  dto.list.forEach((item, i) => {
    const row = ws.getRow(i + 2)
    LIST_KEYS.forEach((k, c) => { row.getCell(c + 1).value = item[k] })
  })

  /* 데이터 칸에만 테두리·세로 가운데 정렬을 더한다(기준 양식에는 없던 보강).
     약품명(B열)은 줄바꿈 — 열 너비는 스펙 그대로 두고 글자만 접는다. */
  const last = dto.list.length + 1
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= LIST_HEADERS.length; c++) {
      const cell = row.getCell(c)
      cell.border = { left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } }
      cell.alignment = { vertical: 'middle', ...(c === 2 ? { wrapText: true } : {}) }
    }
    for (const col of QTY_COLS) row.getCell(col).numFmt = QTY_FMT
    for (const col of AMT_COLS) row.getCell(col).numFmt = AMT_FMT
  }

  ws.views = [{ state: 'frozen', xSplit: LIST_FREEZE_X }]
  ws.autoFilter = { from: 'A1', to: 'N' + Math.max(last, 1) }
  if (mono) { /* 약품목록에는 배경·글자색이 없어 흑백판과 컬러판이 같다 */ }
}

/* ── 본체 ───────────────────────────────────────────────────────────────── */
export async function writeMonthlyReportXlsx(dto, opts = {}) {
  const mono = !!opts.mono
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const wb = new ExcelJS.Workbook()
  buildSummary(wb.addWorksheet('요약'), dto, mono)
  buildList(wb.addWorksheet('약품목록'), dto, mono)
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/* 파일명 — 기준 양식과 같은 말투. 흑백판은 뒤에 붙여 구별한다. */
export function monthlyReportFileName(dto, mono) {
  return dto.year + '년 ' + dto.month + '월 의약품 결산 내역' + (mono ? '(흑백)' : '') + '.xlsx'
}
