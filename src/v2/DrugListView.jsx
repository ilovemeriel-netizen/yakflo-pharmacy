import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { T, BRAND } from './theme'
import { fetchVocab, fetchDrugs, updateDrugStatus } from './api'
import { COLUMNS, loadCols, saveCols } from './columns'
import DrugTable from './DrugTable'
import Drug360 from './Drug360'

const PAGE_SIZE = 50

/* 사용/휴면(메인) · 중지(아카이브)가 공유하는 목록 뷰.
   props: title, baseStatuses[], statusOptions[], rowAction('activate'|'restore'|null), showArchiveLink */
export default function DrugListView({ title, subtitle, baseStatuses, statusOptions = [], rowAction = null, showArchiveLink = false }) {
  const [vocab, setVocab] = useState({})
  const [category, setCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [selected, setSelected] = useState(null)
  const [cols, setCols] = useState(loadCols())
  const [colPanel, setColPanel] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const statuses = statusFilter ? [statusFilter] : baseStatuses

  useEffect(() => {
    let active = true
    fetchVocab().then((v) => { if (active) setVocab(v) }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    fetchDrugs({ page, pageSize: PAGE_SIZE, category, statuses, search })
      .then(({ rows: r, total: t }) => { if (!active) return; setRows(r); setTotal(t); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, category, statusFilter, search, reloadKey])

  function reset(fn, val) { setLoading(true); fn(val); setPage(0) }
  function submitSearch(e) { e.preventDefault(); setLoading(true); setSearch(searchInput.trim()); setPage(0) }
  function goPage(p) { setLoading(true); setPage(p) }
  function toggleCol(key) {
    setCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...COLUMNS.filter((c) => prev.includes(c.key) || c.key === key).map((c) => c.key)]
      saveCols(next)
      return next
    })
  }
  async function changeStatus(code, status) {
    try { await updateDrugStatus(code, status); setLoading(true); setReloadKey((k) => k + 1) }
    catch (e) { setErr(e.message) }
  }

  const action = rowAction === 'activate'
    ? { label: '활성화', applicable: (r) => r.status === '휴면', onClick: (r) => changeStatus(r.drug_code, '사용') }
    : rowAction === 'restore'
      ? { label: '복귀', onClick: (r) => changeStatus(r.drug_code, '사용') }
      : null

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const ctl = { padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, background: T.surface, color: T.text, outline: 'none' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{title}</h1>
        {showArchiveLink && <Link to="/app/archive" style={{ fontSize: 13, color: BRAND.purple }}>중지 아카이브 →</Link>}
        {!showArchiveLink && <Link to="/app/drugs" style={{ fontSize: 13, color: BRAND.purple }}>← 약품관리</Link>}
      </div>
      <div style={{ fontSize: 13, color: T.textM, marginBottom: 16 }}>{subtitle || `총 ${total.toLocaleString()}건`}</div>

      {/* 필터 + 검색 + 표시 컬럼 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, position: 'relative' }}>
        <select value={category} onChange={(e) => reset(setCategory, e.target.value)} style={ctl}>
          <option value="">구분 전체</option>
          {(vocab.category || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        {statusOptions.length > 1 && (
          <select value={statusFilter} onChange={(e) => reset(setStatusFilter, e.target.value)} style={ctl}>
            <option value="">상태 전체</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 180 }}>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="약품명·코드 검색" style={{ ...ctl, flex: 1 }} />
          <button type="submit" style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: BRAND.purple, color: '#fff', fontSize: 13, cursor: 'pointer' }}>검색</button>
        </form>
        <button onClick={() => setColPanel((v) => !v)} style={{ ...ctl, cursor: 'pointer' }}>표시 컬럼 ▾</button>
        {colPanel && (
          <div style={{ position: 'absolute', right: 0, top: 44, zIndex: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 180 }}>
            {COLUMNS.map((c) => (
              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {!loading && !err && rows.length > 0 && (
          <DrugTable rows={rows} visibleKeys={cols} onRowClick={setSelected} action={action} />
        )}
        {loading && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>불러오는 중…</div>}
        {err && <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 13 }}>오류: {err}</div>}
        {!loading && !err && rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>조건에 맞는 약품이 없습니다.</div>}
      </div>

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
  return { padding: '7px 14px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: disabled ? T.textL : T.text, cursor: disabled ? 'default' : 'pointer', fontSize: 13, opacity: disabled ? 0.5 : 1 }
}
