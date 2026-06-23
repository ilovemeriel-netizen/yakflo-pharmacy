import { supabase } from '../lib/supabase'
import { THRESHOLDS } from './appConstants'

/* /app 대시보드·보고서 데이터 계층 — anon + 로그인 세션(RLS).
   집계는 DB측 RPC(0014, SECURITY INVOKER)로 수행 → 테넌트 격리·클라 과다로드 회피.
   service_role 미사용. (기존 api.js는 무수정, 본 파일은 신규 추가) */

/* 대시보드 요약: KPI + 구분/상태 분포(JSON 1왕복) */
export async function fetchDashboard() {
  const { data, error } = await supabase.rpc('app_dashboard', {
    default_safety: THRESHOLDS.DEFAULT_SAFETY,
    expiry_days: THRESHOLDS.EXPIRY_DAYS,
  })
  if (error) throw error
  return data
}

/* 재고부족 목록(활성 약품, 부족분 큰 순) — DB측 컬럼 비교 RPC */
export async function fetchLowStock(limit = THRESHOLDS.ALERT_ROWS) {
  const { data, error } = await supabase.rpc('app_low_stock', {
    default_safety: THRESHOLDS.DEFAULT_SAFETY,
    max_rows: limit,
  })
  if (error) throw error
  return data || []
}

/* 유효기간 임박 목록 — DB측 필터(.lte cutoff), 중지 제외, 임박 오름차순 */
export async function fetchExpiring(days = THRESHOLDS.EXPIRY_DAYS, limit = THRESHOLDS.ALERT_ROWS) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + days)
  const iso = cutoff.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('drugs')
    .select('drug_code,drug_name,category,current_qty,expiry_date,status')
    .neq('status', '중지')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', iso)
    .order('expiry_date', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data || []
}

/* 월마감 보고서: 연도별 월별 입고·사용·폐기·반품·기말 집계 RPC */
export async function fetchMonthlyReport(year) {
  const { data, error } = await supabase.rpc('app_monthly_report', { p_year: year })
  if (error) throw error
  return data || []
}