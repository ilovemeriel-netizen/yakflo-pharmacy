/* 라벨 한 장(DrugLabel) · A4 모음(LabelSheet) · 인쇄 화면(LabelPrint) — 진짜 부품을 렌더해 확인한다.
 *
 * 확인하는 것
 *  ① 라벨에 약품명·성분명만 있고 함량·보관·복약지침·구분은 **없다**
 *  ② ★ 뱃지가 **왼쪽 「약품명」 제목 칸 안**에 있다 — 이름 칸을 덮지 않는다
 *  ③ 고위험 바탕색이 주의 3종을 덮는다. 갈래가 비면 흰 바탕
 *  ④ 약품명이 **잘리지 않는다**(말줄임 금지)
 *  ⑤ 목록 셀이 **왼쪽 정렬**이다 (#root 의 가운데 정렬에 밀리지 않는다)
 *  ⑥ 약품명을 누르면 미리보기가 바뀌고 **인쇄 창이 열린다**
 *  ⑦ 체크박스·장수·A4 단추가 돈다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { ThemeCtx } from './lib/theme'
import { DrugLabel } from './DrugLabel'
import { LabelSheet } from './LabelSheet'
import LabelPrint from './LabelPrint'

const T = {
  t: {
    mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', border: '#E8E6E1',
    text: '#2E4A62', textM: '#52524E', textL: '#A3A39E',
    accent: '#804A87', accentL: '#F5EDF6',
    blue: '#2E4A62', red: '#C62828', yellow: '#FFE082',
  },
  profile: { role: 'admin' }, memberRole: 'owner',
}
const wrap = ui => render(<ThemeCtx.Provider value={T}>{ui}</ThemeCtx.Provider>)

const DRUGS = [
  { drug_code: 'SGBRONNC10', drug_name: '가바로닌캡슐100mg', category: '경구제',
    ingredient_en: 'Gabapentin', ingredient_kr: '가바펜틴',
    caution_dose: true, caution_shape: false, caution_sound: false, is_high_alert: false },
  { drug_code: 'DGX', drug_name: '디고신정', category: '경구제',
    ingredient_en: 'Digoxin', ingredient_kr: '디곡신',
    caution_dose: false, caution_shape: true, caution_sound: false, is_high_alert: false },
  { drug_code: 'MGM', drug_name: '마그밀정', category: '경구제',
    ingredient_en: 'Magnesium hydroxide', ingredient_kr: '수산화마그네슘',
    caution_dose: false, caution_shape: false, caution_sound: true, is_high_alert: false },
  { drug_code: 'GRD2', drug_name: '게리드정2mg', category: '경구제',
    ingredient_en: 'Glimepiride', ingredient_kr: '글리메피리드',
    caution_dose: false, caution_shape: false, caution_sound: false, is_high_alert: false },
  { drug_code: '7PTSMCLDH', drug_name: '대한염화칼륨-40', category: '주사제',
    ingredient_en: 'Potassium Chloride', ingredient_kr: '염화칼륨',
    caution_dose: false, caution_shape: false, caution_sound: false,
    is_high_alert: true, high_alert_class: 'electrolyte_k' },
]

beforeEach(() => { window.print = vi.fn() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const bgOf = el => String(el.style.background || el.style.backgroundColor).replace(/\s/g, '').toLowerCase()

describe('라벨 한 장 — 원내 양식', () => {
  it('제목 칸은 「약품명」「성분명」 둘뿐이다', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    const ths = [...container.querySelectorAll('th')].map(x => x.textContent)
    expect(ths[0]).toContain('약품명')
    expect(ths[1]).toContain('성분명')
    expect(ths).toHaveLength(2)
  })

  it('★ 함량·보관·복약지침·구분 칸은 없다', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    for (const w of ['함량', '보관', '복약지침', '구분']) {
      expect(container.textContent).not.toContain(w)
    }
  })

  it('★ 뱃지가 왼쪽 「약품명」 제목 칸 안에 있다 (이름 칸을 덮지 않는다)', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    const th = container.querySelectorAll('th')[0]
    expect(within(th).getByText('용량')).toBeTruthy()
    const nameTd = container.querySelectorAll('td')[0]
    expect(nameTd.textContent).toBe('가바로닌캡슐100mg')   /* 이름만 */
  })

  it('★ 고위험 뱃지가 맨 앞이다', () => {
    const d = { ...DRUGS[4], caution_sound: true }
    const { container } = wrap(<DrugLabel drug={d} />)
    const th = container.querySelectorAll('th')[0]
    const words = [...th.querySelectorAll('span')].map(s => s.textContent).filter(Boolean)
    expect(words[0]).toContain('고위험')
  })

  it('약품명과 영문·한글 성분명이 나온다', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    expect(container.textContent).toContain('가바로닌캡슐100mg')
    expect(container.textContent).toContain('Gabapentin')
    expect(container.textContent).toContain('가바펜틴')
  })

  it('★ 긴 약품명도 잘리지 않는다 (말줄임 금지)', () => {
    const long = '독감-65세 이상 (플루백신VIII-TF주 0.5mL)'
    const { container } = wrap(<DrugLabel drug={{ ...DRUGS[0], drug_name: long }} />)
    expect(container.querySelectorAll('td')[0].textContent).toBe(long)
  })

  it('★ 이름은 낱말·숫자 중간에서 끊지 않는다', () => {
    const { container } = wrap(<DrugLabel drug={{ ...DRUGS[4] }} />)
    const el = container.querySelectorAll('td')[0].querySelector('div > div')
    expect(el.style.wordBreak).toBe('keep-all')
    expect(el.style.overflowWrap).toBe('normal')
  })

  it('라벨 크기는 85 × 45mm', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    expect(container.firstChild.style.width).toBe('85mm')
    expect(container.firstChild.style.height).toBe('45mm')
  })

  it.each([
    ['용량', 0, 'rgb(147,197,253)'],
    ['모양', 1, 'rgb(252,165,165)'],
    ['발음', 2, 'rgb(253,224,71)'],
    ['주의 없음', 3, 'rgb(255,255,255)'],
  ])('%s — 바탕색', (_n, i, bg) => {
    const { container } = wrap(<DrugLabel drug={DRUGS[i]} />)
    expect(bgOf(container.firstChild)).toBe(bg)
  })

  it('★ 고위험 바탕색이 주의 3종을 덮는다 (칼륨 = 빨강)', () => {
    const d = { ...DRUGS[4], caution_sound: true }
    const { container } = wrap(<DrugLabel drug={d} />)
    expect(bgOf(container.firstChild)).toBe('rgb(239,68,68)')
  })

  it('★ 고위험인데 갈래가 비면 흰 바탕 (뱃지는 그대로)', () => {
    const { container } = wrap(<DrugLabel drug={{ ...DRUGS[4], high_alert_class: null }} />)
    expect(bgOf(container.firstChild)).toBe('rgb(255,255,255)')
    expect(container.textContent).toContain('고위험')
  })

  it('성분명이 둘 다 없으면 — 로 둔다', () => {
    const { container } = wrap(<DrugLabel drug={{ drug_name: '가', ingredient_en: '', ingredient_kr: '' }} />)
    expect(container.textContent).toContain('—')
  })

  it('인쇄용으로 그리면 인쇄가 찾을 id 가 붙는다', () => {
    expect(wrap(<DrugLabel drug={DRUGS[0]} forPrint />).container.firstChild.id).toBe('yakflo-label')
    cleanup()
    expect(wrap(<DrugLabel drug={DRUGS[0]} />).container.firstChild.id).toBe('')
  })
})

describe('A4 모음', () => {
  const page = new Array(12).fill(DRUGS[0])

  it('한 쪽에 12칸이 들어간다', () => {
    const { container } = wrap(<LabelSheet pages={[page]} />)
    const labels = [...container.querySelectorAll('div')].filter(d => d.style.width === '85mm')
    expect(labels).toHaveLength(12)
  })

  it('종이는 A4 — 210 × 297mm', () => {
    const { container } = wrap(<LabelSheet pages={[page]} />)
    const sheet = container.querySelector('.yp-page')
    expect(sheet.style.width).toBe('210mm')
    expect(sheet.style.height).toBe('297mm')
  })

  it('간격 3mm · 여백 위아래 6mm · 좌우 18.5mm', () => {
    const { container } = wrap(<LabelSheet pages={[page]} />)
    const sheet = container.querySelector('.yp-page')
    expect(sheet.style.gap).toBe('3mm')
    expect(sheet.style.padding).toBe('6mm 18.5mm')
  })

  it('★ 간격을 0 으로 주면 여백이 넓어진다 (잘릴 때 쓰는 길)', () => {
    const { container } = wrap(<LabelSheet pages={[page]} gap={0} />)
    const sheet = container.querySelector('.yp-page')
    expect(sheet.style.gap).toBe('0mm')
    expect(sheet.style.padding).toBe('13.5mm 20mm')
  })

  it('여러 쪽이면 쪽이 그만큼 생긴다', () => {
    const { container } = wrap(<LabelSheet pages={[page, [DRUGS[1]]]} />)
    expect(container.querySelectorAll('.yp-page')).toHaveLength(2)
  })

  it('인쇄용 id 가 붙는다', () => {
    const { container } = wrap(<LabelSheet pages={[page]} forPrint />)
    expect(container.firstChild.id).toBe('yakflo-sheet')
  })
})

describe('라벨 인쇄 화면', () => {
  it('기본은 「주의 있는 약만」 — 고위험도 들어간다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    expect(screen.getByRole('button', { name: /가바로닌캡슐100mg/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /대한염화칼륨-40/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /게리드정2mg/ })).toBeNull()
  })

  it('거르개마다 수를 센다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    expect(screen.getByRole('button', { name: '주의 있는 약만 4' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '전체 5' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '고위험 1' })).toBeTruthy()
  })

  it('★ 표 셀이 왼쪽 정렬이다 (#root 의 가운데 정렬에 밀리지 않는다)', () => {
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    /* ★ 첫 번째 표가 목록이다. 미리보기 라벨 안에도 표가 있는데
       그쪽 제목 칸은 가운데가 맞으므로 섞어 보지 않는다. */
    const list = container.querySelectorAll('table')[0]
    for (const el of list.querySelectorAll('td, th')) {
      expect(el.style.textAlign).toBe('left')
    }
  })

  it('찾기로 줄인다 — 코드로도 찾는다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.change(screen.getByPlaceholderText('약품명 · 코드로 찾기'), { target: { value: 'dgx' } })
    expect(screen.getByRole('button', { name: /디고신정/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /마그밀정/ })).toBeNull()
  })

  it('★ 약품명을 누르면 미리보기가 바뀌고 인쇄 창이 열린다', async () => {
    vi.useFakeTimers()
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.click(screen.getByRole('button', { name: /마그밀정/ }))
    expect(container.textContent).toContain('수산화마그네슘')
    expect(window.print).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(window.print).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('★ 체크박스로 고르면 장수 칸이 생기고 A4 수가 는다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    expect(screen.getByText(/고른 약/).textContent).toContain('0종')
    fireEvent.click(screen.getByLabelText('가바로닌캡슐100mg 고르기'))
    const sum = screen.getByText(/고른 약/).textContent
    expect(sum).toContain('1종')
    expect(sum).toContain('1장')
    expect(screen.getByLabelText('가바로닌캡슐100mg 장수')).toBeTruthy()
  })

  it('★ 장수를 늘리면 A4 쪽 수가 는다 (12장 넘으면 2장)', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.click(screen.getByLabelText('가바로닌캡슐100mg 고르기'))
    fireEvent.change(screen.getByLabelText('가바로닌캡슐100mg 장수'), { target: { value: '13' } })
    expect(screen.getByText(/고른 약/).textContent).toMatch(/13장.*A4.*2장/s)
  })

  it('★ 장수는 1~99 를 벗어나지 않는다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.click(screen.getByLabelText('가바로닌캡슐100mg 고르기'))
    const box = screen.getByLabelText('가바로닌캡슐100mg 장수')
    fireEvent.change(box, { target: { value: '500' } })
    expect(box.value).toBe('99')
    fireEvent.change(box, { target: { value: '0' } })
    expect(box.value).toBe('1')
  })

  it('「보이는 것 모두 선택」·「선택 해제」가 돈다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.click(screen.getByRole('button', { name: '보이는 것 모두 선택' }))
    expect(screen.getByText(/고른 약/).textContent).toContain('4종')
    fireEvent.click(screen.getByRole('button', { name: '선택 해제' }))
    expect(screen.getByText(/고른 약/).textContent).toContain('0종')
  })

  it('★ A4 단추는 고른 것이 없으면 눌리지 않는다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    expect(screen.getByRole('button', { name: /A4로 인쇄/ }).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('디고신정 고르기'))
    expect(screen.getByRole('button', { name: /A4로 인쇄/ }).disabled).toBe(false)
  })

  it('★ A4 인쇄를 누르면 용지가 A4 로 바뀌고 인쇄된다', async () => {
    vi.useFakeTimers()
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    expect(container.querySelector('style').textContent).toContain('85mm 45mm')
    fireEvent.click(screen.getByLabelText('디고신정 고르기'))
    fireEvent.click(screen.getByRole('button', { name: /A4로 인쇄/ }))
    expect(container.querySelector('style').textContent).toContain('A4 portrait')
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(window.print).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('인쇄 설정 안내가 글로 있다', () => {
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    expect(container.textContent).toContain('배율')
    expect(container.textContent).toContain('배경 그래픽 켜기')
  })

  it('약품이 없어도 터지지 않는다', () => {
    const { container } = wrap(<LabelPrint drugs={[]} />)
    expect(container.textContent).toContain('해당하는 약품이 없습니다')
  })
})
