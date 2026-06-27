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