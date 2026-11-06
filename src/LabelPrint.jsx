/* LabelPrint.jsx — 부가기능 → 약품식별 라벨 인쇄.
 *
 * 왼쪽 목록에서 **약품명을 누르면** 오른쪽 미리보기가 바뀌고 **인쇄 창이 바로 열린다.**
 * (기존 약품목록의 약품명 누르는 동작은 건드리지 않는다 — 여기는 별도 화면이다.)
 *
 * 한 번에 한 장만 인쇄한다. 인쇄 설정은 단추가 아니라 화면 아래 안내 글로 둔다.
 *
 * ★ 색이 두 갈래다 — 목록의 칩은 **화면 색**(cautionDefs), 미리보기 라벨은
 *   **인쇄 색**(labelDefs). 섞지 않는다.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useTheme } from './lib/theme'
import { CautionChip, HighAlertChip } from './CautionChips'
import { CAUTION_ORDER } from './lib/cautionDefs'
import { DrugLabel } from './DrugLabel'
import { LABEL_FILTERS, matchSearch, labelPrintCss } from './lib/labelDefs'

const PAGE = 50

export function LabelPrint({ drugs }) {
  const { t } = useTheme()
  const [filter, setFilter] = useState('caution')
  const [kw, setKw] = useState('')
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState(null)
  /* 인쇄 요청 — 숫자가 올라갈 때마다 한 번 인쇄한다.
     미리보기가 먼저 새 약품으로 그려진 뒤에 인쇄해야 하므로 effect 로 미룬다. */
  const [printSeq, setPrintSeq] = useState(0)

  const all = useMemo(() => Array.isArray(drugs) ? drugs : [], [drugs])
  const counts = useMemo(() => {
    const c = {}
    for (const f of LABEL_FILTERS) c[f.id] = all.filter(f.test).length
    return c
  }, [all])

  const rows = useMemo(() => {
    const f = LABEL_FILTERS.find(x => x.id === filter) || LABEL_FILTERS[0]
    return all.filter(d => f.test(d) && matchSearch(d, kw))
      .sort((a, b) => String(a.drug_name || '').localeCompare(String(b.drug_name || ''), 'ko'))
  }, [all, filter, kw])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages)
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE)

  /* 고른 것이 없으면 첫 줄을 보여 준다 — 파생값이라 effect 에서 state 를 건드리지 않는다 */
  const active = sel || shown[0] || rows[0] || null

  useEffect(() => {
    if (printSeq === 0) return
    const id = setTimeout(() => { try { window.print() } catch { /* 인쇄 창을 못 열어도 화면은 그대로 둔다 */ } }, 60)
    return () => clearTimeout(id)
  }, [printSeq])

  function pick(d, alsoPrint) {
    setSel(d)
    if (alsoPrint) setPrintSeq(n => n + 1)
  }

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }
  const ptit = { background: t.bg, padding: '9px 13px', fontSize: 11.5, fontWeight: 700, color: t.textM, borderBottom: `1px solid ${t.border}` }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '18px 16px 40px' }}>
      <style>{labelPrintCss()}</style>

      <div className="no-print" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text }}>약품식별 라벨 인쇄</div>
        <div style={{ fontSize: 11.5, color: t.textM, marginTop: 2 }}>
          85 × 45mm · 컬러 프린터 · 한 장에 한 약품. 주의 표시가 있으면 라벨 바탕색이 바뀝니다.
        </div>
      </div>

      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 390px', gap: 16, alignItems: 'start' }}>
        {/* ── 왼쪽: 목록 ── */}
        <div style={card}>
          <div style={ptit}>약품 목록</div>
          <div style={{ display: 'flex', gap: 5, padding: '10px 13px', flexWrap: 'wrap', borderBottom: `1px solid ${t.border}` }}>
            {LABEL_FILTERS.map(f => (
              <button key={f.id} type="button" onClick={() => { setFilter(f.id); setPage(1) }}
                style={{
                  padding: '5px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  border: `1px solid ${filter === f.id ? t.accent : t.border}`,
                  background: filter === f.id ? t.accent : 'transparent',
                  color: filter === f.id ? '#fff' : t.textM,
                }}>{f.l} {counts[f.id]}</button>
            ))}
          </div>
          <div style={{ padding: '10px 13px' }}>
            <input value={kw} onChange={e => { setKw(e.target.value); setPage(1) }}
              placeholder="약품명 · 코드로 찾기"
              style={{ width: '100%', padding: '7px 11px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }} />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                {['약품', '주의', '구분'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 13px', fontSize: 10.5, fontWeight: 600, color: t.textM, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {shown.map(d => {
                  const on = active && active.drug_code === d.drug_code
                  return (
                    <tr key={d.drug_code} style={{ background: on ? t.accentL : 'transparent' }}>
                      <td style={{ padding: '8px 13px', borderBottom: `1px solid ${t.border}` }}>
                        <button type="button" onClick={() => pick(d, true)}
                          title="누르면 미리보기가 바뀌고 인쇄 창이 열립니다"
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                            color: t.accent, fontWeight: on ? 800 : 600, fontSize: 12.5,
                            textDecoration: 'underline', textUnderlineOffset: 2,
                          }}>{d.drug_name}</button>
                        <div style={{ fontSize: 11, color: t.textL }}>{d.drug_code}</div>
                      </td>
                      <td style={{ padding: '8px 13px', borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }}>
                        {d.is_high_alert ? <><HighAlertChip />{' '}</> : null}
                        {CAUTION_ORDER.filter(x => d[x.col]).map(x => (
                          <React.Fragment key={x.kind}><CautionChip t={t} kind={x.kind} label={x.label} />{' '}</React.Fragment>
                        ))}
                      </td>
                      <td style={{ padding: '8px 13px', borderBottom: `1px solid ${t.border}`, fontSize: 11, color: t.textL, whiteSpace: 'nowrap' }}>{d.category || ''}</td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: '26px 13px', textAlign: 'center', color: t.textL, fontSize: 12 }}>해당하는 약품이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', background: t.bg, fontSize: 11, color: t.textM }}>
            <span>{rows.length}종 중 {shown.length}종</span>
            {pages > 1 && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)}
                  style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${t.border}`, background: t.card, color: t.textM, cursor: cur <= 1 ? 'not-allowed' : 'pointer', fontSize: 11 }}>이전</button>
                <span>{cur} / {pages}</span>
                <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)}
                  style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${t.border}`, background: t.card, color: t.textM, cursor: cur >= pages ? 'not-allowed' : 'pointer', fontSize: 11 }}>다음</button>
              </span>
            )}
          </div>
        </div>

        {/* ── 오른쪽: 미리보기 ── */}
        <div>
          <div style={{ ...ptit, border: `1px solid ${t.border}`, borderBottom: 0, borderRadius: '12px 12px 0 0' }}>
            미리보기 (실제 크기 85 × 45mm)
          </div>
          <div style={{ border: `1px solid ${t.border}`, borderTop: 0, borderRadius: '0 0 12px 12px', padding: 12, background: t.bg }}>
            {active
              ? <div style={{ overflowX: 'auto' }}><DrugLabel drug={active} /></div>
              : <div style={{ padding: '36px 10px', textAlign: 'center', color: t.textL, fontSize: 12 }}>왼쪽에서 약품을 골라 주세요.</div>}

            <button type="button" disabled={!active} onClick={() => setPrintSeq(n => n + 1)}
              style={{
                display: 'block', width: '100%', marginTop: 12, padding: 11, border: 'none', borderRadius: 10,
                background: active ? t.accent : t.textL, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: active ? 'pointer' : 'not-allowed',
              }}>인쇄하기</button>

            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6, color: t.textM, background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 12px' }}>
              <b style={{ color: t.text }}>인쇄 설정</b><br />
              처음 한 번만 — 윈도우 <b>프린터 설정 → 사용자 정의 용지</b>에 <b>라벨85x45</b>(85×45mm, 여백 0)를 등록하세요.<br />
              인쇄할 때마다 — 크롬 인쇄 창에서 <b>용지 라벨85x45</b> · <b>여백 없음</b> · <b>배율 100%</b>(「맞춤」 금지) ·
              <b> 머리글/바닥글 끄기</b> · <b>배경 그래픽 켜기</b>.
            </div>
          </div>
        </div>
      </div>

      {/* 인쇄될 한 장 — 화면에는 보이지 않는다 */}
      <div style={{ position: 'absolute', left: -99999, top: 0 }} aria-hidden="true">
        {active ? <DrugLabel drug={active} forPrint /> : null}
      </div>
    </div>
  )
}

export default LabelPrint
