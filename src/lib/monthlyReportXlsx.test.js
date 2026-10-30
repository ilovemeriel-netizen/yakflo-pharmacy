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
  it('헤더 행은 기준 양식처럼 서식을 넣지 않는다', () => {
    expect(fillOf(ws().getCell('A1'))).toBe(null)
    expect(sides(ws().getCell('A1')).length).toBe(0)
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

describe('스펙 비교에서 빼 둔 항목이 문서로 남아 있다', () => {
  it('요약 보정은 5종 9칸뿐', () => {
    expect(Object.keys(EXCEPTIONS).sort()).toEqual(['B10', 'B21', 'B25', 'B26', 'B5', 'B9', 'C18', 'C6', 'F13'])
  })
  it('약품목록 보정은 2종뿐 — K열 너비는 예외가 아니다', () => {
    expect(LIST_EXCEPTIONS.length).toBe(2)
    expect(LIST_EXCEPTIONS.join(' ')).not.toContain('K열')
  })
})
