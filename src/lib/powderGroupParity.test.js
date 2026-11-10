/* ★ 엑셀 359종 ↔ 화면 계산 — **전부 같은지** 못 박는다 (2026-11-10)
 *
 * 고정값(`__fixtures__/powderGroup.2026-11-10.json`)은
 * **이정화 님이 검토하신 엑셀**(라벨_시안/가루약_분리번호_검토.xlsx 의 「약품별 상세」 시트)을
 * 그대로 굳힌 것이다. 그날 운영 DB 의 **사용 중인 경구제 359종**이 들어 있다.
 *
 * 이 시험이 지키는 것
 *   ① 화면이 쓰는 `decideGroup()` 이 검토된 번호와 **한 종도 안 틀린다**
 *   ② 번호별 수가 보고한 값과 같다
 *   ③ 「확인 필요」가 0종이다
 *   ④ 가루 위험·비고가 그대로다
 *
 * 규칙을 고치면 여기가 먼저 깨진다. 깨지면 **운영에 반영하기 전에**
 * 이정화 님께 무엇이 어떻게 달라지는지 보고할 것.
 */
import { describe, it, expect } from 'vitest'
import { decideGroup, MANUAL, CHECK } from './powderGroup'
import FIX from './__fixtures__/powderGroup.2026-11-10.json'

/* 엑셀 ② 시트의 「번호」 칸 — 숫자이거나 '—'(수기조제) */
const want = x => (x.no === '—' ? null : Number(x.no))

describe('고정값 자체', () => {
  it('359종이다', () => {
    expect(FIX.length).toBe(359)
  })
  it('약품코드가 겹치지 않는다', () => {
    expect(new Set(FIX.map(x => x.code)).size).toBe(359)
  })
  it('모든 줄에 ATC 가 있다 — 비면 규칙을 못 쓴다', () => {
    expect(FIX.filter(x => !x.atc).map(x => x.name)).toEqual([])
  })
})

describe('★ 엑셀 번호 = 화면 계산 번호 (359종 전수)', () => {
  const diff = FIX.map(x => {
    const r = decideGroup({ drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc })
    return { x, r }
  }).filter(({ x, r }) => r.no !== want(x))

  it('다른 약이 0종이다', () => {
    const msg = diff.map(({ x, r }) =>
      x.name + ' [' + x.atc + '] 엑셀=' + x.no + ' 계산=' + (r.no == null ? r.label : r.no)).join('\n')
    expect(diff.length, '\n' + msg).toBe(0)
  })

  it('구분 이름도 같다', () => {
    const bad = FIX.filter(x => {
      const r = decideGroup({ drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc })
      return r.label !== x.gubun
    }).map(x => x.name + ' 엑셀=' + x.gubun)
    expect(bad).toEqual([])
  })
})

describe('번호별 수 — 보고한 값 그대로', () => {
  const count = {}
  for (const x of FIX) {
    const r = decideGroup({ drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc })
    const k = r.no == null ? r.label : r.no
    count[k] = (count[k] || 0) + 1
  }
  const 기준 = { 1: 173, 2: 65, 3: 12, 4: 5, 5: 23, 6: 42, 7: 9, 8: 3, 9: 3, [MANUAL]: 24 }
  for (const [k, v] of Object.entries(기준)) {
    it(k + ' = ' + v + '종', () => { expect(count[k] || 0).toBe(v) })
  }
  it('합계가 359다', () => {
    expect(Object.values(count).reduce((a, b) => a + b, 0)).toBe(359)
  })
  it('★ 「확인 필요」가 0종이다', () => {
    expect(count[CHECK] || 0).toBe(0)
  })
})

describe('가루 위험 — 2종, 비고까지 같다', () => {
  const haz = FIX.map(x => ({ x, r: decideGroup({ drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc }) }))
    .filter(({ r }) => !!r.hazard)
  it('2종이다', () => {
    expect(haz.map(({ x }) => x.name).sort()).toEqual(['아나딘연질캡슐0.5mg', '피나스테아정5mg'])
  })
  it('엑셀의 「가루 위험」 칸과 짝이 맞는다', () => {
    const fromFix = FIX.filter(x => x.hz === 1).map(x => x.name).sort()
    expect(haz.map(({ x }) => x.name).sort()).toEqual(fromFix)
  })
  it('비고(재확인 필요)도 같다', () => {
    for (const { x, r } of haz) expect(r.note, x.name).toBe(x.note)
  })
})

describe('수기조제 24종 — 마약 3 + 액체·가루 21', () => {
  const man = FIX.filter(x => decideGroup({ drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc }).label === MANUAL)
  it('24종이다', () => { expect(man.length).toBe(24) })
  it('마약 3종이 들어 있다', () => {
    expect(man.filter(x => x.narc === '마약').map(x => x.name).sort())
      .toEqual(['뉴신타서방정50mg', '마이폴캡슐10mg', '타진서방정5/2.5mg'])
  })
  it('나머지 21종은 액체·가루 제형이다', () => {
    const liq = man.filter(x => x.narc !== '마약')
    expect(liq.length).toBe(21)
    for (const x of liq) {
      const r = decideGroup({ drug_name: x.name, atc_code: x.atc, narcotic_type: x.narc })
      expect(r.why, x.name).toContain('액체·가루')
    }
  })
})
