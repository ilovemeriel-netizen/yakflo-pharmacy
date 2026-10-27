/* 잔량 조회·판정 공용 모듈 — DB 없이 가짜 client 를 주입해 확인한다.
   보는 것: 상태 경계값 / 응답 필드가 딱 세 개 / 조회 순서와 병렬 / tenant_id 조건 유지 */
import { describe, it, expect } from 'vitest'
import { LOW_QTY, WARN_RATIO, stockStatus, loadStock } from './stock.js'

const TENANT = 'tenant-1'
const TODAY = '2026-10-27'

/* ── 가짜 Supabase client ───────────────────────────────────────────────────
   체이닝 메서드를 모두 자기 자신으로 돌려주고, 건 조건과 호출 순서를 기록한다.
   await 하면 { data, error } 로 풀리도록 then 을 둔다(PostgREST 빌더와 같은 모양). */
function fakeAdmin(tables, log = []) {
  return {
    calls: log,
    from(table) {
      const rec = { table, filters: [], order: null, limit: null }
      log.push(rec)
      const b = {
        select() { return b },
        eq(c, v) { rec.filters.push(['eq', c, v]); return b },
        lte(c, v) { rec.filters.push(['lte', c, v]); return b },
        gte(c, v) { rec.filters.push(['gte', c, v]); return b },
        not(c, op, v) { rec.filters.push(['not', c, op, v]); return b },
        in(c, v) { rec.filters.push(['in', c, v]); return b },
        order(c, o) { rec.order = [c, o]; return b },
        limit(n) { rec.limit = n; return b },
        then(res, rej) {
          const t = tables[table]
          const out = typeof t === 'function' ? t(rec) : t
          rec.settled = true
          return Promise.resolve(out ?? { data: [], error: null }).then(res, rej)
        },
      }
      return b
    },
  }
}
const ok = data => ({ data, error: null })
const fail = message => ({ data: null, error: { message } })

const ACC = (id, label, season = '2026-2027') => ({ id, season, public_label: label })
const BAL = (account_id, balance_qty, received_qty) => ({ account_id, balance_qty, received_qty })

describe('stockStatus — 경계값', () => {
  it('상수가 바뀌지 않았다', () => {
    expect(LOW_QTY).toBe(10)
    expect(WARN_RATIO).toBe(0.25)
  })
  it('0 이하는 소진', () => {
    expect(stockStatus(0, 100)).toBe('소진')
    expect(stockStatus(-1, 100)).toBe('소진')
    expect(stockStatus(null, 100)).toBe('소진')
  })
  it('10 이하는 부족, 11 부터는 부족이 아니다', () => {
    expect(stockStatus(1, 1000)).toBe('부족')
    expect(stockStatus(10, 1000)).toBe('부족')
    expect(stockStatus(11, 1000)).toBe('주의')
  })
  it('입고분의 1/4 미만이면 주의 — 정확히 1/4 은 충분', () => {
    expect(stockStatus(24, 100)).toBe('주의')
    expect(stockStatus(25, 100)).toBe('충분')
    expect(stockStatus(26, 100)).toBe('충분')
  })
  it('received 가 0 이면 주의 판정을 건너뛴다(0 으로 나누지 않는다)', () => {
    expect(stockStatus(50, 0)).toBe('충분')
    expect(stockStatus(50, null)).toBe('충분')
  })
})

describe('loadStock — 응답 형식', () => {
  it('필드가 season · updated_at · items 셋뿐이고 item 은 label · qty · status 셋뿐이다', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가'), ACC('a2', '코로나')]),
      v_vaccine_balance: ok([BAL('a1', 80, 100), BAL('a2', 8, 40)]),
      vaccine_events: ok([{ created_at: '2026-10-21T06:54:00Z' }]),
    })
    const got = await loadStock(admin, TENANT, TODAY)
    expect(got.ok).toBe(true)
    expect(Object.keys(got.data).sort()).toEqual(['items', 'season', 'updated_at'])
    for (const it of got.data.items) {
      expect(Object.keys(it).sort()).toEqual(['label', 'qty', 'status'])
    }
  })

  it('계정 정보가 응답에 새지 않는다 — id · public_label 외 필드는 실리지 않는다', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([{ ...ACC('a1', '독감 4가'), drug_code: 'SECRET', lot: 'L1' }]),
      v_vaccine_balance: ok([BAL('a1', 80, 100)]),
      vaccine_events: ok([]),
    })
    const got = await loadStock(admin, TENANT, TODAY)
    const text = JSON.stringify(got.data)
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('drug_code')
    expect(text).not.toContain('received_qty')
    expect(text).not.toContain('a1')
  })

  it('label 기준 한국어 정렬 · 상태는 stockStatus 와 같다', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '코로나'), ACC('a2', '독감 4가'), ACC('a3', '대상포진')]),
      v_vaccine_balance: ok([BAL('a1', 0, 50), BAL('a2', 80, 100), BAL('a3', 5, 60)]),
      vaccine_events: ok([{ created_at: '2026-10-21T06:54:00Z' }]),
    })
    const got = await loadStock(admin, TENANT, TODAY)
    expect(got.data.items.map(x => x.label)).toEqual(['대상포진', '독감 4가', '코로나'])
    expect(got.data.items.map(x => x.status)).toEqual(['부족', '충분', '소진'])
    expect(got.data.updated_at).toBe('2026-10-21T06:54:00Z')
    expect(got.data.season).toBe('2026-2027')
  })

  it('잔량 행이 없는 계정은 0 · 소진으로 나온다', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      v_vaccine_balance: ok([]),
      vaccine_events: ok([]),
    })
    const got = await loadStock(admin, TENANT, TODAY)
    expect(got.data.items).toEqual([{ label: '독감 4가', qty: 0, status: '소진' }])
    expect(got.data.updated_at).toBe(null)
  })

  it('공개 대상 계정이 없으면 빈 목록을 돌려주고 뒤 조회를 보내지 않는다', async () => {
    const log = []
    const admin = fakeAdmin({ vaccine_accounts: ok([]) }, log)
    const got = await loadStock(admin, TENANT, TODAY)
    expect(got).toEqual({ ok: true, data: { season: null, updated_at: null, items: [] } })
    expect(log.map(r => r.table)).toEqual(['vaccine_accounts'])
  })
})

describe('loadStock — 조회 순서와 조건', () => {
  it('계정을 먼저 읽고, 잔량과 마지막시각은 그 id 목록으로 함께 보낸다', async () => {
    const log = []
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가'), ACC('a2', '코로나')]),
      v_vaccine_balance: ok([BAL('a1', 80, 100), BAL('a2', 40, 50)]),
      vaccine_events: ok([{ created_at: '2026-10-21T06:54:00Z' }]),
    }, log)
    await loadStock(admin, TENANT, TODAY)
    expect(log.map(r => r.table)).toEqual(['vaccine_accounts', 'v_vaccine_balance', 'vaccine_events'])
    const ids = ['a1', 'a2']
    for (const t of ['v_vaccine_balance', 'vaccine_events']) {
      const rec = log.find(r => r.table === t)
      expect(rec.filters).toContainEqual(['in', 'account_id', ids])
    }
  })

  it('잔량·마지막시각은 동시에 나간다 — 앞의 것이 끝나기를 기다리지 않는다', async () => {
    const started = []
    let releaseBal
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      /* 잔량을 일부러 멈춰 둔다. 직렬이면 마지막시각 조회가 시작조차 못 한다. */
      v_vaccine_balance: () => {
        started.push('bal')
        return new Promise(res => { releaseBal = () => res(ok([BAL('a1', 80, 100)])) })
      },
      vaccine_events: () => { started.push('ev'); return ok([{ created_at: '2026-10-21T06:54:00Z' }]) },
    })
    const p = loadStock(admin, TENANT, TODAY)
    await new Promise(r => setTimeout(r, 0))
    expect(started).toEqual(['bal', 'ev'])   /* ★ 병렬 — 둘 다 시작했다 */
    releaseBal()
    const got = await p
    expect(got.ok).toBe(true)
  })

  it('세 조회 모두 tenant_id 조건을 직접 건다 (service_role 은 RLS 를 우회한다)', async () => {
    const log = []
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      v_vaccine_balance: ok([BAL('a1', 80, 100)]),
      vaccine_events: ok([]),
    }, log)
    await loadStock(admin, TENANT, TODAY)
    expect(log).toHaveLength(3)
    for (const rec of log) {
      expect(rec.filters).toContainEqual(['eq', 'tenant_id', TENANT])
    }
  })

  it('계정 조회는 활성·절기·표시명 조건을 그대로 건다', async () => {
    const log = []
    const admin = fakeAdmin({ vaccine_accounts: ok([]) }, log)
    await loadStock(admin, TENANT, TODAY)
    const f = log[0].filters
    expect(f).toContainEqual(['eq', 'is_active', true])
    expect(f).toContainEqual(['lte', 'season_start', TODAY])
    expect(f).toContainEqual(['gte', 'season_end', TODAY])
    expect(f).toContainEqual(['not', 'public_label', 'is', null])
  })

  it('마지막시각은 created_at 내림차순 1행만 받는다', async () => {
    const log = []
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      v_vaccine_balance: ok([BAL('a1', 80, 100)]),
      vaccine_events: ok([]),
    }, log)
    await loadStock(admin, TENANT, TODAY)
    const rec = log.find(r => r.table === 'vaccine_events')
    expect(rec.order).toEqual(['created_at', { ascending: false }])
    expect(rec.limit).toBe(1)
  })
})

describe('loadStock — 오류', () => {
  it('계정 조회 실패는 step 계정', async () => {
    const admin = fakeAdmin({ vaccine_accounts: fail('boom-acc') })
    expect(await loadStock(admin, TENANT, TODAY)).toEqual({ ok: false, step: '계정', message: 'boom-acc' })
  })
  it('잔량 조회 실패는 step 잔량', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      v_vaccine_balance: fail('boom-bal'),
      vaccine_events: ok([]),
    })
    expect(await loadStock(admin, TENANT, TODAY)).toEqual({ ok: false, step: '잔량', message: 'boom-bal' })
  })
  it('시각 조회 실패는 step 시각', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      v_vaccine_balance: ok([BAL('a1', 80, 100)]),
      vaccine_events: fail('boom-ev'),
    })
    expect(await loadStock(admin, TENANT, TODAY)).toEqual({ ok: false, step: '시각', message: 'boom-ev' })
  })
  it('둘 다 실패하면 잔량을 먼저 보고한다(직렬이던 때와 같은 메시지)', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가')]),
      v_vaccine_balance: fail('boom-bal'),
      vaccine_events: fail('boom-ev'),
    })
    expect((await loadStock(admin, TENANT, TODAY)).step).toBe('잔량')
  })
  it('실패 응답에는 data 를 싣지 않는다', async () => {
    const admin = fakeAdmin({ vaccine_accounts: fail('boom-acc') })
    expect((await loadStock(admin, TENANT, TODAY)).data).toBeUndefined()
  })
})
