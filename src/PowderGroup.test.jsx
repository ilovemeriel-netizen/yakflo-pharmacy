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
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'

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
  D({ drug_code: 'MGM', drug_name: '마그밀정', atc_code: 'A02AA04',
    ingredient_kr: '수산화마그네슘', ingredient_en: 'Magnesium Hydroxide' }),
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
  it('제목이 나온다', async () => {
    await open()
    expect(screen.getByText('가루약 분리번호')).toBeTruthy()
  })

  /* ★ 2026-11-11 이정화 님 결정(글자 줄이기 A안) — 긴 설명 넷을 뺐다.
     다시 들어가면 이 시험이 알려 준다. */
  it('★ 뺀 설명이 도로 들어오지 않았다', async () => {
    await open()
    expect(screen.queryByText(/그때그때 계산합니다/)).toBeNull()
    expect(screen.queryByText(/카드를 누르면 그 번호만/)).toBeNull()
    expect(screen.queryByText('누르면 펼쳐집니다')).toBeNull()
    expect(screen.queryByText(/번호별 목록에서 뺐습니다/)).toBeNull()
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

  /* ★ 2026-11-11 이정화 님 결정 — 0종이면 띠를 아예 그리지 않는다 */
  it('★ 「확인 필요」가 0종이면 띠가 없다', async () => {
    await open()
    expect(screen.queryByText(/확인 필요 0종/)).toBeNull()
    expect(screen.queryByText(/규칙에 안 걸려/)).toBeNull()
  })

  it('★ 「확인 필요」가 1종 이상이면 띠가 나온다', async () => {
    /* 제형을 못 가리는 약(이름에 정·캡슐·액체가 없음) → 「확인 필요」 */
    from.mockImplementation(() => mockDrugs([
      D({ drug_code: 'HUH', drug_name: '무엇', atc_code: 'X99XX99' }),
    ]))
    await open()
    expect(screen.getByText(/확인 필요 1종/)).toBeTruthy()
    expect(screen.getByText(/무엇/)).toBeTruthy()
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
    /* ★ 화면은 두 표를 읽는다 — drugs 와 고친 번호(drug_powder_override).
       그래서 **drugs 를 몇 번 읽었나**만 센다. 1,000 + 150 → 두 쪽. */
    expect(from.mock.calls.filter(c => c[0] === 'drugs').length).toBe(2)
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
    expect(from.mock.calls.filter(c => c[0] === 'drugs').length).toBe(1)
  })

  it('고친 번호 표도 쪽 나눠 읽는다 — 한 쪽이면 한 번', async () => {
    await open()
    expect(from.mock.calls.filter(c => c[0] === 'drug_powder_override').length).toBe(1)
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

describe('★ 표 — 긴 글자는 한 줄 + 말줄임 + 마우스 올리면 전체', () => {
  const type = s => fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: s } })

  it('성분을 ATC 화면과 같은 「영문 (한글)」로 적는다', async () => {
    await open()
    type('마그밀')
    await settle(2)
    expect(screen.getByText('Magnesium Hydroxide (수산화마그네슘)')).toBeTruthy()
  })

  it('★ 성분 칸이 한 줄이고 넘치면 말줄임이다', async () => {
    await open()
    type('마그밀')
    await settle(2)
    const cell = screen.getByText('Magnesium Hydroxide (수산화마그네슘)')
    expect(cell.style.whiteSpace).toBe('nowrap')
    expect(cell.style.textOverflow).toBe('ellipsis')
    expect(cell.style.overflow).toBe('hidden')
  })

  it('★ 마우스를 올리면 전체가 보인다 (title)', async () => {
    await open()
    type('마그밀')
    await settle(2)
    const cell = screen.getByText('Magnesium Hydroxide (수산화마그네슘)')
    expect(cell.getAttribute('title')).toContain('수산화마그네슘')
    expect(cell.getAttribute('title')).toContain('Magnesium Hydroxide')
  })

  it('★ 표가 적은 너비를 지킨다 (tableLayout: fixed + colgroup)', async () => {
    await open()
    type('마그밀')
    await settle(2)
    const table = screen.getByRole('table')
    expect(table.style.tableLayout).toBe('fixed')
    const cols = table.querySelectorAll('colgroup col')
    expect(cols.length).toBe(10)
    /* 성분 칸(9번째)만 너비를 주지 않는다 — 남는 폭을 혼자 먹는다 */
    expect(cols[8].style.width).toBe('')
    expect(cols[1].style.width).toBe('190px')   /* 약품명 */
  })

  it('약품명·구분도 한 줄 + 말줄임이다', async () => {
    await open()
    type('마그밀')
    await settle(2)
    const name = screen.getByText('마그밀정')
    expect(name.style.whiteSpace).toBe('nowrap')
    expect(name.getAttribute('title')).toBe('마그밀정')
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

describe('★ 번호별 목록 — 카드 격자 (2026-11-11 시안 ⓑ)', () => {
  /* ★ 2026-11-11 이정화 님이 고른 모습.
     번호마다 카드 한 장 · 누른 카드만 그 번호의 바탕색과 함께 아래에 펼쳐진다.
     ★ 10번(갑상선약)을 없애 번호 카드는 9장 + 수기조제 1장 = **10장**이다. */
  const cardBtns = () => screen.getAllByRole('button').filter(b => b.hasAttribute('aria-expanded'))

  it('★ 카드가 10장이다 — 1~9번 + 수기조제', async () => {
    await open()
    expect(cardBtns().length).toBe(10)
  })

  it('★ 수기조제 카드가 **맨 끝**이다', async () => {
    await open()
    const last = cardBtns()[cardBtns().length - 1]
    expect(/수기조제/.test(last.textContent)).toBe(true)
  })

  it('★ 10번·갑상선약 카드가 없다', async () => {
    await open()
    expect(cardBtns().some(b => /갑상선/.test(b.textContent))).toBe(false)
  })

  it('★ 처음에는 펴진 묶음이 하나도 없다', async () => {
    await open()
    expect(screen.queryAllByRole('button', { expanded: true }).length).toBe(0)
  })

  /* ★ 카드 1장 = 예전 카드 4장(2×2) 크기 · 미리보기 3줄 + 「외 N종」
       (2026-11-11 이정화 님 결정) */
  it('★ 카드 높이가 192px 다', async () => {
    await open()
    for (const b of cardBtns()) expect(b.style.minHeight).toBe('192px')
  })

  it('★ 카드에 큰 번호(32px)가 있다', async () => {
    await open()
    const one = cardBtns().find(b => /일반 정제/.test(b.textContent))
    const badge = [...one.querySelectorAll('span')].find(s => s.textContent === '1')
    expect(badge.style.fontSize).toBe('32px')
    expect(badge.style.minWidth).toBe('46px')
  })

  it('★ 카드 바탕은 **늘** 그 번호의 색이다 — 접혀 있어도', async () => {
    await open()
    const btns = cardBtns()
    expect(btns[0].style.background).toContain('191, 166, 217')   /* 1번 라벤더 */
    expect(btns[0].style.background).not.toBe('rgb(255, 255, 255)')
  })

  it('★ 미리보기는 약 이름 3줄 + 「외 N종」 이다', async () => {
    await open()
    /* 가짜 자료의 2번(혈압약)은 1종뿐이라 「외 N종」이 없다 — 수기조제(2종)도 마찬가지.
       줄 수 자체를 못 박는다: 4줄을 넘지 않는다. */
    for (const b of cardBtns()) {
      const lines = b.textContent.split('·').length - 1
      expect(lines).toBeLessThanOrEqual(3)
    }
    expect(screen.getAllByText(/^· 시그마트정5mg$/).length).toBe(1)
  })

  it('★ 약이 없는 번호는 「해당 약 없음」이라고 적는다', async () => {
    await open()
    const one = cardBtns().find(b => /일반 정제/.test(b.textContent))
    expect(/해당 약 없음/.test(one.textContent)).toBe(true)
  })

  it('카드를 누르면 2번이 펴지고 그 약이 나온다', async () => {
    await open()
    const head = cardBtns().find(b => /혈압약/.test(b.textContent))
    expect(head.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head)
    await settle(2)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('시그마트정5mg').length).toBeGreaterThan(0)
  })

  it('★ 1번을 펴면 「서방정 / 그 밖」 두 토막이 나온다', async () => {
    await open()
    fireEvent.click(cardBtns().find(b => /일반 정제/.test(b.textContent)))
    await settle(2)
    /* 가짜 자료에는 1번 약이 없다 — 토막 제목은 그대로 나오고 「해당 약 없음」이 붙는다.
       (카드 미리보기에도 같은 글이 들어가므로 수를 못 박지 않고 **있는지**만 본다) */
    expect(screen.getByText(/^그 밖 0종$/)).toBeTruthy()
    expect(screen.getAllByText('해당 약 없음').length).toBeGreaterThanOrEqual(2)
  })

  it('★ 한 번에 한 묶음만 펴진다 — 다른 카드를 누르면 앞엣것이 접힌다', async () => {
    await open()
    const one = cardBtns().find(b => /일반 정제/.test(b.textContent))
    const man = cardBtns().find(b => /수기조제/.test(b.textContent))
    fireEvent.click(one)
    await settle(2)
    fireEvent.click(man)
    await settle(2)
    expect(one.getAttribute('aria-expanded')).toBe('false')
    expect(man.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryAllByRole('button', { expanded: true }).length).toBe(1)
  })

  it('수기조제 카드도 접혀 있고, 누르면 시럽이 나온다', async () => {
    await open()
    const head = cardBtns().find(b => /수기조제/.test(b.textContent))
    expect(head).toBeTruthy()
    expect(head.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head)
    await settle(2)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('듀락칸이지시럽15mL').length).toBeGreaterThan(0)
  })

  it('「접기」를 누르면 다시 접힌다', async () => {
    await open()
    const head = cardBtns().find(b => /일반 정제/.test(b.textContent))
    fireEvent.click(head)
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '접기' }))
    await settle(2)
    expect(head.getAttribute('aria-expanded')).toBe('false')
  })

  /* 2번(혈압약/심장약)에 시그마트정5mg 이 들어 있다 */
  const openTwo = async () => {
    await open()
    fireEvent.click(cardBtns().find(b => /혈압약/.test(b.textContent)))
    await settle(2)
    return screen.getAllByText('시그마트정5mg')
      .map(el => el.parentElement)
      .find(el => el && el.style.minHeight === '78px')
  }

  it('★ 칸 규격이 ATC 카세트와 같다 — 최소 높이 78 · 그림자 없음', async () => {
    const cell = await openTwo()
    expect(cell).toBeTruthy()
    expect(cell.style.boxShadow).toBe('')
    expect(cell.style.borderRadius).toBe('6px')
    expect(cell.style.padding).toBe('3px 5px')
  })

  it('★ 칸에 가나다 번호를 적지 않는다', async () => {
    const cell = await openTwo()
    /* 칸 안에 보이는 글자는 약품명과 ATC 뿐이다 */
    expect(cell.textContent).toBe('시그마트정5mgC01DX16')
  })

  it('★ 펼친 상자에 그 번호의 바탕색이 깔린다 — 팔레트 4색 저알파', async () => {
    await open()
    const head = cardBtns().find(b => /일반 정제/.test(b.textContent))
    fireEvent.click(head)
    await settle(2)
    /* 1번은 차례의 첫 색(라벤더 #BFA6D9 + '2b') */
    expect(head.style.background).toContain('191, 166, 217')
  })

  it('★ 옆 카드끼리 바탕색이 다르다 — 차례대로 돌려 쓴다', async () => {
    await open()
    const btns = cardBtns()
    fireEvent.click(btns[0]); await settle(2)
    const c0 = btns[0].style.background
    fireEvent.click(btns[1]); await settle(2)
    const c1 = btns[1].style.background
    expect(c0).not.toBe(c1)
  })

  it('★ 고른 약 체크는 접었다 펴도 그대로 남는다', async () => {
    await open()
    const head = cardBtns().find(b => /혈압약/.test(b.textContent))
    fireEvent.click(head)
    await settle(2)
    const box = screen.getAllByLabelText('시그마트정5mg 고르기')
      .find(el => el.style.width === '12px')
    fireEvent.click(box)
    await settle(2)
    expect(screen.getByText('고른 약 1종')).toBeTruthy()
    /* 접었다 다시 편다 */
    fireEvent.click(head)
    await settle(2)
    expect(screen.getByText('고른 약 1종')).toBeTruthy()
    fireEvent.click(head)
    await settle(2)
    const again = screen.getAllByLabelText('시그마트정5mg 고르기')
      .find(el => el.style.width === '12px')
    expect(again.checked).toBe(true)
  })

  it('★ 묶음 합 + 수기조제 = 사용 중인 경구제 수', async () => {
    await open()
    const sum = cardBtns()
      .map(b => Number(within(b).getByText(/^\d+종$/).textContent.replace('종', '')))
      .reduce((a, b) => a + b, 0)
    expect(sum).toBe(5)   /* 가짜 자료의 사용 중인 경구제 5종 */
    expect(screen.getAllByText(/사용 중인 경구제 5종/).length).toBeGreaterThan(0)
  })
})

describe('★ 읽을 때는 DB 를 바꾸지 않는다', () => {
  it('rpc 를 한 번도 부르지 않는다', async () => {
    await open()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('화면을 열기만 하면 insert·update·delete·upsert 를 쓰지 않는다', async () => {
    const chain = mockDrugs(BASE)
    chain.insert = vi.fn(); chain.update = vi.fn(); chain.delete = vi.fn(); chain.upsert = vi.fn()
    from.mockImplementation(() => chain)
    await open()
    expect(chain.insert).not.toHaveBeenCalled()
    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.delete).not.toHaveBeenCalled()
    expect(chain.upsert).not.toHaveBeenCalled()
  })
  it('drugs 표에는 **끝까지** 쓰지 않는다 — 고쳐도 drugs 는 그대로다', async () => {
    const spy = { upsert: vi.fn(), delete: vi.fn() }
    useOverrides([], spy)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    fireEvent.click(screen.getByLabelText('마그밀정 고르기'))
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    await settle(4)
    /* 쓴 표는 고친 번호 표 하나뿐이다 */
    expect(wroteTo).toEqual(['drug_powder_override'])
  })
})

/* ── 고친 번호를 돌려줄 수 있는 가짜 supabase ── */
let wroteTo = []
function useOverrides(ovRows, spy) {
  wroteTo = []
  from.mockImplementation(table => {
    if (table === 'drug_powder_override') {
      const chain = mockDrugs(ovRows || [])
      chain.upsert = (...a) => {
        wroteTo.push(table)
        if (spy && spy.upsert) spy.upsert(...a)
        const rows = Array.isArray(a[0]) ? a[0] : [a[0]]
        return { select: () => Promise.resolve({ data: rows.map(r => ({ drug_code: r.drug_code })), error: null }) }
      }
      chain.delete = () => {
        wroteTo.push(table)
        if (spy && spy.delete) spy.delete()
        return { eq: () => Promise.resolve({ data: null, error: null }) }
      }
      return chain
    }
    return mockDrugs(BASE)
  })
}

describe('★ 사람이 고친 번호 — resolveGroup 이 먼저 쓴다', () => {
  const OV = [{ drug_code: 'MGM', group_no: 9, note: '변비약 2개 이상일 때 따로', updated_at: '2026-11-10T07:41:00Z' }]

  it('고친 번호가 번호 칸에 나오고 「수기」가 붙는다', async () => {
    useOverrides(OV)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    /* 「9」는 고르기 띠의 번호 단추에도 있으므로 **번호 뱃지**를 따로 집어낸다 */
    const badge = screen.getAllByText('9').find(el => el.tagName === 'SPAN')
    expect(badge).toBeTruthy()
    expect(screen.getAllByText('수기').length).toBeGreaterThan(0)
    expect(screen.getAllByText('그 외 분리 필요한 약제').length).toBeGreaterThan(0)
  })

  it('★ 「자동이면 N번」을 늘 보인다', async () => {
    useOverrides(OV)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    expect(screen.getByText(/자동 계산이면 4번 입니다/)).toBeTruthy()
  })

  it('고친 까닭을 보인다', async () => {
    useOverrides(OV)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    expect(screen.getByText('변비약 2개 이상일 때 따로')).toBeTruthy()
  })

  it('수기 요약 띠가 수를 센다', async () => {
    useOverrides(OV)
    await open()
    expect(screen.getByText('수기 1종')).toBeTruthy()
  })

  /* ★ 2026-11-11 이정화 님 결정 — 고친 번호가 0종이면 띠를 아예 그리지 않는다 */
  it('★ 고친 번호가 없으면 수기 띠가 없다', async () => {
    useOverrides([])
    await open()
    expect(screen.queryByText('수기 0종')).toBeNull()
    expect(screen.queryByText(/아직 고친 번호가 없습니다/)).toBeNull()
  })

  /* ★ 「1번 안 서방정 N종」은 띠에서 빼고 1번 카드 머리로 옮겼다 (B안) */
  it('★ 서방정 수가 띠가 아니라 1번 카드에 붙는다', async () => {
    useOverrides([])
    await open()
    expect(screen.queryByText(/1번 안/)).toBeNull()
    const one = screen.getAllByRole('button')
      .filter(b => b.hasAttribute('aria-expanded'))
      .find(b => /일반 정제/.test(b.textContent))
    /* 가짜 자료에는 1번 서방정이 없으므로 「서방」이 안 붙는다 */
    expect(/서방 \d/.test(one.textContent)).toBe(false)
  })

  it('★ 1번에 서방정이 있으면 카드 머리에 「서방 N」이 붙는다', async () => {
    from.mockImplementation(() => mockDrugs([
      D({ drug_code: 'SR1', drug_name: '어떤서방정10mg', atc_code: 'N02BE01' }),
      D({ drug_code: 'TB1', drug_name: '그냥정10mg', atc_code: 'N02BE01' }),
    ]))
    await open()
    const one = screen.getAllByRole('button')
      .filter(b => b.hasAttribute('aria-expanded'))
      .find(b => /일반 정제/.test(b.textContent))
    expect(/서방 1/.test(one.textContent)).toBe(true)
    expect(screen.queryByText(/1번 안/)).toBeNull()
  })

  it('★ 번호를 고쳐도 가루 위험 표시는 그대로다', async () => {
    useOverrides([{ drug_code: 'FNF', group_no: 1 }])
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '피나스테아' } })
    await settle(2)
    expect(screen.getAllByTitle(/피나스테리드/).length).toBeGreaterThan(0)
  })
})

describe('★ 여러 개 한꺼번에 · 되돌리기', () => {
  it('고르기 전에는 번호 단추가 꺼져 있다', async () => {
    useOverrides([])
    await open()
    expect(screen.getByRole('button', { name: '9' }).disabled).toBe(true)
  })

  it('고르면 켜지고, 누르면 그 번호로 저장한다', async () => {
    const spy = { upsert: vi.fn() }
    useOverrides([], spy)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    fireEvent.click(screen.getByLabelText('마그밀정 고르기'))
    await settle(2)
    expect(screen.getByRole('button', { name: '9' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    await settle(4)
    expect(spy.upsert).toHaveBeenCalled()
    const rows = spy.upsert.mock.calls[0][0]
    expect(rows).toEqual([{ drug_code: 'MGM', group_no: 9, note: null }])
  })

  it('★ 고른 것이 여러 개면 **한 번에** 보낸다 — 나눠 보내지 않는다', async () => {
    const spy = { upsert: vi.fn() }
    useOverrides([], spy)
    await open()
    /* 두 약이 함께 나오게 「정」으로 찾는다 */
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '정' } })
    await settle(2)
    fireEvent.click(screen.getByLabelText('마그밀정 고르기'))
    fireEvent.click(screen.getByLabelText('시그마트정5mg 고르기'))
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await settle(4)
    expect(spy.upsert).toHaveBeenCalledTimes(1)
    expect(spy.upsert.mock.calls[0][0].length).toBe(2)
  })

  it('까닭은 선택이다 — 비워도 저장된다', async () => {
    const spy = { upsert: vi.fn() }
    useOverrides([], spy)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    fireEvent.click(screen.getByLabelText('마그밀정 고르기'))
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    await settle(4)
    expect(spy.upsert.mock.calls[0][0][0].note).toBeNull()
  })

  it('까닭을 적으면 함께 보낸다', async () => {
    const spy = { upsert: vi.fn() }
    useOverrides([], spy)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    fireEvent.click(screen.getByLabelText('마그밀정 고르기'))
    fireEvent.change(screen.getByLabelText(/고친 까닭/), { target: { value: '따로 빼기' } })
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    await settle(4)
    expect(spy.upsert.mock.calls[0][0][0].note).toBe('따로 빼기')
  })

  it('저장하면 초록 띠로 알린다', async () => {
    useOverrides([])
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    fireEvent.click(screen.getByLabelText('마그밀정 고르기'))
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '9' }))
    await settle(4)
    expect(screen.getByText(/1종을 9번으로 바꿨습니다/)).toBeTruthy()
  })

  it('★ 되돌리기는 **고친 약에만** 나온다', async () => {
    useOverrides([{ drug_code: 'MGM', group_no: 9 }])
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '정' } })
    await settle(2)
    const btns = screen.getAllByRole('button', { name: '되돌리기' })
    expect(btns.length).toBe(1)
  })

  it('되돌리면 그 줄을 지운다', async () => {
    const spy = { delete: vi.fn() }
    useOverrides([{ drug_code: 'MGM', group_no: 9 }], spy)
    await open()
    fireEvent.change(screen.getByLabelText(/찾기/), { target: { value: '마그밀' } })
    await settle(2)
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await settle(4)
    expect(spy.delete).toHaveBeenCalled()
    expect(screen.getByText(/자동 계산으로 되돌렸습니다/)).toBeTruthy()
  })
})
