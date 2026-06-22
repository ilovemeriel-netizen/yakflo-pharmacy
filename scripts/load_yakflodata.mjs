// ════════════════════════════════════════════════════════════════
// Yakflo · 기초데이터 적재 로더 — yakflodata.xlsx(1103행) → 신규 Seoul 프로젝트
// 근거: 약플로_통합구현가이드.md §5(전달월 이월+0), §6(컬럼 인벤토리)
//       약플로_Supabase_Seoul_재생성_가이드.md v1.1 5단계
//       + yakflodata.xlsx 실측(헤더 3행·42컬럼·상태값 휴면)
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
// ⚠️ 전제: drugs에 compound_type·prescription_type(0006)가 있으면 함께 적재,
//    없으면 자동 제거 후 재시도(미존재 컬럼 graceful). drug_vocab/0006은
//    0000_baseline 캡처 전 옛 DB에 적용해 두면 신규 프로젝트가 그대로 물려받음.
// ════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import process from 'node:process'

// ─────────────────────────────────────────────────────────────────
// CONFIG — 실행 전 확인할 값 (특히 ⚠ 표시)
// ─────────────────────────────────────────────────────────────────
const CONFIG = {
  XLSX_PATH: process.env.YAKFLO_XLSX || './yakflodata.xlsx',   // 개선본 1103행 (env YAKFLO_XLSX로 경로 지정 가능)
  SHEET_NAME: null,                 // null = 첫 시트
  HEADER_ROW: 3,                    // 헤더가 있는 행(1-base). 1~2행은 제목/빈칸 → 건너뜀
  TENANT_SLUG: 'cnc',               // 적재 대상 테넌트 (drugs.tenant_id 스탬프)
  TENANT_NAME: '씨엔씨재활의학과병원',
  TENANT_PLAN: 'enterprise',

  // 월마감 기준월 — opening balance 이월 스냅샷이 기록될 연/월
  SNAP_YEAR: 2026,
  SNAP_MONTH: 6,

  // inventory_stock의 현재고 수량 컬럼 (0000_baseline 확인 완료: current_qty integer)
  INVENTORY_QTY_COL: 'current_qty',

  EXPECTED_ROWS: 1103,              // 적재 후 sanity 기대값 (1083 아님)
  BATCH: 500,
  // 약품명 있고 코드 없는 행(중지 단종 약품 등)에 부여할 합성 코드 접두사.
  // 출현순 결정적 부여 → 재실행해도 동일 → upsert 안전. null이면 합성 안 함(코드없으면 제외).
  SYNTH_CODE_PREFIX: 'NOCODE-',
  // import 게이트: true면 '확인필요'·빈 보관방법이 있을 때 --commit 적재를 보류(재발 방지).
  // 기본 false = 경고만(가산적, 기존 동작 무변).
  STRICT_VOCAB: false,
}

const COMMIT = process.argv.includes('--commit')

// ─────────────────────────────────────────────────────────────────
// 엑셀 헤더 별칭 — yakflodata.xlsx 실측 42헤더 기준 (정확한 이름)
// 매칭 시 공백·줄바꿈·_x000D_ 제거 후 비교(normalize)하므로 '통당 단가' 등 OK.
// ⚠ '현재고 수량'(파일 계산값)은 쓰지 않는다 — 이월은 '전월재고 수량'.
// ⚠ 27·28 "재고+입고 …" 파생 총계는 적재 대상 아님.
// ─────────────────────────────────────────────────────────────────
const H = {
  drug_code:        ['코드(선택)', '약품코드', 'drug_code'],
  drug_name:        ['약품명', 'drug_name'],
  category:         ['구분', 'category'],
  ingredient_en:    ['성분명(EN)', '성분명(영문)', 'ingredient_en'],
  ingredient_kr:    ['성분명(KR)', '성분명(한글)', 'ingredient_kr'],
  compound_type:    ['복합/단일', 'compound_type'],
  prescription_type:['전문/일반', 'prescription_type'],
  efficacy:         ['효능', 'efficacy'],
  manufacturer:     ['제조/판매사', '제조사', 'manufacturer'],
  specification:    ['제형', '규격', 'specification'],
  unit:             ['포장', '단위', 'unit'],
  insurance_type:   ['급여구분', 'insurance_type'],
  insurance_code:   ['보험코드', 'insurance_code'],
  insurance_price:  ['보험약가', 'EDI단가', 'insurance_price'],
  narcotic_raw:     ['마약구분', '향정', 'narcotic_type'],
  price_unit:       ['통당 단가', '통당단가', '단가', 'price_unit'],
  storage_method:   ['보관방법', '보관', 'storage_method'],
  status:           ['상태', 'status'],
  expiry_date:      ['유효기한', 'expiry_date'],
  // 이월 원칙: '전월재고 수량'만 사용 (현재고 수량은 옛 시스템 계산값 → 제외)
  opening_qty:      ['전월재고 수량', '전월재고', 'opening_qty'],
}

// 헤더/별칭 정규화: 공백·줄바꿈·캐리지리턴 제거
function norm(s) { return String(s ?? '').replace(/_x000D_/gi, '').replace(/\s+/g, '').trim() }
function asText(v) { return String(v ?? '').trim() }
// drugs/inventory/snapshot의 수량·금액 컬럼은 전부 integer/bigint → 정수 반올림
function asNum(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n) : 0 }

// 정규화된 행에서 별칭 매칭
function pick(normRow, keys) {
  for (const k of keys) { const nk = norm(k); if (nk in normRow && asText(normRow[nk]) !== '') return normRow[nk] }
  return ''
}

function die(msg) { console.error('✗ ' + msg); process.exit(1) }

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if ((!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) && COMMIT)
  die('환경변수 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 설정하세요 (신규 Seoul 프로젝트).')

// ── 1) 엑셀 읽기 (약품코드 문자열 강제: raw:false, range=헤더행) ──
let wb
try { wb = XLSX.read(readFileSync(CONFIG.XLSX_PATH), { type: 'buffer', cellText: true, cellDates: false }) }
catch (e) { die(`엑셀 읽기 실패 (${CONFIG.XLSX_PATH}): ${e.message}`) }
const sheet = wb.Sheets[CONFIG.SHEET_NAME || wb.SheetNames[0]]
// range: 0-base 헤더 행 index = HEADER_ROW - 1
const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, range: CONFIG.HEADER_ROW - 1 })
if (!raw.length) die(`시트에 데이터가 없습니다 (헤더 ${CONFIG.HEADER_ROW}행 기준).`)

// ── 2) 행 파싱 + 적재 규칙 적용 ──
let dateCoerced = 0
const parsed = raw.map((r, i) => {
  // 정규화 키 맵 생성 (헤더의 _x000D_·공백 흡수)
  const nr = {}; for (const k of Object.keys(r)) nr[norm(k)] = r[k]
  let code = asText(pick(nr, H.drug_code)).toUpperCase()
  if (/^\d{1,2}[-/](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(code) ||
      /^\d{4}-\d{2}-\d{2}/.test(code)) dateCoerced++
  const opening = asNum(pick(nr, H.opening_qty))
  const price = asNum(pick(nr, H.insurance_price)) || asNum(pick(nr, H.price_unit))
  const nt = asText(pick(nr, H.narcotic_raw))
  const isNarc = !!nt && nt !== '일반' && nt !== '해당없음'
  return {
    _row: i + CONFIG.HEADER_ROW + 1,
    drug_code: code,
    drug_name: asText(pick(nr, H.drug_name)),
    category: asText(pick(nr, H.category)) || '경구제',
    ingredient_en: asText(pick(nr, H.ingredient_en)) || null,
    ingredient_kr: asText(pick(nr, H.ingredient_kr)) || null,
    compound_type: asText(pick(nr, H.compound_type)) || null,
    prescription_type: asText(pick(nr, H.prescription_type)) || null,
    efficacy: asText(pick(nr, H.efficacy)) || null,
    manufacturer: asText(pick(nr, H.manufacturer)) || null,
    specification: asText(pick(nr, H.specification)) || null,
    unit: asText(pick(nr, H.unit)) || null,
    insurance_type: asText(pick(nr, H.insurance_type)) || '급여',
    insurance_code: asText(pick(nr, H.insurance_code)) || null,
    insurance_price: asNum(pick(nr, H.insurance_price)),
    price_unit: asNum(pick(nr, H.price_unit)),
    storage_method: asText(pick(nr, H.storage_method)) || null,
    status: asText(pick(nr, H.status)) || '사용',
    expiry_date: asText(pick(nr, H.expiry_date)) || null,
    is_narcotic: isNarc,
    narcotic_type: isNarc ? nt : null,
    // 적재 규칙: 전월재고 → 현재고 이월
    current_qty: opening,
    _opening: opening,
    _price: price,
    valid: !!code && !!asText(pick(nr, H.drug_name)),
  }
})

// 합성 코드 부여: 약품명 있고 코드 없는 행(중지 단종 등)에 출현순 결정적 코드
let synthCount = 0
if (CONFIG.SYNTH_CODE_PREFIX) {
  for (const p of parsed) {
    if (!p.drug_code && p.drug_name) {
      p.drug_code = CONFIG.SYNTH_CODE_PREFIX + String(++synthCount).padStart(4, '0')
      p._synth = true
    }
    p.valid = !!p.drug_code && !!p.drug_name
  }
}

const valid = parsed.filter(p => p.valid)
const invalid = parsed.filter(p => !p.valid)
if (synthCount) console.log(`합성 코드 부여: ${synthCount}건 (${CONFIG.SYNTH_CODE_PREFIX}0001~)`)

// ── 3) 미리보기 요약 ──
const dist = (arr, key) => arr.reduce((m, p) => { m[p[key]] = (m[p[key]] || 0) + 1; return m }, {})
console.log('─'.repeat(60))
console.log(`파일: ${CONFIG.XLSX_PATH}  ·  시트: ${CONFIG.SHEET_NAME || wb.SheetNames[0]}  ·  헤더 ${CONFIG.HEADER_ROW}행`)
console.log(`총 ${parsed.length}행  ·  유효 ${valid.length}  ·  무효 ${invalid.length}`)
console.log('구분 분포:', dist(valid, 'category'))   // 기대 경구802/주사137/외용130/수액18/영양13/의약외품3
console.log('상태 분포:', dist(valid, 'status'))     // 기대 중지578/사용517/휴면8
console.log('마약구분 분포:', dist(valid, 'narcotic_type'))
if (dateCoerced) console.log(`⚠️ 약품코드 날짜변환 의심 ${dateCoerced}건 — 원본 셀을 '텍스트' 서식으로 저장 후 재시도`)
if (valid.length !== CONFIG.EXPECTED_ROWS)
  console.log(`⚠️ 유효행(${valid.length}) ≠ 기대(${CONFIG.EXPECTED_ROWS}) — 파일/헤더/HEADER_ROW 확인`)
if (invalid.length) {
  const noCode = invalid.filter(p => !p.drug_code).length
  const noName = invalid.filter(p => p.drug_code && !p.drug_name).length
  const both = invalid.filter(p => !p.drug_code && !p.drug_name).length
  console.log(`무효 사유: 코드없음 ${noCode} · 약품명없음 ${noName} · 둘다없음 ${both}`)
  const noCodeByStatus = invalid.filter(p => !p.drug_code).reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m }, {})
  console.log('코드없음 상태분포:', noCodeByStatus)
  console.log('무효행 예시(행번호):', invalid.slice(0, 3).map(p => p._row))
}
console.log('drugs 샘플:', valid.slice(0, 2).map(p => ({ drug_code: p.drug_code, drug_name: p.drug_name, category: p.category, current_qty: p.current_qty, narcotic_type: p.narcotic_type })))

// ── import 게이트: '확인필요'(규제/전문)·빈 보관방법 검증 (재발 방지) ──
//    ※ 기존 225·483 보강이 아니라, 향후 적재 시 같은 미보강 데이터가 재유입되는 것을 경고/보류.
const needReview = valid.filter(p => p.narcotic_type === '확인필요' || p.prescription_type === '확인필요')
const blankStorage = valid.filter(p => !p.storage_method)
if (needReview.length || blankStorage.length) {
  console.log(`⚠️ import 게이트: 확인필요(규제/전문) ${needReview.length}건 · 보관방법 빈값 ${blankStorage.length}건 — 보강 권장`)
  if (CONFIG.STRICT_VOCAB && COMMIT) {
    die('STRICT_VOCAB: 확인필요/빈 보관방법이 남아 있어 적재를 보류합니다. 통합본·약가마스터로 보강 후 재시도하세요.')
  }
}

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

// 4-1) drugs (마스터) — drug_code upsert + 미존재 컬럼 자동 제거 재시도(App.jsx 방식)
const drugRows = valid.map(p => ({
  drug_code: p.drug_code, drug_name: p.drug_name, category: p.category,
  ingredient_en: p.ingredient_en, ingredient_kr: p.ingredient_kr,
  compound_type: p.compound_type, prescription_type: p.prescription_type,
  efficacy: p.efficacy, manufacturer: p.manufacturer,
  specification: p.specification, unit: p.unit,
  insurance_type: p.insurance_type, insurance_code: p.insurance_code, edi_price: p.insurance_price,
  price_unit: p.price_unit, storage_method: p.storage_method, status: p.status,
  expiry_date: p.expiry_date, is_narcotic: p.is_narcotic, narcotic_type: p.narcotic_type,
  current_qty: p.current_qty, tenant_id,
}))
console.log('▶ drugs 적재…')
for (let i = 0; i < drugRows.length; i += CONFIG.BATCH) {
  let attempt = 0
  while (true) {
    const slice = drugRows.slice(i, i + CONFIG.BATCH)
    // drugs는 drug_code unique 제약이 없어 일반 insert (빈 테이블 초기 적재).
    // 재적재 시 중복 방지를 위해 사전에 truncate 필요.
    const { error } = await supa.from('drugs').insert(slice)
    if (!error) break
    const m = error.message.match(/'([^']+)' column|column ["']([^"']+)["']/)
    const col = m && (m[1] || m[2])
    if (col && attempt < 8) { drugRows.forEach(r => delete r[col]); attempt++; console.log('  누락 컬럼 제거:', col); continue }
    die(`drugs 적재 실패 (배치 ${i / CONFIG.BATCH}): ${error.message}`)
  }
  console.log(`  drugs: ${Math.min(i + CONFIG.BATCH, drugRows.length)}/${drugRows.length}`)
}

async function insertBatched(table, rows) {
  for (let i = 0; i < rows.length; i += CONFIG.BATCH) {
    const { error } = await supa.from(table).insert(rows.slice(i, i + CONFIG.BATCH))
    if (error) die(`${table} 적재 실패 (배치 ${i / CONFIG.BATCH}): ${error.message}`)
    console.log(`  ${table}: ${Math.min(i + CONFIG.BATCH, rows.length)}/${rows.length}`)
  }
}

// 4-2) inventory_stock (현재고=전월재고 이월) — current_qty만 채우고
//      파생·통계(current_amount/safety_stock/max_stock/prev_year_usage/recent_3m_usage/
//      monthly_avg/stock_status/order_alert)는 DB 기본값/널로 둔다(적재 단계 미적용).
const invRows = valid.map(p => ({
  drug_code: p.drug_code,
  drug_name: p.drug_name || null,
  [CONFIG.INVENTORY_QTY_COL]: p._opening,
  tenant_id,
}))
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
