/* 푸터가 빠져 있던 6화면 — 라우팅에 붙었는지, 인쇄에서 숨는지 정적으로 확인한다.

   ★ 렌더 시험이 아니라 소스 검사다. 이 6화면은 각각 DB 조회·lazy import·전역 상태를 끌고 와서
     jsdom 에서 띄우려면 앱 절반을 흉내내야 한다. 확인하려는 성질은 두 가지뿐이고
       (1) 푸터가 그 화면 조건 안에 있다  (2) no-print 로 감싸여 인쇄에서 빠진다
     둘 다 소스에서 확정할 수 있다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* jsdom 환경에서는 import.meta.url 이 file: URL 이 아니라 쓸 수 없다 — 저장소 뿌리에서 잡는다 */
const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const FOOTER = '<div className="no-print"><Ft /></div>'

/* 이번에 푸터를 붙인 6화면 */
const ADDED = ['alerts', 'ordering', 'vaccine', 'emergency', 'atc', 'schedule']

/* 라우팅 줄 한 줄을 뽑는다 — {menu === 'x' && ... } 가 한 줄에 쓰여 있다 */
function routeLine(menu) {
  const re = new RegExp(`^.*\\{menu === '${menu}' &&.*$`, 'm')
  const m = APP.match(re)
  return m ? m[0] : null
}

describe('6화면 라우팅에 푸터가 붙었다', () => {
  for (const menu of ADDED) {
    it(`${menu} — 조건 안에 푸터가 있다`, () => {
      const line = routeLine(menu)
      expect(line, `menu === '${menu}' 라우팅 줄을 찾지 못했다`).toBeTruthy()
      expect(line).toContain(FOOTER)
    })
  }

  it('푸터가 화면 컴포넌트 **뒤**에 온다 (프래그먼트로 감쌈)', () => {
    for (const menu of ADDED) {
      const line = routeLine(menu)
      /* <>…컴포넌트…<div className="no-print"><Ft /></div></> 모양 */
      expect(line, menu).toMatch(/&& <>.*<\/>\}\s*$/)
      const body = line.slice(line.indexOf('&& <>') + 5)
      expect(body.indexOf(FOOTER), menu).toBeGreaterThan(0)   /* 맨 앞이 아니다 = 화면 뒤 */
    }
  })

  it('조건 밖에 새 푸터를 두지 않았다 — 각 줄에 푸터가 하나씩만', () => {
    for (const menu of ADDED) {
      const line = routeLine(menu)
      expect(line.split(FOOTER).length - 1, menu).toBe(1)
    }
  })
})

describe('푸터 총 개수', () => {
  it('기존 16곳 + 신규 6곳 = 22곳', () => {
    const n = (APP.match(/<Ft\s*\/>/g) || []).length
    expect(n).toBe(22)
  })
  it('신규 6곳은 모두 no-print 로 감싸여 있다', () => {
    const wrapped = (APP.match(/<div className="no-print"><Ft \/><\/div>/g) || []).length
    /* 병동 인쇄용으로 이미 쓰고 있던 1곳 + 이번 6곳 */
    expect(wrapped).toBe(7)
  })
})

describe('인쇄에서 푸터가 숨는다', () => {
  it('전역 @media print 에 .no-print 숨김 규칙이 있다', () => {
    const printBlocks = APP.match(/@media print \{[\s\S]*?\n\s*\}/g) || []
    const hides = printBlocks.filter(b => /\.no-print\s*\{\s*display:\s*none\s*!important/.test(b))
    expect(hides.length).toBeGreaterThanOrEqual(1)
  })

  it('.no-print 를 인쇄에서 다시 보이게 하는 규칙이 없다', () => {
    expect(APP).not.toMatch(/\.no-print[^{;}]*\{[^}]*display:\s*(block|flex|inline|table)/)
  })

  it('화이트리스트식 인쇄 규칙(>*:not(...))은 보관위치 화면에만 쓰인다 — 6화면에 영향 없다', () => {
    const rules = APP.match(/[.\w-]+>\*:not\([^)]*\)/g) || []
    for (const r of rules) expect(r).toBe('.lp-root>*:not(.loc-print)')
  })

  it('인쇄 경로 마커 개수가 main 과 같다 — 푸터 추가로 흔들리지 않았다', () => {
    /* 2026-10-27 main 실측값. 이 숫자가 변하면 인쇄 경로를 건드린 것이다. */
    const MARKERS = {
      'cnc-print-month': 7,    /* 월마감 인쇄 */
      'atc-print-only': 14,    /* ATC 인쇄 */
      'cnc-report-table': 31,  /* 보고서 인쇄 */
      'ward-print': 23,        /* 병동 인쇄 */
      'loc-print': 36,         /* 보관위치 인쇄 */
      'alc-grid': 3,           /* 비상조제 인쇄 */
    }
    for (const [marker, want] of Object.entries(MARKERS)) {
      const n = (APP.match(new RegExp(marker, 'g')) || []).length
      expect(n, marker).toBe(want)
    }
  })

  it('인쇄 경로 3곳(ATC · 보고서 · 비상조제)의 핵심 규칙이 남아 있다', () => {
    expect(APP).toContain('.atc-print-only{display:none}')
    expect(APP).toContain('.cnc-report-table{page-break-before:always')
    expect(APP).toMatch(/alc-grid/)
  })
})

describe('화면 컴포넌트 파일은 손대지 않았다', () => {
  for (const f of ['src/VaccineManage.jsx', 'src/EmergencyDispense.jsx']) {
    it(`${f} 에 <Ft/> 가 없다`, () => {
      expect(readFileSync(root(f), 'utf8')).not.toMatch(/<Ft\s*\/>/)
    })
  }
})
