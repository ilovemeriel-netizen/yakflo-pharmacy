/* 「예상 분리번호」 한 줄 — 2026-11-10
 *
 * 못 박는 것
 *   ① 경구제일 때만 그린다 (주사제·외용제엔 안 나온다)
 *   ② 번호와 구분 이름을 보여 준다
 *   ③ 규칙에 안 걸리면 「확인 필요」 — 번호를 지어내지 않는다
 *   ④ 「저장되지 않습니다」를 **반드시** 적는다
 *   ⑤ 가루 위험이면 표시가 붙는다
 *   ⑥ 받은 색만 쓴다 — 새 색을 만들지 않는다
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PowderHint from './PowderHint'

const P = {
  bg: '#F5EDF6', fg: '#804A87', muted: '#A3A39E',
  category: '경구제', name: '', atc: '',
}
const show = o => render(<PowderHint {...P} {...o} />)
afterEach(() => cleanup())

describe('① 경구제일 때만 그린다', () => {
  it('주사제·외용제·수액제·영양제·의약외품이면 아무것도 안 그린다', () => {
    for (const c of ['주사제', '외용제', '수액제', '영양제', '의약외품']) {
      const { container } = show({ category: c, name: '무슨정10mg', atc: 'C09AA02' })
      expect(container.innerHTML, c).toBe('')
      cleanup()
    }
  })
  it('구분이 비어도 안 그린다', () => {
    expect(show({ category: '', name: '무슨정', atc: 'C09AA02' }).container.innerHTML).toBe('')
  })
  it('경구제면 그린다', () => {
    show({ name: '무슨정10mg', atc: 'C09AA02' })
    expect(screen.getByText('예상 분리번호')).toBeTruthy()
  })
})

describe('② 번호와 구분 이름', () => {
  const cases = [
    { atc: 'C01DX16', name: '시그마트정5mg', no: '2', label: '혈압약/심장약' },
    { atc: 'B01AF03', name: '릭시아나정30mg', no: '3', label: '항혈전제' },
    { atc: 'B01AE07', name: '프라닥사캡슐110mg', no: '8', label: '항혈전제(캡슐)' },
    { atc: 'A02AA04', name: '마그밀정', no: '4', label: '변비약' },
    { atc: 'A10BB12', name: '게리드정2mg', no: '5', label: '당뇨약' },
    { atc: 'A12BA01', name: '케이콘틴서방정', no: '9', label: '그 외 분리 필요한 약제' },
    { atc: 'C10AA05', name: '무슨스타틴정10mg', no: '1', label: '일반 정제' },
    { atc: 'Z00', name: '무슨캡슐', no: '6', label: '일반 캡슐제' },
  ]
  for (const c of cases) {
    it(c.name + ' → ' + c.no + '번 ' + c.label, () => {
      show({ atc: c.atc, name: c.name })
      expect(screen.getByText(c.no)).toBeTruthy()
      expect(screen.getByText(c.label)).toBeTruthy()
    })
  }
})

describe('③ 모르면 추측하지 않는다', () => {
  it('규칙에 안 걸리면 「확인 필요」', () => {
    show({ atc: 'Z99ZZ99', name: '이름만있는무엇' })
    expect(screen.getByText('확인 필요')).toBeTruthy()
    expect(screen.getByText(/규칙으로 정하지 못했습니다/)).toBeTruthy()
  })
  it('ATC 가 비어도 번호를 지어내지 않는다', () => {
    show({ atc: '', name: '무엇' })
    expect(screen.getByText('확인 필요')).toBeTruthy()
  })
  it('액체·가루 제형은 「수기조제」로 적는다', () => {
    show({ atc: 'A06AD11', name: '듀락칸이지시럽15mL' })
    expect(screen.getByText('수기조제')).toBeTruthy()
    expect(screen.getByText(/분리번호를 매기지 않습니다/)).toBeTruthy()
  })
})

describe('④ 「저장되지 않습니다」를 반드시 적는다', () => {
  for (const c of [
    { atc: 'C01DX16', name: '시그마트정5mg' },
    { atc: 'Z99ZZ99', name: '모르는무엇' },
    { atc: 'A06AD11', name: '무슨시럽' },
  ]) {
    it(c.name, () => {
      show(c)
      expect(screen.getByText(/저장되지 않습니다/)).toBeTruthy()
    })
  }
})

describe('⑤ 가루 위험', () => {
  it('피나스테리드 — 9번 + 가루 위험', () => {
    show({ atc: 'G04CB01', name: '피나스테아정5mg' })
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getByText('가루 위험')).toBeTruthy()
  })
  it('두타스테리드 — 6번 + 가루 위험', () => {
    show({ atc: 'G04CB02', name: '아나딘연질캡슐0.5mg' })
    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.getByText('가루 위험')).toBeTruthy()
  })
  it('가루 위험이 아니면 표시가 없다', () => {
    show({ atc: 'C01DX16', name: '시그마트정5mg' })
    expect(screen.queryByText('가루 위험')).toBeNull()
  })
})

describe('⑥ 받은 색만 쓴다', () => {
  it('번호 뱃지는 받은 바탕·글씨를 쓴다', () => {
    show({ atc: 'C01DX16', name: '시그마트정5mg', bg: '#F5EDF6', fg: '#804A87' })
    const badge = screen.getByText('2')
    expect(badge.style.background).toBe('rgb(245, 237, 246)')
    expect(badge.style.color).toBe('rgb(128, 74, 135)')
  })
  it('등록 화면 색(#999)도 그대로 받는다', () => {
    show({ atc: 'C01DX16', name: '시그마트정5mg', muted: '#999' })
    expect(screen.getByText('예상 분리번호').style.color).toBe('rgb(153, 153, 153)')
  })
  it('가루 위험 글자는 기존 고위험 토큰(#D9342B)이다', () => {
    show({ atc: 'G04CB01', name: '피나스테아정5mg' })
    expect(screen.getByText('가루 위험').style.color).toBe('rgb(217, 52, 43)')
  })
})

describe('빈 값을 넣어도 터지지 않는다', () => {
  it('전부 비어도 경구제면 「확인 필요」', () => {
    render(<PowderHint category="경구제" />)
    expect(screen.getByText('확인 필요')).toBeTruthy()
  })
  it('아무 것도 안 넘기면 안 그린다', () => {
    expect(render(<PowderHint />).container.innerHTML).toBe('')
  })
})
