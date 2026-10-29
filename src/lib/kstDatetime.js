/* ═══════════════════════════════════════════════════════════════════════════
   datetime-local ↔ timestamptz 변환 — 항상 Asia/Seoul 기준

   ★ 왜 필요한가 (2026-10-29 실측 결함)
     `<input type="datetime-local">` 은 시간대가 **없는** 값을 다룬다.
     그래서 DB 의 timestamptz 를 그대로 잘라 넣거나(`String(iso).slice(0,16)`),
     그 값을 `new Date(...)` 로 되읽으면 **브라우저 시간대만큼 밀린다**.
       저장값 2026-10-31T09:00:00Z (= KST 18:00)
         → slice(0,16) → '2026-10-31T09:00' 을 화면이 **현지 09:00** 으로 표시
         → new Date('2026-10-31T09:00') = KST 09:00 → 저장 2026-10-31T00:00:00Z
       결과: 회차를 열어 **제목만 바꿔 저장해도 마감이 9시간 당겨진다.**

   ★ 여기서는 UTC 게터와 Date.UTC 만 쓴다 — getHours()·new Date(문자열) 처럼
     **브라우저 시간대에 기대는 것을 쓰지 않는다.** 그래서 기기 시간대가
     UTC 든 KST 든 뉴욕이든 같은 값이 나온다(병원 기준은 언제나 KST 다).
   ═══════════════════════════════════════════════════════════════════════════ */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const p2 = n => String(n).padStart(2, '0')

/* timestamptz(ISO) → datetime-local 에 넣을 'YYYY-MM-DDTHH:mm' (KST 벽시계) */
export function kstInputValue(iso) {
  const ms = Date.parse(String(iso ?? ''))
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms + KST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
    + `T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

/* timestamptz(ISO) → 화면에 보여 줄 날짜 'YYYY-MM-DD' (KST 기준).
   ★ String(iso).slice(0, 10) 을 쓰면 **UTC 날짜**가 나온다 — KST 00:00~08:59 에
     찍힌 시각은 하루 전으로 보인다(회차를 새벽에 열면 「기준 … 이후 접종」이 어제). */
export function kstDateOnly(iso) {
  return kstInputValue(iso).slice(0, 10)
}

/* datetime-local 값('YYYY-MM-DDTHH:mm', KST 벽시계로 읽는다) → 저장할 ISO(UTC).
   빈 값·모양이 틀린 값은 null — 호출부가 「마감 없음」으로 저장한다. */
export function kstInputToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? ''))
  if (!m) return null
  const asIfUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  return new Date(asIfUtc - KST_OFFSET_MS).toISOString()
}
