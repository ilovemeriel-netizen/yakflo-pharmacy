/* 보관위치(location_vocab) 순서 재계산 — 화면과 분리된 순수 함수.
   - 저장은 「전체 다시 번호 매기기 + 요청 1번」이다. 인접 교환(UPDATE 2번)은 두 번째가 실패하면
     sort_order 중복을 남기는데, location_vocab.sort_order 에는 unique 제약이 없어 막아 주지 않는다.
   - 번호는 항상 1..N 이다. 음수를 쓰지 않으며(코드 원칙), 기존 번호 구멍도 함께 메워진다.
   - 바뀐 행만 돌려준다 — 보낼 게 없으면 빈 배열이고, 호출부는 요청을 생략한다.
   - 각 행은 입력 행을 그대로 펼친 뒤 sort_order 만 덮어쓴다. label·code·is_active·tenant_id·id 는 건드리지 않는다. */

export function planReorder(rows, fromIdx, toIdx) {
  const list = Array.isArray(rows) ? rows : []
  const n = list.length
  if (!n) return []
  if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx >= n) return []
  /* 범위를 벗어난 목표는 양 끝으로 당긴다 — 「맨 아래로」를 length 로 불러도 안전하게 동작한다 */
  const to = Math.max(0, Math.min(n - 1, Number.isInteger(toIdx) ? toIdx : fromIdx))
  const arr = list.slice()
  const [moved] = arr.splice(fromIdx, 1)
  arr.splice(to, 0, moved)
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const want = i + 1
    if (arr[i].sort_order !== want) out.push({ ...arr[i], sort_order: want })
  }
  return out
}
