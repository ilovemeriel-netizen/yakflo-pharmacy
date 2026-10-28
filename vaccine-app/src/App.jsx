/* ═══════════════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 시안 ⓐ-1(로그인) · ⓐ-2(휴대폰) · ⓐ-3(PC·태블릿)

   ★ 이 앱은 Supabase 클라이언트도 키도 가지지 않는다. 같은 사이트의 Function 두 개만 부른다.
       POST /api/vaccine/verify  { pw }  → { ok, token, initial? }
       GET  /api/vaccine/stock           → { season, updated_at, items:[{label, qty, status}] }

   ★ 로그인 응답의 initial 이 stock 과 같은 형식이다 — 있으면 그걸로 바로 그리고
     로그인 직후 stock 을 다시 부르지 않는다(왕복 1회 절약). 다음 갱신부터 stock 을 쓴다.

   ★ 숫자를 그리기 전에 「응답을 받았는지」를 먼저 가린다 — src/lib/stockView.js.
     그러지 않으면 1~2초 동안 "공개 중인 백신이 없습니다" 가 사실과 다르게 보인다.

   ★ 표시 문자열을 **파싱하지 않는다**(병동신청앱 원칙).
     그래서 독감/코로나 같은 섹션 제목도, 분류별 합계 줄도 만들지 않는다.
     label 은 그대로 찍고, 카드는 items 순서 그대로 한 목록이다.

   ★ 병원 이름을 적지 않는다(승인됨). 「약제과」까지만.
   ★ 토큰은 localStorage 에 둔다. exp 가 지나면 지우고, [잠그기] 는 즉시 지운다.
   ★ 자동 갱신은 **화면이 보일 때만** 60초마다 — 배경 탭에서 Function 을 두드리지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react'
import { itemsOf, viewState, totalOf } from './lib/stockView'
import { pwReady } from './lib/pwInput'
import PinBoxes from './PinBoxes'
import SurveyTab from './SurveyTab'

const TOKEN_KEY = 'vaccine_public_token'
const REFRESH_MS = 60_000
const PW_LEN = 4
const TEL = '약제과 내선 217'
/* 불러오는 동안 숫자 자리에 들어가는 문구 — 한 곳에만 둔다 */
const LOADING = '불러오는 중...'

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
  /* 로그인 응답의 initial 로 이미 그렸는지 — true 면 첫 stock 호출을 건너뛴다.
     ★ 렌더 중에는 읽지도 쓰지도 않는다(이벤트 처리기에서 쓰고 effect 에서 읽는다). */
  const seeded = useRef(false)
  /* 열린 수요조사 회차 — null 이면 탭을 **그리지 않는다**(지금 화면과 한 픽셀도 다르지 않다).
     로그인 응답(initial 과 함께 오는 survey)으로 채우고, 재방문 때는 /survey info 로 받는다. */
  const [survey, setSurvey] = useState(null)
  const [tab, setTab] = useState('stock')
  /* 로그인 응답으로 회차를 이미 받았는지 — true 면 info 호출을 건너뛴다(왕복 1회 절약) */
  const seededSurvey = useRef(false)

  const lock = useCallback(() => {
    clearStored(); setToken(null); setData(null); setErr(null); setSurvey(null); setTab('stock')
  }, [])

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
       0ms 지연이라 사용자에게는 즉시 시작하는 것과 같다.
       ★ 로그인 응답에 initial 이 실려 와 이미 그린 경우에는 건너뛴다 — 같은 데이터를
         두 번 받으러 가지 않는다. 깃발은 한 번 쓰고 내려서 다음 토큰에서는 정상 조회한다. */
    let kick = null
    if (document.visibilityState === 'visible') {
      if (seeded.current) seeded.current = false
      else kick = setTimeout(() => load(token), 0)
      start()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      if (kick != null) clearTimeout(kick)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [token, load])

  /* ── 열린 회차 조회 — 재방문(저장된 토큰으로 바로 들어온 경우)에서만 필요하다.
     로그인 직후에는 verify 응답에 survey 가 함께 오므로 이 호출을 하지 않는다. */
  useEffect(() => {
    if (!token || seededSurvey.current) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/vaccine/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ action: 'info' }),
        })
        const j = await r.json().catch(() => null)
        if (alive && r.ok && j?.ok) setSurvey(j.survey || null)
      } catch { /* 수요조사 탭이 안 보일 뿐 — 잔량 조회는 그대로 동작한다 */ }
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [token])

  async function manualReload() {
    setLoading(true)
    await load(token)
    setLoading(false)
  }

  if (!token) return <Login onDone={(tok, initial, sv) => {
    saveStored(tok)
    /* 로그인 응답에 첫 데이터가 실려 왔으면 그걸로 바로 그린다 — 빈 화면을 거치지 않는다 */
    if (itemsOf(initial)) { setData(initial); seeded.current = true }
    /* survey 는 「없음(null)」도 유효한 답이다 — 키가 왔으면 info 호출을 건너뛴다 */
    if (sv !== undefined) { setSurvey(sv || null); seededSurvey.current = true }
    setToken(tok)
  }} />
  return <Stock
    data={data} loading={loading} err={err} onLock={lock} onReload={manualReload}
    survey={survey} tab={survey ? tab : 'stock'} onTab={setTab} token={token}
    onSurveyGone={lock} />
}

/* ═══ 시안 ⓐ-1 — 로그인 (2026-10-27 승인 시안) ═══════════════════════════
   ★ 네 상자는 **장식**이다. 실제 입력은 상자 위에 투명하게 덮인 input 하나뿐이고,
     그래서 상자 아무 곳을 눌러도 바로 입력이 시작된다(포커스 옮기는 코드가 없다).
   ★ 입력 규칙(숫자만·4자리·붙여넣기)은 lib/pwInput.js 에 있다.
   ★ 로그인 로직(토큰·initial·오류 분기)은 이 개편에서 건드리지 않았다. */
function Login({ onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  /* 실패 뒤 다시 입력칸으로 돌아가기 위한 값 — 바뀌면 PinBoxes 가 포커스를 가져간다.
     입력칸이 PinBoxes 안으로 들어가서 ref 로 직접 부를 수 없게 됐다(2026-10-28). */
  const [refocus, setRefocus] = useState(0)

  const ready = pwReady(pw, PW_LEN)

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
      /* initial 은 없을 수도 있다(서버에서 첫 조회가 실패한 경우) — 그러면 화면이 stock 으로 채운다 */
      if (r.ok && j?.ok && j.token) { setPw(''); onDone(j.token, j.initial, j.survey); return }
      setMsg(j?.message || '잠시 후 다시 시도해 주세요')
      setPw('')
      setRefocus(n => n + 1)
    } catch {
      setBusy(false); setMsg('연결이 불안정합니다')
    }
  }

  return <main style={{
    minHeight: '100dvh', background: 'rgba(191, 166, 217, 0.18)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  }}>
    <form onSubmit={submit} style={{ width: '100%', maxWidth: 360, minWidth: 0 }}>

      {/* 아이콘 — 보라 사각형 안의 흰 십자 */}
      <div style={{
        width: 56, height: 56, borderRadius: 14, background: 'var(--v-purple)',
        margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg viewBox="0 0 20 20" width="26" height="26" aria-hidden="true">
          <path d="M7 1h6v6h6v6h-6v6H7v-6H1V7h6z" fill="#FFFFFF" />
        </svg>
      </div>

      <h1 style={{
        margin: '16px 0 0', textAlign: 'center',
        fontSize: 24, fontWeight: 800, color: 'var(--v-navy)',
      }}>백신 잔량 조회</h1>

      <p style={{
        margin: '10px 0 22px', textAlign: 'center',
        fontSize: 15, color: 'rgba(46, 74, 98, 0.8)', lineHeight: 1.6,
      }}>직원 공용 비밀번호 {PW_LEN}자리를<br />입력해 주세요</p>

      {/* 흰 카드 */}
      <div style={{
        background: '#FFFFFF', borderRadius: 18,
        border: '1px solid rgba(46, 74, 98, 0.12)', padding: '24px 20px',
      }}>
        <label htmlFor="pw" style={{
          display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--v-navy)', marginBottom: 10,
        }}>비밀번호</label>

        {/* 네 상자 + 그 위에 덮인 투명 input — 2026-10-28 에 PinBoxes 로 떼어 냈다.
            수요조사 확인번호가 같은 것을 쓴다. 모양·동작은 전과 같다. */}
        <PinBoxes id="pw" value={pw} onChange={setPw} len={PW_LEN}
          label={`비밀번호 ${PW_LEN}자리`} autoFocus focusKey={refocus} />

        <button type="submit" disabled={!ready || busy} style={{
          width: '100%', height: 52, marginTop: 16, borderRadius: 12, border: 'none',
          background: ready && !busy ? 'var(--v-purple)' : 'rgba(128, 74, 135, 0.3)',
          color: '#FFFFFF', fontSize: 16, fontWeight: 700,
          cursor: ready && !busy ? 'pointer' : 'not-allowed',
        }}>{busy ? '확인 중...' : '확인'}</button>

        {/* 오류 문구(틀림·잠금·NOT_SET·NO_IP) — 아래 안내 자리 바로 위 */}
        {msg && <div role="alert" style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(128, 74, 135, 0.08)', borderLeft: '3px solid var(--v-purple)',
          fontSize: 13, color: 'var(--v-navy)', lineHeight: 1.6,
        }}>{msg}</div>}

        <p style={{
          margin: '14px 0 0', textAlign: 'center',
          fontSize: 13, color: 'rgba(46, 74, 98, 0.8)', lineHeight: 1.6,
        }}>확인하면 오늘 하루 동안 다시 묻지 않습니다.</p>
      </div>

      <p style={{
        margin: '22px 0 0', textAlign: 'center',
        fontSize: 13, color: 'rgba(46, 74, 98, 0.8)', lineHeight: 1.8,
      }}>
        비밀번호를 모르면 약제과로 문의해 주세요
        <br /><span style={{ fontWeight: 700, color: 'var(--v-navy)' }}>{TEL}</span>
      </p>
      <Ft />
    </form>
  </main>
}

/* ═══ 저작권 — 세 화면(로그인·잔량·수요조사)이 같은 한 줄을 쓴다 ═══════════
   ★ 약플로 PR #345 에서 정한 표준 문구 그대로. © 는 U+00A9 다.
   ★ 모양은 이 앱의 기존 하단(foot)과 같다 — fontSize 11 · var(--v-ink-dim) ·
     lineHeight 1.7. 새 색·새 크기를 만들지 않는다.
   ★ 기존 「문의」 줄 **아래**에 온다. 인쇄에는 내지 않는다(no-print). */
function Ft() {
  return <p className="no-print" style={{
    margin: '10px 16px 26px', fontSize: 11, color: 'var(--v-ink-dim)',
    lineHeight: 1.7, textAlign: 'center',
  }}>
    Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.
  </p>
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

function Stock({ data, loading, err, onLock, onReload, survey, tab, onTab, token, onSurveyGone }) {
  const wide = useWide()
  /* 'loading'(응답 전) · 'empty'(받았는데 비었다) · 'list' — 판정은 lib/stockView.js 에 있다 */
  const state = viewState(data, loading)
  const items = itemsOf(data) || []
  const total = totalOf(data)
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
    {tab === 'survey' ? null : <button onClick={onReload} style={{
      padding: '8px 12px', borderRadius: 10, border: '1px solid var(--v-line)',
      background: 'var(--v-card)', color: 'var(--v-ink-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    }}>새로고침</button>}
    <button onClick={onLock} style={{
      padding: '8px 12px', borderRadius: 10, border: '1px solid var(--v-purple)',
      background: 'var(--v-card)', color: 'var(--v-purple)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    }}>잠그기</button>
  </header>

  const foot = <p style={{
    margin: wide ? '22px 28px 30px' : '18px 16px 26px',
    fontSize: 11, color: 'var(--v-ink-dim)', lineHeight: 1.7, textAlign: wide ? 'left' : 'center',
  }}>
    {/* ★ "입력 기록이 없습니다" 는 응답을 받은 뒤에만 — 응답 전에는 불러오는 중이라고 적는다 */}
    {state === 'loading' ? LOADING
      : when ? <>마지막 입력 <span className="num">{when}</span></>
        : '입력 기록이 없습니다'}
    {data?.season ? <> · <span className="num">{data.season}</span> 절기</> : null}
    <br />문의 {TEL}
  </p>

  /* 안내 상자 — 빈 목록과 불러오는 중이 같은 자리·같은 모양을 쓴다(새 레이아웃을 만들지 않는다) */
  const boxStyle = {
    padding: '40px 20px', borderRadius: 16,
    background: 'var(--v-card)', border: '1px solid var(--v-line)',
    textAlign: 'center', color: 'var(--v-ink-dim)', fontSize: 14,
  }
  /* ★ 응답을 받았고 목록이 진짜 빈 경우에만 쓴다 */
  const empty = <div style={{ margin: wide ? '28px' : '16px', ...boxStyle }}>공개 중인 백신이 없습니다</div>
  /* 카드 자리에 들어가는 불러오는 중 — 합계 상자와 나란히 서므로 margin 을 두지 않는다 */
  const pending = <div style={boxStyle}>{LOADING}</div>

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
    {/* ★ 숫자 자리 — 응답 전에는 0 을 보여 주지 않고 같은 자리에 문구를 적는다.
        큰 숫자 크기로는 문구가 넘치므로 글자 크기만 줄인다(색·자리·구조는 그대로). */}
    {state === 'loading'
      ? <div style={{
        fontSize: wide ? 20 : 15, fontWeight: 600, color: 'var(--v-ink-dim)', lineHeight: 1.1,
        marginTop: wide ? 6 : 0,
      }}>{LOADING}</div>
      : <div className="num" style={{
        fontSize: wide ? 56 : 30, fontWeight: 700, color: 'var(--v-navy)', lineHeight: 1.1,
        marginTop: wide ? 6 : 0,
      }}>{total.toLocaleString()}</div>}
    {/* 종 수도 응답 전에는 비워 둔다 — "0종" 이 사실과 다르게 보이지 않게 */}
    {state === 'loading' ? null : <div style={{ fontSize: 12, color: 'var(--v-ink-dim)', marginTop: wide ? 4 : 0 }}>
      <span className="num">{items.length}</span>종
    </div>}
  </div>

  const cards = <div style={{
    display: 'grid',
    gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : '1fr',
    gap: wide ? 14 : 10,
  }}>
    {items.map((x, i) => <Card key={x.label + ':' + i} item={x} wide={wide} />)}
  </div>

  /* ── 탭 띠 — 열린 회차가 있을 때만 그린다.
     ★ survey 가 null 이면 이 블록 전체가 null 이라 **기존 화면과 DOM 이 같다**. */
  const tabs = survey ? <nav style={{
    display: 'flex', gap: 6, padding: wide ? '14px 28px 0' : '12px 16px 0',
  }}>
    {[['stock', '잔량'], ['survey', '수요조사']].map(([k, lab]) => {
      const on = tab === k
      return <button key={k} onClick={() => onTab(k)} style={{
        flex: wide ? '0 0 auto' : 1, minWidth: wide ? 120 : 0, minHeight: 44, padding: '0 18px',
        borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 700,
        border: '1.5px solid ' + (on ? 'var(--v-purple)' : 'var(--v-line)'),
        background: on ? 'var(--v-purple)' : 'var(--v-card)',
        color: on ? '#FFFFFF' : 'var(--v-ink-dim)',
      }}>{lab}</button>
    })}
  </nav> : null

  if (tab === 'survey' && survey) {
    return <main style={{ minHeight: '100dvh' }}>
      {head}
      {tabs}
      <SurveyTab survey={survey} token={token} wide={wide} onSurveyGone={onSurveyGone} />
      <Ft />
    </main>
  }

  return <main style={{ minHeight: '100dvh' }}>
    {head}
    {tabs}
    {alert}
    {/* ★ 'loading' 도 'list' 와 같은 배치를 쓴다 — 데이터가 도착할 때 자리가 밀리지 않는다 */}
    {state === 'empty' ? empty
      : wide
        ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)', gap: 20, padding: '20px 28px 0', alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 96 }}>{totalBox}</div>
          {state === 'list' ? cards : pending}
        </div>
        : <div style={{ padding: '12px 16px 0', display: 'grid', gap: 12 }}>
          {totalBox}
          {state === 'list' ? cards : pending}
        </div>}
    {foot}
    <Ft />
  </main>
}

/* 「약품명 · 제약사」 한 줄. 둘 다 없으면 빈 문자열이라 호출부가 줄을 그리지 않는다.
   ★ 휴대폰 목록형(wide=false)과 PC 카드형(wide=true)이 같은 Card 를 쓰므로 한 곳이면 된다. */
function drugLine(item) {
  const name = String(item?.drug_name || '').trim()
  const maker = String(item?.maker || '').trim()
  if (!name) return maker            /* 이름이 없으면 제약사만(보통은 둘 다 없다) */
  return maker ? name + ' · ' + maker : name
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
      {/* ★ 약품명 · 제약사 — 표시명만으로는 어느 제품인지 알 수 없다는 문의가 잦았다.
          이 앱의 기존 보조 글씨(var(--v-ink-dim)) 그대로, 새 색을 만들지 않는다.
          한 줄을 넘으면 … 로 줄이고 전체는 title 로 본다.
          ★ 값이 없으면(약품 마스터에 없는 코드) 줄 자체를 그리지 않는다. */}
      {drugLine(item) ? <div style={{
        fontSize: 11, color: 'var(--v-ink-dim)', marginTop: 2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={drugLine(item)}>{drugLine(item)}</div> : null}
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
