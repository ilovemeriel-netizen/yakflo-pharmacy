/* 「3개월 이상 사용량 0」 판정 규칙
 * (2026-11-13 확정 · 2026-11-14 단계 3/6/9/12개월로 넓힘 — 이정화 님 결정)
 *
 * 업무 규칙 — 직전 3개월 실제 출고 0 이면 **이유와 상관없이** 발주·긴급 대상이 아니다.
 *   · 비상 보유 약·계절 약 예외 없음 · 새 약도 전년값을 쓰지 않음
 *   · 현재고 0 은 「재고없음」으로 남긴다
 *
 * 단계 — 창은 최신 마감월에서 거꾸로 3 / 6 / 9 / 12개월.
 *   · **가장 높은 단계 하나만** 준다 (12 → 9 → 6 → 3)
 *   · ★ 그 창에 **마감 줄이 n개 모두 있을 때만** 그 단계를 준다.
 *     안 보면 들인 지 한 달밖에 안 된 약이 합계 0 이라는 이유로 「9개월 사용량 0」이 된다
 *     (2026-11-14 실측 — 줄 수를 안 보면 13종이 엉뚱한 단계로 갔다).
 *   · 12개월은 「코드 중지 검토」다. **중지는 사람이** 재고 0 뒤에 직접 한다.
 */
import { describe, it, expect } from 'vitest'
import {
  UNUSED_FROM, UNUSED_MIN_SNAPS, UNUSED_TIERS, UNUSED_CARD, TIER_NS,
  STOP_TIER_N, STOP_SUFFIX,
  monthsBack, recordedMonths, tierReady, readyTiers,
  tierLabel, isUnusedLabel, tierByKey,
  foldSnapshots, attachUnused, tierOf, isUnused,
  stockAmount, isOverStock, sortUnused, normCode, monthKey,
} from './unusedStock.js'

const snap = (code, y, m, out) => ({ drug_code: code, snap_year: y, snap_month: m, total_out_qty: out })
/* 창 묶음 — 화면(loadUnused)이 만드는 것과 **같은 모양**이다 */
const WIN = (y, m) => { const w = {}; for (const n of TIER_NS) w[n] = monthsBack(y, m, n); return w }
const W = WIN(2026, 10)
/* 그 달부터 거꾸로 k개월치 마감 줄을 만든다 (출고는 전부 out) */
const runs = (code, y, m, k, out) => monthsBack(y, m, k).map(x => snap(code, x.y, x.m, out))

describe('★ ① 기준 기간 — 2026-01 부터', () => {
  it('시작월이 2026-01 이다 — 마감표가 있는 첫 달', () => {
    expect(UNUSED_FROM).toEqual({ y: 2026, m: 1 })
  })
  it('쌓인 개월 수를 센다', () => {
    expect(recordedMonths({ y: 2026, m: 10 })).toBe(10)
    expect(recordedMonths({ y: 2026, m: 1 })).toBe(1)
    expect(recordedMonths({ y: 2025, m: 12 })).toBe(0)   /* 시작 전 */
    expect(recordedMonths(null)).toBe(0)
  })
})

describe('★★ ② 단계가 열리는 때 — 12개월은 아직 아니다', () => {
  it('지금(2026-10 마감)은 3·6·9개월을 쓸 수 있다', () => {
    expect(tierReady({ y: 2026, m: 10 }, 3)).toBe(true)
    expect(tierReady({ y: 2026, m: 10 }, 6)).toBe(true)
    expect(tierReady({ y: 2026, m: 10 }, 9)).toBe(true)
    expect(tierReady({ y: 2026, m: 10 }, 12)).toBe(false)
    expect(readyTiers({ y: 2026, m: 10 }).map(t => t.key)).toEqual(['3개월', '6개월', '9개월'])
  })
  it('★ 12개월은 2026-12 마감 뒤에 열린다', () => {
    expect(tierReady({ y: 2026, m: 11 }, 12)).toBe(false)
    expect(tierReady({ y: 2026, m: 12 }, 12)).toBe(true)
    expect(readyTiers({ y: 2026, m: 12 }).map(t => t.key)).toEqual(['3개월', '6개월', '9개월', '12개월'])
  })
  it('단계는 넷이고 3·6·9·12개월이다', () => {
    expect(UNUSED_TIERS.map(t => [t.key, t.n])).toEqual([['3개월', 3], ['6개월', 6], ['9개월', 9], ['12개월', 12]])
    expect(TIER_NS).toEqual([3, 6, 9, 12])
  })
  it('★ 12개월만 글자가 다르다 — 「코드 중지 검토」', () => {
    expect(STOP_TIER_N).toBe(12)
    expect(STOP_SUFFIX).toBe('코드 중지 검토')
  })
  it('카드 이름은 단계를 모두 아우른다', () => {
    expect(UNUSED_CARD).toBe('3개월 이상 사용량 0')
  })
})

describe('★ ③ 창 — 해가 바뀌어도 맞게', () => {
  it('2026-10 에서 석 달은 10·9·8월', () => {
    expect(monthsBack(2026, 10, 3)).toEqual([{ y: 2026, m: 10 }, { y: 2026, m: 9 }, { y: 2026, m: 8 }])
  })
  it('2026-10 에서 아홉 달은 10월부터 2월까지', () => {
    const w = monthsBack(2026, 10, 9)
    expect(w).toHaveLength(9)
    expect(w[0]).toEqual({ y: 2026, m: 10 })
    expect(w[8]).toEqual({ y: 2026, m: 2 })
  })
  it('1월에서 석 달은 1·12·11월 — 해를 넘는다', () => {
    expect(monthsBack(2027, 1, 3)).toEqual([{ y: 2027, m: 1 }, { y: 2026, m: 12 }, { y: 2026, m: 11 }])
  })
  it('달 열쇠는 두 자리로 맞춘다', () => {
    expect(monthKey(2026, 7)).toBe('2026-07')
  })
})

describe('★★ ④ 마감표 접기 — 창마다 따로 센다', () => {
  const rows = [
    ...runs('AAA', 2026, 10, 9, 0),              /* 아홉 달 내내 0 */
    snap('AAA', 2026, 1, 999),                   /* ★ 9개월 창 밖 — 9개월 셈에 들어가면 안 된다 */
    ...runs('BBB', 2026, 10, 3, 0),              /* 석 달만 */
    snap('BBB', 2026, 5, 4),                     /* 6개월 창 안 — 6개월 셈에는 들어간다 */
    snap('CCC', 2026, 10, 0),                    /* 줄이 하나뿐 */
  ]
  const map = foldSnapshots(rows, W)
  it('창 안의 출고만 더한다 — 3개월 창', () => {
    expect(map.get('AAA').out[3]).toBe(0)
    expect(map.get('BBB').out[3]).toBe(0)
  })
  it('★ 창마다 합계가 다르다 — BBB 는 3개월 0 인데 6개월은 4', () => {
    expect(map.get('BBB').out[3]).toBe(0)
    expect(map.get('BBB').out[6]).toBe(4)
  })
  it('★ 9개월 창 밖(2026-01)의 999 를 9개월 셈에 넣지 않는다', () => {
    expect(map.get('AAA').out[9]).toBe(0)
    expect(map.get('AAA').out[12]).toBe(999)   /* 12개월 창에는 들어간다 */
  })
  it('마감 줄 수를 창마다 센다', () => {
    expect(map.get('AAA').snaps[3]).toBe(3)
    expect(map.get('AAA').snaps[9]).toBe(9)
    expect(map.get('CCC').snaps[3]).toBe(1)
  })
  it('약품코드는 대소문자·공백을 맞춰 본다', () => {
    const m2 = foldSnapshots([snap(' aaa ', 2026, 10, 7)], W)
    expect(m2.get('AAA').out[3]).toBe(7)
    expect(normCode(' aaa ')).toBe('AAA')
  })
})

describe('★★ ⑤ 단계 판정 — 가장 높은 하나만', () => {
  const map = foldSnapshots([
    ...runs('T9', 2026, 10, 9, 0),                                   /* 아홉 달 0 → 9개월 */
    ...runs('T6', 2026, 10, 6, 0), snap('T6', 2026, 1, 5),           /* 여섯 달 0, 9개월 줄 모자람 → 6개월 */
    ...runs('T3', 2026, 10, 9, 0).map((r, i) => i === 3 ? { ...r, total_out_qty: 2 } : r), /* 7월에 2개 나감 → 3개월 */
    ...runs('USED', 2026, 10, 9, 0).map((r, i) => i === 0 ? { ...r, total_out_qty: 3 } : r), /* 10월에 나감 → 단계 없음 */
    ...runs('NEW', 2026, 10, 2, 0),                                  /* 줄 2개 → 판정 안 함 */
    ...runs('EMPTY', 2026, 10, 9, 0),                                /* 현재고 0 */
    ...runs('THIN9', 2026, 10, 8, 0),                                /* 줄 8개 — 9개월은 못 준다 */
  ], W)
  const D = o => ({ drug_code: o.code, current_qty: o.qty == null ? 10 : o.qty, ...o })
  const list = attachUnused([
    D({ code: 'T9' }), D({ code: 'T6' }), D({ code: 'T3' }), D({ code: 'USED' }),
    D({ code: 'NEW' }), D({ code: 'EMPTY', qty: 0 }), D({ code: 'THIN9' }), D({ code: 'NOSNAP' }),
  ], map)
  const by = c => list.find(d => d.drug_code === c)

  it('아홉 달 내내 0 이고 줄이 9개면 9개월 단계다', () => {
    expect(tierOf(by('T9'))).toBe(9)
    expect(isUnused(by('T9'))).toBe(true)
  })
  it('★ 가장 높은 단계 하나만 준다 — 3·6·9 가 모두 0 이어도 9개월이다', () => {
    expect(tierOf(by('T9'))).toBe(9)
    expect(tierOf(by('T9'))).not.toBe(3)
  })
  it('여섯 달만 0 이면 6개월 단계다', () => {
    expect(tierOf(by('T6'))).toBe(6)
  })
  it('석 달만 0 이면 3개월 단계다', () => {
    expect(tierOf(by('T3'))).toBe(3)
  })
  it('★★ 창에 마감 줄이 모자라면 그 단계를 주지 않는다 — 줄 8개는 9개월이 아니다', () => {
    /* ★ 이 한 줄이 없으면 2026-10 에 들인 새 약이 「9개월 사용량 0」이 된다 */
    expect(by('THIN9').__unusedSnaps[9]).toBe(8)
    expect(tierOf(by('THIN9'))).toBe(6)
  })
  it('★ 들인 지 얼마 안 된 약(줄 2개)은 아무 단계도 주지 않는다', () => {
    expect(tierOf(by('NEW'))).toBe(null)
    expect(isUnused(by('NEW'))).toBe(false)
  })
  it('한 번이라도 나갔으면 단계가 없다', () => {
    expect(tierOf(by('USED'))).toBe(null)
  })
  it('★ 현재고 0 은 「재고없음」으로 남긴다 — 단계를 주지 않는다', () => {
    expect(tierOf(by('EMPTY'))).toBe(null)
  })
  it('마감 줄이 아예 없는 약도 판정하지 않는다', () => {
    expect(by('NOSNAP').__unusedOut).toBe(null)
    expect(tierOf(by('NOSNAP'))).toBe(null)
  })
  it('★ 재료가 안 붙은 줄은 판정하지 않는다 — 섣불리 몰지 않는다', () => {
    expect(tierOf({ drug_code: 'X', current_qty: 10 })).toBe(null)
    expect(isUnused(null)).toBe(false)
  })
  it('★ 원본 배열을 건드리지 않는다', () => {
    const orig = [{ drug_code: 'T9', current_qty: 10 }]
    const out = attachUnused(orig, map)
    expect(orig[0].__unusedOut).toBeUndefined()
    expect(out[0].__unusedOut[9]).toBe(0)
    expect(out[0].__unusedSnaps[9]).toBe(9)
  })
  it('가장 낮은 단계의 잣대는 마감 줄 3개다', () => {
    expect(UNUSED_MIN_SNAPS).toBe(3)
  })
})

describe('★ ⑥ 상태 글자 — 한 곳에서만 만든다', () => {
  it('단계마다 글자가 다르다', () => {
    expect(tierLabel(3)).toBe('3개월 사용량 0')
    expect(tierLabel(6)).toBe('6개월 사용량 0')
    expect(tierLabel(9)).toBe('9개월 사용량 0')
    expect(tierLabel(12)).toBe('12개월 사용량 0')
  })
  it('네 글자만 「사용량 0」으로 본다', () => {
    for (const n of TIER_NS) expect(isUnusedLabel(tierLabel(n))).toBe(true)
    expect(isUnusedLabel('긴급')).toBe(false)
    expect(isUnusedLabel('기준미설정')).toBe(false)
    expect(isUnusedLabel(UNUSED_CARD)).toBe(false)   /* 카드 이름은 상태 글자가 아니다 */
  })
  it('칩 열쇠로 개월 수를 찾는다', () => {
    expect(tierByKey('9개월')).toBe(9)
    expect(tierByKey('전체')).toBe(null)
  })
})

describe('★ ⑦ 목록 — 재고금액·과잉·정렬', () => {
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
