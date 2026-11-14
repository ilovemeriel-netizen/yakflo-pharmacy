/* 「사용량 0」 판정 — 직전 몇 개월 동안 **약플로 출고가 한 건도 없는 약**
 * (2026-11-13 확정 · 2026-11-14 단계 3/6/9/12개월로 넓힘 — 이정화 님 결정)
 *
 * ★★ 업무 규칙
 *   「직전 3개월 실제 출고 0이면 **이유와 상관없이** 발주·긴급 대상이 아니다.
 *    소량 보유 중이므로 추가 발주 불필요, 반품 검토 대상이다.」
 *   · 비상 보유 약·계절 약 **예외 없음** · 새 약도 전년값을 쓰지 않는다
 *
 * ★ 단계 (2026-11-14 결정)
 *   · 창은 **최신 마감월에서 거꾸로** n개월. 3 / 6 / 9 / 12.
 *   · **가장 높은 단계 하나만** 준다 (12 → 9 → 6 → 3 순으로 보고 처음 걸리는 것).
 *   · ★ 그 창에 **마감 줄이 n개 모두 있을 때만** 그 단계를 준다.
 *     안 그러면 들인 지 한 달밖에 안 된 약이 합계 0 이라는 이유로 「9개월 사용량 0」이 된다
 *     (2026-11-14 실측 — 줄 수를 안 보면 13종이 엉뚱한 단계로 갔다).
 *   · 12개월은 2026-12 마감이 차면 **저절로** 열린다. 그때 글자는 「코드 중지 검토」다.
 *     ★ 중지는 **사람이** 한다. 재고가 0 이 된 뒤에 직접 바꾼다 —
 *       상태를 「중지」로 바꾸면 **유효기한 알림에서 빠지기** 때문이다(App.jsx 의 알림 목록이
 *       status!=='중지' 로 거른다). 재고가 남은 채 중지하면 유효기한을 놓친다.
 *
 * ★ 무엇을 **안 바꾸나**
 *   · DB 값(안전재고·전년사용량·월평균·최대재고)을 **하나도 바꾸지 않는다.** 화면 판정만 바뀐다.
 *   · 약품 상태(status)도 안 바꾼다 → 유효기한 알림·향정 인쇄에 그대로 남는다.
 *   · 마감 스냅샷에는 안전재고·월평균·재고상태 칸이 아예 없다 → 과거 금액과 무관하다.
 *
 * ★ 왜 저장된 recent_3m_usage 를 안 쓰고 마감표를 읽나
 *   저장값은 수기로 넣은 묵은 값일 수 있다(2026-11-13 실측 25종). 판정은 **실제 출고**로 한다.
 */

/* 단계 — 작은 것부터. n 은 창의 개월 수다. */
export const UNUSED_TIERS = [
  { key: '3개월', n: 3 },
  { key: '6개월', n: 6 },
  { key: '9개월', n: 9 },
  { key: '12개월', n: 12 },
]
export const TIER_NS = UNUSED_TIERS.map(t => t.n)

/* 가장 낮은 단계의 창이 시작하는 달 — 마감표에 이 달 앞 줄이 없으면 그 단계를 못 쓴다 */
export const UNUSED_FROM = { y: 2026, m: 1 }
/* 12개월 단계만 글자가 다르다 — 「코드 중지 검토」 */
export const STOP_TIER_N = 12
export const STOP_SUFFIX = '코드 중지 검토'
/* 재고현황 카드에 적는 이름 — 단계를 모두 아우른다 */
export const UNUSED_CARD = '3개월 이상 사용량 0'
/* 들인 지 얼마 안 된 약을 가르는 잣대 — 가장 낮은 단계의 창 길이 */
export const UNUSED_MIN_SNAPS = 3

const N = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))
export const monthKey = (y, m) => String(y) + '-' + String(m).padStart(2, '0')
export const normCode = c => String(c == null ? '' : c).trim().toUpperCase()

/* 상태 칸에 적는 글자 — **여기 한 곳**에서 정한다 */
export function tierLabel(n) { return String(n) + '개월 사용량 0' }
export const TIER_LABELS = TIER_NS.map(tierLabel)
export function isUnusedLabel(s) { return TIER_LABELS.indexOf(s) >= 0 }
export function tierByKey(key) { const t = UNUSED_TIERS.find(x => x.key === key); return t ? t.n : null }

/* 그 달에서 거꾸로 n개월 — [{y,m}] (가장 최근이 앞) */
export function monthsBack(y, m, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
  }
  return out
}

/* 기준 시작월부터 그 마감월까지 몇 개월이 쌓였나 (그 달 포함) */
export function recordedMonths(latest) {
  if (!latest || !latest.y || !latest.m) return 0
  const n = (latest.y - UNUSED_FROM.y) * 12 + (latest.m - UNUSED_FROM.m) + 1
  return n > 0 ? n : 0
}
/* 그 단계를 화면에 쓸 수 있나 — 기록이 창을 다 덮어야 한다 */
export function tierReady(latest, n) { return recordedMonths(latest) >= n }
export function readyTiers(latest) { return UNUSED_TIERS.filter(t => tierReady(latest, t.n)) }

/* 마감표 줄들을 약품코드별로 접는다 — 창마다 따로 센다.
   돌려주는 것 — Map(code → { out: {3,6,9,12}, snaps: {3,6,9,12} }) */
export function foldSnapshots(snapRows, winByN) {
  const want = {}
  for (const n of TIER_NS) want[n] = new Set((winByN[n] || []).map(x => monthKey(x.y, x.m)))
  const map = new Map()
  for (const r of snapRows || []) {
    const c = normCode(r.drug_code)
    if (!c) continue
    const k = monthKey(r.snap_year, r.snap_month)
    let cur = map.get(c)
    if (!cur) { cur = { out: {}, snaps: {} }; for (const n of TIER_NS) { cur.out[n] = 0; cur.snaps[n] = 0 }; map.set(c, cur) }
    for (const n of TIER_NS) if (want[n].has(k)) { cur.out[n] += N(r.total_out_qty); cur.snaps[n] += 1 }
  }
  return map
}

/* 약품 줄에 판정 재료를 붙인다 — **원본 배열을 건드리지 않는다**(새 배열을 돌려준다). */
export function attachUnused(drugs, map) {
  return (drugs || []).map(d => {
    const hit = map && map.get(normCode(d && d.drug_code))
    return { ...d, __unusedOut: hit ? hit.out : null, __unusedSnaps: hit ? hit.snaps : null }
  })
}

/* 이 약의 단계 — 가장 높은 것 하나. 못 주면 null.
   ★ 재료가 아직 안 붙었으면 판정하지 않는다 — 섣불리 몰지 않는다.
   ★ 현재고 0 은 「재고없음」으로 남긴다. */
export function tierOf(d) {
  if (!d || !d.__unusedOut || !d.__unusedSnaps) return null
  if (N(d.current_qty) <= 0) return null
  for (let i = TIER_NS.length - 1; i >= 0; i--) {
    const n = TIER_NS[i]
    if (N(d.__unusedSnaps[n]) >= n && N(d.__unusedOut[n]) === 0) return n
  }
  return null
}
export function isUnused(d) { return tierOf(d) != null }

/* 재고금액 — 구입단가 기준(CLAUDE.md 철칙). 통당단가(price_unit)를 쓰지 않는다. */
export function stockAmount(d) { return N(d && d.current_qty) * N(d && d.purchase_price) }
/* 과잉인가 — 재고현황과 **같은 식**이다 */
export function isOverStock(d) { const mx = N(d && d.max_stock); return mx > 0 && N(d && d.current_qty) > mx }
/* 목록 — 재고금액 큰 순(기본) 또는 이름 순. **원본을 건드리지 않는다.** */
export function sortUnused(list, byAmount) {
  const a = [...(list || [])]
  if (byAmount) return a.sort((x, y) => stockAmount(y) - stockAmount(x))
  return a.sort((x, y) => String(x.drug_name || '').localeCompare(String(y.drug_name || ''), 'ko'))
}
