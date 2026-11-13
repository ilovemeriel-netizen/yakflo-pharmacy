/* ★ 서버가 거절하면 **절대 초록 성공 띠가 뜨지 않는다** (2026-11-05 이정화 님 요청)

   왜 — 초록 띠는 사용자가 「저장됐다」고 읽는 신호다. 틀리면 안 바뀐 값을 바뀐 줄 알고 넘어간다.
   2026-11-05 마약·향정 「적용」이 만료된 로그인표 때문에 문 앞에서 거절됐고, DB 에는 요청이
   닿지도 않았다. 그래서 거절·오류 때 화면이 어떻게 보이는지를 못 박는다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

let READ = { data: [], error: null, count: 0 }
let RPC = { data: 18, error: null }
const rpcCalls = []
vi.mock('./lib/supabase', () => {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, lt: () => q, order: () => q,
    then(res) { return Promise.resolve(READ).then(res) },
  }
  return { supabase: {
    from: () => q,
    rpc: (...a) => { rpcCalls.push(a); return Promise.resolve(RPC) },
  } }
})

const T = {
  bg: '#F7F6F3', card: '#FFF', cardSolid: '#FFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', shadowH: 'none',
}
const DRUGS = [
  { drug_code: 'ZPD', drug_name: '졸피드정10mg', status: '사용', narcotic_type: '향정', current_qty: 100, recent_1m_usage: 44, recent_3m_usage: 144.5, prev_year_usage: 500, monthly_avg: 48, safety_stock: 58, max_stock: 144 },
  { drug_code: 'ATV', drug_name: '아티반정1mg', status: '사용', narcotic_type: '향정', current_qty: 242.5, recent_1m_usage: 241.5, recent_3m_usage: 584.5, prev_year_usage: 1742.5, monthly_avg: 195, safety_stock: 234, max_stock: 585 },
]
/* 3개월 창에 들어가는 출고 — 미리보기가 그려지도록 최소한만 */
const TX = [
  { drug_code: 'ZPD', type: '출고', transaction_date: '2026-10-31', quantity: 63 },
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-10-20', quantity: 70 },
]

/* 확인 창 — 진짜 단추를 그려서 「적용」을 끝까지 누를 수 있게 한다 */
const Confirm = ({ onConfirm }) => (
  <button data-testid="go" onClick={onConfirm}>확인</button>
)

let Modal
beforeEach(async () => {
  rpcCalls.length = 0
  READ = { data: TX, error: null, count: TX.length }
  RPC = { data: 18, error: null }
  Modal = (await import('./NarcoticUsageModal.jsx')).default
})
afterEach(() => cleanup())

/* ★ 머리 정렬 부품 — 화면에서는 App.jsx 가 넘긴다(순환 import 회피).
   시험에서도 같은 자리를 채워야 창이 뜬다. 정렬 동작 자체는
   src/NarcoticUsageSort.test.jsx 가 따로 못 박는다. */
const Head = ({ label }) => <>{label}</>
const useSortStub = () => ({ sk: '', sd: 'asc', setSort: () => {} })
const open = () => render(
  <Modal t={T} drugs={DRUGS} onClose={() => {}} isTenantManager onReload={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortStub} />)

const applyBtn = () => screen.queryByRole('button', { name: /기준으로 적용/ })
const greenBand = () => screen.queryByText(/적용 완료/)
const bodyText = () => document.body.textContent || ''

async function press() {
  await waitFor(() => expect(applyBtn()).toBeTruthy())
  await waitFor(() => expect(applyBtn().disabled).toBe(false))
  applyBtn().click()
  await waitFor(() => expect(screen.queryByTestId('go')).toBeTruthy())
  screen.getByTestId('go').click()
}

describe('① 로그인이 풀려 거절됐을 때 (401)', () => {
  beforeEach(() => { RPC = { data: null, error: { code: 'PGRST301', message: 'JWT expired', status: 401 } } })

  it('★ 초록 「적용 완료」 띠가 뜨지 않는다', async () => {
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('적용하지 못했습니다'))
    expect(greenBand(), '거절됐는데 초록 띠가 떴다').toBeNull()
    expect(bodyText()).not.toContain('다시 셌습니다')
  })

  it('★ 빨간 글씨로 사유가 뜬다 — 기존 경고 자리·색 그대로', async () => {
    open()
    await press()
    const line = await waitFor(() => {
      const el = [...document.querySelectorAll('div')].find(d =>
        d.children.length === 0 && /적용하지 못했습니다/.test(d.textContent))
      expect(el).toBeTruthy()
      return el
    })
    expect(line.style.color, '빨강(기존 red 토큰)이어야 한다').toBe('rgb(198, 40, 40)')
    expect(line.style.fontSize, '기존 크기 그대로').toBe('12px')
  })

  it('★ 「로그인이 풀렸습니다 — 새로고침」 안내가 들어 있다', async () => {
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('로그인이 풀렸습니다'))
    expect(bodyText()).toContain('새로고침')
  })

  it('단추를 다시 누를 수 있다 — 막힌 채로 남지 않는다', async () => {
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('적용하지 못했습니다'))
    expect(applyBtn().disabled).toBe(false)
    expect(bodyText()).not.toContain('적용 중…')
  })
})

describe('② 그 밖의 오류 (권한 없음 42501)', () => {
  beforeEach(() => { RPC = { data: null, error: { code: '42501', message: 'permission denied for function app_recompute_usage' } } })

  it('★ 초록 띠가 뜨지 않고 빨간 글씨가 뜬다', async () => {
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('적용하지 못했습니다'))
    expect(greenBand()).toBeNull()
  })
  it('★ 로그인 안내로 바꿔치기하지 않는다 — 권한 문제는 권한 문제로 알린다', async () => {
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('적용하지 못했습니다'))
    expect(bodyText(), '엉뚱한 안내가 나갔다').not.toContain('로그인이 풀렸습니다')
    expect(bodyText()).toContain('permission denied')
  })
})

describe('③ 성공했을 때는 초록 띠가 뜬다 (거꾸로도 막는다)', () => {
  it('18종 — 초록 「적용 완료」', async () => {
    RPC = { data: 18, error: null }
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('적용 완료'))
    expect(bodyText()).toContain('18종')
    expect(bodyText()).not.toContain('적용하지 못했습니다')
    expect(rpcCalls.length).toBe(1)
    expect(rpcCalls[0][0]).toBe('app_recompute_usage')
  })
  it('0종 — 초록이지만 「바뀐 것이 없습니다」로 알린다', async () => {
    RPC = { data: 0, error: null }
    open()
    await press()
    await waitFor(() => expect(bodyText()).toContain('적용 완료'))
    expect(bodyText()).toContain('바뀐 것이 없습니다')
  })
})
