/* ═══════════════════════════════════════════════════════════════════════════
   재고현황 하위 화면 ↔ 주소(#stock/<화면>)

   ★ 왜 주소에 담는가 — 이미 저장소에 있는 `#transaction/ib`·`#vaccine/survey` 와
     **같은 방식**이다. 새 상태 저장소를 들이지 않고, 주소를 그대로 공유·즐겨찾기 할 수 있다.
   ★ 왜 별도 파일인가 — App.jsx 와 시험이 **같은 규칙**을 봐야 한다.
     lib/vaccineRoute.js 와 같은 꼴로 둔다(읽는 사람이 한 번 익히면 둘 다 안다).
   ★ 모르는 값은 null 이다 — 호출부가 기본 탭으로 간다.

   ★★ 옛 주소 `#usageupdate` 는 **여기로 넘긴다**(2026-11-14 이정화 님 승인).
     「사용량 갱신」이 재고관리 ▼ 에서 빠지고 재고현황 탭이 되었기 때문이다.
     옛 즐겨찾기가 깨지지 않게 `#stock/check` 로 조용히 바꿔 준다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 재고현황의 하위 화면. 「기준확인」 단추가 이 키로 옮겨 간다. */
export const STOCK_TABS = ['stock', 'check']
export const STOCK_TAB_DEFAULT = 'stock'

/* 옛 주소 → 새 주소 (한 칸짜리 표로 둔다 — 나중에 또 생기면 여기만 는다) */
export const OLD_ROUTE_REDIRECT = { usageupdate: '#stock/check' }

/* '#stock/check' → 'check' · '#stock' · '#stock/없는탭' → null */
export function stockTabFromHash(hash) {
  let h = hash == null ? (typeof window === 'undefined' ? '' : window.location.hash || '') : hash
  if (h.charAt(0) === '#') h = h.slice(1)
  if (h.charAt(0) === '/') h = h.slice(1)
  const seg = h.split('/')
  if (seg[0] !== 'stock') return null
  const raw = seg[1]
  if (!raw) return null
  let d
  try { d = decodeURIComponent(raw) } catch { d = raw }
  return STOCK_TABS.indexOf(d) !== -1 ? d : null
}

/* 탭 → 주소. 기본 탭은 꼬리를 붙이지 않는다(짧은 주소를 정본으로 둔다). */
export function stockHash(tab) {
  return '#stock' + (tab && tab !== STOCK_TAB_DEFAULT && STOCK_TABS.indexOf(tab) !== -1 ? '/' + tab : '')
}

/* 옛 주소면 새 주소를 돌려준다. 아니면 null.
   ★ `#usageupdate` 와 `#usageupdate/무엇이든` 둘 다 받는다. */
export function redirectOldHash(hash) {
  let h = hash == null ? (typeof window === 'undefined' ? '' : window.location.hash || '') : hash
  if (h.charAt(0) === '#') h = h.slice(1)
  if (h.charAt(0) === '/') h = h.slice(1)
  const head = h.split('/')[0]
  return Object.prototype.hasOwnProperty.call(OLD_ROUTE_REDIRECT, head) ? OLD_ROUTE_REDIRECT[head] : null
}
