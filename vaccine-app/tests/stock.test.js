/* 잔량 조회·판정 공용 모듈 — DB 없이 가짜 client 를 주입해 확인한다.
   보는 것: 상태 경계값 / 응답 필드가 딱 세 개 / 조회 순서와 병렬 / tenant_id 조건 유지 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LOW_QTY, LEAD_TIME_DAYS, reorderPoint, stockStatus, normGroup,
  GROUP_SEASON, GROUP_ALWAYS, loadStock,
} from '../netlify/functions/_lib/stock.js'

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
/* 상시 계정 — 0127 public_group. 약품코드가 있어야 재고현황에서 잔량이 온다. */
const ACC_ALWAYS = (id, label, drug_code) =>
  ({ id, season: '상시', public_label: label, drug_code, public_group: '상시' })
const DRUG = (drug_code, current_qty, drug_name = '', manufacturer = '') =>
  ({ drug_code, drug_name, manufacturer, current_qty })
const BAL = (account_id, balance_qty, received_qty) => ({ account_id, balance_qty, received_qty })

/* ══════════════════════════════════════════════════════════════════════════
   ★★ 뱃지 — **약플로 안전재고와 같은 잣대** (2026-11-15 이정화 님 승인)
     0 → 소진 / 잔량 ≤ 안전재고 → 부족 / 잔량 ≤ 재주문점 → 주의 / 그 위 → 충분
     재주문점 = max(올림(안전재고 + 월평균÷30×14), 1) — 약플로 stockStat 과 같은 식
   ★ 안전재고 **0 은 값이다**(「0개만 있으면 된다」). 「기준 없음」이 아니다.
   ══════════════════════════════════════════════════════════════════════════ */
describe('★★ stockStatus — 안전재고 기준 4단계', () => {
  it('상수', () => {
    expect(LOW_QTY, '안전재고를 모를 때만 쓰는 옛 경계').toBe(10)
    expect(LEAD_TIME_DAYS, '약플로 LEAD_TIME 과 같아야 한다').toBe(14)
  })

  it('0 이하는 소진 — 안전재고와 상관없다', () => {
    for (const sf of [0, 5, 50, null]) {
      expect(stockStatus(0, sf, 10), String(sf)).toBe('소진')
      expect(stockStatus(-1, sf, 10), String(sf)).toBe('소진')
      expect(stockStatus(null, sf, 10), String(sf)).toBe('소진')
    }
  })

  it('★ 잔량 ≤ 안전재고 → 부족 (약플로 「긴급」과 같은 경계 · **이하**)', () => {
    expect(stockStatus(4, 5, 0)).toBe('부족')
    expect(stockStatus(5, 5, 0), '경계는 이하다').toBe('부족')
    expect(stockStatus(6, 5, 0), '안전재고를 넘으면 부족이 아니다').not.toBe('부족')
  })

  it('★ 잔량 ≤ 재주문점 → 주의 (약플로 「주문필요」와 같은 경계)', () => {
    /* 안전재고 5 · 월평균 30 → 재주문점 = 올림(5 + 30÷30×14) = 19 */
    expect(reorderPoint(5, 30)).toBe(19)
    expect(stockStatus(6, 5, 30)).toBe('주의')
    expect(stockStatus(19, 5, 30), '경계는 이하다').toBe('주의')
    expect(stockStatus(20, 5, 30)).toBe('충분')
  })

  it('★★ 안전재고 0 은 **값**이다 — 잔량이 있으면 부족이 아니다', () => {
    /* 운영 drugs 1,133줄 가운데 safety_stock 이 NULL 인 줄은 0줄이다(2026-11-15 실측) */
    expect(reorderPoint(0, 0), '최소 1 이다').toBe(1)
    expect(stockStatus(1, 0, 0), '재주문점 1 이하라 주의').toBe('주의')
    expect(stockStatus(2, 0, 0), '2개면 충분하다').toBe('충분')
    expect(stockStatus(10, 0, 0), '옛 규칙이었다면 부족이었다').toBe('충분')
  })

  it('★ 안전재고를 **모를 때만** 옛 규칙(10개 이하 부족)으로 받친다', () => {
    expect(stockStatus(10, null, 0)).toBe('부족')
    expect(stockStatus(11, null, 0)).toBe('충분')
    expect(stockStatus(10, undefined, 0)).toBe('부족')
    expect(stockStatus(10, '', 0)).toBe('부족')
    expect(reorderPoint(null, 10), '모르면 재주문점도 없다').toBeNull()
  })

  it('★ 사용량 판정(「3개월 사용량 0」 류)은 **쓰지 않는다** — 재고 대 안전재고만 본다', () => {
    const SRC = readFileSync(resolve(process.cwd(), 'vaccine-app/netlify/functions/_lib/stock.js'), 'utf8')
    /* 코드에 쓰이는 이름으로 본다 — 주석의 설명 문구까지 막지는 않는다 */
    for (const bad of ['tierOf', 'recent_3m_usage', 'unusedStock', 'isUnusedLabel']) {
      expect(SRC.includes(bad), bad + ' 를 뱃지 판정에 쓰면 안 된다').toBe(false)
    }
  })

  it('★★ 안전재고 숫자는 **공개 응답에 싣지 않는다**', () => {
    const SRC = readFileSync(resolve(process.cwd(), 'vaccine-app/netlify/functions/_lib/stock.js'), 'utf8')
    const ret = SRC.slice(SRC.indexOf('return {\n      label:'), SRC.indexOf('}).sort('))
    expect(ret.includes('safety_stock'), '안전재고가 응답에 샜다').toBe(false)
    expect(ret.includes('monthly_avg'), '월평균이 응답에 샜다').toBe(false)
  })
})

describe('★ normGroup — 아는 값이 아니면 시즌', () => {
  it('두 값만 그대로', () => {
    expect(normGroup('상시')).toBe(GROUP_ALWAYS)
    expect(normGroup('시즌')).toBe(GROUP_SEASON)
  })
  it('빈 값·이상한 값은 시즌 (DB 기본값과 같다)', () => {
    for (const v of [null, undefined, '', '기타', 'always']) expect(normGroup(v)).toBe(GROUP_SEASON)
  })
})

describe('★ 시즌/상시 — 잔량의 출처가 다르다 (2026-11-13)', () => {
  const base = {
    vaccine_accounts: ok([
      ACC('a1', '독감(유료)'),
      ACC_ALWAYS('a2', '폐렴구균(프로디악스23)', 'PRDX23-6'),
    ]),
    v_vaccine_balance: ok([BAL('a1', 21, 150), BAL('a2', 0, 0)]),
    vaccine_events: ok([{ created_at: '2026-11-12T08:34:35Z' }]),
    drugs: ok([DRUG('PRDX23-6', 10, '프로디악스-23', '한국엠에스디(주)')]),
    transactions: ok([{ created_at: '2026-11-13T01:00:00Z' }]),
  }

  it('★ 상시는 약플로 재고현황(current_qty) 을 쓴다 — 백신관리 기록(0)이 아니다', async () => {
    const got = await loadStock(fakeAdmin(base), TENANT, TODAY)
    const a = got.data.items.find(x => x.group === '상시')
    expect(a.qty).toBe(10)
    expect(a.status).toBe('부족')
  })

  it('★★ 시즌도 **약플로 안전재고**로 잰다 — 입고 비율을 더는 쓰지 않는다', async () => {
    const got = await loadStock(fakeAdmin(base), TENANT, TODAY)
    const s = got.data.items.find(x => x.group === '시즌')
    expect(s.qty, '잔량은 백신관리 값 그대로다').toBe(21)
    /* 가짜 drugs 에 안전재고가 없다 → 모를 때 갈래(10 초과면 충분) */
    expect(s.status).toBe('충분')
  })

  it('★★ 시즌 — 안전재고가 있으면 그 잣대로 잰다', async () => {
    /* 시즌 계정에도 약품코드를 달아 둔다 — 그래야 약플로 안전재고를 찾는다 */
    const withSf = { ...base,
      vaccine_accounts: ok([{ id: 'a1', season: '2026-2027', public_label: '독감(유료)', drug_code: 'D-SEASON' },
        ACC_ALWAYS('a2', '폐렴구균(프로디악스23)', 'PRDX23-6')]),
      drugs: ok([{ drug_code: 'D-SEASON', drug_name: '시즌약', manufacturer: '제약', current_qty: 99, safety_stock: 30, monthly_avg: 0 },
        DRUG('PRDX23-6', 10, '프로디악스-23', '한국엠에스디(주)')]) }
    const got = await loadStock(fakeAdmin(withSf), TENANT, TODAY)
    const s = got.data.items.find(x => x.group === '시즌')
    expect(s.qty, '잔량은 백신관리 값(21) 그대로 — 약플로 현재고(99)가 아니다').toBe(21)
    expect(s.status, '21 ≤ 30 이라 부족').toBe('부족')
  })

  it('★ 상시인데 약품이 안 잡히면 0(소진) — 없는 숫자를 지어내지 않는다', async () => {
    const got = await loadStock(fakeAdmin({ ...base, drugs: ok([]) }), TENANT, TODAY)
    const a = got.data.items.find(x => x.group === '상시')
    expect(a.qty).toBe(0)
    expect(a.status).toBe('소진')
  })

  it('★ 약품 조회가 실패해도 시즌 잔량은 그대로 나온다', async () => {
    const got = await loadStock(fakeAdmin({ ...base, drugs: fail('boom') }), TENANT, TODAY)
    expect(got.ok).toBe(true)
    expect(got.data.items.find(x => x.group === '시즌').qty).toBe(21)
    expect(got.data.items.find(x => x.group === '상시').qty).toBe(0)
  })

  it('★ 머리글 절기는 시즌 계정만 보고 정한다', async () => {
    const got = await loadStock(fakeAdmin(base), TENANT, TODAY)
    expect(got.data.season).toBe('2026-2027')
  })

  it('★ 상시 계정만 있으면 절기가 보이지 않는다 (「상시절기」가 나오지 않는다)', async () => {
    const got = await loadStock(fakeAdmin({
      ...base,
      vaccine_accounts: ok([ACC_ALWAYS('a2', '폐렴구균(프로디악스23)', 'PRDX23-6')]),
    }), TENANT, TODAY)
    expect(got.data.season).toBe(null)
  })

  it('★ 마지막 입력은 백신관리와 입출고 중 나중 것', async () => {
    const got = await loadStock(fakeAdmin(base), TENANT, TODAY)
    expect(got.data.updated_at).toBe('2026-11-13T01:00:00Z')   /* 입출고 쪽이 나중 */
  })

  it('입출고가 없으면 백신관리 시각을 그대로 쓴다', async () => {
    const got = await loadStock(fakeAdmin({ ...base, transactions: ok([]) }), TENANT, TODAY)
    expect(got.data.updated_at).toBe('2026-11-12T08:34:35Z')
  })

  it('입출고 조회가 실패해도 시각이 사라지지 않는다', async () => {
    const got = await loadStock(fakeAdmin({ ...base, transactions: fail('boom') }), TENANT, TODAY)
    expect(got.ok).toBe(true)
    expect(got.data.updated_at).toBe('2026-11-12T08:34:35Z')
  })

  it('★ 상시 계정이 없으면 입출고를 아예 읽지 않는다', async () => {
    const log = []
    await loadStock(fakeAdmin({
      ...base, vaccine_accounts: ok([ACC('a1', '독감(유료)')]),
    }, log), TENANT, TODAY)
    expect(log.map(r => r.table)).not.toContain('transactions')
  })

  it('★ drugs·transactions 에도 약국 조건을 건다', async () => {
    const log = []
    await loadStock(fakeAdmin(base, log), TENANT, TODAY)
    for (const tb of ['drugs', 'transactions']) {
      const rec = log.find(r => r.table === tb)
      expect(rec, tb + ' 조회가 없다').toBeTruthy()
      expect(rec.filters.some(x => x[0] === 'eq' && x[1] === 'tenant_id' && x[2] === TENANT), tb).toBe(true)
    }
  })

  it('★ 품목 식별 정보는 여전히 실리지 않는다', async () => {
    const got = await loadStock(fakeAdmin(base), TENANT, TODAY)
    const text = JSON.stringify(got.data)
    for (const bad of ['current_qty', 'received_qty', 'account_id', 'drug_code', 'PRDX23-6', 'a1', 'a2']) {
      expect(text, bad).not.toContain(bad)
    }
  })
})

describe('loadStock — 응답 형식', () => {
  it('필드가 season · updated_at · items 셋뿐이고 item 은 다섯 키뿐이다', async () => {
    const admin = fakeAdmin({
      vaccine_accounts: ok([ACC('a1', '독감 4가'), ACC('a2', '코로나')]),
      v_vaccine_balance: ok([BAL('a1', 80, 100), BAL('a2', 8, 40)]),
      vaccine_events: ok([{ created_at: '2026-10-21T06:54:00Z' }]),
    })
    const got = await loadStock(admin, TENANT, TODAY)
    expect(got.ok).toBe(true)
    expect(Object.keys(got.data).sort()).toEqual(['items', 'season', 'updated_at'])
    for (const it of got.data.items) {
      /* ★ 2026-11-13 — group(시즌/상시) 한 칸이 늘었다. 품목 식별 정보는 여전히 없다. */
      expect(Object.keys(it).sort()).toEqual(['drug_name', 'group', 'label', 'maker', 'qty', 'status'])
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
    expect(got.data.items).toEqual([{ label: '독감 4가', qty: 0, status: '소진', group: '시즌', drug_name: '', maker: '' }])
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
