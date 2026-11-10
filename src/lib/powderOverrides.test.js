/* 고친 번호를 읽고 쓰는 모듈 — 2026-11-10 (0119)
 *
 * 못 박는 것
 *   ① 1,000줄 함정 — 쪽을 나눠 끝까지 읽는다
 *   ② 여러 개는 **한 번의 upsert** 로 보낸다 (나눠 보내면 절반만 바뀐다)
 *   ③ 1~9 밖의 번호는 **보내기 전에** 막는다
 *   ④ 되돌리기는 줄을 지운다
 *   ⑤ 읽은 것을 나눠 쓰고, 고치면 버린다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const from = vi.fn()
vi.mock('./supabase', () => ({ supabase: { from: (...a) => from(...a) } }))

const M = await import('./powderOverrides')

function chainFor(rows, opt) {
  const o = opt || {}
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, order: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    then: res => {
      if (o.error) return Promise.resolve({ data: null, error: o.error }).then(res)
      return Promise.resolve({ data: rows.slice(lo, hi + 1), error: null }).then(res)
    },
  }
  return chain
}

beforeEach(() => { from.mockReset(); M.invalidateOverrides() })

describe('① 쪽을 나눠 끝까지 읽는다', () => {
  const many = n => Array.from({ length: n }, (_, i) => ({ drug_code: 'C' + i, group_no: 1 }))

  it('1,150줄을 두 쪽으로 전부 읽는다', async () => {
    from.mockImplementation(() => chainFor(many(1150)))
    const { rows, error } = await M.fetchOverrides()
    expect(error).toBeNull()
    expect(rows.length).toBe(1150)
    expect(from).toHaveBeenCalledTimes(2)
  })
  it('한 쪽이면 한 번만 읽는다', async () => {
    from.mockImplementation(() => chainFor(many(3)))
    await M.fetchOverrides()
    expect(from).toHaveBeenCalledTimes(1)
  })
  it('오류면 빈 배열과 오류를 함께 돌려준다 — 조용히 넘어가지 않는다', async () => {
    from.mockImplementation(() => chainFor([], { error: { message: '권한 없음' } }))
    const { rows, error } = await M.fetchOverrides()
    expect(rows).toEqual([])
    expect(error.message).toBe('권한 없음')
  })
})

describe('② 여러 개는 한 번에 보낸다', () => {
  it('upsert 를 한 번만 부른다', async () => {
    const upsert = vi.fn(rows => ({ select: () => Promise.resolve({ data: rows.map(r => ({ drug_code: r.drug_code })), error: null }) }))
    from.mockImplementation(() => ({ upsert }))
    const r = await M.setOverrideMany(['A', 'B', 'C'], 9, '까닭')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].length).toBe(3)
    expect(r.saved).toBe(3)
    expect(r.error).toBeNull()
  })
  it('같은 코드가 겹치면 하나로 줄인다', async () => {
    const upsert = vi.fn(rows => ({ select: () => Promise.resolve({ data: rows, error: null }) }))
    from.mockImplementation(() => ({ upsert }))
    await M.setOverrideMany(['A', 'A', ' A ', 'B'], 1)
    expect(upsert.mock.calls[0][0].map(r => r.drug_code)).toEqual(['A', 'B'])
  })
  it('빈 목록이면 아무것도 보내지 않는다', async () => {
    from.mockImplementation(() => ({ upsert: vi.fn() }))
    const r = await M.setOverrideMany([], 9)
    expect(r.saved).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })
  it('까닭을 비우면 null 로 보낸다', async () => {
    const upsert = vi.fn(rows => ({ select: () => Promise.resolve({ data: rows, error: null }) }))
    from.mockImplementation(() => ({ upsert }))
    await M.setOverrideMany(['A'], 5, '')
    expect(upsert.mock.calls[0][0][0].note).toBeNull()
  })
  it('★ 보낸 줄과 저장된 줄이 다르면 그 수를 그대로 알린다', async () => {
    const upsert = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ drug_code: 'A' }], error: null }) }))
    from.mockImplementation(() => ({ upsert }))
    const r = await M.setOverrideMany(['A', 'B'], 9)
    expect(r.sent).toBe(2)
    expect(r.saved).toBe(1)
  })
})

describe('③ 1~9 밖은 보내기 전에 막는다', () => {
  for (const bad of [0, 10, -1, 99, 1.5, null, undefined, 'abc']) {
    it(JSON.stringify(bad) + ' — 막힌다', async () => {
      from.mockImplementation(() => ({ upsert: vi.fn() }))
      const one = await M.setOverride('A', bad)
      const many = await M.setOverrideMany(['A'], bad)
      expect(one.error).toBeTruthy()
      expect(many.error).toBeTruthy()
      expect(from).not.toHaveBeenCalled()
    })
  }
  for (const good of [1, 5, 9, '9']) {
    it(JSON.stringify(good) + ' — 통과한다', async () => {
      const upsert = vi.fn(() => Promise.resolve({ error: null }))
      from.mockImplementation(() => ({ upsert }))
      expect((await M.setOverride('A', good)).error).toBeNull()
    })
  }
})

describe('④ 되돌리기는 줄을 지운다', () => {
  it('그 약품코드로 delete 한다', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const del = vi.fn(() => ({ eq }))
    from.mockImplementation(() => ({ delete: del }))
    const r = await M.clearOverride('MGM')
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('drug_code', 'MGM')
    expect(r.error).toBeNull()
  })
  it('오류를 삼키지 않는다', async () => {
    from.mockImplementation(() => ({ delete: () => ({ eq: () => Promise.resolve({ error: { message: '권한 없음' } }) }) }))
    expect((await M.clearOverride('A')).error.message).toBe('권한 없음')
  })
})

describe('⑤ 읽은 것을 나눠 쓰고, 고치면 버린다', () => {
  it('두 번 불러도 한 번만 읽는다', async () => {
    from.mockImplementation(() => chainFor([{ drug_code: 'A', group_no: 1 }]))
    await Promise.all([M.loadOverrides(), M.loadOverrides()])
    await M.loadOverrides()
    expect(from).toHaveBeenCalledTimes(1)
  })
  it('고치고 나면 다시 읽는다', async () => {
    from.mockImplementation(() => chainFor([{ drug_code: 'A', group_no: 1 }]))
    await M.loadOverrides()
    expect(from).toHaveBeenCalledTimes(1)
    const upsert = vi.fn(() => Promise.resolve({ error: null }))
    from.mockImplementation(() => ({ upsert }))
    await M.setOverride('A', 2)
    from.mockImplementation(() => chainFor([{ drug_code: 'A', group_no: 2 }]))
    const { rows } = await M.loadOverrides()
    expect(rows[0].group_no).toBe(2)
  })
  it('되돌려도 다시 읽는다', async () => {
    from.mockImplementation(() => chainFor([{ drug_code: 'A', group_no: 1 }]))
    await M.loadOverrides()
    from.mockImplementation(() => ({ delete: () => ({ eq: () => Promise.resolve({ error: null }) }) }))
    await M.clearOverride('A')
    from.mockImplementation(() => chainFor([]))
    expect((await M.loadOverrides()).rows).toEqual([])
  })
})

describe('표·칸 이름을 박아 둔다', () => {
  it('표 이름', () => { expect(M.TABLE).toBe('drug_powder_override') })
  it('읽는 칸에 까닭·누가·언제가 들어 있다', () => {
    for (const k of ['drug_code', 'group_no', 'note', 'created_by', 'created_at', 'updated_by', 'updated_at']) {
      expect(M.COLS, k).toContain(k)
    }
  })
})
