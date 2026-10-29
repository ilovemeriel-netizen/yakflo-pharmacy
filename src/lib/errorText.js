/* ═══════════════════════════════════════════════════════════════════════════
   오류 안내 화면의 문구·판정 (약플로 관리 앱) — 사용자 승인 시안 2026-10-29

   ★ 컴포넌트와 **파일을 나눈 이유** — react-refresh/only-export-components.
     한 .jsx 가 컴포넌트와 상수를 함께 export 하면 lint 오류가 난다
     (저장소에 이미 적힌 함정: App.jsx 에서 themes·useSort 를 export 하면 걸린다).
     그래서 상수·순수 함수는 이 .js 에, 컴포넌트는 errorBoundary.jsx 에 둔다.

   ★ 쌍둥이 파일: vaccine-app/src/errorText.js · ward-app/src/errorText.js
     세 앱은 별도 Vite 빌드라 서로 import 할 수 없다. errorBoundarySync.test.js 가
     **세 사본이 일치하는지** 시험한다. 한쪽만 고치면 그 시험이 걸린다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 승인 시안 문구 (바꾸지 말 것) ──────────────────────────────────────── */
export const EC_TITLE = '화면을 불러오는 중 문제가 생겼습니다'
export const EC_KEEP = '이미 저장한 내용은 그대로 있습니다. 새로고침해 주세요.'
export const EC_PLAIN = '새로고침해 주세요.'
export const EC_CONTACT = '같은 문제가 계속되면 약제과(내선 217)로 알려 주세요.'
export const EC_RELOAD = '새로고침'
export const EC_HOME = '대시보드로'
export const EC_WHEN = '발생 시각'
export const EC_COPY = 'Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.'

/* ── 시안 색 — 전부 기존 토큰 값이다. 새 색 0건 ────────────────────────────
   아이콘 바탕 = t.lavender 45%(「일부 미반영」 알림과 같은 값) · 「!」 = t.accent(라이트) */
export const EC_ICON_BG = 'rgba(191,166,217,0.45)'
export const EC_PURPLE = '#804A87'

/* ★ 바깥 경계는 ThemeCtx **밖**(Root.jsx)에 있어 useTheme() 을 쓸 수 없다.
   그래서 App.jsx 의 themes 에서 쓰는 값을 여기에 **같은 값으로** 적어 두고,
   errorBoundarySync.test.js 가 App.jsx 소스와 대조한다(어긋나면 걸린다).
   themes 를 export 하면 react-refresh 규칙에 걸려 lint 가 늘어난다. */
export const EC_LIGHT = { bg: '#F7F6F3', card: '#FFFFFF', border: '#E8E6E1', text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87' }
export const EC_DARK = { bg: '#121820', card: '#1A2332', border: '#2A3A4A', text: '#E8E6E1', textM: '#A3A39E', textL: '#6B7B8B', accent: '#BFA6D9' }

/* ── 화면 이름 — 작은 글씨 뒤에 붙는다(예: 「… · 백신 관리」) ───────────────
   ROUTES(App.jsx) 전 키를 덮는다. 빠진 키가 있으면 시험이 걸린다. */
export const SCREEN_LABEL = {
  dashboard: '대시보드', alerts: '알림', druglist: '약품목록', expiry: '유효기한',
  idle: '사용점검', change: '약품변경', stock: '재고현황', count: '실사',
  narcotic: '향정마약', nonins: '비보험', ordering: '발주업무', ward: '병동신청',
  transaction: '입출고', report: '보고서', emergency: '비상조제', atc: 'ATC편집',
  schedule: '일정', register: '약품등록', mypage: '내 정보', admin: '사용자관리',
  archive: '보관함', locvocab: '보관위치', vaccine: '백신 관리',
}
export function screenLabel(menu) {
  return SCREEN_LABEL[menu] || ''
}

/* ── 발생 시각 — KST 기준 'YYYY-MM-DD HH:mm' ──────────────────────────────
   ★ 사용자 시간대를 믿지 않는다. 병원 PC 시간대가 어긋나도 같은 값이 나와야
     「내선 217」로 알릴 때 서로 같은 시각을 본다. */
export function kstStamp(d) {
  const t = (d instanceof Date ? d : new Date()).getTime()
  const k = new Date(t + 9 * 60 * 60 * 1000)
  const p = n => String(n).padStart(2, '0')
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/* ── 배포 직후 「옛 조각을 못 불러오는」 오류 ────────────────────────────────
   새 배포가 올라가면 열어 둔 탭이 참조하는 청크 파일이 사라진다. 그때 나는
   오류는 코드 결함이 아니라 **새로고침 한 번이면 끝나는 것**이다.
   ★ 다만 무한 새로고침은 절대 안 된다 — sessionStorage 표시로 1회만 한다.
     정상 렌더에 성공하면 표시를 지워, 다음 배포에서 다시 한 번 쓸 수 있게 한다. */
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

/* 청크 오류면 1회만 새로고침하고 true. 아니면(또는 이미 한 번 했으면) false. */
export function chunkReloadOnce(err, win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w || !isChunkError(err)) return false
  try {
    if (w.sessionStorage.getItem(EC_RELOAD_KEY)) return false
    w.sessionStorage.setItem(EC_RELOAD_KEY, '1')
  } catch {
    return false            /* 저장소를 못 쓰면 반복 위험이 있어 새로고침하지 않는다 */
  }
  w.location.reload()
  return true
}

export function clearChunkReloadMark(win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w) return
  try { w.sessionStorage.removeItem(EC_RELOAD_KEY) } catch { /* 저장소 없음 — 무시 */ }
}
