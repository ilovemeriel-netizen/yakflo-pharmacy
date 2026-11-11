import { describe, it, expect } from 'vitest'
import {
  isNarcotic, isNonInsured, matchesDrugSearch, passesDrugFilters,
  GLOBAL_SEARCH_FIELDS, categoryNav,
} from './drugFilter'

const D = (o) => ({ drug_code: '', drug_name: '', ingredient_kr: '', ingredient_en: '', manufacturer: '', category: '경구제', status: '사용', atc_l1: '신경계', insurance_type: '급여', narcotic_type: '해당없음', is_narcotic: false, ...o })

const drugs = [
  D({ drug_code: 'SGBRONNC10', drug_name: '가바로닌캡슐100mg', ingredient_kr: '가바펜틴', ingredient_en: 'Gabapentin', manufacturer: '알리코제약', category: '경구제', status: '사용', atc_l1: '신경계' }),
  D({ drug_code: 'NORV5', drug_name: '노바스크정5mg', ingredient_kr: '암로디핀', ingredient_en: 'Amlodipine', manufacturer: '한국화이자제약', category: '경구제', status: '사용', atc_l1: '심혈관계' }),
  D({ drug_code: 'SGRX1', drug_name: '싱그릭스주', ingredient_kr: '대상포진백신', ingredient_en: 'VZV', manufacturer: '글락소스미스클라인', category: '주사제', status: '사용', atc_l1: '전신 작용 항감염제' }),
  D({ drug_code: 'ZOLP10', drug_name: '스틸녹스정10mg', ingredient_kr: '졸피뎀', manufacturer: '한독', category: '경구제', status: '사용', narcotic_type: '향정', atc_l1: '근골격계' }),
  D({ drug_code: 'OLD1', drug_name: '구약품정', manufacturer: '폐업제약', category: '경구제', status: '중지', atc_l1: '기타' }),
  D({ drug_code: 'NI1', drug_name: '비급여크림', manufacturer: '메디제약', category: '외용제', status: '사용', insurance_type: '비급여', atc_l1: '피부과용 약물' }),
]
/* ★ ATC 코드로 찾기 — 2026-11-12 이정화 님 승인.
   운영 실측(1,133종)을 작게 줄여 담았다: N02BF01 2종 · N02BF02 1종 · 그 밖 1종.
   「헛걸림」을 보려고 **다른 칸에만** N02 가 든 약(NO2FAKE)을 일부러 넣었다. */
const atcDrugs = [
  D({ drug_code: 'SGBRONNC10', drug_name: '가바로닌캡슐100mg', ingredient_kr: '가바펜틴', atc_code: 'N02BF01' }),
  D({ drug_code: 'SGBRONNC30', drug_name: '가바로닌캡슐300mg', ingredient_kr: '가바펜틴', atc_code: 'N02BF01' }),
  D({ drug_code: 'CTRC150', drug_name: '씨트리카캡슐150mg', ingredient_kr: '프레가발린', atc_code: 'N02BF02' }),
  D({ drug_code: 'NORV5', drug_name: '노바스크정5mg', ingredient_kr: '암로디핀', atc_code: 'C08CA01' }),
]

const ALL_CATS = ['경구제', '주사제', '외용제', '수액제', '영양제', '의약외품']
const MAIN = ['사용', '휴면']
const base = { cats: ALL_CATS, stats: MAIN, narcOnly: false, insF: '전체', atcF: null, search: '' }

describe('matchesDrugSearch — 코드·약품명·성분KR·제조사', () => {
  it('제조사명으로 매칭(한국화이자제약)', () => {
    expect(matchesDrugSearch(drugs[1], '화이자')).toBe(true)
    expect(matchesDrugSearch(drugs[0], '화이자')).toBe(false)
  })
  it('약품코드·약품명·성분KR 매칭', () => {
    expect(matchesDrugSearch(drugs[0], 'SGBRONNC')).toBe(true)
    expect(matchesDrugSearch(drugs[0], '가바로닌')).toBe(true)
    expect(matchesDrugSearch(drugs[0], '가바펜틴')).toBe(true)
  })
  it('대소문자 무관·빈 검색어는 전부 통과', () => {
    expect(matchesDrugSearch(drugs[0], 'sgbronnc10')).toBe(true)
    expect(matchesDrugSearch(drugs[0], '   ')).toBe(true)
    expect(matchesDrugSearch(drugs[0], '')).toBe(true)
  })
  it('미매칭은 false', () => {
    expect(matchesDrugSearch(drugs[0], '존재하지않는약')).toBe(false)
  })
})

/* ★ ATC 코드로 찾기 (2026-11-12) ─────────────────────────────────────
   ① 정확한 코드 · ② 앞부분 · ③ 소문자 — 셋 다 된다
   ④ 다른 칸에 우연히 든 글자로는 **헛걸리지 않는다**
   운영 실측: N02BF01 8종 · N02BF 18종 · N02 46종 · 헛걸림 0종 */
describe('★ matchesDrugSearch — ATC 코드로 찾기', () => {
  const hit = q => atcDrugs.filter(d => matchesDrugSearch(d, q))

  it('① 정확한 코드 N02BF01 → 2종', () => {
    expect(hit('N02BF01').map(d => d.drug_code)).toEqual(['SGBRONNC10', 'SGBRONNC30'])
  })

  it('② 앞부분 N02BF → 3종 (01·02 둘 다)', () => {
    expect(hit('N02BF').length).toBe(3)
  })

  it('② 앞부분 N02 → 3종', () => {
    expect(hit('N02').length).toBe(3)
  })

  it('② 더 앞 N0 → 3종 · 다른 계열 C08 → 1종', () => {
    expect(hit('N0').length).toBe(3)
    expect(hit('C08').map(d => d.drug_code)).toEqual(['NORV5'])
  })

  it('③ 소문자 n02bf01 도 된다 — 대소문자를 가리지 않는다', () => {
    expect(hit('n02bf01').map(d => d.drug_code)).toEqual(['SGBRONNC10', 'SGBRONNC30'])
    expect(hit('n02').length).toBe(3)
  })

  it('★ ④ 다른 칸에 든 글자로 헛걸리지 않는다', () => {
    /* 이름·성분·제조사·코드 어디에도 N02 가 없는 약은 안 걸린다 */
    const 헛 = hit('N02').filter(d => !String(d.atc_code).toUpperCase().startsWith('N02'))
    expect(헛.map(d => d.drug_code)).toEqual([])
  })

  it('★ ④ 다른 칸에 N02 가 있으면 그 칸으로 걸린다 — ATC 때문이 아니다', () => {
    /* 코드·이름으로 찾는 기존 동작은 그대로다 */
    const fake = D({ drug_code: 'NO2FAKE', drug_name: '엉뚱정', atc_code: 'C08CA01' })
    expect(matchesDrugSearch(fake, 'NO2')).toBe(true)      /* 알파벳 O — 코드로 걸림 */
    expect(matchesDrugSearch(fake, 'N02')).toBe(false)     /* 숫자 0 — 안 걸림 */
  })

  it('ATC 가 비어 있어도 터지지 않는다', () => {
    expect(matchesDrugSearch(D({ atc_code: null, drug_name: '무엇' }), 'N02')).toBe(false)
    expect(matchesDrugSearch(D({ drug_name: '무엇' }), 'N02')).toBe(false)
  })

  it('기존 칸(이름·코드·성분·제조사)은 그대로 걸린다', () => {
    expect(matchesDrugSearch(atcDrugs[0], '가바로닌')).toBe(true)
    expect(matchesDrugSearch(atcDrugs[0], '가바펜틴')).toBe(true)
    expect(matchesDrugSearch(atcDrugs[0], 'SGBRONNC10')).toBe(true)
  })
})

describe('★ 필터와 함께 써도 규칙이 그대로다 — ATC 검색', () => {
  const f = { cats: ALL_CATS, stats: ['사용'], narcOnly: false, insF: '전체', atcF: null }
  it('상태=사용 + N02BF01 → 2종', () => {
    const rows = atcDrugs.filter(d => passesDrugFilters(d, { ...f, search: 'N02BF01' }))
    expect(rows.length).toBe(2)
  })
  it('★ 상태 필터가 검색보다 먼저다 — 중지면 안 나온다', () => {
    const stopped = atcDrugs.map(d => ({ ...d, status: '중지' }))
    const rows = stopped.filter(d => passesDrugFilters(d, { ...f, search: 'N02BF01' }))
    expect(rows.length).toBe(0)
  })
  it('구분 필터도 그대로 — 주사제만 고르면 0종', () => {
    const rows = atcDrugs.filter(d => passesDrugFilters(d, { ...f, cats: ['주사제'], search: 'N02' }))
    expect(rows.length).toBe(0)
  })
})

describe('GLOBAL_SEARCH_FIELDS — 전역검색 컬럼(제조사·성분EN 포함)', () => {
  it('manufacturer·ingredient_en 포함', () => {
    expect(GLOBAL_SEARCH_FIELDS).toContain('manufacturer')
    expect(GLOBAL_SEARCH_FIELDS).toContain('ingredient_en')
    expect(GLOBAL_SEARCH_FIELDS).toEqual(expect.arrayContaining(['drug_code', 'drug_name', 'ingredient_kr']))
  })
})

describe('isNarcotic / isNonInsured', () => {
  it('향정 타입·is_narcotic 플래그', () => {
    expect(isNarcotic(drugs[3])).toBe(true)
    expect(isNarcotic({ is_narcotic: true })).toBe(true)
    expect(isNarcotic(drugs[0])).toBe(false)
  })
  it('비급여 판정', () => {
    expect(isNonInsured(drugs[5])).toBe(true)
    expect(isNonInsured(drugs[0])).toBe(false)
  })
})

describe('passesDrugFilters — 필터 결과 동치', () => {
  it('GNB 구분→경구제: 경구제만 통과(TreeFilter 결과 동치)', () => {
    const f = { ...base, cats: ['경구제'] }
    const res = drugs.filter(d => passesDrugFilters(d, f))
    expect(res.every(d => d.category === '경구제')).toBe(true)
    expect(res.map(d => d.drug_code)).toContain('SGBRONNC10')
    expect(res.map(d => d.drug_code)).not.toContain('SGRX1') // 주사제 제외
  })
  it('상태 필터: 사용+휴면만(중지 제외)', () => {
    const res = drugs.filter(d => passesDrugFilters(d, base))
    expect(res.map(d => d.drug_code)).not.toContain('OLD1') // 중지 제외
  })
  it('규제: 향정만', () => {
    const res = drugs.filter(d => passesDrugFilters(d, { ...base, narcOnly: true }))
    expect(res.map(d => d.drug_code)).toEqual(['ZOLP10'])
  })
  it('급여: 비보험만', () => {
    const res = drugs.filter(d => passesDrugFilters(d, { ...base, insF: '비보험' }))
    expect(res.map(d => d.drug_code)).toEqual(['NI1'])
  })
  it('ATC 대분류: 신경계만', () => {
    const res = drugs.filter(d => passesDrugFilters(d, { ...base, atcF: '신경계' }))
    expect(res.map(d => d.drug_code)).toEqual(['SGBRONNC10'])
  })
  it('검색+구분 조합: 경구제 & 제조사 화이자', () => {
    const res = drugs.filter(d => passesDrugFilters(d, { ...base, cats: ['경구제'], search: '화이자' }))
    expect(res.map(d => d.drug_code)).toEqual(['NORV5'])
  })
})

describe('categoryNav — GNB 구분 드롭다운 라우팅', () => {
  it('구분 클릭 → druglist + cats 필터', () => {
    expect(categoryNav('경구제')).toEqual({ menu: 'druglist', cats: ['경구제'] })
  })
})