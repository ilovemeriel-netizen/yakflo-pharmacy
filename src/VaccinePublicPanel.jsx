/* ═══════════════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 관리 화면 설정 패널 (시안 ⓑ-1 · ⓑ-2)

   ★ 이 패널이 쓰는 경로는 둘뿐이다.
     ① 공개 표시명  — supabase.from('vaccine_accounts').update(...)  (클라이언트·RLS)
        VaccineManage 의 updAccount 와 **같은 경로**다. 새 정책·새 Function 을 만들지 않는다.
     ② 공용 비밀번호 — /api/vaccine/public-admin (GET·POST)
        vaccine_public_settings·vaccine_public_attempts 는 RLS 정책 0개라 service_role 로만 닿는다.

   ★ vaccine_events · v_vaccine_balance 는 읽지도 쓰지도 않는다.
   ★ 색은 브랜드 4색과 그 투명도만 쓴다 — #804A87 · #019748 · #BFA6D9 · #2E4A62.
     테마 토큰(t.purple·t.green·t.lavender·t.blue)이 그 값이므로 토큰을 쓰고 새 hex 를 적지 않는다.
   ★ 이 패널의 작은 표는 표준 표 사양 13항목 적용 제외(승인됨) — ColMenu·정렬·필터를 붙이지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { useTheme } from './lib/theme'
import { dbErrorMsg } from './lib/dbError'

const PUBLIC_URL = 'vaccine.ehwaa.com'
const LABEL_MAX = 30
const API = '/api/vaccine/public-admin'
const PW_DIGITS = 4

/* 공개 표시명 규칙 — 앞뒤 공백 제거, 빈칸은 NULL(공개 화면에서 숨김) */
function normLabel(v) {
  const s = String(v ?? '').trim()
  return s ? s : null
}
/* 저장 전 차단 — 30자 초과는 보내지 않는다(DB CHECK 가 23514 를 내기 전에 막는다) */
function labelTooLong(v) {
  return String(v ?? '').trim().length > LABEL_MAX
}

export default function VaccinePublicPanel({ accounts, season, drugNames, onReload, onFlash }) {
  const { t } = useTheme()

  /* ── 공통 스타일 — VaccineManage 의 ip·btn 과 같은 모양 ── */
  const ip = { padding: '7px 10px', border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, outline: 'none', background: t.bg, color: t.text, boxSizing: 'border-box' }
  const btn = (bg, fg, bd) => ({ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + (bd || bg), background: bg, color: fg, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' })
  const th = { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: t.textM, borderBottom: '1px solid ' + t.border, textAlign: 'left', whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: 12, color: t.text, borderBottom: '1px solid ' + t.border, textAlign: 'left' }

  /* ── 현재 절기 계정 — 표시명 편집 상태 ── */
  const rows = useMemo(
    () => (accounts || []).filter(a => a.season === season)
      .slice().sort((a, b) => String(a.drug_code).localeCompare(String(b.drug_code), 'ko')),
    [accounts, season])
  const baseline = useMemo(() => {
    const m = {}
    rows.forEach(a => { m[a.id] = a.public_label || '' })
    return m
  }, [rows])

  /* ★ draft 는 사용자가 **건드린 칸만** 담는다. 나머지는 baseline(= DB 값)이 그대로 보인다.
     저장·되돌리기에서 setDraft({}) 로 비우므로, 재조회가 끝나면 새 DB 값이 바로 보인다.
     effect 로 draft 를 비우지 않는다 — set-state-in-effect 규칙에 걸리고, 입력 중 포커스도 튄다. */
  const [draft, setDraft] = useState({})
  const [savingLabels, setSavingLabels] = useState(false)

  const valOf = a => (a.id in draft ? draft[a.id] : (baseline[a.id] ?? ''))
  const dirty = rows.filter(a => normLabel(valOf(a)) !== (a.public_label || null))
  const tooLong = rows.filter(a => labelTooLong(valOf(a)))

  async function saveLabels() {
    if (!dirty.length || tooLong.length) return
    setSavingLabels(true)
    let ok = 0, fail = 0, firstErr = null
    for (const a of dirty) {
      /* ★ updAccount 와 같은 클라이언트·RLS 경로. public_label 하나만 보낸다. */
      const { error } = await supabase.from('vaccine_accounts')
        .update({ public_label: normLabel(valOf(a)) }).eq('id', a.id)
      if (error) { fail++; if (!firstErr) firstErr = error } else ok++
    }
    setSavingLabels(false)
    if (fail) onFlash?.(ok + '건 저장, ' + fail + '건 실패했습니다: ' + dbErrorMsg(firstErr), 'err')
    else onFlash?.('공개 표시명 ' + ok + '건을 저장했습니다')
    setDraft({})
    onReload?.()
  }

  /* ── 주소 복사 — clipboard 실패 시 텍스트 선택으로 대체 ── */
  const urlRef = useRef(null)
  const [copied, setCopied] = useState(false)
  async function copyUrl() {
    const text = 'https://' + PUBLIC_URL
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); setTimeout(() => setCopied(false), 1800)
      onFlash?.('주소를 복사했습니다')
    } catch {
      /* 권한 거부·비보안 컨텍스트 — 사용자가 Ctrl+C 로 복사할 수 있게 선택만 해 준다 */
      const el = urlRef.current
      if (el) {
        const r = document.createRange(); r.selectNodeContents(el)
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r)
      }
      onFlash?.('자동 복사가 막혀 주소를 선택했습니다 — Ctrl+C 로 복사해 주세요', 'err')
    }
  }

  /* ── 공용 비밀번호 상태 ── */
  const [pwState, setPwState] = useState(null)   // { is_set, updated_at, locked_count }
  const [pwErr, setPwErr] = useState(null)
  const [pwLoading, setPwLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [modal, setModal] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let on = true
    ;(async () => {
      setPwLoading(true)
      try {
        const { data: s } = await supabase.auth.getSession()
        const token = s?.session?.access_token
        if (!token) { if (on) { setPwErr('로그인이 필요합니다'); setPwState(null) } return }
        const r = await fetch(API, { headers: { Authorization: 'Bearer ' + token } })
        const j = await r.json().catch(() => ({}))
        if (!on) return
        if (!r.ok || !j.ok) { setPwErr(j.msg || '상태를 불러오지 못했습니다'); setPwState(null) }
        else { setPwErr(null); setPwState({ is_set: !!j.is_set, updated_at: j.updated_at, locked_count: j.locked_count || 0 }) }
      } catch {
        if (on) { setPwErr('상태를 불러오지 못했습니다'); setPwState(null) }
      } finally { if (on) setPwLoading(false) }
    })()
    return () => { on = false }
  }, [tick])

  const fmtWhen = v => {
    if (!v) return '—'
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return '—'
    const p = n => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }

  const card = { background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: '14px 16px', marginTop: 14 }

  return <div style={card}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: t.purple }}>공개 조회 화면</span>
      <span style={{ fontSize: 11, color: t.textL }}>병동·외래에서 비밀번호만으로 잔량을 봅니다</span>
    </div>

    {/* ── 공개 주소 ── */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '10px 0 12px' }}>
      <span style={{ fontSize: 11, color: t.textM, minWidth: 58 }}>공개 주소</span>
      <code ref={urlRef} style={{ fontSize: 12, fontWeight: 700, color: t.blue, background: t.blue + '14', border: '1px solid ' + t.blue + '33', borderRadius: 7, padding: '5px 9px' }}>{PUBLIC_URL}</code>
      <button onClick={copyUrl} style={btn(t.bg, t.textM, t.border)}>{copied ? '복사됨' : '주소 복사'}</button>
    </div>

    {/* ── 공용 비밀번호 상태줄 ── */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 9, background: t.bg, border: '1px solid ' + t.border }}>
      <span style={{ fontSize: 11, color: t.textM, minWidth: 58 }}>공용 비밀번호</span>
      {pwLoading
        ? <span style={{ fontSize: 12, color: t.textL }}>불러오는 중...</span>
        : pwErr
          ? <span style={{ fontSize: 12, color: t.purple }}>{pwErr}</span>
          : <>
            <span style={{ fontSize: 12, fontWeight: 700, color: pwState?.is_set ? t.green : t.purple }}>
              {pwState?.is_set ? '설정됨' : '미설정'}
            </span>
            <span style={{ fontSize: 11, color: t.textM }}>마지막 변경 {fmtWhen(pwState?.updated_at)}</span>
            {pwState?.locked_count > 0 &&
              <span style={{ fontSize: 11, fontWeight: 700, color: t.purple, border: '1px solid ' + t.purple, borderRadius: 6, padding: '1px 7px' }}>
                잠긴 접속 {pwState.locked_count}건
              </span>}
          </>}
      <div style={{ flex: 1 }} />
      <button onClick={() => { setDone(false); setModal(true) }} style={btn(t.purple, '#fff')}>공개 비밀번호 재설정</button>
    </div>
    {done && <div style={{ marginTop: 8, fontSize: 11, color: t.green, borderLeft: '3px solid ' + t.green, paddingLeft: 8 }}>변경했습니다</div>}

    {/* ── 현재 절기 계정 표 (표준 표 사양 적용 제외 — 승인됨) ── */}
    <div style={{ marginTop: 14, marginBottom: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>공개 표시명</span>
      <span style={{ fontSize: 11, color: t.textL }}>{season} · 비우면 공개 화면에서 숨깁니다 · 최대 {LABEL_MAX}자</span>
    </div>

    {!rows.length
      ? <div style={{ padding: '22px 12px', textAlign: 'center', color: t.textL, fontSize: 12 }}>이 절기에 백신 계정이 없습니다</div>
      : <div style={{ border: '1px solid ' + t.border, borderRadius: 9, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: t.bg }}>
            <th style={th}>약품코드</th>
            <th style={th}>재원</th>
            <th style={th}>약품명</th>
            <th style={th}>공개 표시명</th>
            <th style={{ ...th, textAlign: 'center' }}>공개</th>
          </tr></thead>
          <tbody>{rows.map(a => {
            const v = valOf(a)
            const long = labelTooLong(v)
            const shown = !!normLabel(v)
            return <tr key={a.id}>
              <td style={{ ...td, fontSize: 11, color: t.textM, whiteSpace: 'nowrap' }}>{a.drug_code}</td>
              <td style={{ ...td, fontSize: 11, whiteSpace: 'nowrap' }}>{a.funding_source}</td>
              <td style={{ ...td, color: t.textM }}>{drugNames?.[(a.drug_code || '').trim()] || '—'}</td>
              <td style={{ ...td, width: '36%' }}>
                <input
                  value={v}
                  onChange={e => setDraft(d => ({ ...d, [a.id]: e.target.value }))}
                  placeholder="예: 독감(유료)"
                  maxLength={LABEL_MAX + 10}
                  style={{ ...ip, width: '100%', ...(long ? { borderColor: t.purple } : {}) }} />
                {long && <span style={{ display: 'block', marginTop: 4, fontSize: 10, color: t.purple }}>
                  {LABEL_MAX}자를 넘었습니다 ({String(v).trim().length}자)
                </span>}
              </td>
              <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 6, border: '1px solid ' + (shown ? t.green : t.lavender), color: shown ? t.green : t.lavender }}>
                  {shown ? '공개' : '숨김'}
                </span>
              </td>
            </tr>
          })}</tbody>
        </table>
      </div>}

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
      {tooLong.length > 0 && <span style={{ fontSize: 11, color: t.purple }}>{LABEL_MAX}자를 넘은 칸이 {tooLong.length}개 있어 저장할 수 없습니다</span>}
      {!tooLong.length && dirty.length > 0 && <span style={{ fontSize: 11, color: t.textM }}>바뀐 칸 {dirty.length}개</span>}
      <div style={{ flex: 1 }} />
      <button disabled={!dirty.length || savingLabels} onClick={() => setDraft({})}
        style={{ ...btn(t.bg, t.textM, t.border), ...(!dirty.length || savingLabels ? { cursor: 'not-allowed', opacity: 0.55 } : {}) }}>되돌리기</button>
      <button disabled={!dirty.length || !!tooLong.length || savingLabels} onClick={saveLabels}
        style={{ ...btn(t.green, '#fff'), ...(!dirty.length || tooLong.length || savingLabels ? { cursor: 'not-allowed', opacity: 0.55 } : {}) }}>
        {savingLabels ? '저장 중...' : '표시명 저장'}</button>
    </div>

    {modal && <PwModal t={t} ip={ip} btn={btn}
      onClose={() => setModal(false)}
      onDone={() => { setModal(false); setDone(true); setTick(x => x + 1) }} />}
  </div>
}

/* ═══ 시안 ⓑ-2 — 공개 비밀번호 재설정 창 ═══════════════════════════════════ */
function PwModal({ t, ip, btn, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const onlyDigits = v => v.replace(/\D/g, '').slice(0, PW_DIGITS)
  const formOk = new RegExp('^\\d{' + PW_DIGITS + '}$').test(pw)
  const matchOk = pw === pw2
  const canSend = formOk && matchOk && !busy

  async function submit() {
    if (!canSend) return
    setBusy(true); setMsg(null)
    try {
      const { data: s } = await supabase.auth.getSession()
      const token = s?.session?.access_token
      if (!token) { setMsg('로그인이 필요합니다'); setBusy(false); return }
      const r = await fetch(API, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pw, pw2 }),
      })
      const j = await r.json().catch(() => ({}))
      setBusy(false)
      if (!r.ok || !j.ok) { setMsg(j.msg || '변경에 실패했습니다'); return }
      /* ★ 입력값을 화면 상태에 남기지 않는다 */
      setPw(''); setPw2('')
      onDone()
    } catch {
      setBusy(false); setMsg('변경에 실패했습니다')
    }
  }

  const lb = { display: 'block', fontSize: 11, color: t.textM, marginBottom: 4 }

  return <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 13, padding: '18px 20px', width: 'min(100%, 340px)', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.purple, marginBottom: 12 }}>공개 비밀번호 재설정</div>

      <div style={{ marginBottom: 10 }}>
        <label style={lb}>새 비밀번호</label>
        <input type="password" inputMode="numeric" maxLength={PW_DIGITS} autoComplete="new-password"
          value={pw} onChange={e => setPw(onlyDigits(e.target.value))}
          style={{ ...ip, width: '100%', letterSpacing: 6, fontWeight: 700 }} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={lb}>한 번 더 입력</label>
        <input type="password" inputMode="numeric" maxLength={PW_DIGITS} autoComplete="new-password"
          value={pw2} onChange={e => setPw2(onlyDigits(e.target.value))}
          style={{ ...ip, width: '100%', letterSpacing: 6, fontWeight: 700, ...(pw2 && !matchOk ? { borderColor: t.purple } : {}) }} />
        {pw2 && !matchOk && <span style={{ display: 'block', marginTop: 4, fontSize: 10, color: t.purple }}>두 번 입력한 비밀번호가 다릅니다</span>}
      </div>

      <div style={{ borderLeft: '3px solid ' + t.lavender, paddingLeft: 9, margin: '12px 0', fontSize: 11, color: t.textM, lineHeight: 1.7 }}>
        <div>숫자 {PW_DIGITS}자리로 정합니다.</div>
        <div>병동·외래에 함께 알리는 공용 비밀번호입니다.</div>
        <div>바꾸면 잠겨 있던 접속이 모두 풀립니다.</div>
      </div>

      {msg && <div style={{ marginBottom: 10, fontSize: 11, color: t.purple, borderLeft: '3px solid ' + t.purple, paddingLeft: 8 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btn(t.bg, t.textM, t.border)}>취소</button>
        <button disabled={!canSend} onClick={submit}
          style={{ ...btn(t.purple, '#fff'), ...(canSend ? {} : { cursor: 'not-allowed', opacity: 0.55 }) }}>
          {busy ? '변경 중...' : '변경하기'}</button>
      </div>
    </div>
  </div>
}
