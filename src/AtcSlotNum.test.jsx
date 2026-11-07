/* ATC 칸 — 슬롯 번호 가림 · 뱃지 흐림 (2026-11-07 이정화 님 승인 A·B).
 *
 * ① 번호 가림
 *   뱃지 묶음이 `minWidth:0` + `flexShrink:1` 이라 **줄바꿈 대신 줄어들었고**,
 *   `justifyContent:'flex-end'` 때문에 넘치는 쪽이 **왼쪽**이라 번호를 덮었다.
 *   실측 — 창 900px 에서 25칸(최대 24.1px) · 1152px 에서 23칸 · 1280px 에서 0칸.
 *   → 묶음을 **안 줄이고**(flexShrink:0) 머리 줄에 flexWrap 을 주어 제 줄로 내려가게.
 *
 * ② 뱃지 흐림
 *   CSS opacity 는 자식까지 통째로 흐리게 한다. 머리 줄에 걸려 있어 뱃지까지 흐렸다
 *   (현재배치 0.85 · 사용량순 제안 0.62). → **슬롯 번호에만** 준다.
 *
 * ③ 칸 높이
 *   머리가 두 줄이 될 수 있어 60/74 두 종류가 됐다 → CELL_MIN 을 74 로 올려 하나로.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }
const obj = src => { const o = {}; for (const m of src.matchAll(/(\w+):\s*('([^']*)'|[\d.]+)/g)) o[m[1]] = m[3] !== undefined ? m[3] : Number(m[2]); return o }

describe('★ 뱃지 묶음 — 줄이지 않고 줄바꿈', () => {
  const W = obj(between('const badgeWrap = {', '};'))

  it('★ 줄어들지 않는다 (flexShrink 0) — 이 값이 1 이면 또 번호를 덮는다', () => {
    expect(W.flexShrink).toBe(0)
  })

  it('★ minWidth:0 이 없다 (있으면 줄바꿈 대신 줄어든다)', () => {
    expect(W.minWidth).toBeUndefined()
  })

  it('칸보다 넓어지지 않는다', () => {
    expect(W.maxWidth).toBe('100%')
  })

  it('묶음 안에서도 줄바꿈한다 · 오른쪽 정렬은 그대로', () => {
    expect(W.flexWrap).toBe('wrap')
    expect(W.justifyContent).toBe('flex-end')
  })
})

describe('★ 머리 줄 — 안 맞으면 뱃지가 제 줄로', () => {
  const H = obj(between('const slotHead = {', '};'))

  it('★ 머리 줄이 줄바꿈한다', () => {
    expect(H.flexWrap).toBe('wrap')
    expect(H.rowGap).toBe(2)
  })

  it('★ 머리 줄에는 투명도가 **없다** (있으면 뱃지까지 흐려진다)', () => {
    expect(H.opacity).toBeUndefined()
  })

  it('글자 크기·굵기·양끝 정렬은 그대로', () => {
    expect(H.fontSize).toBe(9)
    expect(H.fontWeight).toBe(700)
    expect(H.justifyContent).toBe('space-between')
    expect(H.alignItems).toBe('center')
    expect(H.gap).toBe(3)
  })
})

describe('★ 투명도는 슬롯 번호에만', () => {
  it('현재배치 0.85 · 사용량순 제안 0.62', () => {
    expect(CODE).toContain('const slotNo = { flexShrink: 0, opacity: 0.85 };')
    expect(CODE).toContain('const slotNoDim = { flexShrink: 0, opacity: 0.62 };')
  })

  it('★ 번호가 줄어들지 않는다 (번호가 먼저 찌그러지면 안 된다)', () => {
    for (const k of ['slotNo', 'slotNoDim'])
      expect(obj(between('const ' + k + ' = {', '};')).flexShrink).toBe(0)
  })

  it('두 칸이 각각 제 값을 쓴다', () => {
    expect(CODE).toContain('<span style={slotNo}>{label}</span>')
    expect(CODE).toContain('<span style={slotNoDim}>{slot}</span>')
  })

  it('★ 옛 방식(머리 줄 통째로 흐리게)이 남아 있지 않다', () => {
    expect(CODE).not.toContain('{ ...slotHead, opacity: 0.62 }')
    expect(CODE).not.toContain('<span style={{ flexShrink: 0 }}>{label}</span>')
    expect(CODE).not.toContain('<span style={{ flexShrink: 0 }}>{slot}</span>')
  })
})

describe('★ 칸 높이는 여전히 하나', () => {
  it('CELL_MIN 이 74 다', () => {
    expect(CODE).toContain('const CELL_MIN = 74;')
  })

  it('세 곳이 같이 쓴다 (현재배치 · 제안 · 제안 FSP)', () => {
    expect((CODE.match(/minHeight: CELL_MIN/g) || []).length).toBe(3)
  })

  it('숫자를 따로 적은 곳이 없다', () => {
    expect(CODE).not.toContain('minHeight: 60')
    expect(CODE).not.toContain('minHeight: 46')
  })
})

describe('★ 건드리지 않은 것', () => {
  it('뱃지 모양(크기·둥글기·인쇄색) 그대로', () => {
    const s = between('const badgeStyle = (bg, fg, bd) =>', '});')
    expect(s).toContain('fontSize: 8')
    expect(s).toContain('borderRadius: 3')
    expect(s).toContain("printColorAdjust: 'exact'")
  })

  it('칸 색 차례·범례는 그대로', () => {
    expect(CODE).toContain('const CELL_SHADE = { bg: SHADE_BG, bd: SHADE_BG, fg: SHADE_FG };')
    expect(CODE).toContain("const LEGEND = [['차광', CELL_SHADE], ['모양', CELL_SHAPE], ['용량', CELL_DOSE],")
  })

  it('약품명 두 줄 자르기 그대로', () => {
    expect((CODE.match(/WebkitLineClamp: 2/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('뱃지 차례(상비 → 주의 3종 → 0.5T) 그대로', () => {
    const DB = between('const dBadges = d =>', 'return a; };')
    expect(DB.indexOf('atc_pinned')).toBeLessThan(DB.indexOf("['dose', 'shape', 'sound']"))
    expect(DB.indexOf('fsp_note')).toBeGreaterThan(DB.indexOf("['dose', 'shape', 'sound']"))
  })

  it('★ 뱃지를 빼는 규칙(표시 규칙 변경안)은 넣지 않았다', () => {
    /* 2026-11-07 — 칸 색만으로는 용량·발음·상비·일반이 구별되지 않아 하지 않기로 했다 */
    expect(CODE).not.toContain('bgAttr')
    expect(between('const cellBadges = d =>', ');')).toContain('dBadges(d)')
  })
})
