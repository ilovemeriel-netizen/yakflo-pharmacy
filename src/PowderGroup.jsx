/* 가루약 분리번호 — 조제관리 안의 기준표 화면 (2026-11-10 이정화 님 승인)
 *
 * ★ DB 를 바꾸지 않는다. `drugs` 를 **읽기만** 하고 번호는 그때그때 계산한다.
 *   (규칙은 src/lib/powderGroup.js — ATC·성분·제형만 본다. 약품코드를 박지 않는다.)
 *
 * ★ 1,000줄 함정 — `drugs` 는 **쪽을 나눠 끝까지** 읽는다.
 *   `supabase.from(...).select(...)` 는 기본 1,000줄만 주고 **오류도 내지 않는다.**
 *   약품이 1,100종이 넘으므로 한 번에 읽으면 조용히 잘린다. (src/lib/rowLimit.js)
 *
 * ★ 색·규격 — 새로 그리지 않는다.
 *   제목줄은 비상조제(EmergencyDispense.jsx)와 **같은 모양**:
 *     16px/700 보라(#804A87) 제목 + 12px t.textM 설명을 한 줄에, gap 10 · marginBottom 10.
 *   칩은 주의 칩 토큰(src/lib/cautionDefs.js)을, 표는 StandardTable 머리 규격을 따른다.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useTheme } from './lib/theme'
import { checkRowLimit } from './lib/rowLimit'
import { dbErrorMsg } from './lib/dbError'
import { HIGH_ALERT_BG, HIGH_ALERT_FG } from './lib/cautionDefs'
import { WarnTriangle } from './CautionChips'
import {
  buildPowderTable, searchPowder, overridesToMap, srToMap,
  GROUP_NAMES, GROUP_NOS, SR_GROUP_NO, MANUAL, CHECK,
} from './lib/powderGroup'
import {
  fetchOverrides, setOverrideMany, clearOverride, invalidateOverrides,
} from './lib/powderOverrides'
import { fetchSr, setSrMany, clearSr, invalidateSr } from './lib/powderSr'

/* 비상조제와 같은 상수 — 기존 팔레트. 새 색을 만들지 않는다. */
const PURPLE = '#804A87'

const num = n => Number(n || 0).toLocaleString()
const kst = s => {
  if (!s) return ''
  try { return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) }
  catch { return String(s) }
}

/* 가루 위험 칩 — ★ 기존 고위험 칩 토큰을 그대로 쓴다(새 색 아님).
   Chip() 규격: 테두리가 있으면 안여백을 1px 씩 줄여 바깥 크기를 맞춘다. */
function HazardChip({ title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: HIGH_ALERT_BG, color: HIGH_ALERT_FG,
      border: '1px solid ' + HIGH_ALERT_FG,
      padding: '2px 9px', borderRadius: 8,
      fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', verticalAlign: 'middle',
    }}><WarnTriangle />가루 위험</span>
  )
}

/* 번호 뱃지 — 사람이 고친 번호면 옆에 「수기」를 작게 붙인다(2026-11-10 이정화 님 결정).
   뱃지 색은 그대로 두고 글자만 더한다 — 뱃지 색을 바꾸면 번호를 읽기 어려워진다. */
function NumBadge({ t, no, manual }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 22, height: 22, padding: '0 6px', borderRadius: 7,
        background: t.accentL, color: t.accent, fontSize: 11.5, fontWeight: 700,
      }}>{no}</span>
      {manual && <span style={{ fontSize: 9, fontWeight: 700, color: t.amber }}>수기</span>}
    </span>
  )
}

function ManualChip({ t }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 8,
      background: t.blueL, color: t.blue, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>{MANUAL}</span>
  )
}

export default function PowderGroup() {
  const { t } = useTheme()
  const [drugs, setDrugs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [cutMsg, setCutMsg] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  /* 사람이 고친 번호 · 사람이 정한 서방정 표시 */
  const [ovMap, setOvMap] = useState({})
  const [srMap, setSrMap] = useState({})
  const [ovErr, setOvErr] = useState('')
  /* 여러 개 한꺼번에 — 체크한 약품코드 */
  const [picked, setPicked] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   /* { ok, text } */
  const [reload, setReload] = useState(0)

  /* ── 고친 번호 · 서방정 표시 읽기 ───────────────────────────────── */
  useEffect(() => {
    let dead = false
    ;(async () => {
      invalidateOverrides(); invalidateSr()
      const [ov, sr] = await Promise.all([fetchOverrides(), fetchSr()])
      if (dead) return
      const bad = ov.error || sr.error
      if (bad) { setOvErr('고친 값을 읽지 못했습니다: ' + dbErrorMsg(bad)); return }
      setOvErr('')
      setOvMap(overridesToMap(ov.rows))
      setSrMap(srToMap(sr.rows))
    })()
    return () => { dead = true }
  }, [reload])

  /* ── drugs 읽기 — 쪽을 나눠 끝까지 ───────────────────────────────── */
  useEffect(() => {
    let dead = false
    const PAGE = 1000, MAX_PAGES = 20
    ;(async () => {
      let rows = [], total = null
      for (let i = 0; i < MAX_PAGES; i++) {
        const from = i * PAGE
        const { data, error, count } = await supabase.from('drugs')
          .select('drug_code,drug_name,status,category,atc_code,narcotic_type,ingredient_kr,ingredient_en',
            { count: 'exact' })
          .order('drug_code')
          .range(from, from + PAGE - 1)
        if (dead) return
        if (error) { setErr('약품을 읽지 못했습니다: ' + dbErrorMsg(error)); setLoaded(true); return }
        if (count != null) total = count
        rows = rows.concat(data || [])
        if (!data || data.length < PAGE) break
      }
      const lim = checkRowLimit(rows, total)
      setDrugs(rows)
      setCutMsg(lim.cut ? lim.message : '')
      setLoaded(true)
    })()
    return () => { dead = true }
  }, [])

  const p = useMemo(() => buildPowderTable(drugs, ovMap, srMap), [drugs, ovMap, srMap])
  const hits = useMemo(() => searchPowder(p.rows, q), [p, q])
  const asked = q.trim() !== ''

  /* ── 번호 주기 / 되돌리기 ───────────────────────────────────────── */
  const toggle = code => setPicked(s => {
    const n = new Set(s)
    if (n.has(code)) n.delete(code); else n.add(code)
    return n
  })

  async function applyNo(no) {
    if (!picked.size || busy) return
    setBusy(true); setMsg(null)
    const codes = [...picked]
    let r
    try { r = await setOverrideMany(codes, no, note.trim()) }
    catch (e) { r = { error: e, saved: 0 } }
    setBusy(false)
    if (r.error) {
      setMsg({ ok: false, text: '번호를 주지 못했습니다: ' + dbErrorMsg(r.error) })
      return
    }
    if (r.saved !== codes.length) {
      setMsg({
        ok: false,
        text: '보낸 ' + num(codes.length) + '종 가운데 ' + num(r.saved)
          + '종만 저장됐습니다. 약플로 담당자에게 알려 주세요.',
      })
    } else {
      setMsg({ ok: true, text: num(r.saved) + '종을 ' + no + '번으로 바꿨습니다.' })
      setPicked(new Set()); setNote('')
    }
    setReload(v => v + 1)
  }

  async function revert(code, name) {
    if (busy) return
    setBusy(true); setMsg(null)
    let r
    try { r = await clearOverride(code) } catch (e) { r = { error: e } }
    setBusy(false)
    setMsg(r.error
      ? { ok: false, text: '되돌리지 못했습니다: ' + dbErrorMsg(r.error) }
      : { ok: true, text: name + ' 을(를) 자동 계산으로 되돌렸습니다.' })
    setReload(v => v + 1)
  }

  /* ── 서방정으로 / 서방정에서 빼기 ───────────────────────────────── */
  async function applySr(isSr) {
    if (!picked.size || busy) return
    setBusy(true); setMsg(null)
    const codes = [...picked]
    let r
    try { r = await setSrMany(codes, isSr, note.trim()) }
    catch (e) { r = { error: e, saved: 0 } }
    setBusy(false)
    if (r.error) {
      setMsg({ ok: false, text: '서방정 표시를 바꾸지 못했습니다: ' + dbErrorMsg(r.error) })
      return
    }
    if (r.saved !== codes.length) {
      setMsg({
        ok: false,
        text: '보낸 ' + num(codes.length) + '종 가운데 ' + num(r.saved)
          + '종만 저장됐습니다. 약플로 담당자에게 알려 주세요.',
      })
    } else {
      setMsg({
        ok: true,
        text: num(r.saved) + '종을 ' + (isSr ? '서방정으로 넣었습니다.' : '서방정에서 뺐습니다.'),
      })
      setPicked(new Set()); setNote('')
    }
    setReload(v => v + 1)
  }

  async function revertSr(code, name) {
    if (busy) return
    setBusy(true); setMsg(null)
    let r
    try { r = await clearSr(code) } catch (e) { r = { error: e } }
    setBusy(false)
    setMsg(r.error
      ? { ok: false, text: '되돌리지 못했습니다: ' + dbErrorMsg(r.error) }
      : { ok: true, text: name + ' 의 서방정 표시를 이름 기준으로 되돌렸습니다.' })
    setReload(v => v + 1)
  }

  const card = {
    background: t.card, border: '1px solid ' + t.border, borderRadius: 12,
    padding: 14, marginBottom: 12,
  }
  const th = {
    padding: '8px 10px', textAlign: 'center', color: t.textM, fontWeight: 700,
    borderBottom: '1px solid ' + t.border, fontSize: 11, background: t.bg,
  }
  const td = { padding: '8px 10px', borderBottom: '1px solid ' + t.border, fontSize: 12, color: t.text }

  const resultRow = x => (
    /* 사람이 고친 줄은 바탕을 옅게 — 한눈에 갈라 보라고(2026-11-10 이정화 님 결정 1).
       기존 amberL 토큰에 알파를 더해 **더 옅게** 쓴다. 새 색이 아니다. */
    <tr key={x.d.drug_code} style={x.r.manual ? { background: t.amberL + '66' } : undefined}>
      <td style={{ ...td, textAlign: 'center' }}>
        <input type="checkbox" checked={picked.has(x.d.drug_code)}
          onChange={() => toggle(x.d.drug_code)}
          aria-label={x.d.drug_name + ' 고르기'}
          style={{ width: 15, height: 15, accentColor: t.accent, cursor: 'pointer' }} />
      </td>
      <td style={{ ...td, fontWeight: 600 }}>{x.d.drug_name}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        {x.r.no == null
          ? <ManualChip t={t} />
          : <NumBadge t={t} no={x.r.no} manual={x.r.manual} />}
      </td>
      <td style={td}>{x.r.label}</td>
      {/* ★ 서방 칸 — 1번(일반 정제)에서만 뜻이 있다. 다른 번호는 「—」. */}
      <td style={{ ...td, textAlign: 'center' }}>
        {x.r.no !== SR_GROUP_NO
          ? <span style={{ color: t.textL }}>—</span>
          : x.s.sr
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: t.accent, fontWeight: 700, fontSize: 11 }}>서방</span>
              {x.s.manual && <span style={{ fontSize: 9, fontWeight: 700, color: t.amber }}>수기</span>}
            </span>
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: t.textL }}>—</span>
              {x.s.manual && <span style={{ fontSize: 9, fontWeight: 700, color: t.amber }}>수기</span>}
            </span>}
        {x.s.manual && (
          <div>
            <button type="button" disabled={busy}
              onClick={() => revertSr(x.d.drug_code, x.d.drug_name)}
              style={{
                marginTop: 3, padding: '2px 7px', borderRadius: 7, border: '1px solid ' + t.border,
                background: 'transparent', color: t.textM, fontSize: 9, fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.5 : 1,
              }}>되돌리기</button>
          </div>
        )}
      </td>
      <td style={td}>
        {x.r.hazard
          ? <HazardChip title={x.r.hazard} />
          : <span style={{ color: t.textL }}>—</span>}
        {x.r.note && <span style={{
          marginLeft: 6, fontSize: 10, color: t.amber, background: t.amberL,
          padding: '2px 7px', borderRadius: 8, fontWeight: 700,
        }}>{x.r.note}</span>}
      </td>
      {/* ★ 「자동이면 N번」을 **늘** 보인다 (2026-11-10 이정화 님 결정 2) —
          사람이 고친 것인지 규칙이 그렇게 말한 것인지 한눈에 갈라 보라고. */}
      <td style={{ ...td, fontSize: 11, color: t.textM }}>
        {x.r.manual ? (
          <>
            {x.r.override && x.r.override.note
              ? <span>{x.r.override.note}</span>
              : <span style={{ color: t.textL }}>까닭 없음</span>}
            <div style={{ fontSize: 10, color: t.textL, marginTop: 2 }}>
              자동 계산이면 {x.r.auto.no == null ? x.r.auto.label : x.r.auto.no + '번'} 입니다
              {x.r.override && x.r.override.updated_at
                ? ' · ' + kst(x.r.override.updated_at)
                : (x.r.override && x.r.override.created_at ? ' · ' + kst(x.r.override.created_at) : '')}
            </div>
          </>
        ) : <span style={{ color: t.textL }}>자동 계산</span>}
      </td>
      <td style={{ ...td, textAlign: 'center' }}>
        {x.r.manual
          ? <button type="button" disabled={busy}
            onClick={() => revert(x.d.drug_code, x.d.drug_name)}
            style={{
              padding: '5px 11px', borderRadius: 8, border: '1px solid ' + t.accent,
              background: 'transparent', color: t.accent, fontSize: 11, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.5 : 1,
            }}>되돌리기</button>
          : <span style={{ color: t.textL }}>—</span>}
      </td>
      <td style={{ ...td, color: t.textM, fontSize: 11 }}>{x.d.ingredient_kr || ''}</td>
      <td style={{ ...td, color: t.textM, fontSize: 11, textAlign: 'center' }}>{x.d.atc_code || ''}</td>
    </tr>
  )

  /* 1번 묶음은 「서방정 / 그 밖」 두 토막으로 보여 준다 — 번호는 그대로 1번이다. */
  const srSplit = g => (
    <>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, marginBottom: 6 }}>
        서방정 {num(g.sr.length)}종
        <span style={{ fontWeight: 400, color: t.textL, marginLeft: 6 }}>
          이름에 「서방」이 있거나, 손으로 넣은 약입니다 · 분리번호는 1번 그대로입니다
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {g.sr.length ? g.sr.map(pill) : <span style={{ color: t.textL, fontSize: 11 }}>해당 약 없음</span>}
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textM, marginBottom: 6 }}>
        그 밖 {num(g.nonSr.length)}종
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {g.nonSr.length ? g.nonSr.map(pill) : <span style={{ color: t.textL, fontSize: 11 }}>해당 약 없음</span>}
      </div>
    </>
  )

  const pill = x => (
    <span key={x.d.drug_code} title={x.r.why} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: t.text,
      /* 사람이 고친 약은 알약에도 옅은 바탕을 준다 — 목록에서도 갈라 보이게 */
      background: x.r.manual ? t.amberL : t.bg,
      border: '1px solid ' + (x.r.manual ? t.amber + '55' : t.border),
      borderRadius: 7, padding: '3px 9px',
    }}>
      {x.d.drug_name}
      {/* 1번 안에서 서방정이면 이름 뒤에 작게 「서방」 */}
      {x.r.no === SR_GROUP_NO && x.s.sr
        && <span style={{ fontSize: 9, fontWeight: 700, color: t.accent }}>서방</span>}
      {x.r.manual && <span style={{ fontSize: 9, fontWeight: 700, color: t.amber }}>수기</span>}
      {x.r.hazard && <WarnTriangle />}
    </span>
  )

  const section = (key, head, list, foldedByDefault, body) => {
    const isOpen = open[key] === undefined ? !foldedByDefault : open[key]
    return (
      <div key={key} style={{
        border: '1px solid ' + t.border, borderRadius: 10, background: t.card,
        marginBottom: 8, overflow: 'hidden',
      }}>
        <button
          type="button"
          onClick={() => setOpen(s => ({ ...s, [key]: !isOpen }))}
          aria-expanded={isOpen}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px',
            fontSize: 12, background: isOpen ? t.bg : 'transparent', border: 0,
            borderBottom: isOpen ? '1px solid ' + t.border : 0,
            cursor: 'pointer', textAlign: 'left', color: t.text, fontFamily: 'inherit',
          }}>
          <span style={{ color: t.textL, fontSize: 11, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
          {head}
          <span style={{ fontSize: 11, color: t.textM }}>{num(list.length)}종</span>
          {foldedByDefault && !isOpen
            && <span style={{ marginLeft: 'auto', fontSize: 10, color: t.textL }}>기본 접힘</span>}
        </button>
        {isOpen && (
          body
            /* 1번처럼 **안을 따로 그리는** 묶음은 body 를 받는다 */
            ? <div style={{ padding: '11px 13px' }}>{body}</div>
            : <div style={{ padding: '11px 13px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {list.length ? list.map(pill)
                : <span style={{ color: t.textL, fontSize: 11 }}>해당 약 없음</span>}
            </div>
        )}
      </div>
    )
  }

  return (
    /* ★ 바깥 여백 — 다른 화면과 **같은 값**(`padding: '20px 24px'`). 새 규격을 만들지 않는다.
       ★ textAlign:'left' 를 꼭 적는다 — index.css 의 `#root { text-align: center }` 가
         전 화면에 상속되기 때문이다(함정 #31). 안 적으면 표 칸 값·띠·안내글·목록 제목이
         죄다 가운데로 몰린다. 병동신청·실사·사용점검도 같은 이유로 이미 적어 두었다.
         (2026-11-10 — 처음 올릴 때 이 두 줄을 빠뜨려 운영에서 어긋났다.) */
    <div style={{ padding: '20px 24px', textAlign: 'left' }}>
      {/* ── 제목줄 — 비상조제와 같은 모양 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap', textAlign: 'left' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: PURPLE }}>가루약 분리번호</span>
        <span style={{ fontSize: 12, color: t.textM }}>
          약품 정보(ATC·성분·제형)로 그때그때 계산합니다 · 고친 번호가 있으면 그것을 먼저 씁니다
        </span>
        {loaded && !err && (
          <span style={{ fontSize: 11, color: t.textL }}>
            사용 중인 경구제 {num(p.total)}종
          </span>
        )}
      </div>

      {err && (
        <div style={{
          background: t.redL, color: t.red, border: '1px solid ' + t.red, borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 12,
        }}>❗ {err}</div>
      )}
      {ovErr && (
        <div style={{
          background: t.redL, color: t.red, border: '1px solid ' + t.red, borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 12,
        }}>❗ {ovErr}</div>
      )}
      {cutMsg && (
        <div style={{
          background: t.amberL, color: t.amber, border: '1px solid ' + t.amber, borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 12,
        }}>⚠ {cutMsg}</div>
      )}
      {/* ★ 바꾼 결과는 **반드시 보인다** — 잘됐는지 안 됐는지 모르는 채로 두지 않는다. */}
      {msg && (
        <div style={{
          background: msg.ok ? t.greenL : t.redL, color: msg.ok ? t.green : t.red,
          border: '1px solid ' + (msg.ok ? t.green : t.red), borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 12,
        }}>{msg.ok ? '✅ ' : '❗ '}{msg.text}</div>
      )}

      {/* ── 수기 요약 띠 ── */}
      {loaded && !err && (
        <div style={{
          background: t.amberL, border: '1px solid ' + t.border, borderRadius: 10,
          padding: '9px 13px', fontSize: 11.5, color: t.text, marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <b style={{ color: t.amber }}>수기 {num(p.edited.length)}종</b>
          <span style={{ color: t.textM }}>
            {p.edited.length
              ? '— 사람이 고친 번호입니다. 되돌리면 자동 계산으로 돌아갑니다.'
              : '— 아직 고친 번호가 없습니다. 모두 규칙으로 계산한 값입니다.'}
          </span>
          {p.edited.length > 0 && (
            <span style={{ color: t.textM }}>
              {p.edited.map(x => x.d.drug_name).join(' · ')}
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: t.textM }}>
            1번 안 <b style={{ color: t.accent }}>서방정 {num(p.sr.length)}종</b>
            {p.srEdited.length > 0 && <span style={{ color: t.textL }}> (손으로 정한 것 {num(p.srEdited.length)})</span>}
          </span>
        </div>
      )}

      {/* ── 고르기 띠 — 여러 개 한꺼번에 ── */}
      {loaded && !err && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '11px 14px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>고른 약 {num(picked.size)}종</span>
          <span style={{ fontSize: 11, color: t.textM }}>번호를 누르면 한꺼번에 바꿉니다</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {GROUP_NOS.map(n => (
              <button key={n} type="button" title={GROUP_NAMES[n]}
                disabled={!picked.size || busy}
                onClick={() => applyNo(n)}
                style={{
                  width: 30, height: 28, borderRadius: 7, border: '1px solid ' + t.border,
                  background: t.card, color: t.accent, fontSize: 12, fontWeight: 700,
                  cursor: (!picked.size || busy) ? 'not-allowed' : 'pointer',
                  opacity: (!picked.size || busy) ? 0.45 : 1, fontFamily: 'inherit',
                }}>{n}</button>
            ))}
          </div>
          {/* ★ 서방정 — 번호를 **바꾸지 않는다**. 1번 안에서 묶어 보는 표시만 바꾼다. */}
          <span style={{ width: 1, height: 20, background: t.border }} />
          <button type="button" disabled={!picked.size || busy} onClick={() => applySr(true)}
            title="1번(일반 정제) 안에서 서방정으로 묶어 봅니다. 분리번호는 그대로입니다."
            style={{
              padding: '7px 12px', borderRadius: 8, border: '1px solid ' + t.border,
              background: t.card, color: t.accent, fontSize: 11.5, fontWeight: 700,
              cursor: (!picked.size || busy) ? 'not-allowed' : 'pointer',
              opacity: (!picked.size || busy) ? 0.45 : 1, fontFamily: 'inherit',
            }}>서방정으로</button>
          <button type="button" disabled={!picked.size || busy} onClick={() => applySr(false)}
            title="이름에 「서방」이 있어도 서방정 묶음에서 뺍니다. 분리번호는 그대로입니다."
            style={{
              padding: '7px 12px', borderRadius: 8, border: '1px solid ' + t.border,
              background: t.card, color: t.textM, fontSize: 11.5, fontWeight: 700,
              cursor: (!picked.size || busy) ? 'not-allowed' : 'pointer',
              opacity: (!picked.size || busy) ? 0.45 : 1, fontFamily: 'inherit',
            }}>서방정에서 빼기</button>
          {/* 까닭은 **선택**이다 — 비워도 된다(2026-11-10 이정화 님 결정 5) */}
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="고친 까닭 (선택 — 비워도 됩니다)"
            aria-label="고친 까닭 (선택)"
            style={{
              flex: 1, minWidth: 180, border: '1px solid ' + t.borderH, borderRadius: 8,
              background: t.card, padding: '7px 10px', fontSize: 11.5, color: t.text,
              outline: 'none', fontFamily: 'inherit',
            }} />
          {picked.size > 0 && (
            <button type="button" onClick={() => { setPicked(new Set()); setNote('') }}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid ' + t.border,
                background: 'transparent', color: t.textM, fontSize: 11.5, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>고르기 지우기</button>
          )}
        </div>
      )}

      {/* ── 검색 ── */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="약품명 · 성분명으로 찾기 (예: 시그마트 · 니코란딜 · 마그네슘)"
            aria-label="약품명 또는 성분명으로 찾기"
            style={{
              flex: 1, border: '1px solid ' + t.borderH, borderRadius: 9, background: t.card,
              padding: '9px 12px', fontSize: 13, color: t.text, outline: 'none', fontFamily: 'inherit',
            }} />
          {asked && (
            <button type="button" onClick={() => setQ('')} style={{
              padding: '9px 16px', borderRadius: 9, border: '1px solid ' + t.border,
              background: 'transparent', color: t.textM, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>지우기</button>
          )}
        </div>
        {!asked && (
          <div style={{ fontSize: 10.5, color: t.textL, marginTop: 7 }}>
            약품명 일부나 성분명(한글·영문)으로 찾을 수 있습니다.
          </div>
        )}
      </div>

      {/* ── 검색 결과 ── */}
      {asked && (
        <div style={card}>
          {hits.length === 0
            ? <div style={{ padding: '18px 4px', color: t.textL, fontSize: 12 }}>
              「{q.trim()}」로 찾은 약이 없습니다. 약품명 일부나 성분명으로 다시 찾아 보세요.
            </div>
            : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                <th style={{ ...th, width: 38 }}>
                  {/* 찾은 약 전부 고르기 */}
                  <input type="checkbox"
                    aria-label="찾은 약 전부 고르기"
                    checked={hits.length > 0 && hits.every(x => picked.has(x.d.drug_code))}
                    onChange={e => setPicked(s => {
                      const n = new Set(s)
                      for (const x of hits) { if (e.target.checked) n.add(x.d.drug_code); else n.delete(x.d.drug_code) }
                      return n
                    })}
                    style={{ width: 15, height: 15, accentColor: t.accent, cursor: 'pointer' }} />
                </th>
                <th style={{ ...th, width: 210 }}>약품명</th>
                <th style={{ ...th, width: 92 }}>번호</th>
                <th style={{ ...th, width: 130 }}>구분</th>
                <th style={{ ...th, width: 74 }} title="1번(일반 정제) 안에서만 뜻이 있습니다">서방</th>
                <th style={{ ...th, width: 150 }}>가루 위험</th>
                <th style={{ ...th, width: 230 }}>고친 까닭 · 언제</th>
                <th style={{ ...th, width: 92 }}>되돌리기</th>
                <th style={th}>성분(한글)</th>
                <th style={{ ...th, width: 90 }}>ATC</th>
              </tr></thead>
              <tbody>{hits.map(resultRow)}</tbody>
            </table>}
        </div>
      )}

      {/* ── 「확인 필요」 안내 ── */}
      {loaded && !err && (
        <div style={{
          background: p.check.length ? t.amberL : t.accentL,
          border: '1px solid ' + (p.check.length ? t.amber : t.border),
          borderRadius: 10, padding: '9px 13px', fontSize: 11.5,
          color: p.check.length ? t.amber : t.text, marginBottom: 12,
        }}>
          {p.check.length
            ? <><b>{CHECK} {num(p.check.length)}종</b> — 규칙에 안 걸려 번호를 매기지 않았습니다:{' '}
              {p.check.map(x => x.d.drug_name).join(', ')}</>
            : <><b style={{ color: t.accent }}>{CHECK} 0종</b> — 사용 중인 경구제 {num(p.total)}종 모두 규칙으로 정해졌습니다.</>}
        </div>
      )}

      {/* ── 번호별 전체 목록 ── */}
      {loaded && !err && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: PURPLE }}>번호별 전체 목록</span>
            <span style={{ fontSize: 12, color: t.textM }}>
              모두 접혀 있습니다 · 머리를 누르면 펴집니다
            </span>
          </div>
          {p.groups.map(g => section(
            'g' + g.no,
            <>
              <NumBadge t={t} no={g.no} />
              <span style={{ fontWeight: 700, color: t.text }}>{g.name}</span>
              {/* 1번 머리에만 「서방 N」을 작게 */}
              {g.no === SR_GROUP_NO && g.sr.length > 0
                && <span style={{ fontSize: 10.5, color: t.accent, fontWeight: 700 }}>서방 {num(g.sr.length)}</span>}
            </>,
            g.list, g.folded,
            g.no === SR_GROUP_NO ? srSplit(g) : null))}
          {/* 수기조제 묶음도 **기본 접힘** (2026-11-11 이정화 님 결정) */}
          {section(
            'manual',
            <>
              <ManualChip t={t} />
              <span style={{ fontWeight: 700, color: t.text }}>마약 · 액체·가루 제형 — 분리번호 없음</span>
            </>,
            p.manual, true)}
        </>
      )}

      {!loaded && (
        <div style={{ padding: 40, textAlign: 'center', color: t.textL, fontSize: 13 }}>약품을 읽는 중입니다…</div>
      )}
    </div>
  )
}
