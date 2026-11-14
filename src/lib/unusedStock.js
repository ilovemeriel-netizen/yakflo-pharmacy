/* 「미사용」 판정 — 직전 몇 개월 동안 **약플로 출고가 한 건도 없는 약** (2026-11-13 이정화 님 확정)
 *
 * ★★ 업무 규칙 (이정화 님 확정)
 *   「직전 3개월 실제 출고 0이면 **이유와 상관없이** 발주·긴급 대상이 아니다.
 *    소량 보유 중이므로 추가 발주 불필요, 반품 검토 대상이다.」
 *   · 비상 보유 약·계절 약 **예외 없음**
 *   · 새 약도 전년값을 쓰지 않는다
 *   · 기준 기간은 **2026-07 부터** — 약플로에 직접 입력하기 시작한 달이다.
 *     1~6월 마감표는 **엑셀 최종값만 넣은 것**이라 판정에 쓰지 않는다.
 *
 * ★ 무엇을 **안 바꾸나** — 이게 이 파일의 핵심이다.
 *   · DB 값(안전재고·전년사용량·월평균·최대재고)을 **하나도 바꾸지 않는다.** 화면 판정만 바뀐다.
 *   · 약품 상태(status)도 안 바꾼다 → **유효기한 알림·향정 인쇄에 그대로 남는다.**
 *   · 마감 스냅샷에는 안전재고·월평균·재고상태 칸이 아예 없다 → **과거 금액과 무관하다.**
 *
 * ★ 왜 「저장된 recent_3m_usage」를 안 쓰고 마감표를 읽나
 *   저장값은 수기로 넣은 묵은 값일 수 있다. 2026-11-13 실측으로 **25종**이
 *   「약플로 출고 기록 0건인데 저장된 3개월 > 0」이었다. 판정은 **실제 출고**로 한다.
 */

/* ★ 화면에 적는 상태 글자 — **여기 한 곳**에서 정한다(2026-11-14 이정화 님 지시로 이름을 바꿨다).
     옛 이름 「미사용」은 「안 쓰는 약」으로 읽혀 **왜 그렇게 판정했는지**가 안 보였다.
     「3개월 사용량 0」은 **셈한 근거를 그대로** 말한다. */
export const UNUSED_LABEL = '3개월 사용량 0'

/* 약플로에 출고를 직접 입력하기 시작한 달 — 이 앞은 판정에 쓰지 않는다 */
export const UNUSED_FROM = { y: 2026, m: 7 }

/* 들인 지 얼마 안 된 약을 가르는 잣대 — 창 안에 마감 줄이 이보다 적으면 판정에서 뺀다.
   ★ 3개월이 찰 수 없는 약을 「안 쓰는 약」으로 보면 **새 약이 억울하게 묻힌다.** */
export const UNUSED_MIN_SNAPS = 3

/* 단계 — 작은 것부터. n 은 창의 개월 수다. */
export const UNUSED_TIERS = [
  { key: '3개월', n: 3 },
  { key: '6개월', n: 6 },
  { key: '1년', n: 12 },
]

const N = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))
export const monthKey = (y, m) => String(y) + '-' + String(m).padStart(2, '0')
/* 약품코드 맞대기 — 거래·마감표가 대소문자·공백이 섞여 들어온다 */
export const normCode = c => String(c == null ? '' : c).trim().toUpperCase()

/* 그 달에서 거꾸로 n개월 — [{y,m}] (가장 최근이 앞) */
export function monthsBack(y, m, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
  }
  return out
}

/* 기준 시작월부터 그 마감월까지 **몇 개월이 쌓였나** (그 달 포함) */
export function recordedMonths(latest) {
  if (!latest || !latest.y || !latest.m) return 0
  const n = (latest.y - UNUSED_FROM.y) * 12 + (latest.m - UNUSED_FROM.m) + 1
  return n > 0 ? n : 0
}

/* 그 단계를 쓸 수 있나 — 기록이 창을 다 덮어야 한다.
   ★ 2026-10 마감 기준: 4개월 쌓임 → 3개월 ✅ · 6개월 ❌ · 1년 ❌
     6개월은 2026-12 마감 뒤, 1년은 2027-06 마감 뒤에 열린다. */
export function tierReady(latest, n) {
  return recordedMonths(latest) >= n
}
export function readyTiers(latest) {
  return UNUSED_TIERS.filter(t => tierReady(latest, t.n))
}

/* 마감표 줄들을 약품코드별로 접는다.
   snapRows = [{ drug_code, snap_year, snap_month, total_out_qty }]
   돌려주는 것 — Map(code → { out, snaps })  out=그 창의 출고 합 · snaps=그 창의 마감 줄 수 */
export function foldSnapshots(snapRows, months) {
  const want = new Set((months || []).map(x => monthKey(x.y, x.m)))
  const map = new Map()
  for (const r of snapRows || []) {
    if (!want.has(monthKey(r.snap_year, r.snap_month))) continue
    const c = normCode(r.drug_code)
    if (!c) continue
    const cur = map.get(c) || { out: 0, snaps: 0 }
    cur.out += N(r.total_out_qty)
    cur.snaps += 1
    map.set(c, cur)
  }
  return map
}

/* 약품 줄에 판정 재료를 붙인다 — **원본 배열을 건드리지 않는다**(새 배열을 돌려준다).
   __unusedOut  그 창의 실제 출고 합
   __unusedThin 들인 지 얼마 안 돼 판정에서 뺄 약인가 */
export function attachUnused(drugs, map) {
  return (drugs || []).map(d => {
    const hit = map && map.get(normCode(d && d.drug_code))
    return {
      ...d,
      __unusedOut: hit ? hit.out : 0,
      __unusedThin: !hit || hit.snaps < UNUSED_MIN_SNAPS,
    }
  })
}

/* 「미사용」인가 — 판정식이 쓰는 한 줄.
   ★ 재료가 아직 안 붙었으면(__unusedOut 이 없음) **판정하지 않는다** — 섣불리 미사용으로 몰지 않는다.
   ★ 현재고 0 은 「재고없음」으로 남긴다(2026-11-13 결정 ④) — 여기서 걸러 준다. */
export function isUnused(d) {
  if (!d || d.__unusedOut == null) return false
  if (d.__unusedThin) return false
  if (N(d.current_qty) <= 0) return false
  return N(d.__unusedOut) === 0
}

/* 재고금액 — 구입단가 기준(CLAUDE.md 철칙). 통당단가(price_unit)를 쓰지 않는다. */
export function stockAmount(d) {
  return N(d && d.current_qty) * N(d && d.purchase_price)
}
/* 과잉인가 — 재고현황과 **같은 식**이다 */
export function isOverStock(d) {
  const mx = N(d && d.max_stock)
  return mx > 0 && N(d && d.current_qty) > mx
}
/* 미사용 목록 — 재고금액 큰 순(기본) 또는 이름 순. **원본을 건드리지 않는다.** */
export function sortUnused(list, byAmount) {
  const a = [...(list || [])]
  if (byAmount) return a.sort((x, y) => stockAmount(y) - stockAmount(x))
  return a.sort((x, y) => String(x.drug_name || '').localeCompare(String(y.drug_name || ''), 'ko'))
}
