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

const TENANT = 'tenant-1'
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
function makeAnswer({ attempts = [], settings, stock = STOCK_TABLES, fail = {} } = {}) {
  return rec => {
    if (fail[rec.table]) return { data: null, error: { message: fail[rec.table] } }
    if (rec.table === 'vaccine_public_attempts') {
      return rec.op === 'select' ? ok(attempts) : { data: null, error: null }
    }
    if (rec.table === 'vaccine_public_settings') return ok(settings ? [settings] : [])
    return stock[rec.table] ?? ok([])
  }
}

function req({ pw = PW, ip = IP, method = 'POST' } = {}) {
  const h = new Map(ip ? [['x-nf-client-connection-ip', ip]] : [])
  return { method, headers: { get: k => h.get(k) ?? null }, json: async () => ({ pw }) }
}
const body = async res => JSON.parse(await res.text())

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.VACCINE_TOKEN_SECRET = 'test-secret'
  process.env.VACCINE_TENANT_ID = TENANT
  stub.admin = null
})

describe('성공 응답 — initial 이 stock 과 같은 형식으로 함께 온다', () => {
  it('키는 ok · token · initial 뿐이고 initial 은 season · updated_at · items 뿐', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const j = await body(await handler(req()))

    expect(Object.keys(j).sort()).toEqual(['initial', 'ok', 'token'])
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
    expect(Object.keys(j).sort()).toEqual(['ok', 'token'])
    expect(j.ok).toBe(true)
    expect(typeof j.token).toBe('string')
    spy.mockRestore()
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

  it('응답에 Cache-Control: no-store 가 붙고 CORS 헤더는 없다', async () => {
    stub.admin = fakeAdmin(makeAnswer({ settings: await settingsRow() }))
    const res = await handler(req())
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(null)
  })
})
