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

/* ═══ 시즌 백신 / 상시 백신 두 칸 (2026-11-13 이정화 님 승인) ═══════════════
   못 박는 것
     ① group 칸만 본다 — 이름 글자를 해석하지 않는다
     ② 두 묶음이 모두 있을 때만 제목을 그린다(한쪽뿐이면 지금 화면 그대로)
     ③ 묶음별 합계가 전체 합계와 어긋나지 않는다 */
import { groupsOf, sumOf, GROUP_ALWAYS } from './stockView'

const IT = (label, qty, group) => ({ label, qty, status: '충분', group, drug_name: '', maker: '' })

describe('★ groupsOf — 시즌/상시 가르기', () => {
  it('group 칸으로 가른다 — 이름은 보지 않는다', () => {
    const g = groupsOf({ items: [
      IT('폐렴구균(프리베나20)', 2, '상시'),
      IT('독감(유료)', 21, '시즌'),
      IT('대상포진(싱그릭스)', 5, '상시'),
    ] })
    expect(g.season.map(x => x.label)).toEqual(['독감(유료)'])
    expect(g.always.map(x => x.label)).toEqual(['폐렴구균(프리베나20)', '대상포진(싱그릭스)'])
    expect(g.split).toBe(true)
  })

  it('★ 이름이 「상시」여도 group 이 시즌이면 시즌이다', () => {
    const g = groupsOf({ items: [IT('상시 독감', 1, '시즌'), IT('폐렴구균', 1, '상시')] })
    expect(g.season.map(x => x.label)).toEqual(['상시 독감'])
  })

  it('아는 값이 아니면 시즌으로 센다 — 서버 기본값과 같다', () => {
    for (const v of [undefined, null, '', '기타']) {
      const g = groupsOf({ items: [IT('가', 1, v), IT('나', 1, '상시')] })
      expect(g.season.map(x => x.label), String(v)).toEqual(['가'])
    }
  })

  it('★ 한쪽만 있으면 제목을 그리지 않는다 (지금까지의 화면 그대로)', () => {
    expect(groupsOf({ items: [IT('독감', 1, '시즌')] }).split).toBe(false)
    expect(groupsOf({ items: [IT('폐렴구균', 1, '상시')] }).split).toBe(false)
  })

  it('목록이 비었거나 응답 전이면 가르지 않는다', () => {
    expect(groupsOf({ items: [] })).toEqual({ season: [], always: [], split: false })
    expect(groupsOf(null)).toEqual({ season: [], always: [], split: false })
    expect(groupsOf(undefined).split).toBe(false)
  })

  it('상시의 글자는 한 곳에만 둔다', () => {
    expect(GROUP_ALWAYS).toBe('상시')
  })
})

describe('★ sumOf — 묶음별 합계', () => {
  it('묶음 합이 전체 합과 같다 — 운영 실측값(2026-11-13)', () => {
    const items = [
      IT('독감(국가무료)', 27, '시즌'), IT('독감(유료)', 21, '시즌'), IT('독감(지자체)', 10, '시즌'),
      IT('코로나(모더나)', 0, '시즌'), IT('코로나(화이자)', 16, '시즌'),
      IT('대상포진(스카이조스터)', 2, '상시'), IT('대상포진(싱그릭스)', 5, '상시'),
      IT('폐렴구균(프로디악스23)', 10, '상시'), IT('폐렴구균(프리베나20)', 2, '상시'),
    ]
    const g = groupsOf({ items })
    expect(sumOf(g.season)).toBe(74)
    expect(sumOf(g.always)).toBe(19)
    expect(sumOf(g.season) + sumOf(g.always)).toBe(totalOf({ items }))
  })

  it('값이 없어도 터지지 않는다', () => {
    expect(sumOf([])).toBe(0)
    expect(sumOf(null)).toBe(0)
    expect(sumOf([{ qty: null }, { qty: undefined }, {}])).toBe(0)
  })
})
