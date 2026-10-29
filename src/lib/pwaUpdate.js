/* ═══════════════════════════════════════════════════════════════════════════
   새 배포를 열린 탭에 적용하기 — 1단계(자동 교체)

   ★ 왜 필요한가 (2026-10-29 실측)
     registerType 은 'autoUpdate' 고 sw.js 에 skipWaiting·clientsClaim 이 이미
     들어 있다. 그런데 그것은 「앞으로의 요청을 새 SW 가 맡는다」는 뜻일 뿐,
     **이미 메모리에 올라간 JS 를 바꾸지 않는다.** 자동 주입되던 registerSW.js 는
     등록 한 줄뿐이라 갱신 감지도 reload 도 없었다.
     SPA 안에서 메뉴만 옮겨 다니면 탐색이 일어나지 않아 **탭이 며칠이고 옛 코드를
     실행**한다. 회차 마감이 두 번 9시간 밀린 사고의 원인이 이것이다.
     ※ index.html 은 max-age=0·must-revalidate 라 **F5 한 번이면** 최신이 된다.
       필요한 것은 「강력 새로고침」이 아니라 「새로고침을 하게 만드는 것」이다.

   ★ 이 파일에는 **판단만** 둔다 — 순수 함수라 시험할 수 있다.
     실제 등록·reload 는 main.jsx 가 한다.

   ★ 알림 띠는 2단계다(승인 후). 지금은 화면에 아무것도 그리지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 입력 중으로 보는 태그 */
export const BUSY_TAGS = ['input', 'select', 'textarea']

/* 모달 판정 — 이 앱의 모달은 전부 position:fixed + inset:0 + zIndex>=1000 이다.
   ★ 여는 방식이 제각각이라(훅 3종) 공통 class 가 없어 쓰이는 값으로 가린다.
     드롭다운 뒷막(zIndex 9998)도 걸리는데, 그건 보수적으로 맞는 쪽이다. */
export const MODAL_MIN_Z = 1000

/* ── 미저장 등록대 ────────────────────────────────────────────────────────
   화면이 「아직 저장 안 한 값이 있다」를 알려 주는 곳. React state 는 모듈에서
   볼 수 없으므로, 그 값을 가진 화면이 켜고 끈다(StockStatus·TransactionForm·
   DrugChangePlans 의 drafts·bulkData).
   ★ 화면에 그리는 것은 하나도 없다 — 배치·색·문구가 바뀌지 않는다. */
const busyKeys = new Set()

export function markBusy(key, on) {
  if (!key) return
  if (on) busyKeys.add(key)
  else busyKeys.delete(key)
}

export function busyKeyCount() {
  return busyKeys.size
}

export function clearBusyKeys() {
  busyKeys.clear()
}

/* ── 판단(순수) ───────────────────────────────────────────────────────────
   activeTag  : 지금 포커스된 요소의 태그(소문자) 또는 ''
   modalCount : 열려 있는 모달 수
   unsavedCount : 등록대에 올라온 미저장 건수 */
export function isBusy({ activeTag, modalCount, unsavedCount }) {
  if (BUSY_TAGS.indexOf(String(activeTag || '').toLowerCase()) !== -1) return true
  if (Number(modalCount || 0) > 0) return true
  if (Number(unsavedCount || 0) > 0) return true
  return false
}

/* ── 지금 화면 상태 읽기 ──────────────────────────────────────────────────
   ★ document 를 인자로 받는다 — 시험에서 가짜 document 를 넣을 수 있다. */
export function readBusy(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null)
  if (!d) return { activeTag: '', modalCount: 0, unsavedCount: busyKeyCount() }
  const ae = d.activeElement
  const activeTag = ae && ae.tagName ? String(ae.tagName).toLowerCase() : ''
  let modalCount = 0
  try {
    const nodes = d.querySelectorAll('div[style*="position: fixed"]')
    for (const n of nodes) {
      const s = n.getAttribute('style') || ''
      if (s.indexOf('inset: 0') === -1) continue
      const m = /z-index:\s*(\d+)/.exec(s)
      if (m && Number(m[1]) >= MODAL_MIN_Z) modalCount++
    }
  } catch { /* querySelectorAll 을 못 쓰면 모달 수를 0 으로 본다 */ }
  return { activeTag, modalCount, unsavedCount: busyKeyCount() }
}

/* ── reload 판단(순수) ────────────────────────────────────────────────────
   hadController : 페이지가 뜰 때 이미 SW 의 제어를 받고 있었는가
                   ★ 첫 방문에는 clientsClaim 때문에 controllerchange 가 한 번
                     나는데, 그때 reload 하면 **처음 들어온 사람이 새로고침된다.**
   refreshing    : 이 페이지에서 이미 reload 를 걸었는가(메모리 플래그)
   lastReloadAt  : 직전 reload 시각(sessionStorage) — 없으면 0
   now, busy     : 현재 시각, 입력 중 여부
   ★ guardMs 안에 또 요청이 오면 거절한다 — 무한 reload 방지. */
export const RELOAD_KEY = 'pwa_reload_at'
export const RELOAD_GUARD_MS = 60 * 1000

export function shouldReload({ hadController, refreshing, lastReloadAt, now, busy, guardMs }) {
  if (!hadController) return false          /* 첫 설치 — 바꿀 옛 코드가 없다 */
  if (refreshing) return false              /* 이미 걸었다 */
  if (busy) return false                    /* 입력 중 — 미룬다 */
  const g = guardMs == null ? RELOAD_GUARD_MS : guardMs
  if (lastReloadAt && now - lastReloadAt < g) return false   /* 방금 했다 — 되풀이 차단 */
  return true
}

/* 저장소 읽기·쓰기 — 못 쓰면 0/무시(사생활 보호 모드 등) */
export function readLastReload(win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w) return 0
  try { return Number(w.sessionStorage.getItem(RELOAD_KEY) || 0) || 0 } catch { return 0 }
}

export function writeLastReload(win, now) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w) return
  try { w.sessionStorage.setItem(RELOAD_KEY, String(now)) } catch { /* 무시 */ }
}

/* 갱신 확인 주기 — 탭 복귀 때마다 + 이 간격마다.
   ★ 바뀐 것이 없으면 ETag 재검증이라 1회 0바이트(헤더 왕복)다. 실측 확인. */
export const UPDATE_EVERY_MS = 30 * 60 * 1000

/* 미리보기 재현용 표식 — 이 줄 하나로 번들 해시가 바뀐다(2026-10-29 검증) */
export const PROBE_MARK = 'v2'
