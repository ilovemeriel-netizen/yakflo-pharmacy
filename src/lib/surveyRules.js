/* ═══════════════════════════════════════════════════════════════════════════
   수요조사 입력 규칙 — 약플로 관리 화면 쪽 사본

   ★ 쌍둥이 파일: vaccine-app/netlify/functions/_lib/survey.js
     공개 신청 앱과 약플로 관리 화면은 **같은 규칙**으로 같은 값을 받아야 한다.
     그런데 두 앱은 별도 Vite 빌드라 서로 import 할 수 없다. 그래서 같은 규칙을
     양쪽에 두고, surveyRules.test.js 가 **두 파일의 판정이 일치하는지** 시험한다
     (lib/envGuard.js ↔ _lib/env.js 와 같은 방식).
     한쪽만 고치면 그 시험이 걸린다.

   ★ 정본은 DB 다 — CHECK 제약과 trg_vaccine_survey_response_guard,
     그리고 0096 의 edit_vaccine_survey_response 가 최종 판정을 한다.
     여기는 **보내기 전에 걸러** 사용자에게 바로 알려 주려는 것뿐이다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 가족 수 상한 — DB CHECK (family_count >= 0 and <= 20) 와 같은 값 */
export const MAX_FAMILY = 20

/* 도즈 = (본인 1 또는 0) + 가족 수 */
export function doseOf(selfDose, familyCount) {
  return (selfDose ? 1 : 0) + Number(familyCount || 0)
}

/* 숫자와 숫자 문자열만 받는다.
   ★ null·undefined·'' 를 거부하는 이유 — Number(null) 과 Number('') 가 **0** 이라
     그냥 통과시키면 「값이 안 왔다」와 「0명이다」가 구별되지 않는다. */
export function validFamily(v) {
  if (v == null || v === '') return false
  if (typeof v !== 'number' && typeof v !== 'string') return false
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= MAX_FAMILY
}

/* 생략·빈 값을 0 으로 본다 */
export function familyOf(v) {
  return v == null || v === '' ? 0 : Number(v)
}

/* 희망일이 접종 기간 안인가 — trg_vaccine_survey_response_guard 와 같은 판정.
   ★ 공개 앱의 validWishDate 는 「오늘 이후」도 함께 보지만, 관리 화면은 **지난 날짜도
     고칠 수 있어야 한다**(접종이 끝난 뒤 기록을 바로잡는 경우). 그래서 기간만 본다.
     기간 판정 자체는 양쪽이 같고, 그 부분을 쌍둥이 시험이 비교한다. */
export function inVaxRange(wish, vaxStart, vaxEnd) {
  const s = String(wish ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  if (!vaxStart || !vaxEnd) return false
  return s >= String(vaxStart).slice(0, 10) && s <= String(vaxEnd).slice(0, 10)
}

/* ── 관리 화면의 수정 한 건을 보내기 전에 거른다 ──────────────────────────
   row    = { self_dose, family_count, wish_date, done_family }
   patch  = 바꾸려는 칸만 담긴 객체
   survey = { vax_start, vax_end }
   반환 null = 통과 / 문자열 = 거절 사유(화면이 그대로 띄운다) */
export function validateEdit(row, patch, survey) {
  if (!row) return '신청을 찾을 수 없습니다'
  const self = 'self_dose' in patch ? !!patch.self_dose : !!row.self_dose
  const famRaw = 'family_count' in patch ? patch.family_count : row.family_count
  const wish = 'wish_date' in patch ? patch.wish_date : row.wish_date

  if (!validFamily(famRaw)) return `가족 수는 0~${MAX_FAMILY} 사이의 숫자여야 합니다`
  const fam = familyOf(famRaw)

  /* ★ 접종 완료보다 적게 낮추지 않는다 — 이미 맞은 사람 수를 화면이 깎지 않는다.
     0096 의 edit_vaccine_survey_response 도 같은 것을 restrict_violation 으로 막는다. */
  const done = Number(row.done_family || 0)
  if (fam < done) {
    return `접종 완료 ${done}명보다 적게 바꿀 수 없습니다. 접종 완료를 먼저 고쳐 주세요.`
  }

  if (!self && fam <= 0) return '본인 또는 가족 중 최소 1명은 접종해야 합니다'

  if ('wish_date' in patch) {
    if (!inVaxRange(wish, survey?.vax_start, survey?.vax_end)) {
      const a = String(survey?.vax_start ?? '').slice(0, 10)
      const b = String(survey?.vax_end ?? '').slice(0, 10)
      return `희망일은 접종 기간(${a} ~ ${b}) 안이어야 합니다`
    }
  }
  return null
}
