/* 마약·향정 사용량 창 — 왼쪽 정렬 + 머리 정렬 (2026-11-13 이정화 님 승인)
 *
 * 못 박는 것
 *   ① 창 상자에 왼쪽 정렬이 있다 — #root 의 가운데정렬(함정 #31)을 막는다
 *   ② ★ 전역 CSS(#root)는 건드리지 않는다
 *   ③ 표 **둘 다** 머리글에 정렬이 붙고, 정렬 상태는 **표마다 따로**다
 *   ④ ★ 거르기(복수 선택 필터)는 나오지 않는다 — ColMenu 에 filter 를 주지 않는다
 *   ⑤ ★ 정렬은 **보여 줄 때만** — 원본 배열을 뒤집지 않는다
 *   ⑥ 숫자 칸은 오른쪽 정렬 그대로 · 새 색·새 라이브러리 없음
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const SRC = fs.readFileSync('src/NarcoticUsageModal.jsx', 'utf8')
const APP = fs.readFileSync('src/App.jsx', 'utf8')
const CSS = fs.readFileSync('src/index.css', 'utf8')

describe('★ ① 창 안에서만 왼쪽으로 돌린다', () => {
  it('창 상자에 textAlign: left 가 있다', () => {
    const i = SRC.indexOf("boxShadow: t.shadowH, boxSizing: 'border-box'")
    expect(i, '창 상자를 찾지 못했다').toBeGreaterThan(0)
    expect(SRC.slice(i, i + 420)).toContain("textAlign: 'left'")
  })
  it('왜 그랬는지 적어 두었다 — 다음 사람이 지우지 않게', () => {
    expect(SRC).toContain('함정 #31')
  })
})

describe('★ ② 전역 CSS 는 그대로다', () => {
  it('#root 의 가운데정렬을 건드리지 않았다', () => {
    expect(CSS).toContain('text-align: center')
    const i = CSS.indexOf('#root {')
    expect(CSS.slice(i, i + 260)).toContain('text-align: center')
  })
  it('이 파일이 전역 CSS·#root 를 **고치지** 않는다 (글로 적는 것은 괜찮다)', () => {
    /* 주석에 적는 것은 괜찮다 — **고치는 코드**가 없어야 한다 */
    for (const bad of ["getElementById('root')", "querySelector('#root')",
      "import './index.css'", 'document.body.style', 'document.documentElement.style']) {
      expect(SRC.includes(bad), '전역을 건드렸다: ' + bad).toBe(false)
    }
  })
})

describe('★ ③ 표 둘 다 · 정렬 상태는 따로', () => {
  it('정렬 상태가 두 개다', () => {
    expect(SRC).toContain("const sortMix = useSort('')")
    expect(SRC).toContain("const sortMain = useSort('')")
  })
  it('위 표(잣대 섞임)가 sortMix 를 쓴다', () => {
    expect(SRC).toContain('sk={sortMix.sk} sd={sortMix.sd} setSort={sortMix.setSort}')
    expect(SRC).toContain('sortRows(p.mixed, sortMix)')
  })
  it('아래 표(다시 세기)가 sortMain 을 쓴다', () => {
    expect(SRC).toContain('sk={sortMain.sk} sd={sortMain.sd} setSort={sortMain.setSort}')
    expect(SRC).toContain('sortRows(shown, sortMain)')
  })
  it('부품은 부모가 넘긴다 — 순환 import 를 만들지 않는다', () => {
    expect(SRC).toContain('Confirm, ColMenu, useSort }')
    expect(SRC.includes("from './App"), '이 파일이 App.jsx 를 들여왔다').toBe(false)
    expect(APP).toContain('ColMenu={ColMenu} useSort={useSort} />}')
  })
})

describe('★ ④ 거르기는 나오지 않는다', () => {
  it('머리글에 filter 를 주지 않는다 — ⇅ 정렬만', () => {
    const uses = SRC.match(/<HeadMenu[^/]*\/>/g) || []
    expect(uses.length, '머리글 부품이 없다').toBeGreaterThan(0)
    for (const u of uses) expect(u, '거르기가 붙었다: ' + u).not.toContain('filter')
  })
})

describe('★ ⑤ 원본을 뒤집지 않는다', () => {
  it('복사본을 정렬한다 — [...list].sort', () => {
    expect(SRC).toContain('return [...list].sort(')
  })
  it('고르지 않았으면 원본을 그대로 돌려준다', () => {
    expect(SRC).toContain('if (!st || !st.sk) return list')
  })
  it('★ 제자리 정렬(list.sort)을 하지 않는다', () => {
    expect(/\b(p\.mixed|shown|rows)\.sort\(/.test(SRC), '원본을 제자리에서 정렬했다').toBe(false)
  })
})

describe('★ ⑥ 그 밖은 그대로', () => {
  it('숫자 칸은 오른쪽 정렬 그대로다', () => {
    expect(SRC).toContain("const thR = { ...th, textAlign: 'right' }")
    expect(SRC).toContain("const tdR = { ...td, textAlign: 'right' }")
  })
  it('새 색을 만들지 않았다 — hex 리터럴이 늘지 않았다', () => {
    const hex = [...new Set((SRC.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    expect(hex).toEqual([])
  })
  it('새 라이브러리를 들여오지 않았다', () => {
    const imports = (SRC.match(/^import .*$/gm) || []).join('\n')
    /* 들여오는 것은 react 와 **우리 파일**뿐이어야 한다 */
    const froms = [...imports.matchAll(/from '([^']+)'/g)].map(m => m[1])
    for (const fr of froms) expect(fr === 'react' || fr.startsWith('./'), '새 라이브러리: ' + fr).toBe(true)
    expect(froms).toContain('react')
  })
})
