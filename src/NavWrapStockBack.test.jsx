/* 위쪽 메뉴 두 가지 (2026-11-15 이정화 님 승인 · PR B)
 *
 * ㉠ 좁은 창(≤768px)에서 하위 메뉴(▼)가 **안 펼쳐지던** 것 —
 *    메뉴 띠에 걸린 `overflow-x: auto` 가 띠를 **자르는 상자**로 만들어,
 *    띠 안에서 아래로 펼쳐지는 하위 메뉴가 통째로 잘렸다(760px 실측 — 230px 중 3px 만 보임).
 *    가로 스크롤을 버리고 **두 줄 메뉴**(flex-wrap: wrap)로 바꾼다.
 *    ★ 이 규칙은 `@media (max-width: 768px)` 안에만 있다 — PC(769px 이상)는 무변경이다.
 *
 * ㉡ `#stock/check`(기준확인)에서 메뉴의 「재고현황」을 눌러도 **안 돌아가던** 것 —
 *    setMenu 만 했는데 이미 'stock' 이라 값이 안 바뀌어 아무 일도 안 났다.
 *    메뉴 칸을 누르면 **기본 주소(#stock)로 되돌린다.**
 *    ★ 재고현황만 고친다 — 백신관리·입출고는 건드리지 않는다(이정화 님 결정 ⓑ·ⓒ).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const from = vi.fn()
const rpc = vi.fn()
vi.mock('./lib/supabase', () => ({
  supabase: {
    from: (...a) => from(...a), rpc: (...a) => rpc(...a),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch },
    removeChannel: () => {},
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  },
}))

const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const { ThemeCtx } = await import('./lib/theme')
const A = await import('./App.jsx')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  borderH: '#D8D5CE', text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87',
  accentL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE',
  amber: '#E65100', amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87',
  purpleL: '#F5EDF6', nav: '#2E4A62', navHi: '#BFA6D9', navText: '#FFFFFF', shadow: 'none', shadowH: 'none' }

function chain() {
  const c = {}
  for (const k of ['select', 'eq', 'order', 'limit', 'range', 'in', 'gte', 'lte']) c[k] = () => c
  c.maybeSingle = () => Promise.resolve({ data: null, error: null })
  c.update = () => c
  c.then = res => Promise.resolve({ data: [], error: null }).then(res)
  return c
}
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }

const drawHeader = async (setMenu = () => {}) => {
  const ctx = { t: T, memberRole: 'owner', profile: { role: 'member', settings: {} }, user: { id: 'u1' },
    dark: false, toggle: () => {}, open360: () => {}, openSearch: () => {}, navTo: () => {},
    setMenu: () => {}, menu: 'stock', logout: () => {} }
  const r = render(<ThemeCtx.Provider value={ctx}>
    <A.Header menu="stock" setMenu={setMenu} onRegister={() => {}} />
  </ThemeCtx.Provider>)
  await settle()
  return r
}
/* 재고관리 ▼ 를 눌러 내림 목록을 연다 — 시험 환경은 hover 가 안 걸리므로 ▾ 를 누른다 */
const openStockMenu = async () => {
  const lab = [...document.querySelectorAll('.cnc-nav-desktop span')].find(e => e.textContent.trim() === '재고관리')
  expect(lab, '재고관리 칸을 못 찾았다').toBeTruthy()
  const car = lab.parentElement.querySelector('span[title="하위 메뉴"]')
  expect(car, '▾ 를 못 찾았다').toBeTruthy()
  await act(async () => { fireEvent.click(car) })
}
const item = label => [...document.querySelectorAll('.cnc-nav-desktop button')]
  .find(b => b.textContent.replace('✓', '').trim() === label)

beforeEach(() => {
  from.mockReset(); from.mockImplementation(() => chain())
  rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null })
  window.history.replaceState({}, '', '/')
})
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/') })

/* ══ ㉠ 좁은 창 — 두 줄 메뉴 ═══════════════════════════════════ */
describe('★★ ㉠ 좁은 창(≤768px) — 가로 스크롤을 버리고 두 줄로 접는다', () => {
  const block = () => {
    const i = APP.indexOf('@media (max-width: 768px)')
    expect(i, '768px 블록을 못 찾았다').toBeGreaterThan(0)
    /* 블록 안의 메뉴 띠 규칙만 본다 */
    const j = APP.indexOf('.cnc-nav-desktop {', i)
    return APP.slice(j, APP.indexOf('}', j))
  }

  it('★★ 메뉴 띠를 **자르지 않는다** — overflow-x: auto 를 버렸다', () => {
    expect(block().includes('overflow-x'), 'overflow 가 visible 이 아니면 하위 메뉴가 잘린다').toBe(false)
  })

  it('★ 대신 **두 줄로 접는다**(flex-wrap: wrap) · 높이를 푼다', () => {
    const b = block()
    expect(b).toContain('flex-wrap: wrap !important')
    expect(b, '인라인 height:44 를 풀어야 두 줄이 들어간다').toContain('height: auto !important')
    expect(b.includes('flex-wrap: nowrap'), '옛 nowrap 이 남았다').toBe(false)
  })

  it('★★ PC(769px 이상)는 **한 픽셀도 안 바뀐다**', () => {
    /* ① 띠의 기본(인라인) 스타일 그대로 */
    expect(APP).toContain(`className="cnc-nav-desktop" style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', height: 44 }}`)
    /* ② 태블릿(≤1024px) 블록도 그대로 */
    const k = APP.indexOf('@media (max-width: 1024px)')
    expect(APP.slice(k, k + 260)).toContain('.cnc-nav-desktop { gap: 1px !important; }')
    /* ③ wrap 규칙은 768px 블록 **안**에만 있다 */
    const n = (APP.match(/flex-wrap: wrap !important/g) || []).length
    expect(n, 'wrap 규칙이 한 군데(768px 블록)에만 있어야 한다').toBe(1)
    const w = APP.indexOf('flex-wrap: wrap !important')
    expect(w, 'wrap 이 768px 블록 뒤에 있어야 한다').toBeGreaterThan(APP.indexOf('@media (max-width: 768px)'))
  })

  it('★ 쓸모없어진 가로 스크롤 자국을 남기지 않았다', () => {
    expect(APP.includes('.cnc-nav-desktop::-webkit-scrollbar'), '스크롤바 감추기는 더 필요 없다').toBe(false)
    expect(APP.includes('-webkit-overflow-scrolling: touch'), '가로 스크롤 보조 규칙이 남았다').toBe(false)
  })
})

/* ══ ㉡ 재고현황 칸이 기본 주소로 되돌린다 ═════════════════════ */
describe('★★ ㉡ #stock/check 에서 메뉴 「재고현황」 → #stock', () => {
  it('★★ **그려서** — 주소가 #stock 으로 돌아간다', async () => {
    window.history.replaceState({}, '', '#stock/check')
    const sm = vi.fn()
    await drawHeader(sm)
    await openStockMenu()
    const b = item('재고현황')
    expect(b, '재고현황 칸을 못 찾았다').toBeTruthy()
    await act(async () => { fireEvent.click(b) })
    expect(window.location.hash, '기준확인에 머물면 안 된다').toBe('#stock')
    expect(sm, 'setMenu 도 지금까지처럼 부른다').toHaveBeenCalledWith('stock')
  })

  it('★★ 신호(yk:hash)를 쏜다 — 재고현황 탭이 주소를 다시 읽는다', async () => {
    window.history.replaceState({}, '', '#stock/check')
    const seen = []
    const on = () => seen.push(window.location.hash)
    window.addEventListener('yk:hash', on)
    try {
      await drawHeader()
      await openStockMenu()
      await act(async () => { fireEvent.click(item('재고현황')) })
    } finally { window.removeEventListener('yk:hash', on) }
    expect(seen, 'yk:hash 가 한 번 나야 한다').toEqual(['#stock'])
  })

  it('★ 이미 #stock 이면 **주소를 건드리지 않는다** — 쓸데없는 기록을 안 남긴다', async () => {
    window.history.replaceState({}, '', '#stock')
    const n0 = window.history.length
    const seen = []
    const on = () => seen.push(1)
    window.addEventListener('yk:hash', on)
    try {
      await drawHeader()
      await openStockMenu()
      await act(async () => { fireEvent.click(item('재고현황')) })
    } finally { window.removeEventListener('yk:hash', on) }
    expect(window.location.hash).toBe('#stock')
    expect(seen.length, '아무 일도 안 나야 한다').toBe(0)
    expect(window.history.length, '뒤로 가기 기록이 늘면 안 된다').toBe(n0)
  })

  it('★★ 백신관리·입출고는 **건드리지 않는다** (이정화 님 결정 ⓑ·ⓒ)', async () => {
    window.history.replaceState({}, '', '#vaccine/survey')
    await drawHeader()
    await openStockMenu()
    await act(async () => { fireEvent.click(item('백신관리')) })
    expect(window.location.hash, '백신 탭은 그대로 둔다').toBe('#vaccine/survey')
    cleanup()
    window.history.replaceState({}, '', '#transaction/out/2026-09')
    await drawHeader()
    await act(async () => { fireEvent.click(item('입출고')) })
    expect(window.location.hash, '입출고의 탭·달은 그대로 둔다').toBe('#transaction/out/2026-09')
  })

  it('★ 고친 곳은 재고현황 한 갈래뿐이다', () => {
    const i = APP.indexOf('function nav(id) {')
    expect(i, 'nav 를 못 찾았다').toBeGreaterThan(0)
    const body = APP.slice(i, APP.indexOf('\n  }', i))
    expect(body).toContain(`id === 'stock' && stockTabFromHash()`)
    expect(/vaccine|transaction/.test(body), '백신·입출고를 건드리면 안 된다').toBe(false)
    expect(body, '지금까지의 두 줄은 그대로다').toContain('sm(id); setMobileOpen(false)')
  })

  it('★ 다른 화면(유효기한)으로 갈 때는 지금까지의 길 그대로다', async () => {
    window.history.replaceState({}, '', '#stock/check')
    const sm = vi.fn()
    await drawHeader(sm)
    await openStockMenu()
    await act(async () => { fireEvent.click(item('유효기한')) })
    expect(sm).toHaveBeenCalledWith('expiry')
    expect(window.location.hash, '주소는 App 의 기존 effect 가 바꾼다').toBe('#stock/check')
  })
})
