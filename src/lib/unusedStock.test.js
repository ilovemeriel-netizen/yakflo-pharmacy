/* 「미사용」 판정 규칙 (2026-11-13 이정화 님 확정)
 *
 * 업무 규칙 — 직전 3개월 실제 출고 0 이면 **이유와 상관없이** 발주·긴급 대상이 아니다.
 *   · 비상 보유 약·계절 약 예외 없음 · 새 약도 전년값을 쓰지 않음
 *   · 기준 기간은 2026-07 부터 (1~6월 마감표는 엑셀 최종값이라 안 씀)
 *   · 들인 지 3개월 안 된 약은 판정에서 뺀다
 *   · 현재고 0 은 「재고없음」으로 남긴다
 */
import { describe, it, expect } from 'vitest'
import {
  UNUSED_FROM, UNUSED_MIN_SNAPS, UNUSED_TIERS,
  monthsBack, recordedMonths, tierReady, readyTiers,
  foldSnapshots, attachUnused, isUnused, stockAmount, isOverStock, sortUnused, normCode, monthKey,
} from './unusedStock.js'

const snap = (code, y, m, out) => ({ drug_code: code, snap_year: y, snap_month: m, total_out_qty: out })
const W3 = monthsBack(2026, 10, 3)      /* 8·9·10월 */

describe('★ ① 기준 기간 — 2026-07 부터', () => {
  it('시작월이 2026-07 이다 — 약플로에 직접 입력하기 시작한 달', () => {
    expect(UNUSED_FROM).toEqual({ y: 2026, m: 7 })
  })
  it('쌓인 개월 수를 센다', () => {
    expect(recordedMonths({ y: 2026, m: 10 })).toBe(4)   /* 7·8·9·10 */
    expect(recordedMonths({ y: 2026, m: 7 })).toBe(1)
    expect(recordedMonths({ y: 2026, m: 6 })).toBe(0)    /* 시작 전 */
    expect(recordedMonths(null)).toBe(0)
  })
  it('★ 1~6월 마감이 아무리 많아도 세지 않는다', () => {
    /* 2026-01 마감까지 있어도 기준은 7월부터다 */
    expect(recordedMonths({ y: 2026, m: 10 })).toBe(4)
  })
})

describe('★★ ② 단계가 열리는 때 — 6개월·1년은 아직 아니다', () => {
  it('지금(2026-10 마감)은 3개월만 쓸 수 있다', () => {
    expect(tierReady({ y: 2026, m: 10 }, 3)).toBe(true)
    expect(tierReady({ y: 2026, m: 10 }, 6)).toBe(false)
    expect(tierReady({ y: 2026, m: 10 }, 12)).toBe(false)
    expect(readyTiers({ y: 2026, m: 10 }).map(t => t.key)).toEqual(['3개월'])
  })
  it('★ 6개월은 2026-12 마감 뒤에 열린다', () => {
    expect(tierReady({ y: 2026, m: 11 }, 6)).toBe(false)
    expect(tierReady({ y: 2026, m: 12 }, 6)).toBe(true)
    expect(readyTiers({ y: 2026, m: 12 }).map(t => t.key)).toEqual(['3개월', '6개월'])
  })
  it('★ 1년은 2027-06 마감 뒤에 열린다', () => {
    expect(tierReady({ y: 2027, m: 5 }, 12)).toBe(false)
    expect(tierReady({ y: 2027, m: 6 }, 12)).toBe(true)
    expect(readyTiers({ y: 2027, m: 6 }).map(t => t.key)).toEqual(['3개월', '6개월', '1년'])
  })
  it('단계는 셋이고 3·6·12개월이다', () => {
    expect(UNUSED_TIERS.map(t => [t.key, t.n])).toEqual([['3개월', 3], ['6개월', 6], ['1년', 12]])
  })
})

describe('★ ③ 창 — 해가 바뀌어도 맞게', () => {
  it('2026-10 에서 석 달은 10·9·8월', () => {
    expect(monthsBack(2026, 10, 3)).toEqual([{ y: 2026, m: 10 }, { y: 2026, m: 9 }, { y: 2026, m: 8 }])
  })
  it('1월에서 석 달은 1·12·11월 — 해를 넘는다', () => {
    expect(monthsBack(2027, 1, 3)).toEqual([{ y: 2027, m: 1 }, { y: 2026, m: 12 }, { y: 2026, m: 11 }])
  })
  it('달 열쇠는 두 자리로 맞춘다', () => {
    expect(monthKey(2026, 7)).toBe('2026-07')
  })
})

describe('★ ④ 마감표 접기 — 창 밖은 안 센다', () => {
  const rows = [
    snap('AAA', 2026, 10, 5), snap('AAA', 2026, 9, 0), snap('AAA', 2026, 8, 0),
    snap('BBB', 2026, 10, 0), snap('BBB', 2026, 9, 0), snap('BBB', 2026, 8, 0),
    snap('BBB', 2026, 1, 999),                       /* ★ 창 밖 — 세면 안 된다 */
    snap('CCC', 2026, 10, 0),                        /* 줄이 하나뿐 — 들인 지 얼마 안 됨 */
  ]
  const map = foldSnapshots(rows, W3)
  it('창 안의 출고만 더한다', () => {
    expect(map.get('AAA').out).toBe(5)
    expect(map.get('BBB').out).toBe(0)
  })
  it('★ 창 밖(2026-01)의 999 를 세지 않는다 — 1~6월은 판정에 안 쓴다', () => {
    expect(map.get('BBB').out).toBe(0)
    expect(map.get('BBB').snaps).toBe(3)
  })
  it('마감 줄 수를 센다', () => {
    expect(map.get('CCC').snaps).toBe(1)
  })
  it('약품코드는 대소문자·공백을 맞춰 본다', () => {
    const m2 = foldSnapshots([snap(' aaa ', 2026, 10, 7)], W3)
    expect(m2.get('AAA').out).toBe(7)
    expect(normCode(' aaa ')).toBe('AAA')
  })
})

describe('★★ ⑤ 판정 — 무엇이 미사용인가', () => {
  const map = foldSnapshots([
    snap('ZERO', 2026, 10, 0), snap('ZERO', 2026, 9, 0), snap('ZERO', 2026, 8, 0),
    snap('USED', 2026, 10, 3), snap('USED', 2026, 9, 0), snap('USED', 2026, 8, 0),
    snap('NEW', 2026, 10, 0), snap('NEW', 2026, 9, 0),        /* 줄 2개 — 들인 지 얼마 안 됨 */
    snap('EMPTY', 2026, 10, 0), snap('EMPTY', 2026, 9, 0), snap('EMPTY', 2026, 8, 0),
  ], W3)
  const D = o => ({ drug_code: o.code, current_qty: o.qty == null ? 10 : o.qty, ...o })
  const list = attachUnused([
    D({ code: 'ZERO' }), D({ code: 'USED' }), D({ code: 'NEW' }),
    D({ code: 'EMPTY', qty: 0 }), D({ code: 'NOSNAP' }),
  ], map)
  const by = c => list.find(d => d.drug_code === c)

  it('3개월 출고 0 이면 미사용이다', () => {
    expect(isUnused(by('ZERO'))).toBe(true)
  })
  it('한 번이라도 나갔으면 미사용이 아니다', () => {
    expect(isUnused(by('USED'))).toBe(false)
  })
  it('★ 들인 지 3개월 안 된 약은 판정에서 뺀다', () => {
    expect(by('NEW').__unusedThin).toBe(true)
    expect(isUnused(by('NEW'))).toBe(false)
  })
  it('★ 현재고 0 은 「재고없음」으로 남긴다 — 미사용이 아니다', () => {
    expect(isUnused(by('EMPTY'))).toBe(false)
  })
  it('마감 줄이 아예 없는 약도 판정하지 않는다', () => {
    expect(by('NOSNAP').__unusedThin).toBe(true)
    expect(isUnused(by('NOSNAP'))).toBe(false)
  })
  it('★ 재료가 안 붙은 줄은 판정하지 않는다 — 섣불리 몰지 않는다', () => {
    expect(isUnused({ drug_code: 'X', current_qty: 10 })).toBe(false)
    expect(isUnused(null)).toBe(false)
  })
  it('★ 원본 배열을 건드리지 않는다', () => {
    const orig = [{ drug_code: 'ZERO', current_qty: 10 }]
    const out = attachUnused(orig, map)
    expect(orig[0].__unusedOut).toBeUndefined()
    expect(out[0].__unusedOut).toBe(0)
  })
  it('잣대는 마감 줄 3개다', () => {
    expect(UNUSED_MIN_SNAPS).toBe(3)
  })
})

describe('★ ⑥ 목록 — 재고금액·과잉·정렬', () => {
  const L = [
    { drug_code: 'A', drug_name: '하하정', current_qty: 10, purchase_price: 100, max_stock: 5 },
    { drug_code: 'B', drug_name: '가가정', current_qty: 2, purchase_price: 5000, max_stock: 0 },
    { drug_code: 'C', drug_name: '나나정', current_qty: 1, purchase_price: 50, max_stock: 100 },
  ]
  it('재고금액 = 현재고 × 구입단가 — 통당단가를 쓰지 않는다', () => {
    expect(stockAmount(L[0])).toBe(1000)
    expect(stockAmount(L[1])).toBe(10000)
  })
  it('과잉은 최대재고를 넘은 약이다 — 최대재고 0 은 과잉이 아니다', () => {
    expect(isOverStock(L[0])).toBe(true)
    expect(isOverStock(L[1])).toBe(false)
    expect(isOverStock(L[2])).toBe(false)
  })
  it('★ 재고금액 큰 순으로 줄을 세운다', () => {
    expect(sortUnused(L, true).map(d => d.drug_code)).toEqual(['B', 'A', 'C'])
  })
  it('이름 순으로도 세운다', () => {
    expect(sortUnused(L, false).map(d => d.drug_code)).toEqual(['B', 'C', 'A'])
  })
  it('★ 원본을 뒤집지 않는다', () => {
    const before = L.map(d => d.drug_code).join(',')
    sortUnused(L, true)
    expect(L.map(d => d.drug_code).join(',')).toBe(before)
  })
})
