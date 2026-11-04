/* B-1 — 마약·향정 사용량을 **달력 기준으로 계산해 보여 주기만** 한다. 순수 함수만.
   ★ **DB 에 쓰지 않는다.** 숫자를 먼저 보고 나서 적용(B-2)을 고르기 위한 표다.

   ★ 왜 달력 기준인가 (2026-11-04 이정화 님 결정 2)
     지금 `app_recompute_usage` 는 `current_date - interval '1 month'` 를 쓴다 — 「오늘부터 30일」이라
     **하루만 지나도 답이 달라진다.** 2026-11-04 에 돌리면 창이 10-03~11-03 이라 10-31 출고는 들어오고
     09-30 출고는 빠진다. 월마감은 달력으로 끊으므로 사용량도 달력으로 끊어야 짝이 맞는다.

   ★ 계산식은 **새로 만들지 않는다** — App.jsx·0108·usageParse 가 쓰는 식 그대로다.
       월평균 = 3개월이 있으면 round(3개월 / 3), 없으면 round(전년 / 12)
       안전재고 = ceil(월평균 × 1.2)   ·   최대재고 = round(월평균 × 3)

   ★ 범위는 `narcotic_type in ('마약','향정')` 뿐이다 — 한외마약은 뺀다(확정 업무 규칙 9).
     판정은 usageParse 의 `isNarcSkip` **하나**를 쓴다. 두 곳에 적으면 답이 갈린다. */
/* ★ 확장자를 붙인다 — 그래야 dryrun 스크립트가 **화면과 같은 이 파일**을 그대로 불러
   DB 결과와 맞대 볼 수 있다(Node 는 확장자 없는 경로를 못 푼다).
   저장소에 두 표기가 다 있다(surveyCalc.js·pwaUpdate.js 도 확장자를 쓴다). */
import { isNarcSkip, normCode, SAFETY_FACTOR, MAX_FACTOR } from './usageParse.js'

const N = v => Number(v || 0)

/* 달력 창 — [그달 1일, 다음달 1일) · [그달−2개월 1일, 다음달 1일)
   ★ 날짜를 Date 로 만들어 toISOString().slice() 하지 않는다 — UTC 로 바뀌며 **하루 밀린다**
     (10-01 이 09-30 으로 보인다). 글자를 직접 만든다(함정 #32 와 같은 갈래). */
const p2 = n => String(n).padStart(2, '0')
export function calendarWindow(year, month) {
  const y3 = month - 2 <= 0 ? year - 1 : year
  const m3 = month - 2 <= 0 ? month + 10 : month - 2
  const yN = month === 12 ? year + 1 : year
  const mN = month === 12 ? 1 : month + 1
  return {
    m1From: `${year}-${p2(month)}-01`,
    m3From: `${y3}-${p2(m3)}-01`,
    toExclusive: `${yN}-${p2(mN)}-01`,          /* 이 날은 **포함하지 않는다** */
  }
}
/* 사람이 읽을 말 — 「2026-10-01 ~ 2026-10-31」 */
export function windowLabel(year, month) {
  const w = calendarWindow(year, month)
  const last = new Date(Date.UTC(
    Number(w.toExclusive.slice(0, 4)), Number(w.toExclusive.slice(5, 7)) - 1, 0))
  const end = `${last.getUTCFullYear()}-${p2(last.getUTCMonth() + 1)}-${p2(last.getUTCDate())}`
  return { m1: `${w.m1From} ~ ${end}`, m3: `${w.m3From} ~ ${end}` }
}

/* 거래에서 달력 창 출고 합을 센다. txns = [{drug_code, type, transaction_date, quantity}] */
export function sumOutgoing(txns, year, month) {
  const w = calendarWindow(year, month)
  const out = new Map()
  for (const t of (txns || [])) {
    if (t.type !== '출고') continue
    const d = String(t.transaction_date || '').slice(0, 10)   /* 문자열 날짜만 다룬다 */
    if (!d || d >= w.toExclusive) continue
    const code = normCode(t.drug_code)
    const cur = out.get(code) || { m1: 0, m3: 0 }
    if (d >= w.m3From) cur.m3 += N(t.quantity)
    if (d >= w.m1From) cur.m1 += N(t.quantity)
    out.set(code, cur)
  }
  return out
}

/* 계산식 — 기존 것 그대로 */
export function deriveStock(recent3m, prevYear) {
  const ma = N(recent3m) > 0 ? Math.round(N(recent3m) / 3)
    : (N(prevYear) > 0 ? Math.round(N(prevYear) / 12) : null)
  if (ma == null) return { ma: null, safety: null, max: null }
  return { ma, safety: Math.ceil(ma * SAFETY_FACTOR), max: Math.round(ma * MAX_FACTOR) }
}

/* 표 한 장 — 마약·향정만. 돌려주는 것 { year, month, label, rows, moved, mixed, totals } */
export function buildNarcoticPreview(drugs, txns, year, month) {
  const sums = sumOutgoing(txns, year, month)
  const rows = []
  for (const d of (drugs || [])) {
    if (!isNarcSkip(d)) continue
    const code = normCode(d.drug_code)
    const s = sums.get(code) || { m1: 0, m3: 0 }
    const py = N(d.prev_year_usage)
    const next = deriveStock(s.m3, py)
    const now = {
      m1: N(d.recent_1m_usage), m3: N(d.recent_3m_usage),
      ma: N(d.monthly_avg), safety: N(d.safety_stock), max: N(d.max_stock),
    }
    const moved = now.m1 !== s.m1 || now.m3 !== s.m3
      || (next.ma != null && (now.ma !== next.ma || now.safety !== next.safety || now.max !== next.max))
    rows.push({
      code, name: d.drug_name || code, status: d.status || '', nt: d.narcotic_type || '',
      qty: N(d.current_qty), prevYear: py,
      m1Before: now.m1, m1After: s.m1,
      m3Before: now.m3, m3After: s.m3,
      maBefore: now.ma, maAfter: next.ma,
      safetyBefore: now.safety, safetyAfter: next.safety,
      maxBefore: now.max, maxAfter: next.max,
      moved,
      /* ★ 3개월 출고가 0 인데 전년 쓰임이 있다 → 월평균이 「전년 ÷ 12」로 잡힌다.
         1·3개월은 NIMS(출고) 잣대인데 월평균만 원내(전년) 잣대라 **잣대가 섞인다.**
         2026-11-04 이정화 님 요청으로 따로 보여 준다(마이폴·뉴신타·타진·센틸). */
      mixed: N(s.m3) === 0 && py > 0,
      /* 지금 값이 있는데 새 값이 0 이면 **값을 잃는다** — 미리 드러내야 한다 */
      lost: (now.m1 > 0 && s.m1 === 0) || (now.m3 > 0 && s.m3 === 0),
    })
  }
  rows.sort((a, b) => {
    if ((a.status === '사용') !== (b.status === '사용')) return a.status === '사용' ? -1 : 1
    return Math.abs(b.maxAfter - b.maxBefore) - Math.abs(a.maxAfter - a.maxBefore)
  })
  const add = f => rows.reduce((s, r) => s + N(r[f]), 0)
  return {
    year, month, label: windowLabel(year, month), rows,
    moved: rows.filter(r => r.moved),
    mixed: rows.filter(r => r.mixed),
    lost: rows.filter(r => r.lost),
    totals: {
      m1Before: add('m1Before'), m1After: add('m1After'),
      m3Before: add('m3Before'), m3After: add('m3After'),
      safetyBefore: add('safetyBefore'), safetyAfter: add('safetyAfter'),
      maxBefore: add('maxBefore'), maxAfter: add('maxAfter'),
    },
  }
}
