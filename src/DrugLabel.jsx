/* DrugLabel.jsx — 약품식별 라벨 한 장 (85 × 45mm, 원내 양식).
 *
 * 색·차례·줄임 규칙은 `src/lib/labelDefs.js` 에 있다. 여기서는 **그리기만** 한다.
 * 아이콘은 화면 칩과 **같은 SVG**(`src/CautionChips.jsx`)를 그대로 쓴다.
 *
 * ★ 길이 단위를 전부 mm 로 쓴다. 인쇄물이라 화면 픽셀이 아니라 **종이 위 길이**가 기준이다.
 * ★ 인쇄 규칙(@page)은 `labelPrintCss()` 가 돌려준다. 화면에 띄울 때는 쓰지 않는다.
 */
import React from 'react'
import { CautionIcon } from './CautionChips'
import {
  labelBg, labelHead, badgeKinds, CAUTION_LABEL, nameSizeMm, ingredientPair,
} from './lib/labelDefs'

export function DrugLabel({ drug, forPrint }) {
  const d = drug || {}
  const bg = labelBg(d)
  const head = labelHead(d)
  const kinds = badgeKinds(d)
  const pair = ingredientPair(d.ingredient_en, d.ingredient_kr)
  const both = pair.en && pair.kr
  const only = pair.en || pair.kr

  const cell = { border: '0.35mm solid #000', padding: '1.4mm 1.8mm', verticalAlign: 'middle', overflow: 'hidden' }
  /* ★ whiteSpace:nowrap — 없으면 「약품명」이 「약품/명」으로 접힌다 */
  const th = { ...cell, width: '17mm', background: head, font: '800 3.6mm/1.2 inherit', textAlign: 'center', letterSpacing: '0.2mm', whiteSpace: 'nowrap' }

  return (
    <div
      id={forPrint ? 'yakflo-label' : undefined}
      style={{
        width: '85mm', height: '45mm', background: bg, color: '#000', position: 'relative',
        overflow: 'hidden', fontFamily: '"맑은 고딕","Malgun Gothic",sans-serif',
        /* 바깥 이중선 — 바깥 선은 border, 안쪽 선은 그림자로 */
        border: '0.5mm solid #000',
        boxShadow: 'inset 0 0 0 0.3mm #FFF, inset 0 0 0 0.75mm #000',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      }}
    >
      {/* 글자는 테두리에서 2.5mm 안쪽 */}
      <table style={{
        position: 'absolute', inset: '2.5mm', width: 'calc(100% - 5mm)', height: 'calc(100% - 5mm)',
        borderCollapse: 'collapse', tableLayout: 'fixed',
      }}>
        <tbody>
          <tr>
            <th style={th}>약품명</th>
            <td style={{ ...cell, height: '55%' }}>
              <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                {kinds.length > 0 && (
                  <span style={{
                    position: 'absolute', top: '-0.6mm', right: '-0.6mm', display: 'inline-flex',
                    alignItems: 'center', gap: '0.9mm', background: '#111', color: '#fff',
                    font: '700 2.7mm/1 inherit', padding: '0.9mm 1.5mm', borderRadius: '0.8mm',
                    WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
                  }}>
                    <CautionIcon kind={kinds[0]} size="3mm" color="#fff" />
                    {CAUTION_LABEL[kinds[0]]}
                  </span>
                )}
                <div style={{
                  fontWeight: 800, fontSize: nameSizeMm(d.drug_name) + 'mm', lineHeight: 1.15,
                  wordBreak: 'keep-all', overflowWrap: 'anywhere', paddingRight: '1mm',
                }}>{d.drug_name || ''}</div>
              </div>
            </td>
          </tr>
          <tr>
            <th style={th}>성분명</th>
            <td style={cell}>
              <div style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                gap: '0.8mm', height: '100%',
              }}>
                {both ? (<>
                  <div style={{ fontWeight: 700, fontSize: pair.en.sizeMm + 'mm', lineHeight: 1.2, wordBreak: 'break-word' }}>{pair.en.text}</div>
                  <div style={{ fontWeight: 700, fontSize: pair.kr.sizeMm + 'mm', lineHeight: 1.2, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{pair.kr.text}</div>
                </>) : only ? (
                  /* 한쪽이 비면 남은 줄을 가운데에 둔다 */
                  <div style={{ fontWeight: 700, fontSize: (only.sizeMm + 0.3) + 'mm', lineHeight: 1.25, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{only.text}</div>
                ) : (
                  <div style={{ fontWeight: 400, fontSize: '3.2mm', color: '#666' }}>—</div>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default DrugLabel
