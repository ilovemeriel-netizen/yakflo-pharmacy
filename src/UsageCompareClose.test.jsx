/* ★ 2026-11-10 — 「적용을 눌렀는데 저장이 0건이고 오류도 안 보였다」의 원인을
   **진짜 확인 창(CountConfirmModal)** 으로 재현하고 못 박는다.
 *
 * ★ 밝혀 둘 것 — 이 시험은 **원인을 찾아내지 못했다.** 진짜 CountConfirmModal 로
 *   재어 보니 「적용」 클릭이 바깥 덮개까지 올라가 창을 닫는 일은 **일어나지 않았다.**
 *   2026-11-10 의 0건은 원인이 아직 미확인이다. 그래서 이 시험이 지키는 것은
 *   「원인이 무엇이든 **결과가 반드시 보인다**」 하나다.
 *
 * 못 박는 것
 *  ① 확인 창의 「적용」 클릭이 **창을 닫지 않는다**
 *  ② 창이 닫혀도 결과는 **부모 화면에 남는다**(onDone)
 *  ③ 오류면 부모 띠가 **빨간색**으로 남는다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

const UsageCompareModal = (await import('./UsageCompareModal')).default
const { CountConfirmModal } = await import('./App')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadow: '0 2px 8px rgba(0,0,0,0.06)', shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const DRUGS = [
  { drug_code: 'CFO', drug_name: '칼페온정', category: '경구제', status: '사용', current_qty: 100,
    recent_3m_usage: 93, recent_1m_usage: 30, prev_year_usage: 0,
    monthly_avg: 31, safety_stock: 38, max_stock: 93 },
]
const TXNS = [{ drug_code: 'CFO', type: '출고', transaction_date: '2026-09-10', quantity: 851 }]

function mockTx(rows) {
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, lt: () => chain,
    order: () => chain, limit: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    maybeSingle: () => Promise.resolve({ data: { snap_year: 2026, snap_month: 10 }, error: null }),
    then: res => Promise.resolve({ data: rows.slice(lo, hi + 1), count: rows.length, error: null }).then(res),
  }
  return chain
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }

/* ★ 부모를 **운영과 같게** 만든다 — onClose 가 오면 창을 진짜로 치운다. */
function Parent() {
  const [open, setOpen] = useState(true)
  const [msg, setMsg] = useState(null)
  return <div>
    {msg && <div data-testid="band" style={{ background: msg.ok ? T.greenL : T.redL, color: msg.ok ? T.green : T.red }}>
      {msg.ok ? '✅ ' : '❗ '}{msg.message}
    </div>}
    {open && <UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10} isTenantManager
      onClose={() => setOpen(false)} onReload={() => {}} onDone={setMsg} Confirm={CountConfirmModal} />}
    <div data-testid="open">{open ? 'yes' : 'no'}</div>
  </div>
}

beforeEach(() => { rpc.mockReset(); from.mockReset(); from.mockImplementation(() => mockTx(TXNS)) })
afterEach(() => cleanup())

async function pressApply() {
  render(<Parent />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: /고른 1종 적용/ }))
  await settle(2)
  /* 확인 창의 「적용」 — 진짜 CountConfirmModal 이 그린 단추다 */
  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  await settle(4)
}

describe('★ 확인 창의 「적용」이 창을 닫아 버리지 않는다', () => {
  it('창이 열린 채로 남는다', async () => {
    rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
    await pressApply()
    expect(screen.getByTestId('open').textContent).toBe('yes')
  })

  it('저장은 한 번만 간다', async () => {
    rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
    await pressApply()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('app_save_usage_bulk')
  })

  it('잘되면 초록 띠가 부모에 남는다', async () => {
    rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
    await pressApply()
    const band = screen.getByTestId('band')
    expect(band.textContent).toContain('적용 완료')
    expect(band.style.color).toBe('rgb(1, 151, 72)')      /* t.green */
  })
})

describe('★ 오류는 반드시 보인다', () => {
  it('빨간 띠가 부모에 남는다 — 창이 닫혀도 사라지지 않게', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '권한이 없습니다' } })
    await pressApply()
    const band = screen.getByTestId('band')
    expect(band.textContent).toContain('적용하지 못했습니다')
    expect(band.style.color).toBe('rgb(198, 40, 40)')     /* t.red */
  })

  it('창 안에도 같이 보인다', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '권한이 없습니다' } })
    await pressApply()
    expect(screen.getAllByText(/적용하지 못했습니다/).length).toBeGreaterThan(0)
  })

  it('★ 보낸 줄보다 적게 저장돼도 빨간 띠다', async () => {
    rpc.mockResolvedValue({ data: { saved: 0 }, error: null })
    await pressApply()
    const band = screen.getByTestId('band')
    expect(band.textContent).toContain('만 저장됐습니다')
    expect(band.style.color).toBe('rgb(198, 40, 40)')
  })
})
