/* 약플로 · 사용량 비교 — 마감된 달 기준으로 **계산해 보여 주고**, 고른 약만 저장한다.
   (2026-11-09 시안 105~107, 이정화 님 승인)

   ★ 창을 열기만 해서는 **아무것도 바뀌지 않는다.** 「적용」을 눌러야 저장한다.

   ★ 저장은 기존 DB 함수 하나(`app_save_usage_bulk`)로 **한 번에** 한다.
     한 문장 UPDATE 라 전부 성공 아니면 전부 취소다. 줄마다 저장하면 중간에 끊겼을 때
     절반만 들어간 상태가 남는다.

   ★ 전년 사용량은 보내지 않는다 — 수기 유지(2026-11-09 결정).

   ★ 색·부품 — 부모가 넘긴 t 만 쓴다. **새 색 없음.** 표·뱃지는 App.jsx 와 같은 모양을
     쓰되 import 하지 않는다(순환 import 회피 — NarcoticUsageModal 과 같은 방식).

   ★ 계산식은 `lib/usageCompare.js` 에만 있다. 여기서 셈하지 않는다. */
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase'
import { buildUsageCompare, applyRows, applySummary, APPLY_FIELDS, closedWindow } from './lib/usageCompare'
import { checkRowLimit } from './lib/rowLimit'
import { dbErrorMsg } from './lib/dbError'

const num = v => Number(v || 0).toLocaleString()

/* 「8·9·10월」처럼 석 달을 적는다. 해가 바뀌어도 맞게 — 1월이면 11·12·1월이 된다. */
function monthLabel(year, month) {
  if (!year || !month) return ''
  const m = [2, 1, 0].map(k => new Date(Date.UTC(year, month - 1 - k, 1)).getUTCMonth() + 1)
  return m.join('·') + '월'
}

export default function UsageCompareModal({ t, drugs, year: fixedY, month: fixedM, isTenantManager, onClose, onReload, Confirm }) {
  const box = useRef(null)
  const [loaded, setLoaded] = useState(null)
  const [onlyMoved, setOnlyMoved] = useState(true)
  const [off, setOff] = useState(() => new Set())   /* 체크를 **푼** 약품코드 */

  /* ── 기준월 — 가장 최근에 **마감된** 달 ──────────────────────────────
     ★ 부모가 연·월을 넘기면 그것을 쓰고(월마감 화면), 안 넘기면 여기서 찾는다
       (재고현황 화면). 「오늘」로 정하지 않는다 — 마감과 짝이 맞아야 한다. */
  const [found, setFound] = useState(null)      /* 스스로 찾은 마감월 */
  const [ymErr, setYmErr] = useState('')
  /* 부모가 넘긴 값이 있으면 그걸 쓴다 — 상태로 베끼지 않는다(베끼면 덧렌더가 생긴다) */
  const ym = (fixedY && fixedM) ? { y: fixedY, m: fixedM } : found
  useEffect(() => {
    if (fixedY && fixedM) return undefined
    let dead = false
    supabase.from('monthly_snapshots').select('snap_year,snap_month')
      .order('snap_year', { ascending: false }).order('snap_month', { ascending: false })
      .limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (dead) return
        if (error) { setYmErr('마감된 달을 읽지 못했습니다: ' + dbErrorMsg(error)); return }
        if (!data) { setYmErr('마감된 달이 아직 없습니다. 월마감을 먼저 해 주세요.'); return }
        setFound({ y: data.snap_year, m: data.snap_month })
      })
    return () => { dead = true }
  }, [fixedY, fixedM])

  const year = ym ? ym.y : null
  const month = ym ? ym.m : null
  const key = year + '-' + month

  /* 거래 읽기 — 그 창의 출고만. 읽기만 한다. */
  useEffect(() => {
    if (!year || !month) return undefined
    let dead = false
    const w = closedWindow(year, month)
    supabase.from('transactions')
      .select('drug_code,type,transaction_date,quantity', { count: 'exact' })
      .eq('type', '출고')
      .gte('transaction_date', w.m3From)
      .lt('transaction_date', w.toExclusive)
      .then(({ data, error, count }) => {
        if (dead) return
        const lim = checkRowLimit(data, count)
        setLoaded({
          key, rows: data || [],
          err: error ? '거래를 읽지 못했습니다: ' + dbErrorMsg(error) : '',
          cutMsg: error ? '' : lim.message,
        })
      })
    return () => { dead = true }
  }, [year, month, key])

  const ready = ym != null && loaded != null && loaded.key === key
  const txns = ready ? loaded.rows : null
  const readErr = ready ? loaded.err : ''
  const cutMsg = ready ? (loaded.cutMsg || '') : ''

  const p = useMemo(
    () => (txns == null ? null : buildUsageCompare(drugs || [], txns, year, month)),
    [drugs, txns, year, month])

  /* 기본으로 꺼져 있던 줄을 사용자가 **켠** 경우 */
  const [extra, setExtra] = useState(() => new Set())
  /* 지금 체크된 약품코드 — 기본값(on)에서 푼 것을 빼고, 켠 것을 더한다 */
  const finalPicked = useMemo(() => {
    const s = new Set()
    for (const r of (p ? p.rows : [])) {
      if (r.on ? !off.has(r.code) : extra.has(r.code)) s.add(r.code)
    }
    return s
  }, [p, off, extra])

  function toggle(r) {
    if (r.on) {
      setOff(s => { const n = new Set(s); if (n.has(r.code)) n.delete(r.code); else n.add(r.code); return n })
    } else {
      setExtra(s => { const n = new Set(s); if (n.has(r.code)) n.delete(r.code); else n.add(r.code); return n })
    }
  }

  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState('')
  const [result, setResult] = useState(null)
  const err = ymErr || readErr || applyErr

  async function apply() {
    setConfirming(false); setApplying(true); setApplyErr(''); setResult(null)
    const rows = applyRows(p ? p.rows : [], finalPicked)
    const { data, error } = await supabase.rpc('app_save_usage_bulk', {
      p_fields: APPLY_FIELDS, p_rows: rows, p_zero_missing: false, p_keep_codes: [],
    })
    setApplying(false)
    if (error) { setApplyErr('적용하지 못했습니다: ' + dbErrorMsg(error)); return }
    setResult(data || null)
    onReload?.()
  }

  /* ── 모양 — NarcoticUsageModal 과 같은 값 ─────────────────────────── */
  const badge = (text, bg, color) => (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 8, fontSize: 10,
      fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>{text}</span>
  )
  const th = { padding: '8px 10px', textAlign: 'left', color: t.textM, fontWeight: 600,
    borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontSize: 11, background: t.bg }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '6px 10px', fontSize: 11, color: t.textM, borderBottom: `1px solid ${t.border}` }
  const tdR = { ...td, textAlign: 'right' }
  const btn = (label, kind, onClick, dis) => (
    <button type="button" onClick={onClick} disabled={dis} style={{
      padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
      cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.6 : 1,
      border: `1px solid ${kind === 'go' ? t.accent : t.border}`,
      background: kind === 'go' ? t.accent : t.bg, color: kind === 'go' ? '#fff' : t.textM,
    }}>{label}</button>
  )
  /* 전 → 후 한 칸. 달라지면 굵게, 같으면 흐리게 — **새 색을 만들지 않는다.** */
  const arrow = (before, after) => {
    const same = String(before) === String(after)
    return <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: t.textL }}>{num(before)}</span>
      <span style={{ color: t.textL, margin: '0 4px' }}>→</span>
      <span style={{ color: same ? t.textL : t.text, fontWeight: same ? 400 : 700 }}>{num(after)}</span>
    </span>
  }
  const stBadge = s => {
    const m = { 정상: [t.greenL, t.green], 주문필요: [t.amberL, t.amber],
      긴급: [t.redL, t.red], 재고없음: [t.redL, t.red], 기준미설정: ['#F0F0EB', t.textL] }
    const [bg, c] = m[s] || ['#F0F0EB', t.textL]
    return badge(s, bg, c)
  }
  const why = r => r.vac ? badge('백신 — 제외', t.blueL, t.blue)
    : r.zeroOut ? badge('3개월 출고 0', t.amberL, t.amber)
      : r.tiny ? badge('극소량 — 3개월 그대로', t.purpleL, t.purple)
        : !r.changed ? badge('차이 없음', '#F0F0EB', t.textL) : null

  const shown = p ? (onlyMoved ? p.moved : p.rows) : []
  const s = p ? p.summary : null
  const as = p ? applySummary(p.rows, finalPicked) : null

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
    <div ref={box} onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 14,
      padding: '22px 26px', maxWidth: 980, width: '100%', border: `1px solid ${t.border}`,
      boxShadow: t.shadowH, boxSizing: 'border-box', textAlign: 'left' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>사용량 비교 — 마감된 달 기준</div>
        <button onClick={onClose} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: 8,
          border: `1px solid ${t.border}`, background: t.bg, color: t.textM, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      {/* ★ 가장 먼저 「고른 약만 저장한다」를 말한다 — 이 창의 성격이다 */}
      <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12, color: t.textM, lineHeight: 1.7, marginBottom: 14 }}>
        <b style={{ color: t.text }}>고른 약만 저장합니다 — 「적용」을 눌러야 바뀝니다.</b> 직전3개월·직전1개월을
        약플로 <b>출고</b>로 다시 셉니다(반품·폐기는 세지 않습니다). 전년 사용량·계산식은 그대로입니다.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>기준</span>
        <span style={{ padding: '6px 10px', border: `1px solid ${t.border}`, borderRadius: 8,
          background: t.bg, color: t.text, fontSize: 12 }}>최근 마감 {year}년 {month}월</span>
        <span style={{ fontSize: 11.5, color: t.textM }}>
          직전3개월 = {monthLabel(year, month)}
          {'  ·  '}직전1개월 = {month}월{'  ·  '}출고만 셈
        </span>
      </div>

      {s && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {badge('사용 중 ' + s.total + '종', t.bg, t.textM)}
        {badge('달라짐 ' + s.changed + '종', t.accentL, t.accent)}
        {badge('적용 ' + finalPicked.size + '종', t.greenL, t.green)}
        {badge('백신 제외 ' + s.vac + '종', t.blueL, t.blue)}
        {badge('3개월 출고 0 ' + s.zero + '종', t.amberL, t.amber)}
        {badge('극소량 ' + s.tiny + '종', t.purpleL, t.purple)}
      </div>}

      {as && <div style={{ fontSize: 11.5, color: t.textM, marginBottom: 8 }}>
        적용하면 <b style={{ color: t.text }}>안전재고 {as.safety}종</b> · <b style={{ color: t.text }}>재고 상태 {as.stat}종</b>
        {' '}이 바뀝니다 (그중 나빠지는 쪽 {as.worse}종). 최대재고도 안전재고와 같은 수만큼 바뀝니다.
      </div>}

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        fontSize: 11.5, color: t.textM, marginBottom: 8 }}>
        <input type="checkbox" checked={onlyMoved} onChange={e => setOnlyMoved(e.target.checked)}
          style={{ width: 15, height: 15, accentColor: t.accent, cursor: 'pointer' }} />
        달라지는 약만 보기
      </label>

      {err && <div style={{ background: t.redL, border: `1px solid ${t.border}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12, color: t.red, marginBottom: 10 }}>{err}</div>}
      {cutMsg && <div style={{ background: t.amberL, border: `1px solid ${t.border}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12, color: t.amber, marginBottom: 10 }}>{cutMsg}</div>}
      {result && <div style={{ background: t.greenL, border: `1px solid ${t.border}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12, color: t.green, marginBottom: 10 }}>
        적용 완료 — {num(result.saved)}종을 저장했습니다.
      </div>}

      {!ready && !err && <div style={{ padding: '28px 0', textAlign: 'center', color: t.textL, fontSize: 12 }}>거래를 읽는 중…</div>}

      {ready && <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left' }}>
          <thead><tr>
            <th style={{ ...th, width: 34 }} aria-label="고르기" />
            <th style={th}>약품</th>
            <th style={thR}>직전3개월</th>
            <th style={thR}>직전1개월</th>
            <th style={thR}>월평균</th>
            <th style={thR}>안전재고</th>
            <th style={th}>상태</th>
            <th style={th}>비고</th>
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.code}>
                <td style={td}>
                  <input type="checkbox" checked={finalPicked.has(r.code)} onChange={() => toggle(r)}
                    aria-label={r.name + ' 적용하기'}
                    style={{ width: 15, height: 15, accentColor: t.accent, cursor: 'pointer' }} />
                </td>
                <td style={td}>
                  <div style={{ color: t.text, fontWeight: 600, fontSize: 11.5 }}>{r.name}</div>
                  <div style={{ color: t.textL, fontSize: 10 }}>{r.code} · {r.category}</div>
                </td>
                <td style={tdR}>{r.tiny ? <span style={{ color: t.textL }}>{num(r.o3)} (그대로)</span> : arrow(r.o3, r.n3)}</td>
                <td style={tdR}>{arrow(r.o1, r.n1)}</td>
                <td style={tdR}>{arrow(r.om, r.nm)}</td>
                <td style={tdR}>{arrow(r.osf, r.nsf)}</td>
                <td style={td}>{r.before === r.after ? stBadge(r.before)
                  : <span style={{ whiteSpace: 'nowrap' }}>{stBadge(r.before)}
                    <span style={{ color: t.textL, margin: '0 4px' }}>→</span>{stBadge(r.after)}</span>}</td>
                <td style={td}>{why(r)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8}
              style={{ ...td, textAlign: 'center', padding: '26px 10px', color: t.textL }}>달라지는 약품이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 14, gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: t.textL }}>
          보기 {shown.length}줄 / 모두 {s ? s.total : 0}줄 · 체크를 풀면 그 약은 그대로 둡니다
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {btn('닫기', null, onClose)}
          {isTenantManager && btn(applying ? '적용 중…' : '고른 ' + finalPicked.size + '종 적용', 'go',
            () => setConfirming(true), applying || !ready || finalPicked.size === 0 || !!err)}
        </span>
      </div>
    </div>

    {confirming && Confirm && <Confirm t={t} title="사용량 적용"
      tone={t.accent} escClose focusCancel
      head={`${year}년 ${month}월 마감 기준으로 ${finalPicked.size}종을 저장합니다.`}
      body={as ? `안전재고 ${as.safety}종 · 재고 상태 ${as.stat}종이 바뀝니다 (나빠지는 쪽 ${as.worse}종).\n`
        + `전년 사용량은 건드리지 않습니다. 극소량 ${as.tiny}종은 직전1개월만 바뀌고 3개월·안전재고는 그대로입니다.` : ''}
      confirm="적용" busy={applying}
      onClose={() => setConfirming(false)} onConfirm={apply} />}
  </div>
}
