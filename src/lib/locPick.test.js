/* 위치별 약품 창 — 고르기·거르기 규칙 시험. */
import { describe, it, expect } from 'vitest'
import {
  SEARCH_LIMIT, DEBOUNCE_MS, canPick, pickBlockedReason, BLOCK_TEXT,
  currentLocSummary, summaryText, filterByCategory, toggleCategory, isCategoryOn,
} from './locPick.js'

const d = (o) => ({ status: '사용', storage_location: 'D-1', category: '경구제', ...o })

describe('상수', () => {
  it('한 번에 50건까지 · 0.3초 디바운스', () => {
    expect(SEARCH_LIMIT).toBe(50)
    expect(DEBOUNCE_MS).toBe(300)
  })
})

describe('pickBlockedReason — 체크할 수 없는 줄', () => {
  it('중지 약품은 가져올 수 없다', () => {
    expect(pickBlockedReason(d({ status: '중지', storage_location: 'O-1' }), 'D-1')).toBe('중지')
    expect(canPick(d({ status: '중지', storage_location: 'O-1' }), 'D-1')).toBe(false)
  })
  it('★ 중지가 「이미있음」보다 먼저다 — 중지이면서 이 위치인 약품도 중지로 막는다', () => {
    expect(pickBlockedReason(d({ status: '중지', storage_location: 'D-1' }), 'D-1')).toBe('중지')
  })
  it('이미 이 위치에 있으면 가져올 수 없다', () => {
    expect(pickBlockedReason(d({ storage_location: 'D-1' }), 'D-1')).toBe('이미있음')
  })
  it('위치 없음과 빈 글자는 같게 본다', () => {
    expect(pickBlockedReason(d({ storage_location: null }), '')).toBe('이미있음')
    expect(pickBlockedReason(d({ storage_location: '' }), '')).toBe('이미있음')
  })
  it('다른 위치의 사용·휴면 약품은 가져올 수 있다', () => {
    expect(canPick(d({ storage_location: 'O-1' }), 'D-1')).toBe(true)
    expect(canPick(d({ status: '휴면', storage_location: 'O-1' }), 'D-1')).toBe(true)
    expect(canPick(d({ storage_location: null }), 'D-1')).toBe(true)
  })
  it('막힌 까닭마다 설명이 있다', () => {
    for (const k of ['중지', '이미있음', '없음']) expect(BLOCK_TEXT[k]).toBeTruthy()
  })
})

describe('currentLocSummary · summaryText — 확인 창의 「지금 위치」', () => {
  const rows = [
    d({ storage_location: 'D-1' }), d({ storage_location: 'D-1' }),
    d({ storage_location: 'O-1' }),
    d({ storage_location: null }),
  ]
  it('많은 곳부터, 위치 없는 것은 맨 뒤', () => {
    expect(currentLocSummary(rows)).toEqual([
      { loc: 'D-1', n: 2 }, { loc: 'O-1', n: 1 }, { loc: null, n: 1 },
    ])
  })
  it('지시문과 같은 문장이 된다', () => {
    expect(summaryText([d({ storage_location: 'D-1' }), d({ storage_location: 'D-1' }), d({ storage_location: 'O-1' })]))
      .toBe('D-1 2건, O-1 1건')
  })
  it('위치 없는 약품은 「위치 없음」으로 적는다', () => {
    expect(summaryText([d({ storage_location: null })])).toBe('위치 없음 1건')
  })
  it('건수가 같으면 이름순 — 같은 선택이면 늘 같은 문장', () => {
    const a = summaryText([d({ storage_location: 'O-1' }), d({ storage_location: 'D-1' })])
    const b = summaryText([d({ storage_location: 'D-1' }), d({ storage_location: 'O-1' })])
    expect(a).toBe(b)
    expect(a).toBe('D-1 1건, O-1 1건')
  })
  it('빈 선택은 빈 글자', () => expect(summaryText([])).toBe(''))
})

describe('구분 복수 필터', () => {
  const ALL = ['경구제', '주사제', '외용제']
  const rows = [d({ category: '경구제' }), d({ category: '주사제' }), d({ category: '외용제' }), d({ category: '경구제' })]

  it('null 은 전체 — 아무것도 거르지 않는다', () => {
    expect(filterByCategory(rows, null)).toHaveLength(4)
  })
  it('고른 구분만 남는다 (복수)', () => {
    expect(filterByCategory(rows, ['경구제', '주사제'])).toHaveLength(3)
    expect(filterByCategory(rows, ['외용제'])).toHaveLength(1)
  })
  it('★ 빈 배열은 아무 줄도 안 보인다 — 전체로 접지 않는다', () => {
    expect(filterByCategory(rows, [])).toHaveLength(0)
  })
  it('토글 — 전체에서 하나를 끄면 나머지가 남는다', () => {
    expect(toggleCategory(null, '주사제', ALL)).toEqual(['경구제', '외용제'])
  })
  it('토글 — 다시 켜서 전부가 되면 전체(null)로 접는다', () => {
    expect(toggleCategory(['경구제', '외용제'], '주사제', ALL)).toBe(null)
  })
  it('토글 — 하나씩 끄다 마지막까지 끄면 빈 배열', () => {
    let v = null
    for (const c of ALL) v = toggleCategory(v, c, ALL)
    expect(v).toEqual([])
  })
  it('토글 결과는 늘 전체 목록의 순서를 따른다', () => {
    expect(toggleCategory(['외용제'], '경구제', ALL)).toEqual(['경구제', '외용제'])
  })
  it('isOn — 전체면 전부 켜 보인다', () => {
    for (const c of ALL) expect(isCategoryOn(null, c)).toBe(true)
    expect(isCategoryOn(['경구제'], '경구제')).toBe(true)
    expect(isCategoryOn(['경구제'], '주사제')).toBe(false)
    expect(isCategoryOn([], '경구제')).toBe(false)
  })
})
