/* 「오래됐다」 판정 — 영업일 기준 24시간.

   ★ 이 시험이 고정하는 것
     ① 주말은 세지 않는다 — 금요일 오후 입력이 월요일 아침에 「오래됨」으로 뜨지 않는다.
       (달력 시간으로 재면 64시간이라 매주 월요일마다 띠가 떴다. 그러면 아무도 띠를 안 본다.)
     ② 평일 안에서는 **정확히 24시간**이 경계다.
     ③ 경계는 **KST** 로 가른다 — 금요일 밤 입력이 토요일로 새지 않게.
     ④ 입력 기록이 없으면 판단하지 않는다.

   ★ 시각은 모두 KST 문자열(+09:00)로 적는다 — 읽는 사람이 요일을 셀 수 있게. */
import { describe, it, expect } from 'vitest'
import { businessMs, isStale, staleText, STALE_BUSINESS_MS, STALE_HEAD, STALE_TAIL } from './stale'

const H = 3600000
const at = s => Date.parse(s)           /* '2026-10-30T09:00:00+09:00' */
const hours = ms => ms / H

/* 요일 확인용 — 시험이 쓰는 날짜가 정말 그 요일인지 먼저 못 박는다.
   날짜를 잘못 고르면 시험이 조용히 뜻을 잃는다. */
describe('시험이 쓰는 날짜의 요일 (KST)', () => {
  const DOW = ['일', '월', '화', '수', '목', '금', '토']
  const 요일 = iso => DOW[new Date(at(iso) + 9 * H).getUTCDay()]
  it('★ 2026-10-30 은 금요일', () => expect(요일('2026-10-30T12:00:00+09:00')).toBe('금'))
  it('★ 2026-10-31 은 토요일', () => expect(요일('2026-10-31T12:00:00+09:00')).toBe('토'))
  it('★ 2026-11-01 은 일요일', () => expect(요일('2026-11-01T12:00:00+09:00')).toBe('일'))
  it('★ 2026-11-02 는 월요일', () => expect(요일('2026-11-02T12:00:00+09:00')).toBe('월'))
  it('★ 2026-11-03 은 화요일', () => expect(요일('2026-11-03T12:00:00+09:00')).toBe('화'))
  it('★ 2026-11-04 는 수요일', () => expect(요일('2026-11-04T12:00:00+09:00')).toBe('수'))
})

describe('businessMs — 토·일은 세지 않는다', () => {
  it('평일 안에서는 그냥 흐른 시간', () => {
    expect(hours(businessMs(at('2026-11-03T10:00:00+09:00'), at('2026-11-04T10:00:00+09:00')))).toBe(24)
  })
  it('★ 금 17시 → 월 09시 = 16시간 (주말 48시간을 뺀다)', () => {
    expect(hours(businessMs(at('2026-10-30T17:00:00+09:00'), at('2026-11-02T09:00:00+09:00')))).toBe(16)
  })
  it('★ 금 17시 → 월 18시 = 25시간', () => {
    expect(hours(businessMs(at('2026-10-30T17:00:00+09:00'), at('2026-11-02T18:00:00+09:00')))).toBe(25)
  })
  it('★ 토요일 안에서만 흐르면 0', () => {
    expect(businessMs(at('2026-10-31T01:00:00+09:00'), at('2026-10-31T23:00:00+09:00'))).toBe(0)
  })
  it('★ 금 23:30 → 토 00:30 = 30분 (KST 자정에서 끊긴다)', () => {
    expect(businessMs(at('2026-10-30T23:30:00+09:00'), at('2026-10-31T00:30:00+09:00'))).toBe(30 * 60 * 1000)
  })
  it('거꾸로이거나 같은 시각이면 0', () => {
    expect(businessMs(at('2026-11-04T10:00:00+09:00'), at('2026-11-03T10:00:00+09:00'))).toBe(0)
    expect(businessMs(at('2026-11-04T10:00:00+09:00'), at('2026-11-04T10:00:00+09:00'))).toBe(0)
  })
  it('숫자가 아니면 0 — 터지지 않는다', () => {
    expect(businessMs(NaN, at('2026-11-04T10:00:00+09:00'))).toBe(0)
    expect(businessMs(at('2026-11-04T10:00:00+09:00'), NaN)).toBe(0)
  })
  it('아주 긴 구간도 답을 준다(하루씩 세다 멈추지 않는다)', () => {
    const r = businessMs(at('2020-01-01T00:00:00+09:00'), at('2026-01-01T00:00:00+09:00'))
    expect(r).toBeGreaterThan(0)
  })
})

describe('isStale — 24 영업시간이 경계다', () => {
  const FRI17 = '2026-10-30T17:00:00+09:00'

  it('★ 금 17시 입력 → 월 09시: 띠 없음 (16영업시간)', () => {
    expect(isStale(FRI17, at('2026-11-02T09:00:00+09:00'))).toBe(false)
  })
  it('★ 금 17시 입력 → 월 18시: 띠 있음 (25영업시간)', () => {
    expect(isStale(FRI17, at('2026-11-02T18:00:00+09:00'))).toBe(true)
  })
  it('★ 금 17시 입력 → 월 17시: 딱 24영업시간 = 띠 있음', () => {
    expect(isStale(FRI17, at('2026-11-02T17:00:00+09:00'))).toBe(true)
  })
  it('★ 금 17시 입력 → 월 16:59: 띠 없음', () => {
    expect(isStale(FRI17, at('2026-11-02T16:59:00+09:00'))).toBe(false)
  })

  const TUE10 = '2026-11-03T10:00:00+09:00'
  it('★ 화 10시 → 수 10시: 딱 24시간 = 띠 있음', () => {
    expect(isStale(TUE10, at('2026-11-04T10:00:00+09:00'))).toBe(true)
  })
  it('★ 화 10시 → 수 09:59: 띠 없음', () => {
    expect(isStale(TUE10, at('2026-11-04T09:59:00+09:00'))).toBe(false)
  })
  it('★ 주말 내내 지나도 평일 24시간을 못 넘기면 띠 없음', () => {
    /* 금 23:00 입력 → 월 22:00 = 평일 23시간 */
    expect(isStale('2026-10-30T23:00:00+09:00', at('2026-11-02T22:00:00+09:00'))).toBe(false)
  })

  it('★ 입력 기록이 없으면 판단하지 않는다', () => {
    expect(isStale(null, Date.now())).toBe(false)
    expect(isStale(undefined, Date.now())).toBe(false)
    expect(isStale('', Date.now())).toBe(false)
    expect(isStale('말이 안 되는 값', Date.now())).toBe(false)
  })
  it('방금 입력했으면 띠 없음', () => {
    expect(isStale(new Date().toISOString(), Date.now())).toBe(false)
  })
  it('경계값이 24시간이다', () => {
    expect(STALE_BUSINESS_MS).toBe(24 * H)
  })
})

describe('띠 문구 — 사용자 확정본', () => {
  it('★ 원문 그대로', () => {
    expect(staleText('10월 28일 15:36'))
      .toBe('잔량 정보는 10월 28일 15:36 기준입니다. 실제 수량과 다를 수 있습니다.')
  })
  it('★ 앞뒤 조각이 화면과 같은 것을 쓴다', () => {
    expect(STALE_HEAD + 'X' + STALE_TAIL).toBe(staleText('X'))
  })
  it('★ 「N일 전」 같은 말을 쓰지 않는다 — 날짜만 보여 준다', () => {
    expect(staleText('10월 28일 15:36')).not.toMatch(/일 전/)
  })
})
