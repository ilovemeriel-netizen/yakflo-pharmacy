/* 약플로 · 월별 스냅샷 대량 업로드 모달 (보고서 월간 탭 · owner 전용).
   4단계: ① 파일 선택 → ② 컬럼 매핑 → ③ 미리보기(대상 연월·신규/갱신/오류) → ④ 확인 후 반영.
   - BulkUploadModal 구조·스타일 재사용(신규 색상·신규 모달 스타일 없음). 대상 테이블은 monthly_snapshots.
   - SheetJS 로 브라우저에서 파싱(서버 전송 없음). 모든 셀 문자열(raw:false).
   - 반영: (tenant_id, drug_code, snap_year, snap_month) 기준 upsert 의미.
     · 유니크 인덱스에 tenant_id가 포함되고 tenant_id는 트리거가 채우므로(클라 미지정),
       앱 기존 패턴(BulkUploadModal)과 동일하게 신규=insert / 갱신=id 기준 update 로 구현.
     · 빈 셀은 patch 에서 제외 → 기존 값 유지. DELETE 없음. 파일에 없는 행 불변.
     · drug_code 문자열 강제(숫자·날짜 변환 금지). snap_year/snap_month 정수·범위 검증.
     · tenant_id 직접 미기입(트리거 set_tenant_id_from_user 에 위임).
   - 미리보기 확인 전 DB 쓰기 없음. 실패 목록 CSV 다운로드. */
import { useState, useMemo } from 'react'
import { supabase } from './lib/supabase'

const CHUNK = 500
const CONC = 10
const ALERT = '#D9342B'

/* 매핑 대상 컬럼 — drug_code/snap_year/snap_month 필수, 나머지는 수치(빈 셀=유지) */
const FIELDS = [
  { key: 'drug_code', label: '약품코드', required: true, kind: 'code' },
  { key: 'snap_year', label: '연도(snap_year)', required: true, kind: 'year' },
  { key: 'snap_month', label: '월(snap_month)', required: true, kind: 'month' },
  { key: 'opening_qty', label: '기초수량', kind: 'num' },
  { key: 'opening_amount', label: '기초금액', kind: 'num' },
  { key: 'total_in_qty', label: '입고수량', kind: 'num' },
  { key: 'total_in_amount', label: '입고금액', kind: 'num' },
  { key: 'total_out_qty', label: '출고(사용)수량', kind: 'num' },
  { key: 'total_out_amount', label: '출고(사용)금액', kind: 'num' },
  { key: 'total_disp_qty', label: '폐기수량', kind: 'num' },
  { key: 'total_ret_qty', label: '반품수량', kind: 'num' },
  { key: 'closing_qty', label: '기말수량', kind: 'num' },
  { key: 'closing_amount', label: '기말금액', kind: 'num' },
]

const norm = (s) => String(s).replace(/[\s_·/()]/g, '').toLowerCase()
const ALIASES = {
  drug_code: ['drugcode', '약품코드', '코드', 'code'],
  snap_year: ['snapyear', '연도', '년', 'year'],
  snap_month: ['snapmonth', '월', 'month'],
  opening_qty: ['openingqty', '기초수량', '기초재고수량', '전월재고수량'],
  opening_amount: ['openingamount', '기초금액', '기초재고금액', '전월재고금액'],
  total_in_qty: ['totalinqty', '입고수량', '입고량'],
  total_in_amount: ['totalinamount', '입고금액'],
  total_out_qty: ['totaloutqty', '출고수량', '사용수량', '사용량'],
  total_out_amount: ['totaloutamount', '출고금액', '사용금액'],
  total_disp_qty: ['totaldispqty', '폐기수량', '폐기량'],
  total_ret_qty: ['totalretqty', '반품수량', '반품량'],
  closing_qty: ['closingqty', '기말수량', '기말재고수량', '현재고'],
  closing_amount: ['closingamount', '기말금액', '기말재고금액'],
}
function autoMap(headers) {
  const map = {}
  FIELDS.forEach((f) => {
    const cands = [f.key, f.label, ...(ALIASES[f.key] || [])].map(norm)
    const hit = headers.find((h) => cands.includes(norm(h)))
    if (hit) map[f.key] = hit
  })
  return map
}

/* 한 행 정규화·검증 — 쓰기 아님(화면 계산). fields=실제 반영 대상(빈 셀 제외) */
function normalizeRow(raw, mapping) {
  const get = (k) => { const h = mapping[k]; return h ? String(raw[h] == null ? '' : raw[h]).trim() : '' }
  const errors = []
  const code = get('drug_code')                 // 문자열 강제 — 숫자·날짜 변환 금지
  if (!code) errors.push('약품코드 없음')
  const yStr = get('snap_year'), mStr = get('snap_month')
  const y = Number(yStr), m = Number(mStr)
  const yOk = yStr !== '' && Number.isInteger(y) && y >= 2000 && y <= 2100
  const mOk = mStr !== '' && Number.isInteger(m) && m >= 1 && m <= 12
  if (!yOk) errors.push('연도 오류(2000~2100 정수)')
  if (!mOk) errors.push('월 오류(1~12 정수)')

  const fields = {}
  if (code) fields.drug_code = code
  if (yOk) fields.snap_year = y
  if (mOk) fields.snap_month = m
  for (const f of FIELDS) {
    if (f.kind !== 'num') continue
    const s = get(f.key)
    if (s === '') continue                       // 빈 셀 → 기존 값 유지(제외)
    const n = Number(s.replace(/,/g, ''))
    if (!Number.isFinite(n)) { errors.push(`${f.label} 숫자 아님`); continue }
    fields[f.key] = n
  }
  const key = (code && yOk && mOk) ? `${code}|${y}|${m}` : null
  return { code, y: yOk ? y : null, m: mOk ? m : null, key, errors, fields }
}

export default function SnapshotUploadModal({ t, isOwner, onClose, onReload }) {
  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [existingMap, setExistingMap] = useState(new Map())
  const [err, setErr] = useState('')
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)

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
      const hdrs = (aoa[0] || []).map((h) => String(h).trim()).filter(Boolean)
      if (!hdrs.length) { setErr('헤더 행을 찾을 수 없습니다.'); return }
      const rows = aoa.slice(1)
        .filter((r) => r.some((c) => String(c).trim() !== ''))
        .map((r) => { const o = {}; hdrs.forEach((h, i) => { o[h] = String(r[i] == null ? '' : r[i]) }); return o })
      if (!rows.length) { setErr('데이터 행이 없습니다.'); return }
      setHeaders(hdrs); setRawRows(rows); setMapping(autoMap(hdrs)); setStep(2)
    } catch (ex) { setErr('파일 읽기 오류: ' + (ex && ex.message)) }
  }

  const mapReady = mapping.drug_code && mapping.snap_year && mapping.snap_month

  /* 미리보기용 정규화 — 화면 계산만 */
  const normalized = useMemo(() => rawRows.map((raw, i) => ({ i, ...normalizeRow(raw, mapping) })), [rawRows, mapping])

  /* 매핑→미리보기 진입 시 대상 연월의 기존 스냅샷 조회(신규/갱신 분류용, 읽기 전용) */
  async function goPreview() {
    setErr('')
    const pairs = [...new Set(normalized.filter((r) => !r.errors.length).map((r) => `${r.y}-${r.m}`))]
    try {
      const map = new Map()
      for (const p of pairs) {
        const [y, m] = p.split('-').map(Number)
        const { data, error } = await supabase.from('monthly_snapshots')
          .select('id,drug_code,snap_year,snap_month').eq('snap_year', y).eq('snap_month', m)
        if (error) throw error
        ;(data || []).forEach((s) => map.set(`${String(s.drug_code)}|${s.snap_year}|${s.snap_month}`, s))
      }
      setExistingMap(map); setStep(3)
    } catch (ex) { setErr('기존 스냅샷 조회 오류: ' + (ex && ex.message)) }
  }

  const classified = useMemo(() => normalized.map((r) => {
    const ex = r.key ? existingMap.get(r.key) || null : null
    const status = r.errors.length ? 'error' : (ex ? 'update' : 'new')
    return { ...r, ex, status }
  }), [normalized, existingMap])

  const counts = useMemo(() => ({
    new: classified.filter((r) => r.status === 'new').length,
    update: classified.filter((r) => r.status === 'update').length,
    error: classified.filter((r) => r.status === 'error').length,
  }), [classified])

  const targetYm = useMemo(() =>
    [...new Set(classified.filter((r) => r.status !== 'error').map((r) => `${r.y}년 ${r.m}월`))], [classified])

  async function apply() {
    if (!isOwner) { setErr('owner(마스터)만 업로드할 수 있습니다.'); return }  // 실행부 이중 확인
    setApplying(true); setProgress(0)
    const targets = classified.filter((r) => r.status !== 'error')
    const news = targets.filter((r) => r.status === 'new')
    const upds = targets.filter((r) => r.status === 'update')
    const total = news.length + upds.length
    const fail = []
    let done = 0

    /* 신규 = insert(청크, tenant_id 미지정 → 트리거). 실패 시 행 단위로 사유 분리. */
    async function insertOne(obj) {
      const e = (await supabase.from('monthly_snapshots').insert([obj])).error
      return e || null
    }
    async function insertChunk(chunk) {
      const res = await supabase.from('monthly_snapshots').insert(chunk)
      if (res.error) { for (const o of chunk) { const e = await insertOne(o); if (e) fail.push({ code: o.drug_code, ym: `${o.snap_year}-${o.snap_month}`, reason: e.message }) } }
    }
    /* 갱신 = id 기준 update. patch 는 빈 셀 제외분(제공된 값)에서 키 컬럼 제거 → 빈 셀 미덮어씀. DELETE 없음. */
    async function updateOne(r) {
      const patch = { ...r.fields }; delete patch.drug_code; delete patch.snap_year; delete patch.snap_month
      if (Object.keys(patch).length === 0) return null
      return (await supabase.from('monthly_snapshots').update(patch).eq('id', r.ex.id)).error || null
    }

    for (let s = 0; s < news.length; s += CHUNK) {
      const chunk = news.slice(s, s + CHUNK).map((r) => ({ ...r.fields }))   // tenant_id 없음(트리거 위임)
      await insertChunk(chunk); done += chunk.length; setProgress(done)
    }
    for (let s = 0; s < upds.length; s += CONC) {
      const batch = upds.slice(s, s + CONC)
      await Promise.all(batch.map(async (r) => { const e = await updateOne(r); if (e) fail.push({ code: r.code, ym: `${r.y}-${r.m}`, reason: e.message }) }))
      done += batch.length; setProgress(done)
    }

    setResult({ success: total - fail.length, fail, errorRows: classified.filter((r) => r.status === 'error') })
    setApplying(false); setStep(4)
    onReload && onReload()
  }

  function downloadFailCsv() {
    if (!result) return
    const rows = [['구분', '약품코드', '연월', '사유']]
    result.errorRows.forEach((r) => rows.push(['검증오류', r.code, r.y && r.m ? `${r.y}-${r.m}` : '-', r.errors.join(' / ')]))
    result.fail.forEach((f) => rows.push(['반영실패', f.code, f.ym || '-', f.reason]))
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = '스냅샷업로드_실패목록.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  /* ── 공용 스타일(부모 테마 재사용, BulkUploadModal 동일 패턴) ── */
  const ip = { width: '100%', padding: '8px 10px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }
  const btn = (fill, disabled) => ({ padding: '9px 18px', borderRadius: 8, border: `1px solid ${t.accent}`, background: disabled ? t.textL : (fill ? t.accent : 'transparent'), color: fill ? '#fff' : t.accent, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' })
  const badge = (st) => { const c = st === 'new' ? t.green : st === 'update' ? t.blue : ALERT; const lbl = st === 'new' ? '신규' : st === 'update' ? '갱신' : '오류'; return <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: c + '1A', color: c, border: '1px solid ' + c + '40' }}>{lbl}</span> }
  const stepName = ['파일 선택', '컬럼 매핑', '미리보기', '결과']

  if (!isOwner) return null   // owner 아니면 렌더 자체 안 함

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: t.cardSolid, borderRadius: 16, width: '100%', maxWidth: 880, maxHeight: '92vh', display: 'flex', flexDirection: 'column', border: `1px solid ${t.border}`, boxShadow: t.shadowH }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>월별 스냅샷 업로드</div>
            <div style={{ display: 'flex', gap: 6 }}>{stepName.map((s, i) => <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: step === i + 1 ? t.accent : t.bg, color: step === i + 1 ? '#fff' : t.textL, border: '1px solid ' + (step === i + 1 ? t.accent : t.border) }}>{i + 1}. {s}</span>)}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', cursor: 'pointer', fontSize: 15, color: t.textM }}>✕</button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {err && <div style={{ background: t.redL, color: t.red, borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, fontWeight: 600 }}>{err}</div>}

          {/* 단계 1: 파일 선택 */}
          {step === 1 && <div>
            <label style={{ display: 'block', border: `2px dashed ${t.border}`, borderRadius: 12, padding: '38px 20px', textAlign: 'center', cursor: 'pointer', background: t.bg }}>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: 'none' }} />
              <div style={{ fontSize: 30, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 4 }}>스냅샷 엑셀 / CSV 파일 선택</div>
              <div style={{ fontSize: 11, color: t.textL }}>.xlsx · .xls · .csv · 브라우저에서만 파싱(서버 전송 없음)</div>
            </label>
            <div style={{ marginTop: 14, fontSize: 11, color: t.textM, lineHeight: 1.7 }}>
              · 첫 행은 <b>헤더</b>. 필수: <b>약품코드 · 연도(snap_year) · 월(snap_month)</b>.<br />
              · 모든 값 문자열로 읽음(숫자·날짜 자동 변환 없음). <b>빈 셀은 기존 값을 유지</b>합니다.<br />
              · 대상 테이블은 <b>monthly_snapshots</b> · (약품코드+연월) 기준 upsert · <b>DELETE 없음</b>(파일에 없는 행 불변).<br />
              · tenant_id 는 입력하지 않습니다(자동 태깅).
            </div>
          </div>}

          {/* 단계 2: 컬럼 매핑 */}
          {step === 2 && <div>
            <div style={{ fontSize: 12, color: t.textM, marginBottom: 10 }}>파일 <b>{fileName}</b> · {rawRows.length}행 · 헤더 자동 인식. 필요 시 조정하세요.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {FIELDS.map((fd) => <div key={fd.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 118, fontSize: 11, fontWeight: 600, color: fd.required ? t.accent : t.textM }}>{fd.label}{fd.required ? ' *' : ''}</div>
                <select value={mapping[fd.key] || ''} onChange={(e) => setMapping((m) => ({ ...m, [fd.key]: e.target.value }))} style={{ ...ip, flex: 1 }}>
                  <option value="">(매핑 안 함)</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>)}
            </div>
            {!mapReady && <div style={{ marginTop: 12, fontSize: 11, color: ALERT, fontWeight: 600 }}>⚠ 필수 항목(약품코드·연도·월)을 모두 매핑해야 미리보기로 진행할 수 있습니다.</div>}
          </div>}

          {/* 단계 3: 미리보기 */}
          {step === 3 && <div>
            <div style={{ fontSize: 12, color: t.textM, marginBottom: 10 }}>대상 연월: <b style={{ color: t.text }}>{targetYm.join(', ') || '-'}</b> · 총 {rawRows.length}행</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              {[['신규', counts.new, t.green], ['갱신', counts.update, t.blue], ['오류', counts.error, ALERT]].map(([l, n, c]) =>
                <div key={l} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: c + '12', border: '1px solid ' + c + '33' }}><div style={{ fontSize: 10, color: t.textM, fontWeight: 600 }}>{l}</div><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{n}</div></div>)}
            </div>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr style={{ background: t.bg }}>{['상태', '약품코드', '연월', '사유'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: t.textM, fontWeight: 700, position: 'sticky', top: 0, background: t.bg, borderBottom: `1px solid ${t.border}` }}>{h}</th>)}</tr></thead>
                  <tbody>{classified.map((r) => <tr key={r.i} style={{ borderBottom: `1px solid ${t.border}`, background: r.status === 'error' ? ALERT + '0A' : '' }}>
                    <td style={{ padding: '7px 10px' }}>{badge(r.status)}</td>
                    <td style={{ padding: '7px 10px', color: t.text, fontFamily: 'monospace' }}>{r.code || '-'}</td>
                    <td style={{ padding: '7px 10px', color: t.textM }}>{r.y && r.m ? `${r.y}-${r.m}` : '-'}</td>
                    <td style={{ padding: '7px 10px', color: r.errors.length ? ALERT : t.textL }}>{r.errors.join(' / ') || (r.status === 'update' ? '기존 행 갱신' : '신규 등록')}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: t.textM }}>오류 {counts.error}건 제외. 반영 대상 <b style={{ color: t.accent }}>{counts.new + counts.update}건</b>(신규 {counts.new} · 갱신 {counts.update}). 빈 셀은 기존 값 유지 · DELETE 없음.</div>
            {applying && <div style={{ marginTop: 10, fontSize: 12, color: t.accent, fontWeight: 600 }}>반영 중… {progress}/{counts.new + counts.update}</div>}
          </div>}

          {/* 단계 4: 결과 */}
          {step === 4 && result && <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, padding: '14px 16px', borderRadius: 10, background: t.greenL, border: `1px solid ${t.green}33` }}><div style={{ fontSize: 11, color: t.textM, fontWeight: 600 }}>성공(반영)</div><div style={{ fontSize: 24, fontWeight: 800, color: t.green }}>{result.success}</div></div>
              <div style={{ flex: 1, padding: '14px 16px', borderRadius: 10, background: ALERT + '12', border: `1px solid ${ALERT}33` }}><div style={{ fontSize: 11, color: t.textM, fontWeight: 600 }}>실패/제외</div><div style={{ fontSize: 24, fontWeight: 800, color: ALERT }}>{result.fail.length + result.errorRows.length}</div></div>
            </div>
            {(result.fail.length + result.errorRows.length) > 0 ? <>
              <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr style={{ background: t.bg }}>{['구분', '약품코드', '연월', '사유'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: t.textM, fontWeight: 700, position: 'sticky', top: 0, background: t.bg, borderBottom: `1px solid ${t.border}` }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {result.errorRows.map((r, i) => <tr key={'e' + i} style={{ borderBottom: `1px solid ${t.border}` }}><td style={{ padding: '7px 10px', color: t.textM }}>검증오류</td><td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{r.code || '-'}</td><td style={{ padding: '7px 10px', color: t.textM }}>{r.y && r.m ? `${r.y}-${r.m}` : '-'}</td><td style={{ padding: '7px 10px', color: ALERT }}>{r.errors.join(' / ')}</td></tr>)}
                    {result.fail.map((f, i) => <tr key={'f' + i} style={{ borderBottom: `1px solid ${t.border}` }}><td style={{ padding: '7px 10px', color: t.textM }}>반영실패</td><td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{f.code || '-'}</td><td style={{ padding: '7px 10px', color: t.textM }}>{f.ym || '-'}</td><td style={{ padding: '7px 10px', color: ALERT }}>{f.reason}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <button onClick={downloadFailCsv} style={btn(false)}>실패 목록 CSV 다운로드</button>
            </> : <div style={{ fontSize: 13, color: t.green, fontWeight: 600 }}>✅ 모든 행이 정상 반영되었습니다.</div>}
          </div>}
        </div>

        {/* 푸터 */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={step === 2 ? () => setStep(1) : step === 3 ? () => setStep(2) : null} disabled={step === 1 || step === 4 || applying} style={{ ...btn(false), visibility: (step === 2 || step === 3) && !applying ? 'visible' : 'hidden' }}>← 이전</button>
          {step === 1 && <button onClick={onClose} style={btn(false)}>취소</button>}
          {step === 2 && <button onClick={goPreview} disabled={!mapReady} style={btn(true, !mapReady)}>미리보기 →</button>}
          {step === 3 && <button onClick={apply} disabled={applying || (counts.new + counts.update) === 0} style={btn(true, applying || (counts.new + counts.update) === 0)}>{applying ? '반영 중…' : `${counts.new + counts.update}건 반영`}</button>}
          {step === 4 && <button onClick={onClose} style={btn(true)}>닫기</button>}
        </div>
      </div>
    </div>
  )
}