/* 가루약 분리번호 화면 — 2026-11-10
 *
 * 못 박는 것
 *   ① `drugs` 를 **쪽 나눠 끝까지** 읽는다 (1,000줄 조용한 절단 막기)
 *   ② 그래도 잘리면 **주황 띠**로 보인다
 *   ③ 읽기 오류는 **빨간 띠**로 보인다 — 조용히 넘어가지 않는다
 *   ④ 검색이 약품명·성분으로 된다
 *   ⑤ 1번·6번만 **기본 접힘**
 *   ⑥ DB 에 **쓰지 않는다**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

const from = vi.fn()
const rpc = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { from: (...a) => from(...a), rpc: (...a) => rpc(...a) } }))

const T = {
  mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE',
  amber: '#E65100', amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5',
}
vi.mock('./lib/theme', () => ({ useTheme: () => ({ t: T }) }))

const PowderGroup = (await import('./PowderGroup')).default

const D = o => ({
  drug_code: 'X', drug_name: '', status: '사용', category: '경구제',
  atc_code: '', narcotic_type: '일반', ingredient_kr: '', ingredient_en: '', ...o,
})

/* supabase.from('drugs') 사슬 흉내 — **range() 를 지킨다.**
   지키지 않으면 「쪽 나눠 읽기」가 도는지 시험할 수 없다. */
function mockDrugs(rows, opt) {
  const o = opt || {}
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, order: () => chain, eq: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    then: res => {
      if (o.error) return Promise.resolve({ data: null, count: null, error: o.error }).then(res)
      const page = rows.slice(lo, hi + 1)
      const count = o.count == null ? rows.length : o.count
      return Promise.resolve({ data: page, count, error: null }).then(res)
    },
  }
  return chain
}
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }

const BASE = [
  D({ drug_code: 'SGMT5', drug_name: '시그마트정5mg', atc_code: 'C01DX16', ingredient_kr: '니코란딜', ingredient_en: 'Nicorandil' }),
  D({ drug_code: 'MGM', drug_name: '마그밀정', atc_code: 'A02AA04', ingredient_kr: '수산화마그네슘' }),
  D({ drug_code: 'FNF', drug_name: '피나스테아정5mg', atc_code: 'G04CB01', ingredient_kr: '피나스테리드' }),
  D({ drug_code: 'ANDSC05', drug_name: '아나딘연질캡슐0.5mg', atc_code: 'G04CB02', ingredient_kr: '두타스테리드' }),
  D({ drug_code: 'DUR15', drug_name: '듀락칸이지시럽15mL', atc_code: 'A06AD11', ingredient_kr: '락툴로오즈농축액' }),
  D({ drug_code: 'STOP', drug_name: '중지된정10mg', atc_code: 'C09AA02', status: '중지' }),
  D({ drug_code: 'INJ', drug_name: '어떤주사', atc_code: 'C09AA02', category: '주사제' }),
]

beforeEach(() => { from.mockReset(); rpc.mockReset(); from.mockImplementation(() => mockDrugs(BASE)) })
afterEach(() => cleanup())

async function open() {
  const r = render(<PowderGroup />)
  await settle()
  return r
}

describe('기본 표시', () => {
  it('제목과 설명이 나온다', async () => {
    await open()
    expect(screen.getByText('가루약 분리번호')).toBeTruthy()
    expect(screen.getByText(/그때그때 계산합니다/)).toBeTruthy()
  })

  it('★ 사용 중인 경구제만 센다 — 중지·주사제는 빠진다', async () => {
    await open()
    /* 「사용 중인 경구제 N종」은 제목줄과 안내 띠 **두 군데**에 나온다 */
    expect(screen.getAllByText(/사용 중인 경구제 5종/).length).toBeGreaterThan(0)
  })

  it('제목 글자색이 비상조제와 같은 보라(#804A87)다', async () => {
    await open()
    expect(screen.getByText('가루약 분리번호').style.color).toBe('rgb(128, 74, 135)')
  })

  /* ★ 2026-11-10 — 처음 올릴 때 바깥 여백과 textAlign 을 빠뜨려 운영에서
     제목이 즐겨찾기 줄에 붙고 글자가 죄다 가운데로 몰렸다(함정 #31). */
  it('★ 바깥 여백이 다른 화면과 같은 20px 24px 다', async () => {
    const { container } = await open()
    expect(container.firstChild.style.padding).toBe('20px 24px')
  })

  it('★ textAlign:left 를 적는다 — #root{text-align:center} 상속을 끊는다', async () => {
    const { container } = await open()
    expect(container.firstChild.style.textAlign).toBe('left')
  })

  it('★ 제목줄에도 textAlign:left 를 적는다', async () => {
    await open()
    const row = screen.getByText('가루약 분리번호').parentElement
    expect(row.style.textAlign).toBe('left')
  })

  it('「확인 필요 0종」 안내가 나온다', async () => {
    await open()
    expect(screen.getByText(/확인 필요 0종/)).toBeTruthy()
  })
})

describe('★ 1,000줄 조용한 절단 — 쪽을 나눠 끝까지 읽는다', () => {
  const many = n => Array.from({ length: n }, (_, i) =>
    D({ drug_code: 'C' + i, drug_name: '가짜정' + i + 'mg', atc_code: 'C09AA02' }))

  it('1,150종을 두 쪽으로 나눠 **전부** 읽는다', async () => {
    from.mockImplementation(() => mockDrugs(many(1150)))
    await open()
    expect(screen.getAllByText(/사용 중인 경구제 1,150종/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/다 읽지 못했습니다/)).toBeNull()
    expect(from).toHaveBeenCalledTimes(2)   /* 1,000 + 150 → 두 쪽 */
  })

  it('★ 그래도 잘리면 주황 띠로 보인다', async () => {
    /* 전체는 1,150 인데 1,000 만 왔다고 흉내낸다 */
    from.mockImplementation(() => {
      let lo = 0, hi = 1e9
      const chain = {
        select: () => chain, order: () => chain, eq: () => chain,
        range: (a, b) => { lo = a; hi = b; return chain },
        then: res => Promise.resolve({ data: many(1000).slice(lo, hi + 1), count: 1150, error: null }).then(res),
      }
      return chain
    })
    await open()
    expect(screen.getByText(/다 읽지 못했습니다/)).toBeTruthy()
  })

  it('한 쪽으로 끝나면 더 읽지 않는다', async () => {
    await open()
    expect(from).toHaveBeenCalledTimes(1)
    expect(from.mock.calls[0][0]).toBe('drugs')
  })
})

describe('★ 읽기 오류는 반드시 보인다', () => {
  it('빨간 띠로 알린다', async () => {
    from.mockImplementation(() => mockDrugs([], { error: { message: '권한이 없습니다' } }))
    await open()
    const band = screen.getByText(/약품을 읽지 못했습니다/)
    expect(band).toBeTruthy()
    expect(band.closest('div').style.color).toBe('rgb(198, 40, 40)')
  })
  it('오류면 번호별 목록을 그리지 않는다 — 빈 표를 진실로 보여 주지 않는다', async () => {
    from.mockImplementation(() => mockDrugs([], { error: { message: '권한이 없습니다' } }))
    await open()
    expect(screen.queryByText('번호별 전체 목록')).toBeNull()
  })
})

describe('검색', () => {
  const type = s => fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: s } })

  it('약품명으로 찾으면 번호가 나온다', async () => {
    await open()
    type('시그마트')
    await settle(2)
    expect(screen.getAllByText('시그마트정5mg').length).toBeGreaterThan(0)
    expect(screen.getAllByText('혈압약/심장약').length).toBeGreaterThan(0)
  })

  it('성분으로도 찾는다', async () => {
    await open()
    type('니코란딜')
    await settle(2)
    expect(screen.getAllByText('시그마트정5mg').length).toBeGreaterThan(0)
  })

  it('★ 가루 위험 약은 칩이 붙는다', async () => {
    await open()
    type('피나스테아')
    await settle(2)
    /* 「가루 위험」은 표 머리글에도, 번호별 목록의 알약에도 같은 title 이 붙는다.
       그래서 **글자가 「가루 위험」인 칩**만 집어낸다. */
    const chip = screen.getAllByTitle(/피나스테리드/).find(el => el.textContent.includes('가루 위험'))
    expect(chip).toBeTruthy()
    expect(chip.style.color).toBe('rgb(217, 52, 43)')   /* HIGH_ALERT_FG — 기존 토큰 */
  })

  it('★ 두타스테리드는 6번 + 「재확인 필요」 비고가 함께 나온다', async () => {
    await open()
    type('아나딘')
    await settle(2)
    const chip = screen.getAllByTitle(/두타스테리드/).find(el => el.textContent.includes('가루 위험'))
    expect(chip).toBeTruthy()
    expect(screen.getByText('재확인 필요')).toBeTruthy()
    expect(screen.getAllByText('일반 캡슐제').length).toBeGreaterThan(0)
  })

  it('시럽은 「수기조제」로 나온다', async () => {
    await open()
    type('듀락칸')
    await settle(2)
    expect(screen.getAllByText('수기조제').length).toBeGreaterThan(0)
  })

  it('못 찾으면 그렇게 말한다 — 빈 표를 보이지 않는다', async () => {
    await open()
    type('없는약이름')
    await settle(2)
    expect(screen.getByText(/찾은 약이 없습니다/)).toBeTruthy()
  })

  it('빈 글자면 결과를 쏟지 않는다', async () => {
    await open()
    expect(screen.queryByText(/찾은 약이 없습니다/)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('★ 번호별 목록 — 1·6번만 기본 접힘', () => {
  it('1번·6번은 접혀 있고 「기본 접힘」이라고 적혀 있다', async () => {
    await open()
    const folded = screen.getAllByText('기본 접힘')
    expect(folded.length).toBe(2)
  })

  it('나머지 번호는 펴져 있다', async () => {
    await open()
    const btns = screen.getAllByRole('button', { expanded: true })
    /* 2~9번 중 약이 있는 묶음 + 수기조제 — 모두 펴진 상태로 그려진다 */
    expect(btns.length).toBeGreaterThanOrEqual(8)
  })

  it('머리를 누르면 1번이 펴진다', async () => {
    await open()
    const head = screen.getAllByRole('button').find(b => /일반 정제/.test(b.textContent))
    expect(head.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head)
    await settle(2)
    expect(head.getAttribute('aria-expanded')).toBe('true')
  })

  it('수기조제 묶음에 시럽이 들어 있다', async () => {
    await open()
    const head = screen.getAllByRole('button').find(b => /마약 · 액체·가루 제형/.test(b.textContent))
    expect(head).toBeTruthy()
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('듀락칸이지시럽15mL').length).toBeGreaterThan(0)
  })
})

describe('★ DB 를 바꾸지 않는다', () => {
  it('rpc 를 한 번도 부르지 않는다', async () => {
    await open()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('drugs 를 읽기만 한다 — insert·update·delete 를 쓰지 않는다', async () => {
    const chain = mockDrugs(BASE)
    chain.insert = vi.fn(); chain.update = vi.fn(); chain.delete = vi.fn(); chain.upsert = vi.fn()
    from.mockImplementation(() => chain)
    await open()
    expect(chain.insert).not.toHaveBeenCalled()
    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.delete).not.toHaveBeenCalled()
    expect(chain.upsert).not.toHaveBeenCalled()
  })
})
