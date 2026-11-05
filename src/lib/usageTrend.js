/* 발주관리 「사용량 분석」 막대 — 달별 수량·금액.

   ★ 수량과 금액은 **같은 개월 수**로 받아야 한다. 어긋나면 막대가 서로 다른 달을 가리킨다.
   ★ 금액은 2026-11-05 까지 스냅샷을 **줄 단위로 전부 받아** 브라우저에서 더했다.
     11,014줄이 1,000줄로 조용히 잘려 대부분의 달이 0원으로 보였다.
     지금은 DB 함수 `usage_monthly_amount(p_months)` 가 **달별로 합쳐서** 준다. */

export const TREND_MONTHS = 6

/* RPC 가 준 [{ ym, out_amount }] 를 { 'YYYY-MM': 금액 } 으로 바꾼다.
   ★ 반올림하지 않는다 — 화면이 보여 줄 때만 반올림한다(금액 규칙). */
export function amountMap(rows) {
  const out = {}
  for (const r of rows || []) {
    const ym = r && r.ym != null ? String(r.ym) : ''
    if (!ym) continue
    out[ym] = (out[ym] || 0) + Number(r.out_amount || 0)
  }
  return out
}
