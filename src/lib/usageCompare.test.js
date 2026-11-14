/* 사용량 비교 — 계산을 못 박는다 (2026-11-09 이정화 님 승인 규칙 1~7).
 *
 * 못 박는 것
 *  ① 기간이 **달력**이다 — 「오늘부터 90일」이 아니다. 해가 바뀌어도 맞다
 *  ② 세는 거래는 **출고 하나**다 — 반품·폐기·조정·입고는 안 센다
 *  ③ 계산식을 새로 만들지 않았다 — 월평균·안전재고·최대재고가 기존 값 그대로다
 *  ④ 백신은 **ATC J07** 로 가린다 — 이름으로 가리지 않는다
 *  ⑤ 극소량(새 월평균 0)은 **기존 값을 지킨다** — 안전재고를 잃지 않는다
 *  ⑥ 극소량 줄은 r3 를 **null** 로 보낸다 — 그래야 DB 가 그 칸을 안 건드린다
 *  ⑦ 전년(py)은 **보내지 않는다** — 수기 유지
 *  ⑧ 재고 상태 식이 App.jsx 의 stockStat 과 **같다**
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  closedWindow, isVaccine, monthlyAvgOf, stockStat, compareOne,
  buildUsageCompare, applyRows, applySummary, APPLY_FIELDS, LEAD_TIME, VACCINE_ATC,
} from './usageCompare.js'
import { SAFETY_FACTOR, MAX_FACTOR } from './usageParse.js'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', current_qty: 100,
  recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, ...o })

describe('① 달력 창 — 「오늘부터 90일」이 아니다', () => {
  it('2026년 10월이면 8·9·10월, 10월 하루', () => {
    expect(closedWindow(2026, 10)).toEqual({
      m1From: '2026-10-01', m3From: '2026-08-01', toExclusive: '2026-11-01',
    })
  })

  it('★ 해가 바뀌어도 맞다 — 1월이면 전해 11·12월이 들어온다', () => {
    expect(closedWindow(2026, 1)).toEqual({
      m1From: '2026-01-01', m3From: '2025-11-01', toExclusive: '2026-02-01',
    })
    expect(closedWindow(2026, 2)).toEqual({
      m1From: '2026-02-01', m3From: '2025-12-01', toExclusive: '2026-03-01',
    })
  })

  it('★ 마지막 날은 포함하지 않는다 — 다음달 1일이 끝이다', () => {
    expect(closedWindow(2026, 12).toExclusive).toBe('2027-01-01')
  })
})

describe('② 세는 거래는 출고 하나뿐', () => {
  const drugs = [D({ drug_code: 'A' })]
  const tx = ty => [{ drug_code: 'A', type: ty, transaction_date: '2026-10-05', quantity: 50 }]

  it.each([['반품'], ['폐기'], ['조정'], ['입고']])('%s 는 세지 않는다', ty => {
    expect(buildUsageCompare(drugs, tx(ty), 2026, 10).rows[0].n3).toBe(0)
  })

  it('출고만 센다', () => {
    expect(buildUsageCompare(drugs, tx('출고'), 2026, 10).rows[0].n3).toBe(50)
  })

  it('★ 창 밖의 출고는 안 들어온다 (7월·11월)', () => {
    const out = [
      { drug_code: 'A', type: '출고', transaction_date: '2026-07-31', quantity: 9 },
      { drug_code: 'A', type: '출고', transaction_date: '2026-11-01', quantity: 7 },
      { drug_code: 'A', type: '출고', transaction_date: '2026-08-01', quantity: 3 },
      { drug_code: 'A', type: '출고', transaction_date: '2026-10-31', quantity: 4 },
    ]
    const r = buildUsageCompare(drugs, out, 2026, 10).rows[0]
    expect(r.n3).toBe(7)    /* 8-01 의 3 + 10-31 의 4 */
    expect(r.n1).toBe(4)    /* 10월분만 */
  })
})

describe('③ 계산식을 새로 만들지 않았다', () => {
  it('안전재고 1.2배 · 최대재고 3배 — usageParse 와 같은 값을 쓴다', () => {
    expect(SAFETY_FACTOR).toBe(1.2)
    expect(MAX_FACTOR).toBe(3)
  })

  /* ★★ 2026-11-14 이정화 님 결정 — 3개월이 **0 이면 0** 이다. 전년으로 넘어가지 않는다.
       「3개월 출고 0 이면 발주 대상 아님」과 맞춘다. 전년으로 받치는 것은
       그 창의 **기록이 아예 없을 때(null)** 뿐이다. */
  it('★ 3개월이 0 이면 월평균도 0 — 전년으로 넘어가지 않는다', () => {
    expect(monthlyAvgOf(0, 120)).toBe(0)
    expect(monthlyAvgOf(0, 0)).toBe(0)
  })
  it('3개월이 숫자면 그 값으로만 센다', () => {
    expect(monthlyAvgOf(300, 0)).toBe(100)
    expect(monthlyAvgOf(9, 999)).toBe(3)
  })
  it('★ 3개월이 null(= 그 창의 기록이 없다)일 때만 전년÷12 로 받친다', () => {
    expect(monthlyAvgOf(null, 120)).toBe(10)
    expect(monthlyAvgOf(null, null)).toBe(null)
  })

  it('월평균에서 안전재고·최대재고가 나온다', () => {
    const r = compareOne(D({ prev_year_usage: 0 }), 300, 100)
    expect(r.nm).toBe(100)
    expect(r.nsf).toBe(Math.ceil(100 * 1.2))
    expect(r.nmx).toBe(Math.round(100 * 3))
  })
})

describe('④ 백신은 ATC J07 로 가린다 — 이름이 아니다', () => {
  it('J07 이면 백신', () => {
    expect(VACCINE_ATC).toBe('J07')
    expect(isVaccine({ atc_code: 'J07BB02' })).toBe(true)
    expect(isVaccine({ atc_code: 'J07AL01' })).toBe(true)
  })

  it('★ 이름에 「프리필드시린지」가 있어도 J07 이 아니면 백신이 아니다', () => {
    /* 운영 실측 4종 — 그라신·미쎄라·에포시스·프롤리아 */
    expect(isVaccine({ drug_name: '그라신300프리필드시린지주', atc_code: 'L03AA02' })).toBe(false)
    expect(isVaccine({ drug_name: '미쎄라프리필드주150μg/0.3mL', atc_code: 'B03XA03' })).toBe(false)
    expect(isVaccine({ drug_name: '에포시스프리필드시린지주 2000IU/0.5mL', atc_code: 'B03XA01' })).toBe(false)
    expect(isVaccine({ drug_name: '프롤리아프리필드시린지', atc_code: 'M05BX04' })).toBe(false)
  })

  it('ATC 가 비어도 터지지 않는다', () => {
    expect(isVaccine({})).toBe(false)
    expect(isVaccine({ atc_code: null })).toBe(false)
    expect(isVaccine(null)).toBe(false)
  })

  it('백신은 기본 체크가 꺼져 있다', () => {
    const r = compareOne(D({ atc_code: 'J07BB02', recent_3m_usage: 2 }), 124, 23)
    expect(r.vac).toBe(true)
    expect(r.changed).toBe(true)
    expect(r.on).toBe(false)
  })
})

describe('⑤ 극소량 — 새 월평균이 0 이면 기존 값을 지킨다', () => {
  it('3개월 출고 1 → round(1÷3)=0 → 안전재고를 지킨다', () => {
    const r = compareOne(D({ recent_3m_usage: 2, monthly_avg: 1, safety_stock: 2, max_stock: 3 }), 1, 0)
    expect(r.tiny).toBe(true)
    expect(r.nm).toBe(1)      /* 기존 월평균 그대로 */
    expect(r.nsf).toBe(2)     /* 기존 안전재고 그대로 — 0 이 되지 않는다 */
    expect(r.nmx).toBe(3)
  })

  it('★ 3개월 0 · 전년 1~5 도 월평균 0 이라 지킨다', () => {
    const r = compareOne(D({ prev_year_usage: 4, monthly_avg: 7, safety_stock: 9 }), 0, 0)
    expect(r.tiny).toBe(true)
    expect(r.nsf).toBe(9)
  })

  it('★ 3개월 0 · 전년 6 이상이면 전년이 채운다 — 극소량이 아니다', () => {
    const r = compareOne(D({ prev_year_usage: 12, safety_stock: 9 }), 0, 0)
    expect(r.tiny).toBe(false)
    expect(r.nm).toBe(1)
    expect(r.nsf).toBe(Math.ceil(1 * 1.2))
  })

  it('3개월 2 는 round(2÷3)=1 이라 극소량이 아니다', () => {
    expect(compareOne(D({}), 2, 0).tiny).toBe(false)
  })

  it('둘 다 0 이면 기존 값을 그대로 둔다', () => {
    const r = compareOne(D({ monthly_avg: 5, safety_stock: 6, max_stock: 15 }), 0, 0)
    expect(r.nm).toBe(5); expect(r.nsf).toBe(6); expect(r.nmx).toBe(15)
  })
})

describe('⑥⑦ 「적용」에 보낼 줄', () => {
  const rows = [
    { code: 'A', tiny: false, n3: 300, n1: 100 },
    { code: 'B', tiny: true, n3: 1, n1: 0 },
    { code: 'C', tiny: false, n3: 50, n1: 20 },
  ]

  it('★ 극소량은 r3 를 null 로 보낸다 — DB 가 3개월·안전재고를 안 건드리게', () => {
    expect(applyRows(rows, ['A', 'B'])).toEqual([
      { code: 'A', r3: 300, r1: 100 },
      { code: 'B', r3: null, r1: 0 },
    ])
  })

  it('고르지 않은 약은 보내지 않는다', () => {
    expect(applyRows(rows, ['C']).map(r => r.code)).toEqual(['C'])
    expect(applyRows(rows, [])).toEqual([])
  })

  it('★ 전년(py)은 보내는 칸에도 줄에도 없다 — 수기 유지', () => {
    expect(APPLY_FIELDS).toEqual(['recent_3m_usage', 'recent_1m_usage'])
    expect(APPLY_FIELDS).not.toContain('prev_year_usage')
    for (const r of applyRows(rows, ['A', 'B', 'C'])) {
      expect(Object.keys(r).sort()).toEqual(['code', 'r1', 'r3'])
    }
  })

  it('Set 으로 줘도 배열로 줘도 같다', () => {
    expect(applyRows(rows, new Set(['A']))).toEqual(applyRows(rows, ['A']))
  })
})

describe('⑧ 재고 상태 — App.jsx 의 stockStat 과 같은 식', () => {
  it('★ App.jsx 소스와 상수가 어긋나지 않는다', () => {
    expect(APP).toContain('LEAD_TIME=14')
    expect(LEAD_TIME).toBe(14)
    /* 식 자체도 글자로 대조한다 — 한쪽만 바뀌면 여기서 걸린다 */
    expect(APP).toContain("if(sf<=0)return q===0?'재고없음':'기준미설정'")
    expect(APP).toContain("if(q<=sf)return'긴급'")
    expect(APP).toContain('Math.max(Math.ceil(sf+(mavg/30)*LEAD_TIME),1)')
  })

  it.each([
    [0, 0, 0, '재고없음'],
    [10, 0, 0, '기준미설정'],
    [5, 10, 0, '긴급'],
    [10, 10, 0, '긴급'],
    [100, 10, 0, '정상'],
  ])('현재고 %s · 안전 %s · 월평균 %s → %s', (q, sf, ma, want) => {
    expect(stockStat(q, sf, ma)).toBe(want)
  })

  it('주문점은 안전재고 + 월평균÷30 × 14일', () => {
    /* 안전 10 · 월평균 30 → 10 + 1×14 = 24 */
    expect(stockStat(24, 10, 30)).toBe('주문필요')
    expect(stockStat(25, 10, 30)).toBe('정상')
  })
})

describe('표 한 벌 — 세는 수가 맞다', () => {
  const drugs = [
    D({ drug_code: 'A', recent_3m_usage: 93, recent_1m_usage: 30, monthly_avg: 31, safety_stock: 38 }),
    D({ drug_code: 'V', atc_code: 'J07BB02', recent_3m_usage: 2 }),
    D({ drug_code: 'Z', recent_3m_usage: 155, monthly_avg: 52, safety_stock: 63 }),
    D({ drug_code: 'S', recent_3m_usage: 0, recent_1m_usage: 0 }),
  ]
  const txns = [
    { drug_code: 'A', type: '출고', transaction_date: '2026-09-10', quantity: 851 },
    { drug_code: 'V', type: '출고', transaction_date: '2026-10-02', quantity: 124 },
  ]
  const p = buildUsageCompare(drugs, txns, 2026, 10)

  it('달라지는 약·백신·출고0 을 따로 센다', () => {
    expect(p.summary.total).toBe(4)
    expect(p.summary.changed).toBe(3)   /* A·V·Z (S 는 전·후 모두 0) */
    expect(p.summary.vac).toBe(1)
    expect(p.summary.zero).toBe(1)      /* Z — 출고 0 인데 저장값 155 */
    expect(p.summary.on).toBe(1)        /* A 만 기본 체크 */
  })

  it('★ 백신과 출고0 은 기본 체크에서 빠진다', () => {
    const on = p.rows.filter(r => r.on).map(r => r.code)
    expect(on).toEqual(['A'])
  })

  it('달라지는 약만 보기', () => {
    expect(p.moved.map(r => r.code)).toEqual(['A', 'V', 'Z'])
  })

  it('적용 요약 — 고른 것만 센다', () => {
    const s = applySummary(p.rows, ['A'])
    expect(s.n).toBe(1)
    expect(s.safety).toBe(1)            /* 38 → ceil(284×1.2) */
  })
})
