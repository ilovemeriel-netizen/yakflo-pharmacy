/* 탭 ↔ 주소 해시 — 새로고침해도 보던 탭이 유지되게 한다.

   ★ 왜 해시인가
     탭 상태가 React state 에만 있어서(App.jsx 의 useState('stock')) 새로고침하면
     언제나 잔량으로 돌아갔다. 수요조사를 쓰다 새로고침하면 처음부터 다시
     찾아 들어가야 했다.
     해시는 서버 요청 없이 바뀌고, 주소를 복사해 보내도 같은 탭이 열린다.

   ★ 잔량은 해시를 **쓰지 않는다** — 기본 화면이라 주소가 깔끔해야 하고,
     지금까지 돌아다니던 주소(해시 없음)가 그대로 잔량을 가리켜야 한다.

   ★ 입력 중인 값은 **담지 않는다.** 해시에 들어가는 것은 탭 이름 하나뿐이다.
     확인번호·성명 같은 값을 주소나 저장소에 남기지 않기 위해서다
     (새로고침하면 입력이 비워지는 지금 동작을 그대로 둔다). */
export const TABS = ['stock', 'survey']
export const TAB_DEFAULT = 'stock'

/* '#survey' → 'survey' · 그 밖(없음·모르는 값) → 'stock' */
export function tabFromHash(hash) {
  const h = typeof hash === 'string'
    ? hash
    : (typeof window !== 'undefined' ? window.location.hash : '')
  const key = String(h || '').replace(/^#\/?/, '').split('/')[0]
  return TABS.indexOf(key) !== -1 ? key : TAB_DEFAULT
}

/* 탭 → 주소에 쓸 해시. 기본 탭은 빈 문자열(해시 없음). */
export function tabHash(tab) {
  return tab === TAB_DEFAULT || TABS.indexOf(tab) === -1 ? '' : '#' + tab
}

/* 주소를 바꾼다 — replaceState 라 뒤로 가기 기록이 쌓이지 않는다.
   탭 전환은 「화면 이동」이 아니라 「같은 화면의 다른 면」이기 때문이다. */
export function writeTabHash(tab, win) {
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (!w || !w.history || !w.history.replaceState) return
  const h = tabHash(tab)
  const base = (w.location.pathname || '/') + (w.location.search || '')
  try { w.history.replaceState(null, '', h ? base + h : base) } catch { /* 주소를 못 바꿔도 화면은 동작한다 */ }
  setTabIcon(tab, w.document)
}

/* ── 탭에 따라 파비콘을 바꾼다 ──────────────────────────────────────────
   잔량 = 바이알(vial) · 수요조사 = 클립보드(survey).
   ★ index.html 의 `data-tab-icon` 이 붙은 <link> 만 바꾼다 —
     apple-touch-icon(홈 화면 아이콘)은 그대로 둔다.
   ★ 파일 이름 규칙만 바꿔 끼운다: /vial.svg ↔ /survey.svg · /vial-32.png ↔ /survey-32.png.
   ★ 새로고침으로 #survey 에 바로 들어와도 보이게, 화면이 처음 뜰 때도 한 번 부른다. */
export const ICON_BY_TAB = { stock: 'vial', survey: 'survey' }

export function setTabIcon(tab, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null)
  if (!d || !d.querySelectorAll) return
  const name = ICON_BY_TAB[tab] || ICON_BY_TAB[TAB_DEFAULT]
  for (const el of d.querySelectorAll('link[data-tab-icon]')) {
    const href = el.getAttribute('href') || ''
    const next = href.replace(/\/(vial|survey)/, '/' + name)
    if (next !== href) el.setAttribute('href', next)
  }
}

/* 해시를 지운다 — 열린 회차가 없어 수요조사 탭 자체가 없을 때 */
export function clearTabHash(win) {
  writeTabHash(TAB_DEFAULT, win)
}
