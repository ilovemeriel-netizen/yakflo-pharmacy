/* @vitest-environment node */
/* 카드 숫자 = 그 카드를 눌렀을 때의 목록 줄 수 — 세 화면.

   ★ 막으려는 결함(2026-10-29 진단)
     유효기한 향정마약 카드가 위쪽 상태 칩을 **무시**해, 「사용」만 골라도
     중지 향정이 카드 숫자·목록·엑셀에 모두 남았다. 재고현황·향정마약 화면은
     카드 숫자만 구분·검색을 무시해 **숫자 ≠ 목록 줄 수** 였다.
   ★ 그래서 이 시험의 핵심은 **숫자와 줄 수가 같은가** 하나다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isNarcotic, remainDays, expiryChipFilter, expiryGroups,
  stockBasis, stockCounts, stockList, STOCK_CARDS,
  narcCounts, narcList, NARC_CARDS,
} from './cardCounts'

const TODAY = new Date('2026-10-29T00:00:00Z')
const CATS = ['영양제', '수액제', '주사제', '외용제', '경구제', '의약외품']
const MAIN_STATS = ['사용', '중지', '휴면']
const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

/* 진단 때 쓴 그 자료 — 향정 사용 2 · 중지 1(주사제·재고 0·2026-11-25) + 대조군 1 */
const DRUGS = [
  { drug_code: 'N1', drug_name: '향정A', category: '주사제', status: '사용', is_narcotic: true, narcotic_type: '향정', current_qty: 10, expiry_date: '2026-11-25' },
  { drug_code: 'N2', drug_name: '향정B', category: '주사제', status: '사용', is_narcotic: true, narcotic_type: '향정', current_qty: 5, expiry_date: '2026-12-10' },
  { drug_code: 'N3', drug_name: '향정C', category: '주사제', status: '중지', is_narcotic: true, narcotic_type: '향정', current_qty: 0, expiry_date: '2026-11-25' },
  { drug_code: 'P1', drug_name: '보통약', category: '경구제', status: '사용', is_narcotic: false, narcotic_type: null, current_qty: 3, expiry_date: '2026-11-20' },
]
const noUnused = () => false
const groups = (cats, stats) => expiryGroups(DRUGS, cats, stats, TODAY, noUnused)
const names = arr => arr.map(d => d.drug_name).sort()

describe('기본 판정', () => {
  it('향정 판정', () => {
    expect(isNarcotic(DRUGS[0])).toBe(true)
    expect(isNarcotic(DRUGS[3])).toBe(false)
    expect(isNarcotic({ is_narcotic: false, narcotic_type: '마약' })).toBe(true)
  })
  it('남은 일수', () => {
    expect(remainDays('2026-11-25', TODAY)).toBe(27)
    expect(remainDays(null, TODAY)).toBeNull()
  })
})

describe('★ 유효기한 — 증상 재현과 수정 확인', () => {
  it('★ 「사용」만 고르면 중지 향정이 카드에서 빠진다 (고치기 전엔 3이었다)', () => {
    const g = groups(CATS, ['사용'])
    expect(g.narcotic.length, '향정 카드 숫자').toBe(2)
    expect(names(g.narcotic)).toEqual(['향정A', '향정B'])
    expect(g.narcotic.some(d => d.status === '중지'), '중지가 남았다').toBe(false)
  })

  it('★ 「중지」만 고르면 중지 향정만 — 사용 중인 것이 섞이지 않는다', () => {
    const g = groups(CATS, ['중지'])
    expect(names(g.narcotic)).toEqual(['향정C'])
  })

  it('★ 재고 0 향정도 칩 조건에 맞으면 보인다 (current_qty 조건을 넣지 않았다)', () => {
    const g = groups(CATS, ['중지'])
    expect(g.narcotic[0].current_qty).toBe(0)
    /* 다른 카드는 재고 0 을 빼므로 비어 있다 */
    expect(g.urgent.length).toBe(0)
  })

  it('상태 3종 모두면 향정 3건 — 기본 화면은 그대로다', () => {
    expect(groups(CATS, MAIN_STATS).narcotic.length).toBe(3)
  })

  it('구분 칩도 따른다 — 경구제만 고르면 주사제 향정이 빠진다', () => {
    expect(groups(['경구제'], MAIN_STATS).narcotic.length).toBe(0)
  })

  it('★ 구분(전체+6) × 상태(전체·사용·중지·휴면) 조합에서 다섯 카드가 모두 fd 안에 있다', () => {
    const catSets = [CATS, ...CATS.map(c => [c])]
    const statSets = [MAIN_STATS, ['사용'], ['중지'], ['휴면']]
    let checked = 0
    for (const cs of catSets) {
      for (const ss of statSets) {
        const fd = expiryChipFilter(DRUGS, cs, ss)
        const g = groups(cs, ss)
        for (const k of ['urgent', 'warning', 'notice', 'narcotic', 'unused']) {
          for (const d of g[k]) {
            expect(fd.includes(d), `${k} 에 칩 밖의 품목: ${d.drug_name}(${d.category}/${d.status})`).toBe(true)
          }
          checked++
        }
      }
    }
    expect(checked).toBe(catSets.length * statSets.length * 5)
  })

  it('★ 엑셀에 담기는 줄은 카드 배열의 합과 같다 — 카드 밖의 품목이 끼지 않는다', () => {
    for (const ss of [MAIN_STATS, ['사용'], ['중지']]) {
      const g = groups(CATS, ss)
      const excel = [...g.urgent, ...g.warning, ...g.notice, ...g.narcotic, ...g.unused]
      const fd = expiryChipFilter(DRUGS, CATS, ss)
      for (const d of excel) expect(fd.includes(d), `엑셀에 칩 밖의 품목: ${d.drug_name}`).toBe(true)
      expect(excel.length).toBe(g.urgent.length + g.warning.length + g.notice.length + g.narcotic.length + g.unused.length)
    }
  })
})

describe('★ 재고현황 — 카드 숫자 = 목록 줄 수', () => {
  const MERGED = [
    { drug_code: 'A', drug_name: '아스피린', category: '경구제', stockStatus: '긴급' },
    { drug_code: 'B', drug_name: '베타딘', category: '외용제', stockStatus: '긴급' },
    { drug_code: 'C', drug_name: '세파졸린', category: '주사제', stockStatus: '정상' },
    { drug_code: 'D', drug_name: '덱사메타손', category: '주사제', stockStatus: '재고없음' },
  ]
  it('★ 검색어·구분을 바꿔도 숫자와 줄 수가 같다', () => {
    const cases = [
      [CATS, ''], [CATS, '아스'], [CATS, '세파'], [CATS, '없는약'],
      [['주사제'], ''], [['경구제'], ''], [['주사제'], '덱사'],
    ]
    for (const [cs, q] of cases) {
      const basis = stockBasis(MERGED, cs, q)
      const cnt = stockCounts(basis)
      for (const k of STOCK_CARDS) {
        expect(stockList(basis, k).length, `카드 ${k} · 구분 ${cs.length}종 · 검색 "${q}"`).toBe(cnt[k])
      }
    }
  })
  it('구분을 좁히면 숫자가 함께 줄어든다 (고치기 전엔 그대로였다)', () => {
    expect(stockCounts(stockBasis(MERGED, CATS, '')).전체).toBe(4)
    expect(stockCounts(stockBasis(MERGED, ['주사제'], '')).전체).toBe(2)
    expect(stockCounts(stockBasis(MERGED, CATS, '아스')).긴급).toBe(1)
  })
})

describe('★ 향정마약 화면 — 카드 숫자 = 목록 줄 수', () => {
  const getNT = d => d.narcotic_type || (d.is_narcotic ? '향정' : '')
  const BASIS = [
    { drug_code: 'N1', drug_name: '향정A', narcotic_type: '향정', expiry_date: '2026-11-25' },
    { drug_code: 'N2', drug_name: '향정B', narcotic_type: '향정', expiry_date: '2027-12-10' },
    { drug_code: 'M1', drug_name: '마약A', narcotic_type: '마약', expiry_date: '2026-11-30' },
  ]
  it('★ 네 카드 모두 숫자 = 줄 수', () => {
    const cnt = narcCounts(BASIS, getNT, TODAY)
    for (const k of NARC_CARDS) {
      expect(narcList(BASIS, k, getNT, TODAY).length, '카드 ' + k).toBe(cnt[k])
    }
    expect(cnt).toEqual({ 전체: 3, 향정: 2, 마약: 1, '유효기한 주의': 2 })
  })
  it('★ 기준(검색 결과)이 좁아지면 네 숫자가 함께 줄어든다', () => {
    const narrowed = BASIS.filter(d => d.drug_name.includes('향정'))
    const cnt = narcCounts(narrowed, getNT, TODAY)
    expect(cnt).toEqual({ 전체: 2, 향정: 2, 마약: 0, '유효기한 주의': 1 })
    for (const k of NARC_CARDS) expect(narcList(narrowed, k, getNT, TODAY).length).toBe(cnt[k])
  })
})

describe('App.jsx 배선 — 고친 곳이 되돌아가지 않게', () => {
  it('★ 유효기한 다섯 카드가 모두 fd 에서 만들어진다', () => {
    const i = APP.indexOf('const g={urgent:fd.filter')
    expect(i, 'g 정의를 못 찾음').toBeGreaterThan(0)
    const line = APP.slice(i, APP.indexOf('\n', i))
    expect(line).toContain('narcotic:fd.filter')
    expect(line, '옛 방식(원본 drugs)이 남아 있다').not.toContain('narcotic:drugs.filter')
    /* 향정 카드에는 current_qty 조건을 넣지 않는다(사용자 결정) */
    const nar = line.slice(line.indexOf('narcotic:'), line.indexOf('unused:'))
    expect(nar, '향정 카드에 재고 조건이 들어갔다').not.toContain('current_qty')
  })

  it('★ 재고현황 카드 숫자가 _sb(구분·검색 적용)에서 나온다', () => {
    expect(APP).toContain('const sg={전체:_sb.length')
    expect(APP, '옛 방식이 남아 있다').not.toContain('const sg={전체:merged.length')
    /* ★ 2026-11-01 급변 필터가 끼면서 이 줄이 길어졌다 — 글자 그대로 비교하면 깨진다.
       지키려는 뜻은 「filtered 가 _sb 에서 나온다」이므로 그것만 본다. */
    expect(APP).toContain('const filtered=so(_sb.filter(d=>')
    expect(APP, '재고상태 칩 조건은 그대로').toContain("filter==='전체'||d.stockStatus===filter")
  })

  it('★ 향정마약 카드 숫자가 _cb(카드 선택만 뺀 기준)에서 나온다', () => {
    expect(APP).toContain('const _cb=narcs.filter(passBase)')
    expect(APP).toContain("const cards=[{k:'전체',v:_cb.length")
    expect(APP, '옛 방식이 남아 있다').not.toContain("const cards=[{k:'전체',v:narcs.length")
    /* 목록은 같은 passBase 를 다시 쓴다 — 조건을 두 벌로 적지 않는다 */
    expect(APP).toContain('if(!passBase(d))return false;')
  })
})
