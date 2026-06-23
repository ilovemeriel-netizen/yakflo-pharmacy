import { useEffect, useState } from 'react'
import { T, BRAND } from '../theme'
import { fetchMonthlyReport } from '../appApi'

/* /app 보고서 — monthly_snapshots 월별 입고·사용·폐기·반품·기말 요약(연도별).
   집계는 DB측 RPC(0014). 기존 컴포넌트 무수정·신규 추가. */

const glass = {
  background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.6)', borderRadius: 16, boxShadow: '0 6px 24px rgba(46,74,98,0.08)',
}
const YEARS = [2026]
const fmtQ = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 })
const fmtW = (n) => Math.round(Number(n || 0)).toLocaleString('ko-KR')

export default function ReportsPage() {
  const [year, setYear] = useState(2026)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let active = true
    fetchMonthlyReport(year)
      .then((r) => { if (!active) return; setRows(r); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
  }, [year])

  const tot = rows.reduce((a, r) => ({
    items: a.items + Number(r.items || 0), in_qty: a.in_qty + Number(r.in_qty || 0), in_amt: a.in_amt + Number(r.in_amt || 0),
    out_qty: a.out_qty + Number(r.out_qty || 0), out_amt: a.out_amt + Number(r.out_amt || 0),
    disp_qty: a.disp_qty + Number(r.disp_qty || 0), ret_qty: a.ret_qty + Number(r.ret_qty || 0),
  }), { items: 0, in_qty: 0, in_amt: 0, out_qty: 0, out_amt: 0, disp_qty: 0, ret_qty: 0 })

  return (
    <div className="yf-app" style={{ background: 'linear-gradient(135deg,#f4eff8 0%,#eef5f1 100%)', margin: -24, padding: 24, minHeight: 'calc(100vh - 56px)' }}>
      <style>{`@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');.yf-app{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;}`}</style>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 2px', color: T.text }}>월마감 보고서</h1>
          <div style={{ fontSize: 13, color: T.textM }}>monthly_snapshots 월별 입고·사용·폐기·반품·기말 집계</div>
        </div>
        <select value={year} onChange={(e) => { setLoading(true); setYear(Number(e.target.value)) }}
          style={{ padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, background: T.surface, color: T.text }}>
          {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      <section style={{ ...glass, padding: 0, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>불러오는 중…</div>}
        {err && <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 13 }}>오류: {err}</div>}
        {!loading && !err && rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>{year}년 월마감 데이터가 없습니다.</div>}
        {!loading && !err && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
              <thead>
                <tr>
                  {['월', '품목수', '입고량', '입고액(원)', '사용량', '사용액(원)', '폐기량', '반품량', '기말수량', '기말금액(원)'].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.snap_month} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(128,74,135,0.04)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...td, fontWeight: 700, color: BRAND.purple }}>{r.snap_month}월</td>
                    <td style={tdR}>{Number(r.items).toLocaleString()}</td>
                    <td style={tdR}>{fmtQ(r.in_qty)}</td>
                    <td style={tdR}>{fmtW(r.in_amt)}</td>
                    <td style={tdR}>{fmtQ(r.out_qty)}</td>
                    <td style={tdR}>{fmtW(r.out_amt)}</td>
                    <td style={{ ...tdR, color: r.disp_qty > 0 ? '#c0392b' : T.textL }}>{fmtQ(r.disp_qty)}</td>
                    <td style={{ ...tdR, color: r.ret_qty > 0 ? '#b06a00' : T.textL }}>{fmtQ(r.ret_qty)}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: T.text }}>{fmtQ(r.closing_qty)}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: T.text }}>{fmtW(r.closing_amt)}</td>
                  </tr>
                ))}
                <tr style={{ background: 'rgba(46,74,98,0.05)' }}>
                  <td style={{ ...td, fontWeight: 800 }}>합계</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{tot.items.toLocaleString()}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtQ(tot.in_qty)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtW(tot.in_amt)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtQ(tot.out_qty)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtW(tot.out_amt)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtQ(tot.disp_qty)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtQ(tot.ret_qty)}</td>
                  <td style={tdR}>—</td>
                  <td style={tdR}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div style={{ fontSize: 11.5, color: T.textL, marginTop: 12 }}>
        ※ 기말수량·금액은 각 월 스냅샷 합계(누적 아님). 06월은 이월 스냅샷으로 입·출고 0.
      </div>
    </div>
  )
}

const th = { padding: '11px 14px', fontSize: 11, color: T.textL, fontWeight: 600, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.4)' }
const td = { padding: '10px 14px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right', color: T.textM }