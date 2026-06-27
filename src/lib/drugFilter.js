/* ════════════════════════════════════════════════════════════════
 * 약품 검색·필터 순수 로직 (App.jsx DrugList와 결과 동치 — 테스트 대상)
 * 외부 의존 없음(Supabase 호출 없음). 회귀 방지 자동화용.
 * ════════════════════════════════════════════════════════════════ */

/** 향정/마약 여부 — App.jsx getNT/isN과 동치 */
export function isNarcotic(d) {
  if (!d) return false
  if (d.narcotic_type === '향정' || d.narcotic_type === '마약') return true
  if (d.is_narcotic === true || d.is_narcotic === 'true') return true
  return false
}

/** 비보험(비급여) 여부 — App.jsx isNonIns와 동치 */
export function isNonInsured(d) {
  const v = (d?.insurance_type || '').toString()
  return v === '비보험' || v === '비급여'
}

/** 약품목록 인라인 검색 매칭 — 코드·약품명·성분(KR)·제조사 (DrugList와 동치) */
export function matchesDrugSearch(d, q) {
  if (!q || !q.trim()) return true
  const s = q.trim().toLowerCase()
  return (d?.drug_name || '').toLowerCase().includes(s)
    || (d?.drug_code || '').toLowerCase().includes(s)
    || (d?.ingredient_kr || '').toLowerCase().includes(s)
    || (d?.manufacturer || '').toLowerCase().includes(s)
}

/** 전역 검색(GlobalSearch) ilike or 대상 컬럼 — 제조사 포함(성분 EN 포함) */
export const GLOBAL_SEARCH_FIELDS = ['drug_code', 'drug_name', 'ingredient_kr', 'ingredient_en', 'manufacturer']

/**
 * 약품목록 필터 술어 — App.jsx DrugList의 filtered 술어와 결과 동치.
 * GNB '구분→경구제'(cats)·TreeFilter(구분·상태·규제·급여·ATC)·인라인 검색을 모두 반영.
 * opts: { cats:string[], stats:string[], narcOnly:bool, insF:'전체'|'보험'|'비보험', atcF:string|null, search:string }
 */
export function passesDrugFilters(d, opts) {
  const { cats, stats, narcOnly, insF, atcF, search } = opts || {}
  if (narcOnly && !isNarcotic(d)) return false
  if (atcF && d.atc_l1 !== atcF) return false
  if (stats && !stats.includes(d.status)) return false
  if (cats && !cats.includes(d.category)) return false
  if (insF && insF !== '전체') {
    const normalized = isNonInsured(d) ? '비보험' : '보험'
    if (normalized !== insF) return false
  }
  return matchesDrugSearch(d, search)
}

/** GNB 드롭다운 '구분' 항목의 라우팅 nav 객체 (구분→해당 구분 필터 목록) */
export function categoryNav(cat) {
  return { menu: 'druglist', cats: [cat] }
}