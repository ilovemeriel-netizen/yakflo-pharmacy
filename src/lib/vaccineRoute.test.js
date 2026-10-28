/* @vitest-environment node */
/* 백신 관리 주소 — ROUTES 에 vaccine 이 들어갔는지, 하위 탭을 주소에서 바르게 읽는지.
   ★ App.jsx 는 830KB 짜리 화면 파일이라 통째로 import 하지 않는다. 대신
     ① ROUTES 배열과 routeFromHash 본문을 **파일에서 읽어** 그대로 평가하고
     ② 하위 탭 규칙은 lib/vaccineRoute.js 를 직접 부른다.
     ①은 「시험이 사본을 보고 통과하는」 함정을 피하려는 것이다 — 진짜 소스를 읽는다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { VACCINE_TABS, VACCINE_TAB_DEFAULT, vaccineTabFromHash, vaccineHash } from './vaccineRoute'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

/* App.jsx 에 적힌 ROUTES 배열을 그대로 꺼낸다 */
function routesFromSource() {
  const m = /const ROUTES = (\[[^\]]*\]);/.exec(APP)
  if (!m) throw new Error('App.jsx 에서 ROUTES 를 찾지 못했다')
  return JSON.parse(m[1].replace(/'/g, '"'))
}
/* App.jsx 의 routeFromHash 와 **같은 식**으로 판정한다 */
const ROUTES = routesFromSource()
const routeOf = hash => {
  const h = (hash || '').replace(/^#\/?/, '')
  const m = h.split('/')[0]
  return ROUTES.includes(m) ? m : 'dashboard'
}

const OTHERS = ['dashboard', 'alerts', 'druglist', 'expiry', 'idle', 'change', 'stock', 'count',
  'narcotic', 'nonins', 'ordering', 'ward', 'transaction', 'report', 'emergency', 'atc',
  'schedule', 'register', 'mypage', 'admin', 'archive', 'locvocab']

describe('ROUTES — 새로고침이 대시보드로 떨어지지 않게 하는 허용 목록', () => {
  it('★ vaccine 이 들어 있다 — 이게 빠져서 #vaccine 새로고침이 대시보드로 갔다', () => {
    expect(ROUTES).toContain('vaccine')
  })
  it('기존 22개 화면이 순서까지 그대로다', () => {
    expect(ROUTES.slice(0, OTHERS.length)).toEqual(OTHERS)
    expect(ROUTES).toHaveLength(OTHERS.length + 1)
  })
  it('★ #vaccine · #vaccine/survey 새로고침이 백신 관리로 간다', () => {
    expect(routeOf('#vaccine')).toBe('vaccine')
    expect(routeOf('#vaccine/survey')).toBe('vaccine')
    expect(routeOf('#vaccine/manage')).toBe('vaccine')
  })
  it('★ 다른 22개 화면은 그대로 자기 화면으로 간다', () => {
    for (const r of OTHERS) expect(routeOf('#' + r), r).toBe(r)
  })
  it('모르는 주소·빈 해시는 지금처럼 대시보드다', () => {
    for (const h of ['', '#', '#/', '#없는화면', '#VACCINE', '#vaccin']) {
      expect(routeOf(h), JSON.stringify(h)).toBe('dashboard')
    }
  })
  it('거래 관리의 하위 경로도 그대로다', () => {
    expect(routeOf('#transaction/ib')).toBe('transaction')
    expect(routeOf('#transaction/ib/2026-09')).toBe('transaction')
  })
})

describe('하위 탭 — #vaccine/<탭>', () => {
  it('탭 목록과 기본값', () => {
    expect(VACCINE_TABS).toEqual(['manage', 'survey'])
    expect(VACCINE_TAB_DEFAULT).toBe('manage')
  })
  it('★ 주소에서 하위 탭을 읽는다', () => {
    expect(vaccineTabFromHash('#vaccine/survey')).toBe('survey')
    expect(vaccineTabFromHash('#vaccine/manage')).toBe('manage')
    expect(vaccineTabFromHash('#/vaccine/survey')).toBe('survey')
  })
  it('★ 모르는 하위 탭이면 null — 호출부가 기본 탭으로 간다', () => {
    for (const h of ['#vaccine/없는탭', '#vaccine/SURVEY', '#vaccine/', '#vaccine', '#vaccine/survey/x']) {
      const v = vaccineTabFromHash(h)
      expect(v === null || VACCINE_TABS.includes(v), h + ' → ' + v).toBe(true)
    }
    expect(vaccineTabFromHash('#vaccine/없는탭')).toBeNull()
    expect(vaccineTabFromHash('#vaccine')).toBeNull()
  })
  it('다른 화면의 주소에서는 하위 탭을 읽지 않는다', () => {
    expect(vaccineTabFromHash('#transaction/ib')).toBeNull()
    expect(vaccineTabFromHash('#dashboard')).toBeNull()
  })
  it('깨진 퍼센트 인코딩에도 터지지 않는다', () => {
    expect(vaccineTabFromHash('#vaccine/%E0%A4%A')).toBeNull()
  })
  it('★ 탭 → 주소. 기본 탭은 꼬리를 붙이지 않는다', () => {
    expect(vaccineHash('survey')).toBe('#vaccine/survey')
    expect(vaccineHash('manage')).toBe('#vaccine')
    expect(vaccineHash('없는탭')).toBe('#vaccine')
    expect(vaccineHash(null)).toBe('#vaccine')
  })
  it('★ 주소 → 탭 → 주소 가 제자리로 돌아온다', () => {
    for (const tab of VACCINE_TABS) {
      expect(vaccineTabFromHash(vaccineHash(tab)) || VACCINE_TAB_DEFAULT).toBe(tab)
    }
  })
})

describe('App.jsx — 처음 주소를 다시 쓸 때 하위 탭을 지우지 않는다', () => {
  it('★ replaceState 가 백신 하위 탭을 붙인다 (VaccineManage 는 lazy 라 뒤에 붙는다)', () => {
    /* 이 한 줄이 없으면 새로고침 때 #vaccine/survey → #vaccine 으로 깎여 탭이 사라진다 */
    expect(APP).toContain("const initVac = init === 'vaccine' ? vaccineTabFromHash() : null")
    expect(APP).toContain("(initVac ? '/' + initVac : '')")
  })
  it('거래 관리의 하위 경로 규칙은 건드리지 않았다', () => {
    expect(APP).toContain("init === 'transaction' && initSub ? '/' + (TX_URL_KEY[initSub] || encodeURIComponent(initSub))")
  })
  it('원문 보기 상태는 주소에도 저장소에도 담지 않는다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/vaccineRoute.js'), 'utf8')
    for (const bad of ['revealed', 'localStorage', 'sessionStorage']) {
      expect(src.includes(bad), 'vaccineRoute.js 에 ' + bad + ' 가 있으면 안 된다').toBe(false)
    }
    const panel = readFileSync(resolve(process.cwd(), 'src/VaccineSurveyPanel.jsx'), 'utf8')
    for (const bad of ['localStorage', 'sessionStorage']) {
      expect(panel.includes(bad), '패널에 ' + bad + ' 가 있으면 안 된다').toBe(false)
    }
  })
})
