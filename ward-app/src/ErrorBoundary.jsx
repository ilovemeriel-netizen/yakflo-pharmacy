/* ═══════════════════════════════════════════════════════════════════════════
   오류 안내 화면 (병동 신청 앱) — 사용자 승인 시안 2026-10-29

   ★ 이 파일에는 컴포넌트만 둔다 — 문구·판정은 errorText.js 다.
   ★ 쌍둥이: src/lib/errorBoundary.jsx · vaccine-app/src/ErrorBoundary.jsx
   ★ 색은 전부 App.jsx 의 브랜드 4색과 그 파생이다. 새 색 0건.
     ★ App.jsx 를 import 하지 않는다 — 경계가 App 보다 바깥이라 순환이 된다.
       그래서 값을 같은 값으로 적어 두고 시험이 대조한다.
   ★ 기록은 console.error 로 메시지와 컴포넌트 스택만. 외부 전송 없음.
     화면에 오류 원문·코드 경로를 보이지 않는다. 개인정보는 담지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { Component } from 'react'
import {
  EC_TITLE, EC_PLAIN, EC_CONTACT, EC_RELOAD, EC_WHEN, EC_COPY, EC_ICON_BG,
  kstStamp, chunkReloadOnce, clearChunkReloadMark,
} from './errorText.js'

/* App.jsx 와 같은 값 */
const PURPLE = '#804A87'
const NAVY = '#2E4A62'
const CARD = '#FFFFFF'

/* 색 문자열 — App.jsx 의 rgba(hex, a) 와 같은 결과를 내는 최소 구현 */
function rgba(hex, a) {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/* ── 오류 카드 — 휴대폰에서 화면을 꽉 채우는 카드 한 장 ──────────────────── */
export function ErrorCard({ when, onReload }) {
  const stamp = when || kstStamp()
  const reload = onReload || (() => { if (typeof window !== 'undefined') window.location.reload() })
  return <div className="no-print" style={{
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, boxSizing: 'border-box', background: rgba(NAVY, 0.04),
  }}>
    <div style={{
      background: CARD, border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 16,
      padding: '30px 22px 20px', width: '100%', maxWidth: 420, textAlign: 'center',
    }}>
      <div aria-hidden="true" style={{
        width: 54, height: 54, borderRadius: 14, background: EC_ICON_BG, color: PURPLE,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, fontWeight: 800, marginBottom: 14,
      }}>!</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 10 }}>{EC_TITLE}</div>
      <div style={{ fontSize: 13, color: rgba(NAVY, 0.62), lineHeight: 1.75, marginBottom: 18 }}>
        {EC_PLAIN}<br />{EC_CONTACT}
      </div>
      {/* 버튼 하나 — 가로 꽉 참 */}
      <button onClick={reload} style={{
        width: '100%', padding: '12px 14px', borderRadius: 10, border: 'none',
        background: PURPLE, color: CARD, fontSize: 14, fontWeight: 700,
        cursor: 'pointer', lineHeight: 1.2,
      }}>{EC_RELOAD}</button>
      <div style={{ fontSize: 10, color: rgba(NAVY, 0.5), marginTop: 14 }}>{EC_WHEN} {stamp}</div>
      <div style={{
        fontSize: 11, color: rgba(NAVY, 0.5), lineHeight: 1.6,
        borderTop: '1px solid ' + rgba(NAVY, 0.12), marginTop: 16, paddingTop: 13,
      }}>{EC_COPY}</div>
    </div>
  </div>
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null, when: null }
  }

  static getDerivedStateFromError(err) {
    return { err, when: kstStamp() }
  }

  componentDidMount() {
    if (!this.state.err) clearChunkReloadMark(this.props.win)
  }

  componentDidCatch(err, info) {
    console.error('[화면 오류]', (err && err.message) || String(err), info && info.componentStack)
    chunkReloadOnce(err, this.props.win)
  }

  render() {
    if (!this.state.err) return this.props.children
    return <ErrorCard when={this.state.when} />
  }
}
