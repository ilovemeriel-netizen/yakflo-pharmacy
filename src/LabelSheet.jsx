/* LabelSheet.jsx — A4 한 장에 라벨 12칸(2열 × 6행).
 *
 * ★ 칸 사이 간격은 `SHEET_GAP_MM` **설정값 하나**로 정해진다(`src/lib/labelDefs.js`).
 *   3mm 로 두면 위아래 여백이 6mm 가 된다. 프린터가 종이 가장자리를 못 찍어
 *   맨 아래 줄이 잘리면 **0 으로 바꾸기만** 하면 된다(여백이 13.5mm 로 넓어지고
 *   라벨끼리 선을 나눠 쓴다). 레이저는 보통 4~5mm, 잉크젯은 9~15mm 를 못 찍는다.
 *
 * ★ 자르는 위치 표시는 **바깥 여백에만** 둔다. 라벨 안에 선을 더 그리지 않는다.
 */
import React from 'react'
import { DrugLabel } from './DrugLabel'
import { SHEET, SHEET_GAP_MM, sheetMargins } from './lib/labelDefs'

function TrimMarks({ gap }) {
  const m = sheetMargins(gap)
  const marks = []
  for (let r = 0; r <= SHEET.rows; r++) {
    const y = m.y + r * (SHEET.h + gap) - (r === SHEET.rows ? gap : 0)
    marks.push(<div key={'h' + r} style={{ position: 'absolute', left: '5mm', top: y + 'mm', width: '9mm', height: '0.25mm', background: '#000' }} />)
    marks.push(<div key={'h2' + r} style={{ position: 'absolute', right: '5mm', top: y + 'mm', width: '9mm', height: '0.25mm', background: '#000' }} />)
  }
  for (let col = 0; col <= SHEET.cols; col++) {
    const x = m.x + col * (SHEET.w + gap) - (col === SHEET.cols ? gap : 0)
    marks.push(<div key={'v' + col} style={{ position: 'absolute', left: x + 'mm', top: '2mm', width: '0.25mm', height: '9mm', background: '#000' }} />)
    marks.push(<div key={'v2' + col} style={{ position: 'absolute', left: x + 'mm', bottom: '2mm', width: '0.25mm', height: '9mm', background: '#000' }} />)
  }
  return <>{marks}</>
}

/* 한 쪽 */
export function SheetPage({ items, gap = SHEET_GAP_MM }) {
  const m = sheetMargins(gap)
  return (
    <div className="yp-page" style={{
      width: SHEET.paperW + 'mm', height: SHEET.paperH + 'mm', background: '#fff', position: 'relative',
      padding: `${m.y}mm ${m.x}mm`, display: 'grid',
      gridTemplateColumns: `repeat(${SHEET.cols}, ${SHEET.w}mm)`,
      gridTemplateRows: `repeat(${SHEET.rows}, ${SHEET.h}mm)`,
      gap: gap + 'mm', boxSizing: 'border-box', flexShrink: 0,
      WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
    }}>
      <TrimMarks gap={gap} />
      {items.map((d, i) => <DrugLabel key={i} drug={d} />)}
    </div>
  )
}

/* 여러 쪽 — 인쇄 대상이 되는 묶음 */
export function LabelSheet({ pages, gap = SHEET_GAP_MM, forPrint }) {
  return (
    <div id={forPrint ? 'yakflo-sheet' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: '6mm' }}>
      {(pages || []).map((items, i) => <SheetPage key={i} items={items} gap={gap} />)}
    </div>
  )
}

export default LabelSheet
