/* 약플로 · Supabase 목록 읽기의 **조용한 절단**을 잡아내는 도우미 (2026-11-05)

   ★ 왜 필요한가 — 실제로 숫자가 틀렸던 일
     `supabase.from(...).select(...)` 는 **기본 1,000줄**만 돌려준다.
     넘치면 **오류도 경고도 없다** — `error` 는 `null` 이고 `data` 만 조용히 짧다.
     합계를 내는 화면은 **틀린 숫자를 멀쩡한 얼굴로** 보여 준다.

     2026-11-05 마약·향정 적용 창에서 그 일이 났다. 3개월 창 출고가 1,079건이라
     79건이 잘리고, 그 안에 졸피드정10mg 2026-10-31 출고 **63**이 있었다.
       화면 1개월 644 · 3개월 2,237   ← 잘린 값
       진실 1개월 707 · 3개월 2,300   ← 옳은 값
     DB 도 거래도 멀쩡했다. **화면이 못 받은 것**이었다.

     더 고약한 점: 적용 단추는 DB 함수가 SQL 로 직접 세므로 **옳은 값이 저장된다.**
     즉 「보여 준 값과 저장되는 값이 다른」 상태였다.

   ★ 어떻게 잡나 — 줄 수를 1,000 으로 박지 않는다.
     `{ count: 'exact' }` 로 **진짜 전체 줄 수**를 함께 받아, 받은 줄과 비교한다.
     서버 한도가 바뀌어도 이 판정은 그대로 맞는다. 몇 줄이 빠졌는지도 말해 줄 수 있다.

   ★ 이 파일은 **읽기만** 돕는다. DB 에 쓰지 않는다. */

/* PostgREST 가 한 번에 주는 기본 최대 줄 수. 판정에 쓰지 않는다 — **설명과 시험용**이다.
   (판정은 count 비교로 한다. 여기에 의존하면 서버 설정이 바뀔 때 또 조용히 틀린다.) */
export const SUPABASE_DEFAULT_MAX_ROWS = 1000

/* 받은 목록이 잘렸는지 판정한다.
     rows  = 받은 배열
     count = `{ count: 'exact' }` 가 준 전체 줄 수 (없으면 null)
   돌려주는 것 { cut, got, total, missing, message }
     cut     = 잘렸나
     missing = 못 받은 줄 수 (알 수 없으면 null)
     message = 화면에 그대로 띄울 한 줄 (잘리지 않았으면 '')

   ★ count 를 못 받았을 때도 손을 놓지 않는다 — 받은 줄이 한도와 **딱 같으면** 의심한다.
     1,000줄이 정확히 들어맞는 일은 드물고, 틀린 합계를 조용히 보여 주는 쪽이 훨씬 나쁘다. */
export function checkRowLimit(rows, count, limit = SUPABASE_DEFAULT_MAX_ROWS) {
  const got = Array.isArray(rows) ? rows.length : 0
  const total = Number.isFinite(count) && count != null ? Number(count) : null
  if (total != null) {
    const missing = total - got
    if (missing > 0) {
      return {
        cut: true, got, total, missing,
        message: '거래를 다 읽지 못했습니다 — ' + total.toLocaleString() + '건 가운데 '
          + got.toLocaleString() + '건만 받았습니다(' + missing.toLocaleString()
          + '건 빠짐). 아래 숫자는 틀렸을 수 있으니 적용하지 마시고 알려 주세요.',
      }
    }
    return { cut: false, got, total, missing: 0, message: '' }
  }
  /* 전체 줄 수를 모를 때 — 한도에 딱 닿았으면 잘렸다고 본다 */
  if (got >= limit) {
    return {
      cut: true, got, total: null, missing: null,
      message: '거래를 다 읽지 못했을 수 있습니다 — 한 번에 받을 수 있는 '
        + limit.toLocaleString() + '건을 꽉 채워 받았습니다. 아래 숫자는 틀렸을 수 있으니 '
        + '적용하지 마시고 알려 주세요.',
    }
  }
  return { cut: false, got, total: null, missing: null, message: '' }
}
