/* @vitest-environment node */
/* 엑셀 일괄 경로의 「일부 미반영」 집계 — applyDrugRows 가 partialCount·partialCols 를 돌려주는가.
   ★ 화면은 이 값으로 요약 한 줄을 그린다(partialBulkText). 기존 성공·실패 건수는 건드리지 않는다.
   ★ 청크 단위로 컬럼을 버리면 **그 청크의 전 행**이 「일부 미반영」이다 — 한 행이 아니다.
   ★ supabase 는 통째로 가짜다. 운영 DB 에 닿지 않는다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pgrst = col => ({ message: `Could not find the '${col}' column of 'drugs' in the schema cache`, code: 'PGRST204' })

let errors = []        /* drugs 쓰기에 순서대로 돌려줄 오류 */
let sent = []          /* 보낸 페이로드 기록 */

vi.mock('./supabase', () => {
  const ok = d => Promise.resolve({ data: d, error: null })
  function from(table) {
    const q = {
      _tbl: table, _p: null,
      select() { return q }, eq() { return q },
      insert(p) { q._p = p; return done() },
      update(p) { q._p = p; return q },
      then(res) { return done().then(res) },
    }
    function done() {
      if (q._tbl !== 'drugs') return ok([])
      sent.push(q._p)
      return Promise.resolve({ data: null, error: errors.shift() || null })
    }
    return q
  }
  return { supabase: { from, rpc: () => ok({ ok: true, adjusted: 0 }) } }
})

const { applyDrugRows } = await import('./drugBulk')
const { partialBulkText } = await import('./saveWithFallback')

/* classifyDrugRows 를 거치지 않고 분류행을 직접 만든다 — 이 시험의 관심은 반영 단계뿐 */
const newRow = (code, fields) => ({ idx: 1, code, name: code, status: 'new', errors: [], fields: { drug_code: code, drug_name: code, ...fields }, ex: null })
const updRow = (code, fields) => ({ idx: 1, code, name: code, status: 'update', errors: [], fields: { drug_code: code, drug_name: code, ...fields }, ex: { id: 'id-' + code } })

beforeEach(() => { errors = []; sent = []; vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('applyDrugRows — 「일부 미반영」 집계', () => {
  it('버린 것이 없으면 partialCount 0 · partialCols 빈 배열', async () => {
    const r = await applyDrugRows([newRow('A', { additive: 'x' }), updRow('B', { additive: 'y' })])
    expect(r.fail).toEqual([])
    expect(r.partialCount).toBe(0)
    expect(r.partialCols).toEqual([])
    /* 기존 집계는 그대로 */
    expect(r.newCount).toBe(1); expect(r.updateCount).toBe(1); expect(r.success).toBe(2)
  })

  it('★ 신규 청크에서 컬럼을 버리면 그 청크의 전 행이 「일부 미반영」', async () => {
    errors = [pgrst('additive')]       /* 첫 청크 INSERT 1회 실패 → 컬럼 버리고 재시도 성공 */
    const rows = [newRow('A', { additive: 'x' }), newRow('B', { additive: 'y' }), newRow('C', { additive: 'z' })]
    const r = await applyDrugRows(rows)
    expect(r.fail).toEqual([])
    expect(r.partialCount, '3행 전부여야 한다').toBe(3)
    expect(r.partialCols).toEqual(['additive'])
    /* 재시도 페이로드에서 그 키가 빠졌다 */
    expect(sent[1].every(o => !('additive' in o))).toBe(true)
    /* 기존 성공 건수는 그대로 */
    expect(r.success).toBe(3)
  })

  it('★ 갱신 1건에서 버리면 1행만 「일부 미반영」', async () => {
    errors = [pgrst('efficacy_class')]
    const r = await applyDrugRows([updRow('A', { efficacy_class: '해열' })])
    expect(r.fail).toEqual([])
    expect(r.partialCount).toBe(1)
    expect(r.partialCols).toEqual(['efficacy_class'])
  })

  it('여러 컬럼을 버리면 중복 없이 모은다', async () => {
    errors = [pgrst('additive'), pgrst('efficacy_class')]
    const r = await applyDrugRows([newRow('A', { additive: 'x', efficacy_class: 'y' }), newRow('B', {})])
    expect(r.partialCount).toBe(2)
    expect(r.partialCols).toEqual(['additive', 'efficacy_class'])
  })

  it('★ 반영 자체가 실패한 행은 「일부 미반영」으로 세지 않는다', async () => {
    /* 청크 INSERT 실패(폴백 대상 아님) → 행 단위 재시도도 실패 */
    const hard = { message: 'permission denied for table drugs', code: '42501' }
    errors = [hard, hard]
    const r = await applyDrugRows([newRow('A', {})])
    expect(r.fail.length).toBe(1)
    expect(r.partialCount).toBe(0)
  })

  it('요약 문구 — 기존 건수 줄에 덧붙일 한 줄', async () => {
    errors = [pgrst('additive')]
    const r = await applyDrugRows([newRow('A', { additive: 'x' }), newRow('B', { additive: 'y' })])
    expect(partialBulkText(r.partialCount, r.partialCols)).toBe('2건은 일부 항목 미반영(첨가제 등)')
  })
})
