/* usageCompare.js — 직전3개월·직전1개월을 **마감된 달 기준으로 계산해 견주기만** 한다.
 *
 * ★ **DB 에 쓰지 않는다.** 숫자를 먼저 보고 「적용」을 누를 때만 저장한다.
 *   저장은 화면(UsageCompareModal)이 기존 함수 `app_save_usage_bulk` 하나로 한 번에 한다.
 *
 * ★ 왜 달력 기준인가 (2026-11-09 이정화 님 결정)
 *   지금 `app_recompute_usage` 는 `current_date - interval '3 months'` 를 쓴다 —
 *   「오늘부터 90일」이라 **하루만 지나도 답이 달라진다.** 월마감은 달력으로 끊으므로
 *   사용량도 달력으로 끊어야 짝이 맞는다. 기준월은 **가장 최근에 마감된 달**이다.
 *
 * ★ 계산식은 **새로 만들지 않는다** — App.jsx·0108·usageParse 가 쓰는 식 그대로다.
 *     월평균  = 3개월이 있으면 round(3개월 / 3), 없으면 round(전년 / 12)
 *     안전재고 = ceil(월평균 × 1.2)   ·   최대재고 = round(월평균 × 3)
 *   전년 사용량은 **건드리지 않는다**(수기 유지 — 2026-11-09 결정).
 *
 * ★ 세는 거래는 `출고` 하나뿐이다. 반품·폐기·조정·입고는 세지 않는다.
 *   (2026-11-09 실측 — 반품·폐기를 빼면 에큐민정 46 − 1,374 = −1,328 처럼 음수가 된다.)
 *
 * ★ 확장자를 붙여 import 한다 — dryrun 스크립트가 **화면과 같은 이 파일**을 그대로 불러
 *   DB 결과와 맞대 볼 수 있어야 한다(narcoticUsagePreview.js 와 같은 방식).
 */
import { normCode, SAFETY_FACTOR, MAX_FACTOR } from './usageParse.js'

const N = v => Number(v || 0)

/* ── 재고 상태 — App.jsx 의 `stockStat` 과 **같은 식**이다 ──────────────────
   ★ App.jsx 에서 export 하면 react-refresh 규칙에 걸려 lint 가 늘어난다.
     그래서 같은 값을 여기 적어 두고, 시험(usageCompare.test.js)이 App.jsx 소스와
     글자로 대조한다 — 한쪽만 바뀌면 시험이 먼저 깨진다(errorText.js 와 같은 방식). */
export const LEAD_TIME = 14
export function stockStat(qty, safety, mavg) {
  const q = N(qty), sf = N(safety)
  if (sf <= 0) return q === 0 ? '재고없음' : '기준미설정'
  if (q <= sf) return '긴급'
  const rop = Math.max(Math.ceil(sf + (N(mavg) / 30) * LEAD_TIME), 1)
  if (q <= rop) return '주문필요'
  return '정상'
}

/* ── 달력 창 — [그달 1일, 다음달 1일) · [그달−2개월 1일, 다음달 1일) ───────── */
const ymd = d => d.toISOString().slice(0, 10)
export function closedWindow(year, month) {
  const m1 = new Date(Date.UTC(year, month - 1, 1))
  const m3 = new Date(Date.UTC(year, month - 3, 1))
  const to = new Date(Date.UTC(year, month, 1))
  return { m1From: ymd(m1), m3From: ymd(m3), toExclusive: ymd(to) }
}

/* ── 백신 — ATC 가 J07 이면 백신이다 ────────────────────────────────────
   ★ 이름으로 가리지 않는다. 「프리필드시린지」가 이름에 든 그라신·미쎄라·에포시스·
     프롤리아는 백신이 아니다(2026-11-09 실측 — 이름으로 가리면 이 넷이 섞인다).
   ★ 왜 빼나: 접종 철에 몰려 나가 평달 기준으로 안전재고를 잡으면 과하게 높아진다.
     운영 실측에서 「정상 → 긴급」이 되던 5종 중 4종이 백신이었다. */
export const VACCINE_ATC = 'J07'
export function isVaccine(d) {
  return String((d && d.atc_code) || '').startsWith(VACCINE_ATC)
}

/* ★ 「그 창의 기록이 있나」 — 재고현황 「N개월 사용량 0」과 **같은 잣대**를 쓴다.
     최근 마감 3개월에 그 약의 줄이 3개 있으면 기록이 있는 것이다.
     재료(__unusedSnaps)는 재고현황이 이미 붙여 둔 것을 그대로 본다 — 새로 읽지 않는다. */
export const MIN_SNAPS = 3
export function hasRecord(d) {
  const s = d && d.__unusedSnaps
  return !!s && N(s[3]) >= MIN_SNAPS
}

/* 월평균 —
   · m3 가 **숫자**면 그 값으로만 센다. **0 이면 0 이다** — 전년으로 넘어가지 않는다.
     (2026-11-14 이정화 님 결정. 「3개월 출고 0 이면 발주 대상 아님」과 맞춘다.
      전에는 0 이 전년÷12 로 넘어가 안전재고가 되살아났다 — 5D/W10 월평균 0→1·안전 0→2.)
   · m3 가 null 이면 **그 창의 기록이 없다**는 뜻이다 → 전년÷12 로 받친다.
   · 둘 다 없으면 null(= 기존 값을 그대로 둔다). */
export function monthlyAvgOf(m3, py) {
  if (m3 != null && m3 !== '') return Math.round(N(m3) / 3)
  if (py != null && py !== '') return Math.round(N(py) / 12)
  return null
}

/* ── 한 약의 전·후 ──────────────────────────────────────────────────── */
export function compareOne(d, m3, m1) {
  const o3 = N(d.recent_3m_usage), o1 = N(d.recent_1m_usage), py = N(d.prev_year_usage)
  const n3 = N(m3), n1 = N(m1)
  const om = N(d.monthly_avg), osf = N(d.safety_stock), omx = N(d.max_stock)
  /* ★ 출고가 0 일 때만 「기록이 있나」를 따진다 — 출고가 있으면 그 값으로 센다.
       기록이 모자라면(들인 지 얼마 안 된 약) null 을 넘겨 전년으로 받친다. */
  const basis = (n3 > 0 || hasRecord(d)) ? n3 : null
  const raw = monthlyAvgOf(basis, py > 0 ? py : null)
  /* ★★ 0 이 두 가지다 — 갈라야 한다.
       ⓐ **기록이 있는데 출고가 0** (basis === 0) → 「안 쓰는 약」이다.
          월평균·안전재고를 **0 으로 내리는 것이 업무 규칙**이다(2026-11-14 이정화 님 결정).
       ⓑ 그 밖에 0 이 된 것 — 3개월에 1~2개 나갔거나(round(1÷3)=0), 전년이 1~5 라
          round(3÷12)=0 이 된 것. 이건 **반올림 탓**이라 기존 값을 그대로 둔다(2026-11-09 규칙 3).
          안 그러면 안전재고가 0 이 되어 판정 자체를 잃는다. */
  const zeroByRecord = basis === 0
  const tiny = raw === 0 && !zeroByRecord
  const keep = raw == null || tiny
  const nm = keep ? om : raw
  const nsf = keep ? osf : Math.ceil(raw * SAFETY_FACTOR)
  const nmx = keep ? omx : Math.round(raw * MAX_FACTOR)
  const vac = isVaccine(d)
  /* 출고가 한 건도 없는데 저장값은 남아 있는 약 — 0 으로 떨어질 자리다 */
  const zeroOut = n3 === 0 && o3 > 0
  const changed = Math.abs(o3 - n3) >= 0.001 || Math.abs(o1 - n1) >= 0.001
  return {
    code: d.drug_code, name: d.drug_name, category: d.category || '',
    qty: N(d.current_qty), py,
    o3, n3, o1, n1, om, nm, osf, nsf, omx, nmx,
    tiny, vac, zeroOut, changed,
    /* 기본 체크 — 백신·출고0·차이없음은 꺼 둔다 */
    on: changed && !vac && !zeroOut,
    before: stockStat(d.current_qty, osf, om),
    after: stockStat(d.current_qty, nsf, nm),
  }
}

/* ── 표 한 벌 ───────────────────────────────────────────────────────
   drugs = 약품 전체(상태 「사용」만 넘긴다) · txns = 그 창의 출고 거래 */
export function buildUsageCompare(drugs, txns, year, month) {
  const w = closedWindow(year, month)
  const m3 = {}, m1 = {}
  for (const t of txns || []) {
    if (String(t.type) !== '출고') continue
    const day = String(t.transaction_date || '').slice(0, 10)
    if (day < w.m3From || day >= w.toExclusive) continue
    const c = normCode(t.drug_code)
    m3[c] = (m3[c] || 0) + N(t.quantity)
    if (day >= w.m1From) m1[c] = (m1[c] || 0) + N(t.quantity)
  }
  const rows = (drugs || []).map(d => compareOne(d, m3[normCode(d.drug_code)], m1[normCode(d.drug_code)]))
  const by = f => rows.filter(f).length
  return {
    window: w, rows,
    moved: rows.filter(r => r.changed),
    summary: {
      total: rows.length,
      changed: by(r => r.changed),
      on: by(r => r.on),
      vac: by(r => r.vac),
      zero: by(r => r.zeroOut),
      tiny: by(r => r.tiny),
      safety: rows.filter(r => r.on && r.osf !== r.nsf).length,
      stat: rows.filter(r => r.on && r.before !== r.after).length,
    },
  }
}

/* ── 「적용」에 보낼 줄 ────────────────────────────────────────────────
   ★ 한 번의 호출로 보낸다 — `app_save_usage_bulk` 은 한 문장 UPDATE 라
     **전부 성공 아니면 전부 취소**다. 두 번 나눠 부르면 그 보장이 깨진다.
   ★ 극소량(tiny)은 `r3` 를 **null** 로 보낸다. 그 함수는 `i.r3 is not null` 일 때만
     3개월·월평균·안전재고·최대재고를 건드리므로, null 이면 **그 칸들이 그대로 남는다.**
     직전1개월만 새 값으로 바뀐다. (2026-11-09 이정화 님 ⓐ 승인)
   ★ 전년(py)은 보내지 않는다 — 수기 유지. */
export const APPLY_FIELDS = ['recent_3m_usage', 'recent_1m_usage']
export function applyRows(rows, picked) {
  const want = picked instanceof Set ? picked : new Set(picked || [])
  return (rows || [])
    .filter(r => want.has(r.code))
    .map(r => ({ code: r.code, r3: r.tiny ? null : r.n3, r1: r.n1 }))
}

/* 적용했을 때 실제로 달라지는 것 — 확인 문구에 쓴다 */
export function applySummary(rows, picked) {
  const want = picked instanceof Set ? picked : new Set(picked || [])
  const on = (rows || []).filter(r => want.has(r.code))
  return {
    n: on.length,
    tiny: on.filter(r => r.tiny).length,
    safety: on.filter(r => r.osf !== r.nsf).length,
    stat: on.filter(r => r.before !== r.after).length,
    worse: on.filter(r => STAT_RANK[r.after] > STAT_RANK[r.before] && r.after !== '기준미설정').length,
  }
}
/* 나빠지는 쪽인지 — 숫자가 클수록 나쁘다. 「기준미설정」은 견줄 수 없어 따로 본다. */
export const STAT_RANK = { 정상: 0, 주문필요: 1, 긴급: 2, 재고없음: 3, 기준미설정: 9 }
