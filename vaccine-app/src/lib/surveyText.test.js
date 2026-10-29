/* @vitest-environment node */
/* 수요조사 화면 표시 문구 — 절기 표기·백신 이름 다듬기·날짜 표기.
   ★ 전부 **보여 줄 때만** 쓰는 변환이다. 서버로 보내는 값은 건드리지 않는다. */
import { describe, it, expect } from 'vitest'
import { seasonLabel, shortVaccineName } from './surveyText'
import { fmtDotDate, kstDow, fmtCloseLong, kstToday, pickRange } from './surveyDate'

describe('절기 표기', () => {
  it('★ 하이픈을 물결로 — 2026-2027 → 2026~2027절기', () => {
    expect(seasonLabel('2026-2027')).toBe('2026~2027절기')
  })
  it('값이 없으면 빈 문자열 — 「절기」만 덩그러니 남지 않는다', () => {
    expect(seasonLabel('')).toBe('')
    expect(seasonLabel(null)).toBe('')
    expect(seasonLabel(undefined)).toBe('')
  })
  it('하이픈이 없으면 그대로 뒤에만 붙인다', () => {
    expect(seasonLabel('2026')).toBe('2026절기')
  })
})

describe('수요조사 탭의 백신 이름 — 괄호 제거', () => {
  it('★ 괄호 부분을 뺀다', () => {
    expect(shortVaccineName('독감(유료)')).toBe('독감')
    expect(shortVaccineName('독감(국가무료)')).toBe('독감')
    expect(shortVaccineName('독감(지자체)')).toBe('독감')
  })
  it('★ 괄호가 없는 이름은 한 글자도 바뀌지 않는다', () => {
    for (const n of ['독감', '대상포진', '폐렴구균 13가', 'A형간염']) {
      expect(shortVaccineName(n), n).toBe(n)
    }
  })
  it('★ 앞머리만 있는 이름도 그대로 — 괄호만 보고 자른다', () => {
    /* 공개 표시명에 접두어가 남아 있어도 이 함수는 괄호 외에는 건드리지 않는다 */
    expect(shortVaccineName('독감-1 지자체')).toBe('독감-1 지자체')
  })
  it('괄호 안쪽만 있는 이상한 값이면 원래 이름을 쓴다', () => {
    expect(shortVaccineName('(유료)')).toBe('(유료)')
  })
  it('전각 괄호도 뗀다', () => {
    expect(shortVaccineName('독감（유료）')).toBe('독감')
  })
  it('빈 값은 빈 문자열', () => {
    expect(shortVaccineName('')).toBe('')
    expect(shortVaccineName(null)).toBe('')
  })
})

describe('날짜 표기 — 2026. 9. 21. 형식', () => {
  it('★ 0 을 붙이지 않는다', () => {
    expect(fmtDotDate('2026-09-21')).toBe('2026. 9. 21.')
    expect(fmtDotDate('2026-10-31')).toBe('2026. 10. 31.')
    expect(fmtDotDate('2027-04-01')).toBe('2027. 4. 1.')
  })
  it('모양이 틀리면 빈 문자열', () => {
    for (const v of ['', null, '2026-09', 'abc']) expect(fmtDotDate(v), String(v)).toBe('')
  })
})

describe('요일 — KST 한 글자', () => {
  it('★ 2026-10-31 은 토요일', () => {
    expect(kstDow('2026-10-31')).toBe('토')
  })
  it('날짜 문자열은 KST 자정 기준으로 본다', () => {
    expect(kstDow('2026-11-01')).toBe('일')
    expect(kstDow('2026-11-02')).toBe('월')
  })
  it('모양이 틀리면 빈 문자열', () => {
    expect(kstDow('abc')).toBe('')
    expect(kstDow(null)).toBe('')
  })
})

describe('마감 시각 — 2026. 10. 31.(토) 18:00', () => {
  it('★ 승인 예시 그대로', () => {
    /* KST 18:00 = UTC 09:00 */
    expect(fmtCloseLong('2026-10-31T09:00:00Z')).toBe('2026. 10. 31.(토) 18:00')
  })
  it('★ 사용자 시간대와 무관하다 — 같은 순간이면 같은 글자', () => {
    expect(fmtCloseLong('2026-10-31T09:00:00+00:00')).toBe('2026. 10. 31.(토) 18:00')
    expect(fmtCloseLong('2026-10-31T18:00:00+09:00')).toBe('2026. 10. 31.(토) 18:00')
  })
  it('★ KST 자정을 넘기면 날짜·요일이 함께 넘어간다', () => {
    /* UTC 2026-10-31T15:30Z = KST 2026-11-01 00:30 (일) */
    expect(fmtCloseLong('2026-10-31T15:30:00Z')).toBe('2026. 11. 1.(일) 00:30')
  })
  it('값이 없으면 빈 문자열', () => {
    expect(fmtCloseLong('')).toBe('')
    expect(fmtCloseLong(null)).toBe('')
  })
})

describe('선택 가능 첫날 — max(오늘 KST, vax_start)', () => {
  const S = '2026-11-01', E = '2027-04-30'
  const at = iso => Date.parse(iso)

  it('접종 시작 전이면 접종 시작일', () => {
    expect(kstToday(at('2026-10-20T03:00:00Z'))).toBe('2026-10-20')
    expect(pickRange(S, E, at('2026-10-20T03:00:00Z'))).toEqual({ from: S, to: E })
  })
  it('접종 기간 중이면 오늘', () => {
    expect(pickRange(S, E, at('2026-12-25T03:00:00Z'))).toEqual({ from: '2026-12-25', to: E })
  })
  it('★ KST 자정 경계 — UTC 14:59Z 는 아직 어제, 15:00Z 부터 다음 날', () => {
    expect(kstToday(at('2026-12-24T14:59:00Z'))).toBe('2026-12-24')
    expect(kstToday(at('2026-12-24T15:00:00Z'))).toBe('2026-12-25')
    expect(pickRange(S, E, at('2026-12-24T15:00:00Z')).from).toBe('2026-12-25')
  })
  it('기간이 지나면 null', () => {
    expect(pickRange(S, E, at('2027-05-01T03:00:00Z'))).toBeNull()
  })
})

describe('신청 수량 — 본인 + 가족', () => {
  /* 화면은 (본인 ? 1 : 0) + 가족 수 로 센다. 서버 doseOf 와 같은 규칙이다. */
  const dose = (self, fam) => (self ? 1 : 0) + Number(fam || 0)
  it('★ 승인 예시', () => {
    expect(dose(true, 0)).toBe(1)
    expect(dose(true, 2)).toBe(3)
    expect(dose(false, 2)).toBe(2)
    expect(dose(false, 0)).toBe(0)
  })
  it('빈 값은 0 으로 본다', () => {
    expect(dose(true, '')).toBe(1)
    expect(dose(true, null)).toBe(1)
  })
})
