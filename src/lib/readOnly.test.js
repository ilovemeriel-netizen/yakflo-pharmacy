/* 읽기 전용(뷰어) 감쌈개 — 2026-11-12
 *
 * 못 박는 것
 *   ① 뷰어가 아니면 **아무것도 안 바뀐다** (지금 쓰는 분들에게 영향 0)
 *   ② 뷰어면 insert·update·upsert·delete·rpc 가 **나가지 않는다**
 *   ③ ★ 읽기(select)는 **절대** 막지 않는다 — 뷰어는 단가·금액까지 다 본다
 *   ④ 막혔을 때 돌려주는 꼴이 supabase 와 같다 ({ data:null, error })
 *   ⑤ 역할 글자가 정확히 'viewer' 일 때만 막는다
 *
 * ★ 이것은 **안내**다. 진짜 자물쇠는 DB 트리거(0123)다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  guardWrites, setReadOnlyRole, isReadOnly, readOnlyError,
  VIEWER_ROLE, READ_ONLY_MSG,
} from './readOnly'

/* supabase 흉내 — 사슬을 그대로 돌려준다 */
function fakeClient(spy) {
  const q = {
    select: () => { spy.push('select'); return q },
    order: () => q, eq: () => q, range: () => q, limit: () => q, maybeSingle: () => q,
    insert: () => { spy.push('insert'); return q },
    update: () => { spy.push('update'); return q },
    upsert: () => { spy.push('upsert'); return q },
    delete: () => { spy.push('delete'); return q },
    then: res => Promise.resolve({ data: [{ ok: 1 }], error: null }).then(res),
  }
  return {
    from: (t) => { spy.push('from:' + t); return q },
    rpc: (n) => { spy.push('rpc:' + n); return Promise.resolve({ data: 1, error: null }) },
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  }
}

beforeEach(() => setReadOnlyRole(null))

describe('① 뷰어가 아니면 아무것도 안 바뀐다', () => {
  it('역할이 없으면 읽기 전용이 아니다', () => {
    expect(isReadOnly()).toBe(false)
  })
  it('owner · admin · member 는 읽기 전용이 아니다', () => {
    for (const r of ['owner', 'admin', 'member']) {
      setReadOnlyRole(r)
      expect(isReadOnly(), r).toBe(false)
    }
  })
  it('쓰기가 그대로 나간다', async () => {
    const spy = []
    const c = guardWrites(fakeClient(spy))
    const r = await c.from('drugs').insert([{ a: 1 }])
    expect(spy).toEqual(['from:drugs', 'insert'])
    expect(r.error).toBeNull()
  })
  it('rpc 도 그대로 나간다', async () => {
    const spy = []
    const c = guardWrites(fakeClient(spy))
    await c.rpc('app_recompute_usage')
    expect(spy).toEqual(['rpc:app_recompute_usage'])
  })
})

describe('② 뷰어면 쓰기가 나가지 않는다', () => {
  beforeEach(() => setReadOnlyRole(VIEWER_ROLE))

  it('읽기 전용으로 잡힌다', () => {
    expect(isReadOnly()).toBe(true)
  })

  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    it(m + ' 이 막힌다 — 사슬이 아예 안 불린다', async () => {
      const spy = []
      const c = guardWrites(fakeClient(spy))
      const r = await c.from('drugs')[m]([{ a: 1 }])
      expect(spy).toEqual(['from:drugs'])     /* insert 가 안 불렸다 */
      expect(r.data).toBeNull()
      expect(r.error.message).toBe(READ_ONLY_MSG)
      expect(r.error.code).toBe('42501')
    })
  }

  it('rpc 가 막힌다', async () => {
    const spy = []
    const c = guardWrites(fakeClient(spy))
    const r = await c.rpc('app_save_usage_bulk')
    expect(spy).toEqual([])
    expect(r.error.code).toBe('42501')
  })

  it('★ 뒤에 .eq().select() 를 붙여도 터지지 않는다', async () => {
    const c = guardWrites(fakeClient([]))
    const r = await c.from('drugs').update({ a: 1 }).eq('id', 1).select()
    expect(r.error.code).toBe('42501')
  })
})

describe('★ ③ 읽기는 절대 막지 않는다', () => {
  beforeEach(() => setReadOnlyRole(VIEWER_ROLE))
  it('select 가 그대로 나간다 — 단가·금액도 보인다', async () => {
    const spy = []
    const c = guardWrites(fakeClient(spy))
    const r = await c.from('drugs').select('purchase_price,price_unit,edi_price')
    expect(spy).toEqual(['from:drugs', 'select'])
    expect(r.error).toBeNull()
    expect(r.data).toEqual([{ ok: 1 }])
  })
  it('auth 같은 다른 길도 그대로다', async () => {
    const c = guardWrites(fakeClient([]))
    const r = await c.auth.getUser()
    expect(r.data).toEqual({ user: null })
  })
})

describe('④ 돌려주는 꼴이 supabase 와 같다', () => {
  it('data·error·status 가 들어 있다', () => {
    const e = readOnlyError()
    expect(e.data).toBeNull()
    expect(e.count).toBeNull()
    expect(e.status).toBe(403)
    expect(e.error).toEqual({ message: READ_ONLY_MSG, code: '42501', details: null, hint: null })
  })
})

describe('⑤ 역할 글자', () => {
  it('정확히 viewer 일 때만 막는다 — 대문자·공백은 아니다', () => {
    for (const r of ['Viewer', 'VIEWER', ' viewer', 'viewers', '']) {
      setReadOnlyRole(r)
      expect(isReadOnly(), JSON.stringify(r)).toBe(false)
    }
    setReadOnlyRole('viewer')
    expect(isReadOnly()).toBe(true)
  })
  it('VIEWER_ROLE 글자가 DB 와 같다', () => {
    expect(VIEWER_ROLE).toBe('viewer')
  })
})
