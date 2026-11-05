/* 쪽 나눠 끝까지 읽기 — PostgREST 의 **1,000줄 조용한 절단**을 막는다.

   ★ 왜 — `supabase.from(..).select(..)` 는 한 번에 최대 1,000줄만 준다. 넘치면
     **오류 없이 잘린다**(`error: null`). 그래서 합계가 조용히 틀린다.
     2026-11-05: 마약·향정 적용 창이 거래 1,079줄 가운데 1,000줄만 받아
     졸피드정 63이 사라졌고, 발주관리 금액 막대는 스냅샷 11,014줄 중 1,000줄만 받아
     2026-07 이 32,002,763원 대신 4,234,525원으로 보였다.

   ★ 쓰는 법 — **매번 새 질의를 만드는 함수**를 넘긴다(질의 객체는 한 번만 쓸 수 있다).
     그리고 **반드시 `.order(..)` 를 붙인다** — 순서가 없으면 쪽마다 같은 줄이 겹치거나
     빠질 수 있다.

       const { data, error } = await selectAll(() =>
         supabase.from('monthly_snapshots').select('snap_year,snap_month')
           .order('id', { ascending: true }))

   ★ 돌려주는 것 — `{ data, error }`. 한 쪽이라도 실패하면 `data: null` 과 그 오류를 준다.
     **부분만 돌려주지 않는다** — 반쪽 합계가 맞는 합계처럼 보이면 그게 제일 위험하다. */

export const PAGE_SIZE = 1000

/* 너무 많으면 멈춘다 — 끝없이 도는 것보다 오류로 알리는 쪽이 안전하다. */
export const MAX_PAGES = 300

export async function selectAll(build, opts) {
  const size = (opts && opts.pageSize) || PAGE_SIZE
  const maxPages = (opts && opts.maxPages) || MAX_PAGES
  if (typeof build !== 'function') {
    return { data: null, error: new Error('selectAll: 질의를 만드는 함수를 넘겨야 합니다') }
  }
  const out = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * size
    const { data, error } = await build().range(from, from + size - 1)
    if (error) return { data: null, error }
    const rows = data || []
    for (const r of rows) out.push(r)
    /* 받은 줄이 한 쪽보다 적으면 끝이다 */
    if (rows.length < size) return { data: out, error: null }
  }
  return {
    data: null,
    error: new Error('selectAll: ' + (maxPages * size).toLocaleString()
      + '줄을 넘었습니다 — 조건을 좁히거나 한도를 올려 주세요'),
  }
}
