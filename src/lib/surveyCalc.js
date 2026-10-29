/* ═══════════════════════════════════════════════════════════════════════════
   수요 현황 — 순수 계산 (React·DB 없음)

   ★ D·A·R·B·S·G·O 의 **정본은 DB 뷰 v_vaccine_demand** 다. 여기서 다시 만들지 않는다.
     이 파일은 ① 뷰 값을 화면용으로 다듬고 ② 뷰가 주지 않는 것(날짜별 누적·가림표시)만 만든다.
     ※ 같은 산식을 두 곳에 두면 갈라진다 — 0089 잔량 뷰에서 이미 배운 원칙이다.

   ★ 개인정보 가림: 사번 12**56 · 성명 김*수 · 사번 없으면 —
     원문은 「원문 보기」를 눌러 audit 을 남긴 뒤에만 보여 준다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 개인정보 가림 ─────────────────────────────────────────────────────── */
/* 사번 — 앞 2 · 뒤 2 만 남기고 가운데를 * 로. 짧으면 뒤만 남긴다. */
export function maskEmpNo(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  if (s.length <= 2) return '*'.repeat(s.length)
  if (s.length <= 4) return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
  return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2)
}

/* 성명 — 가운데를 * 로. 두 글자면 뒤 한 글자를 가린다(김*).
   ★ 파기된 행의 '(파기)' 는 가리지 않는다 — 가릴 개인정보가 없다. */
export function maskName(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  if (s === '(파기)') return s
  if (s.length === 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

/* ── 도즈 ──────────────────────────────────────────────────────────────── */
export function doseOf(r) {
  return (r?.self_dose ? 1 : 0) + Number(r?.family_count || 0)
}
/* 명단에서 손으로 체크한 수 */
export function doneOf(r) {
  return (r?.done_self ? 1 : 0) + Number(r?.done_family || 0)
}
/* 아직 접종하지 않은 신청 도즈 — 날짜별 누적의 재료 */
export function pendingOf(r) {
  return Math.max(0, doseOf(r) - doneOf(r))
}

/* ── 날짜별 누적 수요 ───────────────────────────────────────────────────
   ★ 희망일이 지난 미접종분은 **오늘로 합산**한다(지시) — 지난 날짜에 쌓아 두면
     「언제부터 부족」 판단이 과거로 밀려 쓸모없어진다.
   rows: status='applied' 인 응답. today: 'YYYY-MM-DD'.
   반환 [{ date, add, cum, short }] — short 는 누적이 잔량 B 를 넘긴 날 */
export function cumulativeDemand(rows, balance, today) {
  const byDate = new Map()
  for (const r of rows || []) {
    if (r.status !== 'applied') continue
    const p = pendingOf(r)
    if (p <= 0) continue
    const d = String(r.wish_date || '')
    if (!d) continue
    const key = d < today ? today : d          /* 지난 희망일은 오늘로 */
    byDate.set(key, (byDate.get(key) || 0) + p)
  }
  const b = Number(balance || 0)
  let cum = 0
  return [...byDate.keys()].sort().map(date => {
    const add = byDate.get(date)
    cum += add
    return { date, add, cum, short: cum > b }
  })
}

/* 누적이 잔량을 처음 넘는 날 — 없으면 null */
export function firstShortDate(series) {
  const hit = (series || []).find(p => p.short)
  return hit ? hit.date : null
}

/* 'YYYY-MM-DD' → '11/4' */
export function shortDate(d) {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(d ?? '')
  return Number(m[2]) + '/' + Number(m[3])
}

/* ── 상태 배지 ──────────────────────────────────────────────────────────
   기존 잔량 화면과 같은 어휘 — 충분 / 주의 / 부족. 색은 호출부가 정한다. */
export const DEMAND_STATUS = ['충분', '주의', '부족']

/* 알림 띠 문구 — 주의·부족일 때만. 「부족 · 잔량 31 < 남은 수요 60 · 주문 권장 40도즈」 */
export function alertLine(v) {
  if (!v) return null
  const st = v.demand_status
  if (st !== '주의' && st !== '부족') return null
  const b = Number(v.balance_qty || 0)
  const r = Number(v.remain_qty || 0)
  const o = Number(v.order_qty || 0)
  const rel = st === '부족' ? '<' : '≥'
  return `${st} · 잔량 ${b.toLocaleString()} ${rel} 남은 수요 ${r.toLocaleString()} · 주문 권장 ${o.toLocaleString()}도즈`
}

/* ── 파기 안내 ─────────────────────────────────────────────────────────
   접종 끝날이 지났는데 아직 파기하지 않았으면 띠를 띄운다. */
export function needsPurge(survey, today) {
  if (!survey) return false
  if (survey.purged_at) return false
  if (!survey.vax_end) return false
  return today > survey.vax_end
}
/* 파기 버튼을 누를 수 있는가 — 닫혔고 끝날이 지났고 아직 파기 전 */
export function canPurge(survey, today) {
  if (!survey || survey.purged_at) return false
  return survey.status === 'closed' && !!survey.vax_end && today > survey.vax_end
}

/* ── 회차 만들기 기본 체크 ─────────────────────────────────────────────
   ★ 저장은 id 로 한다. label 로 「직원」 접두사를 보는 것은 **첫 화면 기본값**을
     편하게 하려는 것뿐이고, 사용자가 바꿀 수 있다(결정 ⓐ). */
export function defaultCategoryIds(cats) {
  const list = (cats || []).filter(c => c && c.id)
  const staff = list.filter(c => String(c.label || '').startsWith('직원'))
  return (staff.length ? staff : list).map(c => c.id)
}

/* ── 비고 — 행 단위 자동 표기 ───────────────────────────────────────────
   「사번 없음」(emp_no 비었음) · 「이름 중복」(같은 회차에서 name_key 가 같은 applied 행 2건 이상).
   둘 다면 「사번 없음 · 이름 중복」, 해당 없으면 빈칸.
   ★ 취소는 상태 열에 이미 있으므로 비고에 넣지 않는다.
   ★ 중복 판정은 **회차 전체 응답**으로 한다 — 화면 필터로 1건만 보여도 중복이면 표시해야 한다.
     그래서 dupNameKeys() 에 필터 전 목록(rows)을 넘기고, 그 결과를 rowNote() 가 받는다. */

/* name_key 는 서버가 채우는 열이다(공백 제거·소문자).
   그 값이 없을 때만 같은 규칙으로 직접 만든다 — DB 값이 정본이다. */
export function nameKeyOf(r) {
  const k = String(r?.name_key ?? '').trim()
  if (k) return k
  return String(r?.name ?? '').replace(/\s+/g, '').toLowerCase()
}

/* applied 행 중 name_key 가 둘 이상 겹치는 키 집합 */
export function dupNameKeys(allRows) {
  const n = new Map()
  for (const r of allRows || []) {
    if (!r || r.status !== 'applied') continue
    const k = nameKeyOf(r)
    if (!k) continue
    n.set(k, (n.get(k) || 0) + 1)
  }
  const out = new Set()
  for (const [k, c] of n) if (c > 1) out.add(k)
  return out
}

/* 한 행의 비고 문자열. dupKeys 는 dupNameKeys() 결과(Set). */
export function rowNote(r, dupKeys) {
  const out = []
  if (!String(r?.emp_no ?? '').trim()) out.push('사번 미입력')
  if (dupKeys && dupKeys.has(nameKeyOf(r))) out.push('동일 성명 확인 필요')
  return out.join(' · ')
}

/* ── 엑셀·PDF 공통 — 날짜별 집계 ───────────────────────────────────────── */
export function byDateSummary(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const d = String(r.wish_date || '')
    if (!d) continue
    const cur = m.get(d) || { date: d, people: 0, dose: 0, done: 0, cancelled: 0 }
    if (r.status === 'cancelled') { cur.cancelled++ } else {
      cur.people++
      cur.dose += doseOf(r)
      cur.done += doneOf(r)
    }
    m.set(d, cur)
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}
