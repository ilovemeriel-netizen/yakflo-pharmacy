/* 위치별 약품 창 — 고르기·거르기 규칙(순수 함수).
   화면·supabase 를 모른다. 「이 줄을 체크할 수 있나」와 「확인 창에 뭐라고 쓸까」를 한곳에 둔다.

   ★ 왜 분리했나
     체크 가능 여부가 체크박스·전체선택·가져오기 세 곳에서 쓰인다. 세 곳이 각자 판단하면
     「체크는 되는데 가져오기에서 빠지는」 식으로 조용히 어긋난다. */

/* 원내 전체 검색 — 한 번에 받는 최대 줄 수. 51을 받아 와 51번째가 있으면 「더 있다」로 본다. */
export const SEARCH_LIMIT = 50
/* 입력이 멈춘 뒤 기다리는 시간. 글자마다 조회하면 한 단어에 조회가 여러 번 나간다. */
export const DEBOUNCE_MS = 300

/* ★ 체크할 수 없는 줄과 그 까닭 — null 이면 체크할 수 있다.
     · 중지    가져오면 「사용 중인 약품」 집계가 흐려진다(#372 에서 위치 화면이 중지를 숨긴 것과 같은 뜻)
     · 이미있음 지금 보고 있는 위치에 이미 있다 — 옮길 곳이 같다 */
export function pickBlockedReason(d, loc) {
  if (!d) return '없음'
  if (d.status === '중지') return '중지'
  if ((d.storage_location || '') === (loc || '')) return '이미있음'
  return null
}
export function canPick(d, loc) { return pickBlockedReason(d, loc) === null }

export const BLOCK_TEXT = {
  '중지': '중지된 약품은 가져올 수 없습니다',
  '이미있음': '이미 이 위치에 있습니다',
  '없음': '가져올 수 없습니다',
}

/* 확인 창에 쓸 「지금 위치」 요약 — 많은 곳부터, 위치 없는 것은 맨 뒤.
   같은 건수면 이름순으로 묶어 같은 선택이면 같은 문장이 나오게 한다. */
export function currentLocSummary(rows) {
  const m = new Map()
  for (const d of rows || []) {
    const k = (d.storage_location || '').trim() || null
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()]
    .map(([loc, n]) => ({ loc, n }))
    .sort((a, b) => {
      if (a.loc === null) return 1
      if (b.loc === null) return -1
      return b.n - a.n || String(a.loc).localeCompare(String(b.loc), 'ko')
    })
}

export function summaryText(rows) {
  const parts = currentLocSummary(rows).map(x => (x.loc === null ? '위치 없음' : x.loc) + ' ' + x.n + '건')
  return parts.join(', ')
}

/* 구분 복수 필터.
     · null  = 전체(아무것도 거르지 않는다) — 메뉴의 「전체」가 돌려주는 값
     · 배열  = 고른 구분만. **빈 배열은 아무 줄도 안 보인다**(체크를 다 끈 상태 그대로).
   ★ 빈 배열을 전체로 접지 않는다. 다 껐는데 전부 보이면 체크가 거짓말을 하는 셈이다.
     대신 메뉴에 늘 「전체」가 있어 한 번에 되돌릴 수 있다. */
export function filterByCategory(rows, cats) {
  if (cats == null) return rows || []
  const set = new Set(cats)
  return (rows || []).filter(d => set.has(d.category || ''))
}

/* 복수 선택 토글 — 전부 켠 상태는 null(전체)로 접는다(「전체」와 같은 뜻이므로). */
export function toggleCategory(cats, v, all) {
  const list = all || []
  const cur = new Set(cats == null ? list : cats)
  if (cur.has(v)) cur.delete(v); else cur.add(v)
  if (cur.size === list.length) return null
  return list.filter(x => cur.has(x))
}

/* 메뉴에서 「켜짐」으로 보일지 — 전체(null)면 전부 켜 보인다. */
export function isCategoryOn(cats, v) { return cats == null || cats.includes(v) }
