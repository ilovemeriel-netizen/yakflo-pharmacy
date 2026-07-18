/* 약플로 · 약품 행 검증/정규화 단일 출처 (등록 모드 규칙 + 대량 업로드 공용).
   중복 구현 금지 원칙에 따라 통제 어휘·문자열 강제·빈셀 무시·owner 게이트를 여기 한 곳에 둔다.
   - 모든 값은 문자열로 들어온다(SheetJS raw:false). 숫자/날짜 자동 변환 없음.
   - 빈 셀은 out 에 담지 않는다 → upsert 시 기존 DB 값을 덮어쓰지 않는다.
   - 통제 어휘 이탈 값은 errors 로 분류(해당 필드만 제외; 필수 이탈이면 행 오류).
   - 단가(purchase_price·edi_price)·is_high_alert 는 owner 인 경우에만 반영(0019 트리거/권한 규칙과 일치).
   - price_unit(통당)·current_amount(파생 금액)은 절대 쓰지 않는다(CLAUDE.md 단가 철칙). */

export const VOCAB = {
  category: ['경구제', '주사제', '외용제', '수액제', '영양제', '의약외품'],
  status: ['사용', '중지', '휴면'],
  insurance_type: ['급여', '비급여'],
  narcotic_type: ['일반', '향정', '마약', '한외마약'],
  compound_type: ['단일제', '복합제'],
  storage_method: ['실온', '실온/차광', '냉장', '냉장/차광'],
}

/* 캔버스 필드 → drugs 실제 컬럼 + 헤더 자동 인식용 별칭.
   type: string | vocab | number | date | bool. owner:true → owner 만 반영. */
export const FIELD_DEFS = [
  { key: 'drug_code', col: 'drug_code', label: '약품코드', required: true, type: 'string', aliases: ['약품코드', '코드', 'drug_code', 'code'] },
  { key: 'drug_name', col: 'drug_name', label: '약품명', required: true, type: 'string', aliases: ['약품명', '제품명', '품명', 'name', 'drug_name'] },
  { key: 'category', col: 'category', label: '구분', required: true, type: 'vocab', vocab: 'category', aliases: ['구분', '분류', '제형', 'category'] },
  { key: 'status', col: 'status', label: '상태', type: 'vocab', vocab: 'status', aliases: ['상태', '사용상태', 'status'] },
  { key: 'insurance_type', col: 'insurance_type', label: '급여구분', type: 'vocab', vocab: 'insurance_type', aliases: ['급여구분', '급여', '보험구분', 'insurance_type'] },
  { key: 'narcotic_type', col: 'narcotic_type', label: '마약구분', type: 'vocab', vocab: 'narcotic_type', aliases: ['마약구분', '향정마약', '향정', '마약', 'narcotic_type'] },
  { key: 'compound_type', col: 'compound_type', label: '복합/단일', type: 'vocab', vocab: 'compound_type', aliases: ['복합/단일', '복합단일', '복합제', 'compound_type'] },
  { key: 'ingredient_en', col: 'ingredient_en', label: '성분(영)', type: 'string', aliases: ['성분명(영문)', '성분명(영어)', '영문성분', 'ingredient_en'] },
  { key: 'ingredient_kr', col: 'ingredient_kr', label: '성분(한)', type: 'string', aliases: ['성분명(한글)', '성분명', '성분', 'ingredient_kr'] },
  { key: 'manufacturer', col: 'manufacturer', label: '제조사', type: 'string', aliases: ['제조사', '제조판매사', '업체', 'manufacturer'] },
  { key: 'specification', col: 'specification', label: '규격', type: 'string', aliases: ['규격', '포장규격', 'specification'] },
  { key: 'unit', col: 'unit', label: '단위', type: 'string', aliases: ['단위', 'unit'] },
  { key: 'purchase_price', col: 'purchase_price', label: '구입단가', type: 'number', owner: true, aliases: ['구입단가', '개당단가', '매입가', 'purchase_price'] },
  { key: 'edi_price', col: 'edi_price', label: '보험약가', type: 'number', owner: true, aliases: ['보험약가', 'edi단가', '약가', '상한가', 'edi_price'] },
  { key: 'insurance_code', col: 'insurance_code', label: '보험코드', type: 'string', aliases: ['보험코드', '청구코드', 'insurance_code'] },
  { key: 'standard_code', col: 'standard_code', label: '품목기준코드', type: 'string', aliases: ['품목기준코드', '기준코드', '품목코드', 'standard_code'] },
  { key: 'current_qty', col: 'current_qty', label: '현재고', type: 'number', aliases: ['현재고', '재고', '수량', 'current_qty'] },
  { key: 'safety_stock', col: 'safety_stock', label: '안전재고', type: 'number', aliases: ['안전재고', 'safety_stock'] },
  { key: 'max_stock', col: 'max_stock', label: '최대재고', type: 'number', aliases: ['최대재고', 'max_stock'] },
  { key: 'expiry_date', col: 'expiry_date', label: '유효기한', type: 'date', aliases: ['유효기한', '유통기한', 'expiry_date'] },
  { key: 'lot_no', col: 'lot_no', label: 'LOT번호', type: 'string', aliases: ['lot번호', 'lot', '로트', 'lot_no'] },
  { key: 'storage_method', col: 'storage_method', label: '보관방법', type: 'vocab', vocab: 'storage_method', aliases: ['보관', '보관방법', 'storage_method'] },
  { key: 'storage_location', col: 'storage_location', label: '보관위치', type: 'string', aliases: ['보관위치', '위치', 'storage_location'] },
  { key: 'notes', col: 'notes', label: '비고', type: 'string', aliases: ['비고', '메모', 'notes'] },
  { key: 'is_high_alert', col: 'is_high_alert', label: '고위험', type: 'bool', owner: true, aliases: ['고위험', '고위험의약품', 'high_alert', 'is_high_alert'] },
]

const norm = s => String(s ?? '').toLowerCase().replace(/[\s()/·・\-_.]/g, '')
const TRUEY = new Set(['y', 'yes', 'true', '1', 'o', '고위험', '예', 'v', '✓'])
const isBlank = v => v == null || String(v).trim() === ''

/* 헤더 배열 → { fieldKey: 매칭된 헤더명 } 자동 인식(정확일치 우선, 부분포함 차선). */
export function autoMap(headers) {
  const map = {}
  const used = new Set()
  for (const fd of FIELD_DEFS) {
    let best = '', bestScore = 0
    for (const h of headers) {
      if (used.has(h)) continue
      const nh = norm(h); if (!nh) continue
      let score = 0
      for (const a of fd.aliases) {
        const na = norm(a)
        if (nh === na) { score = 3; break }
        if (nh.includes(na) || na.includes(nh)) score = Math.max(score, 2)
      }
      if (score > bestScore) { bestScore = score; best = h }
    }
    if (bestScore >= 2) { map[fd.key] = best; used.add(best) }
  }
  return map
}

/* 한 행 정규화.
   raw: { 헤더명: 셀문자열 }, mapping: { fieldKey: 헤더명 }, existing: 기존 drug 행 | null, isOwner: bool
   반환: { code, errors:[사유], fields:{ 컬럼: 값 } }  — fields 는 upsert 대상(빈셀 제외). */
export function normalizeDrugRow(raw, mapping, existing, isOwner) {
  const get = key => { const h = mapping[key]; return h == null ? '' : String(raw[h] ?? '') }
  const errors = []
  const fields = {}
  const code = get('drug_code').trim()                 // 약품코드는 문자열 강제(숫자/날짜 변환 없음)
  if (!code) errors.push('약품코드 없음')
  fields.drug_code = code
  const name = get('drug_name').trim()
  if (name) fields.drug_name = name
  else if (!existing) errors.push('약품명 없음(신규)')   // 갱신이면 기존 약품명 유지 가능
  for (const fd of FIELD_DEFS) {
    if (fd.key === 'drug_code' || fd.key === 'drug_name') continue
    const rv = get(fd.key)
    if (isBlank(rv)) continue                            // 빈 셀 → 기존값 미덮어씀
    const v = String(rv).trim()
    if (fd.type === 'vocab') {
      if (!VOCAB[fd.vocab].includes(v)) { errors.push(`${fd.label} 통제어휘 이탈: "${v}"`); continue }
      fields[fd.col] = v
    } else if (fd.type === 'number') {
      if (fd.owner && !isOwner) continue                 // 단가류: owner 아니면 무시(트리거 거부 회피)
      const n = Number(v.replace(/,/g, ''))
      if (!Number.isFinite(n)) { errors.push(`${fd.label} 숫자 아님: "${v}"`); continue }
      fields[fd.col] = n
    } else if (fd.type === 'bool') {
      if (!isOwner) continue                             // is_high_alert 는 owner 만
      fields[fd.col] = TRUEY.has(v.toLowerCase())
    } else {
      fields[fd.col] = v                                 // string / date(문자열 그대로)
    }
  }
  if (fields.narcotic_type !== undefined) fields.is_narcotic = fields.narcotic_type === '향정' || fields.narcotic_type === '마약'
  return { code, errors, fields }
}