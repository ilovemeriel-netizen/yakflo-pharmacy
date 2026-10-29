/* ═══════════════════════════════════════════════════════════════════════════
   「잔량 정보가 오래됐다」 판정 — 영업일 기준 (React 없는 순수 함수)

   ★ 왜 그냥 24시간이 아닌가
     약제과는 주말에 입력하지 않는다. 달력 시간으로 재면 **금요일 오후에 입력한 잔량이
     월요일 아침에는 언제나 「오래됨」** 이 된다(64시간). 실제로는 하나도 낡지 않았는데
     매주 월요일마다 띠가 뜨면 사람들이 띠를 안 보게 된다.
     그래서 **토·일에 흐른 시간은 세지 않는다.**

   ★ 공휴일은 보지 않는다(사용자 결정). 공휴일표를 들고 있어야 하고 해마다 바뀐다.
     연휴 뒤에는 띠가 한 번 뜨는데, 그건 「확인해 보라」는 뜻으로 틀리지 않다.

   ★ 경계는 **KST** 로 가른다. 토요일이 시작·끝나는 순간이 한국 시간 기준이어야
     금요일 밤 입력이 제대로 잡힌다.

   ★ 「지금」은 **서버 시각**으로 받는다 — lib/serverClock.js 참고.
     기기 시계가 틀려도 판정이 흔들리지 않게 하려는 것이다.
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86400000
const KST_MS = 9 * 60 * 60 * 1000

/* 영업일 기준 이 시간을 넘으면 오래된 것으로 본다 */
export const STALE_BUSINESS_MS = 24 * 60 * 60 * 1000

/* 이 밖은 세지 않는다 — 0=일 · 6=토 (KST 기준 요일) */
function isWeekend(ms) {
  const d = new Date(ms + KST_MS).getUTCDay()
  return d === 0 || d === 6
}

/* 그 시각이 속한 **KST 날짜의 자정**(UTC epoch ms) */
function kstMidnight(ms) {
  return Math.floor((ms + KST_MS) / DAY_MS) * DAY_MS - KST_MS
}

/* from~to 사이에서 **토·일을 뺀** 흐른 시간(ms).
   하루씩 잘라 평일 조각만 더한다 — 반나절만 걸친 날도 그 조각만큼만 센다.
   ★ 아주 긴 구간(1년 넘음)은 더 세어 볼 필요가 없다 — 어차피 오래됐다. */
export function businessMs(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0
  if (toMs <= fromMs) return 0
  if (toMs - fromMs > 400 * DAY_MS) return toMs - fromMs

  let total = 0
  let cur = fromMs
  while (cur < toMs) {
    const next = Math.min(kstMidnight(cur) + DAY_MS, toMs)
    if (!isWeekend(cur)) total += next - cur
    cur = next
  }
  return total
}

/* 오래됐나? updatedIso 가 없으면 **판단하지 않는다**(false) —
   입력 기록이 아예 없는 회차에 「오래됐다」고 말하면 뜻이 어긋난다. */
export function isStale(updatedIso, nowMs) {
  if (!updatedIso) return false
  const u = Date.parse(updatedIso)
  if (Number.isNaN(u)) return false
  return businessMs(u, nowMs) >= STALE_BUSINESS_MS
}

/* 띠 문구 — when 은 fmtKst 가 만든 "10월 28일 15:36".
   ★ 문구는 사용자 확정본이다. 바꾸면 시험이 바로 걸린다. */
export const STALE_HEAD = '잔량 정보는 '
export const STALE_TAIL = ' 기준입니다. 실제 수량과 다를 수 있습니다.'
export function staleText(when) {
  return STALE_HEAD + String(when || '') + STALE_TAIL
}
