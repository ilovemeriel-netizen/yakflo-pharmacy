import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import Root from './Root.jsx'
import {
  readBusy, isBusy, shouldReload, readLastReload, writeLastReload, UPDATE_EVERY_MS,
} from './lib/pwaUpdate.js'

/* ═══ 새 배포를 열린 탭에 적용한다 (1단계 · 화면에 아무것도 그리지 않는다) ═══
   ★ 자동 주입되던 registerSW.js 는 등록 한 줄뿐이라 갱신 확인도 reload 도 없었다.
     그래서 vite.config 의 injectRegister 를 끄고 여기서 직접 등록한다.
     registerType 은 'autoUpdate' 그대로 — 새 SW 는 skipWaiting 으로 바로 활성화된다.
   ★ 판단은 lib/pwaUpdate.js 에 있다(순수 함수 · 시험 있음). 여기는 배선만 한다. */
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  /* 첫 방문에도 clientsClaim 때문에 controllerchange 가 한 번 난다.
     그때 reload 하면 처음 들어온 사람이 새로고침되므로, 들어올 때 제어 여부를 기억한다. */
  const hadController = !!navigator.serviceWorker.controller
  let refreshing = false
  let pending = false          /* 새 코드가 와 있는데 입력 중이라 미뤄 둔 상태 */

  const tryReload = () => {
    if (!pending) return
    const busy = isBusy(readBusy(document))
    const now = Date.now()
    if (!shouldReload({ hadController, refreshing, lastReloadAt: readLastReload(window), now, busy })) return
    refreshing = true
    writeLastReload(window, now)
    window.location.reload()
  }

  /* 새 SW 가 제어권을 가져왔다 = 새 코드가 올라와 있다 */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pending = true
    tryReload()
  })

  /* 미뤄 둔 뒤 입력이 끝나면 다시 본다 — 포커스 해제·모달 닫힘·클릭·키 입력 끝 */
  for (const ev of ['focusout', 'blur', 'click', 'keyup']) {
    window.addEventListener(ev, () => { if (pending) setTimeout(tryReload, 0) }, true)
  }

  const updateSW = registerSW({
    immediate: true,
    /* ★ 이 자리를 비워 두면 vite-plugin-pwa 가 **스스로 무조건** reload 한다.
         번들 실물: activated 에서 `onNeedReload ? onNeedReload() : location.reload()`
         2026-10-29 미리보기 실측 — 입력칸에 포커스를 둔 탭도 그냥 새로고침됐고,
         우리 쪽 표식(pwa_reload_at)은 비어 있었다. 즉 아래 판단을 건너뛴 것이다.
       여기서 받아 두면 reload 여부는 tryReload 가 정한다(= 입력 중이면 미룬다). */
    onNeedReload() {
      pending = true
      tryReload()
    },
    onRegisteredSW(_url, r) {
      if (!r) return
      /* 탭으로 돌아올 때마다 + 30분마다 확인한다.
         ★ SPA 안에서는 탐색이 없어 브라우저가 스스로 확인할 기회가 없다. */
      const check = () => { r.update().catch(() => { /* 오프라인 등 — 다음에 다시 */ }) }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { check(); tryReload() }
      })
      setInterval(check, UPDATE_EVERY_MS)
    },
  })
  /* autoUpdate 모드에서는 updateSW() 가 할 일이 없다(sw.js 가 이미 skipWaiting 한다).
     반환값을 버리지 않고 묶어 두어 lint 가 미사용으로 보지 않게만 한다. */
  void updateSW
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
