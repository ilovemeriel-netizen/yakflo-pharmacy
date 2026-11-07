/* ═══════════════════════════════════════════════════════════════════════════
   ATC 배치 목록 엑셀 내려받기

   ★ 왜 xlsx(SheetJS) 가 아니라 exceljs 인가 — 2026-11-07 이정화 님 지시
     「열 너비 · 첫 줄 고정 · 제목 굵게」 세 가지를 한꺼번에 달라고 하셨는데,
     이 저장소가 쓰는 **xlsx@0.18.5 커뮤니티판으로는 뒤 두 가지가 써지지 않는다.**
     실측(엣지가 아니라 node 로, 쓴 파일을 exceljs 로 다시 읽어 확인):

                        열 너비    첫 줄 고정    머리글 굵게
       xlsx 0.18.5        ○           ✗            ✗
       exceljs 4.4.0      ○           ○            ○

     `!freeze` 와 셀 스타일(`s`)을 넣어도 **파일에 기록되지 않는다** — 오류도 나지 않아
     「넣었는데 왜 안 되지」로 끝나기 쉬운 자리다. 그래서 월간 결산 엑셀이 이미 쓰고 있는
     exceljs 로 이 한 곳만 옮긴다. 나머지 xlsx 쓰는 곳은 건드리지 않는다.

   ★ exceljs 는 **이 함수 안에서만** 내려온다(약 1MB). 메인 번들과 무관하다 —
     월간 결산(lib/monthlyReportXlsx.js)과 같은 방식이다.

   ★ 글꼴을 지정한다. 아무것도 안 주면 exceljs 는 Calibri 로 쓰고,
     한글이 대체 글꼴로 떨어져 칸 너비가 어긋나 보인다.
   ═══════════════════════════════════════════════════════════════════════════ */

const FONT = '맑은 고딕'

/* 열 정의 — 내용에 맞춘 너비.
   글자 칸(약품명·성분명)은 넓게, 숫자·짧은 글자 칸은 좁게.
   너비 단위는 **표준 글꼴 기준 글자 수**다(엑셀 열 너비와 같은 단위). */
export const ATC_COLS = [
  { header: '슬롯', key: 'slot', width: 8 },
  { header: '약품코드', key: 'code', width: 14 },
  { header: '약품명', key: 'name', width: 30 },
  { header: '성분명(영문)', key: 'ingEn', width: 46 },
  { header: '성분명(한글)', key: 'ingKr', width: 34 },
  { header: '유사', key: 'lasa', width: 12 },
  { header: '차광', key: 'light', width: 7 },
  { header: '최근3개월', key: 'r3', width: 11 },
  { header: '직전1개월', key: 'r1', width: 11 },
]

/* 숫자로 넣을 칸 — 빈 값은 넣지 않는다(0 으로 둔갑하면 사용량을 잘못 읽는다) */
const NUM_KEYS = ['r3', 'r1']

/**
 * @param {Array<object>} rows  ATC_COLS 의 key 를 가진 줄들
 * @param {object} opts         { sheetName, note }
 * @returns {Promise<Blob>}
 */
export async function writeAtcListXlsx(rows, opts = {}) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(opts.sheetName || 'ATC배치')

  ws.columns = ATC_COLS.map(c => ({ header: c.header, key: c.key, width: c.width }))

  for (const r of rows) {
    const row = ws.addRow(r)
    /* 숫자 칸은 숫자로, 빈 값은 빈 칸 그대로 */
    for (const k of NUM_KEYS) {
      const cell = row.getCell(k)
      if (cell.value === '' || cell.value == null) cell.value = null
      else { cell.value = Number(cell.value); cell.numFmt = '0' }
    }
  }

  /* 본문 글꼴 */
  ws.eachRow((row, n) => { if (n > 1) row.font = { name: FONT, size: 10 } })

  /* 숫자 칸은 오른쪽, 슬롯·차광은 가운데.
     ★ 열 정렬은 **머리글 줄까지** 덮어쓴다 — 그래서 머리글 설정보다 **먼저** 준다.
       순서를 바꾸면 숫자 칸 머리글만 오른쪽으로 쏠린다. */
  for (const k of NUM_KEYS) ws.getColumn(k).alignment = { horizontal: 'right' }
  for (const k of ['slot', 'light']) ws.getColumn(k).alignment = { horizontal: 'center' }

  /* 머리글 — 굵게 + 가운데 + 연한 바탕. 약플로 연보라(accentL)를 쓴다(새 색 아님). */
  const head = ws.getRow(1)
  head.font = { name: FONT, bold: true, size: 11 }
  head.alignment = { vertical: 'middle', horizontal: 'center' }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5EDF6' } }
  head.height = 20

  /* ★ 첫 줄 고정 — 줄이 90개라 머리글이 사라지면 어느 칸인지 알 수 없다 */
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  /* 머리글 자동 필터 — 화면의 머리글 필터와 짝을 맞춘다 */
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ATC_COLS.length } }

  /* 꼬리말(임시 사용량 기준 등) — 한 줄 띄우고 적는다 */
  if (opts.note) {
    ws.addRow([])
    const r = ws.addRow([opts.note])
    r.font = { name: FONT, size: 9, italic: true }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/* 파일명 — 예전 규칙 그대로 */
export function atcListFileName(mode, temp) {
  return 'ATC배치_' + (temp ? '임시_' : '') + mode + '_' + new Date().toISOString().split('T')[0] + '.xlsx'
}
