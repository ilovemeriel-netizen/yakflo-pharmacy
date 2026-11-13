/* 사용량 비교 창 — 「3개월 출고 0」 칩으로 거르기 (2026-11-13 이정화 님 승인)
 *
 * ★★ 이 창에는 **「적용」 단추**가 있다. 걸러서 **안 보이게 된 약**이
 *    적용에서 빠지거나, 엉뚱한 약이 들어가면 사용량이 틀린 약에 저장된다.
 *    그래서 ⑥⑦⑭ 를 **실제로 눌러서** 못 박는다.
 *
 * 승인받은 범위
 *   · 누를 수 있는 칩은 「3개월 출고 0」 **하나뿐** — 나머지 5개는 그대로
 *   · 다시 누르면 풀린다
 *   · 눌림 모양은 재고현황 「급변」 단추와 같은 꼴 · **새 색 금지**
 *   · 적용 대상 규칙(원본 p.rows + 약품코드 Set) **변경 금지**
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

const UsageCompareModal = (await import('./UsageCompareModal')).default
const SRC = readFileSync(resolve(process.cwd(), 'src/UsageCompareModal.jsx'), 'utf8')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, ...o })

/* ★ 일부러 이렇게 골랐다 —
     · 체크되는 약(AAA·BBB·CCC)은 **출고 0 이 아니다** → 거르면 **전부 화면 밖**이 된다
       (운영 실측도 똑같았다: 2026-10 기준 체크 5종 가운데 출고0 은 0종)
     · 출고 0 인 약(ZZ1·ZZ2)은 기본 체크가 **꺼져** 있다 */
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
  D({ drug_code: 'CCC', drug_name: '마마마정', recent_3m_usage: 30, recent_1m_usage: 10, monthly_avg: 10, safety_stock: 12 }),
  D({ drug_code: 'ZZ1', drug_name: '영출고하나정', recent_3m_usage: 50, recent_1m_usage: 0, monthly_avg: 17, safety_stock: 20 }),
  D({ drug_code: 'ZZ2', drug_name: '영출고둘정', recent_3m_usage: 20, recent_1m_usage: 0, monthly_avg: 7, safety_stock: 8 }),
]
/* ZZ1·ZZ2 는 거래가 **한 줄도 없다** → 새 3개월 = 0, 옛 3개월 > 0 → 「3개월 출고 0」 */
const TXNS = [
  { drug_code: 'AAA', type: '출고', transaction_date: '2026-09-10', quantity: 9 },
  { drug_code: 'BBB', type: '출고', transaction_date: '2026-09-11', quantity: 600 },
  { drug_code: 'CCC', type: '출고', transaction_date: '2026-10-02', quantity: 3 },
]

function mockTx(rows) {
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, lt: () => chain,
    order: () => chain, limit: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    maybeSingle: () => Promise.resolve({ data: { snap_year: 2026, snap_month: 10 }, error: null }),
    then: (res) => Promise.resolve({ data: rows.slice(lo, hi + 1), count: rows.length, error: null }).then(res),
  }
  return chain
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>
function useSortReal(init) {
  const [v, set] = useState({ sk: init || '', sd: 'asc' })
  return { sk: v.sk, sd: v.sd, setSort: (k, d) => set({ sk: k, sd: d || 'asc' }) }
}
const Head = ({ colKey, label, setSort, sd, sk, filter }) => (
  <button data-filter={filter ? 'yes' : 'no'}
    onClick={() => setSort(colKey, sk === colKey && sd === 'asc' ? 'desc' : 'asc')}>{label}</button>
)

const open = async (props = {}) => {
  const r = render(<UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10}
    isTenantManager onClose={() => {}} onReload={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortReal} {...props} />)
  await settle(10)
  return r
}
const chip = () => screen.getByRole('button', { name: /^3개월 출고 0 \d+종$/ })
const pressChip = async () => { await act(async () => { fireEvent.click(chip()) }); await settle(4) }
const rowNames = () => [...document.querySelectorAll('tbody tr')]
  .map(tr => (tr.querySelector('td:nth-child(2) div')?.textContent || '').trim()).filter(Boolean)
const checkedLabels = () => [...document.querySelectorAll('tbody input[type="checkbox"]')]
  .filter(b => b.checked).map(b => b.getAttribute('aria-label'))
/* 「적용」까지 눌러 **실제로 DB 로 가는 줄**을 받아 온다 */
const applyNow = async () => {
  rpc.mockResolvedValue({ data: { saved: 3 }, error: null })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^고른 \d+종 적용$/ })) })
  await settle(3)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })) })
  await settle(8)
  const call = rpc.mock.calls[rpc.mock.calls.length - 1]
  return call[1].p_rows
}

beforeEach(() => { rpc.mockReset(); from.mockReset(); from.mockImplementation(() => mockTx(TXNS)) })
afterEach(() => cleanup())

describe('★ ①② 누를 수 있는 칩은 「3개월 출고 0」 하나뿐', () => {
  it('① 「3개월 출고 0」 칩이 단추이고 눌림 상태를 알린다', async () => {
    await open()
    const b = chip()
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    await pressChip()
    expect(chip().getAttribute('aria-pressed')).toBe('true')
  })
  it('② 다른 칩 5개는 그대로다 — 단추가 아니다', async () => {
    await open()
    for (const name of [/^사용 중 /, /^달라짐 /, /^적용 \d+종$/, /^백신 제외 /, /^극소량 /]) {
      expect(screen.queryByRole('button', { name }), '단추가 돼 버렸다: ' + name).toBeNull()
    }
  })
})

describe('★ ③④⑤ 거르기 · 숫자 · 다시 누르면 풀림', () => {
  it('③ 누르면 「3개월 출고 0」 인 줄만 남는다', async () => {
    await open()
    expect(rowNames()).toEqual(expect.arrayContaining(['가나다정', '영출고하나정']))
    await pressChip()
    expect(rowNames().slice().sort()).toEqual(['영출고둘정', '영출고하나정'])
  })
  it('★ ④ 칩에 적힌 숫자 = 걸러진 줄 수', async () => {
    await open()
    const n = Number((chip().textContent.match(/(\d+)종/) || [])[1])
    expect(n, '칩 숫자를 못 읽었다').toBeGreaterThan(0)
    await pressChip()
    expect(rowNames().length).toBe(n)
  })
  it('⑤ 다시 누르면 풀린다 — 줄 수가 돌아온다', async () => {
    await open()
    const before = rowNames().length
    await pressChip()
    expect(rowNames().length).toBeLessThan(before)
    await pressChip()
    expect(rowNames().length).toBe(before)
    expect(chip().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('★★ ⑥⑦⑭ 걸러도 체크·적용 대상이 그대로', () => {
  it('⑥ 걸렀다 풀면 체크가 그 약품에 그대로다', async () => {
    await open()
    const before = checkedLabels().slice().sort()
    expect(before.length, '체크된 줄이 없다 — 시험이 뜻을 잃는다').toBeGreaterThan(0)
    await pressChip()
    await pressChip()
    expect(checkedLabels().slice().sort()).toEqual(before)
  })
  it('★ ⑦ 「적용」에 넘어가는 줄이 거르기 전·후로 글자 단위로 같다', async () => {
    const a = await open()
    const plain = JSON.stringify(await applyNow())
    a.unmount(); cleanup(); rpc.mockReset()
    await open()
    await pressChip()                         /* 체크된 약이 전부 화면 밖으로 간다 */
    const filtered = JSON.stringify(await applyNow())
    expect(filtered).toBe(plain)
  })
  it('★ ⑭ 거르고 + 정렬까지 해도 적용 대상이 그대로다', async () => {
    const a = await open()
    const plain = JSON.stringify(await applyNow())
    a.unmount(); cleanup(); rpc.mockReset()
    await open()
    await pressChip()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '직전3개월' })) })
    await settle(4)
    expect(JSON.stringify(await applyNow())).toBe(plain)
  })
})

describe('★ ⑧⑨⑩ 숨은 체크 알림 띠', () => {
  const BAND = /체크한 (\d+)종 중 (\d+)종이 지금 안 보입니다 · 「적용」을 누르면 체크한 \1종 모두 바뀝니다/
  it('⑨ 거르기 전에는 띠가 없다', async () => {
    await open()
    expect(document.body.textContent).not.toMatch(BAND)
  })
  it('⑧ 걸러서 체크가 숨으면 승인받은 문구 그대로 뜬다', async () => {
    await open()
    const n = checkedLabels().length
    await pressChip()
    const m = document.body.textContent.match(BAND)
    expect(m, '띠가 안 떴다').not.toBeNull()
    expect(Number(m[1])).toBe(n)      /* 체크한 N종 */
    expect(Number(m[2])).toBe(n)      /* 이번 자료는 N종 전부가 화면 밖이다 */
  })
  it('⑩ 띠는 기존 주황 띠와 같은 모양이다 — 새 색이 아니다', () => {
    const i = SRC.indexOf('지금 안 보입니다')
    expect(i, '띠를 찾지 못했다').toBeGreaterThan(0)
    const near = SRC.slice(Math.max(0, i - 420), i)
    expect(near).toContain('background: t.amberL')
    expect(near).toContain('color: t.amber')
  })
})

describe('★ ⑪⑫⑬ 모양·색·적용 규칙', () => {
  it('⑪ 눌림 모양이 재고현황 단추와 같은 꼴이다', () => {
    expect(SRC).toContain('aria-pressed={zeroOnly}')
    expect(SRC).toContain("t.amber + '18'")
    expect(SRC).toContain("border: '1px solid ' + (zeroOnly ? t.amber : 'transparent')")
  })
  it('⑫ 새 색을 만들지 않았다 — hex 리터럴이 늘지 않았다', () => {
    const hex = [...new Set((SRC.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    expect(hex).toEqual(['#F0F0EB'])
  })
  it('★ ⑬ 적용 대상 규칙을 바꾸지 않았다 — 원본 p.rows + 약품코드 Set', () => {
    expect(SRC).toContain('const rows = applyRows(p ? p.rows : [], finalPicked)')
    expect(SRC).toContain('finalPicked.has(r.code)')
    /* 원본을 제자리에서 뒤집거나 잘라내지 않는다 */
    expect(/\b(p\.rows|p\.moved)\.(sort|splice|reverse)\(/.test(SRC), '원본을 건드렸다').toBe(false)
  })
  it('⑬-2 거르기는 **보기만** 좁힌다 — 복사본을 거른다', () => {
    expect(SRC).toContain('const shown = zeroOnly ? base0.filter(r => r.zeroOut) : base0')
  })
})
