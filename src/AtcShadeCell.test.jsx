/* ATC 차광 표시 방식 — 2026-11-07 (이정화 님 지시).
 *
 * 차광은 **뱃지가 아니라 칸**으로 보인다.
 *   칸 바탕 #1F1F1F + 약품명 #FFE082, 칸 안 「차광」 뱃지는 붙이지 않는다.
 *   다른 뱃지(상비·용량·모양·발음·0.5T)는 그대로 붙는다.
 *
 * 못 박는 것
 *  ① 칸 색이 SHADE_BG/SHADE_FG 다 (현재배치 · 사용량순 제안 둘 다 같은 값)
 *  ② dBadges 에 차광 뱃지가 **없다**
 *  ③ 범례의 차광 색견본도 같은 검정이다
 *  ④ 인쇄 표에서는 **약품명 칸**이 검정 + 노랑이고 배경 그래픽을 꺼도 찍힌다
 *  ⑤ 배치 목록 표의 「차광」 **열은 그대로** 둔다 (표에서는 열로 구분)
 *  ⑥ 검정 칸 위 글자가 읽힌다 (대비비)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHADE_BG, SHADE_FG, isShade } from './lib/cautionDefs'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }

/* ── 대비비 (WCAG) ────────────────────────────────────────────────── */
const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const lum = hex => {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
/* 투명도가 걸린 글자를 바탕과 섞는다 */
const mix = (fg, bg, alpha) => {
  const h2 = s => { const n = s.replace('#', ''); return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)) }
  const [a, b] = [h2(fg), h2(bg)]
  const m = a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)))
  return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('')
}

describe('★ 차광 = 칸 색 (뱃지 아님)', () => {
  const CS = between('const cs = d => {', 'const Cell =')
  const PCS = between('const pcs = (d, exp) =>', 'const PCell =')
  const DB = between('const dBadges = d =>', 'return a; };')

  it('현재배치 칸이 검정 바탕 + 노랑 글씨다', () => {
    expect(CS).toContain('if (isShade(d)) return CELL_SHADE')  /* 공용 상수로 모음 — 2026-11-07 */
  })

  it('사용량순 제안 칸도 **같은 값**이다', () => {
    expect(PCS).toContain('if (isShade(d)) return CELL_SHADE')
  })

  it('★ 뱃지에는 차광이 없다', () => {
    expect(DB).not.toContain('shadeBadge')
    expect(DB).not.toContain('SHADE_')
  })

  it('★ 다른 뱃지는 그대로 붙는다 (상비·주의 3종·0.5T)', () => {
    expect(DB).toContain("{ x: '상비', bg: PIN_BG, fg: t.accent, bd: t.accent }")
    expect(DB).toContain("['dose', 'shape', 'sound']")
    expect(DB).toContain('bg: t.greenL, fg: t.green, bd: t.green')
  })

  it('색 두 가지는 이미 쓰던 값이다 (새 색 없음)', () => {
    expect(SHADE_BG).toBe('#1F1F1F')
    expect(SHADE_FG).toBe('#FFE082')
  })

  it('팔레트 값(t.text·t.navText)을 더 이상 쓰지 않는다', () => {
    for (const part of [CS, PCS]) {
      expect(part).not.toContain('bg: t.text')
      expect(part).not.toContain('fg: t.navText')
    }
  })
})

describe('★ 검정 칸 위 모양·용량 뱃지에만 흰 테두리 (2026-11-07 지시)', () => {
  const OS = between('const onShade = b =>', ');')
  const CBD = between('const cellBadges = d =>', ');')

  it('모양·용량 두 가지만 대상이다', () => {
    expect(CODE).toContain("const ON_SHADE = ['dose', 'shape'];")
  })

  it('흰 테두리를 준다', () => {
    expect(OS).toContain("bd: '#FFFFFF'")
  })

  it('★ 검정 칸일 때만 준다 — 밝은 칸은 그대로다', () => {
    expect(CBD).toContain('isShade(d) ? dBadges(d).map(onShade) : dBadges(d)')
  })

  it('CB 가 테두리를 실제로 그린다', () => {
    expect(CODE).toContain('badgeStyle(b.bg, b.fg, b.bd)')
  })

  it('두 칸 모두 cellBadges 를 쓴다 (현재배치 · 사용량순 제안)', () => {
    expect((CODE.match(/cellBadges\(d\)/g) || []).length).toBe(2)   /* 현재배치 칸 · 사용량순 제안 칸 */
  })

  it('★ 인쇄 표의 배지 칸은 흰 종이라 테두리를 주지 않는다', () => {
    const PB = between('<td className="bd"', '</td>')
    expect(PB).toContain('dBadges(d)')
    expect(PB).not.toContain('cellBadges')
  })

  it('뱃지 상자 크기는 그대로다 (badgeStyle 이 이미 1px 자리를 잡아 뒀다)', () => {
    expect(between('const badgeStyle = (bg, fg, bd) =>', '});'))
      .toContain("border: bd ? '1px solid ' + bd : '1px solid transparent'")
  })

  it('흰 테두리가 검정 칸과 또렷이 갈린다 — 16:1 이상', () => {
    expect(ratio('#FFFFFF', SHADE_BG)).toBeGreaterThan(16)
  })

  it.each([['모양', '#C62828', 5.0, 6.2], ['용량', '#2E4A62', 8.5, 10.0]])(
    '%s 뱃지 안에서도 테두리가 보인다', (_n, bg, lo, hi) => {
      const r = ratio('#FFFFFF', bg)
      expect(r).toBeGreaterThan(lo)
      expect(r).toBeLessThan(hi)
    })
})

describe('★ 사용량순 제안 칸 — 차광이 1순위 (2026-11-07 지시)', () => {
  const PCS = between('const pcs = (d, exp) =>', 'const PCell =')

  it('차광이 상비보다 **먼저** 온다', () => {
    const iShade = PCS.indexOf('isShade(d)')
    const iPin = PCS.indexOf('atc_pinned')
    expect(iShade).toBeGreaterThan(-1)
    expect(iPin).toBeGreaterThan(iShade)
  })

  it('★ 현재배치 칸(cs)과 같은 차례다', () => {
    const CS = between('const cs = d => {', 'const Cell =')
    expect(CS.indexOf('isShade(d)')).toBeLessThan(CS.indexOf('cellCaution(d)'))
    expect(PCS.indexOf('isShade(d)')).toBeLessThan(PCS.indexOf('cellCaution(d)'))
  })

  it('상비는 사라지지 않는다 — 색이 밀렸을 뿐 뱃지로 남는다', () => {
    expect(PCS).toContain('return CELL_PIN')
    expect(between('const dBadges = d =>', 'return a; };'))
      .toContain("{ x: '상비', bg: PIN_BG, fg: t.accent, bd: t.accent }")
  })

  it('제안 화면의 「FSP 고정식」 초록 블록은 그대로다', () => {
    expect(CODE).toContain("{ bg: t.greenL, bd: t.green, fg: t.green } : { bg: t.card, bd: t.textL, fg: t.textL }")
  })
})

describe('★ 범례', () => {
  it('차광 색견본이 칸과 같은 검정이다', () => {
    expect(CODE).toContain("['차광', CELL_SHADE]")
    expect(CODE).not.toContain("['차광', t.text]")
  })

  it('나머지 색견본은 그대로다', () => {
    for (const s of ["['모양', CELL_SHAPE]", "['용량', CELL_DOSE]", "['발음', CELL_SOUND]",
      "['상비 고정', CELL_PIN]", "['일반', CELL_PLAIN]"]) expect(CODE).toContain(s)
  })
})

describe('★ 인쇄 — 약품명 칸이 검정 + 노랑', () => {
  const NM = between('<td className="nm"', '</td>')

  it('차광이면 바탕·글씨가 바뀐다', () => {
    expect(NM).toContain('isShade(d)')
    expect(NM).toContain('background: SHADE_BG')
    expect(NM).toContain('color: SHADE_FG')
  })

  it('★ 배경 그래픽을 꺼도 찍힌다', () => {
    expect(NM).toContain("WebkitPrintColorAdjust: 'exact'")
    expect(NM).toContain("printColorAdjust: 'exact'")
  })

  it('차광이 아니면 아무것도 더하지 않는다', () => {
    expect(NM).toContain(': null)')
  })

  it('글자 굵기·아래 선은 그대로다', () => {
    expect(NM).toContain('fontWeight: 600')
    expect(NM).toContain("borderBottom: '0.3pt solid '")
  })
})

describe('★ 배치 목록 표의 「차광」 열은 그대로', () => {
  it('열이 남아 있다', () => {
    expect(CODE).toContain("{ k: 'light', h: '차광' }")
  })

  it('열 안에는 여전히 차광 칩을 그린다', () => {
    expect(CODE).toContain('{isShade(d) ? CB(shadeBadge())')
  })

  it('정렬·필터 값도 그대로다', () => {
    expect(CODE).toContain("light: isShade(d) ? '차광' : '-'")
  })
})

describe('★ 검정 칸 위 글자가 읽히는가 (대비비)', () => {
  it('약품명 — 7:1 이상', () => {
    expect(ratio(SHADE_FG, SHADE_BG)).toBeGreaterThan(7)
  })

  it('슬롯 번호 (opacity 0.85) — 4.5:1 이상', () => {
    expect(ratio(mix(SHADE_FG, SHADE_BG, 0.85), SHADE_BG)).toBeGreaterThan(4.5)
  })

  it('제안 칸의 흐린 글씨 (opacity 0.62) — 3:1 이상', () => {
    expect(ratio(mix(SHADE_FG, SHADE_BG, 0.62), SHADE_BG)).toBeGreaterThan(3)
  })

  it.each([
    ['상비', '#F5EDF6', '#804A87'],
    ['모양', '#C62828', '#FFFFFF'],
    ['용량', '#2E4A62', '#FFFFFF'],
    ['발음', '#FFE082', '#000000'],
    ['0.5T', '#E6F7EE', '#019748'],
  ])('%s 뱃지 — 글자는 제 바탕 위에서 읽힌다', (_n, bg, fg) => {
    expect(ratio(fg, bg)).toBeGreaterThan(3)
  })

  /* ★ 뱃지 **테두리**가 검정 칸과 갈리는가 — 값을 박아 둔다.
     상비·발음·0.5T 는 바탕이 밝아 또렷하고, 모양(2.9)·용량(1.8)은 낮다.
     2026-11-07 기준 ATC 차광 11종 중 **용량 뱃지가 붙는 약은 0종**이고
     모양이 붙는 약은 3종(삐콤정·훼로바유서방정·트레스탄캡슐)이다.
     색을 바꾸려면 승인이 필요하므로 지금은 **값만 지킨다** — 바뀌면 이 시험이 잡는다. */
  it.each([
    ['상비', '#F5EDF6', 13.5, 15.5],
    ['발음', '#FFE082', 11.5, 13.5],
    ['0.5T', '#E6F7EE', 13.5, 15.5],
    ['모양', '#C62828', 2.5, 3.3],
    ['용량', '#2E4A62', 1.5, 2.1],
  ])('%s 뱃지 테두리 대 검정 칸 — %s', (_n, bg, lo, hi) => {
    const r = ratio(bg, SHADE_BG)
    expect(r).toBeGreaterThan(lo)
    expect(r).toBeLessThan(hi)
  })
})

describe('★ 자료는 그대로', () => {
  it('차광 판정은 storage_method 하나다', () => {
    expect(isShade({ storage_method: '실온/차광' })).toBe(true)
    expect(isShade({ storage_method: '실온' })).toBe(false)
    expect(isShade({ storage_light: true, storage_method: '실온' })).toBe(false)
  })

  it('storage_light 는 실행문에 없다 (지우지도 않았다)', () => {
    expect(CODE).not.toContain('storage_light')
    expect(APP).toContain('storage_light')
  })

  it('lasa_type 칸도 그대로 남아 있다', () => {
    expect(APP).toContain('lasa_type')
  })
})
