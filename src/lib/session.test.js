/* @vitest-environment node */
/* 쓰기 전에 로그인을 되살리는지 — 2026-11-05 「적용이 사라진」 일의 재발 방지. */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeGuardedFetch, isWriteRequest, isAuthPath, withToken, FRESH_MARGIN_SEC } from './session'

const rd = p => readFileSync(resolve(process.cwd(), p), 'utf8')
const NOW = 1762300000000            /* 고정 시각 */
const sec = ms => Math.floor(ms / 1000)

/* 흉내 auth — 남은 시간을 마음대로 주고, 갱신 호출 수를 센다 */
function fakeAuth(leftSec, opts) {
  const o = opts || {}
  const calls = { getSession: 0, refresh: 0 }
  return {
    calls,
    auth: {
      getSession: async () => {
        calls.getSession++
        if (o.noSession) return { data: { session: null } }
        if (o.throws) throw new Error('깨졌다')
        return { data: { session: { access_token: '옛표', expires_at: sec(NOW) + leftSec } } }
      },
      refreshSession: async () => {
        calls.refresh++
        if (o.refreshFails) return { data: { session: null }, error: { message: '갱신 실패' } }
        return { data: { session: { access_token: '새표', expires_at: sec(NOW) + 3600 } } }
      },
    },
  }
}

function harness(leftSec, opts) {
  const f = fakeAuth(leftSec, opts)
  const seen = []
  const baseFetch = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200 } }
  const g = makeGuardedFetch({ getAuth: () => f.auth, baseFetch, now: () => NOW })
  return { g, seen, calls: f.calls }
}

const authOf = r => {
  const h = (r.init && r.init.headers) || {}
  return h.Authorization || h.authorization || null
}

describe('무엇을 감쌀지 고르기', () => {
  it('쓰기만 감싼다', () => {
    expect(isWriteRequest('/x', { method: 'POST' })).toBe(true)
    expect(isWriteRequest('/x', { method: 'PATCH' })).toBe(true)
    expect(isWriteRequest('/x', { method: 'DELETE' })).toBe(true)
    expect(isWriteRequest('/x', { method: 'PUT' })).toBe(true)
    expect(isWriteRequest('/x', { method: 'GET' })).toBe(false)
    expect(isWriteRequest('/x', { method: 'HEAD' })).toBe(false)
    expect(isWriteRequest('/x', undefined), '방법이 없으면 GET 으로 본다').toBe(false)
  })
  it('★ 로그인 경로는 건드리지 않는다 — 갱신이 자기를 다시 부르면 안 된다', () => {
    expect(isAuthPath('https://x.supabase.co/auth/v1/token?grant_type=refresh_token')).toBe(true)
    expect(isAuthPath('https://x.supabase.co/rest/v1/rpc/app_recompute_usage')).toBe(false)
  })
})

describe('★ 만료 직전이면 먼저 갱신하고 새 표로 보낸다', () => {
  it('남은 시간 10초 — 갱신하고 머리글을 새 표로 바꿔 보낸다', async () => {
    const h = harness(10)
    await h.g('https://x.supabase.co/rest/v1/rpc/app_recompute_usage',
      { method: 'POST', headers: { Authorization: 'Bearer 옛표', apikey: 'k' } })
    expect(h.calls.refresh).toBe(1)
    expect(authOf(h.seen[0])).toBe('Bearer 새표')
    expect(h.seen[0].init.headers.apikey, '다른 머리글은 그대로 둔다').toBe('k')
  })
  it('이미 만료됐어도(남은 시간 음수) 갱신한다', async () => {
    const h = harness(-120)
    await h.g('https://x/rest/v1/drugs', { method: 'PATCH', headers: { Authorization: 'Bearer 옛표' } })
    expect(h.calls.refresh).toBe(1)
    expect(authOf(h.seen[0])).toBe('Bearer 새표')
  })
  it('넉넉하면(1시간 남음) 갱신하지 않고 그대로 보낸다', async () => {
    const h = harness(3600)
    await h.g('https://x/rest/v1/drugs', { method: 'POST', headers: { Authorization: 'Bearer 옛표' } })
    expect(h.calls.refresh).toBe(0)
    expect(authOf(h.seen[0])).toBe('Bearer 옛표')
  })
  it('경계는 ' + FRESH_MARGIN_SEC + '초다', async () => {
    const a = harness(FRESH_MARGIN_SEC + 5)
    await a.g('https://x/rest/v1/d', { method: 'POST' })
    expect(a.calls.refresh).toBe(0)
    const b = harness(FRESH_MARGIN_SEC - 5)
    await b.g('https://x/rest/v1/d', { method: 'POST' })
    expect(b.calls.refresh).toBe(1)
  })
})

describe('건드리지 않는 것', () => {
  it('읽기는 로그인을 보지도 않는다', async () => {
    const h = harness(-999)
    await h.g('https://x/rest/v1/drugs?select=*', { method: 'GET' })
    expect(h.calls.getSession).toBe(0)
    expect(h.calls.refresh).toBe(0)
  })
  it('로그인 경로는 그대로 보낸다', async () => {
    const h = harness(-999)
    await h.g('https://x/auth/v1/token?grant_type=refresh_token', { method: 'POST' })
    expect(h.calls.refresh).toBe(0)
    expect(h.seen.length).toBe(1)
  })
  it('★ 로그인하지 않은 사람(공개 화면)은 머리글을 바꾸지 않는다', async () => {
    const h = harness(0, { noSession: true })
    await h.g('https://x/rest/v1/rpc/submit', { method: 'POST', headers: { Authorization: 'Bearer anon' } })
    expect(h.calls.refresh).toBe(0)
    expect(authOf(h.seen[0])).toBe('Bearer anon')
  })
})

describe('★ 갱신이 안 돼도 요청을 먹지 않는다 — 서버가 거절하게 두고 화면이 빨간 글씨를 띄운다', () => {
  it('갱신 실패 — 그래도 보낸다(옛 표로). 조용히 사라지지 않는다', async () => {
    const h = harness(-10, { refreshFails: true })
    const r = await h.g('https://x/rest/v1/d', { method: 'POST', headers: { Authorization: 'Bearer 옛표' } })
    expect(h.calls.refresh).toBe(1)
    expect(h.seen.length, '요청을 삼키면 안 된다').toBe(1)
    expect(authOf(h.seen[0])).toBe('Bearer 옛표')
    expect(r.status).toBe(200)
  })
  it('getSession 이 터져도 보낸다', async () => {
    const h = harness(-10, { throws: true })
    await h.g('https://x/rest/v1/d', { method: 'POST' })
    expect(h.seen.length).toBe(1)
  })
})

describe('동시에 여러 번 저장해도 갱신은 한 번', () => {
  it('세 번 동시 — refreshSession 은 1번', async () => {
    const h = harness(5)
    await Promise.all([
      h.g('https://x/rest/v1/a', { method: 'POST' }),
      h.g('https://x/rest/v1/b', { method: 'POST' }),
      h.g('https://x/rest/v1/c', { method: 'POST' }),
    ])
    expect(h.calls.refresh).toBe(1)
    expect(h.seen.length).toBe(3)
  })
})

describe('머리글 모양을 가리지 않는다', () => {
  it('Headers 객체', () => {
    /* ★ Headers 는 아스키만 담을 수 있어 여기서는 old/new 로 적는다 */
    const init = { headers: new Headers({ Authorization: 'Bearer old', apikey: 'k' }) }
    const out = withToken(init, 'new')
    expect(out.headers.get('Authorization')).toBe('Bearer new')
    expect(out.headers.get('apikey')).toBe('k')
    expect(init.headers.get('Authorization'), '원본을 고치지 않는다').toBe('Bearer old')
  })
  it('[이름, 값] 목록', () => {
    const out = withToken({ headers: [['authorization', 'Bearer 옛표'], ['apikey', 'k']] }, '새표')
    expect(out.headers).toEqual([['apikey', 'k'], ['Authorization', 'Bearer 새표']])
  })
  it('보통 객체 — 대소문자가 달라도 겹치지 않는다', () => {
    const out = withToken({ headers: { authorization: 'Bearer 옛표' } }, '새표')
    expect(Object.keys(out.headers)).toEqual(['Authorization'])
    expect(out.headers.Authorization).toBe('Bearer 새표')
  })
  it('머리글이 없어도 된다', () => {
    expect(withToken({ method: 'POST' }, '새표').headers.Authorization).toBe('Bearer 새표')
    expect(withToken(undefined, '새표').headers.Authorization).toBe('Bearer 새표')
  })
})

describe('클라이언트에 실제로 끼워졌는지 — 소스로 못 박는다', () => {
  const SRC = rd('src/lib/supabase.js')
  it('createClient 에 감싼 fetch 를 넘긴다', () => {
    expect(SRC).toContain("import { makeGuardedFetch } from './session'")
    expect(SRC).toMatch(/global:\s*\{\s*fetch:\s*guardedFetch\s*\}/)
  })
  it('★ 한 곳에서 감싸므로 저장 단추를 따로 고치지 않아도 된다', () => {
    expect(SRC).toContain('makeGuardedFetch({ getAuth: () => supabase && supabase.auth })')
  })
})

describe('로그인이 풀린 오류를 알아보는지', async () => {
  const { isLoginExpired, LOGIN_EXPIRED_MSG, dbErrorMsg } = await import('./dbError')
  for (const e of [{ code: 'PGRST301' }, { status: 401 }, { message: 'JWT expired' },
    { message: 'invalid JWT: unable to parse' }, { message: 'Invalid Refresh Token' }]) {
    it('로그인 문제: ' + JSON.stringify(e), () => {
      expect(isLoginExpired(e)).toBe(true)
      expect(dbErrorMsg(e)).toBe(LOGIN_EXPIRED_MSG)
    })
  }
  it('★ 42501(권한 없음)은 로그인 문제가 아니다 — 섞으면 엉뚱한 안내가 나간다', () => {
    const e = { code: '42501', message: 'permission denied for function app_recompute_usage' }
    expect(isLoginExpired(e)).toBe(false)
    expect(dbErrorMsg(e)).not.toBe(LOGIN_EXPIRED_MSG)
  })
  it('기존 판정은 그대로다', () => {
    expect(dbErrorMsg({ code: '23505' })).toBe('이미 등록된 항목입니다.')
    expect(dbErrorMsg({ code: '23514', message: '마감된 월입니다' })).toBe('마감된 월입니다')
    expect(dbErrorMsg(null)).toBe(null)
  })
  it('안내 문구는 새로고침을 알려 준다', () => {
    expect(LOGIN_EXPIRED_MSG).toContain('로그인이 풀렸습니다')
    expect(LOGIN_EXPIRED_MSG).toContain('새로고침')
  })
})

/* vi 를 쓰지 않더라도 불러 두면 vitest 설정이 바뀌었을 때 바로 드러난다 */
describe('시험 뼈대', () => { it('vi 를 쓸 수 있다', () => { expect(typeof vi.fn).toBe('function') }) })
