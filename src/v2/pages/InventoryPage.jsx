import { useEffect, useState } from 'react'
import { T, BRAND } from '../theme'
import { fetchVocab, fetchInventoryList } from '../api'
import { stockStatus } from '../columns'
import Drug360 from '../Drug360'

const PAGE_SIZE = 50

export default function InventoryPage() {
  const [vocab, setVocab] = useState({})
  const [category, setCategory] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let active = true
    fetchVocab().then((v) => { if (active) setVocab(v) }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    fetchInventoryList({ page, pageSize: PAGE_SIZE, category, search })
      .then(({ rows: r, total: t }) => { if (!active) return; setRows(r); setTotal(t); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
  }, [page, category, search])

  function reset(fn, v) { setLoading(true); fn(v); setPage(0) }
  function submitSearch(e) { e.preventDefault(); setLoading(true); setSearch(searchInput.trim()); setPage(0) }
  function goPage(p) { setLoading(true); setPage(p) }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const ctl = { padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, background: T.surface, color: T.text, outline: 'none' }
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 12, color: T.textL, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: `1px solid ${T.border}` }
  const td = { padding: '10px 12px', fontSize: 13, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>재고관리</h1>
      <div style={{ fontSize: 13, color: T.textM, marginBottom: 16 }}>현재고 기준 상태(부족·발주·정상·과잉) · 부족 우선 정렬</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={category} onChange={(e) => reset(setCategory, e.target.value)} style={ctl}>
          <option value="">구분 전체</option>
          {(vocab.category || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 180 }}>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="약품명·코드 검색" style={{ ...ctl, flex: 1 }} />
          <button type="submit" style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: BRAND.purple, color: '#fff', fontSize: 13, cursor: 'pointer' }}>검색</button>
        </form>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr>
              <th style={th}>코드</th><th style={th}>약품명</th><th style={th}>구분</th>
              <th style={{ ...th, textAlign: 'right' }}>현재고</th><th style={{ ...th, textAlign: 'right' }}>안전</th><th style={{ ...th, textAlign: 'right' }}>최대</th><th style={th}>재고상태</th>
            </tr></thead>
            <tbody>
              {!loading && !err && rows.map((d) => {
                const st = stockStatus(d)
                return (
                  <tr key={d.drug_code} onClick={() => setSelected(d.drug_code)} style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.bg} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...td, color: BRAND.green, fontFamily: 'monospace' }}>{d.drug_code}</td>
                    <td style={{ ...td, color: T.text, fontWeight: 500, whiteSpace: 'normal' }}>{d.drug_name}</td>
                    <td style={{ ...td, color: T.text }}>{d.category}</td>
                    <td style={{ ...td, color: T.text, textAlign: 'right' }}>{(d.current_qty ?? 0).toLocaleString()}</td>
                    <td style={{ ...td, color: T.textL, textAlign: 'right' }}>{d.safety_stock || '-'}</td>
                    <td style={{ ...td, color: T.textL, textAlign: 'right' }}>{d.max_stock || '-'}</td>
                    <td style={td}><span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg, fontWeight: 600 }}>{st.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {loading && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>불러오는 중…</div>}
        {err && <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 13 }}>오류: {err}</div>}
        {!loading && !err && rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>약품이 없습니다.</div>}
      </div>

      {!loading && !err && total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, fontSize: 13, color: T.textM }}>
          <button onClick={() => goPage(Math.max(0, page - 1))} disabled={page === 0} style={pg(page === 0)}>이전</button>
          <span>{page + 1} / {pages}</span>
          <button onClick={() => goPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} style={pg(page >= pages - 1)}>다음</button>
        </div>
      )}

      {selected && <Drug360 code={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function pg(disabled) {
  return { padding: '7px 14px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: disabled ? T.textL : T.text, cursor: disabled ? 'default' : 'pointer', fontSize: 13, opacity: disabled ? 0.5 : 1 }
}
