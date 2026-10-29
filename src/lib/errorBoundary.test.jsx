/* 오류 안내 화면 — 세 앱의 경계를 **진짜 컴포넌트**로 렌더해 확인한다.
   ★ 일부러 throw 하는 부품(Boom)을 넣어 터뜨린다.
   ★ React 는 경계가 잡은 오류도 콘솔에 찍는다 — 시험 출력이 더러워지지 않게 눌러 둔다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ErrorBoundary, ErrorCard } from './errorBoundary.jsx'
import {
  EC_TITLE, EC_KEEP, EC_PLAIN, EC_CONTACT, EC_RELOAD, EC_HOME, EC_WHEN, EC_COPY,
  EC_ICON_BG, EC_PURPLE, EC_LIGHT, kstStamp, isChunkError, chunkReloadOnce,
  clearChunkReloadMark, EC_RELOAD_KEY, screenLabel,
} from './errorText.js'
import { ErrorBoundary as VaccineEB } from '../../vaccine-app/src/ErrorBoundary.jsx'
import { ErrorBoundary as WardEB } from '../../ward-app/src/ErrorBoundary.jsx'

function Boom({ msg }) { throw new Error(msg || '일부러 터뜨림') }
const T = EC_LIGHT

let err
beforeEach(() => {
  err = vi.spyOn(console, 'error').mockImplementation(() => {})
  try { window.sessionStorage.clear() } catch { /* 없음 */ }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('발생 시각 — KST', () => {
  it('★ 사용자 시간대와 무관하게 KST 로 찍는다', () => {
    /* 2026-10-29T00:05:00Z = KST 09:05 */
    expect(kstStamp(new Date('2026-10-29T00:05:00Z'))).toBe('2026-10-29 09:05')
    /* 자정 넘김 — UTC 2026-10-28T15:30Z = KST 다음날 00:30 */
    expect(kstStamp(new Date('2026-10-28T15:30:00Z'))).toBe('2026-10-29 00:30')
  })
  it('모양은 YYYY-MM-DD HH:mm', () => {
    expect(kstStamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('약플로 — 화면 자리만 바뀌고 메뉴는 남는다', () => {
  /* 메뉴를 흉내 낸 최소 구조: 헤더는 경계 **밖**, 화면은 경계 **안** */
  function Shell({ menu, onHome }) {
    return <div>
      <nav>메뉴띠</nav>
      <ErrorBoundary key={menu} t={T} screen={screenLabel(menu)} onHome={onHome}>
        {menu === 'vaccine' ? <Boom /> : <div>정상 화면 {menu}</div>}
      </ErrorBoundary>
    </div>
  }

  it('★ 화면이 터지면 카드가 뜨고 메뉴는 그대로 있다', () => {
    render(<Shell menu="vaccine" />)
    expect(screen.getByText(EC_TITLE)).toBeTruthy()
    expect(screen.getByText('메뉴띠'), '메뉴가 사라졌다').toBeTruthy()
    /* 승인 시안 문구 전부 */
    expect(screen.getByText(EC_KEEP, { exact: false })).toBeTruthy()
    expect(screen.getByText(EC_CONTACT, { exact: false })).toBeTruthy()
    expect(screen.getByText(EC_COPY)).toBeTruthy()
    /* 작은 글씨에 발생 시각과 화면 이름 */
    expect(screen.getByText(new RegExp(EC_WHEN + ' \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} · 백신 관리'))).toBeTruthy()
  })

  it('★ 다른 화면으로 옮기면(key 바뀜) 정상 화면이 나온다', () => {
    const { rerender } = render(<Shell menu="vaccine" />)
    expect(screen.getByText(EC_TITLE)).toBeTruthy()
    rerender(<Shell menu="stock" />)
    expect(screen.queryByText(EC_TITLE), '오류 상태가 안 풀렸다').toBeNull()
    expect(screen.getByText('정상 화면 stock')).toBeTruthy()
  })

  it('★ 「대시보드로」를 누르면 화면이 옮겨가고 카드가 사라진다', () => {
    /* ★ App.jsx 의 실제 경로를 그대로 흉내 낸다 — onHome 이 menu 를 바꾸고,
       menu 가 key 라서 경계가 새로 만들어진다. 자식이 그대로면 다시 터지는 것이 맞다. */
    const onHome = vi.fn()
    function Live() {
      const [menu, setMenu] = useState('vaccine')
      return <Shell menu={menu} onHome={() => { onHome(); setMenu('dashboard') }} />
    }
    render(<Live />)
    expect(screen.getByText(EC_TITLE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: EC_HOME }))
    expect(onHome).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(EC_TITLE), '카드가 남았다').toBeNull()
    expect(screen.getByText('정상 화면 dashboard')).toBeTruthy()
    expect(screen.getByText('메뉴띠')).toBeTruthy()
  })

  it('★ 정상일 때는 화면이 한 글자도 바뀌지 않는다', () => {
    const { container } = render(<ErrorBoundary t={T}><div>원래 화면</div></ErrorBoundary>)
    expect(container.innerHTML).toBe('<div>원래 화면</div>')
    expect(err, '정상인데 오류를 찍었다').not.toHaveBeenCalled()
  })

  it('「새로고침」이 location.reload 를 부른다', () => {
    const onReload = vi.fn()
    render(<ErrorCard t={T} onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: EC_RELOAD }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('바깥 경계(full · onHome 없음)에는 「대시보드로」가 없다', () => {
    render(<ErrorBoundary full><Boom /></ErrorBoundary>)
    expect(screen.getByText(EC_TITLE)).toBeTruthy()
    expect(screen.getByRole('button', { name: EC_RELOAD })).toBeTruthy()
    expect(screen.queryByRole('button', { name: EC_HOME }), '바깥 경계에 대시보드로가 있다').toBeNull()
  })

  it('★ 아이콘은 연보라 바탕 + 보라 「!」 (새 색 없음)', () => {
    render(<ErrorCard t={T} />)
    const icon = [...document.querySelectorAll('div')].find(d => d.textContent === '!' && d.getAttribute('aria-hidden') === 'true')
    expect(icon, '아이콘을 못 찾음').toBeTruthy()
    const norm = v => String(v).replace(/\s/g, '').toLowerCase()
    const probe = (prop, v) => { const d = document.createElement('div'); d.style[prop] = v; return norm(d.style[prop]) }
    expect(norm(icon.style.background)).toBe(probe('background', EC_ICON_BG))
    expect(norm(icon.style.color)).toBe(probe('color', EC_LIGHT.accent))
  })
})

describe('기록 규약', () => {
  it('★ console.error 에 메시지와 컴포넌트 스택만 — 외부 전송 없음', () => {
    render(<ErrorBoundary t={T}><Boom msg="테스트 오류" /></ErrorBoundary>)
    const mine = err.mock.calls.filter(c => c[0] === '[화면 오류]')
    expect(mine.length).toBe(1)
    expect(mine[0][1]).toBe('테스트 오류')
    expect(String(mine[0][2])).toContain('Boom')
  })

  it('★ 화면에 오류 원문·코드 경로가 보이지 않는다', () => {
    const { container } = render(<ErrorBoundary t={T}><Boom msg="내부사정-민감한내용" /></ErrorBoundary>)
    expect(container.textContent).not.toContain('내부사정-민감한내용')
    expect(container.textContent).not.toContain('Boom')
    expect(container.textContent).not.toContain('.jsx')
    expect(container.textContent).not.toContain('Error')
  })
})

describe('배포 직후 옛 조각을 못 불러오는 오류', () => {
  const chunkErrs = [
    Object.assign(new Error('x'), { name: 'ChunkLoadError' }),
    new Error('Loading chunk 42 failed.'),
    new Error('Failed to fetch dynamically imported module: /assets/VaccineManage-abc.js'),
    new Error('error loading dynamically imported module'),
    new Error('Importing a module script failed.'),
  ]

  it('청크 오류를 알아본다', () => {
    for (const e of chunkErrs) expect(isChunkError(e), e.message).toBe(true)
  })
  it('★ 보통 오류는 청크 오류가 아니다 — 함부로 새로고침하지 않는다', () => {
    for (const e of [new Error('Cannot read properties of undefined'), new Error('잘못된 입력')]) {
      expect(isChunkError(e), e.message).toBe(false)
    }
  })

  function fakeWin() {
    const store = {}
    const w = {
      reloads: 0,
      /* ★ 화살표 함수로 둔다 — reload() { this.reloads++ } 로 쓰면 this 가
         w.location 이라 w.reloads 가 안 오른다(이 시험에서 실제로 겪음). */
      location: { reload: () => { w.reloads++ } },
      sessionStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v) },
        removeItem: k => { delete store[k] },
      },
      _store: store,
    }
    return w
  }

  it('★ 청크 오류면 1회만 새로고침한다 — 두 번째는 안 한다(무한 반복 방지)', () => {
    const w = fakeWin()
    expect(chunkReloadOnce(chunkErrs[1], w)).toBe(true)
    expect(w.reloads).toBe(1)
    expect(w._store[EC_RELOAD_KEY]).toBe('1')
    /* 다시 터져도 새로고침하지 않는다 → 안내 화면이 뜬다 */
    expect(chunkReloadOnce(chunkErrs[1], w)).toBe(false)
    expect(w.reloads).toBe(1)
  })

  it('청크 오류가 아니면 새로고침하지 않는다', () => {
    const w = fakeWin()
    expect(chunkReloadOnce(new Error('보통 오류'), w)).toBe(false)
    expect(w.reloads).toBe(0)
  })

  it('★ 저장소를 못 쓰면 새로고침하지 않는다 — 반복 위험', () => {
    const w = fakeWin()
    w.sessionStorage.getItem = () => { throw new Error('denied') }
    expect(chunkReloadOnce(chunkErrs[0], w)).toBe(false)
    expect(w.reloads).toBe(0)
  })

  it('★ 정상 렌더에 성공하면 표시를 지운다 — 다음 배포에서 다시 쓸 수 있게', () => {
    const w = fakeWin()
    w.sessionStorage.setItem(EC_RELOAD_KEY, '1')
    render(<ErrorBoundary t={T} win={w}><div>정상</div></ErrorBoundary>)
    expect(w._store[EC_RELOAD_KEY]).toBeUndefined()
  })

  it('★ 1회 새로고침 뒤 또 터지면 안내 화면이 뜬다', () => {
    const w = fakeWin()
    w.sessionStorage.setItem(EC_RELOAD_KEY, '1')      /* 이미 한 번 새로고침한 상태 */
    render(<ErrorBoundary t={T} win={w}><Boom msg="Loading chunk 7 failed." /></ErrorBoundary>)
    expect(w.reloads, '두 번째인데 또 새로고침했다').toBe(0)
    expect(screen.getByText(EC_TITLE)).toBeTruthy()
  })

  it('clearChunkReloadMark 는 저장소가 없어도 터지지 않는다', () => {
    expect(() => clearChunkReloadMark({ sessionStorage: { removeItem() { throw new Error('x') } } })).not.toThrow()
    expect(() => clearChunkReloadMark(null)).not.toThrow()
  })
})

describe('공개 사이트·병동앱 — 전체 화면 카드 하나', () => {
  for (const [name, EB] of [['공개 조회·신청', VaccineEB], ['병동 신청', WardEB]]) {
    it(`${name}: 터지면 카드 하나 · 버튼은 「새로고침」 하나뿐`, () => {
      render(<EB><Boom /></EB>)
      expect(screen.getByText(EC_TITLE)).toBeTruthy()
      /* 공개·병동 본문은 「이미 저장한…」이 없다 */
      expect(screen.getByText(EC_PLAIN, { exact: false })).toBeTruthy()
      expect(screen.queryByText(EC_KEEP, { exact: false }), '공개 앱에 약플로 본문이 들어갔다').toBeNull()
      expect(screen.getByText(EC_CONTACT, { exact: false })).toBeTruthy()
      expect(screen.getByText(EC_COPY)).toBeTruthy()
      const btns = screen.getAllByRole('button')
      expect(btns.length, '버튼이 하나가 아니다').toBe(1)
      expect(btns[0].textContent).toBe(EC_RELOAD)
      expect(btns[0].style.width, '가로 꽉 차야 한다').toBe('100%')
      /* 화면 이름은 붙지 않는다 */
      expect(screen.getByText(new RegExp('^' + EC_WHEN + ' \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$'))).toBeTruthy()
    })

    it(`${name}: 정상일 때 화면 무변경`, () => {
      const { container } = render(<EB><div>원래 화면</div></EB>)
      expect(container.innerHTML).toBe('<div>원래 화면</div>')
    })
  }
})
