/* 기준확인·재고현황 화면 다듬기 (2026-11-14 이정화 님 승인 · PR A)
 *
 * ① 재고현황 「급변」 칩 넷을 **한 덩어리**로 — 보통 화면에서 「? 확인 필요」만 떨어지던 것을 고친다
 * ② 기준확인 흰 상자를 **가운데**로, 「← 재고현황」 머리 줄도 **왼쪽을 맞춘다**
 * ④ 요약 칩 다섯을 **눌러서 거르는 단추**로 — 비고 메뉴·체크와 **한 상태**
 * ⑤ 「출고 자동집계」에 짧은 설명(title) — **흐린 상태에서도** 뜬다
 *
 * ★★ 적용 대상 규칙은 **한 글자도 안 바뀐다** — 화면에서 거르는 것은 **보여 주는 줄**뿐이고,
 *   저장은 늘 `applyRows(원본 p.rows, 체크한 코드 Set)` 이다. 그것을 여기서 못 박는다.
 */
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
const { RECOMPUTE_TIP } = await import('./UsageCompareModal')
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
/* AAA·BBB 는 달라지는 보통 약 · VAC 는 백신 · TINY 는 극소량 */
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
  D({ drug_code: 'VAC', drug_name: '백신주', atc_code: 'J07BB02', recent_3m_usage: 9, recent_1m_usage: 3, monthly_avg: 3, safety_stock: 4 }),
  D({ drug_code: 'TINY', drug_name: '극소량약', recent_3m_usage: 30, recent_1m_usage: 10, monthly_avg: 10, safety_stock: 12 }),
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
const rowCodes = () => [...document.querySelectorAll('tbody tr')]
  .map(tr => (tr.textContent.match(/AAA|BBB|VAC|TINY/) || [''])[0]).filter(Boolean)

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
  from.mockReset(); from.mockImplementation(() => mockTx())
  channel.mockReset()
  channel.mockImplementation(() => { const ch = { on: () => ch, subscribe: () => ch }; return ch })
})
afterEach(() => cleanup())

/* ══ ① 급변 칩 묶음 ═══════════════════════════════════════════════ */
describe('★★ ① 재고현황 급변 칩 — 넷이 한 덩어리', () => {
  it('★★ 「급변」 글자와 칩 넷이 **nowrap 한 덩어리** 안에 있다', () => {
    const i = APP.indexOf(`<span style={{display:'inline-flex',gap:4,alignItems:'center',flexWrap:'nowrap'}}>`)
    expect(i, '묶는 덩어리를 못 찾았다').toBeGreaterThan(0)
    const seg = APP.slice(i, i + 900)
    expect(seg, '급변 글자').toContain(`>급변</span>`)
    expect(seg, '칩 넷').toContain(`[[SURGE_ALL,t.textM],['급증',t.red],['급감',t.blue],[SURGE_CHECK,t.textM]]`)
    /* 덩어리가 닫히는지 — 줄바꿈 꼴에 기대지 않고 **닫는 태그가 칩 뒤에** 오는지만 본다 */
    const k = seg.indexOf('surgeLabel(k)')
    expect(k, '칩 그리는 자리').toBeGreaterThan(0)
    expect(seg.slice(k, k + 160), '칩 뒤에 덩어리가 닫힌다').toContain('</span>')
  })

  it('★ 가로 스크롤은 넣지 않았다 (결정)', () => {
    const i = APP.indexOf(`flexWrap:'nowrap'}}>`)
    expect(APP.slice(i, i + 900).includes('overflowX'), '가로 스크롤을 넣지 말 것').toBe(false)
  })
})

/* ══ ② 상자 가운데 · 머리 줄 맞춤 ═══════════════════════════════ */
describe('★★ ② 기준확인 — 상자 가운데, 머리 줄도 왼쪽 맞춤', () => {
  it('★ 화면일 때 상자가 가운데다', () => {
    expect(UCM).toContain(`? <div style={{ textAlign: 'left', maxWidth: 980, margin: '0 auto' }}>{_inner}</div>`)
  })

  it('★ 창(보고서 「사용량 비교」)은 **한 글자도 안 바뀐다**', () => {
    expect(UCM).toContain(`: <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',`)
  })

  it('★ 머리 줄(← 재고현황)도 같은 틀 안이다 — 왼쪽이 맞는다', () => {
    expect(APP).toContain(`flexWrap: 'wrap', maxWidth: 980, margin: '0 auto 10px' }}>`)
  })
})

/* ══ ④ 칩 다섯이 눌러서 거른다 ═══════════════════════════════════ */
describe('★★ ④ 칩 다섯 — 눌러서 거르기', () => {
  it('★ 다섯 칩이 모두 **단추**다', async () => {
    await open()
    for (const re of [/^사용 중 \d+종$/, /^달라짐 \d+종$/, /^적용 \d+종$/, /^백신 제외 \d+종$/, /^극소량 \d+종$/]) {
      const b = chip(re)
      expect(b, String(re)).toBeTruthy()
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('aria-pressed')).toMatch(/true|false/)
    }
  })

  it('★★ 「사용 중」을 누르면 거르기가 모두 풀린다', async () => {
    await open()
    fireEvent.click(chip(/^사용 중 \d+종$/))
    await settle(3)
    expect(chip(/^사용 중 \d+종$/).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText(/가나다정 적용하기/), '모든 줄이 보인다').toBeTruthy()
  })

  it('★★ 「백신 제외」를 누르면 백신 줄만 보인다', async () => {
    await open()
    fireEvent.click(chip(/^백신 제외 \d+종$/))
    await settle(3)
    expect(chip(/^백신 제외 \d+종$/).getAttribute('aria-pressed')).toBe('true')
    expect(rowCodes()).toEqual(['VAC'])
  })

  it('★★ 「극소량」을 누르면 극소량 줄만 보인다', async () => {
    await open()
    fireEvent.click(chip(/^극소량 \d+종$/))
    await settle(3)
    expect(rowCodes()).toEqual(['TINY'])
  })

  it('★★ 「적용 N종」을 누르면 **체크한 약만** 보인다', async () => {
    await open()
    fireEvent.click(chip(/^사용 중 \d+종$/))     /* 먼저 전부 보이게 */
    await settle(3)
    const all = rowCodes()
    expect(all.length, '여러 줄이 있어야 뜻이 있다').toBeGreaterThan(1)
    /* 한 줄의 체크를 푼다 */
    fireEvent.click(screen.getByLabelText(/가나다정 적용하기/))
    await settle(3)
    fireEvent.click(chip(/^적용 \d+종$/))
    await settle(3)
    expect(rowCodes(), '체크를 푼 AAA 는 안 보인다').not.toContain('AAA')
    expect(rowCodes(), '백신은 처음부터 체크가 아니다').not.toContain('VAC')
    expect(rowCodes().sort()).toEqual(['BBB', 'TINY'])
  })

  it('★★ 칩과 「달라지는 약만 보기」 체크가 **한 상태**다', async () => {
    await open()
    fireEvent.click(chip(/^사용 중 \d+종$/))
    await settle(3)
    expect(document.querySelector('input[type=checkbox]').checked, '전부 보기면 체크가 풀린다').toBe(false)
    fireEvent.click(chip(/^달라짐 \d+종$/))
    await settle(3)
    expect(document.querySelector('input[type=checkbox]').checked, '달라짐이면 체크가 켜진다').toBe(true)
  })

  it('★★ 거르기를 바꾸는 **문이 하나**다 — 다른 길을 만들지 않았다', () => {
    expect(UCM).toContain('function setFilterTo(kind)')
    expect(UCM).toContain('function changeNote(v) { setNoteF(v); setOnlyPicked(false) }')
    /* 칩·체크가 모두 그 문으로 들어간다 */
    expect(UCM).toContain('onClick={() => setFilterTo(k)}')
    expect(UCM).toContain(`onChange={e => setFilterTo(e.target.checked ? 'moved' : 'all')}`)
  })

  it('★★★ 적용 대상 규칙은 **한 글자도 안 바뀌었다**', () => {
    /* 저장은 늘 원본 전체 + 체크한 코드 집합이다 — 화면 거르기와 무관하다 */
    expect(UCM).toContain('const rows = applyRows(p ? p.rows : [], finalPicked)')
    expect(UCM).toContain('applyRows(buildUsageCompare(drugs || [], fresh.rows, year, month).rows, finalPicked)')
    expect(UCM.includes('applyRows(shown'), '보이는 줄로 저장하면 안 된다').toBe(false)
  })

  it('★★ 걸러서 안 보이는 체크 약은 띠로 알린다 — 이미 있던 것이 살아 있다', () => {
    expect(UCM).toContain('const hiddenPicked = [...finalPicked].filter(c => !shownSet.has(c)).length')
    expect(UCM).toContain('종이 지금 안 보입니다')
    expect(UCM).toContain('「적용」을 누르면 체크한')
  })

  it('★ 칩 모양은 재고현황 급변 칩과 **같은 꼴**이다 — 새 색 없음', () => {
    const i = UCM.indexOf(`[['all', '사용 중 '`)
    expect(i, '칩 묶음을 못 찾았다').toBeGreaterThan(0)
    const seg = UCM.slice(i, i + 1100)
    expect(seg).toContain(`padding: '3px 9px', borderRadius: 7`)
    expect(seg).toContain(`background: on ? c + '18' : 'transparent'`)
    expect(seg).toContain(`fontSize: 10, fontWeight: on ? 700 : 500`)
    expect(seg.match(/#[0-9a-fA-F]{3,8}\b/g) || [], '새 색을 쓰지 말 것').toEqual([])
  })
})

/* ══ ⑤ 출고 자동집계 설명 ═══════════════════════════════════════ */
describe('★★ ⑤ 「출고 자동집계」 설명', () => {
  it('★ 문구가 정해진 그대로다', () => {
    expect(RECOMPUTE_TIP).toBe('마감한 달 출고로 사용량·안전재고를 다시 셉니다 · 마약·향정·백신·수기 약은 제외')
  })

  it('★★ 관리자에게 설명이 붙는다', async () => {
    await open()
    const b = chip(/^출고 자동집계$/)
    expect(b.getAttribute('title')).toBe(RECOMPUTE_TIP)
  })

  it('★★ 읽기 전용 — **흐린 상태에서도** 뜬다 (읽기 전용 안내 + 설명)', async () => {
    await open({ readOnly: true, isTenantManager: false })
    const b = chip(/^출고 자동집계$/)
    expect(b.disabled, '흐려야 한다').toBe(true)
    expect(b.getAttribute('title')).toBe(READ_ONLY_MSG + ' · ' + RECOMPUTE_TIP)
  })
})
