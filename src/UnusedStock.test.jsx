/* 재고현황 「미사용」 — 화면에 붙인 판정·카드·목록·인쇄·엑셀 (2026-11-13 이정화 님 승인)
 *
 * 업무 규칙 — 직전 3개월 **실제 출고**가 0 이면 이유를 묻지 않고 발주·긴급 대상이 아니다.
 *   · 기준 기간 2026-07 부터 · 예외 없음 · 들인 지 3개월 안 된 약은 뺀다 · 현재고 0 은 「재고없음」
 *
 * ★★ 가장 중요한 것 — **DB 값과 상태(status)를 하나도 바꾸지 않는다.**
 *    그래서 유효기한 알림·향정 인쇄·재고금액·보고서가 **그대로** 남는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

/* 가짜 xlsx — 진짜 파일을 쓰지 않고 **무엇을 넘겼는지** 들여다본다 */
const xl = { aoa: null, ws: null, sheet: null, file: null }
vi.mock('xlsx', () => {
  const utils = {
    aoa_to_sheet: (aoa) => { xl.aoa = aoa; xl.ws = {}; for (let r = 0; r < aoa.length; r++) for (let c = 0; c < aoa[r].length; c++) xl.ws[String.fromCharCode(65 + c) + (r + 1)] = { t: 's', v: aoa[r][c] }; return xl.ws },
    encode_cell: ({ c, r }) => String.fromCharCode(65 + c) + (r + 1),
    json_to_sheet: () => ({}),
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    book_append_sheet: (wb, ws, name) => { xl.sheet = name },
  }
  return { utils, writeFile: (wb, name) => { xl.file = name }, default: { utils, writeFile: (wb, name) => { xl.file = name } } }
})

const { StockStatus } = await import('./App.jsx')
const { ThemeCtx } = await import('./lib/theme')
const SRC = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const LIB = readFileSync(resolve(process.cwd(), 'src/lib/unusedStock.js'), 'utf8')

const t = {
  mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', glass: 'rgba(255,255,255,0.9)',
  border: '#E8E6E1', borderH: '#D7D7D7', text: '#2E4A62', textM: '#52524E', textL: '#A3A39E',
  accent: '#804A87', accentL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE',
  amber: '#E65100', amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', yellow: '#FFE082',
  purple: '#804A87', purpleL: '#F5EDF6', mint: '#7FD9A8', coral: '#F39E94', lavender: '#BFA6D9', pink: '#E2A6D4',
  nav: '#2E4A62', navText: '#F7F6F3', navHi: '#BFA6D9',
  shadow: '0 2px 8px rgba(46,74,98,0.06)', shadowH: '0 8px 24px rgba(46,74,98,0.10)',
}

const D = o => ({
  drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 10, safety_stock: 5, max_stock: 30, monthly_avg: 3,
  recent_1m_usage: 1, recent_3m_usage: 3, prev_year_usage: 12,
  purchase_price: 1000, expiry_date: '2028-01-01', atc_code: '', narcotic_type: '일반',
  __unusedOut: 9, __unusedThin: false, ...o,
})
/* ZERO·ZERO2 = 미사용 · USED = 나감 · NEW = 들인 지 얼마 안 됨 · EMPTY = 현재고 0 */
const DRUGS = [
  D({ drug_code: 'USED', drug_name: '출고있는정', __unusedOut: 9 }),
  D({ drug_code: 'ZERO', drug_name: '안나가는정', __unusedOut: 0, current_qty: 10, purchase_price: 2000, max_stock: 30 }),
  D({ drug_code: 'ZERO2', drug_name: '하하안나가는정', __unusedOut: 0, current_qty: 100, purchase_price: 500, max_stock: 30 }),
  D({ drug_code: 'NEW', drug_name: '새로들인정', __unusedOut: 0, __unusedThin: true, safety_stock: 50 }),
  D({ drug_code: 'EMPTY', drug_name: '빈정', __unusedOut: 0, current_qty: 0, safety_stock: 0 }),
]
const INV = []

const chain = () => {
  const c = {}
  for (const k of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'range', 'in']) c[k] = () => c
  c.maybeSingle = () => Promise.resolve({ data: { name: '씨엔씨재활의학과병원' }, error: null })
  c.then = res => Promise.resolve({ data: [], error: null }).then(res)
  return c
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
const open = async (props = {}) => {
  const r = render(<ThemeCtx.Provider value={{ t, mode: 'light', dark: false, toggle: () => {}, user: null, profile: { role: 'owner' }, setProfile: () => {}, logout: () => {}, openSearch: () => {}, open360: () => {} }}>
    <StockStatus drugs={DRUGS} inv={INV} navFilter={null} unusedLatest={{ y: 2026, m: 10 }}
      onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} {...props} />
  </ThemeCtx.Provider>)
  await settle(8)
  return r
}
/* 카드 — 「이름 + 숫자」가 한 상자에 들어 있다 */
const cardNum = (name) => {
  for (const el of document.querySelectorAll('div')) {
    const kids = el.children
    if (kids.length === 2 && kids[0].textContent.trim() === name) return Number(kids[1].textContent.replace(/[^0-9-]/g, ''))
  }
  return null
}
const clickCard = async (name) => {
  for (const el of document.querySelectorAll('div')) {
    const kids = el.children
    if (kids.length === 2 && kids[0].textContent.trim() === name) { await act(async () => { fireEvent.click(el) }); await settle(4); return true }
  }
  return false
}
/* ★ 재고현황에도 「엑셀」 단추가 있다 — **미사용 판 안의 것**만 집어야 한다.
     title 로 가린다(판 안에서만 쓰는 글귀다). */
const btn = name => [...document.querySelectorAll('button')].find(b =>
  b.getAttribute('title') === (name === '엑셀' ? '지금 보이는 줄을 엑셀로 내려받습니다' : 'A4 가로로 인쇄합니다'))

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); from.mockImplementation(() => chain())
  xl.aoa = null; xl.ws = null; xl.sheet = null; xl.file = null
  window.print = vi.fn()
})
afterEach(() => cleanup())

describe('★ ①②③④ 판정 — 무엇이 미사용인가', () => {
  it('① 3개월 실제 출고 0 이면 「미사용」이 된다', async () => {
    await open()
    expect(cardNum('미사용')).toBe(2)          /* ZERO · ZERO2 */
  })
  it('★ ② 들인 지 3개월 안 된 약은 판정에서 빠진다', async () => {
    await open()
    await clickCard('미사용')
    expect(document.body.textContent).not.toContain('새로들인정')
  })
  it('★ ③ 현재고 0 은 「재고없음」으로 남는다', async () => {
    await open()
    expect(cardNum('재고없음')).toBe(1)        /* EMPTY */
    await clickCard('미사용')
    expect(document.body.textContent).not.toContain('빈정')
  })
  it('④ 한 번이라도 나간 약은 미사용이 아니다', async () => {
    await open()
    await clickCard('미사용')
    expect(document.body.textContent).not.toContain('출고있는정')
  })
})

describe('★★ ⑤⑥⑦ 판정 차례와 DB 무변경', () => {
  it('⑤ 「미사용」은 긴급·주문필요보다 **먼저** 판정된다', () => {
    const i = SRC.indexOf('function stockStat(d){')
    const near = SRC.slice(i, i + 700)
    expect(near.indexOf('isUnusedStock(d)')).toBeGreaterThan(0)
    expect(near.indexOf('isUnusedStock(d)')).toBeLessThan(near.indexOf(`return'긴급'`))
    expect(near.indexOf('isUnusedStock(d)')).toBeLessThan(near.indexOf(`return'주문필요'`))
  })
  it('⑥ 기준미설정은 미사용이 덮는다', () => {
    const i = SRC.indexOf('function stockStat(d){')
    const near = SRC.slice(i, i + 700)
    expect(near.indexOf('isUnusedStock(d)')).toBeLessThan(near.indexOf('기준미설정'))
  })
  it('★ ⑦ DB 값을 하나도 바꾸지 않는다 — 판정 길에 쓰기가 없다', () => {
    /* 판정·목록·인쇄·엑셀 어디에도 drugs 를 고치는 호출이 없어야 한다 */
    expect(LIB.includes('update('), '계산 파일이 DB 를 고친다').toBe(false)
    expect(LIB.includes('upsert('), '계산 파일이 DB 를 고친다').toBe(false)
    expect(LIB).toContain('export function isUnused')
  })
  it('★ ⑦-2 상태(status)를 안 건드린다 → 유효기한 알림·향정 인쇄가 그대로다', () => {
    const i = SRC.indexOf('function stockStat(d){')
    const near = SRC.slice(i, i + 700)
    /* ★ 주석에 적힌 글자가 아니라 **코드**를 본다 — d.status 를 읽는지만 가린다 */
    expect(near.includes('d.status'), '판정식이 상태를 본다').toBe(false)
  })
})

describe('★ ⑧⑨⑩⑪⑫ 다른 화면에 번지지 않는다', () => {
  it('⑧ 발주 후보는 긴급·주문필요만 담는다 — 미사용은 안 담긴다', () => {
    expect(SRC).toContain(`stockStat(d) === '긴급' || stockStat(d) === '주문필요'`)
  })
  it('⑨ 대시보드 긴급·주문필요도 같은 판정식을 쓴다', () => {
    expect(SRC).toContain(`shortage: main.filter(d => stockStat(d) === '긴급').length`)
    expect(SRC).toContain(`reorder: main.filter(d => stockStat(d) === '주문필요').length`)
  })
  it('★ ⑩ 유효기한 알림은 상태(MAIN_STATS)로 고른다 — 재고상태를 안 본다', () => {
    expect(SRC).toContain(`e30: drugs.filter(d => d.expiry_date && d.expiry_date <= fmt(d30) && MAIN_STATS.includes(d.status)).length`)
  })
  it('★ ⑪ 향정 인쇄는 마약구분으로 고른다 — 재고상태를 안 본다', () => {
    expect(SRC).toContain(`const base=drugs.filter(d=>isN(d))`)
  })
  it('⑫ 재고금액 총액은 상태로 고른다 — 재고상태를 안 본다', () => {
    expect(SRC).toContain(`const totalAmt = drugs.filter(d => ['사용', '휴면', '중지'].includes(d.status))`)
  })
})

describe('★★ ⑬ 카드 합 = 전체', () => {
  it('★ ⑬ 카드 숫자를 모두 더하면 「전체」와 같다 — 어디에도 안 잡히는 약이 없다', async () => {
    await open()
    const total = cardNum('전체')
    const parts = ['긴급', '주문필요', '재고없음', '정상', '과잉', '미사용', '기준미설정']
      .map(k => cardNum(k))
    for (const [i, v] of parts.entries()) expect(v, parts[i] + ' 카드가 없다').not.toBeNull()
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
  })
  it('⑬-2 「미사용」 카드가 있다', async () => {
    await open()
    expect(cardNum('미사용')).not.toBeNull()
  })
})

describe('★ ⑭⑮ 단계 칩', () => {
  it('★ ⑭ 기록이 모자란 단계는 못 누른다', async () => {
    await open()
    await clickCard('미사용')
    const three = screen.getByRole('button', { name: /^3개월 \d+종$/ })
    expect(three.disabled).toBe(false)
    for (const k of ['6개월', '1년']) {
      const b = screen.getByRole('button', { name: k + ' 준비 중' })
      expect(b.disabled, k + ' 이 눌린다').toBe(true)
    }
  })
  it('★ ⑮ 6개월은 2026-12 마감 뒤, 1년은 2027-06 마감 뒤에 열린다', async () => {
    cleanup()
    await open({ unusedLatest: { y: 2026, m: 12 } })
    await clickCard('미사용')
    expect(screen.getByRole('button', { name: /^6개월 \d+종$/ }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: '1년 준비 중' }).disabled).toBe(true)
    cleanup()
    await open({ unusedLatest: { y: 2027, m: 6 } })
    await clickCard('미사용')
    expect(screen.getByRole('button', { name: /^1년 \d+종$/ }).disabled).toBe(false)
  })
  it('⑭-2 안내 한 줄이 있다', async () => {
    await open()
    await clickCard('미사용')
    expect(document.body.textContent).toContain('6개월은 2026년 12월 마감 뒤, 1년은 2027년 6월 마감 뒤')
  })
})

describe('★ ⑯⑰ 목록 — 금액 순·과잉 뱃지·상태 열', () => {
  it('★ ⑯ 재고금액 큰 순으로 줄을 세운다', async () => {
    await open()
    await clickCard('미사용')
    /* ZERO2 = 100 × 500 = 50,000 · ZERO = 10 × 2,000 = 20,000 */
    const txt = document.body.textContent
    expect(txt.indexOf('하하안나가는정')).toBeLessThan(txt.indexOf('안나가는정</') === -1 ? txt.lastIndexOf('안나가는정') : txt.indexOf('안나가는정</'))
    expect(txt).toContain('50,000')
    expect(txt).toContain('20,000')
  })
  it('⑰ 과잉 뱃지는 최대재고를 넘은 약에만 붙는다', async () => {
    await open()
    await clickCard('미사용')
    /* ZERO2(100 > 30) 만 과잉 · ZERO(10 < 30) 은 아니다 */
    expect(document.body.textContent).toContain('과잉')
  })
  it('⑰-2 상태 열이 있다', async () => {
    await open()
    await clickCard('미사용')
    const heads = [...document.querySelectorAll('th')].map(x => x.textContent)
    expect(heads).toContain('상태')
    expect(heads).toContain('재고금액')
  })
})

describe('★ ⑱ 색·라이브러리', () => {
  it('⑱ 새 색을 만들지 않았다 — 미사용은 기존 회색을 쓴다', () => {
    expect(SRC).toContain(`(s==='기준미설정'||s==='미사용')?t.textL:t.green`)
    const hex = [...new Set((LIB.match(/#[0-9A-Fa-f]{3,8}/g) || []))]
    expect(hex, '계산 파일에 색이 들어갔다').toEqual([])
  })
  it('⑱-2 새 라이브러리를 들여오지 않았다 — 엑셀은 이미 있는 xlsx', () => {
    expect(SRC).toContain(`await import('xlsx')`)
    const froms = [...(LIB.match(/^import .*$/gm) || []).join('\n').matchAll(/from '([^']+)'/g)].map(m => m[1])
    expect(froms, '계산 파일은 아무것도 안 들여온다').toEqual([])
  })
})

describe('★★ 인쇄·엑셀 — 읽기만 한다', () => {
  it('엑셀 11열 머리말이 정확하고 반품검토·비고는 빈칸이다', async () => {
    await open()
    await clickCard('미사용')
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(8)
    expect(xl.aoa[0]).toEqual(['약품코드', '약품명', '구분', '상태', '현재고', '구입단가', '재고금액', '과잉', '유효기한', '반품검토', '비고'])
    for (const r of xl.aoa.slice(1)) { expect(r[9]).toBe(''); expect(r[10]).toBe('') }
    expect(xl.ws.A2.t).toBe('s')
    expect(xl.ws.A2.z).toBe('@')
    expect(xl.file).toMatch(/^미사용_3개월_\d{8}\.xlsx$/)
    expect(xl.sheet).toBe('미사용3개월')
  })
  it('★ 엑셀·인쇄를 눌러도 DB 로 아무것도 가지 않는다', async () => {
    await open()
    await clickCard('미사용')
    const before = from.mock.calls.length
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(6)
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(rpc).not.toHaveBeenCalled()
    expect(from.mock.calls.length).toBe(before)
    expect(window.print).toHaveBeenCalled()
  })
  it('인쇄본에 제목·서명란·쪽 번호·반품검토 네모가 있다', async () => {
    await open()
    await clickCard('미사용')
    const prn = document.querySelector('.ps-print')
    expect(prn, '인쇄 블록이 없다').toBeTruthy()
    expect(prn.textContent).toContain('미사용 — 반품·폐기 검토 리스트')
    expect(prn.querySelector('.ps-sign').textContent).toContain('검토자')
    expect(prn.querySelector('.ps-ft').textContent).toMatch(/^\d+ \/ \d+$/)
    expect(prn.textContent).toContain('□반품')
    expect(prn.textContent).toContain('□폐기')
    expect(prn.textContent).toContain('□보류')
  })
  it('★ 인쇄 규칙이 다른 화면에 번지지 않는다 — @page 는 누를 때만', async () => {
    await open()
    await clickCard('미사용')
    const styles = () => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    expect(styles()).toContain('.ps-print')
    expect(styles().includes('@page'), '누르지도 않았는데 @page 가 있다').toBe(false)
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(styles()).toContain('@page{size:A4 landscape')
  })
  it('★ 줄 수를 셀 때 서명 칸이 섞이지 않는다', () => {
    const PS = readFileSync(resolve(process.cwd(), 'src/lib/printSheet.js'), 'utf8')
    expect(PS).toContain(`el.querySelectorAll('.ps-main tbody tr')`)
    expect(PS).toContain(`hOf('.ps-main thead')`)
  })
})
