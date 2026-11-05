/* 마약·향정 창 — 거래 **조용한 절단** 막기 (2026-11-05 이정화 님 승인)

   ★ 무슨 일이 있었나
     창이 **모든 약의 출고**를 받아 와서 그 중 마약·향정만 골라냈다. 3개월 창의 출고가
     1,079건이라 Supabase 기본 한도 1,000줄에 걸려 **79건이 조용히 잘렸다**(오류 없음).
     그 안에 졸피드정10mg 2026-10-31 출고 63 이 있어 합계가 틀렸다.
       잘린 값 1개월 644 · 3개월 2,237
       옳은 값 1개월 707 · 3개월 2,300

   ★ 이 시험이 지키는 것
     ① 읽을 때 **마약·향정 코드만** `.in()` 으로 집어 온다 (1,079 → 29).
     ② 그래도 잘리면 **화면에 경고**가 뜨고 **적용 단추가 막힌다.**
     ③ 여전히 DB 에 **쓰지 않는다.**
     ④ 약품이 아직 안 왔을 때 빈 목록으로 읽어 「출고 0」으로 보이지 않는다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

/* 한 번의 읽기에서 돌려줄 것을 시험마다 갈아 끼운다 */
let REPLY = { data: [], error: null, count: 0 }
const calls = []
vi.mock('./lib/supabase', () => {
  const q = {
    select: (...a) => { calls.push(['select', ...a]); return q },
    eq: (...a) => { calls.push(['eq', ...a]); return q },
    in: (...a) => { calls.push(['in', ...a]); return q },
    gte: (...a) => { calls.push(['gte', ...a]); return q },
    lt: (...a) => { calls.push(['lt', ...a]); return q },
    order: () => q,
    update: (...a) => { calls.push(['update', ...a]); return q },
    insert: (...a) => { calls.push(['insert', ...a]); return q },
    upsert: (...a) => { calls.push(['upsert', ...a]); return q },
    delete: (...a) => { calls.push(['delete', ...a]); return q },
    then(res) { return Promise.resolve(REPLY).then(res) },
  }
  return { supabase: {
    from: (...a) => { calls.push(['from', ...a]); return q },
    rpc: (...a) => { calls.push(['rpc', ...a]); return Promise.resolve({ data: null, error: null }) },
  } }
})

const T = {
  bg: '#F7F6F3', card: '#FFF', cardSolid: '#FFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', shadowH: 'none',
}
/* 마약·향정 3종 + 한외마약 1종 + 일반 1종 — 좁히기가 **3종만** 집어야 한다 */
const DRUGS = [
  { drug_code: 'ZPD', drug_name: '졸피드정10mg', status: '사용', narcotic_type: '향정', current_qty: 100, recent_1m_usage: 44, recent_3m_usage: 144.5, prev_year_usage: 500, monthly_avg: 48, safety_stock: 58, max_stock: 144 },
  { drug_code: 'ATV', drug_name: '아티반정1mg', status: '사용', narcotic_type: '향정', current_qty: 242.5, recent_1m_usage: 241.5, recent_3m_usage: 584.5, prev_year_usage: 1742.5, monthly_avg: 195, safety_stock: 234, max_stock: 585 },
  { drug_code: 'MYPC', drug_name: '마이폴캡슐10mg', status: '사용', narcotic_type: '마약', current_qty: 292, recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 152, monthly_avg: 13, safety_stock: 16, max_stock: 39 },
  { drug_code: 'CHNS', drug_name: '코포나시럽', status: '사용', narcotic_type: '한외마약', recent_1m_usage: 752, recent_3m_usage: 2245, prev_year_usage: 0, monthly_avg: 748, safety_stock: 898, max_stock: 2244 },
  { drug_code: 'GABA', drug_name: '가바로닌캡슐100mg', status: '사용', narcotic_type: '일반', recent_1m_usage: 300, recent_3m_usage: 900, prev_year_usage: 3600, monthly_avg: 300, safety_stock: 360, max_stock: 900 },
]

let Modal
beforeEach(async () => {
  calls.length = 0
  REPLY = { data: [], error: null, count: 0 }
  Modal = (await import('./NarcoticUsageModal.jsx')).default
})
afterEach(() => cleanup())

const Confirm = () => null
const open = (extra = {}) => render(
  <Modal t={T} drugs={DRUGS} onClose={() => {}} isTenantManager onReload={() => {}}
    Confirm={Confirm} {...extra} />)

const applyBtn = () => screen.queryByRole('button', { name: /기준으로 적용/ })
const warn = () => screen.queryByTestId('narc-cut-warn')

describe('① 읽을 때 마약·향정 코드만 집어 온다', () => {
  it('★ `.in(drug_code, [...])` 로 좁힌다 — 마약·향정 3종만', async () => {
    open()
    await waitFor(() => expect(calls.some(c => c[0] === 'in')).toBe(true))
    const inCall = calls.find(c => c[0] === 'in')
    expect(inCall[1]).toBe('drug_code')
    expect([...inCall[2]].sort()).toEqual(['ATV', 'MYPC', 'ZPD'])
  })
  it('한외마약·일반은 집어 오지 않는다 — 그래서 1,079건이 29건이 된다', async () => {
    open()
    await waitFor(() => expect(calls.some(c => c[0] === 'in')).toBe(true))
    const codes = calls.find(c => c[0] === 'in')[2]
    expect(codes).not.toContain('CHNS')
    expect(codes).not.toContain('GABA')
  })
  it('전체 줄 수를 함께 받는다 — count 로 절단을 잡기 때문이다', async () => {
    open()
    await waitFor(() => expect(calls.some(c => c[0] === 'select')).toBe(true))
    const sel = calls.find(c => c[0] === 'select')
    expect(sel[2]).toEqual({ count: 'exact' })
  })
  it('읽는 표는 transactions 이고 출고만 본다', async () => {
    open()
    await waitFor(() => expect(calls.some(c => c[0] === 'from')).toBe(true))
    expect(calls.find(c => c[0] === 'from')[1]).toBe('transactions')
    expect(calls.find(c => c[0] === 'eq')).toEqual(['eq', 'type', '출고'])
  })
})

describe('② 잘리면 경고가 뜨고 적용이 막힌다', () => {
  it('★ 1,079건 가운데 1,000건만 오면 — 경고 + 적용 막힘 (실제 사례 흉내)', async () => {
    /* 1,000줄을 받았지만 전체는 1,079건이다 — 79건이 빠졌다 */
    REPLY = {
      data: Array.from({ length: 1000 }, (_, i) => ({
        drug_code: 'ATV', type: '출고', transaction_date: '2026-10-15', quantity: 0, i,
      })),
      error: null, count: 1079,
    }
    open()
    await waitFor(() => expect(warn()).not.toBeNull())
    expect(warn().textContent).toContain('1,079')
    expect(warn().textContent).toContain('79건 빠짐')
    expect(warn().textContent).toContain('적용하지 마시고')
    /* ★ 적용 단추가 막혀 있어야 한다 — 틀린 숫자가 저장되면 발주 기준이 망가진다 */
    await waitFor(() => expect(applyBtn()).not.toBeNull())
    expect(applyBtn().disabled).toBe(true)
  })
  it('★ 경고 색은 기존 오류 줄과 같다 — 새 색 없음', async () => {
    REPLY = { data: [{ drug_code: 'ATV', type: '출고', transaction_date: '2026-10-15', quantity: 1 }], error: null, count: 9 }
    open()
    await waitFor(() => expect(warn()).not.toBeNull())
    expect(warn().style.color).toBe('rgb(198, 40, 40)')   /* T.red */
    expect(warn().style.fontSize).toBe('12px')
  })
  it('다 받았으면 경고가 없고 적용이 열린다', async () => {
    REPLY = {
      data: [
        { drug_code: 'ZPD', type: '출고', transaction_date: '2026-10-31', quantity: 63 },
        { drug_code: 'ZPD', type: '출고', transaction_date: '2026-09-30', quantity: 49 },
        { drug_code: 'ZPD', type: '출고', transaction_date: '2026-08-31', quantity: 38.5 },
      ],
      error: null, count: 3,
    }
    open()
    await waitFor(() => expect(applyBtn()).not.toBeNull())
    expect(warn()).toBeNull()
    expect(applyBtn().disabled).toBe(false)
  })
  it('★ 잘리지 않으면 졸피드 63 이 셈에 들어간다 (1개월 44→63 · 3개월 144.5→150.5)', async () => {
    REPLY = {
      data: [
        { drug_code: 'ZPD', type: '출고', transaction_date: '2026-10-31', quantity: 63 },
        { drug_code: 'ZPD', type: '출고', transaction_date: '2026-09-30', quantity: 49 },
        { drug_code: 'ZPD', type: '출고', transaction_date: '2026-08-31', quantity: 38.5 },
      ],
      error: null, count: 3,
    }
    open()
    await waitFor(() => expect(screen.queryByText('졸피드정10mg')).not.toBeNull())
    const row = screen.getByText('졸피드정10mg').closest('tr')
    const txt = row.textContent
    expect(txt).toContain('63')       /* 1개월 새 값 */
    expect(txt).toContain('150.5')    /* 3개월 새 값 = 63 + 49 + 38.5 */
  })
})

describe('③ 여전히 DB 에 쓰지 않는다', () => {
  it('update·insert·upsert·delete·rpc 가 0회다', async () => {
    REPLY = { data: [{ drug_code: 'ZPD', type: '출고', transaction_date: '2026-10-31', quantity: 63 }], error: null, count: 1 }
    open()
    await waitFor(() => expect(applyBtn()).not.toBeNull())
    for (const bad of ['update', 'insert', 'upsert', 'delete', 'rpc']) {
      expect(calls.filter(c => c[0] === bad), bad + ' 가 나갔다').toHaveLength(0)
    }
  })
})

describe('④ 약품이 아직 안 왔으면 읽지 않는다', () => {
  it('★ 빈 목록으로 `.in()` 하지 않는다 — 「출고 0」으로 조용히 틀리는 쪽을 막는다', async () => {
    render(<Modal t={T} drugs={[]} onClose={() => {}} isTenantManager onReload={() => {}} Confirm={Confirm} />)
    await waitFor(() => expect(screen.queryByText(/거래를 읽는 중/)).not.toBeNull())
    expect(calls.filter(c => c[0] === 'from')).toHaveLength(0)
    expect(calls.filter(c => c[0] === 'in')).toHaveLength(0)
  })
  it('마약·향정이 하나도 없어도 읽지 않는다', async () => {
    const onlyPlain = DRUGS.filter(d => !['마약', '향정'].includes(d.narcotic_type))
    render(<Modal t={T} drugs={onlyPlain} onClose={() => {}} isTenantManager onReload={() => {}} Confirm={Confirm} />)
    await waitFor(() => expect(screen.queryByText(/거래를 읽는 중/)).not.toBeNull())
    expect(calls.filter(c => c[0] === 'from')).toHaveLength(0)
  })
})
