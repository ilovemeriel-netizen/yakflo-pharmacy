/* LabelPrint.jsx — 부가기능 → 약품식별 라벨 인쇄.
 *
 * 왼쪽 목록에서 **약품명을 누르면** 미리보기가 바뀌고 **인쇄 창이 바로 열린다.**
 * 체크박스로 여러 개를 골라 **A4 한 장(12칸)** 에 모아 뽑을 수도 있다.
 * (기존 약품목록의 약품명 누르는 동작은 건드리지 않는다 — 여기는 별도 화면이다.)
 *
 * ★ 색이 두 갈래다 — 목록의 칩은 **화면 색**(cautionDefs), 미리보기 라벨은
 *   **인쇄 색**(labelDefs). 섞지 않는다.
 * ★ 표 셀에 `textAlign: 'left'` 를 **적어 둔다.** 앱 전체에 `#root { text-align: center }`
 *   가 걸려 있어(index.css) 적지 않으면 가운데로 밀린다 — 머리글만 왼쪽이라 어긋난다.
 *   (2026-11-06 실측: 약품명 단추가 왼쪽에서 146px 밀려 있었다.)
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useTheme } from './lib/theme'
import { CautionChip, HighAlertChip, ShadeChip } from './CautionChips'
import { DrugLabel } from './DrugLabel'
import { LabelSheet } from './LabelSheet'
import MP from './MultiPick'
import { VOCAB } from './lib/drugRules'
import {
  LABEL_FILTERS, matchSearch, labelPrintCss, sheetPrintCss,
  SHEET_GAP_MM, SHEET_PER_PAGE, QTY_MAX, expandForSheet, paginate,
  badgeKinds, CAUTION_SHORT,
} from './lib/labelDefs'

const PAGE = 50

export function LabelPrint({ drugs }) {
  const { t } = useTheme()
  const [filter, setFilter] = useState('caution')
  /* ★ 기본은 상태 「사용」만 — 중지·휴면 약은 라벨을 뽑을 일이 드물다 */
  const [stats, setStats] = useState(['사용'])
  const [kw, setKw] = useState('')
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [qty, setQty] = useState({})
  /* 인쇄 요청 — 숫자가 올라갈 때마다 한 번 인쇄한다(미리보기가 먼저 그려지도록 미룬다) */
  const [printSeq, setPrintSeq] = useState(0)
  const [printMode, setPrintMode] = useState('one')   /* 'one' | 'sheet' */

  const all = useMemo(() => Array.isArray(drugs) ? drugs : [], [drugs])
  /* ★ 상태로 **먼저** 거른다 — 거르개 숫자도 이 묶음에서 센다.
     그래야 상태를 바꾸면 「용량 29」 같은 숫자도 함께 바뀐다. */
  const inStat = useMemo(
    () => all.filter(d => stats.includes(String(d.status || '').trim())),
    [all, stats])
  const counts = useMemo(() => {
    const c = {}
    for (const f of LABEL_FILTERS) c[f.id] = inStat.filter(f.test).length
    return c
  }, [inStat])

  const rows = useMemo(() => {
    const f = LABEL_FILTERS.find(x => x.id === filter) || LABEL_FILTERS[0]
    return inStat.filter(d => f.test(d) && matchSearch(d, kw))
      .sort((a, b) => String(a.drug_name || '').localeCompare(String(b.drug_name || ''), 'ko'))
  }, [inStat, filter, kw])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages)
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE)
  /* 고른 것이 없으면 첫 줄을 보여 준다 — 파생값이라 effect 에서 state 를 건드리지 않는다 */
  const active = sel || shown[0] || rows[0] || null

  const pickedDrugs = useMemo(() => all.filter(d => picked.has(d.drug_code)), [all, picked])
  const sheetItems = useMemo(() => expandForSheet(pickedDrugs, qty), [pickedDrugs, qty])
  const sheetPages = useMemo(() => paginate(sheetItems, SHEET_PER_PAGE), [sheetItems])

  useEffect(() => {
    if (printSeq === 0) return
    const id = setTimeout(() => { try { window.print() } catch { /* 인쇄 창을 못 열어도 화면은 그대로 둔다 */ } }, 60)
    return () => clearTimeout(id)
  }, [printSeq])

  function pick(d, alsoPrint) {
    setSel(d)
    if (alsoPrint) { setPrintMode('one'); setPrintSeq(n => n + 1) }
  }
  function toggle(code) {
    setPicked(p => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n })
  }
  function pickAllShown() { setPicked(p => { const n = new Set(p); for (const d of shown) n.add(d.drug_code); return n }) }
  function clearAll() { setPicked(new Set()) }
  function setQ(code, v) {
    const n = Math.max(1, Math.min(QTY_MAX, Number(v) || 1))
    setQty(q => ({ ...q, [code]: n }))
  }

  const card = { background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden' }
  const ptit = { background: t.bg, padding: '9px 13px', fontSize: 11.5, fontWeight: 700, color: t.textM, borderBottom: `1px solid ${t.border}` }
  /* ★ 셀 정렬을 명시한다 — 상속에 기대지 않는다 */
  const td = { textAlign: 'left', padding: '8px 13px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' }
  const th = { textAlign: 'left', padding: '7px 13px', fontSize: 10.5, fontWeight: 600, color: t.textM, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' }
  const lnk = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: t.accent, textDecoration: 'underline' }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '18px 16px 40px', textAlign: 'left' }}>
      <style>{printMode === 'sheet' ? sheetPrintCss(SHEET_GAP_MM) : labelPrintCss()}</style>

      <div className="no-print" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text }}>약품식별 라벨 인쇄</div>
        <div style={{ fontSize: 11.5, color: t.textM, marginTop: 2 }}>
          85 × 45mm · 컬러 프린터. 한 장씩 뽑거나, 여러 개를 골라 A4 한 장(12칸)에 모아 뽑습니다.
        </div>
      </div>

      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 16, alignItems: 'start' }}>
        {/* ── 왼쪽: 목록 ── */}
        <div style={card}>
          <div style={{ ...ptit, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>약품 목록</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={pickAllShown} style={lnk}>모두 선택</button>
              <button type="button" onClick={clearAll} style={lnk}>선택 해제</button>
            </span>
          </div>

          {/* ★ 약품목록 화면과 **같은 부품**(MultiPick)·같은 모양·같은 색을 쓴다 */}
          <div style={{ padding: '10px 13px 0' }}>
            <MP items={VOCAB.status} selected={stats}
              onChange={v => { setStats(v); setPage(1) }} color={t.green} label="상태" />
          </div>

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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead><tr>
                <th style={{ ...th, width: 34 }} aria-label="선택" />
                <th style={th}>약품</th><th style={th}>주의</th>
                <th style={{ ...th, width: 104 }}>장수</th><th style={th}>구분</th>
              </tr></thead>
              <tbody>
                {shown.map(d => {
                  const on = active && active.drug_code === d.drug_code
                  const checked = picked.has(d.drug_code)
                  return (
                    <tr key={d.drug_code} style={{ background: on ? t.accentL : 'transparent' }}>
                      <td style={td}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(d.drug_code)}
                          aria-label={d.drug_name + ' 고르기'}
                          style={{ width: 16, height: 16, accentColor: t.accent, cursor: 'pointer' }} />
                      </td>
                      <td style={td}>
                        <button type="button" onClick={() => pick(d, true)}
                          title="누르면 미리보기가 바뀌고 인쇄 창이 열립니다"
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                            color: t.accent, fontWeight: on ? 800 : 600, fontSize: 12.5,
                            textDecoration: 'underline', textUnderlineOffset: 2,
                          }}>{d.drug_name}</button>
                        <div style={{ fontSize: 11, color: t.textL, textAlign: 'left' }}>{d.drug_code}</div>
                      </td>
                      {/* 주의 — 고위험 > 차광 > 발음 > 모양 > 용량.
                          ★ 85×45 라벨과 **같은 함수**(badgeKinds)로 차례를 맞춘다. 한 약이
                            종이와 화면에서 다른 차례로 보이면 그게 더 헷갈린다.
                          ★ 차광 칩은 **보이기만** 한다 — 「주의 있는 약만」 거르개 판정
                            (cautionOnlyKinds)에는 들어가지 않아 개수는 73 그대로다.
                          (2026-11-09 이정화 님 요청) */}
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {badgeKinds(d).map(k => (
                          <React.Fragment key={k}>
                            {k === 'high' ? <HighAlertChip />
                              : k === 'shade' ? <ShadeChip />
                                : <CautionChip t={t} kind={k} label={CAUTION_SHORT[k]} />}{' '}
                          </React.Fragment>
                        ))}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {checked ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${t.border}`, borderRadius: 7, overflow: 'hidden', background: t.card }}>
                            <button type="button" aria-label={d.drug_name + ' 한 장 줄이기'} onClick={() => setQ(d.drug_code, (qty[d.drug_code] || 1) - 1)}
                              style={{ border: 'none', background: t.bg, color: t.textM, fontWeight: 700, fontSize: 12, lineHeight: 1, padding: '5px 8px', cursor: 'pointer' }}>−</button>
                            <input value={qty[d.drug_code] || 1} onChange={e => setQ(d.drug_code, e.target.value)}
                              aria-label={d.drug_name + ' 장수'}
                              style={{ width: 34, border: 'none', outline: 'none', textAlign: 'center', fontWeight: 700, fontSize: 12, lineHeight: 1, padding: '5px 0', background: t.card, color: t.text }} />
                            <button type="button" aria-label={d.drug_name + ' 한 장 늘리기'} onClick={() => setQ(d.drug_code, (qty[d.drug_code] || 1) + 1)}
                              style={{ border: 'none', background: t.bg, color: t.textM, fontWeight: 700, fontSize: 12, lineHeight: 1, padding: '5px 8px', cursor: 'pointer' }}>+</button>
                          </span>
                        ) : <span style={{ color: t.textL }}>—</span>}
                      </td>
                      <td style={{ ...td, fontSize: 11, color: t.textL, whiteSpace: 'nowrap' }}>{d.category || ''}</td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: '26px 13px', color: t.textL }}>해당하는 약품이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', background: t.bg, fontSize: 11.5, color: t.textM, flexWrap: 'wrap', gap: 8 }}>
            <span>
              {rows.length}종 중 {shown.length}종 표시 ·{' '}
              고른 약 <b style={{ color: t.text }}>{picked.size}종</b> · 뽑을 라벨{' '}
              <b style={{ color: t.text }}>{sheetItems.length}장</b> → A4{' '}
              <b style={{ color: t.text }}>{sheetPages.length}장</b>
            </span>
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

            <button type="button" disabled={!active}
              onClick={() => { setPrintMode('one'); setPrintSeq(n => n + 1) }}
              style={{
                display: 'block', width: '100%', marginTop: 12, padding: 11, border: 'none', borderRadius: 10,
                background: active ? t.accent : t.textL, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: active ? 'pointer' : 'not-allowed',
              }}>이 약 한 장 인쇄 (85 × 45mm)</button>

            <button type="button" disabled={sheetItems.length === 0}
              onClick={() => { setPrintMode('sheet'); setPrintSeq(n => n + 1) }}
              style={{
                display: 'block', width: '100%', marginTop: 8, padding: 10, borderRadius: 10,
                border: `1.5px solid ${sheetItems.length ? t.accent : t.border}`,
                background: t.card, color: sheetItems.length ? t.accent : t.textL,
                fontSize: 12.5, fontWeight: 700, cursor: sheetItems.length ? 'pointer' : 'not-allowed',
              }}>
              고른 {sheetItems.length}장 A4로 인쇄 ({sheetPages.length}장)
            </button>

            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6, color: t.textM, background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 12px' }}>
              <b style={{ color: t.text }}>인쇄 설정</b><br />
              <b>한 장</b> — 윈도우 프린터 설정에 <b>라벨85x45</b>(85×45mm, 여백 0)를 등록한 뒤,
              크롬 인쇄 창에서 용지 <b>라벨85x45</b> · 여백 <b>없음</b> · 배율 <b>100%</b> ·
              머리글/바닥글 끄기 · <b>배경 그래픽 켜기</b>.<br />
              <b>A4</b> — 용지 <b>A4</b> · 여백 <b>없음</b> · 배율 <b>100%</b> · 배경 그래픽 켜기.
              맨 아래 줄이 잘리면 알려 주세요(칸 간격을 0으로 바꿉니다).
            </div>
          </div>
        </div>
      </div>

      {/* 인쇄될 것 — 화면에는 보이지 않는다 */}
      <div style={{ position: 'absolute', left: -99999, top: 0 }} aria-hidden="true">
        {printMode === 'sheet'
          ? <LabelSheet pages={sheetPages} forPrint />
          : (active ? <DrugLabel drug={active} forPrint /> : null)}
      </div>
    </div>
  )
}

export default LabelPrint
