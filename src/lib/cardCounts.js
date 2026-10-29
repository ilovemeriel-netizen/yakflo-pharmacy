/* ═══════════════════════════════════════════════════════════════════════════
   카드 숫자 ↔ 목록 규칙 — 화면 세 곳이 쓰는 **분류식만** 꺼내 둔 것.

   ★ 왜 꺼내 두는가
     2026-10-29 진단에서 세 화면 모두 「카드 숫자」와 「그 카드를 눌렀을 때의 목록」이
     서로 다른 배열에서 만들어지고 있었다. 가장 심한 유효기한 향정마약 카드는
     위쪽 상태 칩을 아예 무시해, 「사용」만 골라도 중지 향정이 계속 보였다.
     식이 App.jsx 안에 한 줄로 묻혀 있으면 같은 어긋남을 또 만들기 쉽다.
     여기 꺼내 두고 cardCounts.test.js 가 **숫자 = 줄 수**를 못 박는다.

   ★ 이 파일은 **판정식만** 담는다 — 화면·상태·훅을 모르고, 순수 함수뿐이다.
     App.jsx 는 지금 이 식을 인라인으로 갖고 있고, 시험이 두 쪽을 대조한다
     (lib/surveyRules.js ↔ 쌍둥이와 같은 방식).
   ═══════════════════════════════════════════════════════════════════════════ */

/* 향정·마약 판정 — App.jsx 의 isN 과 같다 */
export function isNarcotic(d) {
  return !!d.is_narcotic || d.narcotic_type === '향정' || d.narcotic_type === '마약'
}

/* 남은 일수 — App.jsx 의 exD 와 같은 규칙(오늘 00:00 기준 일수) */
export function remainDays(ymd, today) {
  if (!ymd) return null
  const t = today instanceof Date ? today : new Date(today)
  return Math.floor((new Date(ymd + 'T00:00:00Z') - t) / 864e5)
}

/* ── 유효기한 화면 ─────────────────────────────────────────────────────────
   ★ 다섯 카드 **모두** fd(구분·상태 칩을 거친 배열)에서 만든다.
   ★ 향정 카드에는 current_qty>0 을 넣지 않는다(사용자 결정 2026-10-29) —
     재고 0 향정도 칩 조건에 맞으면 보여야 한다. */
export function expiryChipFilter(drugs, cats, stats) {
  return drugs.filter(d => cats.includes(d.category) && stats.includes(d.status))
}

export function expiryGroups(drugs, cats, stats, today, isUnused) {
  const fd = expiryChipFilter(drugs, cats, stats)
  const qty = d => (d.current_qty || 0) > 0
  const r = d => remainDays(d.expiry_date, today)
  return {
    urgent: fd.filter(d => { const x = r(d); return x !== null && x <= 30 && qty(d) }),
    warning: fd.filter(d => { const x = r(d); return x !== null && x > 30 && x <= 90 && qty(d) }),
    notice: fd.filter(d => { const x = r(d); return x !== null && x > 90 && x <= 180 && qty(d) }),
    narcotic: fd.filter(d => { const x = r(d); return x !== null && x <= 180 && isNarcotic(d) }),
    unused: fd.filter(d => isUnused(d) && qty(d)),
  }
}

/* ── 재고현황 ──────────────────────────────────────────────────────────────
   카드 숫자의 기준 = 목록 조건에서 **카드 선택(filter)만 뺀 것**. */
export function stockBasis(merged, cats, search) {
  const q = String(search || '').trim().toLowerCase()
  return merged.filter(d => {
    if (!cats.includes(d.category)) return false
    if (q) return (d.drug_name || '').toLowerCase().includes(q) || (d.drug_code || '').toLowerCase().includes(q)
    return true
  })
}

export const STOCK_CARDS = ['전체', '긴급', '주문필요', '재고없음', '정상', '과잉', '기준미설정']

export function stockCounts(basis) {
  const out = { 전체: basis.length }
  for (const k of STOCK_CARDS.slice(1)) out[k] = basis.filter(d => d.stockStatus === k).length
  return out
}

export function stockList(basis, filter) {
  return basis.filter(d => filter === '전체' || d.stockStatus === filter)
}

/* ── 향정마약 화면 ─────────────────────────────────────────────────────────
   카드 숫자의 기준 = 목록 조건에서 **카드 선택(cardF)만 뺀 것**. */
export const NARC_CARDS = ['전체', '향정', '마약', '유효기한 주의']

/* getNT 는 화면에서 주입한다 — 한외마약 등 분류 규칙이 App.jsx 에 있다 */
export function narcCardMatch(d, cardF, getNT, today) {
  if (cardF === '향정') return getNT(d) === '향정'
  if (cardF === '마약') return getNT(d) === '마약'
  if (cardF === '유효기한 주의') { const x = remainDays(d.expiry_date, today); return x !== null && x <= 180 }
  return true
}

export function narcCounts(basis, getNT, today) {
  const out = { 전체: basis.length }
  for (const k of NARC_CARDS.slice(1)) out[k] = basis.filter(d => narcCardMatch(d, k, getNT, today)).length
  return out
}

export function narcList(basis, cardF, getNT, today) {
  return basis.filter(d => narcCardMatch(d, cardF, getNT, today))
}
