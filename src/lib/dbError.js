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