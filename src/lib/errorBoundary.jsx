/* ═══════════════════════════════════════════════════════════════════════════
   오류 안내 화면 (약플로 관리 앱) — 사용자 승인 시안 2026-10-29

   ★ 왜 필요한가
     세 앱 어디에도 ErrorBoundary 가 없어서, 한 군데에서 throw 가 나면
     화면 전체가 **하얘진다**(PR #350 의 머리글 필터에서 실제로 겪었다).
     사용자는 무엇이 잘못됐는지도, 저장한 것이 남았는지도 알 수 없었다.

   ★ 이 파일에는 **컴포넌트만** 둔다 — 문구·판정은 errorText.js 다
     (react-refresh/only-export-components: 한 파일이 컴포넌트와 상수를
      함께 export 하면 lint 오류가 난다).

   ★ 기록 규약 — console.error 로 **오류 메시지와 컴포넌트 스택만** 남긴다.
     외부 서비스로 보내지 않고, 화면에 오류 원문·코드 경로를 보이지 않는다.
     개인정보(성명·사번 등)는 애초에 담지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { Component } from 'react'
import {
  EC_TITLE, EC_KEEP, EC_CONTACT, EC_RELOAD, EC_HOME, EC_WHEN, EC_COPY,
  EC_ICON_BG, EC_PURPLE, EC_LIGHT, EC_DARK, kstStamp, chunkReloadOnce, clearChunkReloadMark,
} from './errorText.js'

/* ── 오류 카드 ─────────────────────────────────────────────────────────────
   t     : 테마 토큰. 없으면(바깥 경계) OS 설정에 맞춰 EC_LIGHT/EC_DARK 를 쓴다.
   onHome: 있으면 「대시보드로」 버튼이 함께 나온다(화면 안쪽 경계에만 준다).
   screen: 작은 글씨 뒤에 붙는 화면 이름. */
export function ErrorCard({ t, onHome, screen, when, onReload, full }) {
  const d = t || EC_LIGHT
  const stamp = when || kstStamp()
  const reload = onReload || (() => { if (typeof window !== 'undefined') window.location.reload() })
  const themed = !!t                     /* 테마가 있으면 인라인 값, 없으면 CSS 변수로 다크 대응 */
  const v = k => themed ? d[k] : `var(--ec-${k}, ${EC_LIGHT[k]})`

  const btn = {
    padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
    cursor: 'pointer', flex: 1, lineHeight: 1.2,
  }
  return <div className="no-print ec-root" style={{
    minHeight: full ? '100vh' : 360, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 20, boxSizing: 'border-box', background: v('bg'),
  }}>
    {/* ★ 바깥 경계는 테마를 받을 수 없다 — OS 설정으로 라이트·다크를 고른다.
        값은 App.jsx 의 themes 와 같고, 시험이 대조한다. */}
    {!themed && <style>{`
      .ec-root { --ec-bg:${EC_LIGHT.bg}; --ec-card:${EC_LIGHT.card}; --ec-border:${EC_LIGHT.border}; --ec-text:${EC_LIGHT.text}; --ec-textM:${EC_LIGHT.textM}; --ec-textL:${EC_LIGHT.textL}; --ec-accent:${EC_LIGHT.accent}; }
      @media (prefers-color-scheme: dark) {
        .ec-root { --ec-bg:${EC_DARK.bg}; --ec-card:${EC_DARK.card}; --ec-border:${EC_DARK.border}; --ec-text:${EC_DARK.text}; --ec-textM:${EC_DARK.textM}; --ec-textL:${EC_DARK.textL}; --ec-accent:${EC_DARK.accent}; }
      }
    `}</style>}
    <div style={{
      background: v('card'), border: `1px solid ${v('border')}`,
      borderRadius: 16, padding: '30px 26px 22px', width: '100%', maxWidth: 440, textAlign: 'center',
    }}>
      <div aria-hidden="true" style={{
        width: 54, height: 54, borderRadius: 14, background: EC_ICON_BG, color: v('accent'),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, fontWeight: 800, marginBottom: 14,
      }}>!</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: v('text'), marginBottom: 10 }}>{EC_TITLE}</div>
      <div style={{ fontSize: 13, color: v('textM'), lineHeight: 1.75, marginBottom: 18 }}>
        {EC_KEEP}<br />{EC_CONTACT}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={reload} style={{ ...btn, border: 'none', background: EC_PURPLE, color: '#FFFFFF' }}>{EC_RELOAD}</button>
        {/* ★ 「흰 바탕 · 남색 테두리」 — 라이트에서 t.text 가 바로 그 남색(#2E4A62)이다.
            다크에서는 t.text 가 밝은 글자색이 되어 카드 위에서 읽힌다(같은 토큰, 같은 의도). */}
        {onHome && <button onClick={onHome} style={{
          ...btn, background: v('card'), border: `1px solid ${v('text')}`, color: v('text'),
        }}>{EC_HOME}</button>}
      </div>
      <div style={{ fontSize: 10, color: v('textL'), marginTop: 14 }}>
        {EC_WHEN} {stamp}{screen ? ' · ' + screen : ''}
      </div>
      <div style={{
        fontSize: 11, color: v('textL'), lineHeight: 1.6,
        borderTop: `1px solid ${v('border')}`, marginTop: 16, paddingTop: 13,
      }}>{EC_COPY}</div>
    </div>
  </div>
}

/* ── 경계 ──────────────────────────────────────────────────────────────────
   props: { children, t, onHome, screen, full, win }
   ★ key 로 묶어 쓴다 — App.jsx 가 key={menu} 를 주므로 화면을 옮기면
     이 컴포넌트가 새로 만들어져 오류 상태가 저절로 풀린다. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null, when: null }
  }

  static getDerivedStateFromError(err) {
    return { err, when: kstStamp() }
  }

  componentDidMount() {
    /* 정상 렌더에 성공했다 — 다음 배포에서 자동 새로고침을 다시 쓸 수 있게 표시를 지운다 */
    if (!this.state.err) clearChunkReloadMark(this.props.win)
  }

  componentDidCatch(err, info) {
    /* ★ 메시지와 컴포넌트 스택만. 외부 전송 없음. 개인정보 없음. */
    console.error('[화면 오류]', (err && err.message) || String(err), info && info.componentStack)
    /* 배포 직후 옛 조각을 못 불러오는 오류면 1회 새로고침 */
    chunkReloadOnce(err, this.props.win)
  }

  reset = () => {
    this.setState({ err: null, when: null })
  }

  render() {
    if (!this.state.err) return this.props.children
    const { t, onHome, screen, full } = this.props
    return <ErrorCard
      t={t}
      when={this.state.when}
      screen={screen}
      full={full}
      onHome={onHome ? () => { onHome(); this.reset() } : null}
    />
  }
}
