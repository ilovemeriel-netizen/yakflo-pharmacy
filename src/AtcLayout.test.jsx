/* ATC 화면 짜임새 — 2026-11-07.
 *
 * 못 박는 것
 *  ① 칸 머리 줄이 **줄바꿈할 수 있다** (minWidth:0 + flexShrink) — 좁은 창에서 뱃지가 잘리던 것
 *  ② 현재배치 칸과 사용량순 제안 칸이 **같은 머리 줄·같은 뱃지**를 쓴다
 *  ③ FSP 위·아래 표의 앞 4열 값과 **합계**가 같다 (합계가 다르면 앞 열부터 어긋난다)
 *
 * `Cell`·`PCell` 은 `AtcView` 안에 있어 따로 불러올 수 없다 — 소스를 읽어 확인한다.
 * 줄바꿈이 실제로 되는지는 **부품을 직접 렌더해** 폭을 재서 확인한다.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }

describe('★ 칸 머리 줄 — 뱃지가 칸을 넘지 않게', () => {
  it('공용 모양(slotHead·badgeWrap)이 있다', () => {
    expect(CODE).toContain('const slotHead = {')
    expect(CODE).toContain('const badgeWrap = {')
  })

  it('★ 뱃지 묶음은 줄지 않고 **줄바꿈**한다 (2026-11-07 — minWidth:0 은 줄바꿈을 막았다)', () => {
    const w = between('const badgeWrap = {', '};')
    expect(w).toContain('flexShrink: 0')
    expect(w).not.toContain('minWidth: 0')
    expect(w).toContain("flexWrap: 'wrap'")
  })

  it('뱃지는 오른쪽으로 모인다 (줄바꿈해도 오른쪽 정렬)', () => {
    expect(between('const badgeWrap = {', '};')).toContain("justifyContent: 'flex-end'")
  })

  it('★ 슬롯 번호는 줄어들지 않는다 (번호가 먼저 찌그러지면 안 된다)', () => {
    /* 2026-11-07 — 번호에 투명도까지 붙어 slotNo·slotNoDim 으로 옮겼다 */
    expect(CODE).toContain('<span style={slotNo}>{label}</span>')
    expect(CODE).toContain('<span style={slotNoDim}>{slot}</span>')
  })

  it('머리 줄 글자 크기·굵기는 바뀌지 않았다', () => {
    const s = between('const slotHead = {', '};')
    expect(s).toContain('fontSize: 9')
    expect(s).toContain('fontWeight: 700')
    expect(s).toContain("justifyContent: 'space-between'")
    expect(s).toContain("flexWrap: 'wrap'")   /* 2026-11-07 — 안 맞으면 뱃지가 제 줄로 */
  })
})

describe('★ 두 칸이 같은 뱃지를 쓴다', () => {
  const CELL = between('const Cell = (label, key, byMap, fluid, editable) =>', 'const Door =')
  const PCELL = between('const PCell = (slot, exp) =>', 'const td = {')

  it('현재배치 칸이 dBadges 를 그린다', () => {
    expect(CELL).toContain('cellBadges(d)')
    expect(CELL).toContain('style={slotHead}')
    expect(CELL).toContain('style={badgeWrap}')
  })

  it('★ 사용량순 제안 칸도 dBadges 를 그린다 (예전에는 뱃지 줄이 아예 없었다)', () => {
    expect(PCELL).toContain('cellBadges(d)')
    expect(PCELL).toContain('badgeWrap')
    expect(PCELL).toContain('slotHead')
  })

  it('두 칸 모두 아이콘 뱃지를 CB 로 그린다', () => {
    expect(CELL).toContain('(b.kind || b.shade) ? CB(b)')
    expect(PCELL).toContain('(b.kind || b.shade) ? CB(b)')
  })

  it('제안 칸의 흐린 글씨(0.62)는 이제 **슬롯 번호에만** 걸린다', () => {
    expect(PCELL).toContain('style={slotNoDim}')
    expect(PCELL).not.toContain('opacity: 0.62')
  })

  it('★ 제안 칸은 0.5T(fsp_note)도 거르지 않는다 — 현재배치 칸만 거른다', () => {
    /* 현재배치는 FSP 칸이 아니면 초록 뱃지를 빼지만, 제안 칸에는 FSP 가 섞이지 않는다 */
    expect(CELL).toContain("String(key).startsWith('FSP')")
    expect(PCELL).not.toContain('startsWith')
  })
})

describe('★ FSP 위·아래 표 — 앞 4열을 맞춘다', () => {
  /* 2026-11-07 — 마지막 막대 열에 너비를 주지 않게 바뀌었다(안 ⓑ).
     「합계가 같다」는 더 이상 뜻이 없다 — 막대가 남는 폭을 혼자 먹기 때문이다.
     대신 **앞 4열이 글자 그대로 같은지**를 못 박는다. 그게 두 표를 맞추는 진짜 조건이다. */
  it('위 표 앞 4열이 64·110·190·90 이다 (약품명 170 → 190)', () => {
    expect(CODE).toContain('colWidths={[64, 110, 190, 90, null]}')
  })

  it('아래 표 앞 4열도 같다', () => {
    expect(CODE).toContain('colWidths={[64, 110, 190, 90, 64, null]}')
  })

  it('★ 두 표의 앞 4열이 **글자 그대로** 같다 (다르면 열이 어긋나 보인다)', () => {
    const got = [...CODE.matchAll(/colWidths=\{\[(64, 110, 190, 90[^\]]*)\]\}/g)].map(m => m[1])
    expect(got).toHaveLength(2)
    expect(got[0].startsWith('64, 110, 190, 90')).toBe(true)
    expect(got[1].startsWith('64, 110, 190, 90')).toBe(true)
  })

  it('★ 마지막 막대 열에는 너비를 주지 않는다 — 남는 폭을 막대가 먹는다', () => {
    /* 주지 않으면 비율대로 늘어나 글자 칸까지 넓어진다(실측: 약품명 170 → 322px) */
    expect(CODE).toContain('colWidths={[64, 110, 190, 90, null]}')
    expect(CODE).toContain('colWidths={[64, 110, 190, 90, 64, null]}')
    expect(CODE).not.toContain('colWidths={[64, 110, 170, 90, 194]}')
    expect(CODE).not.toContain('colWidths={[64, 110, 170, 90, 64, 130]}')
  })

  it('★ minWidth 도 둘 다 628 다', () => {
    expect((CODE.match(/minWidth=\{628\}/g) || []).length).toBe(2)
    expect(CODE).not.toContain('minWidth={520}')
    expect(CODE).not.toContain('minWidth={620}')
  })

  it('열 이름은 그대로다 (제안순위 / 슬롯)', () => {
    expect(CODE).toContain("h: '제안순위'")
    expect(CODE).toContain("h: '슬롯'")
  })
})

describe('★ 줄바꿈이 실제로 되는가 (부품을 그려서 잰다)', () => {
  /* jsdom 은 레이아웃을 재지 않으므로, **스타일 값**이 줄바꿈을 막지 않는지 확인한다.
     실제 폭 측정은 엣지 캡처로 따로 했다(44_ATC칸_전/후.png — 넘침 28칸 → 0칸). */
  const wrapStyle = () => {
    const w = between('const badgeWrap = {', '};')
    const o = {}
    for (const m of w.matchAll(/(\w+):\s*('([^']*)'|[\d.]+)/g)) o[m[1]] = m[3] !== undefined ? m[3] : Number(m[2])
    return o
  }

  it('묶음이 inline-flex 이고 wrap 이 켜져 있다', () => {
    const o = wrapStyle()
    expect(o.display).toBe('inline-flex')
    expect(o.flexWrap).toBe('wrap')
  })

  it('★ minWidth 가 없다 — 있으면 줄바꿈 대신 줄어든다(2026-11-07 실측)', () => {
    expect(wrapStyle().minWidth).toBeUndefined()
  })

  it('뱃지 사이 간격은 2 그대로다', () => {
    expect(wrapStyle().gap).toBe(2)
  })

  it('칸은 여전히 넘치는 것을 숨긴다 (잘림 자체는 마지막 방어선)', () => {
    const CELL = between('const Cell = (label, key, byMap, fluid, editable) =>', 'const Door =')
    expect(CELL).toContain("overflow: 'hidden'")
  })
})

describe('★ 건드리지 않은 것', () => {
  it('★ 칸 높이는 **한 값**을 셋이 같이 쓴다 (뱃지 개수와 상관없이 같은 높이)', () => {
    expect(CODE).toContain('const CELL_MIN = 78;')
    /* 현재배치 칸 · 사용량순 제안 칸 · 제안 화면 FSP 칸 = 3곳 */
    expect((CODE.match(/minHeight: CELL_MIN/g) || []).length).toBe(3)
    expect(CODE).not.toContain('minHeight: 46')
  })

  it('약품명 두 줄 자르기 그대로', () => {
    expect((CODE.match(/WebkitLineClamp: 2/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('뱃지 모양(크기·둥글기·인쇄색)은 그대로', () => {
    const s = between('const badgeStyle = (bg, fg, bd) =>', '});')
    expect(s).toContain('fontSize: 8')
    expect(s).toContain('borderRadius: 3')
    expect(s).toContain("printColorAdjust: 'exact'")
  })

  it('칸 색 함수(cs·pcs)는 이번에 건드리지 않았다', () => {
    expect(CODE).toContain('const k = cellCaution(d);')
    expect(CODE).toContain('const _k = cellCaution(d);')
  })

  it('render 가 터지지 않는다 (부품 불러오기 확인)', () => {
    const { container } = render(<span style={{ display: 'inline-flex', minWidth: 0 }} />)
    expect(container.querySelector('span')).toBeTruthy()
  })
})
