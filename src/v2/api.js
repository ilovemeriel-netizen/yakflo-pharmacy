import { supabase } from '../lib/supabase'

/* 신규 인터페이스 데이터 접근 계층 — anon 클라이언트 + 로그인 세션(RLS).
   service_role 미사용. 모든 조회는 RLS로 테넌트 격리된다. */

/* drug_vocab → { axis: [{code,label,sort_order}, ...] } (필터·드롭다운 단일 소스) */
export async function fetchVocab() {
  const { data, error } = await supabase
    .from('drug_vocab')
    .select('axis,code,label,sort_order')
    .order('sort_order')
  if (error) throw error
  const byAxis = {}
  for (const r of data || []) (byAxis[r.axis] = byAxis[r.axis] || []).push(r)
  return byAxis
}

/* PostgREST .or() 안전화 — 콤마·괄호 등 필터 구문 깨는 문자 제거 */
function sanitize(s) {
  return String(s || '').replace(/[(),*%]/g, ' ').trim()
}

const LIST_COLS = 'drug_code,drug_name,category,current_qty,expiry_date,status,is_narcotic,narcotic_type,ingredient_kr,insurance_type,insurance_code,storage_method'

/* 약품 목록 — 서버 페이지네이션(.range) + count.
   statuses: 표시할 상태 배열(예: 메인=['사용','휴면'], 아카이브=['중지']).
   정렬 status asc → 사용(ㅅ)<중지(ㅈ)<휴면(ㅎ) 이므로 메인에서 '사용 우선'. */
export async function fetchDrugs({ page = 0, pageSize = 50, category = '', statuses = [], search = '' }) {
  let q = supabase.from('drugs').select(LIST_COLS, { count: 'exact' })
  if (category) q = q.eq('category', category)
  if (statuses.length === 1) q = q.eq('status', statuses[0])
  else if (statuses.length > 1) q = q.in('status', statuses)
  const s = sanitize(search)
  if (s) q = q.or(`drug_name.ilike.%${s}%,drug_code.ilike.%${s}%`)
  q = q.order('status_sort').order('drug_name').range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) throw error
  return { rows: data || [], total: count || 0 }
}

/* 상태 변경(활성화 휴면→사용 / 복귀 중지→사용) — RLS update_own_tenant 경유 */
export async function updateDrugStatus(code, status) {
  const { error } = await supabase.from('drugs').update({ status }).eq('drug_code', code)
  if (error) throw error
}

/* ── P2-4 거래·재고 ── */

/* 약품 검색(거래 폼 선택용) */
export async function searchDrugs(q, limit = 8) {
  const s = sanitize(q)
  if (!s) return []
  const { data, error } = await supabase
    .from('drugs').select('drug_code,drug_name,current_qty')
    .or(`drug_name.ilike.%${s}%,drug_code.ilike.%${s}%`).limit(limit)
  if (error) throw error
  return data || []
}

/* 통합 거래 기록 — transactions INSERT(트리거가 재고 원자 갱신). tenant는 트리거 자동. */
export async function insertTransaction(tx) {
  const { data, error } = await supabase.from('transactions').insert([tx]).select().maybeSingle()
  if (error) throw error
  return data
}

/* 입고 시 로트 기록(옵션) */
export async function insertLot(lot) {
  const { error } = await supabase.from('drug_lots').insert([lot])
  if (error) throw error
}

export async function fetchRecentTransactions(limit = 20) {
  const { data, error } = await supabase
    .from('transactions').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

/* 재고 현황 목록 — current_qty 오름차순(부족 우선) */
export async function fetchInventoryList({ page = 0, pageSize = 50, category = '', search = '' }) {
  let q = supabase
    .from('drugs').select('drug_code,drug_name,category,current_qty,safety_stock,max_stock,status', { count: 'exact' })
  if (category) q = q.eq('category', category)
  const s = sanitize(search)
  if (s) q = q.or(`drug_name.ilike.%${s}%,drug_code.ilike.%${s}%`)
  q = q.order('current_qty', { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1)
  const { data, count, error } = await q
  if (error) throw error
  return { rows: data || [], total: count || 0 }
}

/* 약품 360° 탭 소스 (코드 조인, RLS 경유) */
export async function fetchDrug(code) {
  const { data, error } = await supabase.from('drugs').select('*').eq('drug_code', code).maybeSingle()
  if (error) throw error
  return data
}
export async function fetchInventory(code) {
  const { data, error } = await supabase.from('inventory_stock').select('*').eq('drug_code', code).maybeSingle()
  if (error) throw error
  return data
}
export async function fetchTransactions(code) {
  const { data, error } = await supabase
    .from('transactions').select('*').eq('drug_code', code)
    .order('transaction_date', { ascending: false }).limit(100)
  if (error) throw error
  return data || []
}
export async function fetchLots(code) {
  const { data, error } = await supabase
    .from('drug_lots').select('*').eq('drug_code', code).order('expiry_date')
  if (error) throw error
  return data || []
}
