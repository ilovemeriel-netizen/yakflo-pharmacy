/* 공개 조회 화면 표시 상태 — 응답 전/빈 목록/목록 세 가지와 「깜빡임 없음」을 못으로 박는다 */
import { describe, it, expect } from 'vitest'
import { itemsOf, viewState, totalOf } from './stockView'

const one = (label, qty, status) => ({ label, qty, status })
const resp = (items, extra = {}) => ({ season: '2026-2027', updated_at: null, items, ...extra })

describe('itemsOf — null 과 [] 를 구별한다', () => {
  it('응답이 없으면 null', () => {
    expect(itemsOf(null)).toBe(null)
    expect(itemsOf(undefined)).toBe(null)
  })
  it('items 가 없거나 배열이 아니면 null (형식이 어긋난 응답을 「없음」으로 단정하지 않는다)', () => {
    expect(itemsOf({})).toBe(null)
    expect(itemsOf({ items: null })).toBe(null)
    expect(itemsOf({ items: '없음' })).toBe(null)
    expect(itemsOf({ items: 0 })).toBe(null)
  })
  it('빈 배열은 그대로 돌려준다 — 「진짜 없음」은 유효한 답이다', () => {
    const r = resp([])
    expect(itemsOf(r)).toEqual([])
    expect(itemsOf(r)).not.toBe(null)
  })
  it('목록은 그대로 돌려준다', () => {
    expect(itemsOf(resp([one('가', 5, '부족')]))).toHaveLength(1)
  })
})

describe('viewState — 세 가지 상태', () => {
  it('응답 전은 loading (★ 이것이 "공개 중인 백신이 없습니다" 오표시를 막는 지점)', () => {
    expect(viewState(null)).toBe('loading')
    expect(viewState(undefined)).toBe('loading')
    expect(viewState({})).toBe('loading')
  })
  it('응답을 받았고 비었으면 empty', () => {
    expect(viewState(resp([]))).toBe('empty')
  })
  it('목록이 있으면 list', () => {
    expect(viewState(resp([one('가', 1, '부족')]))).toBe('list')
  })
})

describe('viewState — 자동 갱신 중 깜빡이지 않는다', () => {
  it('목록이 있으면 loading 이 켜져도 list 를 유지한다', () => {
    const r = resp([one('가', 80, '충분'), one('나', 8, '부족')])
    expect(viewState(r, false)).toBe('list')
    expect(viewState(r, true)).toBe('list')
  })
  it('한 종만 있어도 마찬가지다', () => {
    expect(viewState(resp([one('가', 1, '부족')]), true)).toBe('list')
  })
  it('응답 전에는 loading 인자와 무관하게 loading', () => {
    expect(viewState(null, false)).toBe('loading')
    expect(viewState(null, true)).toBe('loading')
  })
  it('빈 목록에서 수동 새로고침을 누르면 loading 으로 돌아간다(기존 동작 유지)', () => {
    expect(viewState(resp([]), true)).toBe('loading')
    expect(viewState(resp([]), false)).toBe('empty')
  })
})

describe('totalOf', () => {
  it('응답 전에는 0', () => {
    expect(totalOf(null)).toBe(0)
    expect(totalOf({})).toBe(0)
  })
  it('빈 목록은 0', () => {
    expect(totalOf(resp([]))).toBe(0)
  })
  it('qty 를 더한다', () => {
    expect(totalOf(resp([one('가', 80, '충분'), one('나', 8, '부족')]))).toBe(88)
  })
  it('qty 가 없거나 문자열이어도 깨지지 않는다', () => {
    expect(totalOf(resp([{ label: '가' }, one('나', '7', '부족'), null]))).toBe(7)
  })
})
