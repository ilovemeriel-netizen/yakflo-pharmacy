/* ATC 범례·칸 색 차례 통일 — 2026-11-07 (이정화 님 지시).
 *
 * 전에는 범례가 **두 곳**이고 모양·항목·차례가 모두 달랐다.
 *   현재배치 : 색칠한 알약 · 차광이 `t.text`(남색) · 상비 없음 · 「점선 = 유동」 있음
 *   사용량순 제안 : 10x10 색견본 · 차광 `#1F1F1F` · 상비 있음 · 「점선 = 유동」 없음
 * 칸 색 차례도 달랐다 — 현재배치는 상비가 아예 색이 아니고, 제안은 상비가 주의보다 앞.
 *
 * 못 박는 것
 *  ① 범례가 **부품 하나**이고 두 화면이 그것을 쓴다
 *  ② 색견본이 **칸 색 상수 그대로**다 (따로 적으면 또 어긋난다)
 *  ③ 차례가 차광 > 모양 > 용량 > 발음 > 상비 > 일반, 두 화면 같다
 *  ④ 어두운 화면에서 차광 색견본에 테두리가 생긴다
 *  ⑤ 상비 뱃지가 어두운 화면에서 불투명 바탕이다
 *  ⑥ LIGHT_CHIP 이 팔레트에서 바로 온다 (화면 값은 그대로)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHADE_BG, SHADE_FG, cautionChipColors, CELL_PRIORITY, cellCaution } from './lib/cautionDefs'
import { LABEL_PRIORITY, bgKind } from './lib/labelDefs'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }

/* 대비비 */
const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const hx = h => { const n = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)) }
const lum = a => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2])
const ratio = (a, b) => { const [x, y] = [lum(hx(a)), lum(hx(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('★ 범례가 하나다', () => {
  it('부품 Legend 가 있다', () => {
    /* ★ 부품이 아니라 **함수**다 — 렌더 중에 부품을 만들면 리렌더마다 새로 생긴다(eslint react-hooks/static-components) */
    expect(CODE).toContain('const legend = fluid =>')
  })

  it('★ 두 화면이 그 부품을 쓴다 — 현재배치는 유동 표시까지', () => {
    expect(CODE).toContain('{legend(true)}')
    expect(CODE).toContain('{legend(false)}')
    expect((CODE.match(/\{legend\(/g) || []).length).toBe(2)
  })

  it('★ 옛 범례가 남아 있지 않다', () => {
    expect(CODE).not.toContain("background: t.text, color: t.bg, padding: '1px 6px'")
    expect(CODE).not.toContain("['모양', t.coral]")
    expect(CODE).not.toContain('width: 10, height: 10, borderRadius: 2')
  })

  it('「점선 = 유동」은 현재배치에만 나온다', () => {
    const L = between('const legend = fluid =>', '</div>;')
    expect(L).toContain('{fluid && <span')
    expect(L).toContain('점선 = 유동')
    expect((CODE.match(/점선 = 유동/g) || []).length).toBe(1)
  })

  it('설명 문구는 더 붙이지 않았다', () => {
    const L = between('const legend = fluid =>', '</div>;')
    expect(L).not.toContain('뱃지로도')
    expect(L).not.toContain('하나만')
  })
})

describe('★ 범례 항목과 차례', () => {
  it('차광 → 모양 → 용량 → 발음 → 상비 고정 → 일반', () => {
    expect(CODE).toContain("const LEGEND = [['차광', CELL_SHADE], ['모양', CELL_SHAPE], ['용량', CELL_DOSE],")
    expect(CODE).toContain("['발음', CELL_SOUND], ['상비 고정', CELL_PIN], ['일반', CELL_PLAIN]]")
  })

  it('★ 색견본이 칸 색 상수를 그대로 쓴다 (값을 따로 적지 않는다)', () => {
    const L = between('const legend = fluid =>', '</div>;')
    expect(L).toContain('background: s.bg')
    expect(L).toContain('color: s.fg')
    expect(L).not.toContain('t.coral')
    expect(L).not.toContain('SHADE_BG,')
  })

  it('「상비 고정」 항목이 남아 있다', () => {
    expect(CODE).toContain("['상비 고정', CELL_PIN]")
  })
})

describe('★ 어두운 화면 — 차광 색견본 테두리', () => {
  it('어두울 때만 t.border 를 쓴다', () => {
    const L = between('const legend = fluid =>', '</div>;')
    expect(L).toContain('s === CELL_SHADE && isDark(t) ? t.border : s.bd')
  })

  it('★ 테두리가 없으면 어두운 카드와 1.04:1 이라 안 보인다', () => {
    expect(ratio(SHADE_BG, '#1A2332')).toBeLessThan(1.1)
  })

  it('밝은 화면에서는 테두리가 필요 없다 (16:1 넘음)', () => {
    expect(ratio(SHADE_BG, '#FFFFFF')).toBeGreaterThan(16)
  })

  it('어두운 화면 테두리(t.border)가 색견본과 갈린다', () => {
    expect(ratio('#2A3A4A', SHADE_BG)).toBeGreaterThan(1.3)
  })
})

describe('★ 칸 색을 정하는 차례 vs 범례에 보이는 차례 — 둘은 다르다', () => {
  /* 2026-11-07 정정 — 제가 PR 설명에 「차광 > 모양 > 용량 > 발음」이라고 잘못 적었다.
     그건 **범례에 보이는 줄 차례**이고, 색을 고르는 차례는 **차광 > 발음 > 모양 > 용량 > 상비** 다. */
  it('★ 색을 고르는 차례 — 주의 3종은 발음 > 모양 > 용량', () => {
    expect(CELL_PRIORITY).toEqual(['sound', 'shape', 'dose'])
  })

  it('★ 라벨 바탕색과 **같은 차례**다 (종이와 화면이 다른 색이면 더 헷갈린다)', () => {
    expect(CELL_PRIORITY).toEqual(LABEL_PRIORITY)
  })

  it('두 함수(칸 색·라벨 바탕색)가 같은 답을 낸다', () => {
    const D = o => ({ caution_dose: false, caution_shape: false, caution_sound: false, ...o })
    for (const bits of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
      const d = D({ caution_dose: !!bits[0], caution_shape: !!bits[1], caution_sound: !!bits[2] })
      expect(cellCaution(d)).toBe(bgKind(d))
    }
  })

  it('범례에 보이는 차례는 그것과 **다르다** (차광 → 모양 → 용량 → 발음 → 상비 → 일반)', () => {
    const order = (CODE.match(/const LEGEND = \[([\s\S]*?)\]\];/) || [])[1] || ''
    const names = (order.match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''))
    expect(names).toEqual(['차광', '모양', '용량', '발음', '상비 고정', '일반'])
  })

  it('★ 지금 운영에는 주의가 2개 이상인 약이 없어 차례가 화면을 바꾸지 않는다', () => {
    /* 2026-11-07 운영 실측 — ATC 90종 중 0종, 약품 전체 1,133종 중에도 0종.
       주의가 하나뿐이면 어떤 차례를 쓰든 같은 색이 나온다. */
    const D = o => ({ caution_dose: false, caution_shape: false, caution_sound: false, ...o })
    for (const k of ['dose', 'shape', 'sound']) {
      const col = { dose: 'caution_dose', shape: 'caution_shape', sound: 'caution_sound' }[k]
      expect(cellCaution(D({ [col]: true }))).toBe(k)
    }
  })
})

describe('★ 칸 색 차례 — 두 화면이 같다', () => {
  const CS = between('const cs = d => {', 'const Cell =')
  const PCS = between('const pcs = (d, exp) =>', 'const PCell =')

  it('공용 상수 6개가 있다', () => {
    for (const k of ['CELL_SHADE', 'CELL_SHAPE', 'CELL_DOSE', 'CELL_SOUND', 'CELL_PIN', 'CELL_PLAIN'])
      expect(CODE).toContain('const ' + k + ' =')
  })

  it('★ 두 함수 모두 차광 → 주의 → 상비 차례다', () => {
    for (const part of [CS, PCS]) {
      const iShade = part.indexOf('isShade(d)')
      const iCau = part.indexOf('cellCaution(d)')
      const iPin = part.indexOf('atc_pinned')
      expect(iShade).toBeGreaterThan(-1)
      expect(iCau).toBeGreaterThan(iShade)
      expect(iPin).toBeGreaterThan(iCau)
    }
  })

  it('★ 두 함수가 **같은 상수**를 돌려준다 (값을 따로 적지 않는다)', () => {
    for (const part of [CS, PCS]) {
      expect(part).toContain('return CELL_SHADE')
      expect(part).toContain('return CELL_SHAPE')
      expect(part).toContain('return CELL_DOSE')
      expect(part).toContain('return CELL_SOUND')
      expect(part).toContain('return CELL_PIN')
    }
    /* 예전에 제안 칸만 달랐던 글씨색(t.blue·t.amber)이 사라졌다 */
    expect(PCS).not.toContain('fg: t.blue')
    expect(PCS).not.toContain('fg: t.amber')
  })

  it('FSP 고정식 블록의 「배정됨」 초록은 그대로다', () => {
    expect(CODE).toContain("{ bg: t.greenL, bd: t.green, fg: t.green } : { bg: t.card, bd: t.textL, fg: t.textL }")
  })
})

describe('★ 상비 뱃지 — 어두운 화면만 불투명', () => {
  it('어두우면 팔레트 cardSolid 를 쓴다', () => {
    expect(CODE).toContain('const PIN_BG = isDark(t) ? t.cardSolid : t.accentL;')
  })

  it('뱃지가 그 값을 쓴다', () => {
    expect(between('const dBadges = d =>', 'return a; };'))
      .toContain("{ x: '상비', bg: PIN_BG, fg: t.accent, bd: t.accent }")
  })

  it('★ 전 — 연빨강 칸 위에서 묻혔다 (투명 12% 라 밑색이 비쳤다)', () => {
    const mix = (fg, bg, al) => '#' + hx(fg).map((v, i) => Math.round(v * al + hx(bg)[i] * (1 - al)).toString(16).padStart(2, '0')).join('')
    expect(ratio('#BFA6D9', mix('#BFA6D9', '#F39E94', 0.12))).toBeLessThan(1.1)
  })

  it('★ 후 — 어느 칸 위에서도 6:1 을 넘는다', () => {
    expect(ratio('#BFA6D9', '#1E2A3A')).toBeGreaterThan(6)
  })

  it('연빨강·검정 칸과도 갈린다 (테두리 t.accent 가 받쳐 준다)', () => {
    expect(ratio('#1E2A3A', '#F39E94')).toBeGreaterThan(6)
    expect(ratio('#BFA6D9', SHADE_BG)).toBeGreaterThan(7)   /* 검정 칸 위 테두리 */
  })

  it('밝은 화면은 그대로다 (accentL 불투명)', () => {
    expect(ratio('#804A87', '#F5EDF6')).toBeGreaterThan(4.5)
  })
})

describe('★ LIGHT_CHIP 을 팔레트에서 바로 가져온다', () => {
  it('값을 베껴 적지 않는다', () => {
    expect(CODE).toContain("const LIGHT_CHIP = { mode: 'light', blue: themes.light.blue, red: themes.light.red, yellow: themes.light.yellow };")
    expect(CODE).not.toContain("blue: '#2E4A62', red: '#C62828', yellow: '#FFE082'")
  })

  it('★ 화면 값은 하나도 바뀌지 않는다', () => {
    const L = { mode: 'light', blue: '#2E4A62', red: '#C62828', yellow: '#FFE082' }
    expect(cautionChipColors(L, 'dose')).toEqual({ bg: '#2E4A62', fg: '#FFFFFF' })
    expect(cautionChipColors(L, 'shape')).toEqual({ bg: '#C62828', fg: '#FFFFFF' })
    expect(cautionChipColors(L, 'sound')).toEqual({ bg: '#FFE082', fg: '#000000' })
  })

  it('팔레트의 밝은 값이 그 셋과 같다 (바뀌면 이 시험이 잡는다)', () => {
    const light = APP.slice(APP.indexOf('  light: {'), APP.indexOf('  dark: {'))
    expect(light).toContain("blue:'#2E4A62'")
    expect(light).toContain("red:'#C62828'")
    expect(light).toContain("yellow:'#FFE082'")
  })
})

describe('★ 건드리지 않은 것', () => {
  it('차광 색 두 가지 그대로', () => {
    expect(SHADE_BG).toBe('#1F1F1F')
    expect(SHADE_FG).toBe('#FFE082')
  })

  it('뱃지 차례(상비 → 주의 3종 → 0.5T)는 그대로', () => {
    const DB = between('const dBadges = d =>', 'return a; };')
    expect(DB.indexOf('atc_pinned')).toBeLessThan(DB.indexOf("['dose', 'shape', 'sound']"))
    expect(DB.indexOf('fsp_note')).toBeGreaterThan(DB.indexOf("['dose', 'shape', 'sound']"))
  })

  it('칸 높이·고정 열은 그대로', () => {
    expect(CODE).toContain('const CELL_MIN = 74;')
    expect(CODE).toContain("{ k: 'drug_name', h: '약품명', sticky: { left: 120, w: 208 }")
  })
})
