/* Supabase 목록 읽기의 **조용한 절단** 잡아내기 (2026-11-05 이정화 님 승인)

   ★ 실제로 숫자가 틀렸던 일을 못으로 박는다 — 3개월 창 출고 1,079건이 1,000줄에 걸려
     79건이 조용히 잘리고, 그 안에 졸피드정10mg 63 이 있어 합계가 707→644 로 틀렸다. */
import { describe, it, expect } from 'vitest'
import { checkRowLimit, SUPABASE_DEFAULT_MAX_ROWS } from './rowLimit.js'

const rows = n => Array.from({ length: n }, (_, i) => ({ i }))

describe('checkRowLimit — 전체 줄 수를 알 때', () => {
  it('★ 1,079건 가운데 1,000건만 받으면 잘렸다고 한다 (실제 사례)', () => {
    const r = checkRowLimit(rows(1000), 1079)
    expect(r.cut).toBe(true)
    expect(r.got).toBe(1000)
    expect(r.total).toBe(1079)
    expect(r.missing).toBe(79)
    expect(r.message).toContain('1,079')
    expect(r.message).toContain('1,000')
    expect(r.message).toContain('79건 빠짐')
    expect(r.message).toContain('적용하지 마시고')
  })
  it('다 받았으면 잘리지 않았다고 한다', () => {
    const r = checkRowLimit(rows(29), 29)
    expect(r.cut).toBe(false)
    expect(r.missing).toBe(0)
    expect(r.message).toBe('')
  })
  it('★ 29건만 받아 오도록 좁힌 뒤의 모습 — 경고가 없다', () => {
    /* 마약·향정 코드만 .in() 으로 받으면 1,079 → 29 가 된다 */
    expect(checkRowLimit(rows(29), 29).message).toBe('')
  })
  it('1,000건을 받았는데 전체도 1,000건이면 잘린 게 아니다', () => {
    /* count 를 쓰면 **딱 맞는 경우를 잘못 의심하지 않는다** */
    expect(checkRowLimit(rows(1000), 1000).cut).toBe(false)
  })
  it('한 줄만 빠져도 잡는다', () => {
    const r = checkRowLimit(rows(999), 1000)
    expect(r.cut).toBe(true)
    expect(r.missing).toBe(1)
  })
  it('빈 목록도 전체가 0 이면 괜찮다', () => {
    expect(checkRowLimit([], 0).cut).toBe(false)
  })
})

describe('checkRowLimit — 전체 줄 수를 모를 때 (count 를 못 받음)', () => {
  it('한도에 딱 닿으면 의심한다', () => {
    const r = checkRowLimit(rows(1000), null)
    expect(r.cut).toBe(true)
    expect(r.total).toBeNull()
    expect(r.missing).toBeNull()
    expect(r.message).toContain('꽉 채워 받았습니다')
    expect(r.message).toContain('적용하지 마시고')
  })
  it('한도보다 적으면 괜찮다고 한다', () => {
    expect(checkRowLimit(rows(999), null).cut).toBe(false)
    expect(checkRowLimit(rows(29), undefined).cut).toBe(false)
  })
  it('data 가 아예 없어도 터지지 않는다', () => {
    for (const bad of [null, undefined, 'x', 7, {}]) {
      const r = checkRowLimit(bad, null)
      expect(r.cut).toBe(false)
      expect(r.got).toBe(0)
    }
  })
})

describe('한도 숫자는 판정에 쓰지 않는다 (설명·시험용)', () => {
  it('기본 한도는 1,000 이다', () => {
    expect(SUPABASE_DEFAULT_MAX_ROWS).toBe(1000)
  })
  it('★ 한도가 바뀌어도 count 판정은 그대로 맞는다', () => {
    /* 서버가 500 줄로 바뀌어도 「1,079 중 500」은 잘린 것이다 */
    expect(checkRowLimit(rows(500), 1079, 500).cut).toBe(true)
    expect(checkRowLimit(rows(500), 1079, 500).missing).toBe(579)
    /* 거꾸로 한도를 크게 줘도 count 가 맞으면 괜찮다 */
    expect(checkRowLimit(rows(1079), 1079, 500).cut).toBe(false)
  })
})
