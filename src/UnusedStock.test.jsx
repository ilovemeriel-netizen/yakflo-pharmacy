/* 재고현황 「3개월 이상 사용량 0」 — 화면에 붙인 판정·카드·단계 칩·목록·인쇄·엑셀
 * (2026-11-13 승인 · 2026-11-14 단계 3/6/9/12개월로 넓힘 — 이정화 님 결정)
 *
 * 업무 규칙 — 직전 3개월 **실제 출고**가 0 이면 이유를 묻지 않고 발주·긴급 대상이 아니다.
 *   · 예외 없음 · 창에 마감 줄이 모자란 약은 뺀다 · 현재고 0 은 「재고없음」
 *   · 단계는 **가장 높은 것 하나만** · 12개월은 「코드 중지 검토」(중지는 사람이 한다)
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

const CARD = '3개월 이상 사용량 0'

const t = {
  mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', glass: 'rgba(255,255,255,0.9)',
  border: '#E8E6E1', borderH: '#D7D7D7', text: '#2E4A62', textM: '#52524E', textL: '#A3A39E',
  accent: '#804A87', accentL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE',
  amber: '#E65100', amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', yellow: '#FFE082',
  purple: '#804A87', purpleL: '#F5EDF6', mint: '#7FD9A8', coral: '#F39E94', lavender: '#BFA6D9', pink: '#E2A6D4',
  nav: '#2E4A62', navText: '#F7F6F3', navHi: '#BFA6D9',
  shadow: '0 2px 8px rgba(46,74,98,0.06)', shadowH: '0 8px 24px rgba(46,74,98,0.10)',
}

/* 재료 — 창별 출고합계와 마감 줄 수. 화면(loadUnused)이 붙이는 것과 같은 모양이다. */
const W = (o3, o6, o9, o12, s12 = 10) => ({
  __unusedOut: { 3: o3, 6: o6, 9: o9, 12: o12 },
  __unusedSnaps: { 3: 3, 6: 6, 9: 9, 12: s12 },       /* 12개월 줄은 10개 — 아직 안 찬다 */
})
const D = o => ({
  drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 10, safety_stock: 5, max_stock: 30, monthly_avg: 3,
  recent_1m_usage: 1, recent_3m_usage: 3, prev_year_usage: 12,
  purchase_price: 1000, expiry_date: '2028-01-01', atc_code: '', narcotic_type: '일반',
  ...W(9, 9, 9, 9), ...o,
})
/* T3·T6·T9 = 단계별 하나씩 · USED = 나감 · NEW = 줄이 모자람 · EMPTY = 현재고 0 */
const DRUGS = [
  D({ drug_code: 'USED', drug_name: '출고있는정', ...W(9, 9, 9, 9) }),
  D({ drug_code: 'T3', drug_name: '석달안나가는정', ...W(0, 2, 2, 2), current_qty: 10, purchase_price: 2000, max_stock: 30 }),
  D({ drug_code: 'T6', drug_name: '여섯달안나가는정', ...W(0, 0, 5, 5), current_qty: 100, purchase_price: 500, max_stock: 30 }),
  D({ drug_code: 'T9', drug_name: '아홉달안나가는정', ...W(0, 0, 0, 0), current_qty: 10, purchase_price: 9000, max_stock: 30 }),
  D({ drug_code: 'NEW', drug_name: '새로들인정', __unusedOut: { 3: 0, 6: 0, 9: 0, 12: 0 }, __unusedSnaps: { 3: 2, 6: 2, 9: 2, 12: 2 }, safety_stock: 50 }),
  D({ drug_code: 'EMPTY', drug_name: '빈정', ...W(0, 0, 0, 0), current_qty: 0, safety_stock: 0 }),
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
/* 단계 칩 누르기 — ★ 「전체」는 구분·상태·급변 필터에도 있다. 칩은 **「… N종」** 꼴이라 그것으로 가린다. */
const clickChip = async (head) => {
  const b = [...document.querySelectorAll('button')]
    .find(x => new RegExp('^' + head + '( · [^0-9]+)? \\d+종$').test(x.textContent.trim()) && !x.disabled)
  expect(b, head + ' 칩이 없거나 눌리지 않는다').toBeTruthy()
  await act(async () => { fireEvent.click(b) }); await settle(4)
  return b
}
/* 본 「재고 현황 목록」 — 머리에 「재고상태」가 있는 표 */
const mainTable = () => [...document.querySelectorAll('table')]
  .find(x => (x.querySelector('thead')?.textContent || '').includes('재고상태'))
const mainText = () => (mainTable()?.querySelector('tbody')?.textContent) || ''
/* 「3개월 이상 사용량 0」 판의 표 — 머리가 약품·구분·상태·현재고·재고금액·비고 */
const panelTable = () => [...document.querySelectorAll('table')].find(x => {
  const h = [...x.querySelectorAll('thead th')].map(y => y.textContent)
  return h.length === 6 && h[0] === '약품' && h[5] === '비고'
})
/* ★ 재고현황에도 「엑셀」 단추가 있다 — **판 안의 것**만 집어야 한다. title 로 가린다. */
const btn = name => [...document.querySelectorAll('button')].find(b =>
  b.getAttribute('title') === (name === '엑셀' ? '지금 보이는 줄을 엑셀로 내려받습니다' : 'A4 가로로 인쇄합니다'))

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); from.mockImplementation(() => chain())
  xl.aoa = null; xl.ws = null; xl.sheet = null; xl.file = null
  window.print = vi.fn()
})
afterEach(() => cleanup())

describe('★ ①②③④ 판정 — 무엇이 사용량 0 인가', () => {
  it('① 창의 실제 출고가 0 이면 단계가 붙는다', async () => {
    await open()
    expect(cardNum(CARD)).toBe(3)          /* T3 · T6 · T9 */
  })
  it('★ ② 창에 마감 줄이 모자란 약은 판정에서 빠진다', async () => {
    await open()
    await clickCard(CARD)
    expect(mainText()).not.toContain('새로들인정')
  })
  it('★ ③ 현재고 0 은 「재고없음」으로 남는다', async () => {
    await open()
    expect(cardNum('재고없음')).toBe(1)        /* EMPTY */
    await clickCard(CARD)
    expect(mainText()).not.toContain('빈정')
  })
  it('④ 한 번이라도 나간 약은 사용량 0 이 아니다', async () => {
    await open()
    await clickCard(CARD)
    expect(mainText()).not.toContain('출고있는정')
  })
})

describe('★★ ⑤⑥⑦ 판정 차례와 DB 무변경', () => {
  it('⑤ 단계 판정은 긴급·주문필요보다 **먼저** 온다', () => {
    const i = SRC.indexOf('function stockStat(d){')
    const near = SRC.slice(i, i + 900)
    expect(near.indexOf('tierOf(d)')).toBeGreaterThan(0)
    expect(near.indexOf('tierOf(d)')).toBeLessThan(near.indexOf(`return'긴급'`))
    expect(near.indexOf('tierOf(d)')).toBeLessThan(near.indexOf(`return'주문필요'`))
  })
  it('⑥ 기준미설정은 단계가 덮는다', () => {
    const i = SRC.indexOf('function stockStat(d){')
    const near = SRC.slice(i, i + 900)
    expect(near.indexOf('tierOf(d)')).toBeLessThan(near.indexOf('기준미설정'))
  })
  it('★ ⑦ DB 값을 하나도 바꾸지 않는다 — 판정 길에 쓰기가 없다', () => {
    expect(LIB.includes('update('), '계산 파일이 DB 를 고친다').toBe(false)
    expect(LIB.includes('upsert('), '계산 파일이 DB 를 고친다').toBe(false)
    expect(LIB).toContain('export function isUnused')
    expect(LIB).toContain('export function tierOf')
  })
  it('★ ⑦-2 상태(status)를 안 건드린다 → 유효기한 알림·향정 인쇄가 그대로다', () => {
    const i = SRC.indexOf('function stockStat(d){')
    const near = SRC.slice(i, i + 900)
    /* ★ 주석에 적힌 글자가 아니라 **코드**를 본다 — d.status 를 읽는지만 가린다 */
    expect(near.includes('d.status'), '판정식이 상태를 본다').toBe(false)
  })
})

describe('★ ⑧⑨⑩⑪⑫ 다른 화면에 번지지 않는다', () => {
  it('⑧ 발주 후보는 긴급·주문필요만 담는다 — 사용량 0 은 안 담긴다', () => {
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
    const parts = ['긴급', '주문필요', '재고없음', '정상', '과잉', CARD, '기준미설정'].map(k => cardNum(k))
    for (const [i, v] of parts.entries()) expect(v, parts[i] + ' 카드가 없다').not.toBeNull()
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
  })
  it('⑬-2 카드 이름이 「3개월 이상 사용량 0」이다', async () => {
    await open()
    expect(cardNum(CARD)).not.toBeNull()
    expect(cardNum('3개월 사용량 0')).toBeNull()      /* 옛 이름은 카드가 아니다 */
  })
  it('★ ⑬-3 카드 숫자 = 단계별 건수의 합', async () => {
    await open()
    await clickCard(CARD)
    const n = k => Number((screen.getByRole('button', { name: new RegExp('^' + k + ' \\d+종$') }).textContent.match(/(\d+)종/) || [])[1])
    expect(n('3개월') + n('6개월') + n('9개월')).toBe(cardNum(CARD))
  })
})

describe('★★ ⑭⑮⑯ 단계 칩', () => {
  it('⑭ 칩은 「전체」 + 네 단계다', async () => {
    await open()
    await clickCard(CARD)
    expect(screen.getByRole('button', { name: /^전체 \d+종$/ })).toBeTruthy()
    for (const k of ['3개월', '6개월', '9개월']) {
      expect(screen.getByRole('button', { name: new RegExp('^' + k + ' \\d+종$') }).disabled, k + ' 이 안 눌린다').toBe(false)
    }
    expect(screen.getByRole('button', { name: '12개월 준비 중' }).disabled, '12개월이 눌린다').toBe(true)
  })
  it('★ ⑮ 단계별 건수가 각각 맞다', async () => {
    await open()
    await clickCard(CARD)
    for (const k of ['3개월', '6개월', '9개월']) {
      expect(screen.getByRole('button', { name: k + ' 1종' }), k + ' 건수가 1종이 아니다').toBeTruthy()
    }
    expect(screen.getByRole('button', { name: '전체 3종' })).toBeTruthy()
  })
  it('★★ ⑯ 단계 칩을 누르면 목록·합계·금액이 그 단계만 남는다', async () => {
    await open()
    await clickCard(CARD)
    expect(document.body.textContent).toContain('모두 3종')
    await clickChip('9개월')
    const body = document.body.textContent
    expect(body).toContain('모두 1종')
    expect(body).toContain('90,000')                     /* T9 = 10 × 9,000 */
    const panel = panelTable().querySelector('tbody').textContent
    expect(panel).toContain('아홉달안나가는정')
    expect(panel).not.toContain('석달안나가는정')
    expect(panel).not.toContain('여섯달안나가는정')
  })
  it('★ ⑯-2 「전체」로 돌아오면 다시 모두 보인다', async () => {
    await open()
    await clickCard(CARD)
    await clickChip('9개월')
    await clickChip('전체')
    const panel = panelTable().querySelector('tbody').textContent
    for (const nm of ['석달안나가는정', '여섯달안나가는정', '아홉달안나가는정']) expect(panel).toContain(nm)
  })
  it('★ ⑰ 12개월이 열리면 「코드 중지 검토」가 되고 안내가 바뀐다', async () => {
    cleanup()
    await open({ unusedLatest: { y: 2026, m: 12 } })
    await clickCard(CARD)
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('코드 중지 검토'))
    expect(b, '12개월 칩에 「코드 중지 검토」가 없다').toBeTruthy()
    expect(b.disabled).toBe(false)
    expect(document.body.textContent).toContain('재고가 0이 된 뒤에')
  })
  it('⑰-2 아직 안 열렸을 때 안내 한 줄', async () => {
    await open()
    await clickCard(CARD)
    expect(document.body.textContent).toContain('12개월(코드 중지 검토)은 2026년 12월 마감 뒤')
    expect(document.body.textContent).toContain('상태는 저절로 바뀌지 않습니다')
  })
})

describe('★★ ⑱ 카드를 누르면 본 목록이 단계 전부를 보여 준다', () => {
  it('★ 카드 이름과 상태 글자가 달라도 본 목록이 비지 않는다', async () => {
    /* ★ 2026-11-14 시안에서 실제로 틀렸던 곳 — 카드를 눌렀더니 본 목록이 「없음」이었다 */
    await open()
    await clickCard(CARD)
    const txt = mainText()
    for (const nm of ['석달안나가는정', '여섯달안나가는정', '아홉달안나가는정']) {
      expect(txt, nm + ' 이 본 목록에 없다').toContain(nm)
    }
    expect(txt).not.toContain('출고있는정')
  })
  it('★ 본 목록 재고상태 칸이 단계 글자다', async () => {
    await open()
    await clickCard(CARD)
    const txt = mainText()
    expect(txt).toContain('3개월 사용량 0')
    expect(txt).toContain('6개월 사용량 0')
    expect(txt).toContain('9개월 사용량 0')
  })
})

describe('★ ⑲⑳ 목록 — 금액 순·과잉 뱃지·상태 열', () => {
  it('★ ⑲ 재고금액 큰 순으로 줄을 세운다', async () => {
    await open()
    await clickCard(CARD)
    const rows = [...panelTable().querySelectorAll('tbody tr')].map(r => r.textContent)
    expect(rows[0]).toContain('아홉달안나가는정')   /* 90,000 */
    expect(rows[1]).toContain('여섯달안나가는정')   /* 50,000 */
    expect(rows[2]).toContain('석달안나가는정')     /* 20,000 */
  })
  it('⑳ 과잉 뱃지는 최대재고를 넘은 약에만 붙는다', async () => {
    await open()
    await clickCard(CARD)
    const rows = [...panelTable().querySelectorAll('tbody tr')]
    const six = rows.find(r => r.textContent.includes('여섯달안나가는정'))
    const nine = rows.find(r => r.textContent.includes('아홉달안나가는정'))
    expect(six.textContent).toContain('과잉')      /* 100 > 30 */
    expect(nine.textContent).not.toContain('과잉') /* 10 < 30 */
  })
  it('⑳-2 판의 상태 열이 단계 글자를 적는다', async () => {
    await open()
    await clickCard(CARD)
    const heads = [...panelTable().querySelectorAll('thead th')].map(x => x.textContent)
    expect(heads).toEqual(['약품', '구분', '상태', '현재고', '재고금액', '비고'])
    const nine = [...panelTable().querySelectorAll('tbody tr')].find(r => r.textContent.includes('아홉달안나가는정'))
    expect(nine.children[2].textContent).toBe('9개월 사용량 0')
  })
})

describe('★ ㉑ 색·라이브러리', () => {
  it('㉑ 새 색을 만들지 않았다 — 단계 글자는 모두 기존 회색이다', () => {
    /* ★ 코드는 상태 글자를 **상수 한 곳**(lib/unusedStock)에서 가져온다 — 글자를 박아 넣지 않는다. */
    expect(SRC).toContain(`(s==='기준미설정'||isUnusedLabel(s))?t.textL:t.green`)
    expect(LIB).toContain(`export const UNUSED_CARD = '3개월 이상 사용량 0'`)
    expect(LIB).toContain(`export function tierLabel`)
    const hex = [...new Set((LIB.match(/#[0-9A-Fa-f]{3,8}/g) || []))]
    expect(hex, '계산 파일에 색이 들어갔다').toEqual([])
  })
  it('㉑-2 새 라이브러리를 들여오지 않았다 — 엑셀은 이미 있는 xlsx', () => {
    expect(SRC).toContain(`await import('xlsx')`)
    const froms = [...(LIB.match(/^import .*$/gm) || []).join('\n').matchAll(/from '([^']+)'/g)].map(m => m[1])
    expect(froms, '계산 파일은 아무것도 안 들여온다').toEqual([])
  })
})

describe('★★ ㉒ 인쇄·엑셀 — 읽기만 한다', () => {
  it('엑셀 11열 머리말이 정확하고 상태 칸이 단계 글자다', async () => {
    await open()
    await clickCard(CARD)
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(8)
    expect(xl.aoa[0]).toEqual(['약품코드', '약품명', '구분', '상태', '현재고', '구입단가', '재고금액', '과잉', '유효기한', '반품검토', '비고'])
    for (const r of xl.aoa.slice(1)) { expect(r[9]).toBe(''); expect(r[10]).toBe('') }
    /* ★ D열(상태)이 「사용」이 아니라 단계 글자다 */
    const nine = xl.aoa.slice(1).find(r => r[0] === 'T9')
    expect(nine[3]).toBe('9개월 사용량 0')
    expect(xl.ws.A2.t).toBe('s')
    expect(xl.ws.A2.z).toBe('@')
    expect(xl.file).toMatch(/^재고_3개월이상사용량0_\d{8}\.xlsx$/)
    expect(xl.sheet).toBe('3개월이상사용량0')
  })
  it('★ 엑셀은 고른 단계만 담는다', async () => {
    await open()
    await clickCard(CARD)
    await clickChip('9개월')
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(8)
    expect(xl.aoa).toHaveLength(2)                 /* 머리 1줄 + T9 */
    expect(xl.aoa[1][0]).toBe('T9')
  })
  it('★ 엑셀·인쇄를 눌러도 DB 로 아무것도 가지 않는다', async () => {
    await open()
    await clickCard(CARD)
    const before = from.mock.calls.length
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(6)
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(rpc).not.toHaveBeenCalled()
    expect(from.mock.calls.length).toBe(before)
    expect(window.print).toHaveBeenCalled()
  })
  it('인쇄본에 제목·서명란·쪽 번호·반품검토 네모가 있다', async () => {
    await open()
    await clickCard(CARD)
    const prn = document.querySelector('.ps-print')
    expect(prn, '인쇄 블록이 없다').toBeTruthy()
    expect(prn.textContent).toContain('3개월 이상 사용량 0 — 반품·폐기 검토 리스트')
    expect(prn.querySelector('.ps-sign').textContent).toContain('검토자')
    expect(prn.querySelector('.ps-ft').textContent).toMatch(/^\d+ \/ \d+$/)
    expect(prn.textContent).toContain('□반품')
    expect(prn.textContent).toContain('□폐기')
    expect(prn.textContent).toContain('□보류')
  })
  it('★ 인쇄본 상태 칸도 단계 글자다', async () => {
    await open()
    await clickCard(CARD)
    const prn = document.querySelector('.ps-print')
    expect(prn.textContent).toContain('9개월 사용량 0')
    expect(prn.textContent).toContain('6개월 사용량 0')
  })
  it('★ 인쇄 규칙이 다른 화면에 번지지 않는다 — @page 는 누를 때만', async () => {
    await open()
    await clickCard(CARD)
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
