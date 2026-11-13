/* B-1 화면 — 「계산해 보여 주기만」 한다.

   ★ 이 시험이 지키는 것 — 가장 중요한 것부터
     ① **DB 에 쓰지 않는다.** update·insert·upsert·rpc 가 0회여야 한다.
        이 창의 존재 이유가 「먼저 보고 나서 고른다」이므로, 쓰기가 한 번이라도 나가면 창이 무의미하다.
     ② 「잣대가 섞이는 약품」 묶음이 **값이 달라지는 표보다 앞**에 온다.
     ③ 창(기준월)이 달력이고 표시가 하루 밀리지 않는다.
     ④ 마약·향정만 담는다 — 한외마약·일반은 표에 없다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const calls = []
vi.mock('./lib/supabase', () => {
  const q = {
    select: (...a) => { calls.push(['select', ...a]); return q },
    eq: () => q, gte: () => q, lt: () => q, order: () => q,
    /* ★ 2026-11-05 — 창이 마약·향정 코드만 `.in()` 으로 받도록 좁혔다(1,000줄 절단 막기) */
    in: (...a) => { calls.push(['in', ...a]); return q },
    update: (...a) => { calls.push(['update', ...a]); return q },
    insert: (...a) => { calls.push(['insert', ...a]); return q },
    upsert: (...a) => { calls.push(['upsert', ...a]); return q },
    delete: (...a) => { calls.push(['delete', ...a]); return q },
    then(res) { return Promise.resolve({ data: TX, error: null }).then(res) },
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
/* 운영 실제 값 (2026-11-04 실측) */
const DRUGS = [
  { drug_code: 'ATV', drug_name: '아티반정1mg', status: '사용', narcotic_type: '향정', current_qty: 242.5, recent_1m_usage: 241.5, recent_3m_usage: 584.5, prev_year_usage: 1742.5, monthly_avg: 195, safety_stock: 234, max_stock: 585 },
  { drug_code: 'MYPC', drug_name: '마이폴캡슐10mg', status: '사용', narcotic_type: '마약', current_qty: 292, recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 152, monthly_avg: 13, safety_stock: 16, max_stock: 39 },
  { drug_code: 'SENTIL5', drug_name: '센틸정5mg', status: '사용', narcotic_type: '향정', current_qty: 96, recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 556, monthly_avg: 46, safety_stock: 56, max_stock: 138 },
  { drug_code: 'CHNS', drug_name: '코포나시럽', status: '사용', narcotic_type: '한외마약', recent_1m_usage: 752, recent_3m_usage: 2245, prev_year_usage: 0, monthly_avg: 748, safety_stock: 898, max_stock: 2244 },
  { drug_code: 'GABA', drug_name: '가바로닌캡슐100mg', status: '사용', narcotic_type: '일반', recent_1m_usage: 300, recent_3m_usage: 900, prev_year_usage: 3600, monthly_avg: 300, safety_stock: 360, max_stock: 900 },
]
const TX = [
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-10-31', quantity: 70 },
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-09-30', quantity: 233.5 },
  { drug_code: 'ATV', type: '출고', transaction_date: '2026-08-31', quantity: 182.5 },
  { drug_code: 'CHNS', type: '출고', transaction_date: '2026-10-31', quantity: 768 },
]

/* ★ 확인 창은 **진짜 부품**(App.jsx 의 CountConfirmModal)을 쓴다 — 흉내낸 것을 쓰면
     「취소를 누르면 안 돈다」 같은 것이 실제로 지켜지는지 확인하지 못한다. */
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, setTheme: () => {}, memberRole: 'owner', profile: { role: 'user' } }) }
})

/* ★ 머리 정렬 부품 — 화면에서는 App.jsx 가 넘긴다(순환 import 회피).
   시험에서도 같은 자리를 채워야 창이 뜬다. 정렬 동작 자체는
   src/NarcoticUsageSort.test.jsx 가 따로 못 박는다. */
const Head = ({ label }) => <>{label}</>
const useSortStub = () => ({ sk: '', sd: 'asc', setSort: () => {} })
let Modal, Confirm
beforeEach(async () => {
  calls.length = 0
  vi.setSystemTime(new Date('2026-11-04T09:00:00+09:00'))
  if (!Modal) {
    Modal = (await import('./NarcoticUsageModal.jsx')).default
    Confirm = (await import('./App.jsx')).CountConfirmModal
  }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const open = async (props = {}) => {
  render(<Modal t={T} drugs={DRUGS} onClose={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortStub} {...props} />)
  await screen.findByText(/달력 기준으로 다시 세면/)
}

describe('★ 쓰지 않는다', () => {
  it('DB 쓰기가 한 번도 나가지 않는다', async () => {
    await open()
    const writes = calls.filter(c => ['update', 'insert', 'upsert', 'delete', 'rpc'].includes(c[0]))
    expect(writes).toEqual([])
  })
  it('읽는 것은 transactions 뿐이다', async () => {
    await open()
    const tables = calls.filter(c => c[0] === 'from').map(c => c[1])
    expect([...new Set(tables)]).toEqual(['transactions'])
  })
  it('화면이 「저장하지 않습니다」라고 먼저 말한다', async () => {
    await open()
    expect(screen.getByText(/보여 주기만 합니다 — 저장하지 않습니다/)).toBeTruthy()
  })
  it('기준월을 바꿔도 쓰기는 없다', async () => {
    await open()
    fireEvent.change(screen.getByDisplayValue('10월'), { target: { value: '9' } })
    await waitFor(() => expect(screen.getByText(/2026-09-01 ~ 2026-09-30/)).toBeTruthy())
    expect(calls.filter(c => ['update', 'insert', 'upsert', 'delete', 'rpc'].includes(c[0]))).toEqual([])
  })
})

describe('기준월과 창', () => {
  it('기본값은 지난달 — 2026-11-04 이면 10월', async () => {
    await open()
    expect(screen.getByDisplayValue('2026년')).toBeTruthy()
    expect(screen.getByDisplayValue('10월')).toBeTruthy()
  })
  it('★ 창 표시가 하루 밀리지 않는다', async () => {
    await open()
    expect(screen.getByText(/1개월 2026-10-01 ~ 2026-10-31 · 3개월 2026-08-01 ~ 2026-10-31/)).toBeTruthy()
  })
})

describe('표', () => {
  it('마약·향정만 담는다 — 한외마약·일반은 없다', async () => {
    await open()
    fireEvent.click(screen.getByLabelText ? screen.getByText('달라지는 약품만 보기') : screen.getByText('달라지는 약품만 보기'))
    await waitFor(() => expect(screen.getByText('아티반정1mg')).toBeTruthy())
    expect(screen.queryByText('코포나시럽')).toBeNull()
    expect(screen.queryByText('가바로닌캡슐100mg')).toBeNull()
  })
  it('아티반정 — 칸마다 「지금 → 새 값」이 선다', async () => {
    await open()
    const cells = [...screen.getByText('아티반정1mg').closest('tr').querySelectorAll('td')]
      .map(td => td.textContent.replace(/\s+/g, ''))
    /* 약품코드 · 약품명 · 상태 · 1개월 · 3개월 · 월평균 · 안전 · 최대 */
    expect(cells[3]).toBe('241.5→70')
    expect(cells[4]).toBe('584.5→486')
    expect(cells[5]).toBe('195→162')
    expect(cells[6]).toBe('234→195')
    expect(cells[7]).toBe('585→486')
  })
  it('처음엔 달라지는 약품만 보인다', async () => {
    await open()
    expect(screen.getByText('값이 달라지는 약품 1종')).toBeTruthy()
    /* 섞이는 약품은 값이 안 바뀌므로 아래 표에는 없다(위 묶음에는 있다) */
    const tables = [...document.querySelectorAll('table')]
    const main = tables[tables.length - 1]
    expect(within(main).queryByText('마이폴캡슐10mg')).toBeNull()
  })
  it('체크를 풀면 대상 전부가 보인다', async () => {
    await open()
    fireEvent.click(document.querySelector('input[type="checkbox"]'))
    const tables = [...document.querySelectorAll('table')]
    const main = tables[tables.length - 1]
    await waitFor(() => expect(within(main).getByText('마이폴캡슐10mg')).toBeTruthy())
  })
})

describe('★ 잣대가 섞이는 약품', () => {
  it('마이폴·센틸을 따로 집는다', async () => {
    await open()
    expect(screen.getByText('잣대가 섞이는 약품 2종')).toBeTruthy()
    expect(screen.getByText(/2종 \(3개월 출고 0 · 전년 쓰임 있음\)/)).toBeTruthy()
  })
  it('값이 바뀌지 않는다고 분명히 적는다', async () => {
    await open()
    /* 문장이 <b> 로 쪼개져 있어 글자 일치로는 못 찾는다 — 몸통 전체에서 본다 */
    const body = document.body.textContent.replace(/\s+/g, ' ')
    expect(body).toMatch(/값은 바뀌지 않습니다/)
    expect(body).toMatch(/전년 ÷ 12/)
  })
  it('★ 「값이 달라지는 표」보다 **앞**에 온다', async () => {
    await open()
    const body = document.body.textContent
    expect(body.indexOf('잣대가 섞이는 약품 2종 (3개월 출고 0'))
      .toBeLessThan(body.indexOf('달력 기준으로 다시 세면'))
  })
  it('전년·월평균·안전·최대·현재고를 함께 보여 준다', async () => {
    await open()
    const row = screen.getByText('마이폴캡슐10mg').closest('tr')
    expect(within(row).getByText('152'), '전년').toBeTruthy()
    expect(within(row).getByText('13'), '월평균').toBeTruthy()
    expect(within(row).getByText('292'), '현재고').toBeTruthy()
  })
})

/* ═══ B-2 — 적용 단추 ═══
   ★ 여기서 보는 것은 「눌러야만 돈다」와 「누구에게 보이나」다.
     B-1 때는 이 창에 적용 단추가 **없었다**. 2026-11-04 이정화 님 승인으로 더했고,
     그래서 위쪽 「★ 쓰지 않는다」 묶음은 **단추를 누르지 않은 상태**를 지킨다. */
const CONFIRM_LABEL = '적용'
describe('B-2 — 적용 단추', () => {
  it('★ 일반 직원에게는 DOM 에도 없다', async () => {
    await open({ isTenantManager: false })
    const labels = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels.some(x => /기준으로 적용$/.test(x))).toBe(false)
    expect(labels).toContain('닫기')
    expect(document.body.textContent).toMatch(/관리자만/)
  })
  it('관리자에게는 기준월이 적힌 단추가 보인다', async () => {
    await open({ isTenantManager: true })
    expect(screen.getByText('2026년 10월 기준으로 적용')).toBeTruthy()
  })
  it('★ 누르기 전에는 RPC 가 나가지 않는다', async () => {
    await open({ isTenantManager: true })
    expect(calls.filter(c => c[0] === 'rpc')).toEqual([])
  })
  it('★ 한 번 더 묻는다 — 바로 돌지 않는다', async () => {
    await open({ isTenantManager: true })
    fireEvent.click(screen.getByText('2026년 10월 기준으로 적용'))
    expect(screen.getByText('마약·향정 사용량 적용')).toBeTruthy()
    /* 이 표본의 마약·향정은 3종이다(운영은 29종) — 수를 화면이 세어 적는지를 본다 */
    expect(screen.getByText('2026년 10월 기준으로 3종을 다시 셉니다')).toBeTruthy()
    expect(screen.getByText('값이 바뀌는 약품 1종')).toBeTruthy()
    expect(screen.getByText(/직전1개월 2026-10-01 ~ 2026-10-31/)).toBeTruthy()
    expect(calls.filter(c => c[0] === 'rpc'), '아직 안 돈다').toEqual([])
  })
  it('확인 창에서 취소하면 돌지 않는다', async () => {
    await open({ isTenantManager: true })
    fireEvent.click(screen.getByText('2026년 10월 기준으로 적용'))
    fireEvent.click(screen.getByText('취소'))
    expect(calls.filter(c => c[0] === 'rpc')).toEqual([])
    expect(screen.queryByText('마약·향정 사용량 적용')).toBeNull()
  })
  it('★ 확인하면 고른 기준월로 narcotic 범위만 부른다', async () => {
    await open({ isTenantManager: true })
    fireEvent.click(screen.getByText('2026년 10월 기준으로 적용'))
    fireEvent.click(screen.getByText(CONFIRM_LABEL))
    await waitFor(() => expect(calls.filter(c => c[0] === 'rpc').length).toBe(1))
    const [, name, args] = calls.find(c => c[0] === 'rpc')
    expect(name).toBe('app_recompute_usage')
    expect(args).toEqual({ p_overwrite_manual: false, p_scope: 'narcotic', p_year: 2026, p_month: 10 })
  })
  it('기준월을 바꾸면 그 달로 부른다', async () => {
    await open({ isTenantManager: true })
    fireEvent.change(screen.getByDisplayValue('10월'), { target: { value: '9' } })
    await waitFor(() => expect(screen.getByText('2026년 9월 기준으로 적용')).toBeTruthy())
    fireEvent.click(screen.getByText('2026년 9월 기준으로 적용'))
    fireEvent.click(screen.getByText(CONFIRM_LABEL))
    await waitFor(() => expect(calls.filter(c => c[0] === 'rpc').length).toBe(1))
    expect(calls.find(c => c[0] === 'rpc')[2].p_month).toBe(9)
  })
  it('끝나면 결과를 알리고 약품 목록을 다시 읽는다', async () => {
    const onReload = vi.fn()
    await open({ isTenantManager: true, onReload })
    fireEvent.click(screen.getByText('2026년 10월 기준으로 적용'))
    fireEvent.click(screen.getByText(CONFIRM_LABEL))
    await screen.findByText(/적용 완료/)
    expect(document.body.textContent).toMatch(/2026년 10월 기준으로/)
    expect(onReload).toHaveBeenCalledTimes(1)
  })
  it('출고를 입력할 때는 저절로 돌지 않는다고 적는다', async () => {
    await open({ isTenantManager: true })
    expect(document.body.textContent.replace(/\s+/g, ' ')).toMatch(/저절로 계산되지 않습니다/)
  })
})
