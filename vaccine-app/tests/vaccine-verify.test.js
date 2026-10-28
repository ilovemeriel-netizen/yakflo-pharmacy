/* @vitest-environment node */
/* vaccine-verify 핸들러 — Supabase 클라이언트만 가짜로 바꿔 끼우고 실제로 호출한다.
   보는 것: 성공 응답의 initial 형식이 stock 과 같은지 / 기존 분기(NO_IP·NOT_SET·실패·잠금)가 그대로인지 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ★ 핸들러가 만드는 클라이언트를 가짜로 바꾼다 — 이 파일은 DB 에 닿지 않는다 */
const stub = { admin: null }
vi.mock('@supabase/supabase-js', () => ({ createClient: () => stub.admin }))

const { default: handler, hashPw, makeSalt, PW_MAX_FAIL, PW_LOCK_MIN, PW_MSG } =
  await import('../netlify/functions/vaccine-verify.js')
const { loadStock } = await import('../netlify/functions/_lib/stock.js')

/* ★ 환경변수 형식 검사(_lib/env.js)가 붙었으므로 시험 설정값도 **실제와 같은 모양**이어야 한다.
   tenant 는 UUID, 비밀키는 JWT, 토큰 비밀값은 32자 이상. */
const TENANT = '1b7e1f6a-2c3d-4e5f-8a9b-0c1d2e3f4a5b'
const GOOD_URL = 'https://example.supabase.co'
const GOOD_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln'
const GOOD_SECRET = 's'.repeat(32)
const PW = '1234'
const IP = '203.0.113.9'

/* ── 가짜 client — 체이닝을 받아 두고 테이블·동작별로 답을 돌려준다 ── */
function fakeAdmin(answer, log = []) {
  const METHODS = ['select', 'eq', 'lt', 'gt', 'or', 'limit', 'in', 'lte', 'gte', 'not', 'order', 'maybeSingle']
  return {
    from(table) {
      const rec = { table, op: 'select', filters: [] }
      log.push(rec)
      const b = {}
      for (const m of METHODS) b[m] = (...a) => { rec.filters.push([m, ...a]); return b }
      b.delete = (...a) => { rec.op = 'delete'; rec.filters.push(['delete', ...a]); return b }
      b.upsert = (...a) => { rec.op = 'upsert'; rec.filters.push(['upsert', ...a]); return b }
      b.then = (res, rej) => Promise.resolve(answer(rec)).then(res, rej)
      return b
    },
    _log: log,
  }
}
const ok = data => ({ data, error: null })

/* 공개 대상 계정 2종 — 합계 88 (현재 운영과 같은 모양) */
const STOCK_TABLES = {
  vaccine_accounts: ok([
    { id: 'a1', season: '2026-2027', public_label: '독감 4가' },
    { id: 'a2', season: '2026-2027', public_label: '코로나' },
  ]),
  v_vaccine_balance: ok([
    { account_id: 'a1', balance_qty: 80, received_qty: 100 },
    { account_id: 'a2', balance_qty: 8, received_qty: 40 },
  ]),
  vaccine_events: ok([{ created_at: '2026-10-21T06:54:00Z' }]),
}

/* settings 행 — 실제 scrypt 해시를 넣어 verifyPw 가 참으로 통과하게 한다 */
async function settingsRow(pw = PW) {
  const salt = makeSalt()
  return { pw_hash: await hashPw(pw, salt), pw_salt: salt, updated_at: '2026-10-27T05:00:00Z' }
}

/* answer 조립 — attempts/settings 는 시나리오별로, 잔량 3종은 공통 */
function makeAnswer({ attempts = [], settings, stock = STOCK_TABLES, fail = {},
  surveys = [], accountLabel = null } = {}) {
  return rec => {
    if (fail[rec.table]) return { data: null, error: { message: fail[rec.table] } }
    if (rec.table === 'vaccine_public_attempts') {
      return rec.op === 'select' ? ok(attempts) : { data: null, error: null }
    }
    if (rec.table === 'vaccine_public_settings') return ok(settings ? [settings] : [])
    if (rec.table === 'vaccine_surveys') return ok(surveys)
    /* vaccine_accounts 는 두 곳에서 쓰인다 — 잔량(loadStock)과 회차 표시명(loadOpenSurvey).
       표시명 조회는 public_label 만 고르므로 select 목록으로 구별한다. */
    if (rec.table === 'vaccine_accounts' && accountLabel != null
        && rec.filters.some(f => f[0] === 'eq' && f[1] === 'id')) {
      return ok([{ public_label: accountLabel }])
    }
    return stock[rec.table] ?? ok([])
  }
}

function req({ pw = PW, ip = IP, method = 'POST' } = {}) {
  const h = new Map(ip ? [['x-nf-client-connection-ip', ip]] : [])
  return { method, headers: { get: k => h.get(k) ?? null }, json: async () => ({ pw }) }
}
const body = async res => JSON.parse(await res.text())

beforeEach(() => {
  process.env.SUPABASE_URL = GOOD_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = GOOD_JWT
  process.env.VACCINE_TOKEN_SECRET = GOOD_SECRET
  process.env.VACCINE_TENANT_ID = TENANT
  stub.admin = null
})

describe('성공 응답 — initial 이 stock 과 같은 형식으로 함께 온다', () => {
  it('키는 ok · token · initial · survey 뿐이고 initial 은 season · updated_at · items 뿐', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const j = await body(await handler(req()))

    /* survey 는 2026-10-28 에 추가됐다 — 열린 회차가 없으면 null 로 온다(탭을 그리지 않는다) */
    expect(Object.keys(j).sort()).toEqual(['initial', 'ok', 'survey', 'token'])
    expect(j.survey).toBe(null)
    expect(j.ok).toBe(true)
    expect(typeof j.token).toBe('string')
    expect(Object.keys(j.initial).sort()).toEqual(['items', 'season', 'updated_at'])
    for (const it of j.initial.items) {
      expect(Object.keys(it).sort()).toEqual(['label', 'qty', 'status'])
    }
  })

  it('initial 의 값이 loadStock 결과와 글자 단위로 같다 — 판정이 두 곳으로 갈라지지 않는다', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const j = await body(await handler(req()))

    const direct = await loadStock(fakeAdmin(makeAnswer({})), TENANT, '2026-10-27')
    expect(j.initial).toEqual(direct.data)
    expect(j.initial.items.map(x => x.label)).toEqual(['독감 4가', '코로나'])
    expect(j.initial.items.map(x => x.status)).toEqual(['충분', '부족'])
  })

  it('품목 식별 정보는 실리지 않는다', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const j = await body(await handler(req()))
    /* ★ initial 만 본다 — 토큰은 서명 base64 라 아무 글자나 우연히 들어간다 */
    const text = JSON.stringify(j.initial)
    for (const bad of ['drug_code', 'received_qty', 'account_id', 'a1', 'a2']) {
      expect(text).not.toContain(bad)
    }
  })

  it('첫 데이터 조회가 실패하면 initial 없이 로그인은 성공시킨다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stub.admin = fakeAdmin(makeAnswer({
      settings: await settingsRow(),
      fail: { vaccine_accounts: 'boom-acc' },
    }))
    const res = await handler(req())
    const j = await body(res)

    expect(res.status).toBe(200)
    /* initial 만 빠진다 — survey 조회는 따로여서 영향받지 않는다 */
    expect(Object.keys(j).sort()).toEqual(['ok', 'survey', 'token'])
    expect(j.initial).toBeUndefined()
    expect(j.ok).toBe(true)
    expect(typeof j.token).toBe('string')
    spy.mockRestore()
  })

  it('열린 회차가 있으면 survey 가 실려 온다 — 탭 표시가 늦지 않게', async () => {
    stub.admin = fakeAdmin(makeAnswer({
      settings: await settingsRow(),
      surveys: [{
        title: '독감(유료) 수요조사', season: '2026-2027', account_id: 'a1',
        vax_start: '2026-11-01', vax_end: '2026-11-30', close_at: '2026-11-20T14:59:59Z',
      }],
      accountLabel: '독감(유료)',
    }))
    const j = await body(await handler(req()))
    expect(j.survey).toEqual({
      title: '독감(유료) 수요조사',
      season: '2026-2027',
      public_label: '독감(유료)',
      vax_start: '2026-11-01',
      vax_end: '2026-11-30',
      close_at: '2026-11-20T14:59:59Z',
    })
    /* ★ 회차 id·account_id·분류는 공개 응답에 싣지 않는다 */
    const text = JSON.stringify(j.survey)
    for (const bad of ['account_id', 'a1', 'category', 'id"']) expect(text).not.toContain(bad)
  })

  it('잠금 행 삭제와 첫 데이터 조회가 함께 나간다 — 삭제가 끝나기를 기다리지 않는다', async () => {
    const log = []
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }), log)
    await handler(req())
    const tables = log.map(r => r.table)
    /* 성공 분기의 삭제 바로 뒤에 계정 조회가 붙는다(그 사이에 await 가 없다) */
    const delIdx = log.findIndex(r => r.table === 'vaccine_public_attempts' && r.op === 'delete' && !r.filters.some(f => f[0] === 'lt'))
    expect(delIdx).toBeGreaterThan(-1)
    expect(tables[delIdx + 1]).toBe('vaccine_accounts')
  })
})

describe('기존 분기가 그대로다', () => {
  it('IP 헤더가 없으면 scrypt 전에 400 NO_IP', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const res = await handler(req({ ip: null }))
    const j = await body(res)
    expect(res.status).toBe(400)
    expect(j.code).toBe('NO_IP')
    /* 끊기 전이라 DB 에 닿지 않는다 */
    expect(stub.admin._log).toHaveLength(0)
  })

  it('비밀번호 미설정이면 403 NOT_SET (initial 없음)', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: null }))
    const res = await handler(req())
    const j = await body(res)
    expect(res.status).toBe(403)
    expect(j.code).toBe('NOT_SET')
    expect(j.initial).toBeUndefined()
    expect(j.token).toBeUndefined()
  })

  it('비밀번호가 틀리면 401 이고 initial·token 이 없다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow('9999') }))
    const res = await handler(req({ pw: '1234' }))
    const j = await body(res)
    expect(res.status).toBe(401)
    expect(j.ok).toBe(false)
    expect(j.initial).toBeUndefined()
    expect(j.token).toBeUndefined()
    spy.mockRestore()
  })

  it('잠겨 있으면 429 LOCKED 이고 설정조회까지 가지 않는다', async () => {
    const until = new Date(Date.now() + PW_LOCK_MIN * 60_000).toISOString()
    const log = []
    stub.admin = fakeAdmin(makeAnswer({
      attempts: [{ fail_count: PW_MAX_FAIL, locked_until: until }],
      settings: await settingsRow(),
    }), log)
    const res = await handler(req())
    const j = await body(res)
    expect(res.status).toBe(429)
    expect(j.code).toBe('LOCKED')
    expect(log.map(r => r.table)).toEqual(['vaccine_public_attempts'])
  })

  it('자릿수가 안 맞으면 400 이고 DB 에 닿지 않는다', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const res = await handler(req({ pw: '12' }))
    expect(res.status).toBe(400)
    expect((await body(res)).message).toBe(PW_MSG)
    expect(stub.admin._log).toHaveLength(0)
  })

  it('GET 은 405', async () => {
    stub.admin = fakeAdmin(makeAnswer({}))
    expect((await handler(req({ method: 'GET' }))).status).toBe(405)
  })

  it('★ 환경변수 형식이 어긋나면 DB·scrypt 전에 500 SERVER_CONFIG', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.SUPABASE_URL = 'x'                  /* 2026-10-27 사고와 같은 한 글자 값 */
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))

    const res = await handler(req())
    const j = await body(res)
    expect(res.status).toBe(500)
    expect(j).toEqual({ ok: false, code: 'SERVER_CONFIG', message: '서버 설정 오류입니다 · 문의 약제과 내선 217' })
    expect(stub.admin._log).toHaveLength(0)         /* DB 에 닿지 않았다 */

    /* 로그에는 변수 이름과 기대 모양만 — 값("x")은 남지 않는다 */
    const logged = spy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toContain('SUPABASE_URL')
    expect(logged).toContain('환경변수 형식 오류')
    expect(logged).not.toMatch(/:\s*x\b/)
    spy.mockRestore()
  })

  it('비밀값이 로그에 찍히지 않는다 — 네 변수를 모두 어긋나게 둬도', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.SUPABASE_URL = 'LEAK-URL'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'LEAK-KEY'
    process.env.VACCINE_TOKEN_SECRET = 'LEAK-SECRET'
    process.env.VACCINE_TENANT_ID = 'LEAK-TENANT'
    stub.admin = fakeAdmin(makeAnswer({}))

    expect((await handler(req())).status).toBe(500)
    const logged = spy.mock.calls.map(c => c.join(' ')).join('\n')
    for (const v of ['LEAK-URL', 'LEAK-KEY', 'LEAK-SECRET', 'LEAK-TENANT']) {
      expect(logged).not.toContain(v)
    }
    expect(logged).toContain('SUPABASE_URL')        /* 이름은 남는다 */
    spy.mockRestore()
  })

  it('응답에 Cache-Control: no-store 가 붙고 CORS 헤더는 없다', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const res = await handler(req())
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(null)
  })
})
