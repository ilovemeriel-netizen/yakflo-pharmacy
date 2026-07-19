/* 약품 대량 반영 파이프라인 — #register '엑셀 대량 등록' 탭이 사용.
   BulkUploadModal(D)의 apply()와 동치 로직을 공유(중복 구현 최소화). D 자체는 무변경.
   - 분류/정규화는 drugRules.normalizeDrugRow 단일 출처 사용(컬럼 매핑·owner 게이트·빈셀 무시 동일).
   - 신규=insert(청크 500)/기존=id 기준 update(제공 컬럼만 SET → 빈셀 미덮어씀).
   - 누락 컬럼 자동 제거 후 재시도(최대 4회) + console.warn 로깅(D와 동일). DELETE 없음. */
import { supabase } from './supabase'
import { normalizeDrugRow } from './drugRules'

const CHUNK = 500, CONC = 10

/* rawRows(헤더명→셀문자열 객체 배열) + mapping(autoMap 결과) + 기존drug Map + isOwner
   → 분류행 [{ idx, code, name, status:'new'|'update'|'error', errors, fields, ex }] */
export function classifyDrugRows(rawRows, mapping, existingMap, isOwner) {
  return rawRows.map((raw, i) => {
    const codeCell = String((mapping.drug_code ? raw[mapping.drug_code] : '') || '').trim()
    const ex = (existingMap && existingMap.get(codeCell)) || null
    const { code, errors, fields } = normalizeDrugRow(raw, mapping, ex, isOwner)
    const status = errors.length ? 'error' : (ex ? 'update' : 'new')
    return { idx: i + 1, code, name: fields.drug_name || (ex && ex.drug_name) || '', status, errors, fields, ex }
  })
}

/* 분류행 DB 반영 — D.apply()와 동일 파이프라인.
   반환: { success, fail:[{code,reason}], newCount, updateCount } */
export async function applyDrugRows(classified) {
  const targets = classified.filter(r => r.status !== 'error')
  const news = targets.filter(r => r.status === 'new')
  const upds = targets.filter(r => r.status === 'update')
  const fail = []

  async function insertOne(obj) {
    let o = { ...obj }; let e = (await supabase.from('drugs').insert([o])).error
    for (let rt = 0; rt < 4 && e && e.message && e.message.includes('column'); rt++) {
      const m = e.message.match(/'([^']+)' column/); if (!m) break
      console.warn('[등록 대량 INSERT] 미존재 컬럼 자동 제거:', m[1], '/ 원인:', e.message)
      delete o[m[1]]; e = (await supabase.from('drugs').insert([o])).error
    }
    return e || null
  }
  async function insertChunk(chunk) {
    let c = chunk.map(o => ({ ...o }))
    let res = await supabase.from('drugs').insert(c)
    for (let rt = 0; rt < 4 && res.error && res.error.message && res.error.message.includes('column'); rt++) {
      const m = res.error.message.match(/'([^']+)' column/); if (!m) break
      console.warn('[등록 대량 INSERT chunk] 미존재 컬럼 자동 제거:', m[1], '/ 원인:', res.error.message)
      c = c.map(o => { const x = { ...o }; delete x[m[1]]; return x }); res = await supabase.from('drugs').insert(c)
    }
    if (res.error) { for (const o of c) { const e = await insertOne(o); if (e) fail.push({ code: o.drug_code, reason: e.message }) } }
  }
  async function updateOne(r) {
    let patch = { ...r.fields }; delete patch.drug_code
    if (Object.keys(patch).length === 0) return null                 // 변경 없음
    let e = (await supabase.from('drugs').update(patch).eq('id', r.ex.id)).error
    for (let rt = 0; rt < 4 && e && e.message && e.message.includes('column'); rt++) {
      const m = e.message.match(/'([^']+)' column/); if (!m) break
      console.warn('[등록 대량 UPDATE] 미존재 컬럼 자동 제거:', m[1], '/ 원인:', e.message)
      delete patch[m[1]]; e = (await supabase.from('drugs').update(patch).eq('id', r.ex.id)).error
    }
    return e || null
  }

  for (let s = 0; s < news.length; s += CHUNK) { const chunk = news.slice(s, s + CHUNK).map(r => ({ ...r.fields })); await insertChunk(chunk) }
  for (let s = 0; s < upds.length; s += CONC) {
    const batch = upds.slice(s, s + CONC)
    await Promise.all(batch.map(async r => { const e = await updateOne(r); if (e) fail.push({ code: r.code, reason: e.message }) }))
  }
  return { success: news.length + upds.length - fail.length, fail, newCount: news.length, updateCount: upds.length }
}