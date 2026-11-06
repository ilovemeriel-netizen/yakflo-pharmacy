/* shot_modals.jsx — 세 곳의 「주의 표시 줄」을 **진짜 컴포넌트**로 그려 HTML 로 뽑는 도구.
 *
 * 시험이 아니라 **캡처 도구**다. 그래서 src 가 아니라 scripts 에 둔다
 * (시험 묶음이 돌 때마다 파일을 쓰면 안 된다).
 *
 * 쓰는 법:
 *   npx vitest run --root . scripts/shot_modals.jsx
 *   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new  *     --force-device-scale-factor=2 --window-size=700,980  *     --screenshot=나올파일.png file:///...scripts/_shot_modals.html
 *
 * 뽑는 것: 밝은 화면·어두운 화면 각각
 *   ① 약품 수정 창(수정 모드) ② 약품 수정 창(등록 모드) ③ 별도 약품 등록 화면
 * ★ ②는 「상세 입력」이 기본 접힘이라 펼친 뒤에 뽑는다.
 */
import { describe, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { writeFileSync } from 'node:fs'

vi.mock('./lib/supabase', () => {
  const ok = d => Promise.resolve({ data: d, error: null })
  function from() {
    const q = {
      select() { return q }, eq() { return q }, order() { return q }, limit() { return q },
      maybeSingle() { return ok(null) }, insert() { return ok(null) }, update() { return q },
      then(res) { return ok([]).then(res) },
    }
    return q
  }
  return { supabase: { from, rpc: () => ok(null), auth: { getUser: () => ok({ user: { id: 'u1' } }) } } }
})

import { ThemeCtx } from './lib/theme'
import { DrugEditModal, DrugRegister } from './App'

const LIGHT = {
  mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', glass: 'rgba(255,255,255,0.9)',
  border: '#E8E6E1', borderH: '#D7D7D7', text: '#2E4A62', textM: '#52524E', textL: '#A3A39E',
  accent: '#804A87', accentL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', amber: '#E65100', amberL: '#FFF3E0',
  blue: '#2E4A62', blueL: '#EAF0F5', yellow: '#FFE082', purple: '#804A87', purpleL: '#F5EDF6',
  shadow: '0 2px 8px rgba(46,74,98,0.06)', shadowH: 'none',
}
const DARK = {
  ...LIGHT, mode: 'dark', bg: '#121820', card: '#1A2332', cardSolid: '#1E2A3A',
  border: '#2A3A4A', borderH: '#3A4A5A', text: '#E8E6E1', textM: '#A3A39E', textL: '#6B7B8B',
  accent: '#BFA6D9', red: '#F39E94', blue: '#92C8E0', amber: '#FFB74D', purple: '#BFA6D9',
}

/* 운영 실제 약품 */
const DRUG = {
  id: 'd1', drug_code: 'SGBRONNC10', drug_name: '가바로닌캡슐100mg', category: '경구제',
  status: '사용', purchase_price: 198, current_qty: 1504,
  is_high_alert: false, caution_dose: true, caution_shape: false, caution_sound: false,
}

function grab(t, ui, openDetail) {
  const { container } = render(
    <ThemeCtx.Provider value={{ t, profile: { role: 'admin' }, memberRole: 'owner' }}>{ui}</ThemeCtx.Provider>)
  /* 등록 모드는 「상세 입력」이 기본 접힘이다 — 펼쳐야 주의 표시 줄이 보인다 */
  if (openDetail) {
    const btn = [...container.querySelectorAll('button')].find(b => /상세 입력/.test(b.textContent))
    if (btn) fireEvent.click(btn)
  }
  return container.innerHTML
}

/* 「주의 표시」 글자가 있는 가장 가까운 묶음만 잘라낸다 — 창 전체는 너무 길다 */
function cut(html) {
  const i = html.indexOf('고위험 의약품으로 지정')
  if (i < 0) return '<p style="color:red">주의 표시 줄을 찾지 못했습니다</p>'
  const s = html.lastIndexOf('<label', html.lastIndexOf('<label', i))
  const j = html.indexOf('주의 표시')
  const e = html.indexOf('</div>', html.indexOf('발음', j)) + 6
  return html.slice(s, e) + '</div>'
}

describe('캡처', () => {
  it('세 곳의 주의 표시 줄을 HTML 로 뽑는다', () => {
    const out = []
    for (const [mode, t] of [['밝은 화면', LIGHT], ['어두운 화면', DARK]]) {
      const sites = [
        ['① 약품 수정 창 — 수정 모드', cut(grab(t, <DrugEditModal drug={DRUG} onClose={() => {}} onSaved={() => {}} />))],
        ['② 약품 수정 창 — 등록 모드', cut(grab(t, <DrugEditModal drug={{ __register: true, drug_code: '', drug_name: '' }} onClose={() => {}} onSaved={() => {}} />, true))],
        ['③ 별도 약품 등록 화면', cut(grab(t, <DrugRegister drugs={[]} onRefresh={() => {}} />))],
      ]
      out.push(`<section style="background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:18px;margin-bottom:18px">
        <h2 style="font:700 16px 'Malgun Gothic';color:${t.text};margin:0 0 14px">${mode}</h2>` +
        sites.map(([name, html]) => `<div style="background:${t.card};border:1px solid ${t.border};border-radius:10px;padding:16px;margin-bottom:12px">
          <div style="font:700 12px 'Malgun Gothic';color:${t.textM};margin-bottom:10px">${name}</div>${html}</div>`).join('') +
        '</section>')
    }
    writeFileSync('scripts/_shot_modals.html',
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>*{box-sizing:border-box}
       body{margin:0;padding:20px;background:#fff;font-family:"Malgun Gothic","맑은 고딕",sans-serif}</style></head>
       <body>${out.join('')}</body></html>`, 'utf8')
  })
})
