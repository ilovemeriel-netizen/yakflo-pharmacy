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
import { DEPTS } from './lib/depts.js'
import { kstToday, fmtDotDate, fmtCloseLong } from './lib/surveyDate'
import { seasonLabel, shortVaccineName } from './lib/surveyText'

const TEL = '약제과(내선 217)'
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

  /* 동일 성명 안내 카드 — 「본인이 신청한 내역입니다」(mine) / 「본인의 신청 내역이 아닙니다」(other) */
  const [dupPick, setDupPick] = useState('mine')
  const [dupPin, setDupPin] = useState('')
  const [dept, setDept] = useState('')
  const [dupLeft, setDupLeft] = useState(null)   /* 남은 횟수 · null 이면 아직 틀린 적 없음 */
  const [dupLocked, setDupLocked] = useState(null)

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
      confirmDup: !!confirmDup, dept: confirmDup ? dept : null,
    })
    if (!res) return
    const { j } = res
    if (j?.warning === 'name_dup') {
      setDupPick('mine'); setDupPin(''); setDept(''); setDupLeft(null); setDupLocked(null)
      setMsg(null); setView('dup'); return
    }
    if (j?.code === 'EMP_DUP') { setMsg(null); setView('empdup'); return }
    if (!j?.ok) { setMsg(j?.message || '신청하지 못했습니다'); setView('form'); return }
    setDone({ receipt_code: j.receipt_code, wish_date: j.wish_date, dose: j.dose })
    setPin(''); setView('done')
  }

  /* 「본인이 신청한 내역입니다」 — 이름+확인번호로 내 신청을 찾아 수정 화면으로 간다.
     ★ 새 수정 경로를 만들지 않는다 — 신청번호를 받아 기존 lookup 을 그대로 탄다. */
  async function claim() {
    const res = await call({ action: 'claim', name: name.trim(), pin: dupPin })
    if (!res) return
    const j = res.j
    if (j?.code === 'LOCKED') { setDupLocked(j.message); return }
    if (!j?.ok) { setDupLeft(typeof j?.left === 'number' ? j.left : null); return }
    const r2 = await call({ action: 'lookup', key: j.receipt_code, pin: dupPin })
    if (!r2) return
    if (!r2.j?.ok) { setMsg(r2.j?.message || '찾지 못했습니다'); return }
    const r = r2.j.response
    setEdit(r); setFindKey(j.receipt_code); setFindPin(dupPin)
    setSelfDose(!!r.self_dose); setFamily(Number(r.family_count || 0)); setWish(r.wish_date)
    setDupPin(''); setMsg(null); setView('edit')
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
    {/* ★ keep-all 만 더한다 — 390px 에서 「기 / 억해」로 낱말 중간에서 끊긴다 */}
    <div style={{ ...noteSt, fontSize: 12, marginTop: 6, wordBreak: 'keep-all' }}>
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
  /* ═══ 같은 이름 안내 ═══
     ★ 「있어요」를 단정하지 않는다 — 카드가 뜨는 것만으로도 신호가 되므로
       문구는 「여러 분일 수 있어 한 번만 확인할게요」로 둔다.
     ★ 확인번호가 맞을 때만 신청 내용을 보여 준다. 틀리면 남은 횟수만 알린다. */
  const pick = (key, title, sub) => <label key={key} onClick={() => { setDupPick(key); setMsg(null) }}
    style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 12,
      border: '1.5px solid ' + (dupPick === key ? 'var(--v-purple)' : 'var(--v-line)'),
      background: dupPick === key ? 'rgba(128, 74, 135, 0.08)' : 'transparent',
      marginTop: 10, cursor: 'pointer',
    }}>
    <input type="radio" name="dup-pick" checked={dupPick === key} onChange={() => setDupPick(key)}
      style={{ marginTop: 3, accentColor: 'var(--v-purple)' }} />
    <span>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--v-navy)' }}>{title}</span>
      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--v-ink-dim)', marginTop: 3 }}>{sub}</span>
    </span>
  </label>

  const dupCard = <div style={card}>
    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--v-navy)' }}>
      {dupLocked ? '확인번호 입력이 일시적으로 제한되었습니다.' : '동일한 이름의 신청 내역이 있습니다.'}
    </div>
    {dupLocked
      ? <Alert>{dupLocked}</Alert>
      : <div style={{ ...noteSt, marginTop: 10 }}>
        동일한 이름으로 접수된 신청 내역이 있습니다. 본인의 신청 여부를 확인해 주시기 바랍니다.
      </div>}

    {dupLocked ? null : pick('mine', '본인이 신청한 내역입니다.',
      dupLeft != null
        ? '신청 내역을 확인하려면 확인번호 4자리를 입력해 주시기 바랍니다.'
        : '확인번호 4자리를 입력하면 신청 내역을 조회·수정할 수 있습니다.')}
    {dupPick === 'mine' && !dupLocked ? <>
      <div style={{ marginTop: 12 }}>
        <PinBoxes value={dupPin} onChange={v => { setDupPin(v); setDupLeft(null) }} label="확인번호" />
      </div>
      {dupLeft != null ? <Alert>확인번호가 일치하지 않습니다. 확인번호를 확인한 후 다시 입력해 주시기 바랍니다. 남은 시도 횟수: {dupLeft}회</Alert> : null}
    </> : null}

    {pick('other', '본인의 신청 내역이 아닙니다.', '소속을 선택하면 신규 신청을 진행할 수 있습니다.')}
    {dupPick === 'other' ? <>
      <label style={{ ...labelSt, marginTop: 14 }}>소속<span style={{ color: 'var(--v-purple)' }}>(필수)</span></label>
      <select value={dept} onChange={e => setDept(e.target.value)} style={inputSt}>
        <option value="">소속을 선택해 주시기 바랍니다.</option>
        {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </> : null}

    {/* ★ 제한 중에도 이 버튼은 **눌러야** 한다 — 눌러서 소속 선택으로 넘어간다.
        눌리는데 흐리게 보이면 못 누르는 줄 안다(실제 캡처로 잡았다). */}
    <button type="button" disabled={busy || (dupLocked ? false : (dupPick === 'mine' ? dupPin.length !== 4 : !dept))}
      onClick={() => (dupPick === 'mine' && !dupLocked) ? claim() : (dupLocked ? setDupPick('other') : submit(true))}
      style={{ ...btnMain(!busy && (dupLocked ? true : (dupPick === 'mine' ? dupPin.length === 4 : !!dept))), marginTop: 16 }}>
      {/* ★ 01 화면의 진행 버튼은 **「확인」 하나**다 — 선택지 문장을 버튼에 넣지 않는다.
          03(입력 제한)에서만 다음 할 일을 버튼 글자로 적는다(사용자 확정 2026-10-30). */}
      {busy ? '처리 중...' : dupLocked ? '본인의 신청 내역이 아닙니다.' : '확인'}
    </button>
    <button type="button" onClick={() => { setMsg(null); setView('form') }}
      style={{ ...btnGhost, marginTop: 10 }}>처음 화면으로</button>
  </div>

  /* ═══ 사번 중복 ═══ */
  const empDupCard = <div style={card}>
    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--v-navy)' }}>해당 사번으로 접수된 신청 내역이 있습니다.</div>
    <div style={{ ...noteSt, marginTop: 10 }}>
      동일한 사번으로 중복 신청할 수 없습니다.
      신청번호를 모르는 경우 사번과 확인번호로 기존 신청 내역을 조회할 수 있습니다.
    </div>
    <button type="button" onClick={() => { setMsg(null); setFindKey(empNo.trim()); setView('find') }}
      style={{ ...btnMain(!busy), marginTop: 16 }}>기존 신청 조회·수정</button>
    <button type="button" onClick={() => { setMsg(null); setView('form') }}
      style={{ ...btnGhost, marginTop: 10 }}>처음 화면으로</button>
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
    <button type="button" onClick={resetForm} style={{ ...btnGhost, marginTop: 14 }}>처음 화면으로</button>
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
    <button type="button" onClick={resetForm} style={{ ...btnGhost, marginTop: 10, border: '1.5px solid var(--v-line)', color: 'var(--v-ink-dim)' }}>처음 화면으로</button>
  </div> : null

  return <main style={{ padding: pad, textAlign: 'left', maxWidth: 560, margin: '0 auto' }}>
    <div style={{ display: 'grid', gap: 12 }}>
      {infoCard}
      {view === 'form' ? <>{consentCard}{formCard}</> : null}
      {view === 'dup' ? dupCard : null}
      {view === 'empdup' ? empDupCard : null}
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
