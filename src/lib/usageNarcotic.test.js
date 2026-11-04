/* A단계 — 마약·향정은 1개월·3개월을 원내 파일 값으로 덮지 않는다.
   확정 업무 규칙 9 (2026-11-04 이정화 님) — 그 두 칸의 정본은 NIMS 거래량으로 넣은 **출고**다.

   ★ 이 시험이 지키는 것
     ① 범위가 **마약·향정만**이라는 것 — 한외마약이 끼면 조용히 값이 덮인다.
        (2026-10 실측: 한외마약은 원내 값과 출고가 차이 0종이라 일반약과 같이 다룬다.)
     ② **전년사용량은 덮는다** — 건너뛰는 칸은 두 개뿐이다.
     ③ 0 방지는 **칸과 무관하게** 늘 걸린다 — 전년을 올릴 때도 마약·향정은 0 이 되지 않는다.
     ④ 판정은 `narcotic_type` 하나 — 약품명·category 로 추측하지 않는다(확정 업무 규칙 5). */
import { describe, it, expect } from 'vitest'
import {
  NARC_SKIP_TYPES, NARC_SKIP_FIELDS, isNarcSkip, narcCodes, splitNarcotic, buildPreview,
} from './usageParse'

/* 운영 실제 약품으로 만든 표본 — 이름·구분은 2026-11-04 실측 그대로다 */
const DRUGS = [
  { drug_code: 'APR2', drug_name: '알프람정0.25mg', status: '사용', narcotic_type: '향정', recent_1m_usage: 91, recent_3m_usage: 243.5, prev_year_usage: 0, monthly_avg: 51 },
  { drug_code: 'RVTRL', drug_name: '리보트릴정0.5mg', status: '사용', narcotic_type: '향정', recent_1m_usage: 262, recent_3m_usage: 703.5, prev_year_usage: 196, monthly_avg: 237 },
  { drug_code: 'MYPC', drug_name: '마이폴캡슐10mg', status: '사용', narcotic_type: '마약', recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 152, monthly_avg: 13 },
  /* ★ 한외마약 — **건너뛰지 않는다** */
  { drug_code: 'CHNS', drug_name: '코포나시럽', status: '사용', narcotic_type: '한외마약', recent_1m_usage: 768, recent_3m_usage: 2255, prev_year_usage: 0, monthly_avg: 748 },
  { drug_code: 'COUGH', drug_name: '코푸정', status: '사용', narcotic_type: '한외마약', recent_1m_usage: 12, recent_3m_usage: 12, prev_year_usage: 929, monthly_avg: 77 },
  /* 일반 */
  { drug_code: 'GABA', drug_name: '가바로닌캡슐100mg', status: '사용', narcotic_type: '일반', recent_1m_usage: 300, recent_3m_usage: 900, prev_year_usage: 3600, monthly_avg: 300 },
  { drug_code: 'NONE', drug_name: '구분이 빈 약품', status: '사용', recent_1m_usage: 5, recent_3m_usage: 15, prev_year_usage: 60, monthly_avg: 5 },
]

describe('범위 — 마약·향정만, 한외마약은 뺀다', () => {
  it('구분 둘만 건너뛴다', () => {
    expect(NARC_SKIP_TYPES).toEqual(['마약', '향정'])
    expect(NARC_SKIP_TYPES).not.toContain('한외마약')
  })
  it('isNarcSkip — 마약·향정만 true', () => {
    expect(isNarcSkip({ narocotic_type: '향정' })).toBe(false)       /* 철자가 틀리면 false */
    expect(isNarcSkip({ narcotic_type: '향정' })).toBe(true)
    expect(isNarcSkip({ narcotic_type: '마약' })).toBe(true)
    expect(isNarcSkip({ narcotic_type: '한외마약' })).toBe(false)
    expect(isNarcSkip({ narcotic_type: '일반' })).toBe(false)
    expect(isNarcSkip({})).toBe(false)
    expect(isNarcSkip(null)).toBe(false)
  })
  it('앞뒤 공백이 붙어도 가른다', () => {
    expect(isNarcSkip({ narcotic_type: ' 향정 ' })).toBe(true)
  })
  it('약품명·category 로 추측하지 않는다 — 구분 칸만 본다', () => {
    /* 이름에 「마약」이 들어 있어도 구분이 한외마약이면 건너뛰지 않는다 */
    expect(isNarcSkip({ drug_name: '듀로제식디트랜스패취50μg/h ★마약', narcotic_type: '한외마약' })).toBe(false)
    expect(isNarcSkip({ drug_name: '그냥 정', category: '마약', narcotic_type: '일반' })).toBe(false)
  })
  it('narcCodes — 마약·향정 코드만, 대문자로', () => {
    expect(narcCodes(DRUGS).sort()).toEqual(['APR2', 'MYPC', 'RVTRL'])
    expect(narcCodes(DRUGS)).not.toContain('CHNS')
    expect(narcCodes(DRUGS)).not.toContain('COUGH')
  })
  it('narcCodes — 빈 목록에도 터지지 않는다', () => {
    expect(narcCodes(null)).toEqual([])
    expect(narcCodes([])).toEqual([])
  })
})

describe('건너뛰는 칸 — 1개월·3개월만', () => {
  it('두 칸뿐이다', () => {
    expect(NARC_SKIP_FIELDS).toEqual(['recent_1m_usage', 'recent_3m_usage'])
    expect(NARC_SKIP_FIELDS).not.toContain('prev_year_usage')
  })
  const file = [
    { code: 'APR2', value: 103.5, parts: 1 },
    { code: 'RVTRL', value: 289.5, parts: 1 },
    { code: 'CHNS', value: 768, parts: 1 },
    { code: 'GABA', value: 310, parts: 1 },
  ]
  it('직전1개월 — 마약·향정은 가려지고 한외마약·일반은 저장된다', () => {
    const { changes } = buildPreview(DRUGS, file, 'recent_1m_usage')
    const { rows, skipped } = splitNarcotic(DRUGS, changes, 'recent_1m_usage')
    expect(skipped.map(x => x.code).sort()).toEqual(['APR2', 'RVTRL'])
    expect(rows.map(x => x.code).sort()).toEqual(['CHNS', 'GABA'])
  })
  it('최근3개월 — 같은 규칙', () => {
    const { changes } = buildPreview(DRUGS, file, 'recent_3m_usage')
    const { skipped } = splitNarcotic(DRUGS, changes, 'recent_3m_usage')
    expect(skipped.map(x => x.code).sort()).toEqual(['APR2', 'RVTRL'])
  })
  it('★ 전년사용량 — 아무도 건너뛰지 않는다(원내 값을 쓴다)', () => {
    const { changes } = buildPreview(DRUGS, file, 'prev_year_usage')
    const { rows, skipped } = splitNarcotic(DRUGS, changes, 'prev_year_usage')
    expect(skipped).toEqual([])
    expect(rows.map(x => x.code).sort()).toEqual(['APR2', 'CHNS', 'GABA', 'RVTRL'])
  })
  it('건너뛴 줄에도 「지금 값」과 「파일 값」이 함께 온다 — 화면이 둘을 나란히 보여 준다', () => {
    const { changes } = buildPreview(DRUGS, file, 'recent_1m_usage')
    const { skipped } = splitNarcotic(DRUGS, changes, 'recent_1m_usage')
    const apr = skipped.find(x => x.code === 'APR2')
    expect(apr.before).toBe(91)       /* 약플로 출고(지킨다) */
    expect(apr.after).toBe(103.5)     /* 원내 파일(안 쓴다) */
    expect(apr.name).toBe('알프람정0.25mg')
  })
  it('파일에 마약·향정이 없으면 건너뜀 묶음은 비어 있다', () => {
    const { changes } = buildPreview(DRUGS, [{ code: 'GABA', value: 1, parts: 1 }], 'recent_1m_usage')
    expect(splitNarcotic(DRUGS, changes, 'recent_1m_usage').skipped).toEqual([])
  })
  it('빈 입력에도 터지지 않는다', () => {
    expect(splitNarcotic(DRUGS, null, 'recent_1m_usage')).toEqual({ rows: [], skipped: [] })
    expect(splitNarcotic(null, [{ code: 'APR2' }], 'recent_1m_usage').rows).toEqual([{ code: 'APR2' }])
  })
})

describe('0 방지 — 칸과 무관하게 늘 지킨다', () => {
  it('전년을 올릴 때도 마약·향정은 0 목록에서 빠진다', () => {
    /* 파일에 GABA 만 있다 → 나머지는 0 후보가 된다 */
    const { zeros } = buildPreview(DRUGS, [{ code: 'GABA', value: 1, parts: 1 }], 'prev_year_usage')
    const codes = zeros.map(z => z.code)
    /* 라이브러리는 0 후보를 그대로 돌려준다 — 거르는 책임은 화면의 guarded 에 있다 */
    expect(codes).toContain('MYPC')
    /* 화면과 같은 규칙으로 걸러 본다 */
    const narc = new Set(narcCodes(DRUGS))
    const left = zeros.filter(z => !narc.has(z.code)).map(z => z.code)
    expect(left).not.toContain('MYPC')
    expect(left).not.toContain('RVTRL')
    expect(left).toContain('COUGH')      /* 한외마약은 지키지 않는다 */
    expect(left).toContain('NONE')
  })
  it('지킬 코드 목록에 체크 해제분과 마약·향정이 함께 들어간다', () => {
    const keep = new Set(['COUGH'])
    const sent = [...new Set([...keep, ...narcCodes(DRUGS)])].sort()
    expect(sent).toEqual(['APR2', 'COUGH', 'MYPC', 'RVTRL'])
  })
})
