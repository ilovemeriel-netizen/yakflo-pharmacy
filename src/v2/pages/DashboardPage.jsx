import { useEffect, useState } from 'react'
import { T, BRAND } from '../theme'
import { THRESHOLDS } from '../appConstants'
import { fetchDashboard, fetchLowStock, fetchExpiring } from '../appApi'
import Donut from '../Donut'

/* /app 첫 화면 — KPI + 구분/상태 분포 도넛 + 재고부족·유효임박 알림.
   집계는 DB측 RPC(0014). 기존 컴포넌트 무수정·신규 추가. */

const glass = {
  background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.6)', borderRadius: 16, boxShadow: '0 6px 24px rgba(46,74,98,0.08)',
}
const fmtQ = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 })

export default function DashboardPage() {
  const [kpi, setKpi] = useState(null)
  const [low, setLow] = useState([])
  const [exp, setExp] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchDashboard(), fetchLowStock(8), fetchExpiring(THRESHOLDS.EXPIRY_DAYS, 8)])
      .then(([d, l, e]) => { if (!active) return; setKpi(d); setLow(l); setExp(e); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  return (
    <div className="yf-app" style={{ background: 'linear-gradient(135deg,#f4eff8 0%,#eef5f1 100%)', margin: -24, padding: 24, minHeight: 'calc(100vh - 56px)' }}>
      <style>{`@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');.yf-app{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;}`}</style>

      <h1 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 2px', color: T.text }}>대시보드</h1>
      <div style={{ fontSize: 13, color: T.textM, marginBottom: 18 }}>약품·재고·유효기간 현황 요약 (DB 집계 · RLS)</div>

      {loading && <Skeleton />}
      {err && <Banner kind="err">집계를 불러오지 못했습니다: {err}</Banner>}

      {!loading && !err && kpi && (
        <>
          {/* KPI 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label="총 약품수" value={kpi.total} unit="종" accent={BRAND.purple} />
            <Kpi label="사용 / 중지" value={kpi.active} unit={`/ ${kpi.discontinued.toLocaleString()} 중지`} accent={BRAND.green}
              sub={`휴면 ${kpi.dormant.toLocaleString()}`} />
            <Kpi label={`재고부족 (안전 ≤${THRESHOLDS.DEFAULT_SAFETY})`} value={kpi.low_stock} unit="종" accent="#c0392b" warn={kpi.low_stock > 0} />
            <Kpi label={`유효기간 임박 (≤${THRESHOLDS.EXPIRY_DAYS}일)`} value={kpi.expiring} unit="건" accent="#b06a00" warn={kpi.expiring > 0} />
          </div>

          {/* 분포 도넛 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14, marginBottom: 18 }}>
            <section style={{ ...glass, padding: 20 }}>
              <h2 style={cardTitle}>구분별 분포</h2>
              <Donut data={(kpi.by_category || []).map((d) => ({ k: d.k, n: d.n }))} />
            </section>
            <section style={{ ...glass, padding: 20 }}>
              <h2 style={cardTitle}>상태별 분포</h2>
              <Donut data={(kpi.by_status || []).map((d) => ({ k: d.k, n: d.n }))} />
            </section>
          </div>

          {/* 알림 표 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14 }}>
            <AlertTable title="재고부족 알림" hint={`활성 약품 · 현재고 ≤ 안전재고(미설정 시 ${THRESHOLDS.DEFAULT_SAFETY})`}
              rows={low} cols={['약품명', '현재고', '안전', '부족분']}
              render={(d) => [d.drug_name, fmtQ(d.current_qty), fmtQ(d.safety_stock), <b style={{ color: '#c0392b' }}>{fmtQ(d.deficit)}</b>]}
              empty="재고부족 약품이 없습니다." />
            <AlertTable title="유효기간 임박" hint={`중지 제외 · ${THRESHOLDS.EXPIRY_DAYS}일 이내`}
              rows={exp} cols={['약품명', '구분', '현재고', '유효기한']}
              render={(d) => [d.drug_name, d.category, fmtQ(d.current_qty), <span style={{ color: exColor(d.expiry_date) }}>{d.expiry_date}</span>]}
              empty="임박 약품이 없습니다." />
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, unit, accent, sub, warn }) {
  return (
    <div style={{ ...glass, padding: '18px 20px', borderTop: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: T.textM, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: warn ? accent : T.text, letterSpacing: -0.5 }}>{Number(value || 0).toLocaleString()}</span>
        <span style={{ fontSize: 12, color: T.textL, fontWeight: 600 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: T.textL, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function AlertTable({ title, hint, rows, cols, render, empty }) {
  return (
    <section style={{ ...glass, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 10px' }}>
        <h2 style={{ ...cardTitle, marginBottom: 2 }}>{title} <span style={{ fontSize: 12, color: T.textL, fontWeight: 500 }}>({rows.length})</span></h2>
        <div style={{ fontSize: 11.5, color: T.textL }}>{hint}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '24px 20px', color: T.textL, fontSize: 13 }}>{empty}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{cols.map((c, i) => <th key={c} style={{ ...thc, textAlign: i === 0 ? 'left' : 'right' }}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.drug_code}>
                  {render(d).map((cell, i) => <td key={i} style={{ ...tdc, textAlign: i === 0 ? 'left' : 'right', fontWeight: i === 0 ? 500 : 400, color: i === 0 ? T.text : T.textM, whiteSpace: i === 0 ? 'normal' : 'nowrap' }}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Banner({ kind, children }) {
  const c = kind === 'err' ? { bg: '#fde8e8', fg: '#c0392b' } : { bg: '#eef', fg: T.textM }
  return <div style={{ background: c.bg, color: c.fg, borderRadius: 12, padding: '14px 18px', fontSize: 13, fontWeight: 500 }}>{children}</div>
}

function Skeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
      {[0, 1, 2, 3].map((i) => <div key={i} style={{ ...glass, height: 92, animation: 'yfp 1.2s ease-in-out infinite', opacity: 0.6 }} />)}
      <style>{`@keyframes yfp{0%,100%{opacity:.45}50%{opacity:.8}}`}</style>
    </div>
  )
}

function exColor(d) {
  const days = Math.ceil((new Date(d) - new Date()) / 86400000)
  if (days < 0) return '#c0392b'
  if (days <= 30) return '#b06a00'
  return T.textM
}

const cardTitle = { fontSize: 14, fontWeight: 700, color: T.text, margin: '0 0 14px' }
const thc = { padding: '8px 16px', fontSize: 11, color: T.textL, fontWeight: 600, borderBottom: `1px solid ${T.border}`, borderTop: `1px solid ${T.border}`, whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.4)' }
const tdc = { padding: '9px 16px', borderBottom: `1px solid ${T.border}` }