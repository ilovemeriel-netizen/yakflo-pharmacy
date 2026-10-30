/* 조회 계층 시험 — 가짜 supabase 로 「무엇을 어떤 조건으로 물었나」와 쪽 나누기를 본다.
   ★ 9월 스냅샷이 1,125행이다. 쪽 나누기를 빼먹으면 1,000행만 와서 금액이 조용히 모자란다. */
import { describe, it, expect } from 'vitest'
import { fetchMonthlyReportSource } from './monthlyReportQuery.js'

/* 질의를 기록하는 가짜 supabase. from() 마다 걸린 조건과 range 를 남긴다. */
function fakeSupabase({ totals = [], snapshots = [] } = {}) {
  const calls = []
  const client = {
    from(table) {
      const rec = { table, eq: {}, ranges: [], limit: null }
      calls.push(rec)
      const q = {
        select() { return q },
        eq(k, v) { rec.eq[k] = v; return q },
        limit(n) { rec.limit = n; return Promise.resolve({ data: totals.slice(0, n), error: null }) },
        range(from, to) {
          rec.ranges.push([from, to])
          return Promise.resolve({ data: snapshots.slice(from, to + 1), error: null })
        },
      }
      return q
    },
  }
  return { client, calls }
}
const rows = n => Array.from({ length: n }, (_, i) => ({ drug_code: 'C' + i, closing_qty: 1 }))
/* 쪽마다 from() 을 새로 부르므로 범위는 모든 호출에서 모아 본다 */
const rangesOf = (calls, table) => calls.filter(c => c.table === table).flatMap(c => c.ranges)

describe('fetchMonthlyReportSource', () => {
  it('사이드카 총계와 스냅샷을 선택한 연·월로 묻는다', async () => {
    const { client, calls } = fakeSupabase({ totals: [{ opening_amount: '1' }], snapshots: rows(3) })
    const out = await fetchMonthlyReportSource(client, { year: 2026, month: 9 })
    expect(calls.map(c => c.table)).toEqual(['monthly_report_totals', 'monthly_snapshots'])
    for (const c of calls) expect(c.eq).toEqual({ snap_year: 2026, snap_month: 9 })
    expect(out.totals).toEqual({ opening_amount: '1' })
    expect(out.rows.length).toBe(3)
  })

  it('★ 1,000행을 넘으면 쪽을 넘겨 끝까지 가져온다 (9월 1,125행)', async () => {
    const { client, calls } = fakeSupabase({ totals: [{}], snapshots: rows(1125) })
    const out = await fetchMonthlyReportSource(client, { year: 2026, month: 9 })
    expect(out.rows.length).toBe(1125)
    expect(rangesOf(calls, 'monthly_snapshots')).toEqual([[0, 999], [1000, 1999]])
    /* 한 행도 겹치거나 빠지지 않는다 */
    expect(new Set(out.rows.map(r => r.drug_code)).size).toBe(1125)
  })

  it('정확히 1,000행이면 한 쪽 더 물어 끝을 확인한다', async () => {
    const { client, calls } = fakeSupabase({ totals: [{}], snapshots: rows(1000) })
    const out = await fetchMonthlyReportSource(client, { year: 2026, month: 9 })
    expect(out.rows.length).toBe(1000)
    expect(rangesOf(calls, 'monthly_snapshots')).toEqual([[0, 999], [1000, 1999]])
  })

  it('스냅샷이 없으면 미마감으로 본다 — 사이드카 총계가 있어도 그렇다', async () => {
    const { client } = fakeSupabase({ totals: [{ opening_amount: '9' }], snapshots: [] })
    const out = await fetchMonthlyReportSource(client, { year: 2026, month: 10 })
    expect(out.closed).toBe(false)
    expect(out.rows).toEqual([])
    expect(out.totals).toEqual({ opening_amount: '9' })   /* 총계는 그대로 돌려준다 */
  })

  it('스냅샷이 있으면 마감으로 본다 (거래 가드와 같은 기준)', async () => {
    const { client } = fakeSupabase({ totals: [{}], snapshots: rows(1) })
    expect((await fetchMonthlyReportSource(client, { year: 2026, month: 9 })).closed).toBe(true)
  })

  it('사이드카가 없으면 totals 는 null', async () => {
    const { client } = fakeSupabase({ totals: [], snapshots: rows(2) })
    expect((await fetchMonthlyReportSource(client, { year: 2026, month: 9 })).totals).toBe(null)
  })

  it('오류는 삼키지 않고 올린다 — 모자란 데이터로 파일을 만들면 안 된다', async () => {
    const bad = {
      from() {
        const q = { select: () => q, eq: () => q, limit: () => Promise.resolve({ data: null, error: { message: '권한 없음' } }), range: () => Promise.resolve({ data: null, error: null }) }
        return q
      },
    }
    await expect(fetchMonthlyReportSource(bad, { year: 2026, month: 9 })).rejects.toMatchObject({ message: '권한 없음' })
  })

  it('스냅샷 조회 오류도 올린다', async () => {
    const bad = {
      from() {
        const q = {
          select: () => q, eq: () => q,
          limit: () => Promise.resolve({ data: [{}], error: null }),
          range: () => Promise.resolve({ data: null, error: { message: '스냅샷 오류' } }),
        }
        return q
      },
    }
    await expect(fetchMonthlyReportSource(bad, { year: 2026, month: 9 })).rejects.toMatchObject({ message: '스냅샷 오류' })
  })
})
