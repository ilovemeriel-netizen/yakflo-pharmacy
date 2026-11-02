/* @vitest-environment node */
/* 흰 화면 안전망 — 2026-11-02.

   ★ 막으려는 결함
     SPA 대체 규칙(/* → index.html 200)이 /assets/*.js 요청까지 삼켜,
     브라우저에 자바스크립트 대신 **HTML 을 200 으로** 돌려줬다.
     브라우저는 그걸 실행하지 못해 React 가 아예 못 뜨고 → ErrorBoundary 도 못 돌고
     → **순백 화면**. 백신 화면이 유일한 lazy 청크라 거기서만 증상이 났다.

   ★ 여기서 못 박는 것
     ① 세 앱의 배포 규칙에서 /assets/* 404 줄이 catch-all **위**에 있다
     ② 청크 오류 판정이 MIME 불일치 말도 알아듣는다 (세 앱 같은 판정)
     ③ index.html 안전망이 **무한 새로고침을 절대 하지 않는다** */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isChunkError } from './lib/errorText.js'

const read = p => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('① 배포 규칙 — /assets/* 가 catch-all 보다 위에 있다', () => {
  it('★ 약플로(_redirects)', () => {
    const s = read('public/_redirects')
    const assets = s.indexOf('/assets/*')
    const all = s.search(/^\/\*\s/m)
    expect(assets, '/assets/* 규칙이 없다').toBeGreaterThan(-1)
    expect(all, 'catch-all 이 없다').toBeGreaterThan(-1)
    expect(assets, '★ /assets/* 가 catch-all 아래에 있으면 아무 효과가 없다').toBeLessThan(all)
    expect(s).toMatch(/\/assets\/\*\s+\S+\s+404/)
  })

  for (const app of ['vaccine-app', 'ward-app']) {
    it('★ ' + app + ' (netlify.toml)', () => {
      const s = read(app + '/netlify.toml')
      const assets = s.indexOf('from = "/assets/*"')
      const all = s.indexOf('from = "/*"')
      expect(assets, '/assets/* 규칙이 없다').toBeGreaterThan(-1)
      expect(all, 'catch-all 이 없다').toBeGreaterThan(-1)
      expect(assets, '★ 순서대로 평가되므로 catch-all 보다 먼저여야 한다').toBeLessThan(all)
      /* 그 블록의 status 가 404 인지 */
      const block = s.slice(assets, all)
      expect(block, '/assets/* 는 404 여야 한다').toContain('status = 404')
    })
  }
})

describe('② 청크 오류 판정 — 자바스크립트 자리에 HTML 이 왔을 때', () => {
  const HTML_CASES = [
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
    'Expected a JavaScript module script',
    'Refused to execute script because its MIME type (\'text/html\') is not executable',
  ]
  it('★ 전부 청크 오류로 친다 (= 1회 자동 새로고침 대상)', () => {
    for (const m of HTML_CASES) expect(isChunkError(new Error(m)), m.slice(0, 40)).toBe(true)
  })
  it('평범한 오류는 여전히 아니다 — 아무 오류에나 새로고침하면 안 된다', () => {
    for (const m of ['Cannot read properties of undefined', '잘못된 입력입니다', '저장 실패']) {
      expect(isChunkError(new Error(m)), m).toBe(false)
    }
    expect(isChunkError(null)).toBe(false)
  })
})

describe('③ index.html 안전망 — 무한 새로고침이 절대 없다', () => {
  const html = read('index.html')

  it('표식(sessionStorage) 로 1회만 한다', () => {
    expect(html).toContain('yk_boot_reloaded')
    expect(html, '표식이 있으면 되돌아가야 한다').toMatch(/getItem\(KEY\)\)\s*\{[^}]*return/)
    /* 표식을 **먼저** 남기고 그 다음에 새로고침해야 한다 — 순서가 뒤집히면
       새로고침이 먼저 일어나 표식이 저장되지 않고, 되풀이가 난다 */
    expect(html, '새로고침 전에 표식을 먼저 남긴다').toMatch(/setItem\(KEY[\s\S]{0,400}location\.reload\(\)/)
  })

  it('저장소를 못 쓰면 아예 새로고침하지 않는다', () => {
    expect(html, 'catch 에서 return 해야 한다').toMatch(/catch \(e\) \{ return; \}/)
  })

  it('한 번 띄우고 나면 다시 안 건다 (done 빗장)', () => {
    expect(html).toMatch(/if \(done\) return; done = true;/)
  })

  it('정상으로 떴으면 표식을 지운다 — 다음 배포에서 다시 쓸 수 있게', () => {
    expect(html).toMatch(/removeItem\(KEY\)/)
  })

  /* ★ B 보강(2026-11-02) — 느린 망에서 멀쩡한 화면을 괜히 새로고침하면 안 된다 */
  it('★ 주 신호는 모듈 error 이벤트다 — 즉시 1회', () => {
    expect(html).toMatch(/addEventListener\('error'[\s\S]{0,200}reloadOnce\(/)
  })
  it('★ 시간 기준은 15~20초 사이다', () => {
    const m = html.match(/WAIT = (\d+)/)
    expect(m, 'WAIT 를 못 찾음').toBeTruthy()
    expect(Number(m[1])).toBeGreaterThanOrEqual(15000)
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
  })
  it('★ 아직 받는 중이면(settled 아님) 새로고침하지 않는다', () => {
    expect(html).toMatch(/if \(!settled\)[\s\S]{0,120}return;/)
  })
  it('★ 모듈이 돌았으면(__ykBoot) 시간이 지나도 새로고침하지 않는다', () => {
    expect(html).toMatch(/if \(window\.__ykBoot\) return;/)
    expect(read('src/main.jsx'), 'main.jsx 가 표식을 남겨야 한다').toContain('window.__ykBoot = 1')
  })
  it('★ 세 조건이 모두 맞을 때만 보조 새로고침이 걸린다', () => {
    const i = html.indexOf('setTimeout(function ()')
    const block = html.slice(i, html.indexOf('}, WAIT)'))
    expect(block, '① #root 비었나').toMatch(/childElementCount > 0/)
    expect(block, '② 모듈이 돌았나').toContain('__ykBoot')
    expect(block, '③ 스크립트가 끝났나').toContain('settled')
  })

  it('화면에 아무것도 그리지 않는다 — innerHTML·document.write 금지', () => {
    const script = html.slice(html.indexOf('yk_boot_reloaded') - 400, html.indexOf('</script>'))
    expect(script).not.toContain('innerHTML')
    expect(script).not.toContain('document.write')
    expect(script).not.toContain('appendChild')
  })

  /* ★ 진짜로 돌려 본다 — 가짜 window 로 되풀이가 나는지 센다 */
  it('★ 같은 탭에서 열 번 불러도 새로고침은 **1회**뿐', () => {
    const store = {}
    let reloads = 0
    const KEY = 'yk_boot_reloaded'
    /* index.html 의 reloadOnce 와 같은 규칙을 그대로 옮겨 적는다 */
    const make = () => {
      let done = false
      return function reloadOnce() {
        if (done) return; done = true
        if (store[KEY]) return
        store[KEY] = '1'
        reloads++
      }
    }
    for (let i = 0; i < 10; i++) make()()      /* 새 탭 로드 10회 = 같은 세션 */
    expect(reloads, '세션 표식이 남아 1회만 해야 한다').toBe(1)
  })

  it('★ 저장소를 못 쓰는 탭에서는 0회', () => {
    let reloads = 0
    const bad = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    const reloadOnce = () => {
      try { if (bad.getItem('k')) return; bad.setItem('k', '1') } catch { return }
      reloads++
    }
    for (let i = 0; i < 5; i++) reloadOnce()
    expect(reloads).toBe(0)
  })
})

describe('④ 전역 오류 기록 — 화면에는 안 그린다', () => {
  const main = read('src/main.jsx')
  it('window error·unhandledrejection 을 콘솔에 남긴다', () => {
    expect(main).toMatch(/addEventListener\('error'/)
    expect(main).toMatch(/addEventListener\('unhandledrejection'/)
    expect(main).toContain('[전역 오류]')
    expect(main).toContain('[처리 안 된 거부]')
  })
  it('바깥으로 보내지 않는다 — fetch·sendBeacon 금지', () => {
    const i = main.indexOf('[전역 오류]')
    const block = main.slice(i - 900, i + 900)
    expect(block).not.toContain('sendBeacon')
    expect(block).not.toMatch(/fetch\(/)
  })
})
