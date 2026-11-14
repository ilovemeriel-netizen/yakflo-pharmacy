/* 기준확인 — 폭 되돌리기 · 돌아가기 단추 · 표 머리 「전체 선택」
   (2026-11-14 이정화 님 승인 · PR A)

   ① 「← 재고현황」을 **「기준확인」 단추와 같은 보라 꼴**로 — 메뉴 밑에서 잘 보이게.
      위 여백은 ③ 의 표준 뿌리 여백이 저절로 만들어 준다.
   ③④ 흰 상자의 **가운데 980 을 되돌린다** — 다른 17화면과 같은 '20px 24px' 뿌리 여백,
      폭은 꽉 채운다. (좁은 창에서 양옆 여백이 1px 까지 줄던 것을 고친다.)
   ⑤ 표 머리에 「전체 선택」 — **지금 보이는(걸러진) 줄만**, 일부면 반쯤 표시.

   ★★ 적용 대상 규칙은 **한 글자도 안 바뀐다.** 「전체 선택」도 줄마다 누르는 toggle 과
     똑같이 off/extra 만 건드리고, 저장은 늘 `applyRows(원본 p.rows, 체크한 코드 Set)` 이다.
     숨은 체크 알림 띠도 그대로 살아 있어야 한다 — 그것을 여기서 못 박는다.
   ★ 창(보고서 「사용량 비교 보기」)은 **지금과 한 글자도 다르지 않다.** */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
const channel = vi.fn()
vi.mock('./lib/supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a), from: (...a) => from(...a),
    channel: (...a) => channel(...a), removeChannel: () => {},
  },
}))

const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const UCM = readFileSync(root('src/UsageCompareModal.jsx'), 'utf8')
const UsageCompareModal = (await import('./UsageCompareModal')).default
const { READ_ONLY_MSG } = await import('./lib/readOnly')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadow: 'none', shadowH: 'none' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, atc_code: '',
  __unusedSnaps: { 3: 3, 6: 6, 9: 9, 12: 10 }, ...o })
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
  D({ drug_code: 'VAC', drug_name: '백신주', atc_code: 'J07BB02', recent_3m_usage: 9, recent_1m_usage: 3, monthly_avg: 3, safety_stock: 4 }),
  D({ drug_code: 'TINY', drug_name: '극소량약', recent_3m_usage: 30, recent_1m_usage: 10, monthly_avg: 10, safety_stock: 12 }),
  /* ★ 2026-11-15 — **잠기지 않았는데 기본 체크가 꺼진** 줄이 필요하다(섞인 상태를 만들려면).
       출고가 한 건도 없는데 저장값이 남아 있는 약 = 「0으로 바뀌는 약」이다. */
  D({ drug_code: 'ZERO', drug_name: '영으로가는정', recent_3m_usage: 30, recent_1m_usage: 10, monthly_avg: 10, safety_stock: 12 }),
]
const TX = [
  { drug_code: 'AAA', type: '출고', transaction_date: '2026-09-10', quantity: 9 },
  { drug_code: 'BBB', type: '출고', transaction_date: '2026-09-11', quantity: 600 },
  { drug_code: 'VAC', type: '출고', transaction_date: '2026-09-12', quantity: 30 },
  { drug_code: 'TINY', type: '출고', transaction_date: '2026-09-13', quantity: 1 },
]
function mockTx() {
  let lo = 0, hi = 1e9
  const c = {}
  for (const k of ['select', 'eq', 'gte', 'lt', 'order', 'limit']) c[k] = () => c
  c.range = (a, b) => { lo = a; hi = b; return c }
  c.maybeSingle = () => Promise.resolve({ data: { snap_year: 2026, snap_month: 10 }, error: null })
  c.then = res => Promise.resolve({ data: TX.slice(lo, hi + 1), count: TX.length, error: null }).then(res)
  return c
}
const settle = async (n = 14) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>
function useSortReal(init) {
  const [v, set] = useState({ sk: init || '', sd: 'asc' })
  return { sk: v.sk, sd: v.sd, setSort: (k, d) => set({ sk: k, sd: d || 'asc' }) }
}
const Head = ({ colKey, label, setSort, sd, sk, filter }) => (
  <span data-head={colKey}>
    <button data-sort={colKey} onClick={() => setSort(colKey, sk === colKey && sd === 'asc' ? 'desc' : 'asc')}>{label}</button>
    {filter && <span data-menu={colKey}>{filter.items.map(v => <button key={v} data-item={v} onClick={() => filter.on(v)}>{v}</button>)}</span>}
  </span>
)
const open = async (props = {}) => {
  const r = render(<UsageCompareModal asScreen t={T} drugs={DRUGS} isTenantManager
    onClose={() => {}} onReload={() => {}} Confirm={Confirm} ColMenu={Head} useSort={useSortReal}
    onRecompute={() => {}} {...props} />)
  await settle()
  return r
}
const chip = re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent.trim()))
const headCb = () => document.querySelector('thead input[type="checkbox"]')
const rowCbs = () => [...document.querySelectorAll('tbody input[type="checkbox"]')]
/* ★ 2026-11-15 — 백신·마약류는 체크가 **잠긴다**. 켤 수 있는 줄만 센다. */
const openCbs = () => rowCbs().filter(c => !c.disabled)
const pickedN = () => rowCbs().filter(c => c.checked).length
const bandText = () => {
  const d = [...document.querySelectorAll('div')].find(x => /지금 안 보입니다/.test(x.textContent || '') && (x.textContent || '').length < 160)
  return d ? d.textContent.replace(/\s+/g, ' ').trim() : null
}

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
  from.mockReset(); from.mockImplementation(() => mockTx())
  channel.mockReset()
  channel.mockImplementation(() => { const ch = { on: () => ch, subscribe: () => ch }; return ch })
})
afterEach(() => cleanup())

/* ══ ① 돌아가기 단추 ═══════════════════════════════════════════ */
describe('★★ ① 「← 재고현황」 — 「기준확인」 단추와 같은 보라 꼴', () => {
  it('★ 보라 테두리·연보라 바탕이다 (회색 꼴을 버렸다) · 새 색은 없다', () => {
    const i = APP.indexOf('← 재고현황</button>')
    expect(i, '돌아가기 단추를 못 찾았다').toBeGreaterThan(0)
    const seg = APP.slice(i - 420, i + 20)
    expect(seg, '보라 테두리').toContain(`border: '1px solid ' + t.purple`)
    expect(seg, '연보라 바탕').toContain('background: t.purpleL')
    expect(seg, '보라 글자').toContain('color: t.purple')
    expect(seg.includes(`border: '1px solid ' + t.border`), '옛 회색 꼴이 남았다').toBe(false)
    expect(/#[0-9A-Fa-f]{3,8}\b/.test(seg), '단추 줄에 새 색(hex)을 쓰지 말 것').toBe(false)
  })
})

/* ══ ③④ 상자 폭 ══════════════════════════════════════════════ */
describe('★★ ③④ 기준확인 상자 — 폭을 꽉 채운다', () => {
  it('★ 뿌리 여백이 다른 화면과 같은 표준 \'20px 24px\' 다', () => {
    expect(APP).toContain(`return <div style={{ textAlign: 'left', padding: '20px 24px' }}>`)
  })

  it('★ 화면은 maxWidth 가 없고, **창(보고서 「사용량 비교」)은 여전히 980** 이다', () => {
    expect(UCM).toContain(`? <div style={{ textAlign: 'left' }}>{_inner}</div>`)
    expect(UCM, '창은 980 그대로').toContain(`maxWidth: asScreen ? 'none' : 980, width: '100%'`)
    expect(UCM.includes(`maxWidth: 980, margin: '0 auto' }}>{_inner}`), '옛 가운데 정렬이 남았다').toBe(false)
  })

  it('★ 표준 여백을 쓰는 화면이 **하나 늘었다** — 기준확인이 합류했다', () => {
    const n = (APP.match(/padding: ?'20px 24px'/g) || []).length
    expect(n, '표준 여백 화면이 줄면 안 된다').toBeGreaterThanOrEqual(20)
  })
})

/* ══ ⑤ 표 머리 「전체 선택」 ═══════════════════════════════════ */
describe('★★ ⑤ 표 머리 「전체 선택」 — 보이는 줄만', () => {
  it('★ 표 머리에 체크가 생겼다 (전에는 빈 칸이었다)', async () => {
    await open()
    const cb = headCb()
    expect(cb, '머리 체크를 못 찾았다').toBeTruthy()
    expect(cb.getAttribute('aria-label')).toBe('보이는 줄 전체 선택')
    expect(UCM.includes(`<th style={{ ...th, width: 34 }} aria-label="고르기" />`), '빈 칸이 남았다').toBe(false)
  })

  it('★ 일부만 켜져 있으면 **반쯤 표시**다 (indeterminate)', async () => {
    await open()
    const n = openCbs().length, k = pickedN()
    expect(k > 0 && k < n, `섞인 상태여야 한다 (켜짐 ${k} / 열린 줄 ${n})`).toBe(true)
    expect(headCb().indeterminate, '반쯤 표시').toBe(true)
    expect(headCb().checked, '다 켜진 것은 아니다').toBe(false)
  })

  it('★★ 누르면 보이는 줄이 **전부** 켜지고, 다시 누르면 전부 꺼진다', async () => {
    await open()
    const n = openCbs().length
    await act(async () => { fireEvent.click(headCb()) })
    expect(pickedN(), '전부 켜짐').toBe(n)
    expect(headCb().checked).toBe(true)
    expect(headCb().indeterminate).toBe(false)
    await act(async () => { fireEvent.click(headCb()) })
    expect(pickedN(), '전부 꺼짐').toBe(0)
    expect(headCb().checked).toBe(false)
    expect(headCb().indeterminate).toBe(false)
  })

  it('★★ 걸러 놓으면 **보이는 줄만** 바뀐다 — 숨은 체크는 그대로다', async () => {
    await open()
    /* 먼저 전부 켠다 */
    await act(async () => { fireEvent.click(headCb()) })
    const all = openCbs().length
    expect(all).toBeGreaterThan(1)
    /* 「백신 제외」로 거른다 — 백신 줄만 보인다 */
    /* ★ 잠기지 않은 줄로 걸러야 한다 — 백신은 체크가 잠겨 있어 끌 것이 없다 */
    const tinyChip = chip(/^극소량/)
    expect(tinyChip, '극소량 칩').toBeTruthy()
    await act(async () => { fireEvent.click(tinyChip) })
    const shownN = openCbs().length
    expect(shownN, '걸러져서 줄이 줄었다').toBeLessThan(all)
    /* 보이는 줄만 끈다 */
    await act(async () => { fireEvent.click(headCb()) })
    expect(pickedN(), '보이는 줄은 다 꺼졌다').toBe(0)
    /* 거르기를 풀면 **숨어 있던 체크가 그대로** 살아 있다 */
    await act(async () => { fireEvent.click(chip(/^사용 중/)) })
    expect(pickedN(), '숨어 있던 체크는 안 건드렸다').toBe(all - shownN)
  })

  it('★★ 숨은 체크 알림 띠가 그대로 동작한다', async () => {
    await open()
    await act(async () => { fireEvent.click(headCb()) })      /* 전부 켬 */
    expect(bandText(), '다 보이면 띠가 없다').toBeNull()
    await act(async () => { fireEvent.click(chip(/^극소량/)) })      /* 걸러서 숨김 */
    const txt = bandText()
    expect(txt, '숨은 체크 띠가 떠야 한다').toBeTruthy()
    expect(txt).toMatch(/체크한 \d+종 중 \d+종이 지금 안 보입니다/)
    expect(txt).toMatch(/「적용」을 누르면 체크한 \d+종 모두 바뀝니다/)
  })

  it('★ 읽기 전용(뷰어)은 머리 체크도 **못 누른다**', async () => {
    await open({ readOnly: true })
    const cb = headCb()
    expect(cb.disabled, '흐림·못 누름').toBe(true)
    expect(cb.getAttribute('title')).toBe(READ_ONLY_MSG)
  })

  it('★★ 적용 대상 규칙은 **한 글자도 안 바뀐다**', () => {
    /* 저장은 늘 **원본 p.rows** + 체크한 코드 Set 이다 — 보이는 줄로 좁히지 않는다 */
    expect(UCM).toContain('const rows = applyRows(p ? p.rows : [], finalPicked)')
    expect(UCM).toContain('applyRows(buildUsageCompare(drugs || [], fresh.rows, year, month).rows, finalPicked)')
    /* 「전체 선택」은 줄마다 누르는 toggle 과 **같은 길**(off/extra)만 쓴다 */
    const i = UCM.indexOf('function toggleAllShown()')
    expect(i, 'toggleAllShown 을 못 찾았다').toBeGreaterThan(0)
    const body = UCM.slice(i, UCM.indexOf('\n  }', i))   /* 함수 **안**만 본다 */
    expect(body).toContain('setOff(')
    expect(body).toContain('setExtra(')
    expect(/setPick|setFinal|applyRows|p\.rows/.test(body), '적용 규칙을 건드리면 안 된다').toBe(false)
  })

  it('★ 「고른 N종 적용」 셈이 머리 체크를 따라 움직인다', async () => {
    await open()
    await act(async () => { fireEvent.click(headCb()) })
    const n = openCbs().length
    expect(screen.getByRole('button', { name: new RegExp('고른 ' + n + '종 적용') }), '적용 단추 셈').toBeTruthy()
  })
})
