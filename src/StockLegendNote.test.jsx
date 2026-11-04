/* 재고현황 범례 — 「전체」 카드가 보고서 관리 품목수와 **기준이 다르다**고 알린다.

   ★ 왜 (2026-11-04 진단)
     재고현황 「전체」 531 과 보고서 「관리 품목수」 530 이 달라 보여 조사 요청이 왔다.
     둘 다 맞는 숫자였고, **묻는 것이 달랐다**:
       재고현황 전체 = 사용·휴면 품목 (재고 0 **포함**)
       보고서 품목수 = 재고가 남은 품목 (상태 **무관** — 중지도 센다)
     531 − (사용인데 재고 0) 2종 + (재고 있는 중지) 1종 = 530 으로 딱 맞았다.
     보고서 화면에는 이미 설명이 있는데 재고현황에는 없어서, 같은 줄에 한 조각을 더했다.

   ★ 고정하는 것 — 글자 크기·색·굵기가 **기존 범례와 똑같다**(새 색 없음). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const mk = (code, status, qty, sf) => ({
  drug_code: code, drug_name: code + '약', category: '경구제', status,
  current_qty: qty, safety_stock: sf, max_stock: 300, purchase_price: 100,
  prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100,
  recent_1m_usage: 50, usage_source: 'manual', expiry_date: '2027-06-01',
})
/* 운영과 같은 모양 — 사용 2 · 휴면 1 · 중지 1(재고 있음) */
const DRUGS = [mk('USE1', '사용', 100, 10), mk('USE0', '사용', 0, 0), mk('HYU', '휴면', 50, 5), mk('STOP', '중지', 59, 5)]

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const q = {
    select: () => q, in: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
    range: () => result([]), limit: () => result([]), maybeSingle: () => result(null),
    insert: () => result(null), upsert: () => result(null), update: () => q, delete: () => q,
    then(res) { return result([]).then(res) },
  }
  return { supabase: { from: () => q, rpc: () => result(0), auth: { getUser: () => result(null) } } }
})
const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, setTheme: () => {}, memberRole: 'owner', profile: { role: 'user' } }) }
})

let StockStatus
beforeEach(async () => { if (!StockStatus) StockStatus = (await import('./App.jsx')).StockStatus })
afterEach(() => cleanup())

const open = async () => {
  render(<StockStatus drugs={DRUGS} inv={[]} navFilter={null}
    onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
}
/* 범례 조각 — 기존 급변 설명이 든 <span> */
const legend = () => [...document.querySelectorAll('span')]
  .filter(s => /급증\(월평균/.test(s.textContent))
  .sort((a, b) => a.textContent.length - b.textContent.length)[0]

describe('범례 안내 줄', () => {
  it('기존 급변 설명이 그대로 있다', async () => {
    await open()
    const txt = legend().textContent
    expect(txt).toContain('▲ 급증(월평균 1.5배 초과)')
    expect(txt).toContain('▼ 급감(0.5배 미만)')
    expect(txt).toContain('? 확인 필요')
  })
  it('★ 「전체」의 기준을 알린다', async () => {
    await open()
    expect(legend().textContent).toContain('전체 = 사용·휴면 품목(재고 0 포함)')
  })
  it('★ 보고서와 기준이 다르다고 알린다', async () => {
    await open()
    expect(legend().textContent).toContain('보고서 관리 품목수와 기준이 다릅니다')
  })
  it('★ 같은 한 줄 안에 있다 — 줄을 새로 만들지 않았다', async () => {
    await open()
    const all = [...document.querySelectorAll('span')]
      .filter(s => /보고서 관리 품목수와 기준이 다릅니다/.test(s.textContent))
      .filter(s => !s.querySelector('span'))
    expect(all.length, '안내가 든 말단 span 은 하나뿐이다').toBe(1)
    expect(all[0].textContent).toMatch(/^▲ 급증/)
  })
  it('★ 글자 크기·색·굵기가 기존 범례 그대로다 (새 색 없음)', async () => {
    await open()
    const st = legend().style
    expect(st.fontSize, '10px').toBe('10px')
    expect(st.fontWeight, '500').toBe('500')
    /* t.textM — 흰 배경에서 7.9:1. t.textL(2.5:1) 로 바꾸지 않았다 */
    expect(st.color.replace(/\s/g, '')).toBe('rgb(82,82,78)')
  })
})

describe('카드 숫자는 그대로다 — 문구만 더했다', () => {
  it('「전체」는 사용·휴면 품목 수 (재고 0 포함)', async () => {
    await open()
    const all = [...document.querySelectorAll('div')]
      .find(d => d.textContent.trim() === '전체' && d.nextElementSibling)
    expect(all.nextElementSibling.textContent, '사용 2 + 휴면 1 = 3').toBe('3')
  })
  it('재고 0 인 「사용」 약품도 전체에 들어간다', async () => {
    await open()
    expect(document.body.textContent).toContain('USE0약')
  })
  it('「중지」는 전체에 안 들어간다 — 보고서에는 들어간다(기준이 다르다)', async () => {
    await open()
    expect(document.body.textContent).not.toContain('STOP약')
  })
})
