/* ════════════════════════════════════════════════════════════════
 * 약품 검색·필터 순수 로직 (App.jsx DrugList와 결과 동치 — 테스트 대상)
 * 외부 의존 없음(Supabase 호출 없음). 회귀 방지 자동화용.
 * ════════════════════════════════════════════════════════════════ */

/** 향정/마약 여부 — App.jsx getNT/isN과 동치 */
export function isNarcotic(d) {
  if (!d) return false
  if (d.narcotic_type === '한외마약') return false
  if (d.narcotic_type === '향정' || d.narcotic_type === '마약') return true
  if (d.is_narcotic === true || d.is_narcotic === 'true') return true
  return false
}

/** 비보험(비급여) 여부 — App.jsx isNonIns와 동치 */
export function isNonInsured(d) {
  const v = (d?.insurance_type || '').toString()
  return v === '비보험' || v === '비급여'
}

/** 약품목록 인라인 검색 매칭 — 코드·약품명·성분(KR)·성분(EN)·제조사·ATC코드 (DrugList와 동치)
 *  ingredient_en 추가(2026-08-28): 화면에는 성분(영문)이 표시되는데 검색 대상에서만 빠져
 *  「Vita」 검색이 0건이던 문제. 전역검색(GLOBAL_SEARCH_FIELDS)은 이미 포함하고 있어 범위를 맞춘 것.
 *  atc_code 추가(2026-11-12 이정화 님 승인): 「N02BF01」을 넣으면 0건이던 문제.
 *    ★ 부분일치라 **앞부분만 넣어도** 된다 — 「N02」는 그 계열 전부, 「N02BF01」은 그 코드만.
 *    ★ 운영 실측(2026-11-12 · 1,133종): N02BF01 8종 · N02BF 18종 · N02 46종.
 *      코드 **가운데**에 N02 가 든 약은 0종이고, 다른 칸(이름·성분·제조사·코드)에
 *      「N02」가 우연히 든 약도 0종이라 **헛걸림이 없다.**
 *    ※ 재고현황·향정마약·전역검색은 각자 제 코드를 써서 **여기 고쳐도 안 바뀐다**(백로그).
 *  ※ 최소 글자 수 제한은 두지 않는다(사용자 확정) — 1글자 영문은 수백 건이 걸리며 이는 부분일치의 성질. */
export function matchesDrugSearch(d, q) {
  if (!q || !q.trim()) return true
  const s = q.trim().toLowerCase()
  return (d?.drug_name || '').toLowerCase().includes(s)
    || (d?.drug_code || '').toLowerCase().includes(s)
    || (d?.ingredient_kr || '').toLowerCase().includes(s)
    || (d?.ingredient_en || '').toLowerCase().includes(s)
    || (d?.manufacturer || '').toLowerCase().includes(s)
    || (d?.atc_code || '').toLowerCase().includes(s)
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