/* 바코드 스캔 파싱·조회·합산 로직 (PR-B) — UI 없음.
   App.jsx 의 SCAN_API(handleScan · decodeGs1) 가 이 모듈에 위임한다.

   ★ 예외를 던지지 않는다. 전부 { ok, ... } 로 돌려준다.
     실사 도중 예외가 튀면 세션이 끊긴다(App.jsx 스캔 인터페이스 주석의 규약).
     DB 오류도 삼키지 않고 msg 에 담아 화면이 그대로 보여주게 한다.

   ★ 정규화는 이 파일의 normBarcode() 하나뿐이다.
     DB 의 public.norm_barcode(code, code_type) 와 **같은 규칙**을 쓴다.
     저장은 0087 트리거가 강제하므로 저장 경로는 손댈 필요가 없고,
     조회 경로만 여기서 맞춘다. 호출부마다 두면 규칙이 갈린다(결함 21 구조).

   ★ 날짜 조립은 하지 않는다. (17) 은 연·월·일 숫자까지만 계산하고
     문자열 조립은 호출부가 보호 계통 ymd(y,m,d) 로 한다.
     여기서 포맷을 만들면 날짜 정본이 둘로 갈린다. */
import { supabase } from './supabase'

/* ── 정규화 ────────────────────────────────────────────────────────────────
   GS1  : (01) 접두를 AI 로 떼고 숫자만 남긴 뒤 14자리로 좌측 0 채움.
          허용 길이 8·12·13·14(GTIN-8/UPC-A/EAN-13/GTIN-14). 그 외는 null.
          ※ 단순히 숫자만 남기면 「(01)08806717068539」가 16자리가 된다(01 이 섞임).
   자체 : 앞뒤 공백만 정리. 손대지 않는다. */
export function normBarcode(v, type) {
  if (v == null) return null
  if (type === '자체') { const d = String(v).trim(); return d === '' ? null : d }
  if (type !== 'GS1') return null
  const s = String(v)
  let d
  if (/^\s*\(01\)/.test(s)) {
    const m = s.match(/^\s*\(01\)\s*([0-9]{14})/)
    if (!m) return null
    d = m[1]
  } else {
    d = s.replace(/[^0-9]/g, '')
  }
  if (![8, 12, 13, 14].includes(d.length)) return null
  return d.padStart(14, '0')
}

/* GTIN-14 → GTIN-13 (심평원 자료 대조용).
   ★ 지시자(앞 1자리)가 0 일 때만 성립한다. 1~8 은 체크디짓이 재계산돼
     앞자리를 떼면 존재하지 않는 13자리가 된다(0087 헤더의 산술 실증). */
export function gtin13of(gtin14) {
  const s = String(gtin14 || '')
  return /^0[0-9]{13}$/.test(s) ? s.slice(1) : null
}

/* ── (17) 유효기한 YYMMDD → { y, m, d } ──────────────────────────────────
   ★ 세기: 의약품 유효기한은 미래이므로 20YY 고정. 2049년까지 안전하다.
   ★ DD = 00 은 GS1 규정상 「해당 월의 말일」이다. 이 처리를 빠뜨리면
     Invalid Date 가 되거나 조용히 null 로 저장된다.
   반환은 숫자 3개뿐 — 문자열 조립은 호출부의 ymd(y,m,d) 가 한다. */
export function gs1ExpiryParts(yymmdd) {
  const s = String(yymmdd || '').trim()
  if (!/^[0-9]{6}$/.test(s)) return null
  const y = 2000 + Number(s.slice(0, 2))
  const m = Number(s.slice(2, 4))
  let d = Number(s.slice(4, 6))
  if (m < 1 || m > 12) return null
  if (d === 0) d = new Date(y, m, 0).getDate()          // 말일 (m 은 1-based → 다음달 0일)
  else if (d > new Date(y, m, 0).getDate()) return null // 2월 30일 같은 값은 거부
  return { y, m, d }
}

/* ── GS1 파싱 ─────────────────────────────────────────────────────────────
   괄호 표기이므로 값은 「다음 ( 직전까지」로 확정된다 — FNC1 처리가 불필요하고
   (10) LOT 최대 20자 같은 가변길이 제약도 파서가 알 필요가 없다.
   ymdFn: 보호 계통 ymd(y,m,d). 넘기지 않으면 expiry 는 null 이고 parts 만 남는다.
   반환 { ok:true, gtin14, serial, lot, expiry, expiryParts, ais, form } | { ok:false, msg, raw } */
export function decodeGs1(raw, ymdFn) {
  const s = String(raw ?? '').trim()
  if (!s) return { ok: false, msg: '빈 입력입니다', raw: s }

  const ais = {}
  let form = null
  if (s.includes('(')) {
    const re = /\((\d{2,4})\)([^(]*)/g
    let m
    while ((m = re.exec(s)) !== null) ais[m[1]] = m[2].trim()
    form = 'AI'
    if (!ais['01']) {
      return { ok: false, msg: '바코드에 상품코드(01)가 없습니다 — 원문 「' + s + '」', raw: s, ais }
    }
  } else {
    /* 폴백 — 괄호 없는 순수 숫자. 14자리는 GTIN-14, 13자리는 좌측 0.
       normBarcode 가 8·12·13·14 를 전부 받으므로 길이 판정을 중복하지 않는다. */
    if (!/^[0-9]+$/.test(s)) {
      return { ok: false, msg: '바코드 형식이 아닙니다 — 원문 「' + s + '」', raw: s }
    }
    ais['01'] = s
    form = 'BARE'
  }

  const gtin14 = normBarcode(ais['01'], 'GS1')
  if (!gtin14) {
    return { ok: false, msg: '상품코드 자릿수가 규격 밖입니다 — 원문 「' + s + '」', raw: s, ais }
  }

  const expiryParts = ais['17'] ? gs1ExpiryParts(ais['17']) : null
  const expiry = (expiryParts && typeof ymdFn === 'function')
    ? ymdFn(expiryParts.y, expiryParts.m, expiryParts.d) : null

  return {
    ok: true, form, gtin14,
    serial: ais['21'] || null,
    lot: ais['10'] || null,
    expiryParts, expiry, ais,
  }
}

/* ── 조회 3분기 ───────────────────────────────────────────────────────────
   1단 행 있음 + drug_code 있음 → { ok:true, ... }
   2단 행 있음 + drug_code NULL → { ok:false, kind:'보류', hira, candidates }
   3단 행 없음                  → { ok:false, kind:'미등록', hira, candidates }

   ★ 자체번호 13자리 오인 대책 — 조회를 **원문과 GS1 정규화값 둘 다**로 한다.
     자체 「1234567890123」로 등록해 두고 스캔하면 GS1 정규화가 01234567890123 을
     만들어 빗나간다. unique(tenant_id, code) 가 있으므로 각 값당 최대 1건이다.
   ★ 둘 다 걸리면 GS1 을 택한다 — 심평원 적재분이 권위이고, 자체번호를
     13자리 숫자로 매기지 말라는 안내가 UI(PR-C)에 붙는다. collision 으로 알린다.

   origin 은 'scanner' | 'camera'. ★ source 컬럼은 둘 다 '스캔' 이므로 여기서는
   기록에만 쓰고 분기하지 않는다(장치 구분은 실사 결과에 의미가 없다). */
export async function handleScan(raw, origin, ymdFn) {
  const dec = decodeGs1(raw, ymdFn)
  const rawTrim = String(raw ?? '').trim()
  const gtin14 = dec.ok ? dec.gtin14 : null

  /* GS1 파싱이 실패해도 자체번호일 수 있다 — 원문으로 계속 찾는다. */
  const keys = [...new Set([gtin14, rawTrim].filter(Boolean))]
  if (!keys.length) return { ok: false, kind: '형식오류', msg: dec.msg || '읽을 수 없는 입력입니다', raw: rawTrim, origin }

  const { data: rows, error } = await supabase
    .from('drug_barcodes')
    .select('id, code, code_type, drug_code, insurance_code, product_name, pack_type, pack_qty, is_rep, source, memo')
    .in('code', keys).eq('is_active', true)
  if (error) return { ok: false, kind: 'DB오류', msg: '바코드 조회 실패: ' + error.message, raw: rawTrim, origin }

  const hitGs1 = gtin14 ? (rows || []).find(r => r.code === gtin14) : null
  const hitRaw = (rows || []).find(r => r.code === rawTrim)
  const row = hitGs1 || hitRaw || null
  const collision = !!(hitGs1 && hitRaw && hitGs1.id !== hitRaw.id)

  const common = {
    raw: rawTrim, origin, code: row ? row.code : (gtin14 || rawTrim),
    serial: dec.ok ? dec.serial : null,
    lot: dec.ok ? dec.lot : null,
    expiry: dec.ok ? dec.expiry : null,
    collision,
  }

  /* ── 1단 ── */
  if (row && row.drug_code) {
    const { data: d, error: e2 } = await supabase
      .from('drugs').select('drug_code, drug_name, status, unit, current_qty, unit_mgmt')
      .eq('drug_code', row.drug_code).maybeSingle()
    if (e2) return { ...common, ok: false, kind: 'DB오류', msg: '약품 조회 실패: ' + e2.message }
    if (!d) {
      /* 매핑은 있는데 약품이 사라진 경우 — 조용히 넘기지 않는다. */
      return { ...common, ok: false, kind: '미등록', msg: '연결된 약품(' + row.drug_code + ')을 찾을 수 없습니다',
        hira: hiraOf(row), candidates: [], candidateTotal: 0 }
    }
    return {
      ...common, ok: true, kind: '연결됨',
      barcodeId: row.id, drug: d, drug_code: d.drug_code,
      /* ★ 스캔한 코드의 값을 그대로 낸다. 약품 기준 대표값을 고르지 않는다 —
         같은 약품이라도 포장별로 다르다(베타그론 PTP 90 / 병 30 / 병 100 실측). */
      pack_type: row.pack_type, pack_qty: row.pack_qty == null ? null : Number(row.pack_qty),
      is_rep: row.is_rep, source: row.source, product_name: row.product_name,
    }
  }

  /* ── 2단 — 행은 있으나 약품 미확정(보류 8건) ── */
  if (row) {
    const codes = candidateCodesFromMemo(row.memo)
    const cand = await drugsByCodes(codes)
    return {
      ...common, ok: false, kind: '보류', barcodeId: row.id,
      msg: '이 바코드에 연결할 약품을 선택해 주세요',
      hira: hiraOf(row), memo: row.memo,
      candidates: cand.rows, candidateTotal: cand.total,
    }
  }

  /* ── 3단 — 미등록. 심평원 마스터로 힌트를 만든다(결함 46 의 활용처) ── */
  const hira = await hiraFromMaster(gtin14)
  const cand = hira && hira.product_name ? await drugsByName(hira.product_name) : { rows: [], total: 0 }
  return {
    ...common, ok: false, kind: '미등록',
    msg: '등록되지 않은 바코드입니다 — 약품을 선택하면 다음부터 자동으로 인식합니다',
    hira, candidates: cand.rows, candidateTotal: cand.total,
  }
}

/* 후보 목록 상한 — 화면 한 번에 훑을 수 있는 크기.
   ★ 심평원 품목기준코드로 넓히면 후보가 114건까지 벌어지는 사례가 있어(D0562)
     상한과 총 건수를 함께 낸다. 사용자가 「더 있음」을 알 수 있어야 한다. */
export const CAND_LIMIT = 8

function hiraOf(row) {
  if (!row) return null
  return {
    product_name: row.product_name || null,
    pack_type: row.pack_type || null,
    pack_qty: row.pack_qty == null ? null : Number(row.pack_qty),
    /* ★ drug_barcodes 에는 규격 컬럼이 없다 — 2단에서는 null 이고 화면이 알아서 건너뛴다.
       3단(hiraFromMaster)은 drug_master.specification 을 채워 「500(1)」까지 보인다. */
    specification: null,
    insurance_code: row.insurance_code || null,
    is_rep: !!row.is_rep,
  }
}

/* memo 에 남긴 후보 — 「후보 CDNSU·CDNSU5 — 확인 필요」 형식(apply_0087 이 기록). */
export function candidateCodesFromMemo(memo) {
  const m = String(memo || '').match(/후보\s+([^\s—-]+)/)
  if (!m) return []
  return m[1].split('·').map(s => s.trim()).filter(Boolean)
}

async function drugsByCodes(codes) {
  if (!codes.length) return { rows: [], total: 0 }
  const { data, error } = await supabase
    .from('drugs').select('drug_code, drug_name, status, unit, specification, current_qty')
    .in('drug_code', codes)
  if (error || !data) return { rows: [], total: 0 }
  return { rows: data.slice(0, CAND_LIMIT), total: data.length }
}

/* 심평원 상품명으로 원내 약품 검색.
   ★ 상품명은 「베타그론서방정50밀리그램(미라베그론)」처럼 성분 괄호가 붙어 있어
     그대로 like 하면 0건이 된다. 괄호 앞 본체만 쓰고, 그래도 길면 앞 6자로 줄인다. */
export async function drugsByName(productName) {
  const base = String(productName || '').split(/[(（[]/)[0].trim()
  if (!base) return { rows: [], total: 0 }
  const tries = [base, base.slice(0, 6)].filter((v, i, a) => v && a.indexOf(v) === i)
  for (const t of tries) {
    const { data, error } = await supabase
      .from('drugs').select('drug_code, drug_name, status, unit, specification, current_qty')
      .ilike('drug_name', '%' + t + '%')
    if (error) return { rows: [], total: 0 }
    if (data && data.length) return { rows: data.slice(0, CAND_LIMIT), total: data.length }
  }
  return { rows: [], total: 0 }
}

/* 미등록 GTIN → 심평원 마스터 역추적. ★ 읽기 전용. drug_master 는 수정하지 않는다. */
export async function hiraFromMaster(gtin14) {
  const g13 = gtin13of(gtin14)
  if (!g13) return null
  const { data, error } = await supabase
    .from('drug_master').select('standard_code, drug_name, package, total_qty, unit, specification, insurance_code, product_code')
    .eq('standard_code', g13).maybeSingle()
  if (error || !data) return null
  return {
    product_name: data.drug_name || null,
    pack_type: data.package || null,
    pack_qty: data.total_qty == null ? null : Number(data.total_qty),
    unit: data.unit || null,
    specification: data.specification || null,
    insurance_code: data.insurance_code || null,
    from: 'drug_master',
  }
}

/* ── 수량 합산 ────────────────────────────────────────────────────────────
   counted_qty = 미개봉 × pack_qty + 낱알.
   ★ 합산값 하나만 저장한다. drugs.current_qty 가 최소단위(정·mL) 개수이므로
     단위가 일치한다(BTGR50 current_qty 676 = 676정, purchase_price 381 실측).
     스키마 변경이 필요 없다.
   ★ pack_qty 는 스캔한 코드의 값이다. 약품 기준 대표값을 쓰지 않는다.
   ★ 반올림은 기존 관용구 Math.round(v*100)/100 을 그대로 쓴다(2026-09-05 확정 정책).
     올림·내림 아니고, 새 관용구를 만들지 않는다.
   반환 { ok:true, qty, sealed, loose, packQty } | { ok:false, msg } */
export function scanCountQty(sealed, loose, packQty) {
  const s = sealed === '' || sealed == null ? 0 : Number(sealed)
  const l = loose === '' || loose == null ? 0 : Number(loose)
  const p = packQty == null || packQty === '' ? null : Number(packQty)
  if (!Number.isFinite(s) || s < 0) return { ok: false, msg: '미개봉 수량은 0 이상의 숫자여야 합니다' }
  if (!Number.isFinite(l) || l < 0) return { ok: false, msg: '낱알 수량은 0 이상의 숫자여야 합니다' }
  if ((sealed === '' || sealed == null) && (loose === '' || loose == null)) {
    return { ok: false, msg: '실사수량을 입력해 주세요' }
  }
  if (s > 0 && (p == null || !Number.isFinite(p) || p <= 0)) {
    /* ★ 포장수량을 모르면 미개봉 개수를 정수(개)로 환산할 수 없다.
       조용히 1 로 치면 실사수량이 통째로 어긋난다 — 거부하고 사유를 말한다.
       대표행 693건과 자체번호가 여기 해당한다. */
    return { ok: false, msg: '이 바코드에는 포장수량 정보가 없습니다 — 낱알 칸에 실제 개수를 직접 입력해 주세요' }
  }
  const qty = Math.round((s * (p || 0) + l) * 100) / 100
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, msg: '실사수량을 계산할 수 없습니다' }
  return { ok: true, qty, sealed: s, loose: l, packQty: p }
}

/* ── 실사 항목 추가 — 스캔 전용 진입점 ────────────────────────────────────
   ★ addItem(App.jsx 4216) 을 쓰지 않는다. 그쪽은 수량을 먼저 요구하고,
     중복이면 거부하고, 매 건 loadAll() 로 전체를 재조회한다 — 연속 스캔에 맞지 않는다.
   ★ 중복을 막지 않는다. 같은 약품을 포장이 다른 두 바코드로 스캔하는 것은
     정상 조작이고(베타그론 PTP 90 + 병 100), countAdjustRows 가 약품코드로
     합산하므로 결과가 맞는다. countItemKey 는 여기서 호출하지 않는다.
   ★ 재조회하지 않는다. 호출부가 필요할 때 한 번만 새로고침한다. */
export async function scanAddItem({ countId, drugCode, countedQty, lotNo, expiryDate, bookQty }) {
  if (!countId) return { ok: false, msg: '실사 세션이 선택되지 않았습니다' }
  if (!drugCode) return { ok: false, msg: '약품이 선택되지 않았습니다' }
  const n = Number(countedQty)
  if (!Number.isFinite(n) || n < 0) return { ok: false, msg: '실사수량이 올바르지 않습니다' }
  const { data, error } = await supabase.from('inventory_count_items').insert([{
    count_id: countId, drug_code: drugCode,
    counted_qty: Math.round(n * 100) / 100,
    lot_no: (lotNo && String(lotNo).trim()) || null,
    expiry_date: expiryDate || null,
    book_qty: bookQty == null ? null : Number(bookQty),
    source: '스캔',
  }]).select('id').maybeSingle()
  if (error) return { ok: false, msg: '담기 실패: ' + error.message }
  return { ok: true, id: data ? data.id : null }
}

/* ── 매핑 저장(학습) ──────────────────────────────────────────────────────
   ★ source 를 '학습' 으로 둔다. 월 배치(apply_0087)가 이미 있는 code 를
     건너뛰므로 사람이 확정한 매핑이 덮이지 않는다.
   barcodeId 가 있으면 보류 행 UPDATE, 없으면 신규 INSERT.
   codeType 은 'GS1' | '자체'. 저장 전 정규화는 0087 트리거가 강제한다. */
export async function saveScanMapping({ barcodeId, code, codeType, drugCode, memo }) {
  if (!drugCode) return { ok: false, msg: '약품이 선택되지 않았습니다' }

  if (barcodeId) {
    const { data, error } = await supabase.from('drug_barcodes')
      .update({ drug_code: drugCode, source: '학습', memo: memo ?? null })
      .eq('id', barcodeId).select('id, code').maybeSingle()
    if (error) return { ok: false, msg: '매핑 저장 실패: ' + error.message }
    if (!data) return { ok: false, msg: '매핑을 저장하지 못했습니다 — 권한을 확인해 주세요' }
    return { ok: true, id: data.id, code: data.code, mode: 'update' }
  }

  const type = codeType || '자체'
  const norm = normBarcode(code, type)
  if (!norm) return { ok: false, msg: '바코드 번호 형식이 올바르지 않습니다 — 「' + code + '」' }

  /* tenant_id 에는 DB 기본값이 없다(0087). 기존 화면과 같은 방식으로 읽어 넣는다. */
  const { data: tm, error: te } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle()
  if (te) return { ok: false, msg: '테넌트 조회 실패: ' + te.message }
  if (!tm || !tm.tenant_id) return { ok: false, msg: '소속 정보를 찾을 수 없습니다 — 관리자에게 문의해 주세요' }

  const { data, error } = await supabase.from('drug_barcodes').insert([{
    tenant_id: tm.tenant_id, code: norm, code_type: type,
    drug_code: drugCode, source: '학습', memo: memo ?? null,
  }]).select('id, code').maybeSingle()
  if (error) {
    if (error.code === '23505') return { ok: false, msg: '이미 등록된 바코드입니다' }
    return { ok: false, msg: '매핑 저장 실패: ' + error.message }
  }
  return { ok: true, id: data ? data.id : null, code: data ? data.code : norm, mode: 'insert' }
}

/* ── 약품별 바코드 목록 (약품 상세 「바코드」 탭) ─────────────────────────
   ★ 비활성 행도 함께 낸다 — 회수 이력이 보여야 다시 등록할지 판단할 수 있다. */
export async function listBarcodes(drugCode) {
  if (!drugCode) return { ok: false, msg: '약품이 지정되지 않았습니다', rows: [] }
  const { data, error } = await supabase.from('drug_barcodes')
    .select('id, code, code_type, pack_type, pack_qty, is_rep, source, std_version, memo, is_active, created_at')
    .eq('drug_code', drugCode).order('is_active', { ascending: false }).order('code')
  if (error) return { ok: false, msg: '바코드 조회 실패: ' + error.message, rows: [] }
  return { ok: true, rows: data || [] }
}

/* GS1 체크디짓 검증 — DB 함수 public.gtin_check_ok() 를 호출한다.
   ★ JS 에 같은 계산을 또 만들지 않는다. 규칙이 갈리면 화면 경고와 실제가 어긋난다.
   ★ 제약이 아니라 경고용이다 — 심평원 자료에도 불일치가 1건 실재한다(0087 헤더).
   호출 실패는 '알 수 없음'(null)으로 돌려 화면이 경고를 띄우지 않게 한다. */
export async function gtinCheckOk(code) {
  const g = String(code || '').replace(/[^0-9]/g, '')
  if (!/^[0-9]{8,14}$/.test(g)) return null
  const { data, error } = await supabase.rpc('gtin_check_ok', { g })
  if (error) return null
  return data === true
}

/* 자체번호 13·14자리 숫자 경고 판정(결함 66).
   ★ 차단이 아니라 경고다 — 저장은 된다. 스캔 시 표준 바코드가 우선 인식된다. */
export const OWN_CODE_WARN = '숫자만 13·14자리는 표준 바코드와 혼동됩니다. 스캔 시 표준 바코드가 우선 인식될 수 있어 앞에 문자를 붙이기를 권합니다 — 예: L-1234567890123'
export function ownCodeLooksLikeGs1(code) { return /^[0-9]{13,14}$/.test(String(code || '').trim()) }

/* ── 오매핑 회수 ──────────────────────────────────────────────────────────
   ★ 삭제하지 않는다. 과거 실사 항목이 그 코드로 담겼을 수 있어 물리 삭제는
     이력을 끊는다. is_active=false 가 정규 경로이고, 부분 유니크 인덱스가
     비활성 행을 비켜가므로 같은 코드를 다시 등록할 수 있다. */
export async function deactivateBarcode(barcodeId, memo) {
  if (!barcodeId) return { ok: false, msg: '대상이 지정되지 않았습니다' }
  const patch = { is_active: false }
  if (memo != null) patch.memo = memo
  const { data, error } = await supabase.from('drug_barcodes')
    .update(patch).eq('id', barcodeId).select('id').maybeSingle()
  if (error) return { ok: false, msg: '해제 실패: ' + error.message }
  if (!data) return { ok: false, msg: '해제하지 못했습니다 — 권한을 확인해 주세요' }
  return { ok: true, id: data.id }
}
