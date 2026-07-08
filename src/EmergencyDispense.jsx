/* 비상조제 — 조제기 고장 시 수기 조제용 약포지 인쇄 (가산 신규 화면)
   · 공통 컴포넌트(StandardTable 등) 미사용, 자체 마크업.
   · 기존 팔레트만: 보라 #804A87 · 녹색 #019748 · 라벤더 #BFA6D9 · 네이비 #2E4A62.
   · 환자정보(환자명·병실·환자번호)는 컴포넌트 state에만, DB 저장 없음.
   · 파우치는 인쇄물이라 흰 배경·검정 잉크 고정. 복용시간 하단 좌측 배치. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const PURPLE = '#804A87', GREEN = '#019748', LAV = '#BFA6D9', NAVY = '#2E4A62'
const MM = 3.7795275591 /* mm→px @96dpi (미리보기 스케일 계산용) */
const SLOTS = [{ key: 'm', label: '아침' }, { key: 'l', label: '점심' }, { key: 'd', label: '저녁' }, { key: 'b', label: '취침전' }]
const TIMINGS = ['식전 30분', '식후 30분', '식후 즉시', '식간', '해당없음']
const TIMING_SHORT = { '식전 30분': '식전', '식후 30분': '식후', '식후 즉시': '식후즉시', '식간': '식간', '해당없음': '' }
const NARC = { 마약: NAVY, 향정: PURPLE, 한외마약: LAV }
/* 파우치 레이아웃 상수(mm) — 행 '한도'는 상수 금지(높이에서 계산), 부위 높이는 레이아웃 상수 */
const PAD_MM = 5, TOP_MM = 11, BOTTOM_MM = 13
const ROW_MM = { normal: 4.0, small: 3.2 }
const A4_W = 210, A4_H = 297, A4_MARGIN = 8

let _seq = 1
const rid = () => 'r' + (_seq++)
const pad2 = n => String(n).padStart(2, '0')
function ymdParts(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) { const d = new Date(); return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() } } return { y: +m[1], mo: +m[2], d: +m[3] } }
function addDays(startYmd, n) { const p = ymdParts(startYmd); const dt = new Date(p.y, p.mo - 1, p.d + n); return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}` }
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
function rowLimit(envH, small) { const avail = envH - TOP_MM - BOTTOM_MM - PAD_MM; return Math.max(1, Math.floor(avail / ROW_MM[small ? 'small' : 'normal'])) }
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const newRow = () => ({ id: rid(), name: '', code: '', narc: '', qty: '1', m: true, l: true, d: true, b: false, timing: '식후 30분' })

export default function EmergencyDispense() {
  const [cache, setCache] = useState([]); const [loaded, setLoaded] = useState(false)
  const [rows, setRows] = useState([newRow()])
  const [patient, setPatient] = useState(''); const [room, setRoom] = useState(''); const [patientNo, setPatientNo] = useState('')
  const [startSeq, setStartSeq] = useState(1)
  const [dateYmd, setDateYmd] = useState(todayYmd()); const [days, setDays] = useState(1)
  const [org, setOrg] = useState('씨엔씨재활의학과병원')
  const [envW, setEnvW] = useState(64); const [envH, setEnvH] = useState(86)
  const [printed, setPrinted] = useState(false)
  const wrapRef = useRef(null); const [scale, setScale] = useState(1)

  useEffect(() => {
    let on = true
    supabase.from('drugs').select('drug_code,drug_name,status,narcotic_type,is_narcotic').limit(3000).then(({ data }) => { if (on) { setCache(data || []); setLoaded(true) } })
    return () => { on = false }
  }, [])

  function touch() { if (printed) setPrinted(false) }
  function setRow(id, patch) { touch(); setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r)) }
  function addRow() { touch(); setRows(rs => [...rs, newRow()]) }
  function delRow(id) { touch(); setRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs) }

  const eW = Math.max(30, Math.min(120, Number(envW) || 64))
  const eH = Math.max(40, Math.min(150, Number(envH) || 86))

  /* 파우치 생성: 일자×시간대×복용시점(정확값) 그룹별. 한도 초과→폰트축소→그래도 초과→(i/n) 분할 */
  const pouches = useMemo(() => {
    const out = []; let seq = Number(startSeq) || 1
    const nd = Math.max(1, Math.min(31, Number(days) || 1))
    const nLim = rowLimit(eH, false), sLim = rowLimit(eH, true)
    for (let di = 0; di < nd; di++) {
      const dstr = addDays(dateYmd, di)
      for (const slot of SLOTS) {
        const sr = rows.filter(r => r[slot.key] && (r.name || '').trim())
        if (!sr.length) continue
        for (const tm of TIMINGS) {
          const grp = sr.filter(r => r.timing === tm); if (!grp.length) continue
          const small = grp.length > nLim
          const per = small ? sLim : nLim
          const pages = grp.length > per ? chunk(grp, per) : [grp]
          pages.forEach((pg, pi) => out.push({ seq, date: dstr, slot: slot.label, timing: TIMING_SHORT[tm], rows: pg, small, page: pages.length > 1 ? pi + 1 : null, pageN: pages.length > 1 ? pages.length : null }))
          seq++
        }
      }
    }
    return out
  }, [rows, startSeq, dateYmd, days, eH])

  const lastSeq = pouches.length ? Math.max(...pouches.map(p => p.seq)) : (Number(startSeq) || 1) - 1
  /* A4 배치: 인쇄영역 194×281 안에 envW×envH 그리드 */
  const cols = Math.max(1, Math.floor((A4_W - A4_MARGIN * 2) / eW))
  const prows = Math.max(1, Math.floor((A4_H - A4_MARGIN * 2) / eH))
  const perPage = cols * prows
  const pages = chunk(pouches, perPage)

  /* 미리보기 스케일: 컨테이너 폭에 A4 폭(210mm)을 맞춤 */
  useEffect(() => {
    function fit() { const w = wrapRef.current ? wrapRef.current.clientWidth : 0; if (w) setScale(Math.min(1, w / (A4_W * MM))) }
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit)
  }, [])

  function doPrint() {
    if (!pouches.length) return
    document.body.classList.remove('ed-printing-ruler'); document.body.classList.add('ed-printing')
    const clean = () => { document.body.classList.remove('ed-printing'); window.removeEventListener('afterprint', clean) }
    window.addEventListener('afterprint', clean); setPrinted(true)
    setTimeout(() => window.print(), 60); setTimeout(clean, 3000)
  }
  function printRuler() {
    document.body.classList.remove('ed-printing'); document.body.classList.add('ed-printing-ruler')
    const clean = () => { document.body.classList.remove('ed-printing-ruler'); window.removeEventListener('afterprint', clean) }
    window.addEventListener('afterprint', clean); setTimeout(() => window.print(), 60); setTimeout(clean, 3000)
  }
  function nextPatient() {
    const warn = pouches.length > 0 && !printed
      ? '⚠ 생성된 파우치를 아직 인쇄하지 않았습니다.\n인쇄 없이 초기화하고 다음 환자로 넘어갈까요?'
      : '다음 환자로 넘어갑니다.\n약품 목록·환자명·병실·환자번호를 초기화합니다. (기관명·조제일자·일수·봉투규격 유지)'
    if (!window.confirm(warn)) return
    setStartSeq(lastSeq + 1)            /* 순번 이어감 */
    setRows([newRow()]); setPatient(''); setRoom(''); setPatientNo(''); setPrinted(false)
  }

  return <div style={{ padding: '20px 24px', background: '#F7F6F3', minHeight: '100vh' }}>
    <style>{ED_CSS}</style>

    {/* ─── 컨트롤(인쇄 제외) ─── */}
    <div className="ed-noprint">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: PURPLE }}>💊 비상조제</span>
        <span style={{ fontSize: 12, color: '#6b6b6b' }}>조제기 고장 시 수기 약포지 인쇄 · {loaded ? `약품 ${cache.length}종` : '로딩…'}</span>
        <div style={{ flex: 1 }} />
        <button onClick={nextPatient} style={btn(NAVY, NAVY)}>다음 환자</button>
      </div>

      {/* 약품 행 */}
      <div style={{ background: '#fff', border: '1px solid #e3e0dc', borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 66px repeat(4,40px) 118px 36px', gap: 8, fontSize: 11, fontWeight: 700, color: '#555', padding: '0 4px 8px', borderBottom: '1px solid #eee' }}>
          <div>약품명</div><div style={{ textAlign: 'center' }}>수량</div>{SLOTS.map(s => <div key={s.key} style={{ textAlign: 'center' }}>{s.label}</div>)}<div style={{ textAlign: 'center' }}>복용시점</div><div />
        </div>
        {rows.map(r => <DrugRow key={r.id} r={r} cache={cache} setRow={setRow} delRow={delRow} />)}
        <button onClick={addRow} style={btn(LAV, PURPLE)}>+ 약품 행 추가</button>
      </div>

      {/* 인쇄 설정 */}
      <div style={{ background: '#fff', border: '1px solid #e3e0dc', borderRadius: 12, padding: 14, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
        {fld('환자명', <input value={patient} onChange={e => setPatient(e.target.value)} style={inp} />)}
        {fld('병실호수', <input value={room} onChange={e => setRoom(e.target.value)} placeholder="607" style={inp} />)}
        {fld('환자번호(선택)', <input value={patientNo} onChange={e => setPatientNo(String(e.target.value))} placeholder="00010950" style={inp} />)}
        {fld('시작순번', <input type="number" min={1} value={startSeq} onChange={e => setStartSeq(e.target.value)} style={inp} />)}
        {fld('조제일자', <input type="date" value={dateYmd} onChange={e => setDateYmd(e.target.value)} style={inp} />)}
        {fld('일수(1~31)', <input type="number" min={1} max={31} value={days} onChange={e => setDays(e.target.value)} style={inp} />)}
        {fld('기관명', <input value={org} onChange={e => setOrg(e.target.value)} style={inp} />)}
        {fld('봉투 가로(mm)', <input type="number" min={30} max={120} value={envW} onChange={e => setEnvW(e.target.value)} style={inp} />)}
        {fld('봉투 세로(mm)', <input type="number" min={40} max={150} value={envH} onChange={e => setEnvH(e.target.value)} style={inp} />)}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={doPrint} disabled={!pouches.length} style={{ ...btn(GREEN, '#fff', true), opacity: pouches.length ? 1 : .5 }}>🖨 인쇄 ({pouches.length} 파우치 · {pages.length}장)</button>
        <button onClick={printRuler} style={btn(NAVY, NAVY)}>📏 보정 인쇄(100mm 눈금자)</button>
        <span style={{ fontSize: 11, color: '#6b6b6b' }}>파우치 {eW}×{eH}mm · A4당 {cols}×{prows}={perPage}매 · 순번 {startSeq}~{Math.max(startSeq, lastSeq)}</span>
      </div>
      <div style={{ fontSize: 11, color: '#a06b00', background: '#fff7e6', border: '1px solid #ffe1a6', borderRadius: 8, padding: '6px 10px', marginBottom: 14 }}>ℹ 실제 출력은 프린터 여백·용지에 따라 미세 차이가 날 수 있습니다. 첫 사용 시 [보정 인쇄]로 배율을 확인하세요.</div>
    </div>

    {/* ─── A4 페이지 프레임 미리보기(화면) + 인쇄 대상 ─── */}
    <div ref={wrapRef} className="ed-noprint" style={{ overflow: 'hidden' }}>
      <div className="ed-print-area" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: A4_W + 'mm' }}>
        {pages.length === 0
          ? null
          : pages.map((pg, pi) => <A4Page key={pi} pouches={pg} pageIdx={pi} total={pages.length} eW={eW} eH={eH} org={org} patient={patient} room={room} patientNo={patientNo} />)}
      </div>
      {pages.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>약품·복용시간을 선택하면 A4 미리보기가 생성됩니다.</div>}
      {pages.length > 0 && <div style={{ transform: `scale(1)`, marginTop: 8, fontSize: 11, color: '#6b6b6b' }}>총 {pages.length}장 · 미리보기 배율 {(scale * 100).toFixed(0)}%</div>}
    </div>

    {/* 인쇄 전용(화면 숨김): 실제 출력용 파우치 flow */}
    <div className="ed-print-only">
      {pages.map((pg, pi) => <A4Page key={pi} pouches={pg} pageIdx={pi} total={pages.length} eW={eW} eH={eH} org={org} patient={patient} room={room} patientNo={patientNo} printMode />)}
    </div>

    {/* 보정 눈금자(100mm) — 화면 숨김, 보정 인쇄 시에만 출력 */}
    <div className="ed-ruler">
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#000', padding: '10mm' }}>
        <div>100mm 보정 눈금자 — 자로 실측해 100mm(±1mm) 확인</div>
        <div style={{ position: 'relative', width: '100mm', height: '10mm', borderLeft: '0.3mm solid #000', borderRight: '0.3mm solid #000', borderBottom: '0.3mm solid #000', marginTop: '4mm' }}>
          {Array.from({ length: 11 }, (_, i) => <div key={i} style={{ position: 'absolute', left: (i * 10) + 'mm', bottom: 0, width: '0.2mm', height: i % 5 === 0 ? '6mm' : '3mm', background: '#000' }} />)}
          {Array.from({ length: 11 }, (_, i) => <div key={'t' + i} style={{ position: 'absolute', left: (i * 10) + 'mm', top: 0, fontSize: 8, transform: 'translateX(-50%)' }}>{i}</div>)}
        </div>
        <div style={{ marginTop: '2mm' }}>← 0 부터 10(=100mm) 까지 →</div>
      </div>
    </div>
  </div>
}

/* ── A4 한 장 ── */
function A4Page({ pouches, pageIdx, total, eW, eH, org, patient, room, patientNo, printMode }) {
  return <div className="ed-a4" style={{ width: A4_W + 'mm', height: A4_H + 'mm', boxSizing: 'border-box', padding: A4_MARGIN + 'mm', background: '#fff', ...(printMode ? {} : { boxShadow: '0 2px 10px rgba(0,0,0,0.15)', marginBottom: 14, border: '1px solid #ddd' }), pageBreakAfter: 'always', breakAfter: 'page' }}>
    {!printMode && <div style={{ fontSize: 9, color: '#bbb', marginBottom: '2mm' }}>A4 {pageIdx + 1}/{total}</div>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0mm', alignContent: 'flex-start' }}>
      {pouches.map((p, i) => <Pouch key={i} p={p} eW={eW} eH={eH} org={org} patient={patient} room={room} patientNo={patientNo} />)}
    </div>
  </div>
}

/* ── 파우치(흰 배경·검정 잉크·절취 점선). 복용시간 하단 좌측 ── */
function Pouch({ p, eW, eH, org, patient, room, patientNo }) {
  const fs = p.small ? 8.5 : 10.5
  const label = p.slot + (p.timing || '')   /* 통짜 복용시점: 아침식전 / 점심식후 / 취침전 */
  return <div style={{ width: eW + 'mm', height: eH + 'mm', boxSizing: 'border-box', border: '1px dashed #000', background: '#fff', color: '#000', position: 'relative', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
    {/* 안쪽 보조 재단선(사방 1mm 안, 옅은 실선). 본문은 안쪽 기준 배치 + 내부 패딩 → 두 선 어디로 잘라도 글자 안전 */}
    <div style={{ position: 'absolute', inset: '1mm', border: '0.2mm solid #b3b3b3', boxSizing: 'border-box', padding: '1.5mm', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontWeight: 600 }}>
      {/* 상단: 순번(대형) · 환자번호(문자열 원문) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 15, fontWeight: 900, lineHeight: 1 }}>{p.seq}</span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3 }}>{patientNo || ''}</span>
      </div>
      {/* 둘째 줄 강조: 조제일자·(병실)·환자명 — 굵고 크게 + 굵은 밑줄 밀착 */}
      <div style={{ fontSize: 11, fontWeight: 800, display: 'flex', gap: '1.5mm', alignItems: 'baseline', borderBottom: '2px solid #000', paddingBottom: '0.3mm', marginTop: '0.6mm' }}>
        <span>{p.date}</span>{room ? <span>({room}호)</span> : null}<span style={{ marginLeft: 'auto' }}>{patient || '　'}</span>
      </div>
      {/* 약품 목록(약간 굵게) */}
      <div style={{ flex: '1 1 auto', overflow: 'hidden', minHeight: 0, marginTop: '0.8mm' }}>
        {p.rows.map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1.5mm', fontSize: fs, fontWeight: 600, lineHeight: 1.3 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <span style={{ flexShrink: 0, fontWeight: 800 }}>{r.qty || '1'}</span>
        </div>)}
      </div>
      {/* 하단 고정: 복용시점 통짜 초대형(가장 큰 텍스트, 자간 넓게) + (i/n) 소형 / 기관명 중간 */}
      <div style={{ marginTop: 'auto', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5mm' }}>
          <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.5mm', lineHeight: 1, whiteSpace: 'nowrap' }}>{label}</span>
          {p.page ? <span style={{ fontSize: 8, fontWeight: 700, paddingBottom: '1mm' }}>({p.page}/{p.pageN})</span> : null}
        </div>
        <div style={{ fontSize: 10, marginTop: '0.6mm', fontWeight: 700 }}>{org || ''}</div>
      </div>
    </div>
  </div>
}

/* ── 약품 행(자동완성) ── */
function DrugRow({ r, cache, setRow, delRow }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const boxRef = useRef(null)
  useEffect(() => { function od(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) } document.addEventListener('mousedown', od); return () => document.removeEventListener('mousedown', od) }, [])
  const nt = d => { const v = (d.narcotic_type || '').trim(); if (NARC[v]) return v; return d.is_narcotic ? '향정' : '' }
  const sug = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2) return []
    return cache.filter(d => (d.drug_name || '').toLowerCase().includes(s) || (d.drug_code || '').toLowerCase().includes(s))
      .sort((a, b) => (a.status === '사용' ? 0 : 1) - (b.status === '사용' ? 0 : 1) || String(a.drug_name).localeCompare(String(b.drug_name), 'ko')).slice(0, 8)
  }, [q, cache])
  function pick(d) { setRow(r.id, { name: d.drug_name, code: d.drug_code, narc: nt(d) }); setQ(d.drug_name); setOpen(false) }
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 66px repeat(4,40px) 118px 36px', gap: 8, alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid #f2f0ed' }}>
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input value={r.name} onChange={e => { setRow(r.id, { name: e.target.value, code: '', narc: '' }); setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="약품명·코드(2글자↑) / 자유입력" style={{ ...inp, borderColor: r.narc ? PURPLE : '#d9d5d0' }} />
      {r.narc ? <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 9, fontWeight: 700, color: '#fff', background: NARC[r.narc] || PURPLE, borderRadius: 6, padding: '1px 5px' }}>{r.narc}</span> : (r.code ? <span style={{ position: 'absolute', right: 8, top: 9, fontSize: 9, color: '#999' }}>{r.code}</span> : null)}
      {open && sug.length > 0 && <div style={{ position: 'absolute', zIndex: 30, top: 34, left: 0, right: 0, background: '#fff', border: '1px solid #d9d5d0', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto' }}>
        {sug.map(d => <div key={d.drug_code} onClick={() => pick(d)} style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #f2f0ed', display: 'flex', justifyContent: 'space-between', gap: 8 }} onMouseEnter={e => e.currentTarget.style.background = '#F7F6F3'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
          <span style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.drug_name}{nt(d) && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: '#fff', background: NARC[nt(d)] || PURPLE, borderRadius: 5, padding: '1px 4px' }}>{nt(d)}</span>}{d.status !== '사용' && <span style={{ marginLeft: 6, fontSize: 8, color: '#999' }}>{d.status}</span>}</span>
          <span style={{ fontSize: 10, color: '#999', flexShrink: 0 }}>{d.drug_code}</span>
        </div>)}
      </div>}
    </div>
    <input value={r.qty} onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setRow(r.id, { qty: v }) }} style={{ ...inp, textAlign: 'center' }} />
    {SLOTS.map(s => <div key={s.key} style={{ textAlign: 'center' }}><input type="checkbox" checked={!!r[s.key]} onChange={e => setRow(r.id, { [s.key]: e.target.checked })} style={{ width: 17, height: 17, accentColor: PURPLE, cursor: 'pointer' }} /></div>)}
    <select value={r.timing} onChange={e => setRow(r.id, { timing: e.target.value })} style={{ ...inp, padding: '7px 6px' }}>{TIMINGS.map(t => <option key={t}>{t}</option>)}</select>
    <button onClick={() => delRow(r.id)} title="행 삭제" style={{ border: '1px solid #e3e0dc', background: '#fff', color: '#c0392b', borderRadius: 6, cursor: 'pointer', fontSize: 12, height: 30 }}>✕</button>
  </div>
}

const inp = { width: '100%', padding: '7px 9px', border: '1px solid #d9d5d0', borderRadius: 7, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#222' }
const btn = (bg, fg, solid) => ({ padding: '8px 14px', borderRadius: 8, border: solid ? 'none' : '1px solid ' + bg, background: solid ? bg : bg + '22', color: fg, cursor: 'pointer', fontSize: 12, fontWeight: 700 })
function fld(label, el) { return <label style={{ display: 'block' }}><span style={{ fontSize: 10, color: '#777', fontWeight: 600, display: 'block', marginBottom: 3 }}>{label}</span>{el}</label> }

/* 인쇄: body.ed-printing → 파우치만, body.ed-printing-ruler → 눈금자만. 이 화면 렌더 시에만 <style> 존재 → 타 화면 무영향 */
const ED_CSS = `
.ed-print-only{display:none}
.ed-ruler{display:none}
@media print{
  @page{size:A4;margin:8mm}
  /* 파우치 인쇄 */
  body.ed-printing *{visibility:hidden!important}
  body.ed-printing .ed-print-only,body.ed-printing .ed-print-only *{visibility:visible!important}
  body.ed-printing .ed-print-only{display:block!important;position:absolute;left:0;top:0}
  body.ed-printing .ed-noprint{display:none!important}
  body.ed-printing .ed-a4{box-shadow:none!important;border:0!important;padding:0!important;margin:0!important;width:auto!important;height:auto!important}
  /* 눈금자 보정 인쇄 */
  body.ed-printing-ruler *{visibility:hidden!important}
  body.ed-printing-ruler .ed-ruler,body.ed-printing-ruler .ed-ruler *{visibility:visible!important}
  body.ed-printing-ruler .ed-ruler{display:block!important;position:absolute;left:0;top:0}
  body.ed-printing-ruler .ed-noprint{display:none!important}
}
`