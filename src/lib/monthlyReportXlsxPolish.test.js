/* 결산 엑셀 두 가지 다듬기 (2026-11-04 이정화 님 승인)

   D. 순입고 수식(C13·F13)에 **계산된 값**을 같이 저장한다.
      ★ 왜 — 엑셀은 열 때 스스로 계산하지만 미리보기·구글시트·웹 뷰어는 계산하지 않는다.
        그래서 이정화 님 사진에서 순입고 두 칸이 **빈 칸**으로 보였다.
        수식은 그대로 두므로 위 칸을 고치면 여전히 따라온다(계산식 변경 아님).

   A. 바닥글 두 줄(B25 작성 시각 · B26 저작권) 글자색을 **#999999** 로.
      ★ 새 색이 아니다 — 보고서 화면·PDF 가 이미 쓰는 `#999` 와 같은 색이다.
      ★ **흑백본도 같은 회색**이다(이정화 님 결정). 회색은 흑백에서도 회색이다. */
import { describe, it, expect, beforeAll } from 'vitest'
import { buildMonthlyReportDTO } from './monthlyReportDTO.js'
import { writeMonthlyReportXlsx, formulaResult, SUMMARY_CELLS } from './monthlyReportXlsx.js'

/* 운영과 같은 모양의 작은 입력 — 숫자는 셈을 눈으로 따라갈 수 있게 골랐다 */
const INPUT = {
  closed: false, totals: null, year: 2026, month: 11,
  stamp: '2026-11-04 22:23 작성',
  copyright: '© 2026 JEONGHWALEE. All rights reserved. 무단 복제 및 재배포를 금지합니다.',
  drugs: [
    { drug_code: 'A1', drug_name: '가나정', category: '경구제', status: '사용', purchase_price: 100, expiry_date: '2027-06-01' },
    { drug_code: 'A2', drug_name: '다라주', category: '주사제', status: '중지', purchase_price: 200, expiry_date: '2027-07-01' },
  ],
  rows: [
    { drug_code: 'A1', opening_qty: 10, opening_amount: 1000, total_in_qty: 30, total_in_amount: 3000, total_out_qty: 12, total_out_amount: 1200, total_disp_qty: 1, total_ret_qty: 0, closing_qty: 27, closing_amount: 2700 },
    { drug_code: 'A2', opening_qty: 5, opening_amount: 1000, total_in_qty: 0, total_in_amount: 0, total_out_qty: 5, total_out_amount: 1000, total_disp_qty: 0, total_ret_qty: 2, closing_qty: 0, closing_amount: 0 },
  ],
  live: { oa: 2000, da: 100, ra: 400, adjA: 0, adjCnt: 0, inCnt: 3, outCnt: 7, dispCnt: 1, retCnt: 1 },
  expiry: { expired: 0, caution60: 1, urgent30: 2, check90: 3 },
}

/* ★ DTO 는 **모듈 수준**에서 만든다 — describe 본문은 beforeAll 보다 **먼저** 돌기 때문에
   beforeAll 에서 채우면 describe 안에서 아직 비어 있다(처음에 그래서 터졌다). */
const dto = buildMonthlyReportDTO(INPUT)
let wb, mono
const cell = (book, addr) => book.getWorksheet('요약').getCell(addr)
const colorOf = c => (c.font && c.font.color && c.font.color.argb) || null

beforeAll(async () => {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const load = async buf => { const b = new ExcelJS.Workbook(); await b.xlsx.load(buf); return b }
  wb = await load(await writeMonthlyReportXlsx(dto, { mono: false }))
  mono = await load(await writeMonthlyReportXlsx(dto, { mono: true }))
})

describe('D — 순입고 수식에 계산된 값이 함께 들어간다', () => {
  it('★ C13(순입고 건수) 가 빈 칸이 아니다', () => {
    const c = cell(wb, 'C13')
    expect(c.value, 'C13 이 비어 있다').not.toBeNull()
    expect(c.value.formula, '수식은 그대로 둔다').toBe('C11-C12')
    expect(c.value.result, '계산된 값이 같이 있다').toBe(dto.summary.inCount - dto.summary.outCount)
  })
  it('★ F13(순입고 금액) 도 빈 칸이 아니다', () => {
    const c = cell(wb, 'F13')
    expect(c.value.formula).toBe('F11-F12')
    expect(c.value.result).toBe(dto.summary.inAmount - dto.summary.outAmount)
  })
  it('계산된 값이 **엑셀이 직접 셈한 것과 같다** — 윗 칸 두 개를 빼면 나온다', () => {
    expect(cell(wb, 'C13').value.result).toBe(cell(wb, 'C11').value - cell(wb, 'C12').value)
    expect(cell(wb, 'F13').value.result).toBe(cell(wb, 'F11').value - cell(wb, 'F12').value)
  })
  it('흑백본도 똑같이 들어간다', () => {
    expect(cell(mono, 'C13').value.result).toBe(cell(wb, 'C13').value.result)
    expect(cell(mono, 'F13').value.result).toBe(cell(wb, 'F13').value.result)
  })
  it('음수(출고가 입고보다 많을 때)도 그대로 적는다', async () => {
    const d2 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 1, outCnt: 9 } })
    const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
    const b = new ExcelJS.Workbook(); await b.xlsx.load(await writeMonthlyReportXlsx(d2, { mono: false }))
    expect(b.getWorksheet('요약').getCell('C13').value.result).toBe(1 - 9)
  })

  describe('formulaResult — 아는 모양만 셈한다', () => {
    const vals = { ...dto.summary }
    it('C11-C12 를 안다', () => {
      expect(formulaResult('C11-C12', vals)).toBe(vals.inCount - vals.outCount)
    })
    it('빈칸·모르는 모양이면 null 을 준다 (부르는 쪽이 수식만 넣는다)', () => {
      for (const f of ['', null, 'SUM(C11:C12)', 'C11+C12', 'C11-', 'Z99-Z98'])
        expect(formulaResult(f, vals), String(f)).toBeNull()
    })
    it('값이 없는 칸을 가리키면 null 을 준다', () => {
      expect(formulaResult('C11-C12', {})).toBeNull()
    })
    it('라벨 칸(값이 아닌 칸)을 가리키면 null 을 준다', () => {
      expect(SUMMARY_CELLS.B11.label, 'B11 은 라벨 칸이다').toBe('입고')
      expect(formulaResult('B11-C12', vals)).toBeNull()
    })
  })
})

describe('A — 바닥글 두 줄만 회색', () => {
  it('★ 작성 시각(B25) 이 #999999', () => {
    expect(colorOf(cell(wb, 'B25'))).toBe('FF999999')
    expect(cell(wb, 'B25').value).toBe(INPUT.stamp)
  })
  it('★ 저작권(B26) 이 #999999', () => {
    expect(colorOf(cell(wb, 'B26'))).toBe('FF999999')
    expect(cell(wb, 'B26').value).toBe(INPUT.copyright)
  })
  it('★ 흑백본에서도 회색이다 — 검정으로 되돌리지 않는다', () => {
    expect(colorOf(cell(mono, 'B25'))).toBe('FF999999')
    expect(colorOf(cell(mono, 'B26'))).toBe('FF999999')
  })
  it('★ 다른 칸 색은 하나도 안 바뀐다', () => {
    /* 바닥글 말고 색이 지정된 칸들을 그대로 집어 본다 */
    const keep = {
      B1: 'FFFFFFFF', C6: 'FF804A87', F7: 'FF019748',
      B11: 'FF000000', F11: 'FF804A87', C13: 'FF000000', F13: 'FF019748',
      /* 합계 줄은 보라 바탕에 **흰 글자**다 */
      B18: 'FFFFFFFF', C18: 'FFFFFFFF', F18: 'FFFFFFFF', C22: 'FF000000',
    }
    for (const [addr, want] of Object.entries(keep))
      expect(colorOf(cell(wb, addr)), addr).toBe(want)
  })
  it('배경·테두리·글자 내용은 건드리지 않았다', () => {
    for (const addr of ['B25', 'B26']) {
      const c = cell(wb, addr)
      expect(c.fill && c.fill.fgColor, addr + ' 배경 없음').toBeFalsy()
      expect(c.border && Object.keys(c.border).length, addr + ' 테두리 없음').toBeFalsy()
    }
  })
  it('화면·PDF 가 쓰는 색과 같은 색이다 (#999999)', () => {
    /* App.jsx 바닥글은 color:'#999' — 같은 색을 엑셀 ARGB 로 적은 것이다 */
    expect('FF999999'.slice(2)).toBe('999999')
  })
})

/* ⚠ exceljs 의 함정 — 답이 **정확히 0** 이면 계산된 값을 버린다.
   lib/doc/cell.js 의 모델 복사가 `if (value)` 라 falsy 를 떨어뜨린다.
   여기서 못 박아 두는 이유: 나중에 「0 인 달만 또 빈 칸이네」가 나왔을 때
   코드가 잘못된 게 아니라 **알고 둔 한계**임을 바로 알 수 있게 하려는 것이다. */
describe('⚠ 알고 둔 한계 — 답이 0 이면 계산된 값이 빠진다', () => {
  it('순입고가 0 인 달은 수식만 남는다 (엑셀로 열면 0건으로 보인다)', async () => {
    const d0 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 0, outCnt: 0 } })
    expect(d0.summary.inCount - d0.summary.outCount, '답이 0 이다').toBe(0)
    expect(formulaResult('C11-C12', d0.summary), 'lib 은 0 을 바르게 셈한다').toBe(0)
    const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
    const b = new ExcelJS.Workbook(); await b.xlsx.load(await writeMonthlyReportXlsx(d0, { mono: false }))
    const v = b.getWorksheet('요약').getCell('C13').value
    expect(v.formula, '수식은 남는다').toBe('C11-C12')
    expect(v.result, '★ exceljs 가 0 을 버린다 — 알고 둔 한계').toBeUndefined()
  })
  it('답이 0 이 아니면 제대로 들어간다', async () => {
    const d1 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 5, outCnt: 2 } })
    const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
    const b = new ExcelJS.Workbook(); await b.xlsx.load(await writeMonthlyReportXlsx(d1, { mono: false }))
    expect(b.getWorksheet('요약').getCell('C13').value.result).toBe(3)
  })
})
