/* 공개 사이트 파비콘 2종 — 바이알(잔량) · 클립보드(수요조사).

   ★ 왜 이 시험이 있나
     파비콘은 **화면에 안 보이는 곳**(브라우저 탭)이라 깨져도 아무도 모른다.
     그래서 ① 파일이 실제로 있는지 ② index.html 이 그 이름을 가리키는지
     ③ 탭을 바꿀 때 href 가 실제로 갈아타는지를 코드로 묶어 둔다.

   ★ 바꾸지 않기로 한 것도 같이 고정한다 —
     apple-touch-icon(홈 화면 아이콘)은 탭에 따라 바뀌지 않는다.
     약플로 관리 화면·병동신청앱의 아이콘은 건드리지 않는다. */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTabIcon, tabFromHash, writeTabHash, clearTabHash, ICON_BY_TAB, TABS, TAB_DEFAULT } from '../src/lib/tabRoute.js'

const root = process.cwd()
const rd = p => readFileSync(resolve(root, p), 'utf8')
const HTML = rd('vaccine-app/index.html')
const APP = rd('vaccine-app/src/App.jsx')

const SIZES = ['16', '32', '48', '180', '192', '512']
const FILES = ['vial', 'survey'].flatMap(n => [n + '.svg', n + '.ico', ...SIZES.map(s => n + '-' + s + '.png')])

describe('아이콘 파일 — 16개가 실제로 있다', () => {
  it('★ 기대한 이름이 정확히 16개다', () => {
    expect(FILES.length).toBe(16)
  })
  for (const f of FILES) {
    it(f, () => {
      const p = resolve(root, 'vaccine-app/public', f)
      expect(existsSync(p), '파일이 없다: ' + f).toBe(true)
      /* 0바이트는 「있는데 깨진」 경우다 — 받는 쪽에서 아이콘이 안 뜬다 */
      expect(statSync(p).size, f + ' 가 0바이트다').toBeGreaterThan(0)
    })
  }
  it('★ svg 는 정말 svg 다(확장자만 맞는 빈 파일 방지)', () => {
    for (const n of ['vial', 'survey']) {
      const s = rd('vaccine-app/public/' + n + '.svg')
      expect(s, n + '.svg 가 svg 가 아니다').toMatch(/<svg[\s>]/)
    }
  })
  it('★ ico 는 정말 ico 다(매직 바이트 00 00 01 00)', () => {
    for (const n of ['vial', 'survey']) {
      const b = readFileSync(resolve(root, 'vaccine-app/public/' + n + '.ico'))
      expect([...b.subarray(0, 4)], n + '.ico 가 ico 가 아니다').toEqual([0, 0, 1, 0])
    }
  })
})

describe('index.html — 기본은 바이알', () => {
  const LINKS = [
    ['ico 폴백', '<link rel="icon" href="/vial.ico" sizes="any" data-tab-icon />'],
    ['svg', '<link rel="icon" type="image/svg+xml" href="/vial.svg" data-tab-icon />'],
    ['png 32', '<link rel="icon" type="image/png" sizes="32x32" href="/vial-32.png" data-tab-icon />'],
    ['홈 화면', '<link rel="apple-touch-icon" href="/vial-180.png" />'],
  ]
  for (const [what, line] of LINKS) {
    it('★ ' + what, () => { expect(HTML.includes(line), line).toBe(true) })
  }

  it('★ 바뀌는 것은 3개뿐이다(apple-touch-icon 은 제외)', () => {
    /* 주석에도 같은 말이 적혀 있으니 <link> 줄만 센다 */
    const marked = HTML.split('\n').filter(l => l.includes('<link') && l.includes('data-tab-icon'))
    expect(marked.length).toBe(3)
    /* 홈 화면 아이콘 줄에는 표식이 없어야 한다 */
    const apple = HTML.split('\n').find(l => l.includes('apple-touch-icon'))
    expect(apple).toBeTruthy()
    expect(apple.includes('data-tab-icon'), '홈 화면 아이콘이 탭에 따라 바뀌면 안 된다').toBe(false)
  })

  it('★ 옛 favicon.svg 를 더는 가리키지 않는다', () => {
    expect(HTML.includes('href="/favicon.svg"'), '옛 아이콘 링크가 남아 있다').toBe(false)
  })

  it('★ manifest 는 두지 않는다 — 병동신청앱과 같은 방침', () => {
    expect(HTML.includes('rel="manifest"'), 'manifest 링크를 새로 넣지 않는다').toBe(false)
    expect(existsSync(resolve(root, 'vaccine-app/public/manifest.webmanifest'))).toBe(false)
  })
})

/* 아주 작은 가짜 문서 — jsdom 없이도 href 갈아타기를 볼 수 있게 한다.
   querySelectorAll 은 'link[data-tab-icon]' 하나만 받으면 된다. */
function fakeDoc(hrefs) {
  const made = hrefs.map(h => {
    const a = { href: h, tab: true }
    return {
      getAttribute: k => (k === 'href' ? a.href : null),
      setAttribute: (k, v) => { if (k === 'href') a.href = v },
      get _href() { return a.href },
    }
  })
  const apple = { getAttribute: () => '/vial-180.png', setAttribute: () => { throw new Error('홈 화면 아이콘을 바꿨다') } }
  return {
    _links: made,
    _apple: apple,
    querySelectorAll: sel => (sel === 'link[data-tab-icon]' ? made : []),
    hrefs: () => made.map(m => m._href),
  }
}
const START = ['/vial.ico', '/vial.svg', '/vial-32.png']

describe('setTabIcon — 탭에 따라 href 가 갈아탄다', () => {
  it('★ 수요조사로 가면 survey 로 바뀐다', () => {
    const d = fakeDoc(START)
    setTabIcon('survey', d)
    expect(d.hrefs()).toEqual(['/survey.ico', '/survey.svg', '/survey-32.png'])
  })
  it('★ 잔량으로 돌아오면 vial 로 돌아온다', () => {
    const d = fakeDoc(START)
    setTabIcon('survey', d)
    setTabIcon('stock', d)
    expect(d.hrefs()).toEqual(START)
  })
  it('★ 여러 번 불러도 겹쳐 쌓이지 않는다(이름 조각이 중복되지 않는다)', () => {
    const d = fakeDoc(START)
    for (let i = 0; i < 5; i++) { setTabIcon('survey', d); setTabIcon('survey', d) }
    expect(d.hrefs()).toEqual(['/survey.ico', '/survey.svg', '/survey-32.png'])
  })
  it('★ 모르는 탭 이름이면 기본(바이알)으로 둔다', () => {
    const d = fakeDoc(['/survey.svg'])
    setTabIcon('없는탭', d)
    expect(d.hrefs()).toEqual(['/vial.svg'])
    expect(ICON_BY_TAB[TAB_DEFAULT]).toBe('vial')
  })
  it('★ 문서가 없어도 터지지 않는다(서버 렌더·시험 환경)', () => {
    expect(() => setTabIcon('survey', null)).not.toThrow()
    expect(() => setTabIcon('survey', {})).not.toThrow()
  })
  it('★ 표식 없는 링크는 건드리지 않는다', () => {
    const d = fakeDoc(START)
    setTabIcon('survey', d)
    /* apple 은 querySelectorAll 결과에 없으므로 setAttribute 가 불리지 않는다 */
    expect(() => d._apple.setAttribute).not.toThrow()
  })
  it('★ 탭 이름표가 두 개뿐이고 파일 이름과 맞는다', () => {
    expect(Object.keys(ICON_BY_TAB).sort()).toEqual([...TABS].sort())
    for (const n of Object.values(ICON_BY_TAB)) expect(FILES).toContain(n + '.svg')
  })
})

describe('탭 전환·첫 진입', () => {
  function fakeWin(hash) {
    const d = fakeDoc(START)
    return {
      _doc: d,
      document: d,
      location: { pathname: '/', search: '', hash: hash || '' },
      history: { replaceState: (a, b, u) => { fakeWin.last = u } },
    }
  }
  it('★ writeTabHash 가 아이콘도 같이 맞춘다', () => {
    const w = fakeWin()
    writeTabHash('survey', w)
    expect(w._doc.hrefs()).toEqual(['/survey.ico', '/survey.svg', '/survey-32.png'])
  })
  it('★ clearTabHash(열린 회차 없음)는 바이알로 돌린다', () => {
    const w = fakeWin('#survey')
    writeTabHash('survey', w)
    clearTabHash(w)
    expect(w._doc.hrefs()).toEqual(START)
  })
  it('★ #survey 로 새로고침해 들어오면 첫 탭이 survey 다', () => {
    expect(tabFromHash('#survey')).toBe('survey')
    expect(ICON_BY_TAB[tabFromHash('#survey')]).toBe('survey')
  })
  it('★ App.jsx 가 첫 렌더에서도 한 번 맞춘다 — #survey 직접 진입 대비', () => {
    expect(APP).toContain("import { tabFromHash, writeTabHash, clearTabHash, setTabIcon, TAB_DEFAULT } from './lib/tabRoute'")
    expect(APP).toContain('useEffect(() => { setTabIcon(tab) }, [tab])')
  })
})

describe('바꾸지 않기로 한 것', () => {
  it('★ 약플로 관리 화면 아이콘은 그대로', () => {
    const r = rd('index.html')
    expect(r).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(r.includes('vial'), '관리 화면에 공개 사이트 아이콘이 새어 들어갔다').toBe(false)
    expect(r.includes('survey')).toBe(false)
  })
  it('★ 병동신청앱 아이콘은 그대로', () => {
    const w = rd('ward-app/index.html')
    expect(w).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(w.includes('vial')).toBe(false)
  })
  it('★ 공개 사이트의 문구·저작권은 손대지 않았다', () => {
    expect(HTML).toContain('<title>백신 잔량 조회</title>')
    expect(APP).toContain("© 2026 JEONGHWALEE. All rights reserved. 무단 복제 및 재배포를 금지합니다.")
  })
})
