/* /app 대시보드·알림 임계 상수 (추후 설정 화면 연동 지점).
   민감정보 없음. 변경 시 이 파일만 수정. */
export const THRESHOLDS = {
  DEFAULT_SAFETY: 10, // safety_stock 미적재(0) 시 재고부족 판정에 쓰는 상수 임계
  EXPIRY_DAYS: 90,    // 유효기간 임박 기준(일)
  ALERT_ROWS: 100,    // 알림 표 최대 행수
}

/* 차트 색상 — 브랜드(보라·녹색·라벤더·네이비) 우선 + 보조 중립/강조 */
export const CHART_COLORS = ['#804A87', '#019748', '#BFA6D9', '#2E4A62', '#E8A33D', '#9aa0a6', '#c0392b', '#5aa9e6']