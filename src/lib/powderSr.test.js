/* 서방정 묶음 — 2026-11-11 (0120)
 *
 * ★ 가장 중요한 것: **서방정 표시를 켜고 꺼도 359종 번호가 한 종도 안 바뀐다.**
 *   이 묶음은 「보여 주는 방법」만 바꾼다. 번호를 건드리면 여기서 걸린다.
 *
 * 그리고
 *   ① 자동은 **이름에 「서방」**이 있는지로만 본다
 *   ② 사람이 정한 줄이 **먼저**다 (true=넣기 · false=빼기)
 *   ③ 줄을 지우면 자동으로 돌아간다
 *   ④ 1번(일반 정제) 안에서만 두 토막으로 나눈다
 */
import { describe, it, expect } from 'vitest'
import {
  decideGroup, resolveGroup, resolveSr, isSrAuto, srToMap, buildPowderTable,
  SR_GROUP_NO, SR_RE, GROUP_NOS,
} from './powderGroup'
import FIX from './__fixtures__/powderGroup.2026-11-10.json'

const D = o => ({ drug_code: 'X', drug_name: '', atc_code: '', narcotic_type: '일반', status: '사용', category: '경구제', ...o })
const 서방 = D({ drug_code: 'SR1', drug_name: '포리부틴서방정', atc_code: 'A03AA05' })
const 일반 = D({ drug_code: 'N1', drug_name: '우루사정100mg', atc_code: 'A05AA02' })
const 엑스엘 = D({ drug_code: 'XL1', drug_name: '웰부트린엑스엘정300mg', atc_code: 'N06AX12' })

describe('① 자동 — 이름에 「서방」', () => {
  it('「서방」이 있으면 서방정', () => {
    expect(isSrAuto(서방)).toBe(true)
    expect(isSrAuto(D({ drug_name: '타세놀8시간이알서방정' }))).toBe(true)
  })
  it('없으면 아니다 — ★ 다른 글자(XL·OD 등)를 코드가 멋대로 넣지 않는다', () => {
    expect(isSrAuto(일반)).toBe(false)
    expect(isSrAuto(엑스엘)).toBe(false)
    expect(isSrAuto(D({ drug_name: '한미탐스오디정0.2mg' }))).toBe(false)
    expect(isSrAuto(D({ drug_name: '란스톤엘에프디티정15mg' }))).toBe(false)
    expect(isSrAuto(D({ drug_name: '브로나제장용정' }))).toBe(false)
  })
  it('빈 값에도 터지지 않는다', () => {
    expect(isSrAuto(undefined)).toBe(false)
    expect(isSrAuto({})).toBe(false)
  })
  it('규칙은 「서방」 한 글자뿐이다', () => {
    expect(SR_RE.source).toBe('서방')
  })
})

describe('② 사람이 정한 줄이 먼저다', () => {
  it('true — 이름에 「서방」이 없어도 서방정', () => {
    const r = resolveSr(엑스엘, { XL1: { is_sr: true } })
    expect(r.sr).toBe(true)
    expect(r.manual).toBe(true)
    expect(r.auto).toBe(false)
  })
  it('false — 이름에 「서방」이 있어도 뺀다', () => {
    const r = resolveSr(서방, { SR1: { is_sr: false } })
    expect(r.sr).toBe(false)
    expect(r.manual).toBe(true)
    expect(r.auto).toBe(true)
  })
  it('다른 약의 줄에 휘둘리지 않는다', () => {
    expect(resolveSr(일반, { OTHER: { is_sr: true } }).sr).toBe(false)
  })
  it('is_sr 이 참/거짓이 아니면 안 믿는다 — 자동으로 돌아간다', () => {
    for (const bad of [null, undefined, 1, 0, 'true', '']) {
      const r = resolveSr(서방, { SR1: { is_sr: bad } })
      expect(r.sr, JSON.stringify(bad)).toBe(true)
      expect(r.manual).toBe(false)
    }
  })
})

describe('③ 줄을 지우면 자동으로 돌아간다', () => {
  it('빈 지도면 자동', () => {
    for (const m of [undefined, null, {}]) {
      expect(resolveSr(서방, m).sr).toBe(true)
      expect(resolveSr(엑스엘, m).sr).toBe(false)
    }
  })
})

describe('srToMap', () => {
  it('약품코드로 묶는다', () => {
    expect(srToMap([{ drug_code: 'A', is_sr: true }]).A.is_sr).toBe(true)
  })
  it('빈 값·빈 코드는 버린다', () => {
    expect(srToMap([{ drug_code: '', is_sr: true }, null])).toEqual({})
    expect(srToMap(null)).toEqual({})
  })
})

describe('④ 1번 안에서만 두 토막', () => {
  const drugs = [서방, 일반, 엑스엘,
    D({ drug_code: 'C1', drug_name: '헤르벤서방정90mg', atc_code: 'C08DB01' })]
  it('1번 묶음만 sr·nonSr 를 갖는다', () => {
    const p = buildPowderTable(drugs, {}, {})
    const g1 = p.groups.find(g => g.no === SR_GROUP_NO)
    expect(Array.isArray(g1.sr)).toBe(true)
    expect(Array.isArray(g1.nonSr)).toBe(true)
    for (const g of p.groups.filter(g => g.no !== SR_GROUP_NO)) {
      expect(g.sr, g.no + '번').toBeUndefined()
    }
  })
  it('1번의 서방 / 그 밖이 갈린다', () => {
    const p = buildPowderTable(drugs, {}, {})
    const g1 = p.groups.find(g => g.no === SR_GROUP_NO)
    expect(g1.sr.map(x => x.d.drug_code)).toEqual(['SR1'])
    expect(g1.nonSr.map(x => x.d.drug_code).sort()).toEqual(['N1', 'XL1'])
  })
  it('★ 2번의 서방정(헤르벤서방정)은 1번 묶음에 들어오지 않는다', () => {
    const p = buildPowderTable(drugs, {}, {})
    expect(p.groups.find(g => g.no === SR_GROUP_NO).sr.map(x => x.d.drug_code)).not.toContain('C1')
    expect(p.groups.find(g => g.no === 2).list.map(x => x.d.drug_code)).toContain('C1')
  })
  it('p.sr 는 1번 안의 서방정만 센다', () => {
    const p = buildPowderTable(drugs, {}, {})
    expect(p.sr.map(x => x.d.drug_code)).toEqual(['SR1'])
  })
  it('손으로 정한 것을 srEdited 로 센다', () => {
    const p = buildPowderTable(drugs, {}, { XL1: { is_sr: true } })
    expect(p.srEdited.map(x => x.d.drug_code)).toEqual(['XL1'])
    expect(p.sr.map(x => x.d.drug_code).sort()).toEqual(['SR1', 'XL1'])
  })
})

describe('★★ 서방정 표시를 켜고 꺼도 359종 번호가 안 바뀐다', () => {
  const drugs = FIX.map(x => ({
    drug_code: x.code, drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc,
    status: '사용', category: '경구제',
  }))
  const numsOf = srMap => buildPowderTable(drugs, {}, srMap).rows
    .map(x => x.d.drug_code + ':' + (x.r.no == null ? x.r.label : x.r.no))

  const base = numsOf({})

  it('359종이 다 들어 있다', () => {
    expect(base.length).toBe(359)
  })

  it('서방정 표시가 하나도 없을 때 = decideGroup() 과 같다', () => {
    const diff = drugs.filter(d => {
      const a = decideGroup(d), r = resolveGroup(d, {})
      return a.no !== r.no
    })
    expect(diff).toEqual([])
  })

  it('★ 모든 약을 서방정으로 켜도 번호가 그대로다', () => {
    const all = {}
    for (const d of drugs) all[d.drug_code] = { is_sr: true }
    expect(numsOf(all)).toEqual(base)
  })

  it('★ 모든 약을 서방정에서 빼도 번호가 그대로다', () => {
    const none = {}
    for (const d of drugs) none[d.drug_code] = { is_sr: false }
    expect(numsOf(none)).toEqual(base)
  })

  it('★ 섞어서 켜고 꺼도 번호가 그대로다', () => {
    const mix = {}
    drugs.forEach((d, i) => { mix[d.drug_code] = { is_sr: i % 2 === 0 } })
    expect(numsOf(mix)).toEqual(base)
  })

  it('★ 번호별 수도 그대로다', () => {
    const count = m => {
      const p = buildPowderTable(drugs, {}, m)
      const o = {}
      for (const n of GROUP_NOS) o[n] = p.groups.find(g => g.no === n).list.length
      o.manual = p.manual.length
      o.check = p.check.length
      return o
    }
    const all = {}; for (const d of drugs) all[d.drug_code] = { is_sr: true }
    expect(count(all)).toEqual(count({}))
  })
})

describe('지금 운영 값 — 1번 안 서방정 12종', () => {
  const drugs = FIX.map(x => ({
    drug_code: x.code, drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc,
    status: '사용', category: '경구제',
  }))
  const p = buildPowderTable(drugs, {}, {})
  it('1번 173종 가운데 서방정 12종', () => {
    const g1 = p.groups.find(g => g.no === SR_GROUP_NO)
    expect(g1.list.length).toBe(173)
    expect(g1.sr.length).toBe(12)
    expect(g1.nonSr.length).toBe(161)
  })
  it('★ 후보 3종은 **코드가 넣지 않는다** — 이정화 님이 화면에서 직접 넣으신다', () => {
    const names = p.groups.find(g => g.no === SR_GROUP_NO).sr.map(x => x.d.drug_name)
    expect(names).not.toContain('웰부트린엑스엘정300mg')
    expect(names).not.toContain('한미탐스오디정0.2mg')
    expect(names).not.toContain('란스톤엘에프디티정15mg')
  })
})
