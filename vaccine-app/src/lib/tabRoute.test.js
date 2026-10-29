/* @vitest-environment jsdom */
/* 탭 ↔ 주소 해시 — 새로고침해도 보던 탭이 유지되는가.

   ★ 고친 결함: 탭이 React state 에만 있어서(App.jsx 의 useState('stock'))
     새로고침하면 언제나 잔량으로 돌아갔다.
   ★ 입력 중인 값은 주소에도 저장소에도 남기지 않는다 — 해시에 들어가는 것은
     탭 이름 하나뿐이다(확인번호·성명 보호). 그 못도 여기서 박는다. */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TABS, TAB_DEFAULT, tabFromHash, tabHash, writeTabHash, clearTabHash } from './tabRoute'

const APP = readFileSync(resolve(process.cwd(), 'vaccine-app/src/App.jsx'), 'utf8')

/* history 를 흉내 내는 가짜 창 — 실제 주소를 건드리지 않는다 */
function fakeWin(start = '/') {
  const [path, hash] = start.split('#')
  const w = {
    location: { pathname: path || '/', search: '', hash: hash ? '#' + hash : '' },
    history: {
      calls: [],
      replaceState(_s, _t, url) { w.history.calls.push(url); const i = url.indexOf('#'); w.location.hash = i === -1 ? '' : url.slice(i) },
    },
  }
  return w
}

describe('해시 → 탭', () => {
  it('★ #survey 로 열면 수요조사', () => {
    expect(tabFromHash('#survey')).toBe('survey')
  })
  it('해시가 없으면 잔량', () => {
    expect(tabFromHash('')).toBe(TAB_DEFAULT)
    expect(tabFromHash('#')).toBe(TAB_DEFAULT)
  })
  it('모르는 해시는 잔량 — 엉뚱한 주소로 빈 화면이 되지 않는다', () => {
    for (const h of ['#없는탭', '#stock2', '#survey2', '#/x/y']) {
      expect(tabFromHash(h), h).toBe(TAB_DEFAULT)
    }
  })
  it('#stock 도 잔량', () => {
    expect(tabFromHash('#stock')).toBe('stock')
  })
  it('슬래시가 붙어도 읽는다', () => {
    expect(tabFromHash('#/survey')).toBe('survey')
  })
  it('인자를 안 주면 현재 주소를 본다', () => {
    window.location.hash = '#survey'
    expect(tabFromHash()).toBe('survey')
    window.location.hash = ''
    expect(tabFromHash()).toBe(TAB_DEFAULT)
  })
})

describe('탭 → 해시', () => {
  it('★ 잔량은 해시를 쓰지 않는다 — 기본 화면이라 주소가 깔끔해야 한다', () => {
    expect(tabHash('stock')).toBe('')
  })
  it('수요조사는 #survey', () => {
    expect(tabHash('survey')).toBe('#survey')
  })
  it('모르는 값은 해시 없음', () => {
    expect(tabHash('없는탭')).toBe('')
  })
  it('탭 목록은 둘뿐', () => {
    expect(TABS).toEqual(['stock', 'survey'])
  })
})

describe('주소 쓰기 — replaceState 만 쓴다', () => {
  let w
  beforeEach(() => { w = fakeWin('/') })

  it('★ 수요조사를 누르면 #survey 가 붙는다', () => {
    writeTabHash('survey', w)
    expect(w.history.calls).toEqual(['/#survey'])
    expect(w.location.hash).toBe('#survey')
  })

  it('★ 잔량을 누르면 해시가 사라진다', () => {
    writeTabHash('survey', w)
    writeTabHash('stock', w)
    expect(w.history.calls[1]).toBe('/')
    expect(w.location.hash).toBe('')
  })

  it('★ pushState 를 쓰지 않는다 — 뒤로 가기 기록이 쌓이면 안 된다', () => {
    expect(w.history.pushState).toBeUndefined()
    writeTabHash('survey', w)   /* pushState 를 불렀다면 여기서 터진다 */
    expect(w.history.calls.length).toBe(1)
  })

  it('search 가 있으면 보존한다', () => {
    w.location.search = '?a=1'
    writeTabHash('survey', w)
    expect(w.history.calls[0]).toBe('/?a=1#survey')
  })

  it('clearTabHash 는 해시를 지운다', () => {
    writeTabHash('survey', w)
    clearTabHash(w)
    expect(w.location.hash).toBe('')
  })

  it('history 가 없어도 터지지 않는다', () => {
    expect(() => writeTabHash('survey', { location: { pathname: '/' } })).not.toThrow()
    expect(() => writeTabHash('survey', null)).not.toThrow()
  })
})

describe('App.jsx 배선', () => {
  it('★ 탭 초기값을 주소에서 읽는다 — 새로고침해도 유지', () => {
    expect(APP).toContain('useState(tabFromHash)')
    expect(APP, '옛 방식이 남아 있다').not.toContain("useState('stock')")
  })

  it('★ 탭을 누르면 주소도 바꾼다', () => {
    expect(APP).toContain('const goTab = useCallback(k => { setTab(k); writeTabHash(k) }, [])')
    expect(APP).toContain('onTab={goTab}')
  })

  it('★ 잠그기가 탭을 초기화하지 않는다 — 재로그인하면 보던 탭으로', () => {
    const i = APP.indexOf('const lock = useCallback')
    expect(i).toBeGreaterThan(0)
    const body = APP.slice(i, APP.indexOf('}, [])', i))
    expect(body, '잠그기가 탭을 되돌린다').not.toContain("setTab('stock')")
    expect(body, '회차 답 표시를 지워야 한다').toContain('surveyKnown.current = false')
  })

  it('★ 열린 회차가 없으면 해시를 지운다 — 답을 받기 전에는 건드리지 않는다', () => {
    expect(APP).toContain('if (!token || !surveyKnown.current) return')
    expect(APP).toContain('if (!survey) clearTabHash()')
  })

  it('회차 답을 받은 두 경로 모두 표시를 남긴다', () => {
    expect(APP).toContain('setSurvey(j.survey || null); surveyKnown.current = true')
    expect(APP).toContain('seededSurvey.current = true; surveyKnown.current = true')
  })

  it('보이는 탭은 회차가 없으면 잔량으로 파생된다', () => {
    expect(APP).toContain('tab={survey ? tab : TAB_DEFAULT}')
  })
})

describe('★ 입력값을 남기지 않는다', () => {
  it('해시에 담는 것은 탭 이름뿐', () => {
    for (const t of TABS) {
      const h = tabHash(t)
      expect(h === '' || h === '#' + t, h).toBe(true)
    }
  })

  it('★ 수요조사 입력을 저장소에 쓰지 않는다 — 확인번호·성명 보호', () => {
    const SRC = readFileSync(resolve(process.cwd(), 'vaccine-app/src/SurveyTab.jsx'), 'utf8')
    for (const bad of ['localStorage', 'sessionStorage', 'document.cookie']) {
      expect(SRC.includes(bad), `SurveyTab 이 ${bad} 를 쓴다`).toBe(false)
    }
    /* 탭 주소 모듈도 저장소를 쓰지 않는다 */
    const T = readFileSync(resolve(process.cwd(), 'vaccine-app/src/lib/tabRoute.js'), 'utf8')
    for (const bad of ['localStorage', 'sessionStorage', 'document.cookie']) {
      expect(T.includes(bad), `tabRoute 가 ${bad} 를 쓴다`).toBe(false)
    }
  })

  it('App.jsx 의 저장소 사용은 토큰 하나뿐 — 새로 늘지 않았다', () => {
    const keys = APP.match(/localStorage\.(setItem|getItem|removeItem)/g) || []
    expect(keys.length, '저장소 사용처: ' + keys.join(', ')).toBeLessThanOrEqual(4)
    expect(APP).toContain('TOKEN_KEY')
  })
})
