/* 수요조사 순수 규칙 — 신청번호 · 이름 키 · 희망일 범위(KST 경계) · 도즈 · 제출 제한 · 확인번호 잠금 */
import { describe, it, expect } from 'vitest'
import {
  CODE_ALPHABET, CODE_LEN, CODE_RE, makeReceiptCode, validReceiptCode,
  nameKey, kstToday, wishRange, validWishDate,
  doseOf, validFamily, familyOf, MAX_FAMILY, validateSubmit,
  rateCheck, SUBMIT_MAX, SUBMIT_WINDOW_MS,
  pinLockState, pinFailNext, PIN_MAX_FAIL, PIN_LOCK_MIN,
  publicView,
} from '../netlify/functions/_lib/survey.js'

/* 2026-10-28 14:00 KST = 2026-10-28T05:00:00Z */
const NOW = Date.parse('2026-10-28T05:00:00Z')

describe('신청번호', () => {
  it('문자 집합이 31글자이고 혼동 문자(0 O 1 I L)가 없다', () => {
    expect(CODE_ALPHABET).toHaveLength(31)
    for (const bad of ['0', 'O', '1', 'I', 'L']) expect(CODE_ALPHABET).not.toContain(bad)
    expect(new Set(CODE_ALPHABET).size).toBe(31)     /* 중복 없음 */
  })
  it('길이 6이고 DB CHECK 정규식을 만족한다', () => {
    let seq = 0
    const code = makeReceiptCode(() => (seq++ % CODE_ALPHABET.length))
    expect(code).toHaveLength(CODE_LEN)
    expect(CODE_RE.test(code)).toBe(true)
  })
  it('문자 집합 전체가 DB 정규식을 통과한다 — 한쪽만 고치면 여기서 걸린다', () => {
    for (const ch of CODE_ALPHABET) expect(CODE_RE.test(ch.repeat(6))).toBe(true)
  })
  it('randomInt 를 CODE_LEN 번 부른다 (충돌 재시도마다 새로 뽑히도록)', () => {
    let calls = 0
    makeReceiptCode(n => { calls++; expect(n).toBe(31); return 0 })
    expect(calls).toBe(CODE_LEN)
  })
  it('validReceiptCode — 혼동 문자·길이·소문자 거부', () => {
    expect(validReceiptCode('AB2345')).toBe(true)
    expect(validReceiptCode('AB234')).toBe(false)
    expect(validReceiptCode('AB23450')).toBe(false)
    expect(validReceiptCode('AB234O')).toBe(false)
    expect(validReceiptCode('AB234I')).toBe(false)
    expect(validReceiptCode('AB234L')).toBe(false)
    expect(validReceiptCode('ab2345')).toBe(false)
    expect(validReceiptCode(null)).toBe(false)
  })
})

describe('nameKey — 공백 제거 · 대소문자 무시', () => {
  it('같은 이름으로 모은다', () => {
    expect(nameKey('김 정 화')).toBe('김정화')
    expect(nameKey(' 김정화 ')).toBe('김정화')
    expect(nameKey('김　정화')).toBe('김정화')     /* 전각 공백 */
    expect(nameKey('김\t정화\n')).toBe('김정화')
  })
  it('영문은 소문자로', () => {
    expect(nameKey('Lee JeongHwa')).toBe('leejeonghwa')
    expect(nameKey('LEE JEONGHWA')).toBe(nameKey('lee jeonghwa'))
  })
  it('빈 값도 안전하다', () => {
    expect(nameKey('')).toBe('')
    expect(nameKey(null)).toBe('')
    expect(nameKey('   ')).toBe('')
  })
})

describe('희망일 범위 — max(오늘 KST, 접종 시작) ~ 접종 끝날', () => {
  it('접종 시작이 미래면 시작일부터', () => {
    expect(wishRange('2026-11-01', '2026-11-30', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })
  it('접종이 이미 시작됐으면 오늘부터', () => {
    expect(wishRange('2026-10-01', '2026-11-30', NOW)).toEqual({ from: '2026-10-28', to: '2026-11-30' })
  })
  it('접종 기간이 지났으면 null', () => {
    expect(wishRange('2026-09-01', '2026-10-27', NOW)).toBe(null)
  })
  it('오늘이 끝날이면 하루만 고를 수 있다', () => {
    expect(wishRange('2026-10-01', '2026-10-28', NOW)).toEqual({ from: '2026-10-28', to: '2026-10-28' })
  })

  describe('★ KST 자정 경계', () => {
    it('UTC 로는 전날 15:00 이 KST 로는 다음 날 00:00 이다', () => {
      expect(kstToday(Date.parse('2026-10-27T14:59:59Z'))).toBe('2026-10-27')
      expect(kstToday(Date.parse('2026-10-27T15:00:00Z'))).toBe('2026-10-28')
    })
    it('자정 직전에는 어제가, 자정에는 오늘이 하한이 된다', () => {
      const before = Date.parse('2026-10-27T14:59:59Z')
      const after = Date.parse('2026-10-27T15:00:00Z')
      expect(wishRange('2026-10-01', '2026-11-30', before).from).toBe('2026-10-27')
      expect(wishRange('2026-10-01', '2026-11-30', after).from).toBe('2026-10-28')
    })
    it('자정을 넘기면 어제 날짜는 고를 수 없게 된다', () => {
      const before = Date.parse('2026-10-27T14:59:59Z')
      const after = Date.parse('2026-10-27T15:00:00Z')
      expect(validWishDate('2026-10-27', '2026-10-01', '2026-11-30', before)).toBe(true)
      expect(validWishDate('2026-10-27', '2026-10-01', '2026-11-30', after)).toBe(false)
    })
    it('연말 경계도 맞다', () => {
      expect(kstToday(Date.parse('2026-12-31T14:59:59Z'))).toBe('2026-12-31')
      expect(kstToday(Date.parse('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
    })
  })

  it('형식이 아니면 거부', () => {
    expect(validWishDate('2026-11-1', '2026-11-01', '2026-11-30', NOW)).toBe(false)
    expect(validWishDate('', '2026-11-01', '2026-11-30', NOW)).toBe(false)
    expect(validWishDate(null, '2026-11-01', '2026-11-30', NOW)).toBe(false)
  })
  it('범위 밖은 거부', () => {
    expect(validWishDate('2026-10-31', '2026-11-01', '2026-11-30', NOW)).toBe(false)
    expect(validWishDate('2026-12-01', '2026-11-01', '2026-11-30', NOW)).toBe(false)
  })
})

describe('도즈 (결정 1)', () => {
  it('본인 1 + 가족 수', () => {
    expect(doseOf(true, 0)).toBe(1)
    expect(doseOf(false, 3)).toBe(3)
    expect(doseOf(true, 3)).toBe(4)
    expect(doseOf(false, 0)).toBe(0)
  })
  it('가족 수 상한 20', () => {
    expect(validFamily(0)).toBe(true)
    expect(validFamily(MAX_FAMILY)).toBe(true)
    expect(validFamily(MAX_FAMILY + 1)).toBe(false)
    expect(validFamily(-1)).toBe(false)
    expect(validFamily(1.5)).toBe(false)
  })
  it('숫자 문자열은 받아들인다 — 브라우저가 문자열로 보낼 수 있다', () => {
    expect(validFamily('3')).toBe(true)
    expect(validFamily('0')).toBe(true)
    expect(validFamily('20')).toBe(true)
    expect(validFamily('21')).toBe(false)
    expect(validFamily('3.5')).toBe(false)
    expect(validFamily('abc')).toBe(false)
    /* ★ null·'' 는 거부한다 — Number(null)=Number('')=0 이라 그냥 통과시키면
       「값이 안 왔다」와 「0명이다」가 구별되지 않는다 */
    expect(validFamily('')).toBe(false)
    expect(validFamily(null)).toBe(false)
    expect(validFamily(undefined)).toBe(false)
    expect(validFamily([])).toBe(false)
    expect(validFamily({})).toBe(false)
  })
  it('familyOf — 생략·빈 값은 0 으로 정규화한다', () => {
    expect(familyOf(undefined)).toBe(0)
    expect(familyOf(null)).toBe(0)
    expect(familyOf('')).toBe(0)
    expect(familyOf(0)).toBe(0)
    expect(familyOf('3')).toBe(3)
    expect(familyOf(3)).toBe(3)
  })
})

describe('validateSubmit', () => {
  const survey = { status: 'open', close_at: '2026-11-20T14:59:59Z', vax_start: '2026-11-01', vax_end: '2026-11-30' }
  const ok = { consent: true, name: '김정화', self_dose: true, family_count: 2, wish_date: '2026-11-03' }

  it('정상 통과', () => expect(validateSubmit(ok, survey, NOW)).toBe(null))
  it('열린 회차가 없으면 거절', () => {
    expect(validateSubmit(ok, null, NOW)).toContain('진행 중인')
    expect(validateSubmit(ok, { ...survey, status: 'draft' }, NOW)).toContain('진행 중인')
    expect(validateSubmit(ok, { ...survey, status: 'closed' }, NOW)).toContain('진행 중인')
  })
  it('마감 시각이 지나면 거절', () => {
    expect(validateSubmit(ok, { ...survey, close_at: '2026-10-28T04:59:59Z' }, NOW)).toContain('마감')
  })
  it('동의 없으면 거절', () => expect(validateSubmit({ ...ok, consent: false }, survey, NOW)).toContain('동의'))
  it('성명이 비면 거절', () => {
    expect(validateSubmit({ ...ok, name: '' }, survey, NOW)).toContain('성명')
    expect(validateSubmit({ ...ok, name: '   ' }, survey, NOW)).toContain('성명')
  })
  it('사번 형식 — 숫자·영문·하이픈만', () => {
    expect(validateSubmit({ ...ok, emp_no: '12345' }, survey, NOW)).toBe(null)
    expect(validateSubmit({ ...ok, emp_no: 'A-12' }, survey, NOW)).toBe(null)
    expect(validateSubmit({ ...ok, emp_no: '' }, survey, NOW)).toBe(null)       /* 선택 입력 */
    expect(validateSubmit({ ...ok, emp_no: '김정화' }, survey, NOW)).toContain('사번')
    expect(validateSubmit({ ...ok, emp_no: 'x'.repeat(21) }, survey, NOW)).toContain('깁니다')
  })
  it('본인X·가족0 이면 거절', () => {
    expect(validateSubmit({ ...ok, self_dose: false, family_count: 0 }, survey, NOW)).toContain('1명 이상')
  })
  it('가족 수 범위 밖이면 거절', () => {
    expect(validateSubmit({ ...ok, family_count: 21 }, survey, NOW)).toContain('0~20')
  })
  it('희망일 범위 밖이면 범위를 알려 준다', () => {
    const why = validateSubmit({ ...ok, wish_date: '2026-12-25' }, survey, NOW)
    expect(why).toContain('2026-11-01')
    expect(why).toContain('2026-11-30')
  })
})

describe('제출 횟수 제한 — 1시간 30건', () => {
  it('첫 제출은 새 창으로 1', () => {
    const r = rateCheck(null, NOW)
    expect(r.allowed).toBe(true)
    expect(r.next.submit_count).toBe(1)
    expect(Date.parse(r.next.window_start)).toBe(NOW)
  })
  it('창 안에서는 누적된다', () => {
    const ws = new Date(NOW - 10 * 60_000).toISOString()
    const r = rateCheck({ window_start: ws, submit_count: 5 }, NOW)
    expect(r.allowed).toBe(true)
    expect(r.next.submit_count).toBe(6)
    expect(r.next.window_start).toBe(ws)             /* 창은 미끄러지지 않는다(고정 창) */
  })
  it('★ 30건까지 허용, 31번째는 거절', () => {
    const ws = new Date(NOW - 10 * 60_000).toISOString()
    expect(rateCheck({ window_start: ws, submit_count: SUBMIT_MAX - 1 }, NOW).allowed).toBe(true)
    expect(rateCheck({ window_start: ws, submit_count: SUBMIT_MAX }, NOW).allowed).toBe(false)
  })
  it('★ 1시간이 지나면 초기화된다', () => {
    const ws = new Date(NOW - SUBMIT_WINDOW_MS).toISOString()
    const r = rateCheck({ window_start: ws, submit_count: SUBMIT_MAX }, NOW)
    expect(r.allowed).toBe(true)
    expect(r.next.submit_count).toBe(1)
    expect(Date.parse(r.next.window_start)).toBe(NOW)
  })
  it('1초 모자라면 아직 초기화되지 않는다', () => {
    const ws = new Date(NOW - SUBMIT_WINDOW_MS + 1000).toISOString()
    expect(rateCheck({ window_start: ws, submit_count: SUBMIT_MAX }, NOW).allowed).toBe(false)
  })
  it('깨진 window_start 는 새 창으로 본다', () => {
    expect(rateCheck({ window_start: 'x', submit_count: 99 }, NOW).allowed).toBe(true)
  })
})

describe('확인번호 잠금 — 20회 → 10분', () => {
  it('기준값이 vaccine-verify 와 같다', () => {
    expect(PIN_MAX_FAIL).toBe(20)
    expect(PIN_LOCK_MIN).toBe(10)
  })
  it('잠겨 있지 않으면 locked=false', () => {
    expect(pinLockState(null, NOW).locked).toBe(false)
    expect(pinLockState({ pin_fail: 3, pin_locked_until: null }, NOW).locked).toBe(false)
  })
  it('잠금 시각이 미래면 남은 분을 알려 준다', () => {
    const until = new Date(NOW + 5.5 * 60_000).toISOString()
    const s = pinLockState({ pin_locked_until: until }, NOW)
    expect(s.locked).toBe(true)
    expect(s.mins).toBe(6)                            /* 올림 */
  })
  it('잠금이 이미 풀렸으면 통과', () => {
    expect(pinLockState({ pin_locked_until: new Date(NOW - 1000).toISOString() }, NOW).locked).toBe(false)
  })
  it('★ 19번째 실패는 누적만, 20번째에 잠근다', () => {
    const a = pinFailNext({ pin_fail: 18 }, NOW)
    expect(a.locked).toBe(false)
    expect(a.patch.pin_fail).toBe(19)
    expect(a.patch.pin_locked_until).toBe(null)

    const b = pinFailNext({ pin_fail: 19 }, NOW)
    expect(b.locked).toBe(true)
    expect(b.patch.pin_fail).toBe(0)                  /* 잠그면 카운터를 되돌린다 */
    expect(Date.parse(b.patch.pin_locked_until)).toBe(NOW + PIN_LOCK_MIN * 60_000)
  })
  it('처음 실패도 안전하다', () => {
    expect(pinFailNext(null, NOW).patch.pin_fail).toBe(1)
    expect(pinFailNext({}, NOW).patch.pin_fail).toBe(1)
  })
})

describe('publicView — 다른 정보가 새지 않는다', () => {
  const row = {
    id: 'uuid-1', tenant_id: 'uuid-t', survey_id: 'uuid-s',
    receipt_code: 'AB2345', emp_no: '12345', name: '김정화',
    self_dose: true, family_count: 2, wish_date: '2026-11-03', status: 'applied',
    pin_hash: 'SECRETHASH', pin_salt: 'SECRETSALT', pin_fail: 3, pin_locked_until: null,
    account_id: 'uuid-a', name_key: '김정화', consent_at: 'x',
  }
  it('확인번호 해시·salt·내부 id 가 빠진다', () => {
    const v = publicView(row)
    const text = JSON.stringify(v)
    for (const bad of ['SECRETHASH', 'SECRETSALT', 'uuid-1', 'uuid-s', 'uuid-a', 'uuid-t', 'pin_fail']) {
      expect(text).not.toContain(bad)
    }
  })
  it('키가 정해진 8개뿐이다', () => {
    expect(Object.keys(publicView(row)).sort()).toEqual(
      ['dose', 'emp_no', 'family_count', 'name', 'receipt_code', 'self_dose', 'status', 'wish_date'])
  })
  it('도즈를 계산해 넣는다', () => {
    expect(publicView(row).dose).toBe(3)
    expect(publicView({ ...row, self_dose: false, family_count: 5 }).dose).toBe(5)
  })
  it('사번이 없으면 null', () => {
    expect(publicView({ ...row, emp_no: null }).emp_no).toBe(null)
  })
})
