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

/* 약품 목록 — 서버 페이지네이션(.range) + count. 필터는 drug_vocab 값. */
export async function fetchDrugs({ page = 0, pageSize = 50, category = '', status = '', search = '' }) {
  let q = supabase
    .from('drugs')
    .select('drug_code,drug_name,category,current_qty,expiry_date,status,is_narcotic,narcotic_type,insurance_type,ingredient_kr', { count: 'exact' })
  if (category) q = q.eq('category', category)
  if (status) q = q.eq('status', status)
  const s = sanitize(search)
  if (s) q = q.or(`drug_name.ilike.%${s}%,drug_code.ilike.%${s}%`)
  q = q.order('drug_name').range(page * pageSize, page * pageSize + pageSize - 1)
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
