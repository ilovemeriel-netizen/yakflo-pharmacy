/* 비상조제 — 조제기 고장 시 수기 조제용 약포지 인쇄 (가산 신규 화면)
   · 공통 컴포넌트(StandardTable 등) 미사용, 자체 마크업.
   · 기존 팔레트만: 보라 #804A87 · 녹색 #019748 · 라벤더 #BFA6D9 · 네이비 #2E4A62.
   · 환자정보(환자명·병실 등)는 컴포넌트 state에만, DB 저장 없음.
   · 파우치는 인쇄물이라 흰 배경·검정 잉크 고정. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const PURPLE = '#804A87', GREEN = '#019748', LAV = '#BFA6D9', NAVY = '#2E4A62'
const SLOTS = [{ key: 'm', label: '아침' }, { key: 'l', label: '점심' }, { key: 'd', label: '저녁' }, { key: 'b', label: '취침전' }]
const TIMINGS = ['식전 30분', '식후 30분', '식후 즉시', '식간', '해당없음']
const NARC = { 마약: NAVY, 향정: PURPLE, 한외마약: LAV }

let _seq = 1
const rid = () => 'r' + (_seq++)
const pad2 = n => String(n).padStart(2, '0')
function ymdParts(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) { const d = new Date(); return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() } } return { y: +m[1], mo: +m[2], d: +m[3] } }
function addDays(startYmd, n) { const p = ymdParts(startYmd); const dt = new Date(p.y, p.mo - 1, p.d + n); return { ymd8: `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`, disp: `${dt.getFullYear()}.${pad2(dt.getMonth() + 1)}.${pad2(dt.getDate())}` } }
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

export default function EmergencyDispense() {
  const [cache, setCache] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [rows, setRows] = useState([{ id: rid(), name: '', code: '', narc: '', qty: '1', m: false, l: false, d: false, b: false, timing: '식후 30분' }])
  const [patient, setPatient] = useState('')
  const [room, setRoom] = useState('')
  const [startSeq, setStartSeq] = useState(1)
  const [dispenseNo, setDispenseNo] = useState('')
  const startYmd0 = (() => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` })()
  const [startDate, setStartDate] = useState(startYmd0)
  const [days, setDays] = useState(2)
  const [org, setOrg] = useState('약플로약국')

  useEffect(() => {
    let on = true
    supabase.from('drugs').select('drug_code,drug_name,status,narcotic_type,is_narcotic').limit(3000).then(({ data }) => {
      if (!on) return
      setCache(data || []); setLoaded(true)
    })
    return () => { on = false }
  }, [])

  function setRow(id, patch) { setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r)) }
  function addRow() { setRows(rs => [...rs, { id: rid(), name: '', code: '', narc: '', qty: '1', m: false, l: false, d: false, b: false, timing: '식후 30분' }]) }
  function delRow(id) { setRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs) }

  /* 약포지 생성: 일자 × 시간대 × 복용시점(정확값) 그룹별 파우치, 9행↑ 폰트축소 · 12행↑ (i/n) 분할 */
  const pouches = useMemo(() => {
    const out = []
    let seq = Number(startSeq) || 1
    const nd = Math.max(1, Math.min(31, Number(days) || 1))
    for (let di = 0; di < nd; di++) {
      const dt = addDays(startDate, di)
      for (const slot of SLOTS) {
        const slotRows = rows.filter(r => r[slot.key] && (r.name || '').trim())
        if (!slotRows.length) continue
        for (const tm of TIMINGS) {
          const grp = slotRows.filter(r => r.timing === tm)
          if (!grp.length) continue
          const pages = grp.length > 12 ? chunk(grp, 12) : [grp]
          pages.forEach((pg, pi) => {
            out.push({
              seq, date: dt, slot: slot.label,
              timing: tm === '해당없음' ? '' : tm,
              rows: pg, shrink: grp.length > 9,
              page: pages.length > 1 ? pi + 1 : null, pageN: pages.length > 1 ? pages.length : null,
            })
          })
          seq++
        }
      }
    }
    return out
  }, [rows, startSeq, startDate, days])

  function doPrint() {
    if (!pouches.length) return
    document.body.classList.add('ed-printing')
    const clean = () => { document.body.classList.remove('ed-printing'); window.removeEventListener('afterprint', clean) }
    window.addEventListener('afterprint', clean)
    setTimeout(() => window.print(), 60)
    setTimeout(clean, 3000)
  }

  return <div style={{ padding: '20px 24px', background: '#F7F6F3', minHeight: '100vh' }}>
    <style>{ED_PRINT_CSS}</style>

    {/* ─── 컨트롤(인쇄 제외) ─── */}
    <div className="ed-noprint">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: PURPLE }}>💊 비상조제</span>
        <span style={{ fontSize: 12, color: '#6b6b6b' }}>조제기 고장 시 수기 약포지 인쇄 · {loaded ? `약품 ${cache.length}종 로드` : '로딩…'}</span>
      </div>

      {/* 약품 행 */}
      <div style={{ background: '#fff', border: '1px solid #e3e0dc', borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px repeat(4,44px) 120px 40px', gap: 8, fontSize: 11, fontWeight: 700, color: '#555', padding: '0 4px 8px', borderBottom: '1px solid #eee' }}>
          <div>약품명</div><div style={{ textAlign: 'center' }}>수량</div>
          {SLOTS.map(s => <div key={s.key} style={{ textAlign: 'center' }}>{s.label}</div>)}
          <div style={{ textAlign: 'center' }}>복용시점</div><div />
        </div>
        {rows.map(r => <DrugRow key={r.id} r={r} cache={cache} setRow={setRow} delRow={delRow} />)}
        <button onClick={addRow} style={btn(LAV, PURPLE)}>+ 약품 행 추가</button>
      </div>

      {/* 인쇄 설정 */}
      <div style={{ background: '#fff', border: '1px solid #e3e0dc', borderRadius: 12, padding: 14, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
        {fld('환자명', <input value={patient} onChange={e => setPatient(e.target.value)} style={inp} />)}
        {fld('병실호수', <input value={room} onChange={e => setRoom(e.target.value)} style={inp} />)}
        {fld('시작순번', <input type="number" min={1} value={startSeq} onChange={e => setStartSeq(e.target.value)} style={inp} />)}
        {fld('조제번호(선택)', <input value={dispenseNo} onChange={e => setDispenseNo(e.target.value)} style={inp} />)}
        {fld('시작일', <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} />)}
        {fld('일수(1~31)', <input type="number" min={1} max={31} value={days} onChange={e => setDays(e.target.value)} style={inp} />)}
        {fld('기관명', <input value={org} onChange={e => setOrg(e.target.value)} style={inp} />)}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <button onClick={doPrint} disabled={!pouches.length} style={{ ...btn(GREEN, '#fff', true), opacity: pouches.length ? 1 : .5 }}>🖨 인쇄 ({pouches.length} 파우치)</button>
        <span style={{ fontSize: 12, color: '#6b6b6b' }}>미리보기 ↓ (A4 여백 8mm, 파우치 70×80mm)</span>
      </div>
    </div>

    {/* ─── 파우치(미리보기 + 인쇄 대상) ─── */}
    <div className="ed-print-area">
      {pouches.length === 0
        ? <div className="ed-noprint" style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>약품·복용시간을 선택하면 약포지가 생성됩니다.</div>
        : pouches.map((p, i) => <Pouch key={i} p={p} org={org} patient={patient} room={room} dispenseNo={dispenseNo} />)}
    </div>
  </div>
}

/* ── 약품 행(자동완성) ── */
function DrugRow({ r, cache, setRow, delRow }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  useEffect(() => { function od(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) } document.addEventListener('mousedown', od); return () => document.removeEventListener('mousedown', od) }, [])
  const sug = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    return cache.filter(d => (d.drug_name || '').toLowerCase().includes(s) || (d.drug_code || '').toLowerCase().includes(s))
      .sort((a, b) => (a.status === '사용' ? 0 : 1) - (b.status === '사용' ? 0 : 1) || String(a.drug_name).localeCompare(String(b.drug_name), 'ko'))
      .slice(0, 8)
  }, [q, cache])
  const nt = d => { const v = (d.narcotic_type || '').trim(); if (NARC[v]) return v; return d.is_narcotic ? '향정' : '' }
  function pick(d) { setRow(r.id, { name: d.drug_name, code: d.drug_code, narc: nt(d) }); setQ(d.drug_name); setOpen(false) }
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px repeat(4,44px) 120px 40px', gap: 8, alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid #f2f0ed' }}>
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input value={r.name} onChange={e => { setRow(r.id, { name: e.target.value, code: '', narc: '' }); setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="약품명·코드 검색(2글자↑) / 자유입력" style={{ ...inp, borderColor: r.narc ? PURPLE : '#d9d5d0' }} />
      {r.code ? <span style={{ position: 'absolute', right: r.narc ? 56 : 8, top: 9, fontSize: 9, color: '#999' }}>{r.code}</span> : null}
      {r.narc ? <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 9, fontWeight: 700, color: '#fff', background: NARC[r.narc] || PURPLE, borderRadius: 6, padding: '1px 5px' }}>{r.narc}</span> : null}
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

/* ── 파우치 70×80mm (흰 배경·검정 잉크 고정) ── */
function Pouch({ p, org, patient, room, dispenseNo }) {
  const fs = p.shrink ? 8.5 : 10.5
  return <div className="ed-pouch" style={{ width: '70mm', height: '80mm', boxSizing: 'border-box', border: '1px solid #000', background: '#fff', color: '#000', padding: '3mm', display: 'flex', flexDirection: 'column', fontFamily: 'inherit', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
    {/* 상단: 순번(좌) · 조제번호/분할(우) */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 9 }}>
      <span style={{ fontWeight: 800 }}>순번 {p.seq}</span>
      <span>{dispenseNo ? '조제 ' + dispenseNo : ''}{p.page ? `  (${p.page}/${p.pageN})` : ''}</span>
    </div>
    {/* 시간밴드: 시간대 대형 + 식전/식후 배지 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '2mm', margin: '1mm 0', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '1mm 0' }}>
      <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: 1 }}>{p.slot}</span>
      {p.timing ? <span style={{ fontSize: 9, fontWeight: 700, border: '1px solid #000', borderRadius: 3, padding: '0.3mm 1.5mm' }}>{p.timing}</span> : null}
    </div>
    {/* 날짜 · (병실) · 환자명 + 밑줄 */}
    <div style={{ fontSize: 9.5, borderBottom: '1px solid #000', paddingBottom: '1mm', marginBottom: '1mm', display: 'flex', justifyContent: 'space-between', gap: '2mm' }}>
      <span>{p.date.ymd8}</span>
      <span style={{ fontWeight: 700, textAlign: 'right' }}>{room ? '(' + room + ') ' : ''}{patient || '　'}</span>
    </div>
    {/* 약품 목록 (flex:1, 하단 겹침 방지) */}
    <div style={{ flex: '1 1 auto', overflow: 'hidden', minHeight: 0 }}>
      {p.rows.map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm', fontSize: fs, lineHeight: 1.32, borderBottom: '1px dotted #bbb', padding: '0.2mm 0' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        <span style={{ flexShrink: 0, fontWeight: 700 }}>{r.qty || '1'}</span>
      </div>)}
    </div>
    {/* 하단 고정 */}
    <div style={{ marginTop: 'auto', borderTop: '1px solid #000', paddingTop: '1mm', display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
      <span style={{ fontWeight: 700 }}>{org || ''}</span>
      <span>복용 전 약품 확인</span>
    </div>
  </div>
}

/* ── 스타일 헬퍼 ── */
const inp = { width: '100%', padding: '7px 9px', border: '1px solid #d9d5d0', borderRadius: 7, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#222' }
const btn = (bg, fg, solid) => ({ marginTop: 8, padding: '8px 14px', borderRadius: 8, border: solid ? 'none' : '1px solid ' + bg, background: solid ? bg : bg + '22', color: fg, cursor: 'pointer', fontSize: 12, fontWeight: 700 })
function fld(label, el) { return <label style={{ display: 'block' }}><span style={{ fontSize: 10, color: '#777', fontWeight: 600, display: 'block', marginBottom: 3 }}>{label}</span>{el}</label> }

/* ── 인쇄 스타일: body.ed-printing 일 때만 앱 숨기고 파우치만 A4 출력.
   이 화면이 렌더될 때만 <style>가 DOM에 존재 → 다른 화면 인쇄 무영향 ── */
const ED_PRINT_CSS = `
.ed-print-area{display:flex;flex-wrap:wrap;gap:4mm;align-content:flex-start}
@media print{
  @page{size:A4;margin:8mm}
  body.ed-printing{background:#fff!important}
  body.ed-printing *{visibility:hidden!important}
  body.ed-printing .ed-print-area,body.ed-printing .ed-print-area *{visibility:visible!important}
  body.ed-printing .ed-print-area{position:absolute;left:0;top:0;width:100%;display:flex;flex-wrap:wrap;gap:4mm}
  body.ed-printing .ed-noprint{display:none!important}
  .ed-pouch{box-shadow:none!important}
}
`