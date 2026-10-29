/* 거래 타입 SSOT (Single Source of Truth).
   ⚠ 이 문자열 값은 DB CHECK 제약(마이그레이션 0036 transactions_type_check)과 반드시 일치한다.
      한 글자라도 바꾸면 transactions.type CHECK 위반으로 저장이 전부 실패한다.
      값 변경 시 반드시 DB 마이그레이션(0036 계열)과 동시에 수정하고
      `npm run check:txtypes` 로 드리프트를 검증할 것. */
export const TX_IN = '입고'
export const TX_OUT = '출고'
export const TX_RETURN = '반품'
export const TX_DISPOSE = '폐기'
export const TX_ADJUST = '조정'

/* DB CHECK 허용값 5종 (순서 무관 — 드리프트 검사 기준) */
export const TX_TYPES = [TX_IN, TX_OUT, TX_RETURN, TX_DISPOSE, TX_ADJUST]

/* 입출고관리(TxForm) 4탭 — '조정'은 재고 보정(AdjustModal) 전용이라 탭에서 제외 */
export const TX_TAB_TYPES = [TX_IN, TX_OUT, TX_RETURN, TX_DISPOSE]

/* ── transactions 컬럼 → 화면 이름 ────────────────────────────────────────
   ★ 저장 폴백이 컬럼을 버렸을 때 사용자에게 **화면에서 쓰는 이름**으로 알리기 위한 것이다.
     값은 입출고 화면의 표 머리글(TxForm 의 cols 배열)과 같게 적었고,
     txColLabel.test.js 가 **그 cols 와 어긋나면** 걸린다(머리글만 바꾸고 여기를 잊는 것 방지).
   ★ drugs 쪽 라벨(FIELD_DEFS)과 따로 두는 이유 — transactions 의 칸 대부분이
     FIELD_DEFS 에 없다(unit_price·total_amount·supplier·handler·approver·
     process_status·transaction_date). 그대로 쓰면 가장 중요한 「금액」이
     `total_amount` 라는 날컬럼 이름으로 뜬다. */
export const TX_COL_LABEL = {
  transaction_date: '일자',
  drug_code: '약품코드',
  type: '처리구분',
  quantity: '수량',
  unit_price: '거래단가',
  total_amount: '금액',
  supplier: '공급업체',
  lot_no: 'LOT',
  expiry_date: '유효기한',
  reason: '사유',
  handler: '처리자',
  approver: '승인자',
  process_status: '처리상태',
  memo: '비고',
}

export function txColLabel(col) {
  return TX_COL_LABEL[col] || String(col)
}