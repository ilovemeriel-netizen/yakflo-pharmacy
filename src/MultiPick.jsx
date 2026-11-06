/* MultiPick.jsx — 구분·상태를 고르는 칩 묶음 (「전체」 + 항목들).
 *
 * ★ App.jsx 에서 그대로 옮겨 왔다. 모양·색·동작을 **한 글자도 바꾸지 않았다.**
 *   약품목록·재고현황·발주관리 등 여덟 곳이 이미 쓰고 있고,
 *   라벨 인쇄 화면도 같은 부품을 써야 해서 파일만 나눈 것이다.
 *   (App.jsx 안에 두면 라벨 화면이 App 을 거꾸로 불러 고리가 생긴다.)
 */
import React from 'react'
import { useTheme } from './lib/theme'

export function MP({ items, selected, onChange, color, label }) {
  const { t, dark } = useTheme(); const allSel = selected.length === items.length
  function tog(item) { const n = selected.includes(item) ? selected.filter(x => x !== item) : [...selected, item]; onChange(n.length ? n : [...items]) }
  const grey = t.textM // 무채색 배경(라이트 #52524E / 다크 #A3A39E) — 배경 현행 유지
  // [3] 참조비교(items===STATS/CATS) 대신 항목 값으로 판별 → 호출부 배열 복사/가공에도 안전
  const CHIP = { '사용': '#019748', '중지': grey, '휴면': '#BFA6D9', '경구제': '#019748', '주사제': '#2B7BB9', '외용제': '#BFA6D9', '수액제': grey, '영양제': '#804A87', '의약외품': '#804A87' }
  const mk = (c, txt) => ({ padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: c, color: txt || '#fff', border: `1.5px solid ${c}`, transition: 'all .15s' })
  const on = mk(color)
  const off = { padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 500, background: 'transparent', color: t.textM, border: `1.5px solid ${t.border}`, transition: 'all .15s' }
  return <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
    {label && <span style={{ fontSize: 10, color: t.textL, fontWeight: 600, marginRight: 3 }}>{label}</span>}
    <button onClick={() => onChange(allSel ? [items[0]] : [...items])} style={allSel ? { ...on, background: t.text, borderColor: t.text } : off}>전체</button>
    {items.map(i => { const c = CHIP[i]; const ao = c ? mk(c, c === grey && dark ? t.bg : undefined) : on; return <button key={i} onClick={() => tog(i)} style={selected.includes(i) ? ao : off}>{i}</button> })}
  </div>
}

export default MP
