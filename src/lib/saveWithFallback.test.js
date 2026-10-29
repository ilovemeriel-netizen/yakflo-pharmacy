/* @vitest-environment node */
/* 저장 폴백 도우미 — 재시도 조건·횟수가 이전 12곳과 똑같은지, 그리고 「버린 컬럼」을
   제대로 돌려주는지 본다.

   ★ 이 시험의 요점은 **발동 조건이 PGRST204 하나뿐**이라는 것이다.
     PostgreSQL 42703 · NOT NULL 23502 · 형식 42804 · RLS · GRANT · 트리거 거절은
     재시도 없이 그대로 오류가 돼야 한다. 그렇지 않으면 엉뚱한 컬럼이 조용히 사라진다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { saveWithFallback, droppedColumnOf, colLabel, partialText, partialBulkText, PARTIAL_BG, PARTIAL_FG, PARTIAL_LINE } from './saveWithFallback'

/* PostgREST 가 실제로 내려주는 문구 */
const pgrst = col => ({ message: `Could not find the '${col}' column of 'drugs' in the schema cache`, code: 'PGRST204' })
const e42703 = { message: 'column "ghost" of relation "drugs" does not exist', code: '42703' }
const e23502 = { message: 'null value in column "drug_name" of relation "drugs" violates not-null constraint', code: '23502' }
const e42804 = { message: 'column "total_qty" is of type integer but expression is of type text', code: '42804' }
const eRls = { message: 'new row violates row-level security policy for table "drugs"', code: '42501' }
const eGrant = { message: 'permission denied for table drugs', code: '42501' }
const eTrig = { message: '단가 수정 권한이 없습니다 (owner/admin 전용)', code: '42501' }

let warn
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

/* errors 를 순서대로 돌려주는 send — 다 떨어지면 성공 */
function sender(errors) {
  const seen = []
  let i = 0
  const send = async p => { seen.push(p); const e = errors[i++]; return { error: e || null } }
  return { send, seen, calls: () => seen.length }
}

describe('droppedColumnOf — 발동 조건', () => {
  it('PGRST204 에서만 컬럼을 뽑는다', () => {
    expect(droppedColumnOf(pgrst('efficacy_class'))).toBe('efficacy_class')
  })
  it('★ 다른 오류에서는 null — 재시도하지 않는다', () => {
    for (const e of [e42703, e23502, e42804, eRls, eGrant, eTrig]) {
      expect(droppedColumnOf(e), e.message.slice(0, 40)).toBeNull()
    }
  })
  it('오류가 없거나 메시지가 없으면 null', () => {
    expect(droppedColumnOf(null)).toBeNull()
    expect(droppedColumnOf({})).toBeNull()
    expect(droppedColumnOf({ message: '' })).toBeNull()
  })
})

describe('saveWithFallback', () => {
  it('성공하면 그대로 끝 — dropped 는 빈 배열, 요청 1회', async () => {
    const s = sender([])
    const r = await saveWithFallback({ drug_code: 'A', additive: 'x' }, s.send)
    expect(r.error).toBeNull()
    expect(r.dropped).toEqual([])
    expect(s.calls()).toBe(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('★ PGRST204 1회 → 그 컬럼만 버리고 성공 + dropped 1개', async () => {
    const s = sender([pgrst('efficacy_class')])
    const r = await saveWithFallback({ drug_code: 'A', efficacy_class: '해열', additive: 'x' }, s.send)
    expect(r.error).toBeNull()
    expect(r.dropped).toEqual(['efficacy_class'])
    expect(s.calls()).toBe(2)
    /* 두 번째 요청에서 그 키만 빠졌다 — 나머지는 그대로 */
    expect(s.seen[1]).toEqual({ drug_code: 'A', additive: 'x' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('PGRST204 2회 → 두 컬럼 다 버리고 성공', async () => {
    const s = sender([pgrst('additive'), pgrst('compound_type')])
    const r = await saveWithFallback({ drug_code: 'A', additive: 'x', compound_type: '단일제' }, s.send)
    expect(r.error).toBeNull()
    expect(r.dropped).toEqual(['additive', 'compound_type'])
    expect(s.seen[2]).toEqual({ drug_code: 'A' })
  })

  it('★ 42703·23502·42804·RLS·GRANT·트리거 거절 → 재시도 0회, 오류 그대로', async () => {
    for (const e of [e42703, e23502, e42804, eRls, eGrant, eTrig]) {
      const s = sender([e, e, e, e, e])
      const r = await saveWithFallback({ drug_code: 'A' }, s.send)
      expect(r.error, e.code).toBe(e)
      expect(r.dropped).toEqual([])
      expect(s.calls(), '재시도하면 안 된다: ' + e.message.slice(0, 30)).toBe(1)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('★ 재시도 횟수를 넘기면 오류로 끝난다 — 기본 3회', async () => {
    const s = sender([pgrst('a'), pgrst('b'), pgrst('c'), pgrst('d'), pgrst('e')])
    const r = await saveWithFallback({ a: 1, b: 2, c: 3, d: 4, e: 5 }, s.send)
    expect(r.error).toBeTruthy()
    expect(r.dropped).toEqual(['a', 'b', 'c'])
    expect(s.calls(), '첫 요청 + 재시도 3회').toBe(4)
  })

  it('retries: 4 — 대량 경로는 4회였다(동작 보존)', async () => {
    const s = sender([pgrst('a'), pgrst('b'), pgrst('c'), pgrst('d'), pgrst('e')])
    const r = await saveWithFallback({ a: 1, b: 2, c: 3, d: 4, e: 5 }, s.send, { retries: 4 })
    expect(r.dropped).toEqual(['a', 'b', 'c', 'd'])
    expect(s.calls()).toBe(5)
  })

  it('★ 배열 페이로드(대량 청크)는 전 행에서 컬럼을 뺀다', async () => {
    const s = sender([pgrst('additive')])
    const rows = [{ drug_code: 'A', additive: 'x' }, { drug_code: 'B', additive: 'y' }]
    const r = await saveWithFallback(rows, s.send, { retries: 4 })
    expect(r.error).toBeNull()
    expect(r.dropped).toEqual(['additive'])
    expect(r.payload).toEqual([{ drug_code: 'A' }, { drug_code: 'B' }])
  })

  it('원본 페이로드를 건드리지 않는다 — 사본으로 재시도한다', async () => {
    const s = sender([pgrst('additive')])
    const row = { drug_code: 'A', additive: 'x' }
    await saveWithFallback(row, s.send)
    expect(row).toEqual({ drug_code: 'A', additive: 'x' })
  })

  it('★ warn 에 컬럼명과 원인이 함께 남는다 — 예전에 warn 조차 없던 경로까지', async () => {
    const s = sender([pgrst('recommended_action')])
    await saveWithFallback({ recommended_action: '폐기' }, s.send, { label: 'drugs UPDATE 유효기한' })
    const args = warn.mock.calls[0]
    expect(String(args[0])).toContain('drugs UPDATE 유효기한')
    expect(String(args[0])).toContain('미존재 컬럼 자동 제거')
    expect(args[1]).toBe('recommended_action')
    expect(String(args[3])).toContain('schema cache')
  })
})

describe('화면 이름 변환', () => {
  it('FIELD_DEFS 의 라벨을 쓴다', () => {
    expect(colLabel('additive')).toBe('첨가제')
    expect(colLabel('compound_type')).toBe('복합/단일')
    expect(colLabel('purchase_price')).toBe('구입단가')
    /* key 와 col 이 다른 항목도 col 로 찾는다 (key 'notes' → col 'memo') */
    expect(colLabel('memo')).toBe('비고')
  })
  it('★ 라벨이 없으면 컬럼 이름 그대로', () => {
    expect(colLabel('efficacy_class')).toBe('efficacy_class')
    expect(colLabel('last_used_date')).toBe('last_used_date')
    expect(colLabel('없는컬럼')).toBe('없는컬럼')
  })
})

describe('문구', () => {
  it('모달·인라인 문구', () => {
    expect(partialText(['additive', 'efficacy_class']))
      .toBe('저장했지만 반영되지 않은 항목이 있습니다: 첨가제, efficacy_class')
  })
  it('엑셀 일괄 요약 한 줄', () => {
    expect(partialBulkText(7, ['additive'])).toBe('7건은 일부 항목 미반영(첨가제 등)')
  })
})

describe('표시 값 — 새 색을 쓰지 않는다', () => {
  it('승인받은 값 그대로', () => {
    expect(PARTIAL_BG).toBe('rgba(191,166,217,0.45)')
    expect(PARTIAL_FG).toBe('#2E4A62')
    expect(PARTIAL_LINE).toBe('#BFA6D9')
  })
})
