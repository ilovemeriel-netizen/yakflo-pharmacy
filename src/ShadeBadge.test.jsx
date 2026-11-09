/* 차광 뱃지 표준화 — 2026-11-07.
 *
 * 못 박는 것
 *  ① 차광 자료가 `storage_light` 가 아니라 `storage_method` 의 「차광」 포함 여부다
 *  ② 그러면서 `storage_light` 칸 자체는 지우지 않았다
 *  ③ 칸 색(cs·pcs)과 뱃지가 **같은 자료**를 본다 — 한쪽만 바뀌면 안 된다
 *  ④ 색이 화면 모드를 타지 않는다 (어두운 화면에서 글자가 사라지던 문제)
 *  ⑤ 아이콘이 초승달 SVG 다 (이모지 아님)
 *  ⑥ 인쇄 배지 칸이 16% 다 (12% 로는 뱃지 3개가 넘쳤다)
 *
 * `cs`·`pcs`·`dBadges` 는 `AtcView` 안에 있어 따로 불러올 수 없다.
 * 그래서 **소스를 읽어** 확인한다(0110·0113·0115·AtcBadges 와 같은 방식).
 * 색·아이콘·판정 함수는 공용 부품이라 직접 불러서 확인한다.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ShadeIcon, CautionIcon } from './CautionChips'
import { SHADE_BG, SHADE_FG, SHADE_LABEL, isShade, cautionChipColors } from './lib/cautionDefs'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const DEFS = readFileSync(resolve(process.cwd(), 'src/lib/cautionDefs.js'), 'utf8')
const CHIPS = readFileSync(resolve(process.cwd(), 'src/CautionChips.jsx'), 'utf8')
/* 주석을 뺀 실행문만 — 「무엇을 안 보는가」는 주석이 아니라 코드로 봐야 한다 */
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }

describe('★ 차광 판정 — storage_method 의 「차광」', () => {
  it.each([
    ['실온/차광', true],
    ['냉장/차광', true],
    ['실온', false],
    ['냉장', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('보관방법 %s → %s', (sm, want) => {
    expect(isShade({ storage_method: sm })).toBe(want)
  })

  it('약이 없으면 거짓이다 (빈 칸에서 터지지 않는다)', () => {
    expect(isShade(null)).toBe(false)
    expect(isShade(undefined)).toBe(false)
    expect(isShade({})).toBe(false)
  })

  it('★ storage_light 는 보지 않는다 — 참이어도 보관방법이 기준이다', () => {
    expect(isShade({ storage_light: true, storage_method: '실온' })).toBe(false)
    expect(isShade({ storage_light: false, storage_method: '실온/차광' })).toBe(true)
  })
})

describe('★ storage_light 칸은 건드리지 않았다', () => {
  it('화면이 storage_light 를 더 이상 읽지 않는다', () => {
    /* 주석에는 남아 있어도 된다(0064 가 만든 칸이라는 설명). 실행문에만 없으면 된다. */
    expect(CODE).not.toContain('storage_light')
  })

  it('★ 그래도 어디에도 drop/삭제 코드가 없다', () => {
    expect(APP).not.toMatch(/drop column[\s\S]{0,40}storage_light/i)
    expect(DEFS).not.toMatch(/drop column/i)
  })

  it('0064 가 만든 칸이라는 설명은 남아 있다', () => {
    expect(APP).toContain('storage_light')   // 주석에
  })
})

describe('★ 칸 색과 뱃지가 같은 자료를 본다', () => {
  const CS = between('const cs = d => {', 'const Cell =')
  const PCS = between('const pcs = (d, exp) =>', 'const PCell =')
  const DB = between('const dBadges = d =>', 'return a; };')

  it('카세트 칸 색(cs)이 isShade 를 쓴다', () => {
    expect(CS).toContain('isShade(d)')
    expect(CS).not.toContain('storage_light')
  })

  it('사용량순 제안 칸 색(pcs)도 isShade 를 쓴다', () => {
    expect(PCS).toContain('isShade(d)')
    expect(PCS).not.toContain('storage_light')
  })

  it('★ 뱃지(dBadges)에는 차광이 없다 — 칸 색으로만 보인다 (2026-11-07 지시)', () => {
    expect(DB).not.toContain('shadeBadge()')
    expect(DB).not.toContain('storage_light')
  })

  it('★ 칸 색 두 곳이 같은 함수를 부른다 (한쪽만 바뀌지 않게)', () => {
    for (const part of [CS, PCS]) expect(part).toContain('isShade(d)')
  })

  it('화면 표 「차광」 칸도 같은 자료를 본다', () => {
    expect(CODE).toContain('{isShade(d) ? CB(shadeBadge())')
  })

  it('표 정렬·필터용 값(mkRow.light)도 같은 자료를 본다', () => {
    expect(CODE).toContain("light: isShade(d) ? '차광' : '-'")
  })

  it('엑셀 내려받기도 같은 자료를 본다', () => {
    expect(CODE).toContain("light: isShade(d) ? '차광' : ''")
  })
})

describe('★ 차광 색 — 화면 모드를 타지 않는다', () => {
  it('바탕 #1F1F1F · 글씨 #FFE082', () => {
    expect(SHADE_BG).toBe('#1F1F1F')
    expect(SHADE_FG).toBe('#FFE082')
    expect(SHADE_LABEL).toBe('차광')
  })

  it('★ 새 색이 아니다 — 둘 다 이미 쓰던 값이다', () => {
    /* #1F1F1F = 발음 체크 표시(SOUND_CHECK) · #FFE082 = 팔레트 t.yellow(발음 칩 바탕) */
    expect(DEFS).toContain("export const SOUND_CHECK = '#1F1F1F'")
    expect(APP).toContain("yellow:'#FFE082'")
  })

  it('★ 팔레트(t.text·t.navText)를 쓰지 않는다 — 어두운 화면에서 둘 다 #E8E6E1 이었다', () => {
    const SB = between('const shadeBadge = () =>', '});')
    expect(SB).toContain('SHADE_BG')
    expect(SB).toContain('SHADE_FG')
    expect(SB).not.toContain('t.text')
    expect(SB).not.toContain('t.navText')
  })

  it('어두운 팔레트에서 t.text 와 t.navText 가 정말 같은 값이다 (그래서 안 썼다)', () => {
    const dark = APP.slice(APP.indexOf('  dark: {'), APP.indexOf('const CATS'))
    expect(dark).toContain("text:'#E8E6E1'")
    expect(dark).toContain("navText:'#E8E6E1'")
  })

  it('발음 칩과 정확히 뒤집힌 색이다 (나란히 놓아도 갈린다)', () => {
    const sound = cautionChipColors({ mode: 'light', yellow: '#FFE082' }, 'sound')
    expect(sound.bg).toBe(SHADE_FG)   // 발음 바탕 = 차광 글씨
    expect(sound.fg).toBe('#000000')
  })
})

describe('★ 차광 아이콘 — 초승달 SVG', () => {
  it('그림(SVG)이다', () => {
    const { container } = render(<ShadeIcon size={8} color="#FFE082" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('width')).toBe('8')
  })

  it('글씨색을 따른다', () => {
    const { container } = render(<ShadeIcon size={8} color="#FFE082" />)
    expect(container.querySelector('path').getAttribute('fill')).toBe('#FFE082')
  })

  it('★ 이모지가 아니다 — 글자가 하나도 없다', () => {
    const { container } = render(<ShadeIcon />)
    expect(container.textContent).toBe('')
    expect(CHIPS).not.toMatch(/🌙|☀|🌞|🕶/)
  })

  it('덩어리 하나로 그렸다 (8px 에서도 모양이 남게)', () => {
    const { container } = render(<ShadeIcon />)
    expect(container.querySelectorAll('path').length).toBe(1)
    /* 획 두께에 기대지 않는다 — stroke 가 없다 */
    expect(container.querySelector('path').getAttribute('stroke')).toBeNull()
  })

  it('주의 3종 아이콘과 다른 그림이다', () => {
    const shade = render(<ShadeIcon size={8} color="#fff" />).container.innerHTML
    for (const k of ['dose', 'shape', 'sound', 'high']) {
      const other = render(<CautionIcon kind={k} size={8} color="#fff" />).container.innerHTML
      expect(shade).not.toBe(other)
    }
  })
})

describe('★ 뱃지 그리기 — 주의 3종과 같은 틀', () => {
  const CB = between('const CB = b =>', 'CautionIcon kind={b.kind} size={8} color={b.fg} />}{b.x}</span>;')

  it('차광이면 ShadeIcon, 아니면 CautionIcon', () => {
    expect(CB).toContain('b.shade ? <ShadeIcon size={8} color={b.fg} />')
    expect(CB).toContain('<CautionIcon kind={b.kind} size={8} color={b.fg} />')
  })

  it('같은 badgeStyle 을 쓴다 (크기·둥글기가 자리마다 그대로)', () => {
    expect(CB).toContain('badgeStyle(b.bg, b.fg, b.bd)')
  })

  it('카세트 칸·제안 칸·인쇄 표 모두 아이콘 뱃지를 CB 로 그린다', () => {
    /* 현재배치 칸 · 사용량순 제안 칸(2026-11-07 추가) · 인쇄 표 = 3곳 */
    expect((CODE.match(/\(b\.kind \|\| b\.shade\) \? CB\(b\)/g) || []).length).toBe(3)
  })

  it('뱃지 모양(크기·둥글기)은 바뀌지 않았다', () => {
    const style = between('const badgeStyle = (bg, fg, bd) =>', '});')
    expect(style).toContain('fontSize: 8')
    expect(style).toContain('borderRadius: 3')
    expect(style).toContain("printColorAdjust: 'exact'")
    expect(style).toContain("WebkitPrintColorAdjust: 'exact'")
  })
})

describe('★ 인쇄 표 — 배지 칸 16%', () => {
  const HEAD = between("[['슬롯', '12%', 'center']", "]]")

  it('배지 16% · 성분명 42% 다', () => {
    expect(HEAD).toContain("['성분명', '42%', 'left']")
    expect(HEAD).toContain("['배지', '16%', 'center']")
  })

  it('슬롯·약품명은 그대로다', () => {
    expect(HEAD).toContain("['슬롯', '12%', 'center']")
    expect(HEAD).toContain("['약품명', '30%', 'left']")
  })

  it('네 칸을 더하면 100% 다', () => {
    const ws = (HEAD.match(/'(\d+)%'/g) || []).map(s => Number(s.replace(/\D/g, '')))
    expect(ws).toHaveLength(4)
    expect(ws.reduce((a, b) => a + b, 0)).toBe(100)
  })
})

describe('★ 건드리지 않은 것', () => {
  it('lasa_type 칸은 그대로 남아 있다', () => {
    expect(APP).toContain('lasa_type')
  })

  it('약품목록·라벨 인쇄 목록에는 차광 칩을 넣지 않았다', () => {
    const LABEL = readFileSync(resolve(process.cwd(), 'src/LabelPrint.jsx'), 'utf8')
    expect(LABEL).not.toContain('ShadeIcon')
    expect(LABEL).not.toContain('isShade')
  })

  it('★ 85×45 라벨에는 **차광 뱃지가 들어갔다** (2026-11-09 결정 바뀜)', () => {
    /* 2026-11-07 에는 「라벨에 차광을 넣지 않는다」였는데, 2026-11-09 에 뱃지로 넣기로 바뀌었다.
       자세한 것은 src/LabelShadeBadge.test.jsx 에 있다. 여기서는 들어갔다는 사실만 못 박는다. */
    const LBL = readFileSync(resolve(process.cwd(), 'src/DrugLabel.jsx'), 'utf8')
    expect(LBL).toContain('ShadeIcon')
    const DEF = readFileSync(resolve(process.cwd(), 'src/lib/labelDefs.js'), 'utf8')
    expect(DEF).toContain('export function isShade')
  })

  it('주의 3종 칩은 그대로다', () => {
    expect(DEFS).toContain("{ kind: 'dose', col: 'caution_dose', label: '용량' }")
    expect(DEFS).toContain("{ kind: 'shape', col: 'caution_shape', label: '모양' }")
    expect(DEFS).toContain("{ kind: 'sound', col: 'caution_sound', label: '발음' }")
  })

  it('고위험 칩 색도 그대로다', () => {
    expect(DEFS).toContain("export const HIGH_ALERT_BG = '#D9342B1A'")
    expect(DEFS).toContain("export const HIGH_ALERT_FG = '#D9342B'")
  })
})
