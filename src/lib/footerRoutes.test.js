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

/* ★ 조작 결과 안내 띠·토스트는 인쇄에서 빠져야 한다(함정 #33).
     보기 문제가 아니라 **쪽이 밀린다** — 월간 요약 블록은 min-height 265mm 인데
     인쇄 가능 높이가 273mm 라 여유가 8mm 뿐이다. 띠 하나(약 18mm)면 빈 쪽이 생긴다.
     2026-11-01 에 30곳을 한 번에 붙였다. 새 띠를 만들면 여기서 잡힌다. */
describe('안내 띠·토스트는 전부 no-print 다', () => {
  /* 「…Msg && <div」·「msg && <div」 꼴 = 조작 결과를 알리는 띠.
     ★ 조건을 둘로 나눈다 — ① 줄에 메시지 변수가 있고 ② `&&` 바로 뒤에 <div 가 온다.
       하나로 욕심내면(변수와 && 와 <div 를 한 정규식으로) 중간에 낀 다른 조건
       (`dropped.length===0&&msg&&`)에 걸려 **조용히 10건만** 잡는다. 실제로 그랬다. */
  /* ★ `&&<div` **바로 앞**이 메시지 변수여야 한다.
     「줄 어딘가에 msg 가 있고 어딘가에 &&<div 가 있다」로 잡으면 모달 **배경 오버레이**
     (`{delTx&&<div onClick=…}`)까지 끌려온다 — 실제로 6건이 그렇게 섞였다. */
  const BANNER = /\b([A-Za-z]*[Mm]sg|flash|toast)\s*&&\s*<div[\s>]/
  const sites = () => APP.split(/\r?\n/)
    .map((text, i) => ({ no: i + 1, text }))
    .filter(s => BANNER.test(s.text))

  it('★ no-print 가 빠진 안내 띠가 하나도 없다', () => {
    const bad = sites().filter(s => !/no-print/.test(s.text))
      .map(s => s.no + '줄: ' + s.text.trim().slice(0, 70))
    expect(bad, '새 안내 띠에는 className="no-print" 를 붙일 것\n' + bad.join('\n')).toEqual([])
  })

  it('찾은 띠가 충분히 많다 — 정규식이 조용히 0건이 되지 않았는지', () => {
    /* ★ 위 시험은 「없음」이면 통과한다. 정규식이 망가져 **아무것도 못 찾아도** 통과한다.
       그래서 찾은 개수 자체를 본다(2026-11-01 실측 31곳 = 새로 붙인 30 + closeMsg 1). */
    expect(sites().length, '안내 띠를 찾는 정규식이 망가졌다').toBeGreaterThanOrEqual(25)
  })

  it('.no-print 숨김은 @media print 안에만 있다 — 화면 표시는 그대로다', () => {
    const outside = APP.replace(/@media print \{[\s\S]*?\n\s*\}/g, '')
      .replace(/@media print\{[^}]*\.no-print[^}]*\}[^}]*\}/g, '')
    expect(outside, '화면에서도 숨기면 안내가 안 보인다').not.toMatch(/\.no-print\s*\{\s*display:\s*none/)
  })
})

describe('화면 컴포넌트 파일은 손대지 않았다', () => {
  for (const f of ['src/VaccineManage.jsx', 'src/EmergencyDispense.jsx']) {
    it(`${f} 에 <Ft/> 가 없다`, () => {
      expect(readFileSync(root(f), 'utf8')).not.toMatch(/<Ft\s*\/>/)
    })
  }
})
