/* Postgres/PostgREST 에러 → 사용자 친화 메시지 매핑.
   ⚠ 트리거가 한글로 던진 메시지(마감월 거부·재고 부족)는 가공하지 않고 원문 그대로 반환한다.
      원문이 가장 정확하다. */

export function dbErrorMsg(error, fallback = '처리 중 오류가 발생했습니다.') {
  if (!error) return null
  const code = error.code
  const msg = (error.message || '').trim()
  if (code === '23514') {
    // CHECK 위반. 트리거 RAISE 한글 메시지(마감월·재고 부족)면 원문 그대로,
    // DB 기본 위반문(영문)이면 안내 문구로 대체.
    return /[가-힣]/.test(msg) ? msg : '허용되지 않은 값입니다.'
  }
  if (code === '23505') return '이미 등록된 항목입니다.'
  return msg || fallback
}

/* 삭제/수정 응답이 0행일 때(RLS 정책 차단 등) */
export function noRowMsg() {
  return '권한이 없거나 대상을 찾을 수 없습니다.'
}

/* 일괄 등록 실패 사유 분류 — 요약 라벨과 조치 문구를 함께 낸다.
   원문은 버리지 않는다. 호출부가 dbErrorMsg(error) 를 따로 보관해 함께 표시한다.

   ★ 판정 순서가 곧 우선순위다.
     마감월 차단(guard_closed_month_tx)과 재고 부족(apply_tx_to_inventory)이
     **둘 다 SQLSTATE 23514** 라 코드만으로는 갈리지 않는다. 그래서 메시지 문자열을
     위에서부터 본다. 두 문구가 동시에 들어오면 마감월이 이긴다 —
     마감 위반은 날짜 자체를 바꿔야 하는 문제라 수량 조정보다 앞선 조치다.

   ★ closed 의 조치 문구를 「일자를 마감 전 월로 고쳐 올리라」로 쓰지 않는다.
     그렇게 안내하면 사용자가 실제 거래일과 다른 날짜로 기록하게 되어 장부가 틀어진다.
     마감 후 소급이 필요하면 조정 거래가 정답이다. */
export function bulkFailKind(error) {
  const code = error?.code || ''
  const msg = (error?.message || '').trim()
  if (msg.includes('마감된 월')) return { kind: 'closed', label: '마감된 월', action: '일자를 확인해 주세요. 마감된 월에는 등록할 수 없습니다' }
  if (msg.includes('재고 부족')) return { kind: 'stock', label: '재고 부족', action: '현재고를 확인하고 수량을 줄여 주세요' }
  if (code === '42501' || msg.includes('row-level security')) return { kind: 'perm', label: '권한 없음', action: '관리자에게 문의해 주세요' }
  if (code === 'PGRST204' || msg.includes("' column")) return { kind: 'form', label: '양식 오류', action: '엑셀 열 이름을 양식과 맞춰 주세요' }
  return { kind: 'etc', label: '확인 필요', action: '아래 원문과 함께 관리자에게 문의해 주세요' }
}