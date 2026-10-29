/* 수요 현황 계산 — 가림표시 · 도즈 · 날짜별 누적 · 알림 띠 · 파기 조건 · 기본 체크
   ★ D·A·R·S·G·O 의 정본은 DB 뷰다. 이 파일은 화면 쪽 계산만 본다. */
import { describe, it, expect } from 'vitest'
import {
  maskEmpNo, maskName, doseOf, doneOf, pendingOf,
  cumulativeDemand, firstShortDate, shortDate,
  alertLine, needsPurge, canPurge, defaultCategoryIds, byDateSummary,
  nameKeyOf, dupNameKeys, rowNote,
} from './surveyCalc'

const R = (o = {}) => ({
  status: 'applied', self_dose: true, family_count: 0,
  done_self: false, done_family: 0, wish_date: '2026-11-03', ...o,
})

describe('개인정보 가림', () => {
  it('사번 — 앞 2 · 뒤 2 만 남긴다', () => {
    expect(maskEmpNo('123456')).toBe('12**56')
    expect(maskEmpNo('12345')).toBe('12*45')
    expect(maskEmpNo('1234')).toBe('1**4')
    expect(maskEmpNo('123')).toBe('1*3')
    expect(maskEmpNo('12')).toBe('**')
    expect(maskEmpNo('1')).toBe('*')
  })
  it('사번이 없으면 —', () => {
    expect(maskEmpNo(null)).toBe('—')
    expect(maskEmpNo('')).toBe('—')
    expect(maskEmpNo('   ')).toBe('—')
  })
  it('성명 — 가운데를 가린다', () => {
    expect(maskName('김정화')).toBe('김*화')
    expect(maskName('김수현아')).toBe('김**아')
    expect(maskName('김수')).toBe('김*')
    expect(maskName('김')).toBe('김')
  })
  it('★ 파기된 행의 (파기) 는 가리지 않는다 — 가릴 개인정보가 없다', () => {
    expect(maskName('(파기)')).toBe('(파기)')
  })
  it('성명이 없으면 —', () => {
    expect(maskName(null)).toBe('—')
    expect(maskName('')).toBe('—')
  })
  it('★ 가린 값에 원문 글자가 2자 넘게 남지 않는다', () => {
    for (const n of ['김정화', '박영수철', '최윤서하늘']) {
      const m = maskName(n)
      const kept = [...m].filter(c => c !== '*').length
      expect(kept).toBeLessThanOrEqual(2)
    }
  })
})

describe('도즈', () => {
  it('본인 1 + 가족 수', () => {
    expect(doseOf(R({ self_dose: true, family_count: 2 }))).toBe(3)
    expect(doseOf(R({ self_dose: false, family_count: 2 }))).toBe(2)
    expect(doseOf(R({ self_dose: true, family_count: 0 }))).toBe(1)
  })
  it('명단 체크 합', () => {
    expect(doneOf(R({ done_self: true, done_family: 2 }))).toBe(3)
    expect(doneOf(R({ done_self: false, done_family: 0 }))).toBe(0)
  })
  it('아직 접종하지 않은 도즈 — 음수가 되지 않는다', () => {
    expect(pendingOf(R({ self_dose: true, family_count: 2, done_self: true, done_family: 1 }))).toBe(1)
    expect(pendingOf(R({ self_dose: true, family_count: 2, done_self: true, done_family: 2 }))).toBe(0)
    /* 체크가 신청보다 많아도 0 (데이터가 어긋난 경우) */
    expect(pendingOf({ self_dose: false, family_count: 0, done_self: true, done_family: 5 })).toBe(0)
  })
  it('빈 값도 안전하다', () => {
    expect(doseOf(null)).toBe(0)
    expect(doneOf(undefined)).toBe(0)
  })
})

describe('날짜별 누적 수요', () => {
  const today = '2026-11-01'
  it('희망일별로 쌓고 누적을 낸다', () => {
    const s = cumulativeDemand([
      R({ wish_date: '2026-11-03', family_count: 2 }),   /* 3 */
      R({ wish_date: '2026-11-03', family_count: 0 }),   /* 1 */
      R({ wish_date: '2026-11-05', family_count: 4 }),   /* 5 */
    ], 100, today)
    expect(s).toEqual([
      { date: '2026-11-03', add: 4, cum: 4, short: false },
      { date: '2026-11-05', add: 5, cum: 9, short: false },
    ])
  })
  it('★ 희망일이 지난 미접종분은 오늘로 합산한다', () => {
    const s = cumulativeDemand([
      R({ wish_date: '2026-10-20', family_count: 1 }),   /* 2 — 지났다 */
      R({ wish_date: '2026-11-01', family_count: 0 }),   /* 1 — 오늘 */
      R({ wish_date: '2026-11-04', family_count: 0 }),   /* 1 */
    ], 100, today)
    expect(s[0]).toEqual({ date: '2026-11-01', add: 3, cum: 3, short: false })
    expect(s[1].date).toBe('2026-11-04')
  })
  it('취소된 신청은 세지 않는다', () => {
    const s = cumulativeDemand([
      R({ wish_date: '2026-11-03', family_count: 9, status: 'cancelled' }),
      R({ wish_date: '2026-11-03', family_count: 0 }),
    ], 100, today)
    expect(s).toEqual([{ date: '2026-11-03', add: 1, cum: 1, short: false }])
  })
  it('이미 접종 체크된 분은 빠진다', () => {
    const s = cumulativeDemand([
      R({ wish_date: '2026-11-03', family_count: 2, done_self: true, done_family: 2 }),
      R({ wish_date: '2026-11-03', family_count: 1 }),
    ], 100, today)
    expect(s).toEqual([{ date: '2026-11-03', add: 2, cum: 2, short: false }])
  })
  it('★ 누적이 잔량을 넘는 날에 short 가 켜진다', () => {
    const s = cumulativeDemand([
      R({ wish_date: '2026-11-02', family_count: 9 }),   /* 10, 누적 10 */
      R({ wish_date: '2026-11-03', family_count: 9 }),   /* 10, 누적 20 */
      R({ wish_date: '2026-11-04', family_count: 9 }),   /* 10, 누적 30 */
    ], 15, today)
    expect(s.map(p => p.short)).toEqual([false, true, true])
    expect(firstShortDate(s)).toBe('2026-11-03')
  })
  it('잔량이 넉넉하면 부족한 날이 없다', () => {
    const s = cumulativeDemand([R({ family_count: 1 })], 100, today)
    expect(firstShortDate(s)).toBe(null)
  })
  it('잔량과 정확히 같으면 부족이 아니다 (초과만 부족)', () => {
    const s = cumulativeDemand([R({ wish_date: '2026-11-03', family_count: 9 })], 10, today)
    expect(s[0]).toMatchObject({ cum: 10, short: false })
  })
  it('빈 입력도 안전하다', () => {
    expect(cumulativeDemand([], 10, today)).toEqual([])
    expect(cumulativeDemand(null, 10, today)).toEqual([])
    expect(firstShortDate(null)).toBe(null)
  })
  it('희망일이 없는 행은 건너뛴다', () => {
    expect(cumulativeDemand([R({ wish_date: null })], 10, today)).toEqual([])
  })
})

describe('shortDate', () => {
  it('11/4 꼴로 줄인다', () => {
    expect(shortDate('2026-11-04')).toBe('11/4')
    expect(shortDate('2026-01-01')).toBe('1/1')
  })
  it('형식이 아니면 그대로', () => {
    expect(shortDate('x')).toBe('x')
    expect(shortDate(null)).toBe('')
  })
})

describe('알림 띠', () => {
  it('충분이면 띠를 띄우지 않는다', () => {
    expect(alertLine({ demand_status: '충분', balance_qty: 100, remain_qty: 10, order_qty: 0 })).toBe(null)
    expect(alertLine(null)).toBe(null)
  })
  it('★ 부족 — 지시서 형식 그대로', () => {
    expect(alertLine({ demand_status: '부족', balance_qty: 31, remain_qty: 60, order_qty: 40 }))
      .toBe('부족 · 잔량 31 < 남은 수요 60 · 주문 권장 40도즈')
  })
  it('주의 — 잔량이 남은 수요보다 크거나 같다', () => {
    expect(alertLine({ demand_status: '주의', balance_qty: 62, remain_qty: 60, order_qty: 10 }))
      .toBe('주의 · 잔량 62 ≥ 남은 수요 60 · 주문 권장 10도즈')
  })
})

describe('파기 조건', () => {
  const sv = (o = {}) => ({ status: 'closed', vax_end: '2026-11-30', purged_at: null, ...o })
  it('닫히고 끝날이 지나야 누를 수 있다', () => {
    expect(canPurge(sv(), '2026-12-01')).toBe(true)
    expect(canPurge(sv(), '2026-11-30')).toBe(false)     /* 끝날 당일은 아직 */
    expect(canPurge(sv({ status: 'open' }), '2026-12-01')).toBe(false)
    expect(canPurge(sv({ status: 'draft' }), '2026-12-01')).toBe(false)
  })
  it('이미 파기했으면 다시 누를 수 없다', () => {
    expect(canPurge(sv({ purged_at: '2026-12-02T00:00:00Z' }), '2026-12-03')).toBe(false)
  })
  it('안내 띠 — 끝날이 지났는데 파기 전이면 띄운다', () => {
    expect(needsPurge(sv(), '2026-12-01')).toBe(true)
    expect(needsPurge(sv({ status: 'open' }), '2026-12-01')).toBe(true)   /* 닫지 않아도 알린다 */
    expect(needsPurge(sv(), '2026-11-30')).toBe(false)
    expect(needsPurge(sv({ purged_at: 'x' }), '2026-12-01')).toBe(false)
    expect(needsPurge(null, '2026-12-01')).toBe(false)
  })
})

describe('회차 기본 체크 분류', () => {
  const cats = [
    { id: 'c1', label: '직원(무료)' },
    { id: 'c2', label: '직원가족&간병사(30000)' },
    { id: 'c3', label: '외래&입원(35000)' },
  ]
  it('★ 「직원」으로 시작하는 분류만 기본 체크하고 외래&입원은 해제', () => {
    expect(defaultCategoryIds(cats)).toEqual(['c1', 'c2'])
  })
  it('「직원」이 하나도 없으면 전부 체크한다(고를 거리를 남긴다)', () => {
    expect(defaultCategoryIds([{ id: 'x', label: '65~69세' }])).toEqual(['x'])
  })
  it('빈 목록도 안전하다', () => {
    expect(defaultCategoryIds([])).toEqual([])
    expect(defaultCategoryIds(null)).toEqual([])
  })
})

describe('날짜별 집계 (엑셀·PDF 공용)', () => {
  it('인원·도즈·체크·취소를 날짜별로 센다', () => {
    const out = byDateSummary([
      R({ wish_date: '2026-11-03', family_count: 2, done_self: true }),
      R({ wish_date: '2026-11-03', family_count: 0 }),
      R({ wish_date: '2026-11-03', status: 'cancelled', family_count: 5 }),
      R({ wish_date: '2026-11-02', family_count: 1 }),
    ])
    expect(out).toEqual([
      { date: '2026-11-02', people: 1, dose: 2, done: 0, cancelled: 0 },
      { date: '2026-11-03', people: 2, dose: 4, done: 1, cancelled: 1 },
    ])
  })
  it('취소는 인원·도즈에서 빠진다', () => {
    const out = byDateSummary([R({ status: 'cancelled', family_count: 9 })])
    expect(out[0]).toMatchObject({ people: 0, dose: 0, cancelled: 1 })
  })
  it('날짜순으로 정렬한다', () => {
    const out = byDateSummary([R({ wish_date: '2026-12-01' }), R({ wish_date: '2026-11-01' })])
    expect(out.map(x => x.date)).toEqual(['2026-11-01', '2026-12-01'])
  })
})

/* ── 비고 — 행 단위 자동 표기 ───────────────────────────────────────────── */
describe('nameKeyOf — DB 의 name_key 가 정본', () => {
  it('name_key 가 있으면 그 값을 쓴다', () => {
    expect(nameKeyOf({ name_key: '김정화', name: '다른이름' })).toBe('김정화')
  })
  it('name_key 가 없으면 성명에서 같은 규칙으로 만든다 (공백 제거·소문자)', () => {
    expect(nameKeyOf({ name: '  김 정 화 ' })).toBe('김정화')
    expect(nameKeyOf({ name: 'Kim HyeJin' })).toBe('kimhyejin')
  })
  it('둘 다 없으면 빈 문자열', () => {
    expect(nameKeyOf({})).toBe('')
    expect(nameKeyOf(null)).toBe('')
  })
})

describe('dupNameKeys — 회차 전체에서 겹치는 이름', () => {
  it('2건 이상인 키만 담는다', () => {
    const d = dupNameKeys([
      R({ name_key: '김정화' }), R({ name_key: '김정화' }), R({ name_key: '박영수' }),
    ])
    expect([...d]).toEqual(['김정화'])
  })
  it('취소 행은 중복 판정에서 뺀다 — 상태 열에 이미 드러난다', () => {
    const d = dupNameKeys([
      R({ name_key: '김정화' }), R({ name_key: '김정화', status: 'cancelled' }),
    ])
    expect(d.size).toBe(0)
  })
  it('빈 키는 담지 않는다 — 파기 후 이름이 없는 행끼리 묶이면 안 된다', () => {
    const d = dupNameKeys([R({ name_key: '', name: '' }), R({ name_key: '', name: '' })])
    expect(d.size).toBe(0)
  })
  it('목록이 없어도 터지지 않는다', () => {
    expect(dupNameKeys(null).size).toBe(0)
  })
})

describe('rowNote — 4가지 경우', () => {
  const dup = new Set(['김정화'])
  it('해당 없음 → 빈칸', () => {
    expect(rowNote(R({ emp_no: '123456', name_key: '박영수' }), dup)).toBe('')
  })
  it('사번 미입력', () => {
    expect(rowNote(R({ emp_no: null, name_key: '박영수' }), dup)).toBe('사번 미입력')
    expect(rowNote(R({ emp_no: '   ', name_key: '박영수' }), dup)).toBe('사번 미입력')
  })
  it('동일 성명 확인 필요', () => {
    expect(rowNote(R({ emp_no: '123456', name_key: '김정화' }), dup)).toBe('동일 성명 확인 필요')
  })
  it('둘 다 → 「사번 없음 · 이름 중복」', () => {
    expect(rowNote(R({ emp_no: null, name_key: '김정화' }), dup)).toBe('사번 미입력 · 동일 성명 확인 필요')
  })
  it('중복 집합을 안 주면 사번만 본다', () => {
    expect(rowNote(R({ emp_no: null, name_key: '김정화' }))).toBe('사번 미입력')
  })
})
