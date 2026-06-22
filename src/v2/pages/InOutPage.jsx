import { useEffect, useState } from 'react'
import { T, BRAND } from '../theme'
import { searchDrugs, insertTransaction, insertLot, fetchRecentTransactions, fetchDrug } from '../api'

const TYPES = [
  { v: '입고', sign: '+' }, { v: '출고', sign: '−' },
  { v: '반품', sign: '+' }, { v: '폐기', sign: '−' },
]
const today = () => new Date().toISOString().slice(0, 10)

export default function InOutPage() {
  const [type, setType] = useState('입고')
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [picked, setPicked] = useState(null)
  const [qty, setQty] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [date, setDate] = useState(today())
  const [supplier, setSupplier] = useState('')
  const [memo, setMemo] = useState('')
  const [recordLot, setRecordLot] = useState(false)
  const [lotNo, setLotNo] = useState('')
  const [lotExpiry, setLotExpiry] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    fetchRecentTransactions(15).then((r) => { if (active) setRecent(r) }).catch(() => {})
    return () => { active = false }
  }, [reload])

  function onSearch(v) {
    setQ(v); setPicked(null)
    if (v.trim().length < 1) { setResults([]); return }
    searchDrugs(v).then(setResults).catch(() => setResults([]))
  }
  function pick(d) { setPicked(d); setQ(`${d.drug_name} (${d.drug_code})`); setResults([]) }

  async function submit(e) {
    e.preventDefault()
    if (!picked) { setMsg({ t: 'err', m: '약품을 선택하세요.' }); return }
    const nQty = Number(qty)
    if (!nQty || nQty <= 0) { setMsg({ t: 'err', m: '수량을 입력하세요.' }); return }
    setBusy(true); setMsg(null)
    try {
      await insertTransaction({
        drug_code: picked.drug_code, type, quantity: nQty,
        unit_price: Number(unitPrice) || 0, transaction_date: date,
        supplier: supplier || '', memo: memo || '',
      })
      if (type === '입고' && recordLot && lotNo.trim()) {
        await insertLot({ drug_code: picked.drug_code, lot_no: lotNo.trim(), expiry_date: lotExpiry || null, quantity: nQty })
      }
      const fresh = await fetchDrug(picked.drug_code)
      setMsg({ t: 'ok', m: `${type} ${nQty} 기록 완료 · ${picked.drug_name} 현재고 ${fresh?.current_qty ?? '?'}` })
      setQty(''); setUnitPrice(''); setLotNo(''); setLotExpiry(''); setMemo('')
      setReload((k) => k + 1)
    } catch (err) {
      setMsg({ t: 'err', m: '기록 실패: ' + err.message })
    }
    setBusy(false)
  }

  const ip = { width: '100%', padding: '9px 11px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: T.surface, color: T.text }
  const lb = { fontSize: 12, color: T.textM, display: 'block', marginBottom: 5, marginTop: 12 }
  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>입출고관리</h1>
      <div style={{ fontSize: 13, color: T.textM, marginBottom: 16 }}>입고·출고·반품·폐기 통합 등록 (4화면 → 1)</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 20, maxWidth: 560 }}>
        <form onSubmit={submit} style={card}>
          {/* 거래 구분 토글 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TYPES.map((tp) => (
              <button type="button" key={tp.v} onClick={() => setType(tp.v)} style={{
                flex: '1 0 22%', padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${type === tp.v ? BRAND.purple : T.border}`,
                background: type === tp.v ? BRAND.purple : 'transparent',
                color: type === tp.v ? '#fff' : T.textM,
              }}>{tp.v} <span style={{ opacity: 0.7 }}>{tp.sign}</span></button>
            ))}
          </div>

          <label style={lb}>약품</label>
          <div style={{ position: 'relative' }}>
            <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="약품명·코드 검색" style={ip} />
            {results.length > 0 && (
              <div style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto' }}>
                {results.map((d) => (
                  <div key={d.drug_code} onClick={() => pick(d)} style={{ padding: '8px 11px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
                    {d.drug_name} <span style={{ color: BRAND.green, fontFamily: 'monospace', fontSize: 12 }}>{d.drug_code}</span>
                    <span style={{ color: T.textL, float: 'right' }}>재고 {d.current_qty ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lb}>수량</label><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={ip} /></div>
            <div style={{ flex: 1 }}><label style={lb}>단가(선택)</label><input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} style={ip} /></div>
            <div style={{ flex: 1 }}><label style={lb}>일자</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={ip} /></div>
          </div>

          {type === '입고' && (
            <div style={{ marginTop: 8, padding: 12, border: `1px dashed ${T.border}`, borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={recordLot} onChange={(e) => setRecordLot(e.target.checked)} /> 로트(유효기한) 기록
              </label>
              {recordLot && (
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <div style={{ flex: 1 }}><label style={lb}>로트번호</label><input value={lotNo} onChange={(e) => setLotNo(e.target.value)} style={ip} /></div>
                  <div style={{ flex: 1 }}><label style={lb}>유효기한</label><input type="date" value={lotExpiry} onChange={(e) => setLotExpiry(e.target.value)} style={ip} /></div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lb}>공급처/처리(선택)</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} style={ip} /></div>
            <div style={{ flex: 1 }}><label style={lb}>메모(선택)</label><input value={memo} onChange={(e) => setMemo(e.target.value)} style={ip} /></div>
          </div>

          {msg && <div style={{ marginTop: 14, fontSize: 13, color: msg.t === 'ok' ? BRAND.green : '#c0392b' }}>{msg.m}</div>}
          <button type="submit" disabled={busy} style={{ marginTop: 16, width: '100%', padding: '11px 0', border: 'none', borderRadius: 8, background: busy ? T.textL : BRAND.purple, color: '#fff', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? '기록 중…' : `${type} 기록`}
          </button>
        </form>

        {/* 최근 거래 */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>최근 거래</div>
          {recent.length === 0
            ? <div style={{ fontSize: 13, color: T.textL, padding: '12px 0' }}>거래 이력이 없습니다.</div>
            : recent.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
                <span><span style={{ fontWeight: 600, color: BRAND.purple }}>{r.type}</span> {r.drug_code} · {r.quantity}</span>
                <span style={{ color: T.textL }}>{r.transaction_date}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
