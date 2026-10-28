/* ═══════════════════════════════════════════════════════════════════════════
   백신 관리 하위 탭 ↔ 주소(#vaccine/<탭>)

   ★ 왜 주소에 담는가 — 이미 저장소에 있는 #transaction/ib 와 같은 방식이다.
     새 상태 저장소를 들이지 않고, 주소를 그대로 공유·즐겨찾기 할 수 있다.
   ★ 왜 별도 파일인가 — App.jsx 와 VaccineManage.jsx 가 **같은 규칙**을 봐야 하는데
     VaccineManage 는 lazy 라 App 의 effect 보다 늦게 붙는다. App 이 처음 주소를
     다시 쓸 때(replaceState) 하위 탭을 지워 버리면 VaccineManage 가 읽을 것이 없다.
     그래서 두 쪽이 같은 함수를 쓴다. 공용 컴포넌트는 건드리지 않는다.
   ★ 모르는 값은 null 이다 — 호출부가 기본 탭으로 간다.
   ★ 원문 보기 상태는 여기에 담지 않는다. 주소에도 저장소에도 남기지 않으므로
     새로고침하면 반드시 다시 가려진다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 백신 관리의 하위 탭. VaccineManage 의 탭 띠와 같은 키를 쓴다. */
export const VACCINE_TABS = ['manage', 'survey']
export const VACCINE_TAB_DEFAULT = 'manage'

/* '#vaccine/survey' → 'survey' · '#vaccine' · '#vaccine/없는탭' → null */
export function vaccineTabFromHash(hash) {
  let h = hash == null ? (typeof window === 'undefined' ? '' : window.location.hash || '') : hash
  if (h.charAt(0) === '#') h = h.slice(1)
  if (h.charAt(0) === '/') h = h.slice(1)
  const seg = h.split('/')
  if (seg[0] !== 'vaccine') return null
  const raw = seg[1]
  if (!raw) return null
  let d
  try { d = decodeURIComponent(raw) } catch { d = raw }
  return VACCINE_TABS.indexOf(d) !== -1 ? d : null
}

/* 탭 → 주소. 기본 탭은 꼬리를 붙이지 않는다(짧은 주소를 정본으로 둔다). */
export function vaccineHash(tab) {
  return '#vaccine' + (tab && tab !== VACCINE_TAB_DEFAULT && VACCINE_TABS.indexOf(tab) !== -1 ? '/' + tab : '')
}
