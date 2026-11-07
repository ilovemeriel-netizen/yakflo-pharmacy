/* ATC 카세트 배치 — 주의 뱃지를 화면 칩과 같게 맞춘 것을 못 박는다.
 *
 * `dBadges`·`CB` 는 `AtcView` 안에 있어 따로 불러올 수 없다.
 * 그래서 **소스를 읽어** 「무엇을 보는가 · 어떤 차례인가 · 인쇄에 색이 남는가」를 확인한다
 * (0110·0113·0115 와 같은 방식). 색·아이콘 자체는 공용 부품이라 직접 렌더해 확인한다.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CautionIcon } from './CautionChips'
import { cautionChipColors } from './lib/cautionDefs'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
/* 주석을 뺀 실행문만 — 「무엇을 안 보는가」는 주석이 아니라 코드로 봐야 한다 */
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }
const DB = between('const dBadges = d =>', 'return a; };')

describe('★ 뱃지 자료 — lasa_type 이 아니라 caution_* 를 본다', () => {
  it('dBadges 가 주의 3칸을 본다', () => {
    expect(DB).toContain('caution_dose')
    expect(DB).toContain('caution_shape')
    expect(DB).toContain('caution_sound')
  })

  it('★ dBadges 가 lasa_type 을 더 이상 보지 않는다', () => {
    expect(DB).not.toContain('lasa_type')
  })

  it('★ lasa_type 칸 자체는 그대로 남아 있다 (지우지도 고치지도 않았다)', () => {
    /* 0064 로 들어온 칸이다. 화면이 안 읽을 뿐 값은 살아 있어야 한다. */
    expect(APP).toContain('lasa_type')
  })

  it('★ 화면 표의 「유사」 칸도 caution_* 를 본다', () => {
    const cell = between("textAlign: 'left' }}>{(() => { const bs =", '})()}')
    expect(cell).toContain('caution_dose')
    expect(cell).toContain('caution_shape')
    expect(cell).toContain('caution_sound')
    expect(cell).not.toContain('lasa_type')
  })
})

describe('★ 뱃지 차례 — 상비 · 용량 → 모양 → 발음 · 차광 · 0.5T', () => {
  it('주의 3종이 용량 → 모양 → 발음 차례다', () => {
    expect(DB).toContain("['dose', 'shape', 'sound']")
  })

  it('0.5T(fsp_note) 가 주의 3종 **뒤**에 온다', () => {
    /* 차광은 2026-11-07 부터 뱃지가 아니라 **칸 색**이라 이 차례에 없다 */
    const iCau = DB.indexOf("['dose', 'shape', 'sound']")
    const iFsp = DB.indexOf('fsp_note')
    expect(iCau).toBeGreaterThan(-1)
    expect(iFsp).toBeGreaterThan(iCau)
  })

  it('상비는 맨 앞에 그대로 있다', () => {
    expect(DB.indexOf('atc_pinned')).toBeLessThan(DB.indexOf("['dose', 'shape', 'sound']"))
  })

  it('0.5T(fsp_note) 의 색은 바뀌지 않았다', () => {
    expect(DB).toContain('bg: t.greenL, fg: t.green, bd: t.green')
  })

  it('상비의 색도 바뀌지 않았다', () => {
    expect(DB).toContain("{ x: '상비', bg: t.accentL, fg: t.accent, bd: t.accent }")
  })
})

describe('★ 색·아이콘은 화면 칩 부품을 그대로 쓴다', () => {
  it('색을 베껴 적지 않고 cautionChipColors 를 부른다', () => {
    expect(CODE).toContain('cautionChipColors(LIGHT_CHIP, kind)')
  })

  it('아이콘을 새로 그리지 않고 CautionIcon 을 쓴다', () => {
    expect(CODE).toContain('<CautionIcon kind={b.kind}')
    expect(APP).toContain("import { CautionIcon, ShadeIcon } from './CautionChips'")
  })

  it('★ 인쇄물이라 화면 모드를 타지 않는다 (밝은 화면 값 고정)', () => {
    expect(CODE).toContain("LIGHT_CHIP = { mode: 'light', blue: '#2E4A62', red: '#C62828', yellow: '#FFE082' }")
  })

  it('그 값이 화면 칩과 같다', () => {
    const L = { mode: 'light', blue: '#2E4A62', red: '#C62828', yellow: '#FFE082' }
    expect(cautionChipColors(L, 'dose')).toEqual({ bg: '#2E4A62', fg: '#FFFFFF' })
    expect(cautionChipColors(L, 'shape')).toEqual({ bg: '#C62828', fg: '#FFFFFF' })
    expect(cautionChipColors(L, 'sound')).toEqual({ bg: '#FFE082', fg: '#000000' })
  })

  it.each(['dose', 'shape', 'sound'])('%s 아이콘이 그림(SVG)이고 서로 다르다', kind => {
    const { container } = render(<CautionIcon kind={kind} size={8} color="#fff" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('세 아이콘이 서로 다른 그림이다', () => {
    const svg = k => render(<CautionIcon kind={k} size={8} color="#fff" />).container.innerHTML
    expect(new Set(['dose', 'shape', 'sound'].map(svg)).size).toBe(3)
  })
})

describe('★ 인쇄 — 배경 그래픽이 꺼져 있어도 뱃지 바탕이 찍힌다', () => {
  const style = between('const badgeStyle = (bg, fg, bd) =>', '});')

  it('badgeStyle 에 print-color-adjust 가 있다', () => {
    expect(style).toContain("printColorAdjust: 'exact'")
  })

  it('웹킷(크롬·엣지)용도 함께 있다', () => {
    expect(style).toContain("WebkitPrintColorAdjust: 'exact'")
  })

  it('뱃지 모양(크기·둥글기)은 바뀌지 않았다', () => {
    expect(style).toContain('fontSize: 8')
    expect(style).toContain('borderRadius: 3')
    expect(style).toContain("whiteSpace: 'nowrap'")
  })
})
