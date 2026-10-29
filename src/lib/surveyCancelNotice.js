/* 취소 안내 띠 — 「무엇을 언제까지 보여 주는가」만 정한다(순수 함수).

   ★ 왜 필요한가 (2026-10-30 운영 실측)
     응답 표의 기본 머리글 필터가 `status='신청'` 이라, 취소하면 그 줄이 **즉시
     목록에서 사라진다.** 되살리기용 상태 칸도 그 줄에 붙어 있으므로 같이 사라져,
     `restore` 에 **도달할 방법이 없었다**(운영에서 cancel 기록만 남고 restore 는 0건).
     그래서 취소 직후에만 띠를 띄워 거기서 되돌릴 수 있게 한다.

   ★ 필터 기본값과 표 배치는 건드리지 않는다 — 띠만 더한다.

   ★ 띠는 **회차마다 따로** 본다. 회차를 옮기면 보이지 않아야 하는데, effect 에서
     setState 하면 `react-hooks/set-state-in-effect` 에 걸린다. 그래서 띠에 그때의
     회차 id 를 함께 담아 두고 **그릴 때 비교**한다(파생값으로 푼다). */

/* 색은 「일부 미반영」 안내와 같은 라벤더를 쓴다 — 새 색을 만들지 않는다. */
export {
  PARTIAL_BG as NOTICE_BG, PARTIAL_FG as NOTICE_FG,
  PARTIAL_LINE as NOTICE_LINE, PARTIAL_BTN as NOTICE_BTN,
} from './saveWithFallback.js'

export function noticeText(code) {
  return String(code || '') + ' 취소했습니다'
}

/* 띠 상태 바꾸기 — prev 는 null 또는 { id, code, selId }
   ev.type: 'cancelled' | 'restored' | 'closed' | 'moved' */
export function nextNotice(prev, ev) {
  const cur = prev || null
  if (!ev || !ev.type) return cur
  if (ev.type === 'cancelled') {
    /* 여러 건을 연속으로 취소하면 **마지막 건만** 보여 준다 */
    if (!ev.id) return cur
    return { id: ev.id, code: String(ev.code || ''), selId: ev.selId == null ? null : ev.selId }
  }
  if (ev.type === 'restored') {
    /* 그 줄을 되돌렸으면 띠는 할 일이 끝났다. 다른 줄이면 그대로 둔다. */
    return cur && cur.id === ev.id ? null : cur
  }
  if (ev.type === 'closed' || ev.type === 'moved') return null
  return cur
}

/* 지금 화면에서 보여 줄 띠 — 회차가 다르면 보여 주지 않는다 */
export function visibleNotice(notice, selId) {
  if (!notice) return null
  if (notice.selId == null) return notice
  return String(notice.selId) === String(selId == null ? '' : selId) ? notice : null
}
