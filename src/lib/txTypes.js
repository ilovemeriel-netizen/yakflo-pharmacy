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