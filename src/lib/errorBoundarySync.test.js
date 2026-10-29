/* @vitest-environment node */
/* 오류 안내 화면 — 세 앱 사본이 어긋나지 않는지 본다.

   ★ 세 앱은 별도 Vite 빌드라 서로 import 할 수 없다. 그래서 같은 문구·같은
     청크 오류 처리를 세 군데에 두고 여기서 못을 박는다(surveyRules.test.js 와 같은 방식).
     한쪽만 고치면 이 시험이 걸린다.
   ★ 그리고 바깥 경계가 쓰는 테마 값이 App.jsx 의 themes 와 같은지 대조한다 —
     바깥 경계는 ThemeCtx 밖이라 토큰을 받을 수 없어 값을 베껴 뒀다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yak from './errorText.js'
import * as vac from '../../vaccine-app/src/errorText.js'
import * as ward from '../../ward-app/src/errorText.js'

const rd = p => readFileSync(resolve(process.cwd(), p), 'utf8')
const APP = rd('src/App.jsx')

describe('세 사본의 문구가 같다', () => {
  const COMMON = ['EC_TITLE', 'EC_PLAIN', 'EC_CONTACT', 'EC_RELOAD', 'EC_WHEN', 'EC_COPY', 'EC_ICON_BG']
  for (const k of COMMON) {
    it(`${k} 가 셋 다 같다`, () => {
      expect(vac[k], 'vaccine-app').toBe(yak[k])
      expect(ward[k], 'ward-app').toBe(yak[k])
    })
  }

  it('★ 승인 시안 문구 그대로', () => {
    expect(yak.EC_TITLE).toBe('화면을 불러오는 중 문제가 생겼습니다')
    expect(yak.EC_KEEP).toBe('이미 저장한 내용은 그대로 있습니다. 새로고침해 주세요.')
    expect(yak.EC_PLAIN).toBe('새로고침해 주세요.')
    expect(yak.EC_CONTACT).toBe('같은 문제가 계속되면 약제과(내선 217)로 알려 주세요.')
    expect(yak.EC_RELOAD).toBe('새로고침')
    expect(yak.EC_HOME).toBe('대시보드로')
    expect(yak.EC_WHEN).toBe('발생 시각')
  })

  it('★ 저작권은 세 앱의 표준 문구와 같다', () => {
    const STD = 'Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.'
    expect(yak.EC_COPY).toBe(STD)
    /* 실제로 각 앱 Ft() 가 쓰는 문구와도 같아야 한다 */
    for (const f of ['src/App.jsx', 'vaccine-app/src/App.jsx', 'ward-app/src/App.jsx']) {
      expect(rd(f), f).toContain(STD)
    }
  })

  it('★ 「이미 저장한…」은 관리 앱에만 있다 — 공개·병동 본문에 넣지 않는다', () => {
    expect(yak.EC_KEEP).toBeTruthy()
    expect(vac.EC_KEEP).toBeUndefined()
    expect(ward.EC_KEEP).toBeUndefined()
    for (const f of ['vaccine-app/src/errorText.js', 'vaccine-app/src/ErrorBoundary.jsx',
      'ward-app/src/errorText.js', 'ward-app/src/ErrorBoundary.jsx']) {
      expect(rd(f), f).not.toContain('이미 저장한')
    }
  })
})

describe('청크 오류 판정이 셋 다 같다', () => {
  const CASES = [
    Object.assign(new Error('x'), { name: 'ChunkLoadError' }),
    new Error('Loading chunk 42 failed.'),
    new Error('Loading CSS chunk 3 failed.'),
    new Error('Failed to fetch dynamically imported module: /assets/a.js'),
    new Error('error loading dynamically imported module'),
    new Error('Importing a module script failed.'),
    new Error('Cannot read properties of undefined'),
    new Error('잘못된 입력입니다'),
    null,
  ]
  it('★ 같은 오류에 같은 판정', () => {
    for (const e of CASES) {
      const a = yak.isChunkError(e)
      expect(vac.isChunkError(e), 'vaccine: ' + (e && e.message)).toBe(a)
      expect(ward.isChunkError(e), 'ward: ' + (e && e.message)).toBe(a)
    }
  })
  it('표시 키가 같다 — 세 앱이 각자 origin 이라 값이 같아도 섞이지 않는다', () => {
    expect(vac.EC_RELOAD_KEY).toBe(yak.EC_RELOAD_KEY)
    expect(ward.EC_RELOAD_KEY).toBe(yak.EC_RELOAD_KEY)
  })
  it('kstStamp 가 셋 다 같은 값을 낸다', () => {
    const d = new Date('2026-10-28T15:30:00Z')
    expect(vac.kstStamp(d)).toBe(yak.kstStamp(d))
    expect(ward.kstStamp(d)).toBe(yak.kstStamp(d))
    expect(yak.kstStamp(d)).toBe('2026-10-29 00:30')
  })
})

describe('바깥 경계의 테마 값이 App.jsx 의 themes 와 같다', () => {
  /* App.jsx 의 themes.light / themes.dark 에서 필요한 값만 뽑아 비교한다 */
  function tokensOf(which) {
    const i = APP.indexOf(which + ': {')
    expect(i, `themes.${which} 를 못 찾음`).toBeGreaterThan(0)
    const body = APP.slice(i, APP.indexOf('\n  }', i))
    const out = {}
    for (const m of body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) out[m[1]] = m[2]
    return out
  }
  const light = tokensOf('light')
  const dark = tokensOf('dark')

  it('뽑아낸 토큰이 비어 있지 않다', () => {
    expect(Object.keys(light).length).toBeGreaterThan(10)
    expect(Object.keys(dark).length).toBeGreaterThan(10)
  })

  for (const k of ['bg', 'card', 'border', 'text', 'textM', 'textL', 'accent']) {
    it(`★ ${k} — 라이트·다크 둘 다 같은 값`, () => {
      expect(yak.EC_LIGHT[k], 'light.' + k).toBe(light[k])
      expect(yak.EC_DARK[k], 'dark.' + k).toBe(dark[k])
    })
  }

  it('★ 아이콘 색도 기존 값 — 새 색 0건', () => {
    /* 연보라 45% 는 「일부 미반영」 알림과 같은 값, 보라는 themes.light.accent */
    expect(yak.EC_ICON_BG).toBe('rgba(191,166,217,0.45)')
    expect(yak.EC_PURPLE).toBe(light.accent)
    expect(yak.EC_PURPLE).toBe('#804A87')
  })
})

describe('화면 이름', () => {
  it('★ ROUTES 전 키에 이름이 있다 — 빠지면 작은 글씨가 비어 버린다', () => {
    const m = /^const ROUTES = \[([^\]]+)\]/m.exec(APP)
    expect(m, 'ROUTES 를 못 찾음').toBeTruthy()
    const routes = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
    expect(routes.length).toBeGreaterThan(20)
    const missing = routes.filter(r => !yak.SCREEN_LABEL[r])
    expect(missing, `이름 없는 화면: ${missing.join(', ')}`).toEqual([])
  })

  it('★ 메뉴띠(Header 의 ms)에 있는 이름과 어긋나지 않는다', () => {
    const i = APP.indexOf('const ms = [')
    expect(i).toBeGreaterThan(0)
    const body = APP.slice(i, APP.indexOf('\n  ]', i))
    /* ★ 같은 id 가 두 번 나온다 — 상위 묶음의 제목(예: druglist→「약품관리」)과
       그 안의 화면(druglist→「약품목록」)이다. **화면 쪽**이 우리가 쓸 이름이라
       children 안의 라벨을 먼저 채우고, 묶음 제목은 덮어쓰지 않는다. */
    const seen = {}
    for (const mm of body.matchAll(/children: \[([^\]]+)\]/g)) {
      for (const cm of mm[1].matchAll(/\{ id: '([a-z]+)', l: '([^']+)' \}/g)) seen[cm[1]] = cm[2]
    }
    for (const mm of body.matchAll(/\{ id: '([a-z]+)', l: '([^']+)'/g)) {
      if (!(mm[1] in seen)) seen[mm[1]] = mm[2]
    }
    let checked = 0
    for (const [id, label] of Object.entries(seen)) {
      /* 🔔 처럼 꾸밈 글자가 붙은 것은 글자만 비교한다 */
      const plain = label.replace(/[^가-힣A-Za-z0-9 ]/g, '').trim()
      if (!plain) continue
      expect(yak.SCREEN_LABEL[id], `${id} 의 이름이 메뉴띠(${plain})와 다르다`).toBe(plain)
      checked++
    }
    expect(checked, '대조한 항목이 없다 — ms 모양이 바뀌었는지 확인할 것').toBeGreaterThan(12)
  })

  it('모르는 화면이면 빈 문자열 — 작은 글씨에 「 · 」만 남지 않는다', () => {
    expect(yak.screenLabel('없는화면')).toBe('')
    expect(yak.screenLabel(undefined)).toBe('')
  })
})

describe('공개 앱 번들 규약', () => {
  it('★ 공개·병동 사본이 관리 앱 파일을 import 하지 않는다', () => {
    /* errorText.js 는 import 가 없는 순수 상수 파일이라 .jsx 까지 함께 본다.
       주석에는 쌍둥이 경로가 적혀 있으므로 **import 문만** 검사한다. */
    const FILES = [
      'vaccine-app/src/errorText.js', 'vaccine-app/src/ErrorBoundary.jsx',
      'ward-app/src/errorText.js', 'ward-app/src/ErrorBoundary.jsx',
    ]
    let seen = 0
    for (const f of FILES) {
      const imports = rd(f).split(/\r?\n/).filter(l => /^\s*import\b/.test(l))
      seen += imports.length
      for (const line of imports) {
        expect(line, f).not.toContain('../../src/')
        expect(line, f).not.toContain('lib/error')
        expect(line, f).not.toContain('./App')     /* ward 경계는 App 보다 바깥이다 */
      }
    }
    expect(seen, 'import 문을 하나도 못 읽었다 — 파일 경로를 확인할 것').toBeGreaterThan(3)
  })

  it('★ 공개 앱 사본에 금지 문자열이 없다', () => {
    const src = rd('vaccine-app/src/errorText.js') + rd('vaccine-app/src/ErrorBoundary.jsx')
    for (const bad of ['supabase', 'eyJ', 'createClient', 'scrypt', 'yakflo', 'service_role']) {
      expect(src.includes(bad), `공개 앱 사본에 ${bad} 가 있다`).toBe(false)
    }
  })

  it('★ 경계가 붙어 있다 — 세 앱 모두', () => {
    expect(rd('src/Root.jsx'), '바깥 경계').toContain('<ErrorBoundary full>')
    expect(APP, '화면 안쪽 경계(key={menu})').toContain('<ErrorBoundary key={menu} t={t}')
    expect(rd('vaccine-app/src/main.jsx')).toContain('<ErrorBoundary><App /></ErrorBoundary>')
    expect(rd('ward-app/src/main.jsx')).toContain('<ErrorBoundary>')
  })

  it('★ 바깥 경계에는 「대시보드로」를 주지 않는다(승인 시안)', () => {
    const root = rd('src/Root.jsx')
    expect(root).not.toContain('onHome')
  })
})
