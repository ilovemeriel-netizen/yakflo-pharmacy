import { BRAND } from './theme'

/* 표시 컬럼 카탈로그. base=기본 노출. ATC는 drugs에 컬럼 부재 → 제외(계약표 §7-5, 구분으로 대체). */
export const COLUMNS = [
  { key: 'drug_code', label: '코드', base: true, mono: true },
  { key: 'drug_name', label: '약품명', base: true, wrap: true, bold: true },
  { key: 'category', label: '구분', base: true },
  { key: 'current_qty', label: '현재고', base: true, align: 'right', num: true },
  { key: 'expiry_date', label: '유효기한', base: true },
  { key: 'status', label: '상태', base: true, chip: true },
  { key: 'ingredient_kr', label: '성분', base: false, wrap: true },
  { key: 'insurance_type', label: '급여', base: false },
  { key: 'insurance_code', label: '보험코드', base: false },
  { key: 'storage_method', label: '보관방법', base: false },
]

export const DEFAULT_COLS = COLUMNS.filter((c) => c.base).map((c) => c.key)
export const COLS_STORAGE_KEY = 'yakflo_v2_visible_cols'

export const STATUS_CHIP = {
  사용: { bg: '#e6f6ec', fg: BRAND.green },
  휴면: { bg: '#fff4e0', fg: '#b06a00' },
  중지: { bg: '#f0f0f2', fg: '#888' },
}

/* localStorage 기반 표시 컬럼 로드/저장 (비밀값 없음) */
export function loadCols() {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY)
    if (!raw) return DEFAULT_COLS
    const arr = JSON.parse(raw)
    const valid = arr.filter((k) => COLUMNS.some((c) => c.key === k))
    return valid.length ? valid : DEFAULT_COLS
  } catch {
    return DEFAULT_COLS
  }
}
export function saveCols(keys) {
  try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(keys)) } catch { /* 저장 실패 무시 */ }
}
