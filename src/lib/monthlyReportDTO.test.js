/* 월간보고서 결산 엑셀 — 값 계층 시험.
   여기서 지키는 것: 수량 반올림 · 행 선정 규칙 · 금액은 원본 보존 · 마감월은 사이드카만. */
import { describe, it, expect } from 'vitest'
import { roundQty, isListRow, buildMonthlyReportDTO, listTotals, isoDate } from './monthlyReportDTO.js'

describe('isoDate — 유효기한을 YYYY-MM-DD 글자로', () => {
  it('글자로 오면 앞 10자', () => {
    expect(isoDate('2027-03-01')).toBe('2027-03-01')
    expect(isoDate('2027-03-01T00:00:00+09:00')).toBe('2027-03-01')
  })
  it('★ Date 객체로 와도 날짜가 된다 — 「Fri Apr 02」가 되면 안 된다', () => {
    expect(isoDate(new Date(2027, 3, 2))).toBe('2027-04-02')
    expect(isoDate(new Date(2026, 0, 9))).toBe('2026-01-09')
  })
  it('★ 자정이어도 하루가 밀리지 않는다 (toISOString 함정)', () => {
    /* 한국 시간 자정은 UTC 로 전날 15시다. 그래도 달력 날짜 그대로여야 한다 */
    const midnight = new Date(2026, 9, 31, 0, 0, 0)
    expect(isoDate(midnight)).toBe('2026-10-31')
  })
  it('없거나 이상하면 빈 글자', () => {
    for (const v of [null, undefined, '', '없음', new Date('x')]) expect(isoDate(v)).toBe('')
  })
})

describe('roundQty — 소수 둘째 자리 round half up', () => {
  /* 지시문에 적힌 예시를 그대로 못으로 박는다 */
  const cases = [
    [1038.5, 1038.5],
    [1038.567, 1038.57],
    [1038.564, 1038.56],
    [1038.005, 1038.01],      /* ★ 1038.005*100 = 103800.49999999999 — 그냥 반올림하면 내려간다 */
    [-3.455, -3.46],          /* ★ 음수는 절대값이 올라간다(괄호 표시 (3.46)) */
    [12.219999999999999, 12.22], /* 부동소수 찌꺼기 */
    [0.005, 0.01],
    [-0.005, -0.01],
    [1038, 1038],
    [0, 0],
  ]
  for (const [input, want] of cases) {
    it(input + ' → ' + want, () => { expect(roundQty(input)).toBe(want) })
  }

  it('잘라내기·내림이 아니다 — x.xx5 는 반드시 올라간다', () => {
    for (let i = 1; i <= 99; i++) {
      const v = i + 0.005
      expect(roundQty(v), v + ' 는 올라가야 한다').toBe(Math.round(i * 100 + 1) / 100)
    }
  })

  it('소수 둘째 자리까지만 남는다', () => {
    for (const v of [1.234, 99.999, 1234.5678, -0.126]) {
      expect(Math.round(roundQty(v) * 100) / 100).toBe(roundQty(v))
    }
  })

  it('값이 아닌 것은 0', () => {
    for (const v of [null, undefined, '', 'abc', NaN, Infinity]) expect(roundQty(v)).toBe(0)
  })

  it('문자열로 온 숫자도 받는다 (numeric 칸은 문자열로 온다)', () => {
    expect(roundQty('1038.005')).toBe(1038.01)
    expect(roundQty('101208155.9')).toBe(101208155.9)
  })
})

/* 엑셀 형식 #,##0.00;(#,##0.00) 이 보여 줄 글자 — 형식 문자열이 맞는지는 xlsx 시험이 보고,
   여기서는 그 형식이 뜻하는 표시를 문서로 고정한다. */
function asQtyText(v) {
  const n = roundQty(v)
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? '(' + s + ')' : s
}
describe('수량 표시 형식', () => {
  it('1038.5 → 1,038.50', () => expect(asQtyText(1038.5)).toBe('1,038.50'))
  it('1038 → 1,038.00 (정수도 .00 이 보인다)', () => expect(asQtyText(1038)).toBe('1,038.00'))
  it('음수는 괄호 — -3.455 → (3.46)', () => expect(asQtyText(-3.455)).toBe('(3.46)'))
})

describe('isListRow — 상태를 보지 않는 행 선정', () => {
  const base = { opening_qty: 0, closing_qty: 0, total_in_qty: 0, total_out_qty: 0, total_disp_qty: 0, total_ret_qty: 0 }
  it('모두 0 이면 뺀다', () => expect(isListRow({ ...base })).toBe(false))
  for (const k of ['total_in_qty', 'total_out_qty', 'total_disp_qty', 'total_ret_qty']) {
    it(k + ' 가 있으면 넣는다', () => expect(isListRow({ ...base, [k]: 1 })).toBe(true))
  }
  it('전월재고만 있어도 넣는다', () => expect(isListRow({ ...base, opening_qty: 5 })).toBe(true))
  it('기말재고만 있어도 넣는다', () => expect(isListRow({ ...base, closing_qty: 5 })).toBe(true))
  it('음수 수량도 움직임으로 본다', () => expect(isListRow({ ...base, total_out_qty: -3 })).toBe(true))
  it('문자열 "0" 은 0 으로 본다', () => expect(isListRow({ ...base, opening_qty: '0' })).toBe(false))
  it('★ status 칸은 아예 읽지 않는다', () => {
    for (const s of ['사용', '휴면', '중지', undefined]) {
      expect(isListRow({ ...base, status: s, total_in_qty: 1 }), s + ' 움직임 있음').toBe(true)
      expect(isListRow({ ...base, status: s }), s + ' 움직임 없음').toBe(false)
    }
  })
})

/* ── 공통 재료 ─────────────────────────────────────────────────────────── */
const snap = (code, o) => ({
  drug_code: code, opening_qty: 0, opening_amount: 0, total_in_qty: 0, total_in_amount: 0,
  total_out_qty: 0, total_out_amount: 0, total_disp_qty: 0, total_ret_qty: 0,
  closing_qty: 0, closing_amount: 0, ...o,
})
const DRUGS = [
  { drug_code: 'AAA', drug_name: '가나정', category: '경구제', status: '사용', expiry_date: '2027-03-01' },
  { drug_code: 'BBB', drug_name: '나다주', category: '주사제', status: '중지', expiry_date: '2026-11-15' },
  { drug_code: 'CCC', drug_name: '다라액', category: '외용제', status: '중지', expiry_date: '2028-01-20' },
  { drug_code: 'DDD', drug_name: '마바정', category: '경구제', status: '휴면', expiry_date: null },
]
const TOTALS = {
  opening_amount: '101208155.9000', in_amount: '43137284.0000', out_amount: '33519715.9000',
  disposal_amount: '431096.0000', return_amount: '850180.0000', actual_closing: '109560998.0000',
  in_count: 339, out_count: 357, disposal_count: 12, return_count: 5,
  exp_expired: 1, exp_urgent30: 6, exp_caution60: 11, exp_check90: 5, item_count: 1125,
}

describe('buildMonthlyReportDTO — 마감월', () => {
  const rows = [
    snap('AAA', { opening_qty: 100, opening_amount: 19800, total_in_qty: 50, total_in_amount: 9900, closing_qty: 120, closing_amount: 23760 }),
    snap('BBB', { opening_qty: 8, opening_amount: 3200, total_disp_qty: 7 }),            /* 중지 · 움직임 */
    snap('CCC', {}),                                                                       /* 중지 · 조용함 → 빠진다 */
    snap('DDD', { closing_qty: 2, closing_amount: 500 }),
  ]
  const dto = buildMonthlyReportDTO({
    closed: true, totals: TOTALS, rows, drugs: DRUGS, live: null,
    year: 2026, month: 9, stamp: '2026-10-30 13:00 작성', copyright: '© 2026',
  })

  it('조용한 중지 약품만 빠진다 (상태 때문이 아니라 움직임·잔량이 없어서)', () => {
    expect(dto.list.map(r => r.code)).toEqual(['BBB', 'AAA', 'DDD'])  /* 유효기한 오름차순, 빈 값 끝 */
  })
  it('관리 품목수 = 약품목록 행 수 (사이드카 item_count 1125 를 쓰지 않는다)', () => {
    expect(dto.summary.itemCount).toBe(3)
    expect(dto.summary.itemCount).toBe(dto.list.length)
  })
  it('★ 월 총계·건수·유효기간은 사이드카 값 그대로 — 1원도 다르지 않다', () => {
    expect(dto.summary.opening).toBe(101208155.9)
    expect(dto.summary.inAmount).toBe(43137284)
    expect(dto.summary.outAmount).toBe(33519715.9)
    expect(dto.summary.dispAmount).toBe(431096)
    expect(dto.summary.retAmount).toBe(850180)
    expect(dto.summary.closing).toBe(109560998)
    expect(dto.summary.inCount).toBe(339)
    expect(dto.summary.outCount).toBe(357)
    expect(dto.summary.dispCount).toBe(12)
    expect(dto.summary.retCount).toBe(5)
    expect([dto.summary.expExpired, dto.summary.expUrgent30, dto.summary.expCaution60, dto.summary.expCheck90]).toEqual([1, 6, 11, 5])
  })
  it('증감 = 기말 − 전월 (사이드카 두 값으로만 낸다)', () => {
    expect(dto.summary.delta).toBe(109560998 - 101208155.9)
  })
  it('표시 반올림하면 요구 마감값과 똑같다', () => {
    expect(Math.round(dto.summary.opening)).toBe(101208156)
    expect(Math.round(dto.summary.outAmount)).toBe(33519716)
  })
  it('마감월은 현재 데이터를 쓰지 않는다 — 출처가 사이드카 2종으로 적힌다', () => {
    expect(dto.closed).toBe(true)
    expect(dto.source).toEqual({ totals: 'monthly_report_totals', rows: 'monthly_snapshots' })
  })
  it('약품 이름·구분·유효기한은 drugs 에서 붙인다', () => {
    const a = dto.list.find(r => r.code === 'AAA')
    expect([a.name, a.category, a.expiry]).toEqual(['가나정', '경구제', '2027-03-01'])
  })
  it('유효기한 없는 약품은 빈 글자이고 맨 뒤로 간다', () => {
    expect(dto.list[dto.list.length - 1].code).toBe('DDD')
    expect(dto.list[dto.list.length - 1].expiry).toBe('')
  })
})

describe('금액은 원본, 수량만 반올림', () => {
  const rows = [
    snap('AAA', { opening_qty: 1038.005, opening_amount: 19800.4, closing_qty: 12.219999999999999, closing_amount: 23760.6 }),
  ]
  const dto = buildMonthlyReportDTO({ closed: true, totals: TOTALS, rows, drugs: DRUGS, year: 2026, month: 9 })
  it('수량은 소수 둘째 자리로 반올림된 값이 담긴다', () => {
    expect(dto.list[0].openingQty).toBe(1038.01)
    expect(dto.list[0].closingQty).toBe(12.22)
  })
  it('★ 금액은 소수까지 그대로 담긴다 — 행마다 1원 반올림하지 않는다', () => {
    expect(dto.list[0].openingAmount).toBe(19800.4)
    expect(dto.list[0].closingAmount).toBe(23760.6)
  })
  it('행별 1원 반올림을 하지 않으므로 합계에 누적 오차가 없다', () => {
    const many = Array.from({ length: 100 }, (_, i) => snap('C' + i, { opening_qty: 1, opening_amount: 0.6 }))
    const d = buildMonthlyReportDTO({ closed: true, totals: TOTALS, rows: many, drugs: [], year: 2026, month: 9 })
    expect(listTotals(d).openingAmount).toBeCloseTo(60, 9)   /* 행별 반올림이면 100 이 된다 */
  })
})

describe('buildMonthlyReportDTO — 미마감월', () => {
  const rows = [
    snap('AAA', { opening_qty: 10, opening_amount: 1000, total_in_qty: 5, total_in_amount: 500, total_out_qty: 2, total_out_amount: 200, closing_qty: 13, closing_amount: 1300 }),
  ]
  const live = { oa: 1000, da: 70, ra: 30, inCnt: 4, outCnt: 6, dispCnt: 1, retCnt: 2 }
  const dto = buildMonthlyReportDTO({
    closed: false, totals: null, rows, drugs: DRUGS, live,
    expiry: { expired: 3, urgent30: 4, caution60: 5, check90: 6 },
    year: 2026, month: 10,
  })
  it('현재 데이터로 계산한다', () => {
    expect(dto.closed).toBe(false)
    expect(dto.summary.opening).toBe(1000)
    expect(dto.summary.inAmount).toBe(500)
    expect(dto.summary.outAmount).toBe(200)
    expect(dto.summary.closing).toBe(1300)
  })
  it('폐기·반품 금액과 건수는 live 에서 온다 (스냅샷에 금액 칸이 없다)', () => {
    expect([dto.summary.dispAmount, dto.summary.retAmount]).toEqual([70, 30])
    expect([dto.summary.inCount, dto.summary.outCount, dto.summary.dispCount, dto.summary.retCount]).toEqual([4, 6, 1, 2])
  })
  it('유효기간 건수는 화면 계산값에서 온다', () => {
    expect([dto.summary.expExpired, dto.summary.expUrgent30, dto.summary.expCaution60, dto.summary.expCheck90]).toEqual([3, 4, 5, 6])
  })
})

describe('같은 데이터면 같은 파일 — 순서가 흔들리지 않는다', () => {
  it('유효기한이 같으면 약품코드로 묶인다', () => {
    const rows = [snap('ZZZ', { closing_qty: 1 }), snap('AAA', { closing_qty: 1 }), snap('MMM', { closing_qty: 1 })]
    const drugs = ['ZZZ', 'AAA', 'MMM'].map(c => ({ drug_code: c, drug_name: c, category: '경구제', expiry_date: '2027-01-01' }))
    const d = buildMonthlyReportDTO({ closed: true, totals: TOTALS, rows, drugs, year: 2026, month: 9 })
    expect(d.list.map(r => r.code)).toEqual(['AAA', 'MMM', 'ZZZ'])
  })
})
