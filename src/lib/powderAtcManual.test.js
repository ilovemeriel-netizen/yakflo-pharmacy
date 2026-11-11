/* 손으로 조제하는 약을 한 묶음에 — 2026-11-11
 *
 * 가루약 「수기조제」(마약·액체·가루)와 ATC 「수기 조제」(`drugs.atc_excluded`)는
 * **뜻이 다르다**. 2026-11-11 실측에서 겹치는 약은 0종이었다.
 * 그래도 조제실에서는 둘 다 「손으로 조제한다」가 같아 **한 묶음**에 모은다.
 *
 * 못 박는 것
 *   ① ATC 수기 약은 **번호별 목록에서 빠진다**
 *   ② 그래도 **번호 자체는 그대로**다 — 검색에서는 번호가 보인다
 *   ③ 수기조제 묶음 = 가루약 수기조제 + ATC 수기 조제
 *   ④ ★ `atc_excluded` 가 없는 자료에서는 **아무것도 안 바뀐다**
 */
import { describe, it, expect } from 'vitest'
import {
  buildPowderTable, isAtcManual, decideGroup, ATC_MANUAL_LABEL, MANUAL, GROUP_NOS,
} from './powderGroup'
import FIX from './__fixtures__/powderGroup.2026-11-10.json'

const D = o => ({ drug_code: 'X', drug_name: '', atc_code: '', narcotic_type: '일반', status: '사용', category: '경구제', ...o })
const 정 = D({ drug_code: 'T1', drug_name: '우루사정100mg', atc_code: 'A05AA02' })
const 캡 = D({ drug_code: 'C1', drug_name: '메모엠연질캡슐', atc_code: 'N07AX02' })
const 시럽 = D({ drug_code: 'S1', drug_name: '레보투스시럽', atc_code: 'R05DB27' })
const 마약 = D({ drug_code: 'N1', drug_name: '타진서방정5/2.5mg', atc_code: 'N02AA55', narcotic_type: '마약' })

describe('isAtcManual', () => {
  it('atc_excluded 가 true 일 때만', () => {
    expect(isAtcManual({ atc_excluded: true })).toBe(true)
    expect(isAtcManual({ atc_excluded: false })).toBe(false)
    expect(isAtcManual({})).toBe(false)
    expect(isAtcManual(null)).toBe(false)
  })
  it('표시 글자', () => { expect(ATC_MANUAL_LABEL).toBe('ATC 수기') })
})

describe('① ATC 수기 약은 번호별 목록에서 빠진다', () => {
  const drugs = [정, 캡, { ...정, drug_code: 'T2', drug_name: '우루사정200mg', atc_excluded: true }]
  const p = buildPowderTable(drugs, {}, {})
  it('1번 목록에 안 들어간다', () => {
    expect(p.groups.find(g => g.no === 1).list.map(x => x.d.drug_code)).toEqual(['T1'])
  })
  it('수기조제 묶음에 들어간다', () => {
    expect(p.manual.map(x => x.d.drug_code)).toEqual(['T2'])
  })
  it('1번의 「그 밖」에서도 빠진다', () => {
    expect(p.groups.find(g => g.no === 1).nonSr.map(x => x.d.drug_code)).toEqual(['T1'])
  })
})

describe('② 번호 자체는 그대로다 — 검색에서는 보인다', () => {
  const d = { ...정, atc_excluded: true }
  const p = buildPowderTable([d], {}, {})
  it('rows 에는 남아 있다', () => {
    expect(p.rows.map(x => x.d.drug_code)).toEqual(['T1'])
    expect(p.total).toBe(1)
  })
  it('번호가 1번 그대로다', () => {
    expect(p.rows[0].r.no).toBe(decideGroup(d).no)
    expect(p.rows[0].r.no).toBe(1)
  })
  it('atcManual 표시가 붙어 있다', () => {
    expect(p.rows[0].atcManual).toBe(true)
  })
})

describe('③ 수기조제 묶음 = 가루약 + ATC', () => {
  const drugs = [시럽, 마약, { ...정, atc_excluded: true }, 캡]
  const p = buildPowderTable(drugs, {}, {})
  it('넷 중 셋이 손으로 조제다', () => {
    expect(p.manual.map(x => x.d.drug_code).sort()).toEqual(['N1', 'S1', 'T1'])
  })
  it('속내를 따로 센다', () => {
    expect(p.manualPowder.map(x => x.d.drug_code).sort()).toEqual(['N1', 'S1'])
    expect(p.manualAtc.map(x => x.d.drug_code)).toEqual(['T1'])
  })
  it('가루약 수기조제는 라벨이 그대로다', () => {
    expect(p.manualPowder.every(x => x.r.label === MANUAL)).toBe(true)
  })
  it('ATC 수기는 번호 라벨을 그대로 갖는다', () => {
    expect(p.manualAtc[0].r.label).toBe('일반 정제')
  })
  it('합계는 줄지 않는다 — 옮긴 것이지 뺀 것이 아니다', () => {
    expect(p.total).toBe(4)
  })
})

describe('★ ④ atc_excluded 가 없는 자료에서는 아무것도 안 바뀐다', () => {
  const drugs = FIX.map(x => ({
    drug_code: x.code, drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc,
    status: '사용', category: '경구제',
  }))
  const p = buildPowderTable(drugs, {}, {})
  it('359종 그대로', () => { expect(p.total).toBe(359) })
  it('수기조제는 24종 — ATC 수기가 0종이므로 전과 같다', () => {
    expect(p.manual.length).toBe(24)
    expect(p.manualAtc.length).toBe(0)
    expect(p.manualPowder.length).toBe(24)
  })
  it('번호별 수가 보고한 값 그대로', () => {
    const want = { 1: 173, 2: 65, 3: 12, 4: 5, 5: 23, 6: 42, 7: 9, 8: 3, 9: 3 }
    for (const n of GROUP_NOS) {
      expect(p.groups.find(g => g.no === n).list.length, n + '번').toBe(want[n])
    }
  })
})

describe('지금 운영 값 — ATC 수기 8종이 1번·6번에서 빠진다', () => {
  /* 2026-11-11 실측: 1번 6종 · 6번 2종 */
  const names1 = ['고려은단비타민씨정', '바라크루드정0.5mg', '소마지나정500mg',
    '알레네정70mg', '이반드렌정150mg', '한미탐스오디정0.2mg']
  const names6 = ['메가트리연질캡슐', '메모엠연질캡슐']
  const drugs = FIX.map(x => ({
    drug_code: x.code, drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc,
    status: '사용', category: '경구제',
    atc_excluded: names1.includes(x.name) || names6.includes(x.name),
  }))
  const p = buildPowderTable(drugs, {}, {})
  it('1번 173 → 167', () => { expect(p.groups.find(g => g.no === 1).list.length).toBe(167) })
  it('6번 42 → 40', () => { expect(p.groups.find(g => g.no === 6).list.length).toBe(40) })
  it('수기조제 24 → 32', () => { expect(p.manual.length).toBe(32) })
  it('★ 합계는 359 그대로 — 옮긴 것이지 사라진 것이 아니다', () => {
    expect(p.total).toBe(359)
  })
  it('★ 번호는 그대로다 — 검색에서 1번·6번으로 보인다', () => {
    for (const n of names1) expect(p.rows.find(x => x.d.drug_name === n).r.no, n).toBe(1)
    for (const n of names6) expect(p.rows.find(x => x.d.drug_name === n).r.no, n).toBe(6)
  })
})
