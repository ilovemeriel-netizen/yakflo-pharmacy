/* 사용량 비교 창 — 머리 정렬 (2026-11-13 이정화 님 승인)
 *
 * ★★ 가장 중요한 것 — 이 창에는 **「적용」 단추**가 있다.
 *    보이는 차례가 바뀌었다고 **체크한 약이 달라지거나 저장되는 줄이 달라지면**
 *    사용량이 엉뚱한 약에 저장된다. 그래서 ②③ 을 실제로 돌려서 못 박는다.
 *
 * 못 박는 것 (시안 보고의 9가지)
 *   ① 원본 불변 — p.rows·p.moved 를 제자리에서 정렬하지 않는다
 *   ② 정렬 뒤에도 체크가 **그 약품에** 그대로다
 *   ③ 「적용」에 넘어가는 줄이 정렬 전·후로 **글자 단위로 같다**
 *   ④ 「고른 N종」 숫자가 안 바뀐다
 *   ⑤ 정렬한 상태에서 체크를 풀면 **그 약품만** 빠진다
 *   ⑥ 거르기가 안 나온다 — 머리글 부품에 filter 를 주지 않는다
 *   ⑦ 고르기 칸·비고에는 ⇅ 가 안 붙는다
 *   ⑧ 새 색 0개 · 새 라이브러리 0개
 *   ⑨ 부품은 부모가 넘긴다(순환 import 회피) — 화면 두 곳이 모두 넘긴다
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
const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, ...o })

/* 이름 차례와 숫자 차례가 **서로 다르게** 되도록 골랐다 —
   정렬이 실제로 줄을 뒤섞어야 ②③ 이 뜻이 있다. */
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
  D({ drug_code: 'CCC', drug_name: '마마마정', recent_3m_usage: 30, recent_1m_usage: 10, monthly_avg: 10, safety_stock: 12 }),
]
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
/* 확인 창 — 진짜 CountConfirmModal 은 App.jsx 안에 있어 불러올 수 없다.
   기존 시험(UsageCompareModal.test.jsx)과 **같은 모양**을 쓴다. */
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>

/* ★ 진짜 정렬 상태 — 시험에서 머리글을 눌러 차례를 바꿀 수 있게 한다 */
function useSortReal(init) {
  /* 화면의 useSort 와 같은 모양(useState)이라, 머리글을 누르면 **다시 그려진다** */
  const [v, set] = useState({ sk: init || '', sd: 'asc' })
  return { sk: v.sk, sd: v.sd, setSort: (k, d) => set({ sk: k, sd: d || 'asc' }) }
}
/* 머리글 부품 — 진짜 ColMenu 대신 **같은 자리**를 채우는 단추.
   filter 를 받으면 시험이 깨지도록 일부러 드러낸다(⑥). */
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
/* 화면에 보이는 약품 이름을 **줄 차례대로** 읽는다 */
const shownNames = () => [...document.querySelectorAll('tbody tr')]
  .map(tr => (tr.querySelector('td:nth-child(2) div')?.textContent || '').trim())
  .filter(Boolean)
/* 체크된 약품의 aria-label(=「이름 적용하기」) 목록 */
const checkedLabels = () => [...document.querySelectorAll('tbody input[type="checkbox"]')]
  .filter(b => b.checked).map(b => b.getAttribute('aria-label'))

beforeEach(() => { rpc.mockReset(); from.mockReset() })
afterEach(() => cleanup())

describe('★ ① 원본을 뒤집지 않는다 (소스 검사)', () => {
  it('복사본을 정렬한다', () => {
    expect(SRC).toContain('return [...list].sort(')
  })
  it('고르지 않았으면 원본을 그대로 돌려준다', () => {
    expect(SRC).toContain('if (!st || !st.sk) return list')
  })
  it('★ 제자리 정렬(p.rows.sort · shown.sort)을 하지 않는다', () => {
    expect(/\b(p\.rows|p\.moved|shown)\.sort\(/.test(SRC), '원본을 제자리에서 정렬했다').toBe(false)
  })
})

describe('★ ②④⑤ 정렬해도 체크가 그 약품에 그대로', () => {
  it('정렬하면 보이는 차례가 실제로 바뀐다 (시험이 뜻을 갖도록)', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    await open()
    const before = shownNames()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '약품' })) })
    await settle(4)
    const after = shownNames()
    expect(after.length).toBe(before.length)
    expect(after.join('|'), '차례가 그대로다 — 정렬이 안 걸렸다').not.toBe(before.join('|'))
  })

  it('★ 체크한 약품이 정렬 뒤에도 그대로다', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    await open()
    const before = checkedLabels().slice().sort()
    expect(before.length, '체크된 줄이 없다').toBeGreaterThan(0)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '직전3개월' })) })
    await settle(4)
    expect(checkedLabels().slice().sort()).toEqual(before)
  })

  it('★ ④ 「고른 N종」 숫자가 안 바뀐다', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    await open()
    const n1 = screen.getByText(/^적용 \d+종$/).textContent
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '월평균' })) })
    await settle(4)
    expect(screen.getByText(/^적용 \d+종$/).textContent).toBe(n1)
  })

  it('★ ⑤ 정렬한 상태에서 체크를 풀면 **그 약품만** 빠진다', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '약품' })) })
    await settle(4)
    const boxes = [...document.querySelectorAll('tbody input[type="checkbox"]')]
    const target = boxes[0]
    const label = target.getAttribute('aria-label')
    const others = checkedLabels().filter(x => x !== label).sort()
    await act(async () => { fireEvent.click(target) })
    await settle(4)
    expect(checkedLabels().includes(label), '푼 약품이 그대로 켜져 있다').toBe(false)
    expect(checkedLabels().slice().sort(), '엉뚱한 줄이 함께 빠졌다').toEqual(others)
  })
})

describe('★ ③ 「적용」에 넘어가는 줄이 정렬 전·후로 같다', () => {
  async function applyAndGetRows() {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /종 적용$/ })) })
    await settle(2)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })) })
    await settle(6)
    const call = rpc.mock.calls.at(-1)
    expect(call, 'RPC 가 불리지 않았다').toBeTruthy()
    return call[1].p_rows
  }

  it('★ 정렬 전·후의 p_rows 가 **글자 단위로** 같다', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    rpc.mockResolvedValue({ data: 3, error: null })

    await open()
    const before = JSON.stringify(await applyAndGetRows())
    cleanup()

    rpc.mockReset(); rpc.mockResolvedValue({ data: 3, error: null })
    await open()
    /* 두 번 눌러 **내림차순**까지 간 다음 적용한다 */
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '직전3개월' })) })
    await settle(3)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '직전3개월' })) })
    await settle(3)
    const after = JSON.stringify(await applyAndGetRows())

    expect(after).toBe(before)
  })
})

describe('★ ⑥⑦ 거르기는 「비고」에만 · 붙는 자리', () => {
  /* ★ 2026-11-13 이정화 님 승인으로 **「비고」에만** 거르기가 생겼다.
       값 칸 6개(약품·직전3개월·직전1개월·월평균·안전재고·상태)는 **그대로 ⇅ 만** 이다 —
       거르기가 그쪽으로 번지지 않게 막는 것이 이 시험의 원래 목적이고, 그 목적은 그대로다. */
  it('값 칸 6개에는 filter 를 주지 않는다 · 「비고」에만 준다 (소스)', () => {
    const uses = SRC.match(/<HeadMenu[^/]*\/>/g) || []
    expect(uses.length, '머리글 부품이 없다').toBeGreaterThan(0)
    const note = uses.filter(u => u.includes('colKey="note"'))
    expect(note.length, '비고 머리글이 하나여야 한다').toBe(1)
    expect(note[0], '비고에 거르기가 없다').toContain('filter')
    for (const u of uses.filter(u => !u.includes('colKey="note"'))) {
      expect(u, '값 칸에 거르기가 붙었다: ' + u).not.toContain('filter')
    }
  })
  it('실제로 그려진 머리글 — 값 칸 6개는 거르기 없음, 「비고」만 있음', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    await open()
    const heads = [...document.querySelectorAll('thead button')]
    expect(heads.length).toBeGreaterThan(0)
    for (const h of heads) {
      const want = h.textContent === '비고' ? 'yes' : 'no'
      expect(h.getAttribute('data-filter'), h.textContent + ' 의 거르기').toBe(want)
    }
  })
  it('★ ⑦ ⇅ 는 값 칸 6개 + 「비고」에 붙고, 고르기 칸에는 안 붙는다', async () => {
    from.mockImplementation(() => mockTx(TXNS))
    await open()
    const names = [...document.querySelectorAll('thead button')].map(b => b.textContent)
    expect(names).toEqual(['약품', '직전3개월', '직전1개월', '월평균', '안전재고', '상태', '비고'])
    /* 맨 앞 고르기 칸에는 머리글 부품이 없다 — 칸 수보다 부품이 하나 적다 */
    expect(document.querySelectorAll('thead th').length).toBe(names.length + 1)
  })
})

describe('★ ⑧⑨ 그 밖', () => {
  it('새 색을 만들지 않았다 — hex 리터럴이 늘지 않았다', () => {
    /* #F0F0EB 는 **원래 있던** 값이다(「차이 없음」 뱃지). 그 하나뿐이어야 한다. */
    const hex = [...new Set((SRC.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    expect(hex).toEqual(['#F0F0EB'])
  })
  it('새 라이브러리를 들여오지 않았다', () => {
    const imports = (SRC.match(/^import .*$/gm) || []).join('\n')
    const froms = [...imports.matchAll(/from '([^']+)'/g)].map(m => m[1])
    /* ★ react-dom 은 **새 라이브러리가 아니다**(2026-11-13 추가) — 이미 쓰고 있는 것이다.
         App.jsx 가 2줄에서 createPortal 을 같은 데서 들여오고, package.json 에도 들어 있다.
         인쇄할 표를 덮개 밖(body 바로 밑)으로 내보내려면 createPortal 이 있어야 한다.
       ★ 엑셀(xlsx)은 **동적으로**(await import) 부르므로 이 목록에 잡히지 않는다 —
         그것도 이미 저장소에 있는 것이다. 진짜 새 라이브러리는 여전히 걸린다. */
    for (const fr of froms) {
      expect(fr === 'react' || fr === 'react-dom' || fr.startsWith('./'), '새 라이브러리: ' + fr).toBe(true)
    }
  })
  it('★ ⑨ 부품은 부모가 넘긴다 — 화면 **두 곳** 모두', () => {
    expect(SRC.includes("from './App"), '이 파일이 App.jsx 를 들여왔다').toBe(false)
    /* ★ 2026-11-14 — 손잡이가 늘었다(asScreen·onRecompute). 뜻은 「부모가 넘긴다」이므로 거기만 본다. */
    expect(SRC).toContain('Confirm, ColMenu, useSort')
    const passes = (APP.match(/ColMenu=\{ColMenu\} useSort=\{useSort\}/g) || []).length
    /* 사용량 갱신 화면 · 향정마약 화면 · 보고서 화면 · 백신 화면 */
    expect(passes, '넘기는 자리가 모자라다').toBeGreaterThanOrEqual(3)
  })
})
