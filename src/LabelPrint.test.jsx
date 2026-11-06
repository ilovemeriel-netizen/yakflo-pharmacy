/* 라벨 한 장(DrugLabel)과 인쇄 화면(LabelPrint) — 진짜 부품을 렌더해 확인한다.
 *
 * 확인하는 것
 *  ① 라벨에 약품명·성분명만 있고 함량·보관·복약지침·구분은 **없다**
 *  ② 바탕색·제목 칸 색이 주의에 따라 바뀐다 (흰 바탕은 제목도 흰색)
 *  ③ 약품명은 **잘리지 않는다**(말줄임 금지)
 *  ④ 목록에서 약품명을 누르면 미리보기가 바뀌고 **인쇄 창이 열린다**
 *  ⑤ 거르개·찾기가 목록을 줄인다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { ThemeCtx } from './lib/theme'
import { DrugLabel } from './DrugLabel'
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
    caution_dose: true, caution_shape: false, caution_sound: false },
  { drug_code: 'DGX', drug_name: '디고신정', category: '경구제',
    ingredient_en: 'Digoxin', ingredient_kr: '디곡신',
    caution_dose: false, caution_shape: true, caution_sound: false },
  { drug_code: 'MGM', drug_name: '마그밀정', category: '경구제',
    ingredient_en: 'Magnesium hydroxide', ingredient_kr: '수산화마그네슘',
    caution_dose: false, caution_shape: false, caution_sound: true },
  { drug_code: 'GRD2', drug_name: '게리드정2mg', category: '경구제',
    ingredient_en: 'Glimepiride', ingredient_kr: '글리메피리드',
    caution_dose: false, caution_shape: false, caution_sound: false },
  { drug_code: '7HMLR', drug_name: '휴물린알주100단위', category: '주사제',
    ingredient_en: 'Insulin Human', ingredient_kr: '인슐린휴먼',
    caution_dose: false, caution_shape: false, caution_sound: false, is_high_alert: true },
]

beforeEach(() => { window.print = vi.fn() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const bgOf = el => String(el.style.background || el.style.backgroundColor).replace(/\s/g, '').toLowerCase()

describe('라벨 한 장 — 원내 양식', () => {
  it('제목 칸은 「약품명」「성분명」 둘뿐이다', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    const ths = [...container.querySelectorAll('th')].map(x => x.textContent)
    expect(ths).toEqual(['약품명', '성분명'])
  })

  it('★ 함량·보관·복약지침·구분 칸은 없다', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    for (const w of ['함량', '보관', '복약지침', '구분']) {
      expect(container.textContent).not.toContain(w)
    }
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
    expect(container.textContent).toContain(long)
    expect(container.textContent).not.toContain('…독감')
  })

  it('라벨 크기는 85 × 45mm', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} />)
    expect(container.firstChild.style.width).toBe('85mm')
    expect(container.firstChild.style.height).toBe('45mm')
  })

  it.each([
    ['용량', 0, 'rgb(147,197,253)', 'rgb(201,226,254)'],
    ['모양', 1, 'rgb(252,165,165)', 'rgb(253,210,210)'],
    ['발음', 2, 'rgb(253,224,71)', 'rgb(254,240,163)'],
  ])('%s 주의 — 바탕과 제목 칸 색', (_n, i, bg, head) => {
    const { container } = wrap(<DrugLabel drug={DRUGS[i]} />)
    expect(bgOf(container.firstChild)).toBe(bg)
    expect(bgOf(container.querySelector('th'))).toBe(head)
  })

  it('★ 주의가 없으면 바탕도 제목 칸도 흰색', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[3]} />)
    expect(bgOf(container.firstChild)).toBe('rgb(255,255,255)')
    expect(bgOf(container.querySelector('th'))).toBe('rgb(255,255,255)')
  })

  it('주의가 있으면 검정 뱃지가 붙고, 없으면 안 붙는다', () => {
    expect(wrap(<DrugLabel drug={DRUGS[2]} />).container.textContent).toContain('발음 주의')
    cleanup()
    const plain = wrap(<DrugLabel drug={DRUGS[3]} />).container.textContent
    for (const w of ['용량 주의', '모양 주의', '발음 주의']) expect(plain).not.toContain(w)
  })

  it('성분명이 둘 다 없으면 — 로 둔다', () => {
    const { container } = wrap(<DrugLabel drug={{ drug_name: '가', ingredient_en: '', ingredient_kr: '' }} />)
    expect(container.textContent).toContain('—')
  })

  it('인쇄용으로 그리면 인쇄가 찾을 id 가 붙는다', () => {
    const { container } = wrap(<DrugLabel drug={DRUGS[0]} forPrint />)
    expect(container.firstChild.id).toBe('yakflo-label')
    expect(wrap(<DrugLabel drug={DRUGS[0]} />).container.firstChild.id).toBe('')
  })
})

describe('라벨 인쇄 화면', () => {
  it('기본은 「주의 있는 약만」이라 주의 없는 약은 목록에 없다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    expect(screen.getByRole('button', { name: /가바로닌캡슐100mg/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /게리드정2mg/ })).toBeNull()
  })

  it('거르개를 「전체」로 바꾸면 다 보인다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.click(screen.getByRole('button', { name: /^전체/ }))
    expect(screen.getByRole('button', { name: /게리드정2mg/ })).toBeTruthy()
  })

  it('거르개마다 수를 센다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    expect(screen.getByRole('button', { name: '주의 있는 약만 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '전체 5' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '고위험 1' })).toBeTruthy()
  })

  it('찾기로 줄인다 — 코드로도 찾는다', () => {
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.change(screen.getByPlaceholderText('약품명 · 코드로 찾기'), { target: { value: 'dgx' } })
    expect(screen.getByRole('button', { name: /디고신정/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /마그밀정/ })).toBeNull()
  })

  it('고른 것이 없으면 첫 줄을 미리 보여 준다', () => {
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    expect(container.textContent).toContain('Gabapentin')
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

  it('「인쇄하기」 단추로도 인쇄된다', async () => {
    vi.useFakeTimers()
    wrap(<LabelPrint drugs={DRUGS} />)
    fireEvent.click(screen.getByRole('button', { name: '인쇄하기' }))
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(window.print).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('★ 인쇄 규칙(@page 85mm 45mm)이 화면에 들어 있다', () => {
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    expect(container.querySelector('style').textContent)
      .toContain('@page { size: 85mm 45mm; margin: 0; }')
  })

  it('인쇄 설정 안내가 글로 있다 (단추가 아니다)', () => {
    const { container } = wrap(<LabelPrint drugs={DRUGS} />)
    expect(container.textContent).toContain('배율 100%')
    expect(container.textContent).toContain('배경 그래픽 켜기')
    expect(screen.queryByRole('button', { name: /도움말/ })).toBeNull()
  })

  it('약품이 없어도 터지지 않는다', () => {
    const { container } = wrap(<LabelPrint drugs={[]} />)
    expect(container.textContent).toContain('해당하는 약품이 없습니다')
  })
})
