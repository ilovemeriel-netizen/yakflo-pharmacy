/* resolveGroup() — 번호를 정하는 **유일한 길목**. (2026-11-10 · 0119)
 *
 * 못 박는 것
 *   ① 사람이 고친 번호가 **먼저**다
 *   ② 고친 번호가 없으면 decideGroup() 과 **똑같다**
 *   ③ 고친 번호가 있어도 **자동 계산 결과를 함께** 돌려준다 (「자동이면 N번」용)
 *   ④ 번호를 고쳐도 **가루 위험 표시는 그대로**다
 *   ⑤ 1~9 밖의 값은 **안 믿는다** — 자동으로 돌아간다
 *   ⑥ ★ 고친 값이 하나도 없으면 359종 전부 decideGroup() 과 같다
 */
import { describe, it, expect } from 'vitest'
import { decideGroup, resolveGroup, overridesToMap, buildPowderTable, GROUP_NAMES, MANUAL, CHECK } from './powderGroup'
import FIX from './__fixtures__/powderGroup.2026-11-11.json'

const D = o => ({ drug_code: 'X', drug_name: '', atc_code: '', narcotic_type: '일반', status: '사용', category: '경구제', ...o })
const 마그밀 = D({ drug_code: 'MGM', drug_name: '마그밀정', atc_code: 'A02AA04' })
const 피나 = D({ drug_code: 'FNF', drug_name: '피나스테아정5mg', atc_code: 'G04CB01' })
const 시럽 = D({ drug_code: 'DUR', drug_name: '듀락칸이지시럽15mL', atc_code: 'A06AD11' })

describe('① 고친 번호가 먼저다', () => {
  it('고친 번호를 쓴다', () => {
    const r = resolveGroup(마그밀, { MGM: { group_no: 9 } })
    expect(r.no).toBe(9)
    expect(r.label).toBe(GROUP_NAMES[9])
    expect(r.manual).toBe(true)
  })
  it('다른 약의 고친 번호에 휘둘리지 않는다', () => {
    expect(resolveGroup(마그밀, { OTHER: { group_no: 9 } }).no).toBe(4)
  })
  it('수기조제·확인 필요 약도 고칠 수 있다', () => {
    expect(resolveGroup(시럽, {}).label).toBe(MANUAL)
    expect(resolveGroup(시럽, { DUR: { group_no: 9 } }).no).toBe(9)
  })
})

describe('② 고친 번호가 없으면 자동과 똑같다', () => {
  for (const d of [마그밀, 피나, 시럽, D({ drug_name: '모르는무엇', atc_code: 'Z9' })]) {
    it((d.drug_name || '(빈 이름)') + ' — 자동과 같은 번호', () => {
      const a = decideGroup(d)
      for (const ov of [undefined, null, {}, { OTHER: { group_no: 1 } }]) {
        const r = resolveGroup(d, ov)
        expect(r.no).toBe(a.no)
        expect(r.label).toBe(a.label)
        expect(r.manual).toBe(false)
      }
    })
  }
})

describe('③ 자동 계산 결과를 함께 돌려준다', () => {
  it('고친 번호여도 auto 가 들어 있다', () => {
    const r = resolveGroup(마그밀, { MGM: { group_no: 9 } })
    expect(r.auto.no).toBe(4)
    expect(r.auto.label).toBe(GROUP_NAMES[4])
  })
  it('고친 번호가 없어도 auto 가 들어 있다', () => {
    expect(resolveGroup(마그밀, {}).auto.no).toBe(4)
  })
  it('고친 줄 자체(override)도 돌려준다 — 까닭·시각을 화면이 쓴다', () => {
    const ov = { group_no: 9, note: '따로 빼기', updated_at: '2026-11-10T07:41:00Z' }
    const r = resolveGroup(마그밀, { MGM: ov })
    expect(r.override).toBe(ov)
  })
})

describe('④ 번호를 고쳐도 가루 위험은 그대로다', () => {
  it('피나스테리드 — 1번으로 고쳐도 위험 표시가 남는다', () => {
    const r = resolveGroup(피나, { FNF: { group_no: 1 } })
    expect(r.no).toBe(1)
    expect(r.hazard).toContain('피나스테리드')
  })
  it('위험이 아닌 약에 없던 위험이 생기지 않는다', () => {
    expect(resolveGroup(마그밀, { MGM: { group_no: 9 } }).hazard).toBe('')
  })
})

describe('⑤ 1~9 밖의 값은 안 믿는다', () => {
  for (const bad of [0, 10, -1, 99, null, undefined, '', 'abc', 1.5, NaN]) {
    it(JSON.stringify(bad) + ' → 자동으로 돌아간다', () => {
      const r = resolveGroup(마그밀, { MGM: { group_no: bad } })
      expect(r.no).toBe(4)
      expect(r.manual).toBe(false)
    })
  }
  it('글자로 적힌 숫자는 받아 준다 — DB 가 문자열로 줄 수 있다', () => {
    expect(resolveGroup(마그밀, { MGM: { group_no: '9' } }).no).toBe(9)
  })
})

describe('overridesToMap', () => {
  it('약품코드로 묶는다', () => {
    expect(overridesToMap([{ drug_code: 'A', group_no: 1 }, { drug_code: 'B', group_no: 2 }]).B.group_no).toBe(2)
  })
  it('빈 값·빈 코드는 버린다', () => {
    expect(overridesToMap([{ drug_code: '', group_no: 1 }, null, undefined])).toEqual({})
    expect(overridesToMap(null)).toEqual({})
  })
  it('앞뒤 빈칸을 털어 낸다', () => {
    expect(overridesToMap([{ drug_code: ' A ', group_no: 1 }]).A.group_no).toBe(1)
  })
})

describe('buildPowderTable — 고친 번호를 받는다', () => {
  const drugs = [마그밀, 피나, 시럽]
  it('고친 줄을 edited 로 따로 센다', () => {
    const p = buildPowderTable(drugs, { MGM: { group_no: 9 } })
    expect(p.edited.map(x => x.d.drug_code)).toEqual(['MGM'])
  })
  it('고친 번호가 없으면 edited 는 비어 있다', () => {
    expect(buildPowderTable(drugs, {}).edited).toEqual([])
    expect(buildPowderTable(drugs).edited).toEqual([])
  })
  it('고친 번호가 묶음을 옮긴다', () => {
    const p = buildPowderTable(drugs, { MGM: { group_no: 9 } })
    expect(p.groups.find(g => g.no === 9).list.map(x => x.d.drug_code)).toContain('MGM')
    expect(p.groups.find(g => g.no === 4).list.map(x => x.d.drug_code)).not.toContain('MGM')
  })
})

describe('★ ⑥ 고친 값이 없으면 358종 전부 자동과 같다', () => {
  it('한 종도 안 틀린다', () => {
    const diff = FIX.filter(x => {
      const d = { drug_code: x.code, drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc }
      const a = decideGroup(d)
      const r = resolveGroup(d, {})
      return r.no !== a.no || r.label !== a.label || r.manual !== false
    }).map(x => x.name)
    expect(diff).toEqual([])
  })
  it('「확인 필요」도 그대로 넘어온다', () => {
    const d = { drug_code: 'ZZ', drug_name: '모르는무엇', atc_code: 'Z9', narcotic_type: '' }
    expect(resolveGroup(d, {}).label).toBe(CHECK)
  })
})
