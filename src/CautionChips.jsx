/* CautionChips.jsx — 고위험 + 주의 표시(용량·모양·발음) 칩의 **그림 한 곳**.
 *
 * 왜 한 파일에 모으나: 같은 칩이 약품 목록·고위험 열·수정 창·등록 창 등 여러 곳에
 * 나온다. 흩어 두면 한 곳만 고치고 나머지를 놓친다(⚠ 아이콘 교체처럼 「모든 곳 같게」가
 * 요구사항일 때 특히 그렇다).
 *
 * 색·차례·칸 이름은 `src/lib/cautionDefs.js` 에 있다. 여기서는 **그리기만** 한다.
 *
 * 아이콘은 전부 직접 그린 SVG 다. 이모지를 쓰지 않는다 — 이모지는 컴퓨터마다
 * 모양과 색이 달라지고, 칩 글씨색을 따르지 않는다.
 */
import React from 'react'
import {
  HIGH_ALERT_BG, HIGH_ALERT_FG, cautionChipColors, cautionsOf,
} from './lib/cautionDefs'

/* ── 아이콘 ──────────────────────────────────────────────────────────── */

/* 고위험 — 병원 게시물과 같은 모양: 노랑 안쪽 + 빨강 테두리 삼각형 + 진한 느낌표.
   ★ 칩 글씨색을 따르지 않는다. 이 세 색은 표지판 색이라 고정이다.
   (2026-11-06 이정화 님 승인 — 기존 ⚠ 글자를 이 그림으로 바꾼다) */
export function WarnTriangle({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <path d="M12 2.6 L22.4 20.6 H1.6 Z"
        fill="#FFD400" stroke="#D9342B" strokeWidth="2.6" strokeLinejoin="round" />
      <rect x="10.7" y="8.3" width="2.6" height="6.4" rx="1.3" fill="#7A1510" />
      <circle cx="12" cy="17.1" r="1.5" fill="#7A1510" />
    </svg>
  )
}

/* 용량 — 저울 */
export function ScaleIcon({ size = 11, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <g stroke={color} strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M5 6 H19" />
        <path d="M12 4 V19.5" />
        <path d="M7.5 20.5 H16.5" />
      </g>
      {/* 양쪽 접시 — 작게 줄여도 알아볼 수 있게 넓고 얕은 삼각형으로 */}
      <path d="M5 7 L9.2 14 H0.8 Z" fill={color} />
      <path d="M19 7 L23.2 14 H14.8 Z" fill={color} />
    </svg>
  )
}

/* 모양 — 캡슐 (비스듬히 누운 알약, 한쪽만 채움) */
export function CapsuleIcon({ size = 11, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <g transform="rotate(-45 12 12)">
        <rect x="2" y="8.5" width="20" height="7" rx="3.5"
          fill="none" stroke={color} strokeWidth="2.2" />
        <path d="M12 8.5 H18.5 A3.5 3.5 0 0 1 18.5 15.5 H12 Z" fill={color} />
      </g>
    </svg>
  )
}

/* 발음 — 말풍선 */
export function BubbleIcon({ size = 11, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <path d="M4 3.5 H20 A2.5 2.5 0 0 1 22.5 6 V14.5 A2.5 2.5 0 0 1 20 17 H10.5 L6 21.5 V17 H4
               A2.5 2.5 0 0 1 1.5 14.5 V6 A2.5 2.5 0 0 1 4 3.5 Z" fill={color} />
    </svg>
  )
}

export function CautionIcon({ kind, size = 11, color = 'currentColor' }) {
  if (kind === 'dose') return <ScaleIcon size={size} color={color} />
  if (kind === 'shape') return <CapsuleIcon size={size} color={color} />
  if (kind === 'sound') return <BubbleIcon size={size} color={color} />
  return <WarnTriangle size={size} />
}

/* ── 칩 ──────────────────────────────────────────────────────────────── */
/* 운영 Bd 부품과 **같은 모양**: radius 8 · fontSize 10 · padding 3/10 · 같은 그림자.
   아이콘이 들어가므로 inline-flex 로 세로 가운데를 맞춘다. */
export function Chip({ bg, color, icon, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color, padding: '3px 10px', borderRadius: 8,
      fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', verticalAlign: 'middle',
    }}>
      {icon}{children}
    </span>
  )
}

export function HighAlertChip() {
  return <Chip bg={HIGH_ALERT_BG} color={HIGH_ALERT_FG} icon={<WarnTriangle />}>고위험</Chip>
}

export function CautionChip({ t, kind, label }) {
  const { bg, fg } = cautionChipColors(t, kind)
  return <Chip bg={bg} color={fg} icon={<CautionIcon kind={kind} color={fg} />}>{label}</Chip>
}

/* 약품 한 줄에 붙는 칩 전부 — 고위험이 **언제나 맨 앞**, 주의 3종이 그 뒤.
   칩이 하나도 없으면 아무것도 그리지 않는다(빈 칸이 생기지 않게). */
export function DrugChips({ d, t }) {
  const list = cautionsOf(d)
  if (!d || (!d.is_high_alert && list.length === 0)) return null
  return (
    <>
      {d.is_high_alert ? <><HighAlertChip />{' '}</> : null}
      {list.map(x => (
        <React.Fragment key={x.kind}>
          <CautionChip t={t} kind={x.kind} label={x.label} />{' '}
        </React.Fragment>
      ))}
    </>
  )
}
