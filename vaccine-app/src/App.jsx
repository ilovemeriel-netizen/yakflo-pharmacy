/* ═══════════════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 시안 ⓐ-1(로그인) · ⓐ-2(휴대폰) · ⓐ-3(PC·태블릿)

   ★ 이 앱은 Supabase 클라이언트도 키도 가지지 않는다. 같은 사이트의 Function 두 개만 부른다.
       POST /api/vaccine/verify  { pw }  → { ok, token }
       GET  /api/vaccine/stock           → { season, updated_at, items:[{label, qty, status}] }

   ★ 표시 문자열을 **파싱하지 않는다**(병동신청앱 원칙).
     그래서 독감/코로나 같은 섹션 제목도, 분류별 합계 줄도 만들지 않는다.
     label 은 그대로 찍고, 카드는 items 순서 그대로 한 목록이다.

   ★ 병원 이름을 적지 않는다(승인됨). 「약제과」까지만.
   ★ 토큰은 localStorage 에 둔다. exp 가 지나면 지우고, [잠그기] 는 즉시 지운다.
   ★ 자동 갱신은 **화면이 보일 때만** 60초마다 — 배경 탭에서 Function 을 두드리지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react'

const TOKEN_KEY = 'vaccine_public_token'
const REFRESH_MS = 60_000
const PW_LEN = 4
const TEL = '약제과 내선 217'

/* ── 토큰 보관 — 읽을 때 exp 를 보고 지난 것은 버린다 ── */
function readStored() {
  let raw = null
  try { raw = localStorage.getItem(TOKEN_KEY) } catch { return null }
  if (!raw) return null
  const exp = tokenExp(raw)
  if (exp == null || exp * 1000 <= Date.now()) { clearStored(); return null }
  return raw
}
function saveStored(tok) { try { localStorage.setItem(TOKEN_KEY, tok) } catch { /* 저장 못 해도 이번 세션은 동작한다 */ } }
function clearStored() { try { localStorage.removeItem(TOKEN_KEY) } catch { /* 무시 */ } }

/* 서명은 서버만 검증한다. 여기서는 만료만 읽어 쓸모없는 호출을 줄인다. */
function tokenExp(tok) {
  try {
    const head = String(tok).split('.')[0]
    const b64 = head.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(Array.from(atob(b64), c =>
      '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))
    const p = JSON.parse(json)
    return typeof p.exp === 'number' ? p.exp : null
  } catch { return null }
}

/* ── 시각 표기 — "10월 21일 15:54" (KST 고정) ── */
function fmtKst(iso) {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms + 9 * 60 * 60 * 1000)
  const p = n => String(n).padStart(2, '0')
  return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
}

/* ── 상태 배지 색 — 브랜드 4색과 투명도만 ──
   충분: 흰 바탕 + 녹색 테두리 / 주의: 라벤더 45% 바탕 / 부족: 보라 채움 / 소진: 남색 채움.
   글자는 남색 또는 흰색만 쓴다. */
const BADGE = {
  충분: { background: '#FFFFFF', color: 'var(--v-navy)', border: '1.5px solid var(--v-green)' },
  주의: { background: 'rgba(191, 166, 217, 0.45)', color: 'var(--v-navy)', border: '1.5px solid transparent' },
  부족: { background: 'var(--v-purple)', color: '#FFFFFF', border: '1.5px solid var(--v-purple)' },
  소진: { background: 'var(--v-navy)', color: '#FFFFFF', border: '1.5px solid var(--v-navy)' },
}

export default function App() {
  const [token, setToken] = useState(() => readStored())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const lock = useCallback(() => { clearStored(); setToken(null); setData(null); setErr(null) }, [])

  /* ── 잔량 조회 ──
     ★ 토큰을 인자로 받는다 — ref 를 렌더 중에 쓰지 않기 위해서다.
     ★ 이 함수는 await 이전에 setState 를 하지 않는다. effect 안에서 불러도
       동기 setState 가 일어나지 않아 cascading render 를 만들지 않는다.
       화면의 「불러오는 중」 표시는 호출부(새로고침 버튼)가 직접 켜고 끈다. */
  const load = useCallback(async (tok) => {
    if (!tok) return
    try {
      const r = await fetch('/api/vaccine/stock', { headers: { Authorization: 'Bearer ' + tok } })
      if (r.status === 401) { lock(); return }
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) { setErr('잠시 후 다시 시도해 주세요'); return }
      setErr(null); setData(j)
    } catch {
      setErr('연결이 불안정합니다')
    }
  }, [lock])

  /* ── 최초 1회 + 자동 갱신 — 화면이 보일 때만 60초 ──
     외부 시스템(타이머·visibilitychange)을 구독하는 effect 다. 첫 조회도 여기서 함께 건다. */
  useEffect(() => {
    if (!token) return
    let timer = null
    const start = () => { if (timer == null) timer = setInterval(() => load(token), REFRESH_MS) }
    const stop = () => { if (timer != null) { clearInterval(timer); timer = null } }
    const onVis = () => {
      if (document.visibilityState === 'visible') { load(token); start() }
      else stop()
    }
    /* ★ 첫 조회도 타이머로 건다 — effect 본문에서 직접 부르면 동기 setState 로 잡힌다.
       0ms 지연이라 사용자에게는 즉시 시작하는 것과 같다. */
    let kick = null
    if (document.visibilityState === 'visible') { kick = setTimeout(() => load(token), 0); start() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      if (kick != null) clearTimeout(kick)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [token, load])

  async function manualReload() {
    setLoading(true)
    await load(token)
    setLoading(false)
  }

  if (!token) return <Login onDone={tok => { saveStored(tok); setToken(tok) }} />
  return <Stock data={data} loading={loading} err={err} onLock={lock} onReload={manualReload} />
}

/* ═══ 시안 ⓐ-1 — 로그인 ═══════════════════════════════════════════════════ */
function Login({ onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])

  const ready = new RegExp('^\\d{' + PW_LEN + '}$').test(pw)

  async function submit(e) {
    e?.preventDefault()
    if (!ready || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/vaccine/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pw }),
      })
      const j = await r.json().catch(() => null)
      setBusy(false)
      if (r.ok && j?.ok && j.token) { setPw(''); onDone(j.token); return }
      setMsg(j?.message || '잠시 후 다시 시도해 주세요')
      setPw('')
      ref.current?.focus()
    } catch {
      setBusy(false); setMsg('연결이 불안정합니다')
    }
  }

  return <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <form onSubmit={submit} style={{ width: '100%', maxWidth: 340 }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-purple)', letterSpacing: '0.02em' }}>약제과</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, color: 'var(--v-navy)' }}>백신 잔량 조회</h1>
      </div>

      <label htmlFor="pw" style={{ display: 'block', fontSize: 13, color: 'var(--v-ink-dim)', marginBottom: 8 }}>
        공용 비밀번호
      </label>
      <input
        id="pw" ref={ref}
        type="password" inputMode="numeric" autoComplete="one-time-code"
        maxLength={PW_LEN}
        value={pw}
        onChange={e => setPw(e.target.value.replace(/\D/g, '').slice(0, PW_LEN))}
        className="num"
        style={{
          width: '100%', padding: '15px 16px', fontSize: 26, fontWeight: 600,
          letterSpacing: '0.42em', textAlign: 'center',
          border: '1.5px solid var(--v-line)', borderRadius: 14,
          background: 'var(--v-card)', color: 'var(--v-navy)',
        }} />

      {msg && <div role="alert" style={{
        marginTop: 12, padding: '10px 12px', borderRadius: 10,
        background: 'rgba(128, 74, 135, 0.08)', borderLeft: '3px solid var(--v-purple)',
        fontSize: 13, color: 'var(--v-navy)', lineHeight: 1.6,
      }}>{msg}</div>}

      <button type="submit" disabled={!ready || busy} style={{
        width: '100%', marginTop: 16, padding: '15px 16px', borderRadius: 14, border: 'none',
        background: ready && !busy ? 'var(--v-purple)' : 'rgba(128, 74, 135, 0.3)',
        color: '#FFFFFF', fontSize: 16, fontWeight: 700,
        cursor: ready && !busy ? 'pointer' : 'not-allowed',
      }}>{busy ? '확인 중...' : '확인'}</button>

      <p style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: 'var(--v-ink-dim)', lineHeight: 1.7 }}>
        비밀번호는 {TEL}로 문의해 주세요
      </p>
    </form>
  </main>
}

/* ═══ 시안 ⓐ-2(휴대폰) · ⓐ-3(PC·태블릿) ═══════════════════════════════════
   1024px 이상에서 왼쪽 합계 + 오른쪽 카드 3열, 그 아래는 세로 한 줄.
   CSS 미디어쿼리 대신 matchMedia 로 분기한다 — 인라인 스타일만 쓰기 위해서다. */
function useWide() {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = e => setWide(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

function Stock({ data, loading, err, onLock, onReload }) {
  const wide = useWide()
  const items = data?.items || []
  const total = items.reduce((s, x) => s + Number(x.qty || 0), 0)
  const when = fmtKst(data?.updated_at)

  const head = <header style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: wide ? '18px 28px' : '14px 16px',
    borderBottom: '1px solid var(--v-line)', background: 'var(--v-card)',
    position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 5,
  }}>
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--v-purple)' }}>약제과</div>
      <div style={{ fontSize: wide ? 18 : 16, fontWeight: 700, color: 'var(--v-navy)' }}>백신 잔량</div>
    </div>
    <div style={{ flex: 1 }} />
    <button onClick={onReload} style={{
      padding: '8px 12px', borderRadius: 10, border: '1px solid var(--v-line)',
      background: 'var(--v-card)', color: 'var(--v-ink-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    }}>새로고침</button>
    <button onClick={onLock} style={{
      padding: '8px 12px', borderRadius: 10, border: '1px solid var(--v-purple)',
      background: 'var(--v-card)', color: 'var(--v-purple)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    }}>잠그기</button>
  </header>

  const foot = <p style={{
    margin: wide ? '22px 28px 30px' : '18px 16px 26px',
    fontSize: 11, color: 'var(--v-ink-dim)', lineHeight: 1.7, textAlign: wide ? 'left' : 'center',
  }}>
    {when ? <>마지막 입력 <span className="num">{when}</span></> : '입력 기록이 없습니다'}
    {data?.season ? <> · <span className="num">{data.season}</span> 절기</> : null}
    <br />문의 {TEL}
  </p>

  const empty = <div style={{
    margin: wide ? '28px' : '16px', padding: '40px 20px', borderRadius: 16,
    background: 'var(--v-card)', border: '1px solid var(--v-line)',
    textAlign: 'center', color: 'var(--v-ink-dim)', fontSize: 14,
  }}>{loading ? '불러오는 중...' : '공개 중인 백신이 없습니다'}</div>

  const alert = err && <div role="alert" style={{
    margin: wide ? '16px 28px 0' : '12px 16px 0', padding: '10px 12px', borderRadius: 10,
    background: 'rgba(128, 74, 135, 0.08)', borderLeft: '3px solid var(--v-purple)',
    fontSize: 13, color: 'var(--v-navy)',
  }}>{err}</div>

  /* ── 합계 — PC 는 왼쪽 기둥, 휴대폰은 맨 위 띠 ──
     ★ 분류별 합계("독감 82 · 코로나 16")는 넣지 않는다 — label 을 해석하지 않기 위해서다. */
  const totalBox = <div style={{
    background: 'var(--v-card)', border: '1px solid var(--v-line)', borderRadius: 16,
    padding: wide ? '26px 22px' : '16px 18px',
    display: wide ? 'block' : 'flex', alignItems: 'center', gap: 12,
    textAlign: wide ? 'center' : 'left',
  }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--v-ink-dim)' }}>전체 잔량</div>
    <div style={{ flex: wide ? undefined : 1 }} />
    <div className="num" style={{
      fontSize: wide ? 56 : 30, fontWeight: 700, color: 'var(--v-navy)', lineHeight: 1.1,
      marginTop: wide ? 6 : 0,
    }}>{total.toLocaleString()}</div>
    <div style={{ fontSize: 12, color: 'var(--v-ink-dim)', marginTop: wide ? 4 : 0 }}>
      <span className="num">{items.length}</span>종
    </div>
  </div>

  const cards = <div style={{
    display: 'grid',
    gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : '1fr',
    gap: wide ? 14 : 10,
  }}>
    {items.map((x, i) => <Card key={x.label + ':' + i} item={x} wide={wide} />)}
  </div>

  return <main style={{ minHeight: '100dvh' }}>
    {head}
    {alert}
    {!items.length ? empty
      : wide
        ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)', gap: 20, padding: '20px 28px 0', alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 96 }}>{totalBox}</div>
          {cards}
        </div>
        : <div style={{ padding: '12px 16px 0', display: 'grid', gap: 12 }}>
          {totalBox}
          {cards}
        </div>}
    {foot}
  </main>
}

function Card({ item, wide }) {
  const badge = BADGE[item.status] || BADGE['충분']
  return <div style={{
    background: 'var(--v-card)', border: '1px solid var(--v-line)', borderRadius: 16,
    padding: wide ? '18px 18px 16px' : '14px 16px',
    display: 'flex', flexDirection: wide ? 'column' : 'row', alignItems: wide ? 'stretch' : 'center',
    gap: wide ? 10 : 12, minWidth: 0,
  }}>
    <div style={{ minWidth: 0, flex: wide ? undefined : 1 }}>
      <div style={{
        fontSize: wide ? 15 : 14, fontWeight: 700, color: 'var(--v-navy)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={item.label}>{item.label}</div>
    </div>
    <div style={{
      display: 'flex', alignItems: wide ? 'flex-end' : 'center',
      justifyContent: 'space-between', gap: 10, marginTop: wide ? 'auto' : 0,
    }}>
      <div className="num" style={{
        fontSize: wide ? 38 : 24, fontWeight: 700, color: 'var(--v-navy)', lineHeight: 1.05,
      }}>{Number(item.qty || 0).toLocaleString()}</div>
      <span style={{
        ...badge, padding: '4px 11px', borderRadius: 999,
        fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
      }}>{item.status}</span>
    </div>
  </div>
}
