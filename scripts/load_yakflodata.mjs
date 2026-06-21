// ════════════════════════════════════════════════════════════════
// Yakflo · 기초데이터 적재 로더 — yakflodata.xlsx(1103행) → 신규 Seoul 프로젝트
// 근거: 약플로_통합구현가이드.md §5(전달월 이월+0), §6(컬럼 인벤토리)
//       약플로_Supabase_Seoul_재생성_가이드.md v1.1 5단계
//
// 실행 (repo 루트에서):
//   1) 미리보기(기본·쓰기 안 함):  node scripts/load_yakflodata.mjs
//   2) 실제 적재:                  node scripts/load_yakflodata.mjs --commit
//
// 필요 환경변수 (절대 커밋 금지 — 셸에서만):
//   SUPABASE_URL                = 신규 Seoul 프로젝트 URL
//   SUPABASE_SERVICE_ROLE_KEY   = 신규 프로젝트 service_role 키 (서버 전용)
//   예) (PowerShell)  $env:SUPABASE_URL="https://xxx.supabase.co"
//       $env:SUPABASE_SERVICE_ROLE_KEY="ey..."; node scripts/load_yakflodata.mjs
//
// ⚠️ service_role는 RLS를 우회한다. 신규 빈 프로젝트 초기 적재 전용으로만 사용.
// ════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import process from 'node:process'

// ─────────────────────────────────────────────────────────────────
// CONFIG — 실행 전 확인할 값 (특히 ⚠ 표시)
// ─────────────────────────────────────────────────────────────────
const CONFIG = {
  XLSX_PATH: './yakflodata.xlsx',   // 개선본 1103행 파일 경로
  SHEET_NAME: null,                 // null = 첫 시트
  TENANT_SLUG: 'cnc',               // 적재 대상 테넌트 (drugs.tenant_id 스탬프)
  TENANT_NAME: '씨엔씨재활의학과병원',
  TENANT_PLAN: 'enterprise',

  // 월마감 기준월 — opening balance 이월 스냅샷이 기록될 연/월
  SNAP_YEAR: 2026,
  SNAP_MONTH: 6,

  // ⚠️ inventory_stock의 '현재고 수량' 컬럼명 — 0000_baseline.sql에서 확인 후 맞출 것.
  //    (App.jsx는 inventory_stock을 읽기만 해 코드로 확정 불가. 흔한 후보: quantity / qty / current_qty)
  INVENTORY_QTY_COL: 'quantity',

  EXPECTED_ROWS: 1103,              // 적재 후 sanity 기대값 (1083 아님)
  BATCH: 500,
}

const COMMIT = process.argv.includes('--commit')

// ─────────────────────────────────────────────────────────────────
// 엑셀 헤더 별칭 — App.jsx xlUpload 매핑과 동일 + 가이드 §6 컬럼
// (실제 파일 헤더와 다르면 여기에 추가)
// ─────────────────────────────────────────────────────────────────
const H = {
  drug_code:        ['약품코드', '약품코드(필수)', 'drug_code', '코드'],
  drug_name:        ['약품명', '약품명(필수)', 'drug_name', '제품명'],
  category:         ['구분', 'category'],
  ingredient_en:    ['성분명(영문)', '성분명(영어)', 'ingredient_en'],
  ingredient_kr:    ['성분명(한글)', '성분명', 'ingredient_kr'],
  efficacy_class:   ['약효분류', '약효분류명', 'efficacy_class'],
  efficacy:         ['효능', 'efficacy'],
  manufacturer:     ['제조사', '제조/판매사', 'manufacturer'],
  unit:             ['단위', 'unit'],
  specification:    ['규격', '이약량', 'specification'],
  price_unit:       ['단가', '통당단가', 'price_unit'],
  insurance_price:  ['EDI단가', '보험가', '보험약가', 'insurance_price'],
  insurance_type:   ['급여구분', 'insurance_type'],
  insurance_code:   ['보험코드', 'insurance_code'],
  storage_method:   ['보관', '보관방법', 'storage_method'],
  status:           ['상태', 'status'],
  expiry_date:      ['유효기한', 'expiry_date'],
  lot_no:           ['LOT번호', 'lot_no'],
  narcotic_raw:     ['향정', '향정마약', '마약구분', 'narcotic_type'],
  compound_type:    ['복합/단일', '복합단일', 'compound_type'],
  prescription_type:['전문/일반', '전문일반', 'prescription_type'],
  // 전월재고(opening balance) — 현재고로 이월
  opening_qty:      ['전월재고', '현재고', 'opening_qty', 'current_qty'],
}

function pick(row, keys) {
  for (const k of keys) if (k in row && String(row[k]).trim() !== '') return row[k]
  return ''
}
function asText(v) { return String(v ?? '').trim() }
function asNum(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }

// ─────────────────────────────────────────────────────────────────
function die(msg) { console.error('✗ ' + msg); process.exit(1) }

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  die('환경변수 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 설정하세요 (신규 Seoul 프로젝트).')

// ── 1) 엑셀 읽기 (약품코드 문자열 강제: raw:false → 셀 서식 텍스트) ──
let wb
try { wb = XLSX.read(readFileSync(CONFIG.XLSX_PATH), { type: 'buffer', cellText: true, cellDates: false }) }
catch (e) { die(`엑셀 읽기 실패 (${CONFIG.XLSX_PATH}): ${e.message}`) }
const sheet = wb.Sheets[CONFIG.SHEET_NAME || wb.SheetNames[0]]
const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
if (!raw.length) die('시트에 데이터가 없습니다.')

// ── 2) 행 파싱 + 적재 규칙 적용 ──
let dateCoerced = 0
const parsed = raw.map((r, i) => {
  let code = asText(pick(r, H.drug_code)).toUpperCase()
  // 약품코드 날짜 자동변환 흔적 감지 (APR2 → '2-Apr' 등)
  if (/^\d{1,2}[-/](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(code) ||
      /^\d{4}-\d{2}-\d{2}/.test(code)) dateCoerced++
  const opening = asNum(pick(r, H.opening_qty))
  const price = asNum(pick(r, H.insurance_price)) || asNum(pick(r, H.price_unit))
  const nt = asText(pick(r, H.narcotic_raw))
  return {
    _row: i + 2,
    drug_code: code,
    drug_name: asText(pick(r, H.drug_name)),
    category: asText(pick(r, H.category)) || '경구제',
    ingredient_en: asText(pick(r, H.ingredient_en)) || null,
    ingredient_kr: asText(pick(r, H.ingredient_kr)) || null,
    efficacy_class: asText(pick(r, H.efficacy_class)) || null,
    efficacy: asText(pick(r, H.efficacy)) || null,
    manufacturer: asText(pick(r, H.manufacturer)) || null,
    unit: asText(pick(r, H.unit)) || null,
    specification: asText(pick(r, H.specification)) || null,
    price_unit: asNum(pick(r, H.price_unit)),
    insurance_price: asNum(pick(r, H.insurance_price)),
    insurance_type: asText(pick(r, H.insurance_type)) || '급여',
    insurance_code: asText(pick(r, H.insurance_code)) || null,
    storage_method: asText(pick(r, H.storage_method)) || null,
    status: asText(pick(r, H.status)) || '사용',
    expiry_date: asText(pick(r, H.expiry_date)) || null,
    lot_no: asText(pick(r, H.lot_no)) || null,
    is_narcotic: !!nt && nt !== '일반' && nt !== '해당없음',
    narcotic_type: (nt && nt !== '일반' && nt !== '해당없음') ? nt : null,
    compound_type: asText(pick(r, H.compound_type)) || null,
    prescription_type: asText(pick(r, H.prescription_type)) || null,
    // 적재 규칙: 전월재고 → 현재고 이월
    current_qty: opening,
    _opening: opening,
    _price: price,
    valid: !!code && !!asText(pick(r, H.drug_name)),
  }
})

const valid = parsed.filter(p => p.valid)
const invalid = parsed.filter(p => !p.valid)

// ── 3) 미리보기 요약 ──
const byCat = {}; valid.forEach(p => { byCat[p.category] = (byCat[p.category] || 0) + 1 })
const byStatus = {}; valid.forEach(p => { byStatus[p.status] = (byStatus[p.status] || 0) + 1 })
console.log('─'.repeat(60))
console.log(`파일: ${CONFIG.XLSX_PATH}  ·  시트: ${CONFIG.SHEET_NAME || wb.SheetNames[0]}`)
console.log(`총 ${parsed.length}행  ·  유효 ${valid.length}  ·  무효 ${invalid.length}`)
console.log('구분 분포:', byCat)
console.log('상태 분포:', byStatus)
if (dateCoerced) console.log(`⚠️ 약품코드 날짜변환 의심 ${dateCoerced}건 — 원본 셀을 '텍스트' 서식으로 저장 후 재시도 권장`)
if (valid.length !== CONFIG.EXPECTED_ROWS)
  console.log(`⚠️ 유효행(${valid.length}) ≠ 기대(${CONFIG.EXPECTED_ROWS}) — 파일/헤더 확인`)
if (invalid.length) console.log('무효행 예시(코드/약품명 누락):', invalid.slice(0, 3).map(p => p._row))
console.log('drugs 샘플:', valid.slice(0, 2).map(p => ({ drug_code: p.drug_code, drug_name: p.drug_name, category: p.category, current_qty: p.current_qty })))

if (!COMMIT) {
  console.log('─'.repeat(60))
  console.log('DRY-RUN (쓰기 안 함). 실제 적재하려면 --commit 플래그를 붙이세요.')
  process.exit(0)
}

// ── 4) 실제 적재 ──
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// 4-0) 테넌트 보장 + id 확보
await supa.from('tenants').upsert(
  { name: CONFIG.TENANT_NAME, slug: CONFIG.TENANT_SLUG, plan: CONFIG.TENANT_PLAN },
  { onConflict: 'slug', ignoreDuplicates: true })
const { data: ten, error: tenErr } = await supa.from('tenants').select('id').eq('slug', CONFIG.TENANT_SLUG).single()
if (tenErr || !ten) die('테넌트 조회 실패: ' + (tenErr?.message || 'no row'))
const tenant_id = ten.id
console.log(`테넌트 ${CONFIG.TENANT_SLUG} = ${tenant_id}`)

async function insertBatched(table, rows, opts) {
  for (let i = 0; i < rows.length; i += CONFIG.BATCH) {
    const slice = rows.slice(i, i + CONFIG.BATCH)
    const q = opts?.upsert
      ? supa.from(table).upsert(slice, { onConflict: opts.upsert })
      : supa.from(table).insert(slice)
    const { error } = await q
    if (error) die(`${table} 적재 실패 (배치 ${i / CONFIG.BATCH}): ${error.message}`)
    console.log(`  ${table}: ${Math.min(i + CONFIG.BATCH, rows.length)}/${rows.length}`)
  }
}

// 4-1) drugs (마스터) — 재실행 안전 위해 drug_code upsert
const drugRows = valid.map(p => ({
  drug_code: p.drug_code, drug_name: p.drug_name, category: p.category,
  ingredient_en: p.ingredient_en, ingredient_kr: p.ingredient_kr,
  efficacy_class: p.efficacy_class, efficacy: p.efficacy, manufacturer: p.manufacturer,
  unit: p.unit, specification: p.specification, price_unit: p.price_unit,
  insurance_price: p.insurance_price, insurance_type: p.insurance_type, insurance_code: p.insurance_code,
  storage_method: p.storage_method, status: p.status, expiry_date: p.expiry_date, lot_no: p.lot_no,
  is_narcotic: p.is_narcotic, narcotic_type: p.narcotic_type,
  compound_type: p.compound_type, prescription_type: p.prescription_type,
  current_qty: p.current_qty, tenant_id,
}))
console.log('▶ drugs 적재…')
await insertBatched('drugs', drugRows, { upsert: 'drug_code' })

// 4-2) inventory_stock (현재고) — ⚠ 컬럼명 CONFIG.INVENTORY_QTY_COL 확인 필수
const invRows = valid.map(p => ({ drug_code: p.drug_code, [CONFIG.INVENTORY_QTY_COL]: p._opening, tenant_id }))
console.log(`▶ inventory_stock 적재… (수량 컬럼='${CONFIG.INVENTORY_QTY_COL}')`)
await insertBatched('inventory_stock', invRows)

// 4-3) monthly_snapshots (이월) — opening=closing=전월재고, 입출고/폐기/반품 0
const snapRows = valid.map(p => ({
  drug_code: p.drug_code, snap_year: CONFIG.SNAP_YEAR, snap_month: CONFIG.SNAP_MONTH,
  opening_qty: p._opening, opening_amount: p._opening * p._price,
  total_in_qty: 0, total_in_amount: 0, total_out_qty: 0, total_out_amount: 0,
  total_disp_qty: 0, total_ret_qty: 0,
  closing_qty: p._opening, closing_amount: p._opening * p._price, tenant_id,
}))
console.log('▶ monthly_snapshots 적재…')
await insertBatched('monthly_snapshots', snapRows)

// 4-4) transactions = 0 (적재 안 함)
console.log('▶ transactions: 0건 (시작 상태) — 적재 생략')

// ── 5) 적재 후 검증 ──
const { count } = await supa.from('drugs').select('*', { count: 'exact', head: true })
console.log('─'.repeat(60))
console.log(`✅ 완료. drugs count = ${count}  (기대 ${CONFIG.EXPECTED_ROWS})`)
if (count !== CONFIG.EXPECTED_ROWS) console.log('⚠️ 기대값과 다름 — 중복/누락 확인')
