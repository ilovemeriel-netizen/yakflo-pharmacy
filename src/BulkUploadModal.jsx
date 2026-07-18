/* 약플로 · 약품 대량 업로드 모달 (약품목록 전용).
   4단계: ① 파일 선택 → ② 컬럼 매핑 → ③ 미리보기(신규/갱신/오류) → ④ 확인 후 반영.
   - SheetJS 로 브라우저에서 파싱(서버 전송 없음). 모든 셀 문자열(raw:false).
   - 검증/정규화는 lib/drugRules 재사용(중복 구현 없음).
   - 약품코드 기준 upsert(onConflict). DELETE 없음. 엑셀에 없는 기존 행은 불변.
   - 청크 500행. 미리보기 확인 전 DB 쓰기 없음. 실패 목록 CSV 다운로드.
   - 팔레트: 부모가 넘긴 t + #D9342B 만 사용(신규 색상 없음). */
import { useState, useMemo } from 'react'
import { supabase } from './lib/supabase'
import { FIELD_DEFS, autoMap, normalizeDrugRow } from './lib/drugRules'

const CHUNK = 500
const ALERT = '#D9342B'

export default function BulkUploadModal({ t, isOwner, drugs, onClose, onReload }) {
  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [err, setErr] = useState('')
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)

  const existing = useMemo(() => {
    const m = new Map(); (drugs || []).forEach(d => m.set(String(d.drug_code), d)); return m
  }, [drugs])

  async function onFile(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = ''
    if (!file) return
    setErr(''); setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })  // 문자열 강제
      if (!aoa.length) { setErr('빈 파일입니다.'); return }
      const hdrs = (aoa[0] || []).map(h => String(h).trim()).filter(Boolean)
      if (!hdrs.length) { setErr('헤더 행을 찾을 수 없습니다.'); return }
      const rows = aoa.slice(1)
        .filter(r => r.some(c => String(c).trim() !== ''))
        .map(r => { const o = {}; hdrs.forEach((h, i) => { o[h] = String(r[i] == null ? '' : r[i]) }); return o })
      if (!rows.length) { setErr('데이터 행이 없습니다.'); return }
      setHeaders(hdrs); setRawRows(rows); setMapping(autoMap(hdrs)); setStep(2)
    } catch (ex) { setErr('파일 읽기 오류: ' + (ex && ex.message)) }
  }

  /* 미리보기 분류(신규/갱신/오류) — DB 쓰기 아님, 화면 계산만 */
  const classified = useMemo(() => rawRows.map((raw, i) => {
    const codeCell = String((mapping.drug_code ? raw[mapping.drug_code] : '') || '').trim()
    const ex = existing.get(codeCell) || null
    const { code, errors, fields } = normalizeDrugRow(raw, mapping, ex, isOwner)
    const status = errors.length ? 'error' : (ex ? 'update' : 'new')
    return { i, code, name: fields.drug_name || (ex && ex.drug_name) || '', status, errors, fields, ex }
  }), [rawRows, mapping, existing, isOwner])

  const counts = useMemo(() => ({
    new: classified.filter(r => r.status === 'new').length,
    update: classified.filter(r => r.status === 'update').length,
    error: classified.filter(r => r.status === 'error').length,
  }), [classified])

  async function apply() {
    setApplying(true); setProgress(0)
    const targets = classified.filter(r => r.status !== 'error')
    const news = targets.filter(r => r.status === 'new')
    const upds = targets.filter(r => r.status === 'update')
    const total = news.length + upds.length
    const fail = []
    let done = 0

    /* drugs 유니크 인덱스는 (tenant_id, drug_code) 복합 → onConflict:'drug_code' upsert 불가.
       앱 기존 패턴대로 신규=insert(청크), 갱신=id 기준 update(제공 컬럼만 SET=빈셀 미덮어씀).
       누락 컬럼은 자동 제거 후 재시도. 청크/행 단위로 실패 행만 정확히 분리한다. */
    async function insertOne(obj) {
      let o = { ...obj }; let e = (await supabase.from('drugs').insert([o])).error
      for (let rt = 0; rt < 4 && e && e.message && e.message.includes('column'); rt++) { const m = e.message.match(/'([^']+)' column/); if (!m) break; delete o[m[1]]; e = (await supabase.from('drugs').insert([o])).error }
      return e || null
    }
    async function insertChunk(chunk) {
      let c = chunk.map(o => ({ ...o }))
      let res = await supabase.from('drugs').insert(c)
      for (let rt = 0; rt < 4 && res.error && res.error.message && res.error.message.includes('column'); rt++) {
        const m = res.error.message.match(/'([^']+)' column/); if (!m) break
        c = c.map(o => { const x = { ...o }; delete x[m[1]]; return x }); res = await supabase.from('drugs').insert(c)
      }
      if (res.error) { for (const o of c) { const e = await insertOne(o); if (e) fail.push({ code: o.drug_code, reason: e.message }) } }
    }
    async function updateOne(r) {
      let patch = { ...r.fields }; delete patch.drug_code
      if (Object.keys(patch).length === 0) return null                 // 변경 없음
      let e = (await supabase.from('drugs').update(patch).eq('id', r.ex.id)).error
      for (let rt = 0; rt < 4 && e && e.message && e.message.includes('column'); rt++) { const m = e.message.match(/'([^']+)' column/); if (!m) break; delete patch[m[1]]; e = (await supabase.from('drugs').update(patch).eq('id', r.ex.id)).error }
      return e || null
    }

    for (let s = 0; s < news.length; s += CHUNK) { const chunk = news.slice(s, s + CHUNK).map(r => ({ ...r.fields })); await insertChunk(chunk); done += chunk.length; setProgress(done) }
    const CONC = 10                                                    // 갱신 동시성 제한
    for (let s = 0; s < upds.length; s += CONC) {
      const batch = upds.slice(s, s + CONC)
      await Promise.all(batch.map(async r => { const e = await updateOne(r); if (e) fail.push({ code: r.code, reason: e.message }) }))
      done += batch.length; setProgress(done)
    }

    setResult({ success: total - fail.length, fail, errorRows: classified.filter(r => r.status === 'error') })
    setApplying(false); setStep(4)
    onReload && onReload()
  }

  function downloadFailCsv() {
    if (!result) return
    const rows = [['구분', '약품코드', '사유']]
    result.errorRows.forEach(r => rows.push(['검증오류', r.code, r.errors.join(' / ')]))
    result.fail.forEach(f => rows.push(['반영실패', f.code, f.reason]))
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = '약품업로드_실패목록.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  /* ── 공용 스타일(부모 테마 재사용) ── */
  const ip = { width: '100%', padding: '8px 10px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }
  const btn = (fill, disabled) => ({ padding: '9px 18px', borderRadius: 8, border: `1px solid ${t.accent}`, background: disabled ? t.textL : (fill ? t.accent : 'transparent'), color: fill ? '#fff' : t.accent, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' })
  const badge = st => { const c = st === 'new' ? t.green : st === 'update' ? t.blue : ALERT; const lbl = st === 'new' ? '신규' : st === 'update' ? '갱신' : '오류'; return <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: c + '1A', color: c, border: '1px solid ' + c + '40' }}>{lbl}</span> }
  const stepName = ['파일 선택', '컬럼 매핑', '미리보기', '결과']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: t.cardSolid, borderRadius: 16, width: '100%', maxWidth: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column', border: `1px solid ${t.border}`, boxShadow: t.shadowH }} onClick={e => e.stopPropagation()}>
        {/* 헤더 + 단계 표시 */}
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>약품 대량 업로드</div>
            <div style={{ display: 'flex', gap: 6 }}>{stepName.map((s, i) => <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: step === i + 1 ? t.accent : t.bg, color: step === i + 1 ? '#fff' : t.textL, border: '1px solid ' + (step === i + 1 ? t.accent : t.border) }}>{i + 1}. {s}</span>)}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', cursor: 'pointer', fontSize: 15, color: t.textM }}>✕</button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {err && <div style={{ background: t.redL, color: t.red, borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, fontWeight: 600 }}>{err}</div>}

          {/* ── 단계 1: 파일 선택 ── */}
          {step === 1 && <div>
            <label style={{ display: 'block', border: `2px dashed ${t.border}`, borderRadius: 12, padding: '38px 20px', textAlign: 'center', cursor: 'pointer', background: t.bg }}>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: 'none' }} />
              <div style={{ fontSize: 30, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 4 }}>엑셀 / CSV 파일 선택</div>
              <div style={{ fontSize: 11, color: t.textL }}>.xlsx · .xls · .csv · 브라우저에서만 파싱(서버 전송 없음)</div>
            </label>
            <div style={{ marginTop: 14, fontSize: 11, color: t.textM, lineHeight: 1.7 }}>
              · 첫 행은 <b>헤더(열 이름)</b> 여야 합니다. 약품코드·약품명·구분은 필수입니다.<br />
              · 모든 값은 문자열로 읽습니다(숫자·날짜 자동 변환 없음). 빈 칸은 기존 값을 유지합니다.<br />
              · 통제 어휘(구분/상태/급여/마약구분/복합·단일/보관)를 벗어난 값이 있는 행은 오류로 분류됩니다.{!isOwner && <><br />· 현재 계정은 owner 가 아니어서 <b>단가·고위험</b> 열은 무시됩니다.</>}
            </div>
          </div>}

          {/* ── 단계 2: 컬럼 매핑 ── */}
          {step === 2 && <div>
            <div style={{ fontSize: 12, color: t.textM, marginBottom: 10 }}>파일 <b>{fileName}</b> · {rawRows.length}행 · 헤더명을 자동 인식했습니다. 필요 시 조정하세요.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {FIELD_DEFS.map(fd => {
                const skip = fd.owner && !isOwner
                return <div key={fd.key} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: skip ? 0.5 : 1 }}>
                  <div style={{ width: 96, fontSize: 11, fontWeight: 600, color: fd.required ? t.accent : t.textM }}>{fd.label}{fd.required ? ' *' : ''}</div>
                  <select value={mapping[fd.key] || ''} disabled={skip} onChange={e => setMapping(m => ({ ...m, [fd.key]: e.target.value }))} style={{ ...ip, flex: 1 }}>
                    <option value="">(매핑 안 함)</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              })}
            </div>
            {(!mapping.drug_code || !mapping.drug_name || !mapping.category) && <div style={{ marginTop: 12, fontSize: 11, color: ALERT, fontWeight: 600 }}>⚠ 필수 항목(약품코드·약품명·구분)을 모두 매핑해야 미리보기로 진행할 수 있습니다.</div>}
          </div>}

          {/* ── 단계 3: 미리보기 ── */}
          {step === 3 && <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              {[['신규', counts.new, t.green], ['갱신', counts.update, t.blue], ['오류', counts.error, ALERT]].map(([l, n, c]) =>
                <div key={l} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: c + '12', border: '1px solid ' + c + '33' }}><div style={{ fontSize: 10, color: t.textM, fontWeight: 600 }}>{l}</div><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{n}</div></div>)}
            </div>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr style={{ background: t.bg }}>{['상태', '약품코드', '약품명', '사유'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: t.textM, fontWeight: 700, position: 'sticky', top: 0, background: t.bg, borderBottom: `1px solid ${t.border}` }}>{h}</th>)}</tr></thead>
                  <tbody>{classified.map(r => <tr key={r.i} style={{ borderBottom: `1px solid ${t.border}`, background: r.status === 'error' ? ALERT + '0A' : '' }}>
                    <td style={{ padding: '7px 10px' }}>{badge(r.status)}</td>
                    <td style={{ padding: '7px 10px', color: t.text, fontFamily: 'monospace' }}>{r.code || '-'}</td>
                    <td style={{ padding: '7px 10px', color: t.textM, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '-'}</td>
                    <td style={{ padding: '7px 10px', color: r.errors.length ? ALERT : t.textL }}>{r.errors.join(' / ') || (r.status === 'update' ? '기존 행 갱신' : '신규 등록')}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: t.textM }}>오류 {counts.error}건은 반영에서 제외됩니다. 반영 대상은 <b style={{ color: t.accent }}>{counts.new + counts.update}건</b>(신규 {counts.new} · 갱신 {counts.update}) 입니다. DELETE 는 수행하지 않습니다.</div>
            {applying && <div style={{ marginTop: 10, fontSize: 12, color: t.accent, fontWeight: 600 }}>반영 중… {progress}/{counts.new + counts.update} (청크 {CHUNK}행)</div>}
          </div>}

          {/* ── 단계 4: 결과 ── */}
          {step === 4 && result && <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, padding: '14px 16px', borderRadius: 10, background: t.greenL, border: `1px solid ${t.green}33` }}><div style={{ fontSize: 11, color: t.textM, fontWeight: 600 }}>성공(반영)</div><div style={{ fontSize: 24, fontWeight: 800, color: t.green }}>{result.success}</div></div>
              <div style={{ flex: 1, padding: '14px 16px', borderRadius: 10, background: ALERT + '12', border: `1px solid ${ALERT}33` }}><div style={{ fontSize: 11, color: t.textM, fontWeight: 600 }}>실패/제외</div><div style={{ fontSize: 24, fontWeight: 800, color: ALERT }}>{result.fail.length + result.errorRows.length}</div></div>
            </div>
            {(result.fail.length + result.errorRows.length) > 0 ? <>
              <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr style={{ background: t.bg }}>{['구분', '약품코드', '사유'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: t.textM, fontWeight: 700, position: 'sticky', top: 0, background: t.bg, borderBottom: `1px solid ${t.border}` }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {result.errorRows.map((r, i) => <tr key={'e' + i} style={{ borderBottom: `1px solid ${t.border}` }}><td style={{ padding: '7px 10px', color: t.textM }}>검증오류</td><td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{r.code || '-'}</td><td style={{ padding: '7px 10px', color: ALERT }}>{r.errors.join(' / ')}</td></tr>)}
                    {result.fail.map((f, i) => <tr key={'f' + i} style={{ borderBottom: `1px solid ${t.border}` }}><td style={{ padding: '7px 10px', color: t.textM }}>반영실패</td><td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{f.code || '-'}</td><td style={{ padding: '7px 10px', color: ALERT }}>{f.reason}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <button onClick={downloadFailCsv} style={btn(false)}>실패 목록 CSV 다운로드</button>
            </> : <div style={{ fontSize: 13, color: t.green, fontWeight: 600 }}>✅ 모든 행이 정상 반영되었습니다.</div>}
          </div>}
        </div>

        {/* 푸터 버튼 */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={step === 2 ? () => setStep(1) : step === 3 ? () => setStep(2) : null} disabled={step === 1 || step === 4 || applying} style={{ ...btn(false), visibility: (step === 2 || step === 3) && !applying ? 'visible' : 'hidden' }}>← 이전</button>
          {step === 1 && <button onClick={onClose} style={btn(false)}>취소</button>}
          {step === 2 && <button onClick={() => setStep(3)} disabled={!mapping.drug_code || !mapping.drug_name || !mapping.category} style={btn(true, !mapping.drug_code || !mapping.drug_name || !mapping.category)}>미리보기 →</button>}
          {step === 3 && <button onClick={apply} disabled={applying || (counts.new + counts.update) === 0} style={btn(true, applying || (counts.new + counts.update) === 0)}>{applying ? '반영 중…' : `${counts.new + counts.update}건 반영`}</button>}
          {step === 4 && <button onClick={onClose} style={btn(true)}>닫기</button>}
        </div>
      </div>
    </div>
  )
}