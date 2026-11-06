/* 실제 컴포넌트(src/CautionChips.jsx)를 그대로 그려 HTML 로 만들고,
   엣지(headless)로 캡처한다. 제가 손으로 그린 그림이 아니라 **운영 코드의 결과물**이다. */
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { DrugChips, HighAlertChip, CautionChip, WarnTriangle } from '../src/CautionChips.jsx'
import { CAUTION_ORDER, cautionCheckColor } from '../src/lib/cautionDefs.js'

const h = React.createElement
/* 운영 themes.light / themes.dark 에서 칩이 쓰는 값만 그대로 */
const LIGHT = { mode: 'light', blue: '#2E4A62', red: '#C62828', yellow: '#FFE082',
  card: '#FFFFFF', page: '#F7F6F3', border: '#E8E6E1', text: '#2E4A62', textM: '#52524E', textL: '#A3A39E' }
const DARK = { mode: 'dark', blue: '#92C8E0', red: '#F39E94', yellow: '#FFE082',
  card: '#1A2332', page: '#121820', border: '#2A3A4A', text: '#E8E6E1', textM: '#A3A39E', textL: '#6B7B8B' }

/* 운영 실제 약품 */
const DRUGS = [
  { drug_name: '휴마로그주100단위/mL', is_high_alert: true },
  { drug_name: '가바로닌캡슐100mg', caution_dose: true },
  { drug_name: '디고신정', caution_shape: true },
  { drug_name: '마그밀정', caution_sound: true },
]

function Row(t) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    DRUGS.map((d, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: t.text } },
      h(DrugChips, { d, t }), d.drug_name)))
}

function AllFour(t) {
  return h('div', { style: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' } },
    h(HighAlertChip, {}),
    CAUTION_ORDER.map(x => h(CautionChip, { key: x.kind, t, kind: x.kind, label: x.label })))
}

/* 수정 창 「주의 표시」 줄 — App.jsx 에 넣은 것과 같은 짜임새 */
function EditRow(t) {
  const lb = { fontSize: 10, color: t.textM, marginBottom: 6, display: 'block', fontWeight: 600 }
  return h('div', null,
    h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' } },
      h('input', { type: 'checkbox', defaultChecked: true, style: { width: 16, height: 16, accentColor: '#D9342B' } }),
      h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#D9342B' } },
        h(WarnTriangle, { size: 13 }), '고위험 의약품으로 지정')),
    h('div', { style: { marginTop: 6 } },
      h('label', { style: lb }, '주의 표시 (여러 개 선택 가능)'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' } },
        CAUTION_ORDER.map((x, i) => h('label', { key: x.kind, style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('input', { type: 'checkbox', defaultChecked: i === 0, style: { width: 16, height: 16, accentColor: cautionCheckColor(t, x.kind) } }),
          h(CautionChip, { t, kind: x.kind, label: x.label }))))))
}

function Panel(t, title, note) {
  return h('div', { style: { background: t.page, border: '1px solid ' + t.border, borderRadius: 12, padding: 18, marginBottom: 16 } },
    h('div', { style: { fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 4 } }, title),
    h('div', { style: { fontSize: 11, color: t.textM, marginBottom: 14 } }, note),
    h('div', { style: { background: t.card, border: '1px solid ' + t.border, borderRadius: 10, padding: 16 } },
      h('div', { style: { fontSize: 11, fontWeight: 700, color: t.textM, marginBottom: 10 } }, '네 칩 나란히'),
      AllFour(t),
      h('div', { style: { fontSize: 11, fontWeight: 700, color: t.textM, margin: '20px 0 10px' } }, '약품 목록 (실제 크기)'),
      Row(t),
      h('div', { style: { fontSize: 11, fontWeight: 700, color: t.textM, margin: '20px 0 4px' } }, '수정 창 — 주의 표시 줄'),
      EditRow(t)))
}

const body = renderToStaticMarkup(h('div', { style: { padding: 20, fontFamily: '"Malgun Gothic","맑은 고딕",sans-serif', background: '#FFFFFF' } },
  Panel(LIGHT, '① 밝은 화면', '고위험 바탕 #D9342B1A 가 흰 카드와 섞여 #FBEBEA 로 보입니다'),
  Panel(DARK, '② 어두운 화면', '같은 #D9342B1A 가 어두운 카드와 섞여 #2D2531 로 보입니다 — 고위험 칩은 손대지 않았습니다')))

const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
  '<style>*{box-sizing:border-box}body{margin:0;background:#fff}</style></head><body>' + body + '</body></html>'
const OUT = 'C:/Users/iamam/AppData/Local/Temp/claude/cacf9b15ac284cae/811186a4-cb7d-4ccf-981a-ccfb6aa2a7ff/scratchpad/chips.html'
writeFileSync(OUT, html, 'utf8')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PNG = 'C:\\Users\\iamam\\OneDrive\\바탕 화면\\라벨_시안\\08_칩_실제렌더_밝은어두운.png'
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=2', '--window-size=760,1000',
  '--screenshot=' + PNG, 'file:///' + OUT.replace(/ /g, '%20')], { stdio: 'inherit' })
console.log('캡처 저장: ' + PNG)
