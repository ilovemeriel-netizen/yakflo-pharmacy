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
  GROUP_NAMES, SR_GROUP_NO, MANUAL, CHECK, ATC_MANUAL_LABEL,
} from './lib/powderGroup'
import { fetchGroupVocab, invalidateVocab, fallbackVocab } from './lib/powderGroupVocab'
import {
  fetchOverrides, setOverrideMany, clearOverride, invalidateOverrides,
} from './lib/powderOverrides'
import { fetchSr, setSrMany, clearSr, invalidateSr } from './lib/powderSr'
import { ingOne } from './lib/ingredientOne'

/* 비상조제와 같은 상수 — 기존 팔레트. 새 색을 만들지 않는다. */
const PURPLE = '#804A87', GREEN = '#019748', LAV = '#BFA6D9', NAVY = '#2E4A62'

/* 묶음 상자 바탕색 — 비상조제(EmergencyDispense.jsx)의 `sepTint` 와 **같은 방식**이다.
   팔레트 4색에 저알파('2b')를 붙여 옅게 돌려 쓴다. 새 색이 아니다.
   ★ 빨강(가루 위험)·주황(수기)은 **쓰지 않는다** — 그 두 색은 이미 뜻이 있어 겹친다.
   ★ 비상조제처럼 글자를 섞어(해시) 고르지 않고 **차례대로** 돌린다.
     그래야 옆·위아래 상자끼리 색이 늘 달라진다(2026-11-11 이정화 님 요청). */
const BOX_TINTS = [LAV, PURPLE, GREEN, NAVY]
const boxTint = i => BOX_TINTS[((i % BOX_TINTS.length) + BOX_TINTS.length) % BOX_TINTS.length] + '2b'

/* 칸 최소 높이 — ATC 카세트 화면(App.jsx 의 AtcView)과 **같은 값**이다.
   이 값이 모든 칸을 같은 높이로 잡아 줄이 세로로 맞는다. 새 규격을 만들지 않는다. */
const CELL_MIN = 78

/* 묶음 카드 — 예전 카드(168×92) **4장(2×2)** 크기다.
   세로 92×2 + 사이 8 = 192. 가로는 `minmax(340px,1fr)` 이 1,126px 에서 345px 를 만든다
   (168×2 + 8 = 345, 한 줄 3장 — 2026-11-11 실측).
   ★ 미리보기는 **3줄 + 「외 N종」**. 이 높이에 딱 맞는 줄 수다 — 더 넣으면 카드가 커진다. */
const CARD_H = 192
const CARD_PREVIEW = 3

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
  /* ★ 한 번에 **한 묶음만** 펼친다. null 이면 모두 접힌 상태다.
       고른 약(`picked`)은 여기와 따로 있으므로 접었다 펴도 체크가 그대로 남는다. */
  const [openKey, setOpenKey] = useState(null)
  /* 사람이 고친 번호 · 사람이 정한 서방정 표시 · 번호 목록 */
  const [ovMap, setOvMap] = useState({})
  const [srMap, setSrMap] = useState({})
  const [vocab, setVocab] = useState(() => fallbackVocab())
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
      invalidateOverrides(); invalidateSr(); invalidateVocab()
      const [ov, sr, vo] = await Promise.all([fetchOverrides(), fetchSr(), fetchGroupVocab()])
      if (dead) return
      /* 번호 목록은 못 읽어도 기본값으로 돌아간다 — 화면이 비면 안 된다 */
      setVocab(vo.vocab)
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
          .select('drug_code,drug_name,status,category,atc_code,narcotic_type,ingredient_kr,ingredient_en,atc_excluded',
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

  const p = useMemo(() => buildPowderTable(drugs, ovMap, srMap, vocab), [drugs, ovMap, srMap, vocab])
  const hits = useMemo(() => searchPowder(p.rows, q), [p, q])
  const asked = q.trim() !== ''

  /* ── 카드 목록 — 번호 카드(목록 차례) + **맨 끝에** 수기조제 카드 ────
     ★ 묶음 합 = 사용 중인 경구제 수. 번호 카드의 종수를 다 더하고 수기조제를 더하면
       `p.total` 과 같아야 한다(시험으로 못 박아 두었다). 카드를 빠뜨리면 약이 숨는다. */
  const cards = useMemo(() => ([
    ...p.groups.map(g => ({ key: 'g' + g.no, no: g.no, name: g.name, n: g.list.length, g })),
    /* ★ 꼬리말 「— 번호별 목록에서 뺐습니다」를 뺐다 (글자 줄이기 A안).
         무슨 뜻인지는 펼친 상자 머리의 「가루약 N · ATC N」이 말해 준다. */
    {
      key: 'manual', no: null, name: MANUAL,
      n: p.manual.length, g: { no: null, list: p.manual },
    },
  ]), [p])

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
  /* ★ 긴 글자 — 약품목록(StandardTable)이 쓰는 **같은 규칙**이다.
       한 줄로 두고, 넘치면 말줄임(…), 마우스를 올리면 전체가 보인다(title).
       이 규칙이 없으면 성분 칸이 45px 로 쪼그라들어 글자가 세로로 쌓인다
       (2026-11-11 실측 — 아로나민케어싸이정 줄 높이 1,557px). */
  const clip = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  /* 칸 너비 — 좁은 칸을 줄여 성분 칸에 폭을 내준다. 성분 칸만 너비를 주지 않는다. */
  /* ★ 구분 칸은 「ATC 수기」 표시가 함께 들어가므로 넉넉히 준다 —
       104px 에서는 「일반 정제 A…」로 잘렸다(2026-11-11 실측). */
  const W = { chk: 34, name: 190, no: 66, gubun: 150, sr: 52, haz: 104, why: 110, rev: 74, atc: 86 }

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
      <td style={{ ...td, fontWeight: 600, ...clip }} title={x.d.drug_name}>{x.d.drug_name}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        {x.r.no == null
          ? <ManualChip t={t} />
          : <NumBadge t={t} no={x.r.no} manual={x.r.manual} />}
      </td>
      <td style={{ ...td, ...clip }} title={x.r.label}>
        {x.r.label}
        {/* ATC 화면에서 「수기 조제」로 빼 둔 약 — 가루약 수기조제와 뜻이 다르므로 따로 적는다 */}
        {x.atcManual && <span style={{
          marginLeft: 5, fontSize: 9, fontWeight: 700, color: t.blue,
          background: t.blueL, padding: '1px 6px', borderRadius: 7, whiteSpace: 'nowrap',
        }}>{ATC_MANUAL_LABEL}</span>}
      </td>
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
      {/* ★ 성분 — ATC 배치 목록과 **같은 함수**(ingOne): 「영문 (한글)」, 복합제는 「… 외 N종」 */}
      <td style={{ ...td, color: t.textM, fontSize: 11, ...clip }}
        title={[x.d.ingredient_en, x.d.ingredient_kr].filter(Boolean).join(' / ')}>
        {ingOne(x.d) || '-'}
      </td>
      <td style={{ ...td, color: t.textM, fontSize: 11, textAlign: 'center' }}>{x.d.atc_code || ''}</td>
    </tr>
  )

  /* ── 칸 하나 — ATC 카세트 화면(AtcView)과 **같은 규격** ─────────────
     최소 높이 78 · 둥글기 6 · 안여백 '3px 5px' · 이름 9.5px/600 **두 줄까지**.
     ★ 칸에는 **그림자를 넣지 않는다** — 칸이 수십 개 붙으면 그림자가 서로 겹쳐
       지저분해진다. ATC 카세트도 같은 까닭으로 넣지 않았다(2026-11-11 실측).
     ★ 칸에 가나다 번호를 적지 않는다 — 분리번호와 헷갈린다(이정화 님 결정).
     ★ 체크는 `picked` 를 본다 — 묶음을 접었다 펴도, 검색 표와도 **같은 값**이다. */
  const cellOf = (x, srOk) => {
    const on = picked.has(x.d.drug_code)
    const badges = []
    /* 「서방」은 1번(일반 정제) 안에서만 뜻이 있다 */
    if (srOk && x.s.sr && !x.atcManual) badges.push(['서방', t.accentL, t.accent])
    if (x.atcManual) badges.push([ATC_MANUAL_LABEL, t.blueL, t.blue])
    if (x.r.manual) badges.push(['수기', t.amberL, t.amber])
    return (
      <div key={x.d.drug_code}
        title={x.d.drug_name + ' · ' + (ingOne(x.d) || '-') + ' · ' + (x.d.atc_code || '') + ' · ' + x.r.why}
        style={{
          borderRadius: 6, padding: '3px 5px', boxSizing: 'border-box', minHeight: CELL_MIN,
          border: on ? '2px solid ' + t.accent : '1px solid ' + t.border,
          background: on ? t.accentL : t.card,
          display: 'flex', flexDirection: 'column',
        }}>
        <div style={{
          fontSize: 9, fontWeight: 700, display: 'flex', justifyContent: 'space-between',
          gap: 3, alignItems: 'center', flexWrap: 'wrap', rowGap: 2, minHeight: 13,
        }}>
          <input type="checkbox" checked={on} onChange={() => toggle(x.d.drug_code)}
            aria-label={x.d.drug_name + ' 고르기'}
            style={{
              width: 12, height: 12, margin: 0, flexShrink: 0,
              accentColor: t.accent, cursor: 'pointer',
            }} />
          <span style={{
            display: 'inline-flex', gap: 2, flexWrap: 'wrap',
            justifyContent: 'flex-end', flexShrink: 0, maxWidth: '100%',
          }}>
            {badges.map(([txt, bg, fg]) => (
              <span key={txt} style={{
                fontSize: 8, fontWeight: 700, padding: '0 4px', borderRadius: 3,
                background: bg, color: fg, whiteSpace: 'nowrap',
              }}>{txt}</span>
            ))}
            {x.r.hazard && <WarnTriangle />}
          </span>
        </div>
        <div style={{
          fontSize: 9.5, fontWeight: 600, lineHeight: 1.15, marginTop: 2, color: t.text,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          whiteSpace: 'normal', overflow: 'hidden',
        }}>{x.d.drug_name}</div>
        <div style={{ marginTop: 'auto', fontSize: 8, color: t.textL, ...clip }}>{x.d.atc_code || ''}</div>
      </div>
    )
  }

  /* 칸 격자 — ATC 카세트와 같은 gap 4. `auto-fill` 이라 폭이 좁아지면 칸 수가 줄어든다. */
  const cellGrid = (list, srOk) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4 }}>
      {list.map(x => cellOf(x, srOk))}
    </div>
  )
  const none = <span style={{ color: t.textM, fontSize: 11 }}>해당 약 없음</span>

  /* 상자 속 — 1번만 「서방정 / 그 밖」 두 토막이다. 번호는 그대로 1번이다. */
  const boxBody = g => ((g.no === SR_GROUP_NO && g.sr)
    ? (
      <>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, marginBottom: 5 }}>
          서방정 {num(g.sr.length)}종
          <span style={{ fontWeight: 400, color: t.textM, marginLeft: 6 }}>
            이름에 「서방」이 있거나, 손으로 넣은 약입니다 · 분리번호는 1번 그대로입니다
          </span>
        </div>
        {/* 안쪽 테두리는 **흰색에 알파**를 준다 — 상자 바탕색이 비쳐 보이게. 새 색이 아니다. */}
        <div style={{ border: '1px solid ' + t.card + 'CC', borderRadius: 8, padding: 6, marginBottom: 10 }}>
          {g.sr.length ? cellGrid(g.sr, true) : none}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textM, marginBottom: 5 }}>
          그 밖 {num(g.nonSr.length)}종
        </div>
        <div style={{ border: '1px solid ' + t.card + 'CC', borderRadius: 8, padding: 6 }}>
          {g.nonSr.length ? cellGrid(g.nonSr, true) : none}
        </div>
      </>
    )
    : (g.list.length ? cellGrid(g.list, false) : none))

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
        {/* ★ 긴 설명을 뺐다 (2026-11-11 이정화 님 결정 — 화면 글자 줄이기 A안).
            「약품 정보(ATC·성분·제형)로 그때그때 계산합니다 · 고친 번호가 있으면 그것을 먼저 씁니다」 */}
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
            {/* ★ 단추는 **번호 목록**에서 그린다 — 번호를 더하면 단추도 저절로 는다.
                10개까지는 한 줄에 들어가고, 넘치면 flexWrap 이 줄을 바꾼다. */}
            {vocab.map(({ no: n, label }) => (
              <button key={n} type="button" title={label || GROUP_NAMES[n]}
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
            /* ★ tableLayout:'fixed' + colgroup — 적은 너비가 **그대로** 지켜진다.
                 너비를 안 준 성분 칸이 남는 폭을 혼자 먹는다(45px → 186px). */
            : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: W.chk }} /><col style={{ width: W.name }} />
                <col style={{ width: W.no }} /><col style={{ width: W.gubun }} />
                <col style={{ width: W.sr }} /><col style={{ width: W.haz }} />
                <col style={{ width: W.why }} /><col style={{ width: W.rev }} />
                <col /><col style={{ width: W.atc }} />
              </colgroup>
              <thead><tr>
                <th style={th}>
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
                <th style={{ ...th, ...clip }}>약품명</th>
                <th style={th}>번호</th>
                <th style={{ ...th, ...clip }}>구분</th>
                <th style={th} title="1번(일반 정제) 안에서만 뜻이 있습니다">서방</th>
                <th style={th}>가루 위험</th>
                <th style={{ ...th, ...clip }}>고친 까닭</th>
                <th style={th}>되돌리기</th>
                <th style={{ ...th, ...clip }}>성분 (영문 · 한글)</th>
                <th style={th}>ATC</th>
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
            {/* ★ 설명을 뺐다 (글자 줄이기 A안) — 카드가 눌리는 모양(그림자·손 모양)으로 알 수 있다 */}
          </div>
          {/* ★ 카드 격자 — 번호마다 카드 한 장, **수기조제는 맨 끝**.
              누른 카드만 그 번호의 바탕색과 함께 아래에 펼쳐진다
              (2026-11-11 이정화 님이 고른 시안 ⓑ).
              ★ 카드 1장 = 예전 카드 4장(2×2) 크기다 — 1,126px 에서 345×192px, 한 줄 3장.
                `minmax(340px,1fr)` 과 `minHeight: CARD_H` 가 그 크기를 만든다(실측).
              ★ 바탕색은 **늘** 그 번호의 색이다. 누른 카드는 테두리 2px + 진한 그림자로 가린다. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 8, marginBottom: 12,
          }}>
            {cards.map((c, i) => {
              const on = openKey === c.key
              /* 미리보기 — 가나다 앞에서 3종 + 「… 외 N종」 (2026-11-11 이정화 님 결정).
                 카드 높이 192px 에 **딱 맞는 줄 수**다. 더 넣으면 카드가 커진다. */
              const head = c.g.list.slice(0, CARD_PREVIEW)
              const rest = c.n - head.length
              return (
                <button key={c.key} type="button" aria-expanded={on}
                  onClick={() => setOpenKey(k => (k === c.key ? null : c.key))}
                  style={{
                    border: on ? '2px solid ' + t.accent : '1px solid ' + t.border,
                    borderRadius: 14, background: boxTint(i),
                    boxShadow: on ? t.shadowH : t.shadow,
                    padding: on ? '13px 15px' : '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 8, minHeight: CARD_H,
                    boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer',
                    color: t.text, fontFamily: 'inherit',
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 46, height: 46, padding: '0 10px', borderRadius: 12,
                      background: t.card, border: '1px solid ' + t.border,
                      color: c.no == null ? t.blue : t.accent,
                      fontSize: c.no == null ? 17 : 32, fontWeight: 700, flexShrink: 0,
                    }}>{c.no == null ? '수기' : c.no}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: t.text, lineHeight: 1.25 }}>{c.name}</span>
                    <span style={{
                      fontSize: 13, color: t.textM, fontWeight: 700,
                      marginLeft: 'auto', flexShrink: 0,
                    }}>{num(c.n)}종</span>
                  </span>
                  <span style={{ fontSize: 10.5, lineHeight: 1.5, color: t.textM, overflow: 'hidden' }}>
                    {head.map(x => (
                      <span key={x.d.drug_code} style={{ display: 'block', ...clip }}>· {x.d.drug_name}</span>
                    ))}
                    {rest > 0 && <span style={{ display: 'block', color: t.textL }}>… 외 {num(rest)}종</span>}
                    {!c.n && <span style={{ display: 'block', color: t.textL }}>해당 약 없음</span>}
                  </span>
                </button>
              )
            })}
          </div>
          {/* 펼친 상자 — 카드와 **같은 바탕색**으로 바로 아래에 둔다 */}
          {cards.map((c, i) => (openKey !== c.key ? null : (
            <div key={'box' + c.key} style={{
              border: '1px solid ' + t.border, borderRadius: 12, background: boxTint(i),
              padding: '10px 12px', boxShadow: t.shadow, boxSizing: 'border-box', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, flexWrap: 'wrap' }}>
                {c.no == null
                  ? <ManualChip t={t} />
                  : <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 30, height: 30, padding: '0 8px', borderRadius: 9,
                    background: t.card, border: '1px solid ' + t.border,
                    color: t.accent, fontSize: 17, fontWeight: 700,
                  }}>{c.no}</span>}
                <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{c.name}</span>
                <span style={{ fontSize: 11, color: t.textM, fontWeight: 700 }}>{num(c.n)}종</span>
                {c.no === SR_GROUP_NO && c.g.sr && c.g.sr.length > 0 && (
                  <span style={{ fontSize: 10.5, color: t.accent, fontWeight: 700 }}>
                    서방 {num(c.g.sr.length)}
                  </span>
                )}
                {c.no == null && (
                  <span style={{ fontSize: 10.5, color: t.textM }}>
                    가루약 {num(p.manualPowder.length)} · ATC {num(p.manualAtc.length)}
                  </span>
                )}
                <button type="button" onClick={() => setOpenKey(null)}
                  style={{
                    marginLeft: 'auto', padding: '5px 12px', borderRadius: 8,
                    border: '1px solid ' + t.border, background: t.card, color: t.textM,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}>접기</button>
              </div>
              {boxBody(c.g)}
            </div>
          )))}
        </>
      )}

      {!loaded && (
        <div style={{ padding: 40, textAlign: 'center', color: t.textL, fontSize: 13 }}>약품을 읽는 중입니다…</div>
      )}
    </div>
  )
}
