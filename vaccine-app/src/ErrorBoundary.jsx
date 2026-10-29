/* ═══════════════════════════════════════════════════════════════════════════
   오류 안내 화면 (공개 조회·신청 사이트) — 사용자 승인 시안 2026-10-29

   ★ 이 파일에는 컴포넌트만 둔다 — 문구·판정은 errorText.js 다.
   ★ 쌍둥이: src/lib/errorBoundary.jsx · ward-app/src/ErrorBoundary.jsx
     관리 앱 파일을 import 하지 않는다 — 이 번들에 들어가면 안 되는 글자가 있다.
   ★ 색은 전부 index.css 의 기존 변수다. 새 색 0건.
   ★ 기록은 console.error 로 메시지와 컴포넌트 스택만. 외부 전송 없음.
     화면에 오류 원문·코드 경로를 보이지 않는다. 개인정보는 담지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { Component } from 'react'
import {
  EC_TITLE, EC_PLAIN, EC_CONTACT, EC_RELOAD, EC_WHEN, EC_COPY, EC_ICON_BG,
  kstStamp, chunkReloadOnce, clearChunkReloadMark,
} from './errorText.js'

/* ── 오류 카드 — 휴대폰에서 화면을 꽉 채우는 카드 한 장 ──────────────────── */
export function ErrorCard({ when, onReload }) {
  const stamp = when || kstStamp()
  const reload = onReload || (() => { if (typeof window !== 'undefined') window.location.reload() })
  return <div className="no-print" style={{
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, boxSizing: 'border-box', background: 'var(--v-bg)',
  }}>
    <div style={{
      background: 'var(--v-card)', border: '1px solid var(--v-line)', borderRadius: 16,
      padding: '30px 22px 20px', width: '100%', maxWidth: 420, textAlign: 'center',
    }}>
      <div aria-hidden="true" style={{
        width: 54, height: 54, borderRadius: 14, background: EC_ICON_BG, color: 'var(--v-purple)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, fontWeight: 800, marginBottom: 14,
      }}>!</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--v-ink)', marginBottom: 10 }}>{EC_TITLE}</div>
      <div style={{ fontSize: 13, color: 'var(--v-ink-dim)', lineHeight: 1.75, marginBottom: 18 }}>
        {EC_PLAIN}<br />{EC_CONTACT}
      </div>
      {/* 버튼 하나 — 가로 꽉 참 */}
      <button onClick={reload} style={{
        width: '100%', padding: '12px 14px', borderRadius: 10, border: 'none',
        background: 'var(--v-purple)', color: '#FFFFFF', fontSize: 14, fontWeight: 700,
        cursor: 'pointer', lineHeight: 1.2,
      }}>{EC_RELOAD}</button>
      <div style={{ fontSize: 10, color: 'var(--v-ink-dim)', marginTop: 14 }}>{EC_WHEN} {stamp}</div>
      <div style={{
        fontSize: 11, color: 'var(--v-ink-dim)', lineHeight: 1.6,
        borderTop: '1px solid var(--v-line)', marginTop: 16, paddingTop: 13,
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
