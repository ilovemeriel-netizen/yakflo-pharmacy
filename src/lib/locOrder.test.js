import { describe, it, expect } from 'vitest'
import { planReorder } from './locOrder'

/* 조회 순서(sort_order → label)로 들어온 행들. 실제 데이터처럼 번호에 구멍을 둔다. */
const R = (label, sort_order, extra) => ({ id: 'id-' + label, label, sort_order, code: label + ' 설명', is_active: true, tenant_id: 'T1', ...extra })
const FOUR = [R('A', 1), R('B', 2), R('C', 4), R('D', 7)]

const labels = ups => ups.map(u => u.label)
const pairs = ups => ups.map(u => [u.label, u.sort_order])

/* 변경분만 돌아오므로, 저장 후의 전체 모습은 원본에 덮어써서 확인한다 */
const applyPlan = (rows, ups) => {
  const m = new Map(ups.map(u => [u.id, u.sort_order]))
  return rows
    .map(r => ({ label: r.label, sort_order: m.has(r.id) ? m.get(r.id) : r.sort_order }))
    .sort((a, b) => a.sort_order - b.sort_order)
}
const finalOrder = (rows, from, to) => applyPlan(rows, planReorder(rows, from, to)).map(r => r.label)
const finalNums = (rows, from, to) => applyPlan(rows, planReorder(rows, from, to)).map(r => r.sort_order)

describe('planReorder', () => {
  it('맨 위로', () => {
    /* D(7) 를 맨 위로 → D,A,B,C. C 는 4→4 로 그대로여서 변경분에서 빠진다 */
    expect(pairs(planReorder(FOUR, 0 + 3, 0))).toEqual([['D', 1], ['A', 2], ['B', 3]])
    expect(finalOrder(FOUR, 3, 0)).toEqual(['D', 'A', 'B', 'C'])
    expect(finalNums(FOUR, 3, 0)).toEqual([1, 2, 3, 4])
  })

  it('맨 아래로', () => {
    /* A(1) 를 맨 아래로 → B,C,D,A — 네 행 모두 번호가 바뀐다 */
    expect(pairs(planReorder(FOUR, 0, FOUR.length - 1))).toEqual([['B', 1], ['C', 2], ['D', 3], ['A', 4]])
    expect(finalOrder(FOUR, 0, FOUR.length - 1)).toEqual(['B', 'C', 'D', 'A'])
    expect(finalNums(FOUR, 0, FOUR.length - 1)).toEqual([1, 2, 3, 4])
  })

  it('한 칸 위', () => {
    /* C 를 한 칸 위로 → A,C,B,D. A 는 이미 1 이라 빠진다 */
    expect(pairs(planReorder(FOUR, 2, 1))).toEqual([['C', 2], ['B', 3], ['D', 4]])
    expect(finalOrder(FOUR, 2, 1)).toEqual(['A', 'C', 'B', 'D'])
    expect(finalNums(FOUR, 2, 1)).toEqual([1, 2, 3, 4])
  })

  it('한 칸 아래', () => {
    /* B 를 한 칸 아래로 → A,C,B,D (한 칸 위와 같은 결과) */
    expect(pairs(planReorder(FOUR, 1, 2))).toEqual([['C', 2], ['B', 3], ['D', 4]])
    expect(finalOrder(FOUR, 1, 2)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('이미 맨 위인 행을 맨 위로 — 순서는 그대로, 번호 구멍만 메워진다', () => {
    expect(pairs(planReorder(FOUR, 0, 0))).toEqual([['C', 3], ['D', 4]])
    expect(finalOrder(FOUR, 0, 0)).toEqual(['A', 'B', 'C', 'D'])
    expect(finalNums(FOUR, 0, 0)).toEqual([1, 2, 3, 4])
  })

  it('번호가 이미 1..N 이고 순서도 그대로면 변경 0건', () => {
    const tidy = [R('A', 1), R('B', 2), R('C', 3)]
    expect(planReorder(tidy, 0, 0)).toEqual([])
    expect(planReorder(tidy, 1, 1)).toEqual([])
    expect(planReorder(tidy, 2, 2)).toEqual([])
  })

  it('구멍 있는 입력 (1,2,4,7) 은 어떤 이동을 해도 1..N 이 된다', () => {
    for (let from = 0; from < FOUR.length; from++)
      for (let to = 0; to < FOUR.length; to++)
        expect(finalNums(FOUR, from, to)).toEqual([1, 2, 3, 4])
  })

  it('sort_order 가 null 인 행도 번호를 받는다', () => {
    const withNull = [R('A', 1), R('B', null), R('C', 3)]
    expect(pairs(planReorder(withNull, 0, 0))).toEqual([['B', 2]])
  })

  it('label·code·is_active·tenant_id·id 는 바뀌지 않는다', () => {
    const [first] = planReorder(FOUR, 3, 0)
    expect(first).toEqual({ id: 'id-D', label: 'D', code: 'D 설명', is_active: true, tenant_id: 'T1', sort_order: 1 })
  })

  it('음수·0 sort_order 를 만들지 않는다', () => {
    for (let from = 0; from < FOUR.length; from++)
      for (let to = 0; to < FOUR.length; to++)
        for (const u of planReorder(FOUR, from, to)) expect(u.sort_order).toBeGreaterThan(0)
  })

  it('범위를 벗어난 입력은 안전하게 처리한다', () => {
    expect(planReorder([], 0, 0)).toEqual([])
    expect(planReorder(FOUR, -1, 0)).toEqual([])
    expect(planReorder(FOUR, 9, 0)).toEqual([])
    expect(planReorder(null, 0, 0)).toEqual([])
    /* 목표가 범위를 넘으면 양 끝으로 당긴다 */
    expect(labels(planReorder(FOUR, 0, 99))).toEqual(['B', 'C', 'D', 'A'])
    expect(finalOrder(FOUR, 3, -5)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('34행 전수 이동에서도 항상 1..34 가 유지된다', () => {
    /* 운영 실측 모양: 34행, 번호 구멍 3개(16·24·29 없음), 최대 37 */
    const big = []
    let so = 0
    for (let i = 0; i < 34; i++) { so++; if (so === 16 || so === 24 || so === 29) so++; big.push(R('L' + i, so)) }
    expect(big[big.length - 1].sort_order).toBe(37)
    for (const to of [0, 5, 17, 33]) {
      const nums = applyPlan(big, planReorder(big, 24, to)).map(r => r.sort_order)
      expect(nums).toEqual(Array.from({ length: 34 }, (_, i) => i + 1))
    }
  })

  it('입력 배열과 행 객체를 변형하지 않는다', () => {
    const before = JSON.stringify(FOUR)
    planReorder(FOUR, 3, 0)
    expect(JSON.stringify(FOUR)).toBe(before)
  })
})
