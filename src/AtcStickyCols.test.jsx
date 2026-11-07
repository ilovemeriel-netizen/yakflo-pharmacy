/* ATC 배치 목록 — 고정 열을 **슬롯 + 약품명** 으로 (2026-11-07 이정화 님 지시).
 *
 * 왜: 가로로 끝까지 밀면 약품명이 통째로 고정열 밑으로 들어가 머리글까지 사라졌다.
 *   (실측 창 900px — 약품명 300px · 성분명 92px 가 숨었다)
 *   약품명을 고정하면 **성분명 180px 만** 숨는다.
 *
 * ★ 「넓은 창에서 고정 자리가 어긋난다」는 앞 진단은 **틀렸다.**
 *   `width:100%` + `minWidth` 는 둘 중 큰 쪽이 표 폭이 되므로
 *   **열이 늘어나는 창에서는 가로 스크롤이 생기지 않는다** → 고정이 아예 작동하지 않는다.
 *   스크롤이 생기는 좁은 창에서는 열 폭이 적어 둔 값 그대로다(창 900px 실측 120.0px).
 *   그래서 `left` 를 실제 폭에서 다시 계산할 필요가 없다 — 고치지 않았다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }
/* ATC 표의 열 정의와 몸통 */
const COLS = between("{ k: '_slotkey', h: '슬롯'", "{ k: 'mavg'")
const BODY = between('<tbody>{!atcPaged.length', '</tbody>')

describe('★ 머리글 — 고정은 슬롯 + 약품명 두 열', () => {
  it('슬롯이 맨 왼쪽에 고정된다', () => {
    expect(COLS).toContain("{ k: '_slotkey', h: '슬롯', sticky: { left: 0, w: 120 }")
  })

  it('★ 약품명이 슬롯 바로 뒤(120px)에 고정된다', () => {
    expect(COLS).toContain("{ k: 'drug_name', h: '약품명', sticky: { left: 120, w: 208 }")
  })

  it('★ 약품코드는 더 이상 고정이 아니다', () => {
    expect(COLS).toContain("{ k: 'drug_code', h: '약품코드' },")
    expect(COLS).not.toContain("h: '약품코드', sticky")
  })

  it('고정은 정확히 두 열이다', () => {
    expect((COLS.match(/sticky: \{/g) || []).length).toBe(2)
  })

  it('고정 자리가 서로 붙어 있다 (0 → 120 = 슬롯 폭)', () => {
    const slotW = Number((COLS.match(/sticky: \{ left: 0, w: (\d+) \}/) || [])[1])
    const nameL = Number((COLS.match(/h: '약품명', sticky: \{ left: (\d+)/) || [])[1])
    expect(slotW).toBe(120)
    expect(nameL).toBe(slotW)   /* 사이가 벌어지면 그 틈으로 다른 열이 비친다 */
  })

  it('나머지 열 차례는 그대로다', () => {
    /* COLS 는 월평균 바로 앞까지라 그 전 열들만 담긴다 */
    for (const k of ["h: '성분명'", "h: '유사'", "h: '차광'", "h: '최근3개월'", "h: '직전1개월'"])
      expect(COLS).toContain(k)
    expect(CODE).toContain("{ k: 'mavg', h: '월평균'")
  })
})

describe('★ 몸통 칸도 머리글과 같은 자리', () => {
  it('슬롯 칸이 left 0 이다', () => {
    expect(BODY).toContain("position: 'sticky', left: 0, zIndex: 2")
  })

  it('★ 약품명 칸이 left 120 이고 바탕이 깔려 있다', () => {
    const nm = BODY.slice(BODY.indexOf("position: 'sticky', left: 120"))
    expect(nm).toContain('background: t.card')
    expect(nm.slice(0, 400)).toContain('{d.drug_name}')
  })

  it('★ 약품코드 칸에는 고정이 없다 (밑으로 지나간다)', () => {
    const i = BODY.indexOf('{d.drug_code}')
    const start = BODY.lastIndexOf('<td', i)
    expect(BODY.slice(start, i)).not.toContain("position: 'sticky'")
  })

  it('고정 칸은 몸통에도 두 개뿐이다', () => {
    expect((BODY.match(/position: 'sticky'/g) || []).length).toBe(2)
  })

  it('약품코드를 눌러 약품 창을 여는 동작은 그대로다', () => {
    expect(BODY).toContain('onClick={() => open360 && open360(d)}')
  })
})

describe('★ 건드리지 않은 것', () => {
  it('열 폭(colWidths)은 그대로다', () => {
    expect(CODE).toContain('colWidths={[120, 120, 208, 220, 80, 72, 96, 96, 84]}')
  })

  it('표 최소 폭도 그대로다', () => {
    expect(CODE).toContain('minWidth={1096}')
  })

  it('★ StandardTable 은 한 글자도 바꾸지 않았다', () => {
    const ST = between('function StandardTable(', '</table></HScroll>;')
    expect(ST).toContain('left: c.sticky.left')          /* 적어 둔 값 그대로 쓴다 */
    expect(ST).not.toContain('ResizeObserver')
    expect(ST).not.toContain('--yk-l')
  })

  it('다른 화면의 고정 열도 그대로다 (약품목록 등)', () => {
    expect(CODE).toContain("const stickyLeft = k => { const idx = stickyOn.indexOf(k); return idx === -1 ? null : (idx === 0 ? 0 : _CODE_W) }")
    expect(CODE).toContain("sticky: { left: 0, w: CODE_W }")
  })
})
