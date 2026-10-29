/* @vitest-environment jsdom */
/* 새 배포 자동 적용 — 언제 reload 하고 언제 참는가.

   ★ 막으려는 것 두 가지
     ⓐ 열린 탭이 며칠이고 옛 번들을 실행하는 것(회차 마감이 두 번 9시간 밀린 원인)
     ⓑ 입력 중에 reload 가 걸려 **쓰던 값이 날아가는 것**
   ★ 판단은 전부 순수 함수다 — 여기서 못을 박는다. */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BUSY_TAGS, MODAL_MIN_Z, isBusy, readBusy, shouldReload,
  markBusy, busyKeyCount, clearBusyKeys,
  readLastReload, writeLastReload, RELOAD_KEY, RELOAD_GUARD_MS, UPDATE_EVERY_MS,
} from './pwaUpdate'

const MAIN = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8')
const VITE = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')
const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

beforeEach(() => { clearBusyKeys(); try { window.sessionStorage.clear() } catch { /* 없음 */ } })

describe('입력 중 판정', () => {
  it('★ 입력칸에 포커스가 있으면 입력 중', () => {
    for (const tag of BUSY_TAGS) {
      expect(isBusy({ activeTag: tag, modalCount: 0, unsavedCount: 0 }), tag).toBe(true)
    }
    expect(BUSY_TAGS).toEqual(['input', 'select', 'textarea'])
  })
  it('대문자 태그도 같은 판정', () => {
    expect(isBusy({ activeTag: 'INPUT', modalCount: 0, unsavedCount: 0 })).toBe(true)
  })
  it('★ 모달이 열려 있으면 입력 중', () => {
    expect(isBusy({ activeTag: 'body', modalCount: 1, unsavedCount: 0 })).toBe(true)
  })
  it('★ 미저장 값이 있으면 입력 중 — 포커스가 딴 데 있어도', () => {
    expect(isBusy({ activeTag: 'body', modalCount: 0, unsavedCount: 1 })).toBe(true)
  })
  it('셋 다 아니면 입력 중이 아니다', () => {
    expect(isBusy({ activeTag: 'body', modalCount: 0, unsavedCount: 0 })).toBe(false)
    expect(isBusy({ activeTag: '', modalCount: 0, unsavedCount: 0 })).toBe(false)
    expect(isBusy({})).toBe(false)
  })
  it('버튼·링크 포커스는 입력 중이 아니다', () => {
    for (const tag of ['button', 'a', 'div']) {
      expect(isBusy({ activeTag: tag, modalCount: 0, unsavedCount: 0 }), tag).toBe(false)
    }
  })
})

describe('미저장 등록대', () => {
  it('켜고 끄면 수가 맞는다', () => {
    expect(busyKeyCount()).toBe(0)
    markBusy('stock-drafts', true); markBusy('tx-bulk', true)
    expect(busyKeyCount()).toBe(2)
    markBusy('stock-drafts', false)
    expect(busyKeyCount()).toBe(1)
  })
  it('같은 열쇠를 두 번 켜도 하나로 센다', () => {
    markBusy('a', true); markBusy('a', true)
    expect(busyKeyCount()).toBe(1)
  })
  it('빈 열쇠는 무시한다', () => {
    markBusy('', true); markBusy(null, true)
    expect(busyKeyCount()).toBe(0)
  })
})

describe('화면에서 읽기', () => {
  it('★ 모달(position:fixed · inset:0 · z>=1000)을 센다', () => {
    document.body.innerHTML =
      '<div style="position: fixed; inset: 0px; z-index: 1001;"></div>'
      + '<div style="position: fixed; inset: 0px; z-index: 1100;"></div>'
    expect(readBusy(document).modalCount).toBe(2)
  })
  it('★ z-index 가 낮은 고정 요소는 모달이 아니다 — 플로팅 버튼 등', () => {
    document.body.innerHTML = '<div style="position: fixed; inset: 0px; z-index: 880;"></div>'
    expect(readBusy(document).modalCount).toBe(0)
    expect(MODAL_MIN_Z).toBe(1000)
  })
  it('inset 이 없는 고정 요소는 세지 않는다', () => {
    document.body.innerHTML = '<div style="position: fixed; right: 18px; z-index: 1100;"></div>'
    expect(readBusy(document).modalCount).toBe(0)
  })
  it('포커스된 태그를 읽는다', () => {
    document.body.innerHTML = '<input id="x" />'
    document.getElementById('x').focus()
    expect(readBusy(document).activeTag).toBe('input')
    expect(isBusy(readBusy(document))).toBe(true)
  })
  it('등록대 수도 함께 돌려준다', () => {
    document.body.innerHTML = ''
    markBusy('k', true)
    expect(readBusy(document).unsavedCount).toBe(1)
  })
  it('document 가 없어도 터지지 않는다', () => {
    expect(() => readBusy(null)).not.toThrow()
  })
})

describe('★ reload 판단', () => {
  const base = { hadController: true, refreshing: false, lastReloadAt: 0, now: 1_000_000, busy: false }

  it('평소에는 한다', () => {
    expect(shouldReload(base)).toBe(true)
  })

  it('★ 첫 설치(제어받지 않던 상태)에서는 하지 않는다 — 처음 온 사람이 새로고침되면 안 된다', () => {
    expect(shouldReload({ ...base, hadController: false })).toBe(false)
  })

  it('★ 입력 중이면 하지 않는다 — 쓰던 값이 날아간다', () => {
    expect(shouldReload({ ...base, busy: true })).toBe(false)
  })

  it('이미 걸었으면 또 하지 않는다', () => {
    expect(shouldReload({ ...base, refreshing: true })).toBe(false)
  })

  it('★ 방금 했으면 하지 않는다 — 무한 reload 차단', () => {
    expect(shouldReload({ ...base, lastReloadAt: base.now - 1000 })).toBe(false)
    expect(shouldReload({ ...base, lastReloadAt: base.now - (RELOAD_GUARD_MS - 1) })).toBe(false)
  })

  it('보호 시간이 지나면 다시 한다 — 진짜 새 배포', () => {
    expect(shouldReload({ ...base, lastReloadAt: base.now - (RELOAD_GUARD_MS + 1) })).toBe(true)
  })

  it('★ 입력이 끝나면 미뤘던 것이 통과한다', () => {
    expect(shouldReload({ ...base, busy: true })).toBe(false)
    expect(shouldReload({ ...base, busy: false })).toBe(true)
  })

  it('보호 시간은 60초 · 확인 주기는 30분', () => {
    expect(RELOAD_GUARD_MS).toBe(60 * 1000)
    expect(UPDATE_EVERY_MS).toBe(30 * 60 * 1000)
  })
})

describe('저장소', () => {
  it('쓰고 읽는다', () => {
    writeLastReload(window, 12345)
    expect(readLastReload(window)).toBe(12345)
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe('12345')
  })
  it('없으면 0', () => {
    expect(readLastReload(window)).toBe(0)
  })
  it('★ 저장소를 못 써도 터지지 않는다(사생활 보호 모드)', () => {
    const bad = { sessionStorage: { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } } }
    expect(readLastReload(bad)).toBe(0)
    expect(() => writeLastReload(bad, 1)).not.toThrow()
  })
  it('★ ErrorBoundary 의 열쇠와 겹치지 않는다', () => {
    expect(RELOAD_KEY).toBe('pwa_reload_at')
    const eb = readFileSync(resolve(process.cwd(), 'src/lib/errorText.js'), 'utf8')
    expect(eb).toContain("EC_RELOAD_KEY = 'ec_chunk_reloaded'")
    expect(RELOAD_KEY).not.toBe('ec_chunk_reloaded')
  })
})

describe('배선 — 되돌아가지 않게', () => {
  it('★ registerSW.js 자동 주입이 꺼져 있다', () => {
    expect(VITE).toContain('injectRegister: null')
    expect(VITE, 'registerType 은 그대로 autoUpdate').toContain("registerType: 'autoUpdate'")
  })
  it('★ main.jsx 가 직접 등록하고 주기 확인을 건다', () => {
    expect(MAIN).toContain("from 'virtual:pwa-register'")
    expect(MAIN).toContain('r.update()')
    expect(MAIN).toContain('setInterval(check, UPDATE_EVERY_MS)')
    expect(MAIN).toContain("document.addEventListener('visibilitychange'")
  })
  it('★ controllerchange 에서만 reload 하고, 첫 설치를 가린다', () => {
    expect(MAIN).toContain("navigator.serviceWorker.addEventListener('controllerchange'")
    expect(MAIN).toContain('const hadController = !!navigator.serviceWorker.controller')
  })
  it('★ 입력이 끝나면 미뤘던 것을 다시 본다', () => {
    expect(MAIN).toContain("for (const ev of ['focusout', 'blur', 'click', 'keyup'])")
  })
  it('★ onNeedReload 를 넘긴다 — 이게 없으면 플러그인이 입력 중에도 무조건 새로고침한다', () => {
    /* 2026-10-29 미리보기 실측으로 드러난 함정. vite-plugin-pwa 의 virtual:pwa-register 는
       autoUpdate 모드에서 `onNeedReload ? onNeedReload() : location.reload()` 를 한다.
       옵션을 비워 두면 우리 판단(입력 중이면 미룬다)을 건너뛰고 바로 새로고침된다. */
    const i = MAIN.indexOf('registerSW({')
    expect(i, 'registerSW 호출이 없다').toBeGreaterThan(-1)
    const head = MAIN.slice(i, MAIN.indexOf('onRegisteredSW', i))
    expect(head, 'registerSW 의 첫 옵션들 안에 onNeedReload 가 있어야 한다').toContain('onNeedReload')
    expect(MAIN).toContain('onNeedReload()')
  })

  it('★ 미저장 상태 3곳이 등록대에 연결돼 있다', () => {
    for (const k of ['stock-drafts', 'tx-bulk', 'plan-drafts']) {
      expect(APP.includes("markBusy('" + k + "'"), k).toBe(true)
    }
    expect(APP).toContain("import { markBusy } from './lib/pwaUpdate'")
  })
  it('★ 화면에 그리는 것이 없다 — 알림 띠는 2단계', () => {
    /* main.jsx 는 JSX 를 Root 렌더 말고는 쓰지 않는다 */
    const jsx = (MAIN.match(/<[A-Z][A-Za-z]*/g) || []).filter(x => x !== '<StrictMode' && x !== '<Root')
    expect(jsx, '새로 그리는 컴포넌트: ' + jsx.join(', ')).toEqual([])
  })
})
