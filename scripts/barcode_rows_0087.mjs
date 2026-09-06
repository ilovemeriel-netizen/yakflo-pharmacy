// barcode_rows_0087.mjs — 심평원 표준코드 CSV → drug_barcodes 적재행 산출 (단일 지점).
//
// ★ dryrun_0087 · apply_0087 · verify_0087 이 모두 이 모듈을 쓴다.
//   각 스크립트가 따로 매칭 규칙을 두면 dryrun 이 통과한 것과 apply 가 넣는 것이 갈린다
//   (countAdjustRows 를 함수 안에서 반올림하기로 한 것과 같은 이유).
//
// 매칭 규칙 (2026-09-06 실측 확정)
//   · 제품코드(개정후) = drugs.insurance_code **완전일치만**.
//     품목기준코드 보완은 쓰지 않는다 — 사용중 52건 중 3건이 다른 제품을 가리킨다
//     (SJLRZP4→아티반주사 · VASELLIN→구미백색바셀린(원료) · D0562→후보 114건).
//   · 취소일자가 자료 기준일(2025-10-31) 이전이면 제외, 미래면 적재하고 memo 에 남긴다.
//   · 한 제품코드에 원내 약품이 2건 이상이면 drug_code 를 비우고 후보를 memo 에 적는다.
//     (실측 4그룹 9약품: 지씨플루 3 · 건스펜틴 2 · 코데날액 2 · 프레리카 2)
//     자동으로 하나를 고르면 오매핑이고, 둘 다 넣으면 unique(tenant_id, code) 위반이다.
//
// CSV 는 data/ 에 두고 커밋하지 않는다(.gitignore:47 `data/*`). 54MB · CP949.
import fs from 'node:fs'

export const CSV_PATH   = 'data/건강보험심사평가원_약가마스터_의약품표준코드_20251031.csv'
export const STD_VERSION = '2025-10-31'          // 자료 기준일 = 파일명 날짜
const CUTOFF = STD_VERSION                        // 취소일자 판정 기준

/* RFC4180 파서 — 따옴표 안의 콤마를 보존한다(예: "한약재, 갈근"). */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = [], cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const T = v => String(v ?? '').trim()

/* CSV 적재 — 헤더명으로 컬럼 위치를 찾는다(열 순서 변동에 견디게). */
export function loadCsv(path = CSV_PATH) {
  if (!fs.existsSync(path)) throw new Error('CSV 없음: ' + path + ' (data/ 에 두십시오. 커밋 금지)')
  const text = new TextDecoder('euc-kr').decode(fs.readFileSync(path))
  const rows = parseCsv(text)
  const head = rows[0].map(s => s.trim())
  const ix = n => { const i = head.indexOf(n); if (i < 0) throw new Error('CSV 컬럼 없음: ' + n); return i }
  const C = {
    nm: ix('한글상품명'), spec: ix('약품규격'), qty: ix('제품총수량'), form: ix('제형구분'),
    pack: ix('포장형태'), item: ix('품목기준코드'), rep: ix('대표코드'), std: ix('표준코드'),
    prod: ix('제품코드(개정후)'), cancel: ix('취소일자'),
  }
  const data = rows.slice(1).filter(r => r.length >= head.length - 2 && T(r[C.std]))
  return { head, C, data }
}

/* GS1 정규화 — DB 의 public.norm_barcode('GS1') 과 같은 규칙.
   ★ 스크립트가 만든 값과 트리거가 만드는 값이 반드시 같아야 한다.
     다르면 dryrun 이 통과한 code 와 실제 저장된 code 가 갈린다. */
export function toGtin14(std13) {
  const d = String(std13 ?? '').replace(/[^0-9]/g, '')
  if (![8, 12, 13, 14].includes(d.length)) return null
  return d.padStart(14, '0')
}

/* 제품코드 정규화 — ★ 보험코드는 9자리 체계인데 CSV 는 앞자리 0 을 떨군 8자리를 섞어 낸다.
   실측(2025-10-31 자료): 8자리 3,307건 · 9자리 61,976건.
   완전일치만 하면 8자리가 전부 빠진다 — 사용중 6건(레바미론정·프롤리아·나조넥스·
   둘코락스좌약·아제타정·이지트롤정)이 이 때문에 누락됐다(결함 63).
   ★ 보정 안전성 실측: 8자리 보정값 1,198종 ↔ 기존 9자리 21,108종 충돌 0종.
   ※ 8·9자리 숫자만 손댄다. 그 외 형태는 그대로 두어 오탐을 막는다. */
export function normProdCode(v) {
  const s = T(v)
  return /^[0-9]{8,9}$/.test(s) ? s.padStart(9, '0') : s
}

/* 적재행 산출.
   drugs: [{ drug_code, drug_name, insurance_code, status }]
   반환 { rows, skip, stat } */
export function buildRows(drugs, csv, tenantId) {
  const { C, data } = csv

  // 보험코드 → 약품들 (중복 그룹 판정용)
  const byIc = new Map()
  for (const d of drugs) {
    const ic = T(d.insurance_code)
    if (!/^[0-9]{9}$/.test(ic)) continue
    if (!byIc.has(ic)) byIc.set(ic, [])
    byIc.get(ic).push(d)
  }

  const rows = []
  const skip = { 제품코드없음: 0, 원내미취급: 0, 취소완료: 0, 코드형식이상: 0 }
  const stat = { 취소예정: 0, 중복보류: 0, 대표행: 0, 포장행: 0 }

  for (const r of data) {
    const prod = normProdCode(r[C.prod])          // ★ 8자리 → 좌측 0 보정(결함 63)
    if (!prod) { skip.제품코드없음++; continue }

    const hits = byIc.get(prod)
    if (!hits || !hits.length) { skip.원내미취급++; continue }

    const cancel = T(r[C.cancel])
    // 기준일 이전 취소분은 이미 유통되지 않는다 — 적재하지 않는다.
    if (cancel && cancel <= CUTOFF) { skip.취소완료++; continue }

    const code = toGtin14(T(r[C.std]))
    if (!code) { skip.코드형식이상++; continue }

    const isRep = T(r[C.rep]) === T(r[C.std])
    const packT = isRep ? null : (T(r[C.pack]) || null)
    const qn = Number(T(r[C.qty]))
    const packQ = isRep ? null : (Number.isFinite(qn) && qn > 0 ? qn : null)

    const memo = []
    if (cancel) { memo.push('취소예정 ' + cancel); stat.취소예정++ }

    // 한 제품코드에 약품이 2건 이상이면 사람이 고르게 남긴다.
    let drugCode = null
    if (hits.length === 1) drugCode = hits[0].drug_code
    else {
      memo.push('후보 ' + hits.map(h => h.drug_code).join('·') + ' — 확인 필요')
      stat.중복보류++
    }

    if (isRep) stat.대표행++; else stat.포장행++

    rows.push({
      tenant_id: tenantId,
      code,
      code_type: 'GS1',
      drug_code: drugCode,
      insurance_code: prod,
      product_name: T(r[C.nm]) || null,
      pack_type: packT,
      pack_qty: packQ,
      is_rep: isRep,
      source: '심평원',
      std_version: STD_VERSION,
      memo: memo.length ? memo.join(' / ') : null,
    })
  }
  return { rows, skip, stat }
}

/* 참고 지표 — Stage 0 「매칭분만 vs 제품코드 보유 전량」 판단용.
   적재하지는 않는다. 숫자만 낸다. */
export function scopeStats(drugs, csv) {
  const { C, data } = csv
  const ics = new Set(drugs.map(d => T(d.insurance_code)).filter(v => /^[0-9]{9}$/.test(v)))
  let prodRows = 0, matched = 0
  for (const r of data) {
    const p = normProdCode(r[C.prod]); if (!p) continue   // ★ buildRows 와 같은 규칙(결함 63)
    prodRows++
    if (ics.has(p)) matched++
  }
  return { csvRows: data.length, prodRows, matched }
}
