/* ═══════════════════════════════════════════════════════════════════════════
   수요조사 탭 — 공개 사이트 (단계 3)

   ★ 이 화면은 Supabase 클라이언트도 키도 가지지 않는다. Function 하나만 부른다.
       POST /api/vaccine/survey  { action: 'submit' | 'lookup' | 'update' | 'cancel', ... }
     토큰은 로그인 때 받은 것을 그대로 쓴다(잔량 조회와 같은 토큰).

   ★ 색은 로고 4색과 그 투명도만 — #804A87 · #019748 · #BFA6D9 · #2E4A62.
     CSS 변수(--v-purple · --v-green · --v-lav · --v-navy)를 쓰고 새 hex 를 만들지 않는다.
   ★ 누르는 것은 모두 44px 이상(휴대폰 390px 기준).
   ★ 확인번호 4칸은 로그인과 **같은 PinBoxes** 를 쓴다.

   화면 흐름
     form     신청 양식 (기본)
     dup      같은 이름 경고 — 「그래도 신청」 / 「수정하러 가기」
     done     완료 — 신청번호 크게 + 복사
     find     신청번호(사번) + 확인번호로 찾기
     edit     찾은 신청 수정 · 취소
   ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react'
import PinBoxes from './PinBoxes'
import { kstToday, fmtDotDate, fmtCloseLong } from './lib/surveyDate'
import { seasonLabel, shortVaccineName } from './lib/surveyText'

const TEL = '약제과 내선 217'
const MAX_FAMILY = 20
/* ★ 렌더 중에 시계를 읽지 않는다(react-hooks/purity) — 모듈 로드 시각을 기준으로 쓰고,
   화면으로 돌아올 때만 effect 에서 갱신한다. 자정을 넘겨 탭을 열어 둔 경우를 위한 것이다. */
const BOOT_NOW = Date.now()

/* ── 공통 조각 ─────────────────────────────────────────────────────────── */
const card = {
  background: '#FFFFFF', borderRadius: 18,
  border: '1px solid rgba(46, 74, 98, 0.12)', padding: '20px 18px',
}
const labelSt = { display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--v-navy)', marginBottom: 8 }
const inputSt = {
  width: '100%', height: 48, padding: '0 14px', fontSize: 16,
  border: '1.5px solid var(--v-line)', borderRadius: 12,
  background: '#FFFFFF', color: 'var(--v-navy)', boxSizing: 'border-box',
}
const btnMain = ready => ({
  width: '100%', height: 52, borderRadius: 12, border: 'none',
  background: ready ? 'var(--v-purple)' : 'rgba(128, 74, 135, 0.3)',
  color: '#FFFFFF', fontSize: 16, fontWeight: 700,
  cursor: ready ? 'pointer' : 'not-allowed',
})
const btnGhost = {
  width: '100%', minHeight: 48, borderRadius: 12,
  border: '1.5px solid var(--v-purple)', background: '#FFFFFF',
  color: 'var(--v-purple)', fontSize: 15, fontWeight: 700, cursor: 'pointer',
}
const noteSt = { fontSize: 13, color: 'rgba(46, 74, 98, 0.8)', lineHeight: 1.7 }

function Alert({ children, kind = 'info' }) {
  /* kind: info(보라) · good(초록) */
  const c = kind === 'good' ? 'var(--v-green)' : 'var(--v-purple)'
  const bg = kind === 'good' ? 'rgba(1, 151, 72, 0.08)' : 'rgba(128, 74, 135, 0.08)'
  return <div role="alert" style={{
    marginTop: 12, padding: '11px 13px', borderRadius: 10,
    background: bg, borderLeft: '3px solid ' + c,
    fontSize: 13, color: 'var(--v-navy)', lineHeight: 1.6,
  }}>{children}</div>
}

/* ── 본체 ──────────────────────────────────────────────────────────────── */
export default function SurveyTab({ survey, token, wide, onSurveyGone }) {
  const [view, setView] = useState('form')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  /* 양식 */
  const [consent, setConsent] = useState(false)
  const [empNo, setEmpNo] = useState('')
  const [name, setName] = useState('')
  const [selfDose, setSelfDose] = useState(true)
  const [family, setFamily] = useState(0)
  const [wish, setWish] = useState('')
  const [pin, setPin] = useState('')

  /* 찾기·완료 */
  const [findKey, setFindKey] = useState('')
  const [findPin, setFindPin] = useState('')
  const [done, setDone] = useState(null)      /* { receipt_code, wish_date, dose } */
  const [edit, setEdit] = useState(null)      /* publicView 결과 */
  const [copied, setCopied] = useState(false)

  /* 기준 시각 — 화면으로 돌아올 때만 갱신한다(렌더 중 시계 금지) */
  const [now, setNow] = useState(BOOT_NOW)
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const today = kstToday(now)
  const minDate = today > survey.vax_start ? today : survey.vax_start
  const maxDate = survey.vax_end
  const closed = !!survey.close_at && Date.parse(survey.close_at) <= now
  const dose = (selfDose ? 1 : 0) + Number(family || 0)
  /* ★ 수요조사 탭에서만 괄호를 뗀 이름을 쓴다(결정 ②). 잔량 탭 카드는 그대로다. */
  const vaccineName = shortVaccineName(survey.public_label) || '—'

  const formReady = consent && name.trim() && dose >= 1 && wish && pin.length === 4 && !busy && !closed
  const findReady = findKey.trim() && findPin.length === 4 && !busy

  async function call(payload) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/vaccine/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => null)
      setBusy(false)
      if (r.status === 401 && j?.message === '다시 로그인해 주세요') { onSurveyGone?.(); return null }
      return { status: r.status, j }
    } catch {
      setBusy(false); setMsg('연결이 불안정합니다')
      return null
    }
  }

  async function submit(confirmDup) {
    const res = await call({
      action: 'submit', consent, emp_no: empNo.trim() || null, name: name.trim(),
      self_dose: selfDose, family_count: Number(family || 0), wish_date: wish, pin,
      confirmDup: !!confirmDup,
    })
    if (!res) return
    const { j } = res
    if (j?.warning === 'name_dup') { setView('dup'); return }
    if (!j?.ok) { setMsg(j?.message || '신청하지 못했습니다'); setView('form'); return }
    setDone({ receipt_code: j.receipt_code, wish_date: j.wish_date, dose: j.dose })
    setPin(''); setView('done')
  }

  async function find() {
    const res = await call({ action: 'lookup', key: findKey.trim(), pin: findPin })
    if (!res) return
    if (!res.j?.ok) { setMsg(res.j?.message || '찾지 못했습니다'); return }
    const r = res.j.response
    setEdit(r)
    setSelfDose(!!r.self_dose); setFamily(Number(r.family_count || 0)); setWish(r.wish_date)
    setView('edit')
  }

  async function saveEdit() {
    const res = await call({
      action: 'update', key: findKey.trim(), pin: findPin,
      self_dose: selfDose, family_count: Number(family || 0), wish_date: wish,
    })
    if (!res) return
    if (!res.j?.ok) { setMsg(res.j?.message || '수정하지 못했습니다'); return }
    setEdit(res.j.response)
    setMsg('수정되었습니다')
  }

  async function cancelApply() {
    const res = await call({ action: 'cancel', key: findKey.trim(), pin: findPin })
    if (!res) return
    if (!res.j?.ok) { setMsg(res.j?.message || '취소하지 못했습니다'); return }
    setEdit(res.j.response)
    setMsg('신청이 취소되었습니다')
  }

  function resetForm() {
    setConsent(false); setEmpNo(''); setName(''); setSelfDose(true); setFamily(0)
    setWish(''); setPin(''); setMsg(null); setDone(null); setEdit(null)
    setFindKey(''); setFindPin(''); setView('form')
  }

  const pad = wide ? '20px 28px 0' : '14px 16px 0'

  /* ═══ 회차 안내 카드 ═══ */
  const infoCard = <div style={{ ...card, padding: '16px 18px' }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--v-purple)' }}>
      {vaccineName} · {seasonLabel(survey.season)}
    </div>
    <div style={{ fontSize: wide ? 19 : 17, fontWeight: 800, color: 'var(--v-navy)', marginTop: 4 }}>
      {survey.title}
    </div>
    <div style={{ ...noteSt, marginTop: 8 }}>
      접종 기간: <span className="num">{fmtDotDate(survey.vax_start)}</span> ~ <span className="num">{fmtDotDate(survey.vax_end)}</span>
      {survey.close_at ? <><br />신청 마감: <span className="num">{fmtCloseLong(survey.close_at)}</span></> : null}
      <br />신청 기준: 직원별 1회 신청 가능
    </div>
    {closed ? <Alert>신청이 마감되었습니다. 문의는 {TEL}로 해 주세요.</Alert> : null}
  </div>

  /* ═══ 개인정보 안내와 동의 ═══ */
  const consentCard = <div style={card}>
    <div style={labelSt}>개인정보 수집·이용 동의 안내</div>
    <div style={{ ...noteSt, fontSize: 12.5 }}>
      · 수집·이용 목적: 독감 예방접종 수요 파악 및 접종 일정 안내<br />
      · 수집 항목: 성명, 사번(선택), 직원 본인 접종 여부, 동반 접종 가족 수, 접종 희망일<br />
      · 보유·이용 기간: 해당 접종 기간 종료 후 파기<br />
      · 문의: 약제과(내선 217)
    </div>
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, marginTop: 12,
      minHeight: 44, cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--v-navy)',
    }}>
      <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
        style={{ width: 22, height: 22, accentColor: 'var(--v-purple)', flexShrink: 0 }} />
      개인정보 수집·이용에 동의합니다.
    </label>
  </div>

  /* ═══ 신청 양식 ═══ */
  const formCard = <div style={card}>
    <label htmlFor="sv-emp" style={labelSt}>사번 <span style={{ fontWeight: 500, color: 'rgba(46, 74, 98, 0.62)' }}>(선택)</span></label>
    <input id="sv-emp" value={empNo} onChange={e => setEmpNo(e.target.value)}
      inputMode="numeric" autoComplete="off" style={inputSt} />
    <div style={{ ...noteSt, fontSize: 12, marginTop: 6 }}>사번을 모르는 경우 생략 가능합니다.</div>

    <label htmlFor="sv-name" style={{ ...labelSt, marginTop: 16 }}>성명</label>
    <input id="sv-name" value={name} onChange={e => setName(e.target.value)}
      autoComplete="off" placeholder="성명을 입력해 주세요." style={inputSt} />

    <div style={{ ...labelSt, marginTop: 16 }}>직원 본인 접종(무료)</div>
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10,
      minHeight: 44, cursor: 'pointer', fontSize: 15, fontWeight: 700, color: 'var(--v-navy)',
    }}>
      <input type="checkbox" checked={selfDose} onChange={e => setSelfDose(e.target.checked)}
        style={{ width: 22, height: 22, accentColor: 'var(--v-purple)', flexShrink: 0 }} />
      직원 본인 접종
    </label>

    <div style={{ ...labelSt, marginTop: 16 }}>동반 접종 가족 수(유료)</div>
    <Stepper value={Number(family || 0)} onChange={setFamily} />

    <div style={{ ...labelSt, marginTop: 16 }}>신청 백신</div>
    <div style={{
      ...inputSt, display: 'flex', alignItems: 'center',
      background: 'rgba(191, 166, 217, 0.18)', border: '1.5px solid transparent', fontWeight: 700,
    }}>{vaccineName}</div>

    <label htmlFor="sv-wish" style={{ ...labelSt, marginTop: 16 }}>접종 희망일</label>
    {/* ★ date 입력은 placeholder 가 보이지 않는다 — 칸 위 보조 글씨로 둔다 */}
    <div style={{ ...noteSt, fontSize: 12, marginBottom: 6 }}>접종 희망일을 선택해 주세요.</div>
    <input id="sv-wish" type="date" value={wish} min={minDate} max={maxDate}
      onChange={e => setWish(e.target.value)} style={inputSt} />
    <div style={{ ...noteSt, fontSize: 12, marginTop: 6 }}>
      <span className="num">{fmtDotDate(minDate)}</span> ~ <span className="num">{fmtDotDate(maxDate)}</span> 중 선택 가능합니다.
    </div>

    <div style={{ ...labelSt, marginTop: 16 }}>확인번호(숫자 4자리)</div>
    <div style={{ ...noteSt, fontSize: 12, marginBottom: 6 }}>숫자 4자리를 입력해 주세요.</div>
    <PinBoxes id="sv-pin" value={pin} onChange={setPin} label="확인번호(숫자 4자리)" />
    <div style={{ ...noteSt, fontSize: 12, marginTop: 6 }}>
      ※ 신청 내역 조회·수정·취소 시 필요하므로 확인번호를 기억해 주시기 바랍니다.
    </div>

    <div style={{
      marginTop: 16, padding: '11px 13px', borderRadius: 10,
      background: 'rgba(1, 151, 72, 0.08)', fontSize: 14, fontWeight: 700, color: 'var(--v-navy)',
    }}>신청 수량 <span className="num">{dose}</span>도즈(<span className="num">{dose}</span>회분)</div>

    {msg ? <Alert>{msg}</Alert> : null}

    <button type="button" disabled={!formReady} onClick={() => submit(false)}
      style={{ ...btnMain(formReady), marginTop: 16 }}>
      {busy ? '보내는 중...' : '접종 신청하기'}
    </button>
  </div>

  /* ═══ 이름 중복 경고 ═══ */
  const dupCard = <div style={card}>
    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--v-navy)' }}>같은 이름의 신청이 있어요</div>
    <div style={{ ...noteSt, marginTop: 10 }}>
      같은 이름의 신청이 이미 있어요. 본인 신청이면 수정을 이용하고, 다른 분이면 그대로 신청하세요
    </div>
    <button type="button" onClick={() => submit(true)} disabled={busy}
      style={{ ...btnMain(!busy), marginTop: 16 }}>{busy ? '보내는 중...' : '그래도 신청'}</button>
    <button type="button" onClick={() => { setMsg(null); setView('find') }}
      style={{ ...btnGhost, marginTop: 10 }}>수정하러 가기</button>
  </div>

  /* ═══ 완료 ═══ */
  const doneCard = done ? <div style={card}>
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--v-green)' }}>신청이 접수되었습니다</div>
    <div style={{ ...labelSt, marginTop: 14 }}>신청번호</div>
    <div className="num" style={{
      fontSize: wide ? 40 : 34, fontWeight: 800, color: 'var(--v-purple)',
      letterSpacing: '0.08em', lineHeight: 1.2, wordBreak: 'break-all',
    }}>{done.receipt_code}</div>
    <button type="button" onClick={() => {
      try {
        navigator.clipboard?.writeText(done.receipt_code)
        setCopied(true); setTimeout(() => setCopied(false), 2000)
      } catch { /* 클립보드를 못 쓰면 눈으로 적는다 */ }
    }} style={{ ...btnGhost, marginTop: 12 }}>{copied ? '복사했어요' : '복사'}</button>
    <div style={{ ...noteSt, marginTop: 12, fontWeight: 700, color: 'var(--v-navy)' }}>
      이 번호와 확인번호가 있어야 수정할 수 있어요. 캡처해 두세요
    </div>
    <div style={{
      marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(46, 74, 98, 0.12)', ...noteSt,
    }}>
      희망일 <span className="num">{done.wish_date}</span><br />
      신청 도즈 <span className="num">{done.dose}</span>회분
    </div>
    <button type="button" onClick={resetForm} style={{ ...btnGhost, marginTop: 14 }}>처음으로</button>
  </div> : null

  /* ═══ 찾기 ═══ */
  const findCard = <div style={card}>
    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--v-navy)' }}>신청 수정·취소</div>
    <label htmlFor="sv-key" style={{ ...labelSt, marginTop: 14 }}>신청번호 또는 사번</label>
    <input id="sv-key" value={findKey} onChange={e => setFindKey(e.target.value)}
      autoComplete="off" placeholder="예: AB2345" style={inputSt} />
    <div style={{ ...labelSt, marginTop: 16 }}>확인번호 4자리</div>
    <PinBoxes id="sv-findpin" value={findPin} onChange={setFindPin} label="확인번호 4자리" />
    {msg ? <Alert>{msg}</Alert> : null}
    <button type="button" disabled={!findReady} onClick={find}
      style={{ ...btnMain(findReady), marginTop: 16 }}>{busy ? '찾는 중...' : '찾기'}</button>
    <button type="button" onClick={resetForm} style={{ ...btnGhost, marginTop: 10 }}>새로 신청하기</button>
  </div>

  /* ═══ 수정 ═══ */
  const editCard = edit ? <div style={card}>
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--v-purple)' }}>
      신청번호 <span className="num">{edit.receipt_code}</span>
    </div>
    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--v-navy)', marginTop: 4 }}>
      {edit.name}
      {edit.status === 'cancelled'
        ? <span style={{
          marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
          background: 'var(--v-navy)', color: '#FFFFFF',
        }}>취소됨</span>
        : null}
    </div>

    <div style={{ ...labelSt, marginTop: 16 }}>직원 본인 접종(무료)</div>
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10,
      minHeight: 44, cursor: 'pointer', fontSize: 15, fontWeight: 700, color: 'var(--v-navy)',
    }}>
      <input type="checkbox" checked={selfDose} onChange={e => setSelfDose(e.target.checked)}
        style={{ width: 22, height: 22, accentColor: 'var(--v-purple)', flexShrink: 0 }} />
      직원 본인 접종
    </label>

    <div style={{ ...labelSt, marginTop: 16 }}>동반 접종 가족 수(유료)</div>
    <Stepper value={Number(family || 0)} onChange={setFamily} />

    <label htmlFor="sv-wish2" style={{ ...labelSt, marginTop: 16 }}>접종 희망일</label>
    {/* ★ date 입력은 placeholder 가 보이지 않는다 — 칸 위 보조 글씨로 둔다 */}
    <div style={{ ...noteSt, fontSize: 12, marginBottom: 6 }}>접종 희망일을 선택해 주세요.</div>
    <input id="sv-wish2" type="date" value={wish} min={minDate} max={maxDate}
      onChange={e => setWish(e.target.value)} style={inputSt} />
    <div style={{ ...noteSt, fontSize: 12, marginTop: 6 }}>
      <span className="num">{fmtDotDate(minDate)}</span> ~ <span className="num">{fmtDotDate(maxDate)}</span> 중 선택 가능합니다.
    </div>

    <div style={{
      marginTop: 16, padding: '11px 13px', borderRadius: 10,
      background: 'rgba(1, 151, 72, 0.08)', fontSize: 14, fontWeight: 700, color: 'var(--v-navy)',
    }}>신청 수량 <span className="num">{dose}</span>도즈(<span className="num">{dose}</span>회분)</div>

    {msg ? <Alert kind={/되었습니다/.test(msg) ? 'good' : 'info'}>{msg}</Alert> : null}

    <button type="button" disabled={busy || dose < 1 || !wish} onClick={saveEdit}
      style={{ ...btnMain(!busy && dose >= 1 && !!wish), marginTop: 16 }}>
      {edit.status === 'cancelled' ? '다시 신청' : '수정하기'}
    </button>
    {edit.status !== 'cancelled'
      ? <button type="button" onClick={cancelApply} disabled={busy} style={{ ...btnGhost, marginTop: 10 }}>신청 취소</button>
      : null}
    <button type="button" onClick={resetForm} style={{ ...btnGhost, marginTop: 10, border: '1.5px solid var(--v-line)', color: 'var(--v-ink-dim)' }}>처음으로</button>
  </div> : null

  return <main style={{ padding: pad, textAlign: 'left', maxWidth: 560, margin: '0 auto' }}>
    <div style={{ display: 'grid', gap: 12 }}>
      {infoCard}
      {view === 'form' ? <>{consentCard}{formCard}</> : null}
      {view === 'dup' ? dupCard : null}
      {view === 'done' ? doneCard : null}
      {view === 'find' ? findCard : null}
      {view === 'edit' ? editCard : null}

      {view === 'form'
        ? <button type="button" onClick={() => { setMsg(null); setView('find') }}
          style={{ ...btnGhost, border: '1.5px solid var(--v-line)', color: 'var(--v-navy)' }}>
          기존 신청 조회·수정
        </button>
        : null}

      <p style={{ ...noteSt, textAlign: 'center', margin: '8px 0 26px' }}>
        문의 <span style={{ fontWeight: 700, color: 'var(--v-navy)' }}>{TEL}</span>
      </p>
    </div>
  </main>
}

/* ── − n + 스테퍼 ── */
function Stepper({ value, onChange }) {
  const btn = on => ({
    width: 48, height: 48, flexShrink: 0, borderRadius: 12,
    border: '1.5px solid ' + (on ? 'var(--v-purple)' : 'var(--v-line)'),
    background: '#FFFFFF', color: on ? 'var(--v-purple)' : 'var(--v-ink-dim)',
    fontSize: 22, fontWeight: 700, cursor: on ? 'pointer' : 'not-allowed', lineHeight: 1,
  })
  const canDown = value > 0, canUp = value < MAX_FAMILY
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <button type="button" aria-label="동반 접종 가족 수 줄이기" disabled={!canDown}
      onClick={() => onChange(Math.max(0, value - 1))} style={btn(canDown)}>−</button>
    <div style={{
      flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 800, color: 'var(--v-navy)',
    }}><span className="num">{value}</span>명</div>
    <button type="button" aria-label="동반 접종 가족 수 늘리기" disabled={!canUp}
      onClick={() => onChange(Math.min(MAX_FAMILY, value + 1))} style={btn(canUp)}>+</button>
  </div>
}

/* 마감 시각 표시는 lib/surveyDate.js 의 fmtCloseLong 으로 옮겼다
   — 「2026. 10. 31.(토) 18:00」 (KST). 시험이 그 함수를 고정한다. */
