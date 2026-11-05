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

/* ★ 답이 **0 이어도 파일에는 제대로 들어간다** (2026-11-05 이정화 님 확인으로 바로잡음).
   앞서 「exceljs 가 0 을 버린다」고 적었던 것은 **다시 읽을 때의 착시**였다 —
   `lib/doc/cell.js` 의 모델 복사가 `if (value)` 라 falsy 를 떨어뜨려 `result` 가 비어 보인다.
   파일은 멀쩡하므로 시험은 **XML 원문**을 본다. 이게 뷰어·엑셀이 실제로 읽는 것이다. */
async function sheetXml(dto, opts) {
  const out = await writeMonthlyReportXlsx(dto, opts)
  const buf = out instanceof Blob ? await out.arrayBuffer() : out
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  return zip.file('xl/worksheets/sheet1.xml').async('string')
}
const cellXml = (xml, addr) => (xml.match(new RegExp('<c r="' + addr + '"[^>]*>.*?</c>')) || [''])[0]

describe('D — 답이 0 이어도 XML 원문에 값이 들어간다', () => {
  it('★ 순입고가 0 인 달도 <v>0</v> 이 적힌다', async () => {
    const d0 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 0, outCnt: 0 } })
    expect(d0.summary.inCount - d0.summary.outCount, '답이 0 이다').toBe(0)
    expect(formulaResult('C11-C12', d0.summary), 'lib 이 0 을 바르게 셈한다').toBe(0)
    const xml = await sheetXml(d0, { mono: false })
    const c13 = cellXml(xml, 'C13')
    expect(c13, 'C13 에 수식이 있다').toContain('<f>C11-C12</f>')
    expect(c13, '★ 값 0 이 함께 적힌다').toContain('<v>0</v>')
  })
  it('★ 금액 쪽(F13)도 같다', async () => {
    /* 건수만 0 으로 두면 **금액은 0 이 아니다** — 금액은 명세 행에서 온다. 둘 다 0 인 입력을 만든다 */
    const d0 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 0, outCnt: 0 },
      rows: INPUT.rows.map(r => ({ ...r, total_in_qty: 0, total_in_amount: 0, total_out_qty: 0, total_out_amount: 0 })) })
    expect(d0.summary.inAmount - d0.summary.outAmount, '금액 답도 0 이다').toBe(0)
    const f13 = cellXml(await sheetXml(d0, { mono: false }), 'F13')
    expect(f13).toContain('<f>F11-F12</f>')
    expect(f13).toContain('<v>0</v>')
  })
  it('흑백본도 같다', async () => {
    const d0 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 0, outCnt: 0 } })
    expect(cellXml(await sheetXml(d0, { mono: true }), 'C13')).toContain('<v>0</v>')
  })
  it('0 이 아닌 달은 그 값이 적힌다', async () => {
    const d1 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 5, outCnt: 2 } })
    expect(cellXml(await sheetXml(d1, { mono: false }), 'C13')).toContain('<v>3</v>')
  })
  it('음수도 그대로 적힌다', async () => {
    const d2 = buildMonthlyReportDTO({ ...INPUT, live: { ...INPUT.live, inCnt: 1, outCnt: 9 } })
    expect(cellXml(await sheetXml(d2, { mono: false }), 'C13')).toContain('<v>-8</v>')
  })
})

/* ★ 2026-11-05 이정화 님 요청 — 합계 줄 가운데 빈 칸(D18)의 **위·아래 선만** 뺀다.
   보라 배경과 좌·우 선은 그대로 둔다. 그 밖의 칸은 한 군데도 달라지면 안 된다. */
describe('D18 — 위·아래 선만 뺀다', () => {
  const border = (book, addr) => {
    const b = book.getWorksheet('요약').getCell(addr).border
    /* ★ exceljs 는 선이 없어도 빈 객체 {} 를 준다 — truthy 라서 키 수로 봐야 한다 */
    const keys = b ? Object.keys(b).sort() : []
    return keys.length ? keys.join('+') : '(없음)'
  }
  const fill = (book, addr) => {
    const f = book.getWorksheet('요약').getCell(addr).fill
    return (f && f.fgColor && f.fgColor.argb) || '(없음)'
  }
  it('★ D18 에 위·아래 선이 없다', () => {
    expect(border(wb, 'D18')).toBe('left+right')
  })
  it('★ 흑백본에서도 다시 그려지지 않는다', () => {
    expect(border(mono, 'D18')).toBe('left+right')
  })
  it('★ 보라 배경은 그대로다 (흑백본은 원래 배경이 없다)', () => {
    expect(fill(wb, 'D18'), '컬러본').toBe('FF804A87')
    expect(fill(mono, 'D18'), '흑백본은 어느 칸에도 배경이 없다').toBe('(없음)')
  })
  it('★ 이웃 칸은 선을 그리지 않는다 — 위·아래가 되살아날 길이 없다', () => {
    expect(border(wb, 'D17'), 'D17').toBe('(없음)')
    expect(border(wb, 'D19'), 'D19').toBe('(없음)')
    expect(border(mono, 'D17'), '흑백 D17').toBe('(없음)')
    expect(border(mono, 'D19'), '흑백 D19').toBe('(없음)')
  })
  it('★ 합계 줄의 다른 칸은 네 면 그대로다 — E18 포함', () => {
    for (const a of ['B18', 'C18', 'E18', 'F18'])
      expect(border(wb, a), a).toBe('bottom+left+right+top')
  })
  it('★ 테두리가 있는 칸 전체 목록이 D18 빼고 그대로다', () => {
    /* 요약 시트에서 테두리가 걸린 칸은 네 묶음의 라벨·값 칸뿐이다 */
    const want = ['B6', 'C6', 'E6', 'F6', 'B7', 'C7', 'E7', 'F7',
      'B11', 'C11', 'E11', 'F11', 'B12', 'C12', 'E12', 'F12', 'B13', 'C13', 'E13', 'F13',
      'B16', 'C16', 'E16', 'F16', 'B17', 'C17', 'E17', 'F17', 'B18', 'C18', 'E18', 'F18',
      'B22', 'C22', 'E22', 'F22', 'B23', 'C23', 'E23', 'F23']
    for (const a of want) expect(border(wb, a), a + ' 는 네 면').toBe('bottom+left+right+top')
    expect(border(wb, 'D18'), 'D18 만 좌·우').toBe('left+right')
    /* D 열의 나머지는 전과 같이 선이 없다 */
    for (const a of ['D6', 'D7', 'D11', 'D12', 'D13', 'D16', 'D17', 'D22', 'D23'])
      expect(border(wb, a), a).toBe('(없음)')
  })
})
