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
const { TIER_LABELS } = await import('./lib/unusedStock')
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
/* 「3개월 이상 사용량 0」 판의 표 — 머리가 약품·구분·상태·현재고·재고금액·비고
   ★ 머리글이 ColMenu 라 글자 뒤에 정렬 표시(▲▼⇅)가 붙는다 — 떼고 본다. */
const headText = th => th.textContent.replace(/[▲▼⇅]/g, '').trim()
const panelHeads = () => [...(panelTable()?.querySelectorAll('thead th') || [])].map(headText)
const panelTable = () => [...document.querySelectorAll('table')].find(x => {
  const h = [...x.querySelectorAll('thead th')].map(headText)
  return h.length === 6 && h[0] === '약품' && h[5] === '비고'
})
/* 머리글 한 칸 — ColMenu 는 <span><span>글자</span><span>▲</span></span> 꼴이다 */
const headCell = label => [...(panelTable()?.querySelectorAll('thead th') || [])].find(th => headText(th) === label)
const headLabel = label => headCell(label)?.querySelector('span')?.children[0]
const headArrow = label => headCell(label)?.querySelector('span')?.children[1]
/* 머리글 메뉴 — body 로 내보낸 포털(zIndex 9999) */
const openMenu = () => [...document.querySelectorAll('div')].find(d => d.style && d.style.zIndex === '9999')
const menuItems = () => [...(openMenu()?.querySelectorAll('button') || [])].map(b => b.textContent.replace('✓', '').trim())
const clickHead = async (label) => { await act(async () => { fireEvent.click(headLabel(label)) }); await settle(4) }
const clickArrow = async (label) => { await act(async () => { fireEvent.click(headArrow(label)) }); await settle(4) }
const pickMenu = async (v) => {
  const b = [...(openMenu()?.querySelectorAll('button') || [])].find(x => x.textContent.replace('✓', '').trim() === v)
  expect(b, '메뉴에 「' + v + '」 가 없다').toBeTruthy()
  await act(async () => { fireEvent.click(b) }); await settle(4)
}
/* 판의 줄 이름 · 쪽 넘김 · 칩 */
const panelNames = () => [...(panelTable()?.querySelectorAll('tbody tr') || [])]
  .map(tr => (tr.querySelector('td div')?.textContent || '').trim())
/* ★ 본 목록에도 같은 모양의 쪽 넘김이 있다 — **판 안의 것**만 봐야 한다.
     판의 표를 감싼 상자(테두리 div) 안에 표와 쪽 넘김이 함께 들어 있다. */
const pgBar = () => panelTable()?.parentElement?.parentElement
const pgText = () => {
  const el = [...(pgBar()?.querySelectorAll('span') || [])].find(x => /^\d+개 중 /.test(x.textContent.trim()))
  return el ? el.textContent.trim() : null
}
const pgButton = (label) => [...(pgBar()?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === label)
const chipBtn = (head) => [...document.querySelectorAll('button')]
  .find(x => new RegExp('^' + head + '( · [^0-9]+)? \\d+종$').test(x.textContent.trim()))
const amtChip = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '재고금액 큰 순')
const allChip = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '전부 보기')
const press = async (el) => { expect(el, '단추가 없다').toBeTruthy(); await act(async () => { fireEvent.click(el) }); await settle(4) }
/* 쪽 넘김 시험용 — 9개월 단계 25종 (20줄 + 5줄) */
const BIG = Array.from({ length: 25 }, (_, i) => D({
  drug_code: 'B' + String(i + 1).padStart(2, '0'),
  drug_name: '큰약' + String(i + 1).padStart(2, '0') + '정',
  category: i % 2 ? '주사제' : '경구제',
  current_qty: 10, purchase_price: (25 - i) * 1000, max_stock: i < 5 ? 5 : 30,
  ...W(0, 0, 0, 0),
}))
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
    expect(panelHeads()).toEqual(['약품', '구분', '상태', '현재고', '재고금액', '비고'])
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

/* ══════════════════════════════════════════════════════════════════════════
   ★★ ㉓ 판 표 — 본 목록과 같은 머리글(StandardTable·ColMenu) + 쪽 넘김
   (2026-11-14 이정화 님 승인 · ㉠-1 판만 HScroll 없이 · ㉡-1 구분 거르기 둠
    · ㉢-1 처음 20줄씩 · ㉣ 한 쪽 20줄)
   ══════════════════════════════════════════════════════════════════════════ */
describe('★★ ㉓ 판 표 — 머리글·정렬·쪽 넘김', () => {
  const openBig = (props = {}) => open({ drugs: BIG, ...props })

  it('① 본 목록과 **같은 머리글 부품**을 쓴다 — 새 부품을 만들지 않았다', async () => {
    await openBig(); await clickCard(CARD)
    expect(panelHeads()).toEqual(['약품', '구분', '상태', '현재고', '재고금액', '비고'])
    /* ColMenu 라면 글자 뒤에 정렬 표시가 붙는다 */
    expect(headArrow('재고금액').textContent.trim()).toMatch(/[▲▼⇅]/)
    expect(SRC).toContain('<StandardTable t={t} TS={unS.TS}')
    /* ★ ㉠-1 — 판만 좌우 스크롤 단추 없이. 다른 표는 안 건드린다. */
    expect(SRC).toContain('hf={_unHf} fontSize={11} noScroll')
  })
  it('★ ㉠-1 다른 표는 좌우 스크롤 단추를 그대로 쓴다', () => {
    /* noScroll 을 **안 고른 길**은 지금과 한 글자도 다르지 않아야 한다 */
    expect(SRC).toContain('return noScroll ? <div style={{ overflowX: \'auto\' }}>{_tbl}</div> : <HScroll {...(hscroll || {})}>{_tbl}</HScroll>;')
    const others = (SRC.match(/<StandardTable /g) || []).length
    const withNo = (SRC.match(/noScroll\n|noScroll\r\n|fontSize=\{11\} noScroll/g) || []).length
    expect(others, '표가 여러 곳에 있다').toBeGreaterThan(5)
    expect(withNo, 'noScroll 을 쓴 곳은 판 하나뿐이다').toBe(1)
  })
  it('② 머리글 ▲ 로 줄을 세운다 — 재고금액 오름차순', async () => {
    await openBig(); await clickCard(CARD)
    expect(panelNames()[0]).toBe('큰약01정')        /* 금액 큰 순 250,000 */
    await clickArrow('재고금액')
    expect(panelNames()[0]).toBe('큰약25정')        /* 오름차순 10,000 */
  })
  it('★ ③ 머리글을 누르면 「재고금액 큰 순」 칩이 풀린다 — 차례가 둘이 되지 않는다', async () => {
    await openBig(); await clickCard(CARD)
    expect(amtChip().getAttribute('aria-pressed')).toBe('true')
    await clickArrow('재고금액')
    expect(amtChip().getAttribute('aria-pressed')).toBe('false')
  })
  it('★ ④ 칩을 누르면 머리글 정렬이 풀리고 금액 큰 순으로 돌아온다', async () => {
    await openBig(); await clickCard(CARD)
    await clickArrow('재고금액')
    expect(panelNames()[0]).toBe('큰약25정')
    await press(amtChip())
    expect(panelNames()[0]).toBe('큰약01정')
    expect(amtChip().getAttribute('aria-pressed')).toBe('true')
  })
  it('★ ⑤ 판 정렬이 **본 목록 정렬을 건드리지 않는다**', async () => {
    await openBig(); await clickCard(CARD)
    const before = mainText()
    await clickArrow('재고금액')
    expect(mainText(), '본 목록까지 같이 뒤집혔다').toBe(before)
  })
  it('⑥ 처음에는 20줄씩 나오고 쪽 넘김이 있다', async () => {
    await openBig(); await clickCard(CARD)
    expect(panelNames()).toHaveLength(20)
    expect(pgText()).toBe('25개 중 1–20')
    expect(allChip().getAttribute('aria-pressed')).toBe('false')
  })
  it('⑦ 쪽을 넘기면 다음 줄이 나온다', async () => {
    await openBig(); await clickCard(CARD)
    await press(pgButton('2'))
    expect(panelNames()).toHaveLength(5)
    expect(panelNames()[0]).toBe('큰약21정')
    expect(pgText()).toBe('25개 중 21–25')
  })
  it('⑧ 「전부 보기」를 켜면 전부 나오고 쪽 넘김이 사라진다', async () => {
    await openBig(); await clickCard(CARD)
    await press(allChip())
    expect(panelNames()).toHaveLength(25)
    expect(pgText(), '쪽 넘김이 남아 있다').toBeNull()
    expect(allChip().getAttribute('aria-pressed')).toBe('true')
  })
  it('★★ ⑨ 「상태」 머리글 메뉴와 단계 칩은 **상태 하나**다 (양쪽 다)', async () => {
    await open(); await clickCard(CARD)
    /* 메뉴에서 고르면 → 칩이 눌린다 */
    await clickHead('상태')
    await pickMenu('9개월 사용량 0')
    expect(chipBtn('9개월').getAttribute('aria-pressed')).toBe('true')
    expect(chipBtn('전체').getAttribute('aria-pressed')).toBe('false')
    /* 칩을 누르면 → 메뉴에 ✓ 가 따라간다 */
    await press(chipBtn('3개월'))
    await clickHead('상태')
    const picked = [...openMenu().querySelectorAll('button')].filter(b => b.textContent.includes('✓'))
      .map(b => b.textContent.replace('✓', '').trim())
    expect(picked).toEqual(['3개월 사용량 0'])
  })
  it('⑩ 「상태」 메뉴에는 **쓸 수 있는 단계만** 나온다 — 12개월은 없다', async () => {
    await open(); await clickCard(CARD)
    await clickHead('상태')
    expect(menuItems()).toEqual(['전체', '3개월 사용량 0', '6개월 사용량 0', '9개월 사용량 0'])
  })
  it('⑪ 「구분」·「비고」 거르기가 줄과 합계를 **함께** 좁힌다', async () => {
    await openBig(); await clickCard(CARD)
    expect(document.body.textContent).toContain('모두 25종')
    await clickHead('구분'); await pickMenu('주사제')
    expect(panelNames()).toHaveLength(12)            /* 홀수 번호 12종 */
    expect(document.body.textContent).toContain('모두 12종')
    /* 「비고」로 과잉만 — 과잉은 B01~B05 다섯 종, 그중 주사제는 둘(B02·B04) */
    await clickHead('비고'); await pickMenu('과잉')
    expect(panelNames()).toHaveLength(2)
    expect(document.body.textContent).toContain('모두 2종')
    expect(document.body.textContent).toContain('과잉 2종')
  })
  it('★ ⑫ 엑셀은 **지금 보이는 줄 전부**를 담는다 — 쪽에 묶이지 않는다', async () => {
    await openBig(); await clickCard(CARD)
    await press(pgButton('2'))                       /* 2쪽에는 5줄만 보인다 */
    expect(panelNames()).toHaveLength(5)
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(8)
    expect(xl.aoa, '쪽에 묶여 5줄만 나갔다').toHaveLength(26)   /* 머리 1 + 25 */
    expect(xl.aoa[1][1]).toBe('큰약01정')             /* 차례는 화면과 같다 */
  })
  it('⑬ 새 색을 만들지 않았다 · 원본 줄을 건드리지 않는다', async () => {
    /* 판에 붙이는 재고금액·과잉은 **복사본**에만 붙는다 */
    expect(SRC).toContain('const _unRows=_unSel.map(d=>({...d,__amt:')
    expect(/\b_unSel\.(sort|splice|reverse)\(/.test(SRC), '원본을 건드렸다').toBe(false)
    const hex = [...new Set((LIB.match(/#[0-9A-Fa-f]{3,8}/g) || []))]
    expect(hex, '계산 파일에 색이 들어갔다').toEqual([])
  })
})

/* ══════════════════════════════════════════════════════════════════════════
   ★★ ㉔ 본 목록 — 재고상태 메뉴 차례 · 옛 글자 「미사용」 없애기
   (2026-11-14 이정화 님이 운영 화면에서 찾아 지시)
   ══════════════════════════════════════════════════════════════════════════ */
describe('★★ ㉔ 재고상태 메뉴 차례 · 「미사용」 글자', () => {
  /* 아홉 가지 재고상태가 모두 나오게 고른 줄들 */
  const ORDER_DRUGS = [
    D({ drug_code: 'URG', drug_name: '긴급정', current_qty: 10, safety_stock: 20, monthly_avg: 3 }),
    D({ drug_code: 'ORD', drug_name: '주문필요정', current_qty: 10, safety_stock: 5, monthly_avg: 30 }),
    D({ drug_code: 'NOR', drug_name: '정상정', current_qty: 10, safety_stock: 5, monthly_avg: 3, max_stock: 30 }),
    D({ drug_code: 'OVR', drug_name: '과잉정', current_qty: 40, safety_stock: 5, monthly_avg: 3, max_stock: 30 }),
    D({ drug_code: 'NOS', drug_name: '기준없는정', current_qty: 10, safety_stock: 0 }),
    D({ drug_code: 'NIL', drug_name: '재고없는정', current_qty: 0, safety_stock: 0 }),
    D({ drug_code: 'K3', drug_name: '석달0정', ...W(0, 2, 2, 2) }),
    D({ drug_code: 'K6', drug_name: '여섯달0정', ...W(0, 0, 5, 5) }),
    D({ drug_code: 'K9', drug_name: '아홉달0정', ...W(0, 0, 0, 0) }),
  ]
  /* 본 목록 머리글 메뉴 */
  const mainHead = label => [...(mainTable()?.querySelectorAll('thead th') || [])].find(th => headText(th) === label)
  const clickMainHead = async (label) => {
    const th = mainHead(label)
    expect(th, '본 목록에 「' + label + '」 머리글이 없다').toBeTruthy()
    await act(async () => { fireEvent.click(th.querySelector('span').children[0]) }); await settle(4)
  }

  it('★ ① 재고상태 메뉴 차례가 **정해진 대로**다 — 급한 것부터', async () => {
    await open({ drugs: ORDER_DRUGS })
    await clickMainHead('재고상태')
    expect(menuItems()).toEqual(['전체',
      '긴급', '주문필요', '정상', '과잉',
      '3개월 사용량 0', '6개월 사용량 0', '9개월 사용량 0',
      '기준미설정', '재고없음'])
  })
  it('② 지금 화면에 없는 상태는 메뉴에 안 나온다', async () => {
    await open()                                  /* 기본 묶음 — 과잉·주문필요가 없다 */
    await clickMainHead('재고상태')
    const items = menuItems()
    expect(items).not.toContain('과잉')
    expect(items).not.toContain('주문필요')
    /* 그래도 남은 것들의 **차례는 그대로**다 */
    expect(items.indexOf('긴급')).toBeLessThan(items.indexOf('3개월 사용량 0'))
    expect(items.indexOf('9개월 사용량 0')).toBeLessThan(items.indexOf('재고없음'))
  })
  it('★ ③ 12개월이 차면 9개월 **뒤·기준미설정 앞**에 저절로 들어간다', () => {
    expect(SRC).toContain("const STOCK_STAT_ORDER = ['긴급','주문필요','정상','과잉',...TIER_LABELS,'기준미설정','재고없음']")
    const i9 = TIER_LABELS.indexOf('9개월 사용량 0'), i12 = TIER_LABELS.indexOf('12개월 사용량 0')
    expect(i12, '12개월이 9개월 뒤가 아니다').toBe(i9 + 1)
  })

  it('★★ ④ 재고현황 화면 글자에 「미사용」이 **0곳**이다', async () => {
    /* 전년·최근3개월이 둘 다 0 인 약 — 옛 「미사용」 뱃지가 붙던 자리다(실측 31종, 7ATRP 등) */
    await open({ drugs: [...ORDER_DRUGS, D({ drug_code: 'NOBASE', drug_name: '기준없는주', prev_year_usage: 0, recent_3m_usage: 0, safety_stock: 0, monthly_avg: 0 })] })
    expect(document.body.textContent, '화면에 「미사용」이 남아 있다').not.toContain('미사용')
    await clickCard(CARD)
    expect(document.body.textContent, '카드를 누른 뒤에도 남으면 안 된다').not.toContain('미사용')
  })
  it('★ ⑤ 재고상태 칸에 **덧뱃지를 달지 않는다** — 한 줄만 적는다', async () => {
    /* ★ 2026-11-14 이정화 님 결정 — 「전년·3개월 저장값 둘 다 0」 뱃지를 **지웠다.**
         31종 모두 이미 「N개월 사용량 0」이나 「기준미설정」으로 보여 정보가 겹쳤고,
         「기준 없음」이라는 글자가 「기준미설정」과 헷갈렸다. */
    await open({ drugs: [
      D({ drug_code: 'NOBASE', drug_name: '기준없는주', prev_year_usage: 0, recent_3m_usage: 0, safety_stock: 0, monthly_avg: 0 }),
      D({ drug_code: 'K9B', drug_name: '아홉달0이고기준없는주', prev_year_usage: 0, recent_3m_usage: 0, safety_stock: 0, monthly_avg: 0, ...W(0, 0, 0, 0) }),
    ] })
    const cellOf = nm => {
      const row = [...(mainTable()?.querySelectorAll('tbody tr') || [])].find(r => r.textContent.includes(nm))
      expect(row, nm + ' 줄이 없다').toBeTruthy()
      return [...row.querySelectorAll('td')].find(td => /사용량 0|기준미설정|긴급|주문필요|정상|과잉|재고없음/.test(td.textContent))
    }
    /* 재고상태는 그대로 — 뱃지는 **하나뿐**이다 */
    const a = cellOf('기준없는주')
    expect(a.textContent.trim()).toBe('기준미설정')
    expect(a.querySelectorAll('span span').length, '뱃지가 둘이다').toBeLessThanOrEqual(1)
    const b = cellOf('아홉달0이고기준없는주')
    expect(b.textContent.trim()).toBe('9개월 사용량 0')
    expect(b.querySelectorAll('span span').length, '뱃지가 둘이다').toBeLessThanOrEqual(1)
    /* 지운 글자가 화면에 없다 */
    expect(document.body.textContent).not.toContain('기준 없음')
  })
  it('★★ ⑥ 소스의 「미사용」은 **알림(유효기한) 화면 글자에만** 남는다', () => {
    /* 주석은 뺀다 — 화면에 안 나오는 글자다 */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    /* 알림 화면이 쓰는 글자 — 이정화 님이 **그대로 두라고** 한 것들 */
    const ALLOWED = ['미사용기간(일)', '미사용알림', '■미사용■', "l:'미사용'"]
    let rest = code
    for (const a of ALLOWED) rest = rest.split(a).join('')
    const left = [...rest.matchAll(/미사용/g)].map(m => rest.slice(Math.max(0, m.index - 50), m.index + 30))
    expect(left, '알림 화면 말고 「미사용」이 남아 있다:\n' + left.join('\n---\n')).toEqual([])
    /* 잠깐 썼던 「기준 없음」도 지웠다 — 되살아나지 않게 못 박는다 */
    expect(code.includes('기준 없음'), '지운 「기준 없음」이 되살아났다').toBe(false)
  })
})

/* ══════════════════════════════════════════════════════════════════════════
   ★ ㉕ 마약·향정 표시 — 단계 판정은 마약도 그대로 타므로(2026-11-14 ㉮)
      판·인쇄·엑셀에서 눈에 띄게 한다. **기존 NT 뱃지**를 쓴다 — 새 색 없음.
   ══════════════════════════════════════════════════════════════════════════ */
describe('★ ㉕ 판·인쇄·엑셀의 마약·향정 표시', () => {
  const NARC = [
    D({ drug_code: 'NARC', drug_name: '마약안나가는주', category: '주사제', narcotic_type: '마약', ...W(0, 0, 0, 0), current_qty: 10, purchase_price: 5000 }),
    D({ drug_code: 'PSY', drug_name: '향정안나가는정', category: '경구제', narcotic_type: '향정', ...W(0, 0, 5, 5), current_qty: 10, purchase_price: 3000 }),
    D({ drug_code: 'HAN', drug_name: '한외안나가는정', category: '경구제', narcotic_type: '한외마약', ...W(0, 2, 2, 2), current_qty: 10, purchase_price: 1000 }),
    D({ drug_code: 'PLAIN', drug_name: '보통안나가는정', category: '경구제', ...W(0, 0, 0, 0), current_qty: 10, purchase_price: 2000 }),
  ]
  it('★ ① 판에 마약·향정 뱃지가 붙는다 — 일반·한외마약에는 안 붙는다', async () => {
    await open({ drugs: NARC }); await clickCard(CARD)
    const rowOf = nm => [...panelTable().querySelectorAll('tbody tr')].find(r => r.textContent.includes(nm))
    expect(rowOf('마약안나가는주').textContent).toContain('마약')
    expect(rowOf('향정안나가는정').textContent).toContain('향정')
    /* ★ 한외마약은 getNT 가 「일반」으로 본다 — 이정화 님 결정(일반과 같이 규칙 적용) */
    expect(rowOf('한외안나가는정').textContent.replace('한외안나가는정', '')).not.toContain('마약')
    expect(rowOf('보통안나가는정').textContent).not.toContain('향정')
  })
  it('★ ② 인쇄 「구분」 칸이 마약·향정을 적는다', async () => {
    await open({ drugs: NARC }); await clickCard(CARD)
    const prn = document.querySelector('.ps-print')
    expect(prn.textContent).toContain('주사제 · 마약')
    expect(prn.textContent).toContain('경구제 · 향정')
    expect(prn.textContent).toContain('경구제')        /* 한외마약·일반은 구분만 */
  })
  it('★ ③ 엑셀 「구분」 칸도 같은 글자다 · 새 색 없음', async () => {
    await open({ drugs: NARC }); await clickCard(CARD)
    await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(8)
    const byCode = c => xl.aoa.slice(1).find(r => r[0] === c)
    expect(byCode('NARC')[2]).toBe('주사제 · 마약')
    expect(byCode('PSY')[2]).toBe('경구제 · 향정')
    expect(byCode('HAN')[2]).toBe('경구제')
    expect(byCode('PLAIN')[2]).toBe('경구제')
    /* 판은 **기존 NT 부품**을 쓴다 — 색을 새로 적지 않는다 */
    expect(SRC).toContain('{d.drug_code}<NT d={d} /></div></td>')
  })
})
