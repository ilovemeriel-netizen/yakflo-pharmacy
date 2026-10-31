/* 재고현황 — 사용량 출처 표시.

   ★ 왜 바꿨나
     이 약제과에서는 최근3개월·최근1개월 사용량이 **원내 프로그램 값이 정본**이다.
     대부분 양식 업로드로 넣고, 향정·마약(매월)·시즌 백신·처방 없이 나가는 일반약 몇 개·
     약품외 품목은 수기로 보충한다. 출고 자동집계는 거의 쓰지 않는다.
     그래서 「수기」는 **예외가 아니라 정상 경로**다(실측 651줄 중 648줄). 감사·규정상
     표시 의무도 없다. 띄워 둘 이유가 없어 뗐다.
     남는 것은 **출고 자동집계로 채워진 값**뿐이다(실측 3줄) — 그건 원내 프로그램 값이
     아니므로 눈에 띄어야 한다.

   ★ 고정하는 것
     ① 수기(manual) 값에는 뱃지가 **없다**
     ② 자동(auto) 값에만 「자동」 뱃지 + 툴팁
     ③ usage_source 가 비었으면 뱃지 없음
     ④ 월평균 값·다른 열은 그대로
     ⑤ 머리글 툴팁 문구(모양은 불변 — title 만) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const DRUGS = [
  { drug_code: 'MAN', drug_name: '수기약', category: '경구제', status: '사용',
    current_qty: 100, safety_stock: 10, max_stock: 300, purchase_price: 100,
    prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100, recent_1m_usage: 90,
    usage_source: 'manual', expiry_date: '2027-06-01' },
  { drug_code: 'AUT', drug_name: '자동약', category: '외용제', status: '사용',
    current_qty: 50, safety_stock: 5, max_stock: 150, purchase_price: 200,
    prev_year_usage: 600, recent_3m_usage: 150, monthly_avg: 50, recent_1m_usage: 40,
    usage_source: 'auto', expiry_date: '2027-07-01' },
  { drug_code: 'NUL', drug_name: '출처없는약', category: '주사제', status: '사용',
    current_qty: 20, safety_stock: 2, max_stock: 60, purchase_price: 300,
    prev_year_usage: 240, recent_3m_usage: 60, monthly_avg: 20, recent_1m_usage: 15,
    usage_source: null, expiry_date: '2027-08-01' },
]

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const q = {
    select: () => q, in: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
    range: () => result([]), limit: () => result([]), maybeSingle: () => result(null),
    insert: () => result(null), upsert: () => result(null), update: () => q, delete: () => q,
    then(res) { return result([]).then(res) },
  }
  return { supabase: { from: () => q, rpc: () => result(null), auth: { getUser: () => result(null) } } }
})

const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, memberRole: 'owner', setTheme: () => {} }) }
})

let StockStatus
beforeEach(async () => {
  if (!StockStatus) StockStatus = (await import('./App.jsx')).StockStatus
})
afterEach(() => cleanup())

const open = () => render(<StockStatus drugs={DRUGS} inv={[]} navFilter={null}
  onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)

const rowOf = code => [...document.querySelectorAll('tbody tr')]
  .find(tr => (tr.querySelector('td') || {}).textContent?.startsWith(code))
/* 월평균 칸 = 머리글 차례에서 찾는다(번호를 박아 두면 열이 끼었을 때 조용히 어긋난다) */
const colIndex = label => [...document.querySelectorAll('thead th')]
  .findIndex(th => th.textContent.replace(/[⇅▲▼✓\s]/g, '') === label.replace(/\s/g, ''))
const cellOf = (code, label) => [...rowOf(code).querySelectorAll('td')][colIndex(label)]
const thOf = label => [...document.querySelectorAll('thead th')]
  .find(th => th.textContent.replace(/[⇅▲▼✓\s]/g, '') === label.replace(/\s/g, ''))

async function ready() {
  open()
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
}

describe('① 수기 값에는 뱃지를 띄우지 않는다', () => {
  it('★ manual 줄에 「수기」가 없다', async () => {
    await ready()
    const cell = cellOf('MAN', '월평균')
    expect(cell.textContent).toContain('100')
    expect(cell.textContent, '수기 뱃지는 사라졌다').not.toContain('수기')
    expect(cell.querySelector('span[title]'), '툴팁 달린 뱃지도 없다').toBeNull()
  })
  it('★ 화면 어디에도 「수기」 뱃지가 없다', async () => {
    await ready()
    const badges = [...document.querySelectorAll('tbody span')]
      .filter(s => s.textContent.trim() === '수기')
    expect(badges.length).toBe(0)
  })
  it('usage_source 가 비어 있어도 뱃지가 없다', async () => {
    await ready()
    const cell = cellOf('NUL', '월평균')
    expect(cell.textContent).toContain('20')
    expect(cell.querySelector('span[title]')).toBeNull()
  })
})

describe('② 자동 값에만 「자동」 뱃지', () => {
  it('★ auto 줄에 「자동」 뱃지와 툴팁이 있다', async () => {
    await ready()
    const cell = cellOf('AUT', '월평균')
    const badge = [...cell.querySelectorAll('span')].find(s => s.textContent.trim() === '자동')
    expect(badge, '「자동」 뱃지').toBeTruthy()
    expect(badge.getAttribute('title'))
      .toBe('출고 기록 자동 계산값')
  })
  it('뱃지 모양은 쓰던 그대로다 — 새 색 없음', async () => {
    await ready()
    const badge = [...cellOf('AUT', '월평균').querySelectorAll('span')]
      .find(s => s.textContent.trim() === '자동')
    const s = badge.style
    expect(s.fontSize).toBe('8px')
    expect(s.fontWeight).toBe('700')
    expect(s.borderRadius).toBe('4px')
    expect(s.padding).toBe('1px 5px')
    /* 색은 기존 파랑 토큰 — jsdom 은 hex 를 rgb 로 돌려준다 */
    expect(s.color).toBe('rgb(46, 74, 98)')
  })
  it('월평균이 없으면 자동이라도 뱃지가 없다 — 기존 조건 그대로', async () => {
    cleanup()
    const noAvg = [{ ...DRUGS[1], drug_code: 'AU0', monthly_avg: null }]
    render(<StockStatus drugs={noAvg} inv={[]} navFilter={null}
      onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const cell = cellOf('AU0', '월평균')
    expect([...cell.querySelectorAll('span')].some(s => s.textContent.trim() === '자동')).toBe(false)
  })
})

describe('③ 머리글 툴팁 — 모양은 그대로, title 만', () => {
  it('최근3개월사용량', async () => {
    await ready()
    expect(thOf('최근3개월사용량').getAttribute('title'))
      .toBe('원내 프로그램 기준값')
  })
  it('직전1개월사용량', async () => {
    await ready()
    expect(thOf('직전1개월사용량').getAttribute('title'))
      .toBe('원내 프로그램 기준값')
  })
  it('다른 머리글에는 툴팁을 붙이지 않았다', async () => {
    await ready()
    for (const h of ['약품코드', '약품명', '월평균', '현재고']) {
      expect(thOf(h).getAttribute('title'), h).toBeFalsy()
    }
  })
})

describe('④ 값과 다른 열은 그대로', () => {
  it('월평균 숫자가 바뀌지 않았다', async () => {
    await ready()
    expect(cellOf('MAN', '월평균').textContent.trim()).toBe('100')
    expect(cellOf('NUL', '월평균').textContent.trim()).toBe('20')
    expect(cellOf('AUT', '월평균').textContent).toContain('50')
  })
  it('직전1개월 칸에는 뱃지를 넣지 않았다', async () => {
    await ready()
    for (const code of ['MAN', 'AUT', 'NUL']) {
      const cell = cellOf(code, '직전1개월사용량')
      expect(cell.textContent, code).not.toContain('자동')
      expect(cell.textContent, code).not.toContain('수기')
    }
  })
  it('머리글 14칸 = 모든 줄 14칸 (함정 #27)', async () => {
    await ready()
    const n = document.querySelectorAll('thead th').length
    expect(n).toBe(14)
    for (const tr of document.querySelectorAll('tbody tr')) {
      expect(tr.querySelectorAll('td').length).toBe(n)
    }
  })
})
