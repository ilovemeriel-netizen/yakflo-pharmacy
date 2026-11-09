/* DrugLabel.jsx — 약품식별 라벨 한 장 (85 × 45mm, 원내 양식).
 *
 * 색·차례·줄임 규칙은 `src/lib/labelDefs.js` 에 있다. 여기서는 **그리기만** 한다.
 * 아이콘은 화면 칩과 **같은 SVG**(`src/CautionChips.jsx`)를 그대로 쓴다.
 *
 * ★ 길이 단위를 전부 mm 로 쓴다. 인쇄물이라 화면 픽셀이 아니라 **종이 위 길이**가 기준이다.
 * ★ 뱃지는 **왼쪽 「약품명」 제목 칸 아래**에 둔다. 약품명 칸은 이름만 쓴다 —
 *   예전에는 뱃지를 이름 칸 오른쪽 위에 띄워 두어 **긴 이름을 덮었다**(2026-11-06 실측).
 * ★ 약품명은 **칸에 들어갈 때까지 글자를 줄인다.** 낱말·숫자 중간에서 끊지 않고,
 *   말줄임(…)도 하지 않는다. 약 이름이 잘리면 위험하다.
 */
import React, { useLayoutEffect, useRef } from 'react'
import { CautionIcon, WarnTriangle, ShadeIcon } from './CautionChips'
import {
  labelBg, labelHead, badgeKinds, CAUTION_SHORT, ingredientPair, NAME_MM, SHADE_BG, SHADE_FG,
} from './lib/labelDefs'

/* 칸에 들어갈 때까지 글자를 줄인다 — 말줄임 없음 */
export function FitName({ text, startMm = NAME_MM.start }) {
  const boxRef = useRef(null)
  const txtRef = useRef(null)
  useLayoutEffect(() => {
    const box = boxRef.current, el = txtRef.current
    if (!box || !el) return
    let s = startMm
    el.style.fontSize = s + 'mm'
    let guard = 0
    while (guard++ < 80 && s > NAME_MM.min
      && (el.scrollWidth > box.clientWidth + 1 || el.scrollHeight > box.clientHeight + 1)) {
      s = Math.round((s - NAME_MM.step) * 10) / 10
      el.style.fontSize = s + 'mm'
    }
  }, [text, startMm])
  return (
    <div ref={boxRef} style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <div ref={txtRef} style={{
        fontWeight: 800, fontSize: startMm + 'mm', lineHeight: 1.15,
        wordBreak: 'keep-all', overflowWrap: 'normal',   /* 낱말·숫자를 끊지 않는다 */
      }}>{text}</div>
    </div>
  )
}

/* ★ 제목 칸(17mm) 안에 들어가야 한다. 「고위험」은 세 글자라 가장 길다 —
   글자·아이콘·여백을 그 폭에 맞춰 잡았다. 넘치면 잘리지 않고 칸을 밀어낸다.
   ★ 차광만 색이 다르다(검정 #1F1F1F + 노랑 #FFE082) — ATC 화면과 같은 색으로 읽히게.
     크기·모양·여백·둥글기는 **다른 뱃지와 똑같다**(2026-11-09 확정). */
function Badge({ kind }) {
  const shade = kind === 'shade'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5mm',
      background: shade ? SHADE_BG : '#111', color: shade ? SHADE_FG : '#fff',
      fontWeight: 700, fontSize: '2.1mm', lineHeight: 1,
      padding: '0.5mm 0.8mm', borderRadius: '0.5mm', whiteSpace: 'nowrap', marginTop: '0.7mm',
      maxWidth: '100%', overflow: 'hidden',
      WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
    }}>
      {kind === 'high' ? <WarnTriangle size="2.2mm" />
        : shade ? <ShadeIcon size="2.2mm" color={SHADE_FG} />
          : <CautionIcon kind={kind} size="2.2mm" color="#fff" />}
      {CAUTION_SHORT[kind]}
    </span>
  )
}

export function DrugLabel({ drug, forPrint, idOverride }) {
  const d = drug || {}
  const bg = labelBg(d)
  const head = labelHead(d)
  const kinds = badgeKinds(d)
  const pair = ingredientPair(d.ingredient_en, d.ingredient_kr)
  const both = pair.en && pair.kr
  const only = pair.en || pair.kr

  const cell = { border: '0.35mm solid #000', padding: '1.3mm 1.6mm', verticalAlign: 'middle', overflow: 'hidden' }
  /* ★ whiteSpace:nowrap — 없으면 「약품명」이 「약품/명」으로 접힌다 */
  const th = { ...cell, width: '17mm', background: head, textAlign: 'center', whiteSpace: 'nowrap' }
  /* ★ font 축약형에 inherit 를 넣으면 선언이 통째로 무시된다 — 따로 적는다 */
  const thText = { fontWeight: 800, fontSize: '3.3mm', lineHeight: 1.2, letterSpacing: '0.2mm' }

  return (
    <div
      id={idOverride || (forPrint ? 'yakflo-label' : undefined)}
      style={{
        width: '85mm', height: '45mm', background: bg, color: '#000', position: 'relative',
        overflow: 'hidden', fontFamily: '"맑은 고딕","Malgun Gothic",sans-serif',
        /* 바깥 이중선 — 바깥 선은 border, 안쪽 선은 그림자로 */
        border: '0.5mm solid #000',
        boxShadow: 'inset 0 0 0 0.3mm #FFF, inset 0 0 0 0.75mm #000',
        WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact', flexShrink: 0,
      }}
    >
      {/* 글자는 테두리에서 2.5mm 안쪽 */}
      <table style={{
        position: 'absolute', inset: '2.5mm', width: 'calc(100% - 5mm)', height: 'calc(100% - 5mm)',
        borderCollapse: 'collapse', tableLayout: 'fixed',
      }}>
        <tbody>
          <tr>
            <th style={th}>
              <div style={thText}>약품명</div>
              {/* ★ 뱃지는 **줄바꿈할 수 있어야** 한다 (2026-11-09).
                  제목 칸(17mm)에 `whiteSpace: nowrap` 이 걸려 있어(「약품/명」으로 접히는 것을 막으려고)
                  뱃지가 가로로만 늘어서다 칸 밖으로 나가 **잘렸다** —
                  실측: 휴물린알주100단위(고위험 + 차광)에서 차광 뱃지가 잘렸다.
                  여기서만 줄바꿈을 되살린다. 제목 글자·칸 너비·뱃지 크기는 그대로다. */}
              {kinds.length > 0 && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                  alignItems: 'center', gap: '0.5mm', whiteSpace: 'normal',
                }}>
                  {kinds.map(k => <Badge key={k} kind={k} />)}
                </div>
              )}
            </th>
            <td style={{ ...cell, height: '55%' }}>
              <FitName text={d.drug_name || ''} />
            </td>
          </tr>
          <tr>
            <th style={{ ...th, ...thText }}>성분명</th>
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
