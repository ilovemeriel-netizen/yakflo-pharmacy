/* @vitest-environment node */
/* 수요조사 입력 규칙 — 관리 화면 사본과 공개 앱 쌍둥이의 판정이 같은지 본다.
   ★ 두 앱은 별도 Vite 빌드라 서로 import 할 수 없다. 그래서 같은 규칙을 양쪽에 두고
     여기서 못을 박는다. 한쪽만 고치면 이 시험이 걸린다(envGuard.test.js 와 같은 방식). */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_FAMILY, doseOf, validFamily, familyOf, inVaxRange, validateEdit } from './surveyRules'

describe('가족 수', () => {
  it('상한은 20 — DB CHECK 와 같다', () => {
    expect(MAX_FAMILY).toBe(20)
  })
  it('0~20 의 정수만 받는다', () => {
    for (const v of [0, 1, 20, '0', '20']) expect(validFamily(v), String(v)).toBe(true)
    for (const v of [-1, 21, 1.5, '1.5', 'a', {}, []]) expect(validFamily(v), String(v)).toBe(false)
  })
  it('★ null·undefined·빈 문자열은 거부한다 — Number() 가 0 이라 「없음」과 구별이 안 된다', () => {
    for (const v of [null, undefined, '']) expect(validFamily(v), String(v)).toBe(false)
  })
  it('familyOf 는 빈 값을 0 으로 본다', () => {
    expect(familyOf(null)).toBe(0)
    expect(familyOf('')).toBe(0)
    expect(familyOf('3')).toBe(3)
  })
})

describe('도즈', () => {
  it('본인 + 가족', () => {
    expect(doseOf(true, 2)).toBe(3)
    expect(doseOf(false, 2)).toBe(2)
    expect(doseOf(true, 0)).toBe(1)
    expect(doseOf(false, 0)).toBe(0)
  })
})

describe('희망일 범위', () => {
  const S = '2026-11-01', E = '2027-04-30'
  it('기간 안이면 통과', () => {
    for (const d of [S, E, '2026-12-25']) expect(inVaxRange(d, S, E), d).toBe(true)
  })
  it('기간 밖이면 거부', () => {
    for (const d of ['2026-10-31', '2027-05-01']) expect(inVaxRange(d, S, E), d).toBe(false)
  })
  it('모양이 틀리면 거부', () => {
    for (const d of ['', '2026-11', '26-11-01', null, undefined]) expect(inVaxRange(d, S, E), String(d)).toBe(false)
  })
  it('타임스탬프로 와도 앞 10글자만 본다', () => {
    expect(inVaxRange('2026-12-25', '2026-11-01T15:00:00Z', '2027-04-30T15:00:00Z')).toBe(true)
  })
})

describe('validateEdit — 보내기 전 거르기', () => {
  const survey = { vax_start: '2026-11-01', vax_end: '2027-04-30' }
  const row = { self_dose: true, family_count: 3, wish_date: '2026-12-01', done_family: 2 }

  it('바꿀 게 맞으면 통과', () => {
    expect(validateEdit(row, { family_count: 5 }, survey)).toBeNull()
    expect(validateEdit(row, { self_dose: false }, survey)).toBeNull()
    expect(validateEdit(row, { wish_date: '2026-12-25' }, survey)).toBeNull()
  })
  it('★ 접종 완료보다 적게 바꾸면 거절하고, 무엇을 먼저 고칠지 알려 준다', () => {
    const m = validateEdit(row, { family_count: 1 }, survey)
    expect(m).toContain('접종 완료 2명보다 적게')
    expect(m).toContain('접종 완료를 먼저 고쳐')
  })
  it('접종 완료와 같은 수까지는 된다', () => {
    expect(validateEdit(row, { family_count: 2 }, survey)).toBeNull()
  })
  it('가족 수가 범위 밖이면 거절', () => {
    expect(validateEdit(row, { family_count: 21 }, survey)).toContain('0~20')
    expect(validateEdit(row, { family_count: -1 }, survey)).toContain('0~20')
    expect(validateEdit(row, { family_count: '' }, survey)).toContain('0~20')
  })
  it('★ 본인X + 가족0 이면 아무도 안 맞는 신청이라 거절', () => {
    const r2 = { ...row, done_family: 0 }
    expect(validateEdit(r2, { self_dose: false, family_count: 0 }, survey))
      .toContain('최소 1명')
  })
  it('희망일이 기간 밖이면 거절하고 기간을 알려 준다', () => {
    const m = validateEdit(row, { wish_date: '2027-05-01' }, survey)
    expect(m).toContain('2026-11-01')
    expect(m).toContain('2027-04-30')
  })
  it('희망일을 바꾸지 않으면 기간을 보지 않는다 — 지난 신청도 수량은 고칠 수 있다', () => {
    const old = { ...row, wish_date: '2020-01-01' }
    expect(validateEdit(old, { family_count: 4 }, survey)).toBeNull()
  })
  it('행이 없으면 거절', () => {
    expect(validateEdit(null, { family_count: 1 }, survey)).toBeTruthy()
  })
})

/* ── 쌍둥이 동기화 ────────────────────────────────────────────────────────
   ★ 경로를 런타임에 만들고 @vite-ignore 를 붙인다 — 정적 분석되면 파일이 없을 때
     transform 단계에서 실패해 try/catch 가 소용없다(envGuard.test.js 와 같은 이유). */
const twinPath = resolve(process.cwd(), 'vaccine-app/netlify/functions/_lib/survey.js')
let twin = null
if (existsSync(twinPath)) {
  try { twin = await import(/* @vite-ignore */ pathToFileURL(twinPath).href) } catch { twin = null }
}

;(twin ? describe : describe.skip)('vaccine-app 쌍둥이와 판정이 같다', () => {
  it('MAX_FAMILY 가 같다', () => {
    expect(twin.MAX_FAMILY).toBe(MAX_FAMILY)
  })
  it('validFamily 가 같은 값에 같은 판정을 낸다', () => {
    const VALUES = [0, 1, 20, 21, -1, 1.5, '0', '20', '21', '1.5', 'a', '', null, undefined, {}, []]
    for (const v of VALUES) {
      expect(validFamily(v), '값: ' + String(v)).toBe(twin.validFamily(v))
    }
  })
  it('familyOf 가 같다', () => {
    for (const v of [null, undefined, '', '3', 3, 0]) {
      expect(familyOf(v), '값: ' + String(v)).toBe(twin.familyOf(v))
    }
  })
  it('doseOf 가 같다', () => {
    for (const [s, f] of [[true, 0], [true, 3], [false, 2], [false, 0]]) {
      expect(doseOf(s, f)).toBe(twin.doseOf(s, f))
    }
  })
  it('★ 희망일 기간 판정이 같다 — 공개 앱의 「오늘 이후」 조건만 빼고 비교한다', () => {
    const S = '2026-11-01', E = '2027-04-30'
    /* twin.validWishDate 는 기간 + 오늘 이후를 함께 본다. 기간 밖이면 둘 다 false 여야 한다. */
    for (const d of ['2026-10-31', '2027-05-01', '', '2026-11', null]) {
      expect(inVaxRange(d, S, E), '기간 밖: ' + String(d)).toBe(false)
      expect(twin.validWishDate(d, S, E, Date.parse('2026-11-10T00:00:00Z')), '쌍둥이도 거부: ' + String(d)).toBe(false)
    }
    /* 기간 안 + 오늘 이후면 둘 다 true */
    for (const d of ['2026-12-25', E]) {
      expect(inVaxRange(d, S, E), '기간 안: ' + d).toBe(true)
      expect(twin.validWishDate(d, S, E, Date.parse('2026-11-10T00:00:00Z')), '쌍둥이도 통과: ' + d).toBe(true)
    }
  })
})
