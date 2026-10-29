/* ═══════════════════════════════════════════════════════════════════════════
   오류 안내 화면의 문구·판정 (공개 조회·신청 사이트) — 승인 시안 2026-10-29

   ★ 쌍둥이 파일: src/lib/errorText.js · ward-app/src/errorText.js
     세 앱은 별도 Vite 빌드라 서로 import 할 수 없다. 관리 앱의
     errorBoundarySync.test.js 가 **세 사본이 일치하는지** 시험한다.
     ★ 관리 앱 파일을 import 하지 않는다 — 이 번들에 들어가면 안 되는 글자가 있다.

   ★ 컴포넌트와 파일을 나눈 이유 — react-refresh/only-export-components.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 승인 시안 문구 (바꾸지 말 것) ──────────────────────────────────────── */
export const EC_TITLE = '화면을 불러오는 중 문제가 생겼습니다'
export const EC_PLAIN = '새로고침해 주세요.'
export const EC_CONTACT = '같은 문제가 계속되면 약제과(내선 217)로 알려 주세요.'
export const EC_RELOAD = '새로고침'
export const EC_WHEN = '발생 시각'
export const EC_COPY = 'Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.'

/* 아이콘 바탕 = --v-lav 45% · 「!」 = --v-purple. 둘 다 index.css 의 기존 값이다. */
export const EC_ICON_BG = 'rgba(191,166,217,0.45)'

export function kstStamp(d) {
  const t = (d instanceof Date ? d : new Date()).getTime()
  const k = new Date(t + 9 * 60 * 60 * 1000)
  const p = n => String(n).padStart(2, '0')
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/* ── 배포 직후 「옛 조각을 못 불러오는」 오류 — 1회만 새로고침 ─────────────── */
export const EC_RELOAD_KEY = 'ec_chunk_reloaded'

export function isChunkError(err) {
  const name = String((err && err.name) || '')
  const msg = String((err && err.message) || err || '')
  if (name === 'ChunkLoadError') return true
  return /Loading chunk \S+ failed/i.test(msg)
    || /Loading CSS chunk \S+ failed/i.test(msg)
    || /Failed to fetch dynamically imported module/i.test(msg)
    || /error loading dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)
    || /dynamically imported module/i.test(msg)
}

export function chunkReloadOnce(err, win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w || !isChunkError(err)) return false
  try {
    if (w.sessionStorage.getItem(EC_RELOAD_KEY)) return false
    w.sessionStorage.setItem(EC_RELOAD_KEY, '1')
  } catch {
    return false
  }
  w.location.reload()
  return true
}

export function clearChunkReloadMark(win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w) return
  try { w.sessionStorage.removeItem(EC_RELOAD_KEY) } catch { /* 저장소 없음 — 무시 */ }
}
