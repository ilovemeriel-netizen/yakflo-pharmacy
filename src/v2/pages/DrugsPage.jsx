import { useEffect, useState } from 'react'
import { T, BRAND } from '../theme'
import { fetchVocab, fetchDrugs } from '../api'
import Drug360 from '../Drug360'

const PAGE_SIZE = 50

const STATUS_CHIP = {
  사용: { bg: '#e6f6ec', fg: BRAND.green },
  휴면: { bg: '#fff4e0', fg: '#b06a00' },
  중지: { bg: '#f0f0f2', fg: '#888' },
}

export default function DrugsPage() {
  const [vocab, setVocab] = useState({})
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
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
    fetchDrugs({ page, pageSize: PAGE_SIZE, category, status, search })
      .then(({ rows: r, total: t }) => { if (!active) return; setRows(r); setTotal(t); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
  }, [page, category, status, search])

  function applyFilter(setter, val) { setLoading(true); setter(val); setPage(0) }
  function submitSearch(e) { e.preventDefault(); setLoading(true); setSearch(searchInput.trim()); setPage(0) }
  function goPage(p) { setLoading(true); setPage(p) }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const sel = (val) => ({
    padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13,
    background: T.surface, color: val ? T.text : T.textM, outline: 'none',
  })
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 12, color: T.textL, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: `1px solid ${T.border}` }
  const td = { padding: '10px 12px', fontSize: 13, color: T.text, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>약품관리</h1>
      <div style={{ fontSize: 13, color: T.textM, marginBottom: 16 }}>총 {total.toLocaleString()}건</div>

      {/* 필터 바 (drug_vocab 기반) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={category} onChange={(e) => applyFilter(setCategory, e.target.value)} style={sel(category)}>
          <option value="">구분 전체</option>
          {(vocab.category || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <select value={status} onChange={(e) => applyFilter(setStatus, e.target.value)} style={sel(status)}>
          <option value="">상태 전체</option>
          {(vocab.status || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 200 }}>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="약품명·코드 검색" style={{ ...sel(true), flex: 1 }} />
          <button type="submit" style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: BRAND.purple, color: '#fff', fontSize: 13, cursor: 'pointer' }}>검색</button>
        </form>
      </div>

      {/* 표 (가로 스크롤 = 모바일 반응형) */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>코드</th><th style={th}>약품명</th><th style={th}>구분</th>
                <th style={{ ...th, textAlign: 'right' }}>현재고</th><th style={th}>유효기한</th><th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !err && rows.map((d) => {
                const chip = STATUS_CHIP[d.status] || { bg: '#f0f0f2', fg: '#888' }
                return (
                  <tr key={d.drug_code} onClick={() => setSelected(d.drug_code)} style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.bg}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...td, color: BRAND.green, fontFamily: 'monospace' }}>{d.drug_code}</td>
                    <td style={{ ...td, fontWeight: 500, whiteSpace: 'normal' }}>{d.drug_name}</td>
                    <td style={td}>{d.category}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{(d.current_qty ?? 0).toLocaleString()}</td>
                    <td style={td}>{d.expiry_date || '-'}</td>
                    <td style={td}><span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: chip.bg, color: chip.fg }}>{d.status}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {loading && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>불러오는 중…</div>}
        {err && <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 13 }}>오류: {err}</div>}
        {!loading && !err && rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>조건에 맞는 약품이 없습니다.</div>}
      </div>

      {/* 페이지네이션 */}
      {!loading && !err && total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, fontSize: 13, color: T.textM }}>
          <button onClick={() => goPage(Math.max(0, page - 1))} disabled={page === 0} style={pgBtn(page === 0)}>이전</button>
          <span>{page + 1} / {pages}</span>
          <button onClick={() => goPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} style={pgBtn(page >= pages - 1)}>다음</button>
        </div>
      )}

      {selected && <Drug360 code={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function pgBtn(disabled) {
  return {
    padding: '7px 14px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface,
    color: disabled ? T.textL : T.text, cursor: disabled ? 'default' : 'pointer', fontSize: 13, opacity: disabled ? 0.5 : 1,
  }
}
