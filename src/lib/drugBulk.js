/* 약품 대량 반영 파이프라인 — #register '엑셀 대량 등록' 탭이 사용.
   BulkUploadModal(D)의 apply()와 동치 로직을 공유(중복 구현 최소화). D 자체는 무변경.
   - 분류/정규화는 drugRules.normalizeDrugRow 단일 출처 사용(컬럼 매핑·owner 게이트·빈셀 무시 동일).
   - 신규=insert(청크 500)/기존=id 기준 update(제공 컬럼만 SET → 빈셀 미덮어씀).
   - 누락 컬럼 자동 제거 후 재시도(최대 4회) + console.warn 로깅(D와 동일). DELETE 없음. */
import { supabase } from './supabase'
import { normalizeDrugRow } from './drugRules'
import { saveWithFallback } from './saveWithFallback'

const CHUNK = 500, CONC = 10

/* rawRows(헤더명→셀문자열 객체 배열) + mapping(autoMap 결과) + 기존drug Map + isOwner
   → 분류행 [{ idx, code, name, status:'new'|'update'|'error', errors, fields, ex }]

   rowNums: rawRows 와 같은 길이의 **실제 엑셀 행 번호** 배열(선택).
   ★ idx 는 화면에 그대로 표시된다(App.jsx 의 대량등록 표). 넘기지 않으면 i+1 이 되는데,
     그 값은 두 번 어긋난다 — 헤더 1행이 보정되지 않고, 호출부가 빈 행을 걸러낸 뒤라
     그만큼 더 밀린다(실측: 실제 2·4·6행이 1·2·3행으로 표시). 결함 39.
   ★ rawRows 에 행 번호를 심지 않고 별도 배열로 받는다 — raw 는 normalizeDrugRow 가
     헤더명으로 읽는 자료라 헤더가 아닌 키를 섞지 않는다. */
export function classifyDrugRows(rawRows, mapping, existingMap, isOwner, rowNums) {
  return rawRows.map((raw, i) => {
    const codeCell = String((mapping.drug_code ? raw[mapping.drug_code] : '') || '').trim()
    const ex = (existingMap && existingMap.get(codeCell)) || null
    const { code, errors, fields } = normalizeDrugRow(raw, mapping, ex, isOwner)
    const status = errors.length ? 'error' : (ex ? 'update' : 'new')
    const idx = (rowNums && rowNums[i] != null) ? rowNums[i] : i + 1
    return { idx, code, name: fields.drug_name || (ex && ex.drug_name) || '', status, errors, fields, ex }
  })
}

/* 분류행 DB 반영 — D.apply()와 동일 파이프라인.
   반환: { success, fail:[{code,reason}], newCount, updateCount } */
export async function applyDrugRows(classified) {
  const targets = classified.filter(r => r.status !== 'error')
  const news = targets.filter(r => r.status === 'new')
  const upds = targets.filter(r => r.status === 'update')
  const fail = []
  /* ★ 폴백이 버린 컬럼 — 결과 요약에 「n건은 일부 항목 미반영」으로 올린다(조용한 실패 방지).
     partialCount 는 **행 수**다(청크 단위로 버리면 그 청크의 전 행이 해당된다). */
  let partialCount = 0
  const partialCols = []
  const notePartial = (rows, dropped) => {
    if (!dropped.length) return
    partialCount += rows
    for (const c of dropped) if (!partialCols.includes(c)) partialCols.push(c)
  }

  async function insertOne(obj) {
    const r = await saveWithFallback({ ...obj }, p => supabase.from('drugs').insert([p]), { retries: 4, label: '등록 대량 INSERT' })
    if (!r.error) notePartial(1, r.dropped)
    return r.error || null
  }
  async function insertChunk(chunk) {
    const r = await saveWithFallback(chunk.map(o => ({ ...o })), p => supabase.from('drugs').insert(p), { retries: 4, label: '등록 대량 INSERT chunk' })
    if (r.error) { for (const o of r.payload) { const e = await insertOne(o); if (e) fail.push({ code: o.drug_code, reason: e.message }) } }
    else notePartial(r.payload.length, r.dropped)
  }
  async function updateOne(r) {
    const patch = { ...r.fields }; delete patch.drug_code; delete patch.current_qty
    if (Object.keys(patch).length === 0) return null                 // 변경 없음
    const out = await saveWithFallback(patch, p => supabase.from('drugs').update(p).eq('id', r.ex.id), { retries: 4, label: '등록 대량 UPDATE' })
    if (!out.error) notePartial(1, out.dropped)
    return out.error || null
  }

  for (let s = 0; s < news.length; s += CHUNK) { const chunk = news.slice(s, s + CHUNK).map(r => ({ ...r.fields, current_qty: 0 })); await insertChunk(chunk) }
  for (let s = 0; s < upds.length; s += CONC) {
    const batch = upds.slice(s, s + CONC)
    await Promise.all(batch.map(async r => { const e = await updateOne(r); if (e) fail.push({ code: r.code, reason: e.message }) }))
  }
  // 재고(현재고 열)는 조정거래 RPC로 반영 — 실패는 fail에 합산(조용한 실패 방지)
  const _failCodes = new Set(fail.map(x => x.code))
  const _stockItems = targets.filter(r => r.fields.current_qty != null && String(r.fields.current_qty) !== '' && !_failCodes.has(r.code)).map(r => ({ drug_code: r.code, target_qty: Number(r.fields.current_qty) }))
  let _adjusted = 0
  if (_stockItems.length) {
    const { data: _adjRes, error: _adjErr } = await supabase.rpc('bulk_stock_adjust', { p_items: _stockItems, p_date: new Date().toISOString().split('T')[0], p_reason: '엑셀 재고 조정' })
    if (_adjErr) fail.push({ code: '(재고조정)', reason: _adjErr.message })
    else if (_adjRes && _adjRes.ok === false) (_adjRes.failed || []).forEach(f => fail.push({ code: f.drug_code, reason: '재고조정: ' + f.reason }))
    else if (_adjRes) _adjusted = _adjRes.adjusted || 0
  }
  return { success: news.length + upds.length - fail.length, adjusted: _adjusted, fail, newCount: news.length, updateCount: upds.length, partialCount, partialCols }
}