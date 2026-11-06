/* 주의 표시 칩 — 색·차례·아이콘을 못 박는다.
 *
 * 왜 색을 숫자로 못 박나: 「기존 팔레트만 쓴다 · 새 색은 yellow 하나뿐」이 약속이다.
 * 누가 나중에 다른 빨강을 끼워 넣어도 시험이 걸리게 한다.
 * 고위험 칩은 **한 글자도 바뀌면 안 되는** 자리라 특히 세게 못 박는다.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  HIGH_ALERT_BG, HIGH_ALERT_FG, SOUND_CHECK, CAUTION_ORDER,
  isDark, cautionChipColors, cautionCheckColor, cautionsOf,
} from './lib/cautionDefs'
import { HighAlertChip, CautionChip, DrugChips, WarnTriangle } from './CautionChips'

const LIGHT = { mode: 'light', blue: '#2E4A62', red: '#C62828', yellow: '#FFE082' }
const DARK = { mode: 'dark', blue: '#92C8E0', red: '#F39E94', yellow: '#FFE082' }

describe('차례 — 고위험이 언제나 맨 앞 (ⓐ 순서 고정)', () => {
  it('주의 3종의 차례는 용량 → 모양 → 발음', () => {
    expect(CAUTION_ORDER.map(x => x.label)).toEqual(['용량', '모양', '발음'])
    expect(CAUTION_ORDER.map(x => x.col))
      .toEqual(['caution_dose', 'caution_shape', 'caution_sound'])
  })

  it('켜진 것만 그 차례대로 돌려준다', () => {
    expect(cautionsOf({ caution_sound: true, caution_dose: true }).map(x => x.label))
      .toEqual(['용량', '발음'])
    expect(cautionsOf({})).toEqual([])
    expect(cautionsOf(null)).toEqual([])
  })

  it('★ 화면에서도 고위험이 맨 앞에 나온다', () => {
    const { container } = render(
      <DrugChips t={LIGHT} d={{
        is_high_alert: true, caution_dose: true, caution_shape: true, caution_sound: true,
      }} />)
    const texts = [...container.querySelectorAll('span')]
      .map(s => s.textContent).filter(x => ['고위험', '용량', '모양', '발음'].includes(x))
    expect(texts).toEqual(['고위험', '용량', '모양', '발음'])
  })

  it('고위험만 켜져 있어도 맨 앞이다', () => {
    render(<DrugChips t={LIGHT} d={{ is_high_alert: true, caution_shape: true }} />)
    expect(screen.getByText('고위험')).toBeTruthy()
    expect(screen.getByText('모양')).toBeTruthy()
  })

  it('아무것도 없으면 빈 칸을 만들지 않는다', () => {
    const { container } = render(<DrugChips t={LIGHT} d={{ drug_name: '가' }} />)
    expect(container.textContent).toBe('')
  })
})

describe('★ 고위험 칩 — 색은 한 글자도 바뀌지 않는다', () => {
  it('바탕과 글씨가 지금 값 그대로다', () => {
    expect(HIGH_ALERT_BG).toBe('#D9342B1A')
    expect(HIGH_ALERT_FG).toBe('#D9342B')
  })

  it('밝은 화면·어두운 화면 모두 같은 값을 쓴다 (화면 모드를 타지 않는다)', () => {
    for (const t of [LIGHT, DARK]) {
      const c = cautionChipColors(t, 'high')
      expect(c.bg).toBe('#D9342B1A')
      expect(c.fg).toBe('#D9342B')
    }
  })

  it('그려 보아도 그 색이다', () => {
    const { container } = render(<HighAlertChip />)
    const chip = container.firstChild
    /* #D9342B1A = 빨강을 10% 만 칠한 것 — 뒤 카드 색이 비친다.
       그래서 밝은 화면에서는 #FBEBEA, 어두운 화면에서는 #2D2531 로 보인다. */
    expect(chip.style.background).toBe('rgba(217, 52, 43, 0.1)')
    expect(chip.style.color).toBe('rgb(217, 52, 43)')
  })
})

describe('고위험 아이콘 — 노랑 안쪽 + 빨강 테두리 + 진한 느낌표', () => {
  it('글자 ⚠ 가 아니라 그림(SVG)이다', () => {
    const { container } = render(<HighAlertChip />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.textContent).toBe('고위험')
    expect(container.textContent).not.toContain('⚠')
  })

  it('삼각형 안은 노랑, 테두리는 빨강', () => {
    const { container } = render(<WarnTriangle />)
    const tri = container.querySelector('path')
    expect(tri.getAttribute('fill')).toBe('#FFD400')
    expect(tri.getAttribute('stroke')).toBe('#D9342B')
  })

  it('느낌표는 진한 색이다 (막대 + 점)', () => {
    const { container } = render(<WarnTriangle />)
    expect(container.querySelector('rect').getAttribute('fill')).toBe('#7A1510')
    expect(container.querySelector('circle').getAttribute('fill')).toBe('#7A1510')
  })

  it('칩 글씨색을 따라가지 않는다 — 표지판 색은 고정이다', () => {
    const { container } = render(<WarnTriangle />)
    expect(container.innerHTML).not.toContain('currentColor')
  })
})

describe('주의 3종 색 — 기존 팔레트만, 새 색은 yellow 하나', () => {
  it('밝은 화면: 용량 #2E4A62 · 모양 #C62828 · 발음 #FFE082, 글씨는 흰/흰/검정', () => {
    expect(cautionChipColors(LIGHT, 'dose')).toEqual({ bg: '#2E4A62', fg: '#FFFFFF' })
    expect(cautionChipColors(LIGHT, 'shape')).toEqual({ bg: '#C62828', fg: '#FFFFFF' })
    expect(cautionChipColors(LIGHT, 'sound')).toEqual({ bg: '#FFE082', fg: '#000000' })
  })

  it('★ 어두운 화면: 바탕은 팔레트의 어두운 값, 글씨는 검정으로 뒤집힌다', () => {
    expect(cautionChipColors(DARK, 'dose')).toEqual({ bg: '#92C8E0', fg: '#000000' })
    expect(cautionChipColors(DARK, 'shape')).toEqual({ bg: '#F39E94', fg: '#000000' })
    expect(cautionChipColors(DARK, 'sound')).toEqual({ bg: '#FFE082', fg: '#000000' })
  })

  it('발음 바탕은 두 화면이 같다', () => {
    expect(cautionChipColors(LIGHT, 'sound').bg).toBe(cautionChipColors(DARK, 'sound').bg)
  })

  it('화면 모드 판정', () => {
    expect(isDark(DARK)).toBe(true)
    expect(isDark(LIGHT)).toBe(false)
    expect(isDark(null)).toBe(false)
  })

  it('체크 표시 색 — 각 칩 바탕색, 발음만 진한 노랑', () => {
    expect(cautionCheckColor(LIGHT, 'dose')).toBe('#2E4A62')
    expect(cautionCheckColor(LIGHT, 'shape')).toBe('#C62828')
    expect(cautionCheckColor(LIGHT, 'sound')).toBe(SOUND_CHECK)
    expect(SOUND_CHECK).toBe('#B08900')
    expect(cautionCheckColor(DARK, 'dose')).toBe('#92C8E0')
  })
})

describe('아이콘 — 이모지를 쓰지 않는다', () => {
  it.each([['dose', '용량'], ['shape', '모양'], ['sound', '발음']])(
    '%s 칩은 그림 아이콘을 가진다', (kind, label) => {
      const { container } = render(<CautionChip t={LIGHT} kind={kind} label={label} />)
      expect(container.querySelector('svg')).toBeTruthy()
      expect(container.textContent).toBe(label)
    })

  it('세 아이콘이 서로 다른 그림이다', () => {
    const svg = kind => render(<CautionChip t={LIGHT} kind={kind} label="x" />)
      .container.querySelector('svg').innerHTML
    const [a, b, c] = ['dose', 'shape', 'sound'].map(svg)
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('아이콘은 칩 글씨색을 따른다 (고위험만 예외)', () => {
    const { container } = render(<CautionChip t={DARK} kind="dose" label="용량" />)
    expect(container.querySelector('svg').innerHTML).toContain('#000000')
  })

  it('어떤 칩에도 이모지 글자가 없다', () => {
    const { container } = render(
      <DrugChips t={LIGHT} d={{
        is_high_alert: true, caution_dose: true, caution_shape: true, caution_sound: true,
      }} />)
    expect(container.textContent).toMatch(/^(고위험|용량|모양|발음|\s)+$/)
    for (const e of ['⚠', '⚖', '💊', '💬']) expect(container.textContent).not.toContain(e)
  })
})
