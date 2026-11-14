/* 사용량 비교 창 — 진짜 부품을 렌더해 확인한다 (2026-11-09).
 *
 * 못 박는 것
 *  ① 창을 열기만 해서는 **DB 에 아무것도 쓰지 않는다**
 *  ② 「적용」은 **한 번의 호출**로 한다 — 전부 성공 아니면 전부 취소가 깨지지 않게
 *  ③ 보내는 칸은 3개월·1개월 **둘뿐**이다 (전년은 수기 유지)
 *  ④ 극소량 줄은 r3 가 **null** 이다
 *  ⑤ 백신·출고0 줄은 체크가 꺼져 있고, 체크를 켜면 보내는 줄에 들어간다
 *  ⑥ 기준월을 안 넘기면 **가장 최근에 마감된 달**을 스스로 찾는다
 *  ⑦ 새 색을 만들지 않았다 — 부모가 준 t 값만 쓴다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

const UsageCompareModal = (await import('./UsageCompareModal')).default
const SRC = readFileSync(resolve(process.cwd(), 'src/UsageCompareModal.jsx'), 'utf8')
/* ★ 머리 정렬 부품 — 화면에서는 App.jsx 가 넘긴다(순환 import 회피).
   시험에서도 같은 자리를 채워야 창이 뜬다. 정렬 동작은
   src/UsageCompareSort.test.jsx 가 따로 못 박는다. */
const Head = ({ label }) => <>{label}</>
const useSortStub = () => ({ sk: '', sd: 'asc', setSort: () => {} })


const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, ...o })

const DRUGS = [
  D({ drug_code: 'CFO', drug_name: '칼페온정', recent_3m_usage: 93, recent_1m_usage: 30,
    monthly_avg: 31, safety_stock: 38, max_stock: 93 }),
  D({ drug_code: 'TTFLU', drug_name: '지씨플루프리필드시린지주', atc_code: 'J07BB02',
    recent_3m_usage: 2, recent_1m_usage: 2, monthly_avg: 1, safety_stock: 2 }),
  D({ drug_code: 'LDMX', drug_name: '삼아리도멕스로션', recent_3m_usage: 2, recent_1m_usage: 1,
    monthly_avg: 1, safety_stock: 2, max_stock: 3 }),
  D({ drug_code: 'ALM', drug_name: '알말정10mg', recent_3m_usage: 155, recent_1m_usage: 0,
    monthly_avg: 52, safety_stock: 63 }),
]
const TXNS = [
  { drug_code: 'CFO', type: '출고', transaction_date: '2026-09-10', quantity: 851 },
  { drug_code: 'TTFLU', type: '출고', transaction_date: '2026-10-02', quantity: 124 },
  { drug_code: 'LDMX', type: '출고', transaction_date: '2026-09-02', quantity: 1 },
]

/* supabase.from('transactions') 사슬을 흉내낸다 — **range() 를 지킨다.**
   ★ 지키지 않으면 「쪽 나눠 읽기」가 도는지 시험할 수 없다. 운영에서 1,079줄 중
     79줄이 조용히 빠졌던 것이 바로 이 자리다(2026-11-10). */
function mockTx(rows, opt) {
  const o = opt || {}
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, lt: () => chain,
    order: () => chain, limit: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    maybeSingle: () => Promise.resolve({ data: { snap_year: 2026, snap_month: 10 }, error: null }),
    then: (res) => {
      if (o.error) return Promise.resolve({ data: null, count: null, error: o.error }).then(res)
      const page = rows.slice(lo, hi + 1)
      /* count 는 PostgREST 처럼 **전체** 줄 수를 준다 */
      const count = o.count == null ? rows.length : o.count
      return Promise.resolve({ data: page, count, error: null }).then(res)
    },
  }
  return chain
}

/* 한 쪽을 읽고 돌아올 때마다 act 를 한 번씩 돌려 준다 */
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
/* 확인 창 — 진짜 CountConfirmModal 은 App.jsx 안에 있어 불러올 수 없다.
   여기서는 「확인을 누르면 onConfirm 이 돈다」만 흉내낸다. */
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>

async function open(props = {}) {
  from.mockImplementation(() => mockTx(TXNS))
  const r = render(<UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10}
    isTenantManager onClose={() => {}} onReload={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortStub} {...props} />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return r
}

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { saved: 1 }, error: null }); from.mockReset() })
afterEach(() => cleanup())

describe('① 열기만 해서는 아무것도 쓰지 않는다', () => {
  it('창을 열어도 rpc 를 부르지 않는다', async () => {
    await open()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('「적용」을 눌러야 바뀐다고 적혀 있다', async () => {
    await open()
    expect(screen.getByText(/「적용」을 눌러야 바뀝니다/)).toBeTruthy()
  })
})

describe('②③④⑤ 적용 — 한 번에, 두 칸만, 극소량은 null', () => {
  async function applyNow() {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /적용$/ }))
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '적용' }))
    await act(async () => { await Promise.resolve() })
  }

  it('★ rpc 를 딱 한 번 부른다 (전부 아니면 전부 취소)', async () => {
    await applyNow()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('app_save_usage_bulk')
  })

  it('★ 보내는 칸은 3개월·1개월 둘뿐 — 전년은 없다', async () => {
    await applyNow()
    const a = rpc.mock.calls[0][1]
    expect(a.p_fields).toEqual(['recent_3m_usage', 'recent_1m_usage'])
    expect(a.p_fields).not.toContain('prev_year_usage')
    expect(a.p_zero_missing).toBe(false)
  })

  it('★ 극소량 줄은 r3 가 null 이다', async () => {
    await applyNow()
    const rows = rpc.mock.calls[0][1].p_rows
    const ldmx = rows.find(r => r.code === 'LDMX')
    expect(ldmx).toBeTruthy()
    expect(ldmx.r3).toBe(null)
    expect(ldmx.r1).toBe(0)
  })

  it('★ 백신·출고0 은 기본으로 안 보낸다', async () => {
    await applyNow()
    const codes = rpc.mock.calls[0][1].p_rows.map(r => r.code)
    expect(codes).toContain('CFO')
    expect(codes).not.toContain('TTFLU')   /* 백신 */
    expect(codes).not.toContain('ALM')     /* 3개월 사용량 0 */
  })

  it('체크를 켜면 그 약도 보낸다', async () => {
    await open()
    fireEvent.click(screen.getByLabelText('지씨플루프리필드시린지주 적용하기'))
    fireEvent.click(screen.getByRole('button', { name: /적용$/ }))
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '적용' }))
    await act(async () => { await Promise.resolve() })
    expect(rpc.mock.calls[0][1].p_rows.map(r => r.code)).toContain('TTFLU')
  })

  it('체크를 풀면 그 약은 빠진다', async () => {
    await open()
    /* 기본 체크는 칼페온정·삼아리도멕스로션 둘이다(극소량도 기본은 켜짐) */
    expect(screen.getByText('고른 2종 적용')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('칼페온정 적용하기'))
    expect(screen.getByText('고른 1종 적용')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('삼아리도멕스로션 적용하기'))
    expect(screen.getByText('고른 0종 적용')).toBeTruthy()
  })
})

describe('⑥ 기준월', () => {
  it('넘긴 연·월을 쓴다', async () => {
    await open()
    expect(screen.getByText(/최근 마감 2026년 10월/)).toBeTruthy()
    expect(screen.getByText(/8·9·10월/)).toBeTruthy()
  })

  it('★ 안 넘기면 마감표에서 스스로 찾는다', async () => {
    await open({ year: undefined, month: undefined })
    expect(from).toHaveBeenCalledWith('monthly_snapshots')
    expect(screen.getByText(/최근 마감 2026년 10월/)).toBeTruthy()
  })
})

describe('⑦ 색 — 새 색을 만들지 않았다', () => {
  it('소스에 하드코딩된 색이 팔레트 밖에 없다', () => {
    /* 허용: 흰 글씨 · 덮개 검정 · 회색 칩 바탕(App.jsx 의 SB 와 같은 값)
       ★ #000·#666 은 **인쇄 전용**이다(2026-11-13 추가). 종이는 흑백이라 화면 팔레트를
         쓰지 않는다 — 향정 인쇄(NARC_PRINT_CSS)가 쓰는 **바로 그 값**이다(#000 5곳·#666 1곳).
         화면 쪽에 이 값이 새로 들어오면 여전히 걸린다. */
    const ok = new Set(['#fff', '#F0F0EB', '#000', '#666'])
    const found = (SRC.match(/#[0-9A-Fa-f]{3,8}/g) || []).filter(x => !ok.has(x))
    expect(found).toEqual([])
  })

  it('덮개는 기존 모달과 같은 값이다', () => {
    expect(SRC).toContain("background: 'rgba(0,0,0,0.4)'")
    expect(SRC).toContain('zIndex: 1100')
  })
})

describe('표 — 극소량은 3개월을 그대로 둔다고 보인다', () => {
  it('★ 극소량 줄에 「그대로」가 적혀 있다', async () => {
    await open()
    expect(screen.getByText(/2 \(그대로\)/)).toBeTruthy()
  })

  it('비고 뱃지가 갈래를 알려 준다', async () => {
    await open()
    expect(screen.getByText('백신 — 제외')).toBeTruthy()
    expect(screen.getByText('3개월 사용량 0')).toBeTruthy()
    expect(screen.getByText('극소량 — 3개월 그대로')).toBeTruthy()
  })
})

/* ★ 2026-11-10 — 운영에서 「적용했는데 0건」이 났다. 뿌리 셋을 못 박는다. */
describe('★ 1,000줄 조용한 절단 — 쪽을 나눠 끝까지 읽는다', () => {
  const many = n => Array.from({ length: n }, () => ({
    drug_code: 'CFO', type: '출고', transaction_date: '2026-09-10', quantity: 1,
  }))

  it('1,079줄을 두 쪽으로 나눠 **전부** 읽는다', async () => {
    from.mockImplementation(() => mockTx(many(1079)))
    render(<UsageCompareModal t={T} drugs={[D({ drug_code: 'CFO', drug_name: '칼페온정' })]}
      year={2026} month={10} isTenantManager onClose={() => {}} Confirm={Confirm}
      ColMenu={Head} useSort={useSortStub} />)
    await settle(10)
    /* 1,079 이 다 들어왔으면 직전3개월이 1,079 로 보인다 */
    expect(screen.getByText('1,079')).toBeTruthy()
    expect(screen.queryByText(/다 읽지 못했습니다/)).toBeNull()
  })

  it('★ 그래도 잘리면 「적용」을 막는다', async () => {
    /* 전체는 1,079 인데 1,000 만 왔다고 흉내낸다 */
    from.mockImplementation(() => mockTx(many(1000), { count: 1079 }))
    render(<UsageCompareModal t={T} drugs={[D({ drug_code: 'CFO', drug_name: '칼페온정' })]}
      year={2026} month={10} isTenantManager onClose={() => {}} Confirm={Confirm}
      ColMenu={Head} useSort={useSortStub} />)
    await settle(10)
    expect(screen.getByText(/다 읽지 못했습니다/)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /적용$/ })
    expect(btn.disabled).toBe(true)
  })
})

describe('★ 확인 창의 클릭이 창을 닫지 않는다', () => {
  it('「적용」을 눌러도 onClose 가 불리지 않는다', async () => {
    const onClose = vi.fn()
    await open({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /적용$/ }))
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '적용' }))
    await settle(2)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('덮개를 누르면 닫힌다 (원래 동작은 그대로)', async () => {
    const onClose = vi.fn()
    const { container } = await open({ onClose })
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('★ 결과를 창 밖으로도 알린다 (숨은 오류 금지)', () => {
  async function run() {
    fireEvent.click(screen.getByRole('button', { name: /적용$/ }))
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '적용' }))
    await settle(3)
  }

  it('잘되면 onDone 으로 ok 를 알린다', async () => {
    const onDone = vi.fn()
    rpc.mockResolvedValue({ data: { saved: 2 }, error: null })
    await open({ onDone })
    await run()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
  })

  it('★ 오류가 나면 onDone 으로 ok:false 를 알린다 — 창이 닫혀도 보이게', async () => {
    const onDone = vi.fn()
    rpc.mockResolvedValue({ data: null, error: { message: '권한이 없습니다' } })
    await open({ onDone })
    await run()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    expect(onDone.mock.calls[0][0].message).toContain('적용하지 못했습니다')
    expect(screen.getByText(/적용하지 못했습니다/)).toBeTruthy()
  })

  it('★ 던져진 예외도 삼키지 않는다', async () => {
    const onDone = vi.fn()
    rpc.mockRejectedValue(new Error('그물 밖 오류'))
    await open({ onDone })
    await run()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
  })

  it('★ 보낸 줄보다 적게 저장되면 ok:false 로 알린다', async () => {
    const onDone = vi.fn()
    rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
    await open({ onDone })
    await run()
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    expect(onDone.mock.calls[0][0].message).toContain('만 저장됐습니다')
  })
})
