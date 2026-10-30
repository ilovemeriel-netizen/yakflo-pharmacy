/* 월간보고서 결산 엑셀 — 만든 파일을 **다시 읽어** 기준 양식 스펙과 맞춰 본다.
   ★ 스펙(src/lib/__fixtures__/report_layout_spec.json)은 사용자가 기준 양식에서 뽑은 표다.
     쓰기 계층은 이 파일을 읽지 않고 자기 서식 표를 들고 있으므로, 이 시험은 서로 다른 두
     출처를 맞춰 보는 셈이 된다.
   ★ 승인된 보정은 EXCEPTIONS 에 적어 두고, 그 칸만 따로 확인한다. */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildMonthlyReportDTO } from './monthlyReportDTO.js'
import {
  writeMonthlyReportXlsx, monthlyReportFileName,
  SUMMARY_CELLS, SUMMARY_MERGES, SUMMARY_DROPPED,
  LIST_HEADERS, QTY_FMT, QTY_COLS, AMT_FMT, AMT_COLS, V_ALIGN,
  FONT_NAME, DEFAULT_FONT,
} from './monthlyReportXlsx.js'

const SPEC_PATH = 'src/lib/__fixtures__/report_layout_spec.json'
const SPEC = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))

/* ── 승인된 보정 — 스펙과 다르게 적는 칸들 ───────────────────────────────── */
const EXCEPTIONS = {
  B5: '보정② 숨은 흰 글씨 삭제 — 넣지 않는다',
  B10: '보정① 글자를 띠(B9) 안으로 옮겼으므로 비운다',
  B21: '보정② 숨은 흰 글씨 삭제 — 넣지 않는다',
  B9: '보정① 띠 안에 「[입출고 현황]」을 넣는다(스펙은 값 없음)',
  C6: '보정③ 숫자로 저장 + 형식 #,##0"품목" (스펙은 글자 "531품목" · 형식 "개")',
  C18: '보정③ 숫자로 저장 (스펙은 글자 "17건")',
  F13: '보정④ =F11-F12 수식 (스펙은 값 9617568 — 값은 같다)',
  B25: '보정⑤ 작성 시각을 그때그때 적는다',
  B26: '보정⑤ 새 저작권 문구',
}
/* 약품목록 쪽 승인 보정 */
const LIST_EXCEPTIONS = [
  '수량 6열(D·F·H·J·K·L) 형식은 #,##0.00;(#,##0.00) — 스펙 numFmt_D_M 은 금액 4열에만 적용',
  '데이터 칸 테두리 · 세로 가운데 정렬 · 약품명(B열) 줄바꿈 추가 — 열 너비는 스펙 그대로',
  '머리글(1행)에도 같은 테두리 — 글자·굵기·크기·색·정렬은 기준 양식 그대로(서식 없음)',
]

/* ── 재료 — 2026년 9월 마감값 ───────────────────────────────────────────── */
const TOTALS = {
  opening_amount: '101208155.9000', in_amount: '43137284.0000', out_amount: '33519715.9000',
  disposal_amount: '431096.0000', return_amount: '850180.0000', actual_closing: '109560998.0000',
  in_count: 339, out_count: 357, disposal_count: 12, return_count: 5,
  exp_expired: 1, exp_urgent30: 6, exp_caution60: 11, exp_check90: 5, item_count: 1125,
}
const snap = (code, o) => ({
  drug_code: code, opening_qty: 0, opening_amount: 0, total_in_qty: 0, total_in_amount: 0,
  total_out_qty: 0, total_out_amount: 0, total_disp_qty: 0, total_ret_qty: 0,
  closing_qty: 0, closing_amount: 0, ...o,
})
const ROWS = [
  snap('TMVR75', { opening_qty: 100, opening_amount: 19800.4, total_in_qty: 1038.5, total_in_amount: 9900, total_out_qty: 5.78, total_out_amount: 1200.5, closing_qty: 1132.72, closing_amount: 23760.6 }),
  snap('PLC', { opening_qty: 669, opening_amount: 132462, total_disp_qty: 454, closing_qty: 215, closing_amount: 42570 }),
  snap('QUIET', {}),   /* 움직임·잔량 없음 → 빠진다 */
  snap('NOEXP', { closing_qty: -3.455, closing_amount: -500 }),
]
const DRUGS = [
  /* ★ 일부러 Date 객체로 둔다 — 드라이버에 따라 이렇게 온다. 글자로 바뀌어 들어가야 한다 */
  { drug_code: 'TMVR75', drug_name: '타미비어캡슐75mg', category: '경구제', status: '사용', expiry_date: new Date(2027, 2, 1) },
  { drug_code: 'PLC', drug_name: '폴리콜정', category: '경구제', status: '중지', expiry_date: '2026-11-15' },
  { drug_code: 'QUIET', drug_name: '조용한정', category: '경구제', status: '중지', expiry_date: '2026-12-01' },
  { drug_code: 'NOEXP', drug_name: '유효기한없는정말로긴이름을가진약품명입니다', category: '주사제', status: '휴면', expiry_date: null },
]
const STAMP = '2026-10-30 13:00 작성'
const COPY = '© 2026 JEONGHWALEE. All rights reserved. 무단 복제 및 재배포를 금지합니다.'

const dto = buildMonthlyReportDTO({
  closed: true, totals: TOTALS, rows: ROWS, drugs: DRUGS, live: null,
  year: 2026, month: 9, stamp: STAMP, copyright: COPY,
})

async function load(blob) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return wb
}
/* 숫자 형식 비교 — exceljs 는 escape 역슬래시를 떼어내 저장한다(`\(` → `(`).
   엑셀에서 + - ( ) 는 역슬래시 없이도 글자 그대로 표시되므로 보이는 모양은 같다.
   그래서 비교할 때 양쪽의 역슬래시를 떼고 맞춘다. 이 정규화 자체는 아래에서 따로 못을 박는다. */
const norm = f => (f == null || f === 'General' ? null : String(f).replace(/\\/g, ''))
const sides = c => (c.border ? ['left', 'right', 'top', 'bottom'].filter(s => c.border[s]) : [])
const fillOf = c => (c.fill && c.fill.fgColor ? c.fill.fgColor.argb : null)
const colorOf = c => (c.font && c.font.color ? c.font.color.argb : null)

let color, mono
beforeAll(async () => {
  color = await load(await writeMonthlyReportXlsx(dto, { mono: false }))
  mono = await load(await writeMonthlyReportXlsx(dto, { mono: true }))
}, 60000)

describe('통합문서 틀', () => {
  it('시트는 요약·약품목록 둘뿐이고 순서도 같다', () => {
    expect(color.worksheets.map(w => w.name)).toEqual(['요약', '약품목록'])
  })
  it('파일명은 기준 양식과 같은 말투', () => {
    expect(monthlyReportFileName(dto, false)).toBe('2026년 9월 의약품 결산 내역.xlsx')
    expect(monthlyReportFileName(dto, true)).toBe('2026년 9월 의약품 결산 내역(흑백).xlsx')
  })
})

describe('요약 시트 — 스펙과 1:1', () => {
  const S = SPEC['요약']

  it('병합이 스펙과 같다', () => {
    const got = (color.getWorksheet('요약').model.merges || []).slice().sort()
    expect(got).toEqual(S.merges.slice().sort())
    expect(SUMMARY_MERGES.slice().sort()).toEqual(S.merges.slice().sort())
  })

  it('열 너비가 스펙과 같다 (±0.1)', () => {
    const ws = color.getWorksheet('요약')
    for (const [col, want] of Object.entries(S.widths)) {
      expect(ws.getColumn(col).width, col + '열 너비').toBeCloseTo(want, 1)
    }
  })

  it('행 높이가 스펙과 같다', () => {
    const ws = color.getWorksheet('요약')
    for (const [row, want] of Object.entries(S.heights)) {
      expect(ws.getRow(Number(row)).height, row + '행 높이').toBeCloseTo(want, 2)
    }
  })

  it('스펙에 있는 칸은 보정 목록을 뺀 전부가 글자·형식·정렬·테두리까지 같다', () => {
    const ws = color.getWorksheet('요약')
    const checked = []
    for (const [addr, want] of Object.entries(S.cells)) {
      if (EXCEPTIONS[addr]) continue
      const cell = ws.getCell(addr)
      const got = cell.value
      const label = addr + ' '
      if (want.value === '<data>') expect(typeof got, label + '데이터 칸은 숫자').toBe('number')
      else if (typeof want.value === 'string' && want.value.startsWith('=')) expect(got && got.formula, label + '수식').toBe(want.value.slice(1))
      else expect(got, label + '값').toEqual(want.value)
      expect(norm(cell.numFmt), label + '숫자 형식').toBe(norm(want.numFmt))
      expect((cell.alignment || {}).horizontal || null, label + '가로 정렬').toBe(want.h || null)
      /* 스펙의 세로 center 는 엑셀 파일에서 middle 로 저장된다 — 같은 뜻 */
      expect((cell.alignment || {}).vertical || null, label + '세로 정렬').toBe(want.v ? (V_ALIGN[want.v] || want.v) : null)
      expect(sides(cell).slice().sort(), label + '테두리').toEqual((want.border || []).slice().sort())
      expect(fillOf(cell), label + '배경').toBe(want.fill)
      expect(colorOf(cell), label + '글자색').toBe(want.fontColor)
      expect(!!(cell.font && cell.font.bold), label + '굵기').toBe(!!want.bold)
      if (want.size) expect(cell.font && cell.font.size, label + '크기').toBe(want.size)
      checked.push(addr)
    }
    /* 비교를 실제로 했는지 — 목록이 비면 시험이 아무것도 보증하지 못한다 */
    expect(checked.length).toBeGreaterThanOrEqual(Object.keys(S.cells).length - Object.keys(EXCEPTIONS).length)
    expect(checked.length).toBeGreaterThan(35)
  })

  it('보고월은 스펙 글자와 같다 (2026년 9월)', () => {
    expect(color.getWorksheet('요약').getCell('D2').value).toBe(SPEC['요약'].cells.D2.value)
  })

  it('데이터 칸에 사이드카 값이 그대로 들어간다 — 1원도 다르지 않다', () => {
    const ws = color.getWorksheet('요약')
    expect(ws.getCell('F6').value).toBe(101208155.9)   /* 전월재고 */
    expect(ws.getCell('C7').value).toBe(109560998)     /* 현재고 */
    expect(ws.getCell('F7').value).toBe(109560998 - 101208155.9)
    expect(ws.getCell('C11').value).toBe(339)
    expect(ws.getCell('F11').value).toBe(43137284)
    expect(ws.getCell('C12').value).toBe(357)
    expect(ws.getCell('F12').value).toBe(33519715.9)
    expect(ws.getCell('C16').value).toBe(12)
    expect(ws.getCell('F16').value).toBe(431096)
    expect(ws.getCell('C17').value).toBe(5)
    expect(ws.getCell('F17').value).toBe(850180)
    expect(ws.getCell('C18').value).toBe(17)
    expect(ws.getCell('F18').value).toBe(431096 + 850180)
    expect([ws.getCell('C22').value, ws.getCell('F22').value, ws.getCell('C23').value, ws.getCell('F23').value]).toEqual([1, 11, 6, 5])
  })
})

describe('요약 — 승인된 보정 5곳', () => {
  const ws = () => color.getWorksheet('요약')
  it('① 띠(B9) 안에 글자가 있고 B10 은 비어 있다', () => {
    expect(ws().getCell('B9').value).toBe('[입출고 현황]')
    expect(fillOf(ws().getCell('B9'))).toBe('FF019748')
    expect(ws().getCell('B10').value == null).toBe(true)
    expect(SUMMARY_DROPPED).toContain('B10')
  })
  it('② 숨은 흰 글씨 B5·B21 이 없다', () => {
    expect(ws().getCell('B5').value == null).toBe(true)
    expect(ws().getCell('B21').value == null).toBe(true)
    expect(SUMMARY_CELLS.B5).toBeUndefined()
    expect(SUMMARY_CELLS.B21).toBeUndefined()
  })
  it('③ C6·C18 이 숫자이고 형식이 품목·건이다', () => {
    expect(ws().getCell('C6').value).toBe(dto.list.length)
    expect(typeof ws().getCell('C6').value).toBe('number')
    expect(ws().getCell('C6').numFmt).toBe('#,##0"품목"')
    expect(typeof ws().getCell('C18').value).toBe('number')
    expect(ws().getCell('C18').numFmt).toBe('#,##0"건"')
  })
  it('④ C13·F13 이 수식이고, 더하기·빼기뿐이다 (Excel 2016 호환)', () => {
    expect(ws().getCell('C13').value.formula).toBe('C11-C12')
    expect(ws().getCell('F13').value.formula).toBe('F11-F12')
    const formulas = []
    ws().eachRow(r => r.eachCell(c => { if (c.value && c.value.formula) formulas.push(c.value.formula) }))
    expect(formulas.sort()).toEqual(['C11-C12', 'F11-F12'])
    for (const f of formulas) expect(f, '새 함수를 쓰지 않는다').toMatch(/^[A-Z]+\d+-[A-Z]+\d+$/)
  })
  it('⑤ 작성 시각과 새 저작권 문구', () => {
    expect(ws().getCell('B25').value).toBe(STAMP)
    expect(ws().getCell('B25').value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} 작성$/)
    expect(ws().getCell('B26').value).toBe(COPY)
    expect(String(ws().getCell('B26').value)).not.toContain('Jeonghwa Lee')
    expect(String(ws().getCell('B26').value)).not.toContain('무단 전재')
  })
})

describe('약품목록 시트', () => {
  const ws = () => color.getWorksheet('약품목록')
  const D = SPEC['약품목록']

  it('헤더 14개가 스펙 문구와 같다', () => {
    expect(LIST_HEADERS).toEqual(D.headers)
    const got = D.headers.map((_, i) => ws().getRow(1).getCell(i + 1).value)
    expect(got).toEqual(D.headers)
  })
  it('열 너비가 스펙과 같다 (K열 9.78 포함 · 예외 없음)', () => {
    for (const [col, want] of Object.entries(D.widths)) {
      expect(ws().getColumn(col).width, col + '열').toBeCloseTo(want, 1)
    }
    expect(D.widths.K).toBe(9.78)
  })
  it('A열이 고정되고 1행에 자동 필터가 걸린다', () => {
    const v = (ws().views || [])[0] || {}
    expect(v.state).toBe('frozen')
    expect(v.xSplit).toBe(1)
    const af = ws().autoFilter
    const text = typeof af === 'string' ? af : (af && af.from && af.to ? af.from + ':' + af.to : '')
    expect(String(text).replace(/\$/g, '')).toBe(D.autofilter.replace('{last}', String(dto.list.length + 1)))
  })
  it('유효기한 오름차순이고 빈 값은 맨 뒤다', () => {
    const col = ws().getColumn('N').values.slice(2).filter(v => v !== undefined)
    const filled = col.filter(v => v !== '' && v != null).map(String)
    expect(filled).toEqual(filled.slice().sort())
    if (col.some(v => v === '' || v == null)) {
      expect(col[col.length - 1] === '' || col[col.length - 1] == null).toBe(true)
    }
  })
  it('유효기한은 YYYY-MM-DD 문자열이다 (날짜 값이 아니다)', () => {
    for (let r = 2; r <= dto.list.length + 1; r++) {
      const v = ws().getCell('N' + r).value
      expect(typeof v, 'N' + r + ' 는 글자여야 한다').toBe('string')
      if (v !== '') expect(v, 'N' + r).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it('★ Date 로 들어온 유효기한도 글자가 된다 — 「Fri Mar 01」이 되면 안 된다', () => {
    const r = dto.list.findIndex(x => x.code === 'TMVR75') + 2
    expect(ws().getCell('N' + r).value).toBe('2027-03-01')
  })
  it('수량 6열 형식 · 금액 4열 형식', () => {
    for (const col of QTY_COLS) expect(norm(ws().getCell(col + '2').numFmt), col + '2 수량').toBe(norm(QTY_FMT))
    for (const col of AMT_COLS) expect(norm(ws().getCell(col + '2').numFmt), col + '2 금액').toBe(norm(AMT_FMT))
    /* 금액 형식은 스펙(numFmt_D_M)과 같은 형식이다 */
    expect(norm(AMT_FMT)).toBe(norm(SPEC['약품목록'].numFmt_D_M))
    /* 수량 형식은 승인된 보정 — 스펙의 금액 형식에 소수 두 자리를 더한 것이다 */
    expect(norm(QTY_FMT)).toBe('#,##0.00;(#,##0.00)')
    expect(norm(QTY_FMT)).not.toBe(norm(AMT_FMT))
  })
  it('escape 역슬래시는 exceljs 가 떼어낸다 — 표시 결과는 같다(문서용 못)', () => {
    expect(QTY_FMT).toContain('\\(')                                  /* 우리가 적은 글자 */
    expect(ws().getCell('D2').numFmt).toBe('#,##0.00;(#,##0.00)')     /* 파일에 남는 글자 */
    expect(color.getWorksheet('요약').getCell('F7').numFmt).toBe('+#,##0"원";-#,##0"원";0"원"')
  })
  it('수량은 반올림된 값, 금액은 원본값이 담긴다', () => {
    const r = dto.list.findIndex(x => x.code === 'TMVR75') + 2
    expect(ws().getCell('F' + r).value).toBe(1038.5)
    expect(ws().getCell('H' + r).value).toBe(5.78)
    expect(ws().getCell('E' + r).value).toBe(19800.4)      /* ★ 19800 으로 반올림되지 않는다 */
    expect(ws().getCell('M' + r).value).toBe(23760.6)
  })
  it('음수 수량도 그대로 담긴다 (표시만 괄호)', () => {
    const r = dto.list.findIndex(x => x.code === 'NOEXP') + 2
    expect(ws().getCell('L' + r).value).toBe(-3.46)
  })
  it('합계 줄이 없다 — 마지막 행이 데이터 마지막이다', () => {
    const last = dto.list.length + 1
    expect(ws().actualRowCount).toBe(last)
    expect(ws().getCell('A' + last).value).toBe(dto.list[dto.list.length - 1].code)
    expect(ws().getCell('A' + (last + 1)).value == null).toBe(true)
  })
  it('데이터 칸에 테두리·세로 가운데 정렬이 있고 약품명은 줄바꿈된다', () => {
    for (let r = 2; r <= dto.list.length + 1; r++) {
      expect(sides(ws().getCell('A' + r)).length, r + '행 테두리').toBe(4)
      expect(ws().getCell('A' + r).alignment.vertical).toBe('middle')
      expect(ws().getCell('B' + r).alignment.wrapText).toBe(true)
    }
  })
  it('머리글에도 데이터 칸과 같은 테두리가 들어간다 (승인 보정)', () => {
    for (let i = 1; i <= LIST_HEADERS.length; i++) {
      const cell = ws().getRow(1).getCell(i)
      expect(sides(cell).slice().sort(), i + '번째 머리글 테두리').toEqual(['bottom', 'left', 'right', 'top'])
      expect(sides(cell)).toEqual(sides(ws().getRow(2).getCell(i)))   /* 데이터 칸과 같은 테두리 */
    }
  })
  it('머리글의 배경·굵기·크기·색·정렬은 기준 양식 그대로 — 테두리만 더했다', () => {
    for (let i = 1; i <= LIST_HEADERS.length; i++) {
      const cell = ws().getRow(1).getCell(i)
      expect(fillOf(cell), i + '번째 머리글 배경').toBe(null)
      /* 테두리를 넣으면 exceljs 가 기본 글꼴을 붙이는데, 거기엔 argb 가 없다(테마 색) */
      expect(colorOf(cell) || null, i + '번째 머리글 글자색').toBe(null)
      expect(!!(cell.font && cell.font.bold), i + '번째 머리글 굵기').toBe(false)
      expect(cell.alignment == null || Object.keys(cell.alignment).length === 0, i + '번째 머리글 정렬').toBe(true)
    }
  })
  it('조용한 약품은 들어 있지 않다', () => {
    const codes = ws().getColumn('A').values.slice(2)
    expect(codes).not.toContain('QUIET')
    expect(codes.length).toBe(dto.list.length)
  })
})

describe('흑백판 — 배경 없음·글자 검정, 나머지는 컬러판과 같다', () => {
  it('어느 칸에도 배경이 없다', () => {
    for (const name of ['요약', '약품목록']) {
      const ws = mono.getWorksheet(name)
      ws.eachRow(row => row.eachCell(c => { expect(fillOf(c), name + ' ' + c.address + ' 배경').toBe(null) }))
    }
  })
  it('글자색은 모두 검정이거나 지정 없음', () => {
    const ws = mono.getWorksheet('요약')
    ws.eachRow(row => row.eachCell(c => {
      const col = colorOf(c)
      expect(col === null || col === 'FF000000', c.address + ' 글자색 ' + col).toBe(true)
    }))
  })
  it('흰 글자가 하나도 남지 않는다 — 흑백에서 사라지는 글자가 없다', () => {
    const ws = mono.getWorksheet('요약')
    const white = []
    ws.eachRow(row => row.eachCell(c => { if (colorOf(c) === 'FFFFFFFF') white.push(c.address) }))
    expect(white).toEqual([])
  })
  it('굵기·크기·테두리·정렬·형식·병합·너비·높이가 컬러판과 같다', () => {
    for (const name of ['요약', '약품목록']) {
      const a = color.getWorksheet(name), b = mono.getWorksheet(name)
      expect((b.model.merges || []).slice().sort()).toEqual((a.model.merges || []).slice().sort())
      for (const col of 'ABCDEFGHIJKLMN') {
        expect(b.getColumn(col).width, name + ' ' + col + '열 너비').toBe(a.getColumn(col).width)
      }
      a.eachRow((row, r) => {
        expect(b.getRow(r).height, name + ' ' + r + '행 높이').toBe(row.height)
        row.eachCell((c, i) => {
          const d = b.getRow(r).getCell(i)
          expect(norm(d.numFmt), name + c.address + ' 형식').toBe(norm(c.numFmt))
          expect(sides(d).slice().sort(), name + c.address + ' 테두리').toEqual(sides(c).slice().sort())
          expect(JSON.stringify(d.alignment || null), name + c.address + ' 정렬').toBe(JSON.stringify(c.alignment || null))
          expect(!!(d.font && d.font.bold), name + c.address + ' 굵기').toBe(!!(c.font && c.font.bold))
          expect(d.font && d.font.size, name + c.address + ' 크기').toBe(c.font && c.font.size)
        })
      })
    }
  })
  it('값은 컬러판과 한 글자도 다르지 않다', () => {
    for (const name of ['요약', '약품목록']) {
      const a = color.getWorksheet(name), b = mono.getWorksheet(name)
      a.eachRow((row, r) => row.eachCell((c, i) => {
        expect(JSON.stringify(b.getRow(r).getCell(i).value), name + c.address).toBe(JSON.stringify(c.value))
      }))
    }
  })
})

/* ── 보고 연·월이 파일명과 요약 D2 에 함께 따라붙는가 ─────────────────────
   ★ 둘이 **다른 코드 자리**에서 만들어진다(파일명은 monthlyReportFileName,
     D2 는 쓰기 계층의 _period). 한쪽만 고치면 「12월 파일 안에 11월」 같은 일이 난다.
   ★ 다운로드 **날짜**가 아니라 화면에서 고른 **보고 연·월**이어야 한다.
     작성 시각은 B25 에만 적힌다. */
describe('보고 연·월 — 파일명과 요약 D2 가 함께 따라온다', () => {
  const PERIODS = [
    [2026, 9, '2026년 9월'],
    [2026, 12, '2026년 12월'],
    [2027, 1, '2027년 1월'],    /* ★ 연도 경계 — 12월 다음이 이듬해 1월이다 */
    [2027, 10, '2027년 10월'],
    [2030, 3, '2030년 3월'],
  ]
  const dtoFor = (y, m) => buildMonthlyReportDTO({
    closed: true, totals: TOTALS, rows: ROWS, drugs: DRUGS, live: null,
    year: y, month: m, stamp: STAMP, copyright: COPY,
  })

  for (const [y, m, text] of PERIODS) {
    it(y + '-' + String(m).padStart(2, '0') + ' → 파일명·D2 모두 「' + text + '」', async () => {
      const d = dtoFor(y, m)
      expect(monthlyReportFileName(d, false)).toBe(text + ' 의약품 결산 내역.xlsx')
      expect(monthlyReportFileName(d, true)).toBe(text + ' 의약품 결산 내역(흑백).xlsx')
      const wb = await load(await writeMonthlyReportXlsx(d, { mono: false }))
      expect(wb.getWorksheet('요약').getCell('D2').value).toBe(text)
      /* 파일명 안에 D2 와 똑같은 글자가 들어 있다 — 둘이 갈라지면 여기서 걸린다 */
      expect(monthlyReportFileName(d, false)).toContain(text)
    }, 30000)
  }

  it('월은 0 으로 채우지 않는다 — 「09월」이 아니라 「9월」', () => {
    for (let m = 1; m <= 9; m++) {
      const n = monthlyReportFileName(dtoFor(2026, m), false)
      expect(n, m + '월').toBe('2026년 ' + m + '월 의약품 결산 내역.xlsx')
      expect(n).not.toContain('0' + m + '월')
    }
  })

  it('★ 연도 경계 — 2026년 12월과 2027년 1월이 서로 다른 이름이 된다', () => {
    const dec = monthlyReportFileName(dtoFor(2026, 12), false)
    const jan = monthlyReportFileName(dtoFor(2027, 1), false)
    expect(dec).not.toBe(jan)
    expect(dec).toContain('2026년 12월')
    expect(jan).toContain('2027년 1월')
    expect(jan).not.toContain('2026')
  })

  it('작성 시각(B25)은 따로 간다 — 보고월을 따라가지 않는다', async () => {
    const wb = await load(await writeMonthlyReportXlsx(dtoFor(2027, 1), { mono: false }))
    const s = wb.getWorksheet('요약')
    expect(s.getCell('D2').value).toBe('2027년 1월')
    expect(s.getCell('B25').value).toBe(STAMP)          /* 다운로드 시점 */
    expect(s.getCell('B25').value).not.toContain('2027년 1월')
  }, 30000)

  it('★ 결산 코드에 연·월이 박혀 있지 않다', () => {
    for (const f of ['monthlyReportXlsx.js', 'monthlyReportDTO.js', 'monthlyReportQuery.js']) {
      const src = readFileSync('src/lib/' + f, 'utf8')
      /* 주석은 설명이라 뺀다 — 실제로 실행되는 줄만 본다.
         ★ 블록 주석을 **먼저** 통째로 지운다. 줄 단위로 먼저 걸러 내면 여는 `/*` 가
           사라져 블록 몸통이 코드인 양 남는다(처음에 이렇게 틀렸다). */
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
      expect(code.match(/\b20\d\d\b/g), f + ' 에 연도 리터럴').toBe(null)
      expect(code.match(/\d\s*월/g), f + ' 에 월 리터럴').toBe(null)
    }
  })

  it('★ 화면 쪽도 고른 연·월을 그대로 넘긴다 (App.jsx dlFmt)', () => {
    const app = readFileSync('src/App.jsx', 'utf8')
    const i = app.indexOf('async function dlFmt()')
    expect(i, 'dlFmt 를 찾지 못했다').toBeGreaterThan(0)
    const body = app.slice(i, app.indexOf('\n  }', i))
    expect(body, '고른 연·월을 넘긴다').toMatch(/year,\s*month,/)
    expect(body.match(/\b20\d\d\b/g), 'dlFmt 에 연도 리터럴').toBe(null)
    /* 파일명은 dto 에서 만든다 — 화면이 따로 짜 맞추지 않는다 */
    expect(body).toContain('monthlyReportFileName(dto,mono)')
  })
})

/* ── 글꼴 ────────────────────────────────────────────────────────────────
   기준 양식 실측: styles.xml 의 글꼴 16개 중 15개가 「맑은 고딕」이고 저마다 이름을
   명시한다(테마의 minor 는 Calibri 지만 이름이 이긴다).
   ★ exceljs 는 아무것도 안 주면 Calibri 로 쓴다. 한글은 테마의 `script="Hang"` 덕에
     맑은 고딕으로 떨어지지만 **숫자·영문은 Calibri 로 남아** 기준 양식과 달라 보인다. */
describe('글꼴 — 모든 칸이 맑은 고딕', () => {
  const everyCell = (wb, fn) => {
    for (const ws of wb.worksheets) ws.eachRow(r => r.eachCell({ includeEmpty: true }, c => fn(ws, c)))
  }

  it('요약 — 스펙에 있는 칸 53개가 전부 맑은 고딕', () => {
    const ws = color.getWorksheet('요약')
    const checked = []
    for (const addr of Object.keys(SPEC['요약'].cells)) {
      if (addr === 'B5' || addr === 'B21') continue      /* 보정②로 넣지 않는 칸 */
      expect(ws.getCell(addr).font && ws.getCell(addr).font.name, addr + ' 글꼴').toBe(FONT_NAME)
      checked.push(addr)
    }
    expect(checked.length).toBeGreaterThan(45)
  })

  it('요약 — 글꼴을 박아도 크기·굵기·색은 스펙 그대로다', () => {
    const ws = color.getWorksheet('요약')
    for (const [addr, want] of Object.entries(SPEC['요약'].cells)) {
      if (EXCEPTIONS[addr]) continue
      const f = ws.getCell(addr).font || {}
      if (want.size) expect(f.size, addr + ' 크기').toBe(want.size)
      expect(!!f.bold, addr + ' 굵기').toBe(!!want.bold)
      expect(f.color ? f.color.argb : null, addr + ' 색').toBe(want.fontColor)
    }
  })

  it('약품목록 — 머리글 14칸과 데이터 칸 전부 맑은 고딕', () => {
    const ws = color.getWorksheet('약품목록')
    for (let i = 1; i <= LIST_HEADERS.length; i++) {
      expect(ws.getRow(1).getCell(i).font.name, '머리글 ' + i).toBe(FONT_NAME)
    }
    for (let r = 2; r <= dto.list.length + 1; r++) {
      for (let c = 1; c <= LIST_HEADERS.length; c++) {
        expect(ws.getRow(r).getCell(c).font.name, r + '행 ' + c + '열').toBe(FONT_NAME)
      }
    }
  })

  it('★ 빈 칸까지 포함해 Calibri 가 한 칸도 없다 (컬러판)', () => {
    const bad = []
    everyCell(color, (ws, c) => {
      const n = c.font && c.font.name
      if (n !== FONT_NAME) bad.push(ws.name + '!' + c.address + '=' + (n || '(없음)'))
    })
    expect(bad, '맑은 고딕이 아닌 칸: ' + bad.join(', ')).toEqual([])
  })

  it('★ 흑백판도 똑같이 Calibri 0칸', () => {
    const bad = []
    everyCell(mono, (ws, c) => {
      const n = c.font && c.font.name
      if (n !== FONT_NAME) bad.push(ws.name + '!' + c.address + '=' + (n || '(없음)'))
    })
    expect(bad, '맑은 고딕이 아닌 칸: ' + bad.join(', ')).toEqual([])
  })

  it('열에도 기본 글꼴이 걸려 있다 — 나중에 빈 칸에 입력해도 따라온다', () => {
    for (const [name, cols] of [['요약', 'ABCDEF'], ['약품목록', 'ABCDEFGHIJKLMN']]) {
      const ws = color.getWorksheet(name)
      for (const col of cols) {
        expect(ws.getColumn(col).font && ws.getColumn(col).font.name, name + ' ' + col + '열').toBe(FONT_NAME)
      }
    }
  })

  it('DEFAULT_FONT 는 이름과 기본 크기만 들고 있다 — 색·굵기를 섞지 않는다', () => {
    expect(DEFAULT_FONT).toEqual({ name: FONT_NAME, size: 11 })
    expect(FONT_NAME).toBe('맑은 고딕')
  })
})

describe('스펙 비교에서 빼 둔 항목이 문서로 남아 있다', () => {
  it('요약 보정은 5종 9칸뿐', () => {
    expect(Object.keys(EXCEPTIONS).sort()).toEqual(['B10', 'B21', 'B25', 'B26', 'B5', 'B9', 'C18', 'C6', 'F13'])
  })
  it('약품목록 보정은 3종뿐 — K열 너비는 예외가 아니다', () => {
    expect(LIST_EXCEPTIONS.length).toBe(3)
    expect(LIST_EXCEPTIONS.join(' ')).not.toContain('K열')
    expect(LIST_EXCEPTIONS.join(' ')).toContain('머리글(1행)에도 같은 테두리')
  })
})
