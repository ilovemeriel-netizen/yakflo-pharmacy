import { useEffect, useState } from 'react'
import { T, BRAND } from '../theme'
import { fetchMonthlyReport, fetchMonthlyReportDetail } from '../appApi'

/* /app 보고서 — 월간 보고서 양식(단일 월) + 연간 요약 표 + A4 인쇄 양식.
   집계는 DB측 RPC(0014 app_monthly_report, 0017 app_monthly_report_detail). 기존 컴포넌트 무수정·신규 추가.
   인쇄: @media print로 격리(.yf-print-report만 보임), 화면 레이아웃 회귀 0. */

const HOSPITAL = '씨엔씨재활의학과병원' // 병원명(인쇄 양식 헤더)
const COPYRIGHT = 'Copyright © 2026 Jeonghwa Lee. All rights reserved.'
const pad2 = (n) => String(n).padStart(2, '0')
const stampNow = () => {
  const n = new Date()
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())} ${pad2(n.getHours())}:${pad2(n.getMinutes())} 작성`
}
const PRINT_CSS = '.yf-print-report{display:none}@media print{body *{visibility:hidden!important}.yf-print-report,.yf-print-report *{visibility:visible!important}.yf-print-report{display:block!important;position:absolute;left:0;top:0;width:100%}.yf-no-print{display:none!important}@page{size:A4;margin:13mm}}'

const glass = {
  background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.6)', borderRadius: 16, boxShadow: '0 6px 24px rgba(46,74,98,0.08)',
}
const YEARS = [2026]
const fmtQ = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 })
const fmtW = (n) => Math.round(Number(n || 0)).toLocaleString('ko-KR')
const fmtN = (n) => Number(n || 0).toLocaleString('ko-KR')
const today = () => new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

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
      <style>{PRINT_CSS}</style>

      <div className="yf-no-print" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 2px', color: T.text }}>월마감 보고서</h1>
          <div style={{ fontSize: 13, color: T.textM }}>월간 보고서 양식 + 연간 요약 (monthly_snapshots 집계)</div>
        </div>
        <select value={year} onChange={(e) => { setLoading(true); setYear(Number(e.target.value)) }}
          style={{ padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, background: T.surface, color: T.text }}>
          {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      <MonthlyReport year={year} />

      <h2 className="yf-no-print" style={{ fontSize: 15, fontWeight: 800, color: T.text, margin: '22px 0 10px' }}>연간 요약</h2>
      <section className="yf-no-print" style={{ ...glass, padding: 0, overflow: 'hidden' }}>
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
                  <td style={{ ...tdR, fontWeight: 700, color: T.textL }} title="품목수는 월간 합산 불가(중복)">—</td>
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

      <div className="yf-no-print" style={{ fontSize: 11.5, color: T.textL, marginTop: 12 }}>
        ※ 기말수량·금액은 각 월 스냅샷 합계(누적 아님). 06월은 이월 스냅샷으로 입·출고 0.
      </div>
    </div>
  )
}

/* 월간 보고서(단일 월) — 결산 양식 6개 섹션 + A4 인쇄 양식 */
function MonthlyReport({ year }) {
  const [month, setMonth] = useState(5)
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let active = true
    fetchMonthlyReportDetail(year, month)
      .then((r) => { if (!active) return; setD(r); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
  }, [year, month])

  const monthOpts = (d && Array.isArray(d.months) && d.months.length) ? d.months : [1, 2, 3, 4, 5, 6]

  const prevStock = d ? (Number(d.prev_closing_amt) > 0 ? Number(d.prev_closing_amt) : Number(d.opening_amt)) : 0
  const delta = d ? Number(d.closing_amt) - prevStock : 0
  const netCnt = d ? Number(d.in_cnt) - Number(d.out_cnt) : 0
  const netAmt = d ? Number(d.in_amt) - Number(d.out_amt) : 0
  const lossCnt = d ? Number(d.disp_cnt) + Number(d.ret_cnt) : 0
  const lossAmt = d ? Number(d.disp_amt) + Number(d.ret_amt) : 0

  return (
    <>
      <section className="yf-no-print" style={{ ...glass, padding: 0, overflow: 'hidden' }}>
        {/* ① 헤더 */}
        <div style={{ background: 'linear-gradient(135deg,#804A87 0%,#6d3f74 100%)', color: '#fff', padding: '18px 22px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.85, letterSpacing: 1 }}>{HOSPITAL}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>{year}년 {month}월 월간 재고 보고서</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={month} onChange={(e) => { setLoading(true); setMonth(Number(e.target.value)) }}
              style={{ padding: '7px 11px', border: 'none', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.92)', color: T.text, fontWeight: 700 }}>
              {monthOpts.map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
            <button onClick={() => window.print()} disabled={!d}
              style={{ padding: '7px 13px', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, background: '#fff', color: BRAND.purple, cursor: d ? 'pointer' : 'default', opacity: d ? 1 : 0.5 }}>🖨 인쇄</button>
          </div>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: T.textL, fontSize: 13 }}>불러오는 중…</div>}
        {err && <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 13 }}>오류: {err}</div>}
        {!loading && !err && d && (
          <div style={{ padding: 22 }}>
            {/* ② 재고현황 */}
            <Block title="② 재고 현황">
              <Cell label="관리 품목수" value={`${fmtN(d.items)} 종`} />
              <Cell label="전월재고 금액" value={`${fmtW(prevStock)} 원`} />
              <Cell label="현재고 금액" value={`${fmtW(d.closing_amt)} 원`} strong />
              <Cell label="증감" value={`${fmtW(delta)} 원`} color={delta >= 0 ? BRAND.green : '#c0392b'} />
            </Block>

            {/* ③ 입출고현황 */}
            <Block title="③ 입출고 현황">
              <Cell label="입고" value={`${fmtN(d.in_cnt)} 건`} sub={`${fmtW(d.in_amt)} 원`} />
              <Cell label="출고" value={`${fmtN(d.out_cnt)} 건`} sub={`${fmtW(d.out_amt)} 원`} />
              <Cell label="순입고(입고−출고)" value={`${fmtN(netCnt)} 건`} sub={`${fmtW(netAmt)} 원`} color={netAmt >= 0 ? BRAND.green : '#c0392b'} />
            </Block>

            {/* ④ 손실현황 */}
            <Block title="④ 손실 현황">
              <Cell label="폐기" value={`${fmtN(d.disp_cnt)} 건`} sub={`${fmtW(d.disp_amt)} 원`} color={Number(d.disp_cnt) > 0 ? '#c0392b' : T.textM} />
              <Cell label="반품" value={`${fmtN(d.ret_cnt)} 건`} sub={`${fmtW(d.ret_amt)} 원`} color={Number(d.ret_cnt) > 0 ? '#b06a00' : T.textM} />
              <Cell label="손실 합계" value={`${fmtN(lossCnt)} 건`} sub={`${fmtW(lossAmt)} 원`} strong />
            </Block>

            {/* ⑤ 유효기간 관리 */}
            <Block title="⑤ 유효기간 관리 (현재 시점 기준)">
              <Cell label="만료" value={`${fmtN(d.exp_expired)} 종`} color={Number(d.exp_expired) > 0 ? '#c0392b' : T.textM} />
              <Cell label="긴급 (30일)" value={`${fmtN(d.exp_urgent30)} 종`} color={Number(d.exp_urgent30) > 0 ? '#c0392b' : T.textM} />
              <Cell label="주의 (60일)" value={`${fmtN(d.exp_warn60)} 종`} color={Number(d.exp_warn60) > 0 ? '#b06a00' : T.textM} />
              <Cell label="확인 (90일)" value={`${fmtN(d.exp_check90)} 종`} color={Number(d.exp_check90) > 0 ? BRAND.purple : T.textM} />
            </Block>

            {/* ⑥ 작성일·작성자 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 28, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.border}`, fontSize: 12.5, color: T.textM }}>
              <span>작성일: <b style={{ color: T.text }}>{today()}</b></span>
              <span>작성자: <b style={{ color: T.text }}>약제과</b></span>
            </div>
            <div style={{ fontSize: 11.5, color: T.textL, marginTop: 8 }}>
              ※ 폐기·반품 금액은 행 단가(기말금액/기말수량) 기반 — 결산 KPI와 일치. 유효기간은 현재 재고 기준(월별 스냅샷 아님).
            </div>
          </div>
        )}
      </section>

      {/* A4 인쇄 전용 양식 — 화면 숨김, @media print에서만 표시 */}
      {!loading && !err && d && (
        <PrintableMonthlyReport year={year} month={month} d={d}
          prevStock={prevStock} delta={delta} netCnt={netCnt} netAmt={netAmt} lossCnt={lossCnt} lossAmt={lossAmt} />
      )}
    </>
  )
}

/* A4 1페이지 인쇄 양식 (첨부 PDF 사양) */
function PrintableMonthlyReport({ year, month, d, prevStock, delta, netCnt, netAmt, lossCnt, lossAmt }) {
  return (
    <div className="yf-print-report" style={{ color: '#222', background: '#fff', fontSize: 13, lineHeight: 1.4 }}>
      <div style={{ background: BRAND.purple, color: '#fff', padding: '12px 16px', textAlign: 'center', fontSize: 19, fontWeight: 800 }}>🏥 {HOSPITAL} 약품관리 월간보고서</div>
      <div style={{ textAlign: 'center', color: BRAND.purple, fontWeight: 700, margin: '8px 0 14px' }}>▶ 보고월: {year}년 {month}월</div>

      <PSection title="■ 재고 현황">
        <PRow label="관리 품목수" bg="#e3f0e3" value={`${fmtN(d.items)}개`} />
        <PRow label="현재고" bg="#e3f0e3" value={`${fmtW(d.closing_amt)}원`} />
        <PRow label="전월재고" bg="#e3f0e3" value={`${fmtW(prevStock)}원`} />
        <PRow label="증감" bg="#e3f0e3" value={`${fmtW(delta)}원`} />
      </PSection>

      <PSection title="■ 입출고 현황">
        <PRow2 label="입고" bg="#ece4f1" cnt={`${fmtN(d.in_cnt)}건`} amt={`${fmtW(d.in_amt)}원`} />
        <PRow2 label="출고" bg="#f1e4ee" cnt={`${fmtN(d.out_cnt)}건`} amt={`${fmtW(d.out_amt)}원`} />
        <PRow2 label="순입고" bg="#ececec" cnt={`${fmtN(netCnt)}건`} amt={`${fmtW(netAmt)}원`} />
      </PSection>

      <PSection title="■ 손실 현황">
        <PRow2 label="폐기" bg="#f6dede" cnt={`${fmtN(d.disp_cnt)}건`} amt={`${fmtW(d.disp_amt)}원`} />
        <PRow2 label="반품" bg="#f7f3d6" cnt={`${fmtN(d.ret_cnt)}건`} amt={`${fmtW(d.ret_amt)}원`} />
        <PRow2 label="손실(단순합)" bg={BRAND.purple} fg="#fff" cnt={`${fmtN(lossCnt)}건`} amt={`${fmtW(lossAmt)}원`} />
      </PSection>

      <PSection title="■ 유효기간 관리">
        <PRow label="★ 만료" bg="#f6dede" value={`${fmtN(d.exp_expired)}건`} />
        <PRow label="▲ 긴급 (30일)" bg="#fce6cf" value={`${fmtN(d.exp_urgent30)}건`} />
        <PRow label="◆ 주의 (60일)" bg="#f7f3d6" value={`${fmtN(d.exp_warn60)}건`} />
        <PRow label="● 확인 (90일)" bg="#e3f0e3" value={`${fmtN(d.exp_check90)}건`} />
      </PSection>

      <div style={{ textAlign: 'center', color: '#999', fontSize: 11, marginTop: 22 }}>
        <div>{stampNow()}</div>
        <div>{COPYRIGHT}</div>
      </div>
    </div>
  )
}

function PSection({ title, children }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ background: BRAND.green, color: '#fff', fontWeight: 800, fontSize: 13.5, padding: '5px 10px' }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><tbody>{children}</tbody></table>
    </div>
  )
}

function PRow({ label, value, bg }) {
  return (
    <tr>
      <td style={{ ...pTd, background: bg || '#eee', fontWeight: 700, width: '42%' }}>{label}</td>
      <td style={{ ...pTd, textAlign: 'right', fontWeight: 800, color: BRAND.purple }}>{value}</td>
    </tr>
  )
}

function PRow2({ label, cnt, amt, bg, fg }) {
  return (
    <tr>
      <td style={{ ...pTd, background: bg || '#eee', color: fg || '#222', fontWeight: 700, width: '42%' }}>{label}</td>
      <td style={{ ...pTd, textAlign: 'right', width: '29%' }}>{cnt}</td>
      <td style={{ ...pTd, textAlign: 'right', width: '29%', fontWeight: 700 }}>{amt}</td>
    </tr>
  )
}

function Block({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.purple, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>{children}</div>
    </div>
  )
}

function Cell({ label, value, sub, color, strong }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px', background: strong ? 'rgba(128,74,135,0.05)' : T.surface }}>
      <div style={{ fontSize: 11.5, color: T.textL, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || T.text }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.textM, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const th = { padding: '11px 14px', fontSize: 11, color: T.textL, fontWeight: 600, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.4)' }
const td = { padding: '10px 14px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
const tdR = { ...td, textAlign: 'right', color: T.textM }
const pTd = { border: '1px solid #bbb', padding: '6px 10px' }