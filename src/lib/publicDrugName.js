/* ═══════════════════════════════════════════════════════════════
   공개 화면에 보일 제품명 — **약플로 관리 화면 쪽** 규칙 (2026-11-13)

   ★ 왜 여기에도 있나
     공개 설정 화면(VaccinePublicPanel)에서 「공개 제품명」을 비웠을 때
     **무엇이 나올지 미리 보여 주려고** 쓴다. 실제로 화면에 내보내는 것은
     공개 서버(vaccine-app/netlify/functions/_lib/stock.js)의 publicDrugName 이다.

   ★ 두 곳이 갈라지면 미리 보기가 거짓말이 된다 —
     src/lib/publicDrugName.test.js 가 **두 함수의 답을 맞대어** 못 박는다.

   ★ 규칙 자체는 **추측**이다. 그래서 0128 로 「공개 제품명」 칸을 두었다.
     적어 두면 이 규칙을 타지 않는다.
   ═══════════════════════════════════════════════════════════════ */

/** 「…(제품명)」의 괄호 안. 괄호로 끝나지 않거나 짝이 없으면 빈 글자. */
function lastParenContent(s) {
  if (!s.endsWith(')')) return ''
  let depth = 0
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ')') depth++
    else if (s[i] === '(') {
      depth--
      if (depth === 0) return s.slice(i + 1, -1).trim()
    }
  }
  return ''
}

/**
 * 약품명에서 공개용 제품명을 **추측**한다.
 *   ① 이름이 괄호로 끝나면 그 짝 안을 제품명으로 본다
 *   ② 아니면 맨 앞의 「독감-숫자」와 뒤따르는 「지자체」만 없앤다
 *   ③ 그 결과가 비거나 괄호·공백뿐이면 원래 이름을 쓴다
 */
export function autoDrugName(raw) {
  const src = String(raw ?? '').trim()
  if (!src) return ''
  const inner = lastParenContent(src)
  if (inner) return inner
  const s = src.replace(/^독감-\d+\s*(?:지자체\s*)?/, '').trim()
  return s.replace(/[()\s]/g, '') ? s : src
}

/**
 * 공개 화면에 실제로 나갈 이름.
 *   적어 둔 공개 제품명이 있으면 **그대로**, 비어 있으면 규칙으로 만든다.
 *   ★ 공백만 적은 것은 비운 것으로 본다(DB CHECK 도 그렇게 막는다).
 */
export function shownDrugName(publicDrugName, rawDrugName) {
  const fixed = String(publicDrugName ?? '').trim()
  if (fixed) return fixed
  return autoDrugName(rawDrugName)
}

/** 저장할 값 — 비었거나 공백뿐이면 null(DB 를 비운다) */
export function normDrugName(v) {
  const s = String(v ?? '').trim()
  return s ? s : null
}

/** 공개 제품명 최대 길이 — 0128 CHECK 와 같은 값 */
export const DRUG_NAME_MAX = 40
