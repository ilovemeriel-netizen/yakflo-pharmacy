/* ═══════════════════════════════════════════════════════════════════════════
   공개 조회 화면 — 표시 상태 판정 (React 없는 순수 함수)

   ★ 왜 분리했나 — 「응답을 받았는지」와 「받았는데 비었는지」를 섞으면
     로그인 직후 1~2초 동안 "공개 중인 백신이 없습니다"·"입력 기록이 없습니다" 가
     사실과 다르게 보인다(2026-10-27 개선 건). 그 판정만 떼어 단위 시험한다.

   ★ 세 가지 상태만 있다
       'loading' — 아직 응답이 없다(items === null).  "불러오는 중..." 만 보인다.
       'empty'   — 응답을 받았고 목록이 진짜 비었다.  "공개 중인 백신이 없습니다".
       'list'    — 목록이 있다.                      카드와 합계를 그린다.

   ★ 숫자가 한 번 그려진 뒤에는 **다시 'loading' 으로 돌아가지 않는다**.
     60초 자동 갱신이 돌 때 화면이 깜빡이지 않게 하려는 것이고,
     그래서 viewState 는 items 가 있으면 loading 인자를 무시한다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 응답 본문에서 items 를 꺼낸다. 아직 응답이 없거나 형식이 다르면 null — 「모른다」는 뜻이다.
   ★ null 과 [] 를 구별하는 것이 이 모듈의 핵심이다. [] 는 「없다」로 단정해도 되는 값이다. */
export function itemsOf(data) {
  if (!data || !Array.isArray(data.items)) return null
  return data.items
}

/* loading — 호출부가 켠 「새로고침 중」 표시. 목록이 이미 있으면 영향을 주지 않는다. */
export function viewState(data, loading = false) {
  const items = itemsOf(data)
  if (items === null) return 'loading'
  if (items.length) return 'list'          /* ★ loading 이어도 list — 갱신 중 깜빡임 방지 */
  return loading ? 'loading' : 'empty'
}

/* 전체 잔량 합계. 응답이 없으면 0 이지만, 화면은 'loading' 일 때 이 값을 쓰지 않는다. */
export function totalOf(data) {
  const items = itemsOf(data)
  if (!items) return 0
  return items.reduce((s, x) => s + Number(x?.qty || 0), 0)
}
