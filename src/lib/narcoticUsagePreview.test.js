/* B-1 — 달력 기준 「계산해 보여주기」. **DB 에 쓰지 않는다.**

   ★ 이 시험이 지키는 것
     ① 창이 **달력**이다 — 그달 1일~말일. 「오늘부터 30일」이 아니다.
     ② 12월·1월 경계에서 해가 바뀌어도 맞다.
     ③ 창 표시가 **하루 밀리지 않는다** (Date→UTC 로 바뀌며 10-01 이 09-30 이 되던 갈래).
     ④ 계산식이 기존 것 그대로다 — 3개월 ÷3, 없으면 전년 ÷12 · ×1.2 올림 · ×3.
     ⑤ 범위가 마약·향정뿐 — 한외마약·일반은 표에 아예 없다.
     ⑥ 「잣대가 섞이는 약품」(3개월 0 · 전년 있음)을 따로 집는다. */
import { describe, it, expect } from 'vitest'
import {
  calendarWindow, windowLabel, sumOutgoing, deriveStock, buildNarcoticPreview,
} from './narcoticUsagePreview'

describe('달력 창', () => {
  it('그달 1일부터 다음달 1일 전까지', () => {
    expect(calendarWindow(2026, 10)).toEqual({
      m1From: '2026-10-01', m3From: '2026-08-01', toExclusive: '2026-11-01',
    })
  })
  it('12월 — 다음 해로 넘어간다', () => {
    expect(calendarWindow(2026, 12)).toEqual({
      m1From: '2026-12-01', m3From: '2026-10-01', toExclusive: '2027-01-01',
    })
  })
  it('1월 — 3개월 창이 지난 해로 간다', () => {
    expect(calendarWindow(2026, 1)).toEqual({
      m1From: '2026-01-01', m3From: '2025-11-01', toExclusive: '2026-02-01',
    })
  })
  it('2월 — 3개월 창이 지난 해 12월', () => {
    expect(calendarWindow(2026, 2).m3From).toBe('2025-12-01')
  })
  it('★ 창 표시가 하루 밀리지 않는다', () => {
    expect(windowLabel(2026, 10)).toEqual({
      m1: '2026-10-01 ~ 2026-10-31', m3: '2026-08-01 ~ 2026-10-31',
    })
  })
  it('말일이 30일·28일인 달도 맞다', () => {
    expect(windowLabel(2026, 9).m1).toBe('2026-09-01 ~ 2026-09-30')
    expect(windowLabel(2026, 2).m1).toBe('2026-02-01 ~ 2026-02-28')
    expect(windowLabel(2026, 12).m1).toBe('2026-12-01 ~ 2026-12-31')
  })
})

describe('출고 합 — 창 밖은 세지 않는다', () => {
  const TX = [
    { drug_code: 'APR2', type: '출고', transaction_date: '2026-10-31', quantity: 91 },
    { drug_code: 'APR2', type: '출고', transaction_date: '2026-09-30', quantity: 87.5 },
    { drug_code: 'APR2', type: '출고', transaction_date: '2026-08-31', quantity: 65 },
    { drug_code: 'APR2', type: '출고', transaction_date: '2026-07-31', quantity: 999 },  /* 창 밖(앞) */
    { drug_code: 'APR2', type: '출고', transaction_date: '2026-11-01', quantity: 777 },  /* 창 밖(뒤) */
    { drug_code: 'APR2', type: '입고', transaction_date: '2026-10-05', quantity: 500 },  /* 출고 아님 */
    { drug_code: 'APR2', type: '폐기', transaction_date: '2026-10-07', quantity: 3 },    /* 출고 아님 */
  ]
  it('1개월은 그달만, 3개월은 석 달만', () => {
    const s = sumOutgoing(TX, 2026, 10).get('APR2')
    expect(s.m1).toBe(91)
    expect(s.m3).toBe(91 + 87.5 + 65)
  })
  it('다음달 1일은 **들어오지 않는다**', () => {
    const s = sumOutgoing([{ drug_code: 'X', type: '출고', transaction_date: '2026-11-01', quantity: 5 }], 2026, 10)
    expect(s.get('X')).toBeUndefined()
  })
  it('그달 1일은 **들어온다**', () => {
    const s = sumOutgoing([{ drug_code: 'X', type: '출고', transaction_date: '2026-10-01', quantity: 5 }], 2026, 10)
    expect(s.get('X').m1).toBe(5)
  })
  it('출고가 아닌 거래는 세지 않는다', () => {
    const only = TX.filter(t => t.type !== '출고')
    expect(sumOutgoing(only, 2026, 10).size).toBe(0)
  })
  it('빈 입력에도 터지지 않는다', () => {
    expect(sumOutgoing(null, 2026, 10).size).toBe(0)
  })
})

describe('계산식 — 기존 것 그대로', () => {
  it('3개월이 있으면 ÷3', () => {
    expect(deriveStock(243.5, 0)).toEqual({ ma: 81, safety: Math.ceil(81 * 1.2), max: 243 })
  })
  it('3개월이 없으면 전년 ÷12', () => {
    expect(deriveStock(0, 152)).toEqual({ ma: 13, safety: Math.ceil(13 * 1.2), max: 39 })
  })
  it('둘 다 없으면 셋 다 비어 있다 — 0 으로 만들지 않는다', () => {
    expect(deriveStock(0, 0)).toEqual({ ma: null, safety: null, max: null })
  })
  it('3개월이 전년을 이긴다', () => {
    expect(deriveStock(300, 9999).ma).toBe(100)
  })
})

/* ── 운영 실제 값 (2026-11-04 실측) ── */
const DRUGS = [
  { drug_code: 'ATV', drug_name: '아티반정1mg', status: '사용', narcotic_type: '향정', current_qty: 242.5, recent_1m_usage: 241.5, recent_3m_usage: 584.5, prev_year_usage: 1742.5, monthly_avg: 195, safety_stock: 234, max_stock: 585 },
  { drug_code: 'APR2', drug_name: '알프람정0.25mg', status: '사용', narcotic_type: '향정', current_qty: 220.5, recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 0, monthly_avg: 51, safety_stock: 62, max_stock: 153 },
  { drug_code: 'MYPC', drug_name: '마이폴캡슐10mg', status: '사용', narcotic_type: '마약', current_qty: 292, recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 152, monthly_avg: 13, safety_stock: 16, max_stock: 39 },
  { drug_code: 'SENTIL5', drug_name: '센틸정5mg', status: '사용', narcotic_type: '향정', current_qty: 96, recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 556, monthly_avg: 46, safety_stock: 56, max_stock: 138 },
  /* ★ 범위 밖 — 표에 **없어야** 한다 */
  { drug_code: 'CHNS', drug_name: '코포나시럽', status: '사용', narcotic_type: '한외마약', recent_1m_usage: 752, recent_3m_usage: 2245, prev_year_usage: 0, monthly_avg: 748, safety_stock: 898, max_stock: 2244 },
  { drug_code: 'GABA', drug_name: '가바로닌캡슐100mg', status: '사용', narcotic_type: '일반', recent_1m_usage: 300, recent_3m_usage: 900, prev_year_usage: 3600, monthly_avg: 300, safety_stock: 360, max_stock: 900 },
]
const TX = [
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-10-31', quantity: 70 },
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-09-30', quantity: 233.5 },
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-08-31', quantity: 182.5 },
  { drug_code: 'APR2', type: '출고', transaction_date: '2026-10-31', quantity: 91 },
  { drug_code: 'APR2', type: '출고', transaction_date: '2026-09-30', quantity: 87.5 },
  { drug_code: 'APR2', type: '출고', transaction_date: '2026-08-31', quantity: 65 },
  { drug_code: 'CHNS', type: '출고', transaction_date: '2026-10-31', quantity: 768 },
  { drug_code: 'GABA', type: '출고', transaction_date: '2026-10-31', quantity: 310 },
]

describe('표 만들기', () => {
  const p = buildNarcoticPreview(DRUGS, TX, 2026, 10)
  it('★ 마약·향정만 담는다 — 한외마약·일반은 아예 없다', () => {
    const codes = p.rows.map(r => r.code)
    expect(codes.sort()).toEqual(['APR2', 'ATV', 'MYPC', 'SENTIL5'])
    expect(codes).not.toContain('CHNS')
    expect(codes).not.toContain('GABA')
  })
  it('창 표시가 함께 온다', () => {
    expect(p.label.m1).toBe('2026-10-01 ~ 2026-10-31')
    expect(p.label.m3).toBe('2026-08-01 ~ 2026-10-31')
  })
  it('아티반정 — 1개월 241.5→70 · 3개월 584.5→486 · 최대 585→486', () => {
    const r = p.rows.find(x => x.code === 'ATV')
    expect([r.m1Before, r.m1After]).toEqual([241.5, 70])
    expect([r.m3Before, r.m3After]).toEqual([584.5, 486])
    expect([r.maBefore, r.maAfter]).toEqual([195, 162])
    expect([r.maxBefore, r.maxAfter]).toEqual([585, 486])
  })
  it('알프람정 — 지금 0 인데 출고가 있어 올라간다 (153→243)', () => {
    const r = p.rows.find(x => x.code === 'APR2')
    expect([r.m1Before, r.m1After]).toEqual([0, 91])
    expect([r.m3Before, r.m3After]).toEqual([0, 243.5])
    expect([r.maxBefore, r.maxAfter]).toEqual([153, 243])
  })
  it('★ 잣대가 섞이는 약품을 따로 집는다 — 3개월 출고 0 · 전년 쓰임 있음', () => {
    expect(p.mixed.map(r => r.code).sort()).toEqual(['MYPC', 'SENTIL5'])
    /* 알프람정은 전년이 0 이라 섞이지 않는다 */
    expect(p.mixed.map(r => r.code)).not.toContain('APR2')
  })
  it('섞이는 약품은 지금 값이 그대로다 — 전년 ÷12 라 바뀌지 않는다', () => {
    const r = p.rows.find(x => x.code === 'MYPC')
    expect(r.maAfter).toBe(r.maBefore)
    expect(r.maxAfter).toBe(r.maxBefore)
    expect(r.moved).toBe(false)
  })
  it('값이 달라지는 약품만 moved 에 담긴다', () => {
    expect(p.moved.map(r => r.code).sort()).toEqual(['APR2', 'ATV'])
  })
  it('값을 잃는 약품을 집는다 — 이 표본에는 없다', () => {
    expect(p.lost).toEqual([])
  })
  it('★ 값을 잃으면 집어낸다', () => {
    const q = buildNarcoticPreview(
      [{ drug_code: 'Z', drug_name: '잃는약', status: '사용', narcotic_type: '향정', recent_1m_usage: 50, recent_3m_usage: 100, prev_year_usage: 0 }],
      [], 2026, 10)
    expect(q.lost.map(r => r.code)).toEqual(['Z'])
  })
  it('합계가 함께 온다', () => {
    expect(p.totals.m1Before).toBe(241.5 + 0 + 0 + 0)
    expect(p.totals.m1After).toBe(70 + 91)
    expect(p.totals.maxBefore).toBe(585 + 153 + 39 + 138)
    expect(p.totals.maxAfter).toBe(486 + 243 + 39 + 138)
  })
  it('사용 약품이 먼저 온다', () => {
    const q = buildNarcoticPreview(
      [...DRUGS, { drug_code: 'STOP', drug_name: '중지약', status: '중지', narcotic_type: '향정', recent_3m_usage: 0, prev_year_usage: 0 }],
      TX, 2026, 10)
    expect(q.rows[q.rows.length - 1].code).toBe('STOP')
  })
  it('빈 입력에도 터지지 않는다', () => {
    const q = buildNarcoticPreview(null, null, 2026, 10)
    expect(q.rows).toEqual([])
    expect(q.totals.maxAfter).toBe(0)
  })
})
