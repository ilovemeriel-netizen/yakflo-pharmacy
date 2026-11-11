/* 번호 목록을 표(drug_vocab)에서 읽는다 — 2026-11-11 (0121)
 *
 * 못 박는 것
 *   ① 10번 갑상선약 — ATC H03
 *   ② 목록을 못 읽으면 **기본값**으로 돌아간다 (화면이 비면 안 된다)
 *   ③ 숨긴 번호는 빠진다 · 차례는 sort_order 다 ('10' 이 '2' 앞에 오지 않게)
 *   ④ 목록이 이름을 바꾸면 화면 이름도 바뀐다 — **번호는 안 바뀐다**
 *   ⑤ ★ 새 번호를 더해도 **1~9번 약이 옮겨 다니지 않는다**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  decideGroup, buildPowderTable, GROUP_NAMES, GROUP_NOS,
} from './powderGroup'
import FIX from './__fixtures__/powderGroup.2026-11-11.json'

const from = vi.fn()
vi.mock('./supabase', () => ({ supabase: { from: (...a) => from(...a) } }))
const V = await import('./powderGroupVocab')

const D = o => ({ drug_code: 'X', drug_name: '', atc_code: '', narcotic_type: '일반', status: '사용', category: '경구제', ...o })

describe('① 10번 갑상선약 — ATC H03', () => {
  it('씬지로이드정이 10번이다', () => {
    const r = decideGroup(D({ drug_name: '씬지로이드정0.15mg', atc_code: 'H03AA01' }))
    expect(r.no).toBe(10)
    expect(r.label).toBe('갑상선약')
    expect(r.why).toContain('H03')
  })
  it('H03 이면 다른 이름이어도 10번이다 — 약품코드를 박지 않는다', () => {
    expect(decideGroup(D({ drug_name: '아무개정50mcg', atc_code: 'H03BB02' })).no).toBe(10)
  })
  it('H03 이 아니면 10번이 아니다', () => {
    expect(decideGroup(D({ drug_name: '우루사정100mg', atc_code: 'A05AA02' })).no).toBe(1)
    expect(decideGroup(D({ drug_name: '무슨정', atc_code: 'H02AB06' })).no).toBe(1)
  })
  it('액체·가루 제형이면 H03 이라도 수기조제다 — 제형이 먼저다', () => {
    expect(decideGroup(D({ drug_name: '어떤갑상선시럽', atc_code: 'H03AA01' })).no).toBeNull()
  })
  it('기본값 목록에 10번이 들어 있다', () => {
    expect(GROUP_NOS).toContain(10)
    expect(GROUP_NAMES[10]).toBe('갑상선약')
  })
})

describe('② 못 읽으면 기본값', () => {
  beforeEach(() => { from.mockReset(); V.invalidateVocab() })
  const chain = (rows, error) => ({
    select: () => chain(rows, error), eq: () => chain(rows, error),
    order: () => Promise.resolve({ data: rows, error: error || null }),
  })
  it('오류면 기본값 10개', async () => {
    from.mockImplementation(() => chain(null, { message: '권한 없음' }))
    const r = await V.fetchGroupVocab()
    expect(r.fell).toBe(true)
    expect(r.vocab.length).toBe(10)
    expect(r.vocab[9].label).toBe('갑상선약')
  })
  it('빈 목록이어도 기본값', async () => {
    from.mockImplementation(() => chain([]))
    const r = await V.fetchGroupVocab()
    expect(r.fell).toBe(true)
    expect(r.vocab.length).toBe(10)
  })
  it('읽히면 그것을 쓴다', async () => {
    from.mockImplementation(() => chain([
      { code: '1', label: '정제', sort_order: 1, is_active: true },
      { code: '10', label: '갑상선', sort_order: 10, is_active: true },
    ]))
    const r = await V.fetchGroupVocab()
    expect(r.fell).toBe(false)
    expect(r.vocab.map(v => v.no)).toEqual([1, 10])
    expect(r.vocab[0].label).toBe('정제')
  })
  it('기본값 자체가 10개다', () => {
    expect(V.fallbackVocab().map(v => v.no)).toEqual(GROUP_NOS)
  })
})

describe('③ 숨긴 번호·차례', () => {
  it('is_active=false 는 빠진다', () => {
    expect(V.toVocab([
      { code: '1', label: 'ㄱ', sort_order: 1, is_active: true },
      { code: '9', label: 'ㄴ', sort_order: 9, is_active: false },
    ]).map(v => v.no)).toEqual([1])
  })
  it('★ 차례는 sort_order — 「10」이 「2」 앞에 오지 않는다', () => {
    expect(V.toVocab([
      { code: '10', label: '열', sort_order: 10, is_active: true },
      { code: '2', label: '둘', sort_order: 2, is_active: true },
      { code: '1', label: '하나', sort_order: 1, is_active: true },
    ]).map(v => v.no)).toEqual([1, 2, 10])
  })
  it('번호가 아닌 code 는 버린다', () => {
    expect(V.toVocab([{ code: 'abc', label: 'ㄱ', sort_order: 1, is_active: true }])).toEqual([])
  })
  it('빈 값에도 터지지 않는다', () => {
    expect(V.toVocab(null)).toEqual([])
    expect(V.toVocab([null, undefined])).toEqual([])
  })
  it('이름이 비면 기본 이름을 쓴다', () => {
    expect(V.toVocab([{ code: '4', label: '', sort_order: 4, is_active: true }])[0].label).toBe('변비약')
  })
})

describe('④ 목록이 이름을 바꾸면 화면 이름이 바뀐다 — 번호는 안 바뀐다', () => {
  const drugs = [
    D({ drug_code: 'A', drug_name: '마그밀정', atc_code: 'A02AA04' }),
    D({ drug_code: 'B', drug_name: '씬지로이드정0.1mg', atc_code: 'H03AA01' }),
  ]
  it('이름을 바꾸면 따라간다', () => {
    const v = [{ no: 4, label: '변비약(새 이름)' }, { no: 10, label: '갑상선' }]
    const p = buildPowderTable(drugs, {}, {}, v)
    expect(p.rows.find(x => x.d.drug_code === 'A').r.label).toBe('변비약(새 이름)')
    expect(p.rows.find(x => x.d.drug_code === 'B').r.label).toBe('갑상선')
  })
  it('★ 번호는 그대로다', () => {
    const v = [{ no: 4, label: '아무거나' }, { no: 10, label: '아무거나2' }]
    const p = buildPowderTable(drugs, {}, {}, v)
    expect(p.rows.find(x => x.d.drug_code === 'A').r.no).toBe(4)
    expect(p.rows.find(x => x.d.drug_code === 'B').r.no).toBe(10)
  })
  it('목록을 안 주면 기본 이름이다', () => {
    const p = buildPowderTable(drugs, {}, {})
    expect(p.rows.find(x => x.d.drug_code === 'A').r.label).toBe('변비약')
    expect(p.rows.find(x => x.d.drug_code === 'B').r.label).toBe('갑상선약')
  })
  it('목록에 있는 묶음만 그린다', () => {
    const p = buildPowderTable(drugs, {}, {}, [{ no: 4, label: '변비약' }])
    expect(p.groups.map(g => g.no)).toEqual([4])
  })
  it('★ 목록에서 읽은 묶음도 모두 기본 접힘이다', () => {
    const p = buildPowderTable(drugs, {}, {}, [{ no: 4, label: 'ㄱ' }, { no: 10, label: 'ㄴ' }])
    expect(p.groups.every(g => g.folded)).toBe(true)
  })
})

describe('★ ⑤ 10번을 더해도 1~9번 약이 옮겨 다니지 않는다', () => {
  const drugs = FIX.map(x => ({
    drug_code: x.code, drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc,
    status: '사용', category: '경구제',
  }))
  const p = buildPowderTable(drugs, {}, {})

  it('358종이 다 들어 있다', () => { expect(p.total).toBe(358) })

  it('10번이 갑상선약 5종이다', () => {
    const g10 = p.groups.find(g => g.no === 10)
    expect(g10.list.length).toBe(5)
    expect(g10.list.every(x => String(x.d.atc_code).startsWith('H03'))).toBe(true)
  })

  it('★ 10번 말고는 전부 H03 이 아니다 — 다른 번호로 샌 약이 없다', () => {
    for (const g of p.groups) {
      if (g.no === 10) continue
      const leak = g.list.filter(x => String(x.d.atc_code).startsWith('H03'))
      expect(leak.map(x => x.d.drug_name), g.no + '번').toEqual([])
    }
  })

  it('★ H03 이 아닌 약은 10번에 안 들어간다', () => {
    const wrong = p.groups.find(g => g.no === 10).list
      .filter(x => !String(x.d.atc_code).startsWith('H03'))
    expect(wrong.map(x => x.d.drug_name)).toEqual([])
  })

  it('번호별 수가 보고한 값 그대로', () => {
    const want = { 1: 168, 2: 65, 3: 12, 4: 5, 5: 23, 6: 42, 7: 9, 8: 3, 9: 3, 10: 5 }
    for (const [n, v] of Object.entries(want)) {
      expect(p.groups.find(g => g.no === Number(n)).list.length, n + '번').toBe(v)
    }
    expect(p.manual.length).toBe(23)
    expect(p.check.length).toBe(0)
  })
})
