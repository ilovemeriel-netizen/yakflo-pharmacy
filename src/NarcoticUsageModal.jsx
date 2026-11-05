/* 약플로 · 마약·향정 사용량 — **달력 기준으로 계산해 보여 주기만** 한다 (B-1, 2026-11-04 시안).

   ★ 이 창은 DB 에 **아무것도 쓰지 않는다.** 읽기만 한다.
     숫자를 먼저 보고 나서 「적용할까」를 고르기 위한 표다(적용은 B-2 에서 따로 승인).

   ★ 왜 필요한가 (확정 업무 규칙 9)
     마약·향정의 출고는 NIMS 거래량으로 입력하므로 1개월·3개월의 정본은 **약플로 출고**다.
     그런데 지금 그 칸들은 예전에 원내 파일로 넣은 값이 남아 있어 출고와 어긋나 있다.
     A단계가 「더 어긋나지 않게」 막았고, 이 표는 「지금 얼마나 어긋나 있나」를 보여 준다.

   ★ 왜 달력 기준인가
     지금 `app_recompute_usage` 는 「오늘부터 30일」이라 하루만 지나도 답이 달라진다.
     월마감은 달력으로 끊으므로 사용량도 달력으로 끊어야 짝이 맞는다.

   ★ 색·부품 — 부모가 넘긴 t 만 쓴다. **새 색 없음.**
     표·뱃지는 App.jsx 와 같은 모양을 쓰되 import 하지 않는다(순환 import 회피 —
     BulkUploadModal·UsageUploadModal 과 같은 방식).

   ★ 계산식은 `lib/narcoticUsagePreview.js` 에만 있다. 여기서 셈하지 않는다. */
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase'
import { buildNarcoticPreview, calendarWindow } from './lib/narcoticUsagePreview'
import { narcCodes } from './lib/usageParse'
import { checkRowLimit } from './lib/rowLimit'

const num = v => (v == null ? '—' : Number(v).toLocaleString())

/* ★ Confirm = 부모가 넘겨 주는 `CountConfirmModal`(App.jsx:5676).
     import 하지 않고 prop 으로 받는다 — App.jsx 가 이 파일을 import 하므로
     거꾸로 import 하면 **순환 import** 가 된다. 부품은 같은 것을 그대로 쓴다. */
export default function NarcoticUsageModal({ t, drugs, onClose, isTenantManager, onReload, Confirm }) {
  const now = new Date()
  /* 기준월 기본값 = 지난달. 월마감을 매월 초에 전달 것으로 하므로 그 달이 궁금한 달이다. */
  const [year, setYear] = useState(() => (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()))
  const [month, setMonth] = useState(() => (now.getMonth() === 0 ? 12 : now.getMonth()))
  const [onlyMoved, setOnlyMoved] = useState(true)
  const box = useRef(null)

  /* 읽어 온 것을 **기준월과 함께** 담는다. 그래야 effect 안에서 「읽는 중」을 따로 적지 않아도
     된다 — 담긴 기준월이 지금 고른 달과 다르면 아직 안 읽은 것이다.
     ★ effect 몸통에서 바로 setState 하면 렌더가 연쇄로 돈다(react-hooks 규칙). */
  const key = year + '-' + month
  const [loaded, setLoaded] = useState(null)   /* { key, rows, err } */

  /* ★ 마약·향정 코드만 추린다 — 이 목록으로 **읽기 범위를 좁힌다.**
     판정은 usageParse 의 `isNarcSkip` 하나를 쓴다(두 곳에 적으면 답이 갈린다). */
  const narcCodeList = useMemo(() => narcCodes(drugs), [drugs])

  /* 거래를 읽는다 — **읽기만** 한다. 창(3개월) 밖은 애초에 가져오지 않는다.

     ★ 2026-11-05 수정 — 마약·향정 코드만 `.in()` 으로 받는다.
       전에는 **모든 약의 출고**를 받아 와서 그 중 마약·향정만 골라냈다. 그런데 3개월 창의
       출고가 1,079건이라 Supabase 기본 한도 1,000줄에 걸려 **79건이 조용히 잘렸고**,
       그 안에 졸피드정10mg 10-31 출고 63이 있었다(1개월 707→644, 3개월 2,300→2,237).
       29종만 집어 받으면 1,079건 → 29건이 되어 한도에 닿을 일이 없어진다.

     ★ 그래도 **안전장치를 함께 둔다** — `{ count: 'exact' }` 로 전체 줄 수를 받아
       받은 줄과 비교한다. 다음에 또 잘리면 조용히 틀리지 않고 화면에 경고가 뜬다. */
  useEffect(() => {
    let dead = false
    /* 약품이 아직 안 왔으면 읽지 않는다 — 빈 목록으로 `.in()` 하면 0건이 와서
       「출고가 없다」로 보인다(조용히 틀리는 쪽). 「읽는 중」으로 남겨 둔다. */
    if (!narcCodeList.length) return () => { dead = true }
    const w = calendarWindow(year, month)
    supabase.from('transactions')
      .select('drug_code,type,transaction_date,quantity', { count: 'exact' })
      .eq('type', '출고')
      .in('drug_code', narcCodeList)
      .gte('transaction_date', w.m3From)
      .lt('transaction_date', w.toExclusive)
      .then(({ data, error, count }) => {
        if (dead) return
        const lim = checkRowLimit(data, count)
        setLoaded({
          key: year + '-' + month,
          rows: data || [],
          err: error ? '거래를 읽지 못했습니다: ' + error.message : '',
          cutMsg: error ? '' : lim.message,
        })
      })
    return () => { dead = true }
  }, [year, month, narcCodeList])

  const ready = loaded != null && loaded.key === key
  const txns = ready ? loaded.rows : null
  const readErr = ready ? loaded.err : ''
  /* 잘렸다는 경고 — 오류와 **따로** 띄운다. 표는 그대로 보여 주되 적용은 막는다. */
  const cutMsg = ready ? (loaded.cutMsg || '') : ''

  /* ── 적용 (B-2) — 이 창에서 **버튼을 눌러야만** 돈다. 출고를 입력할 때 저절로 돌지 않는다. ── */
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState('')
  const [result, setResult] = useState(null)
  const err = readErr || applyErr

  async function apply() {
    setConfirming(false); setApplying(true); setApplyErr(''); setResult(null)
    const { data, error } = await supabase.rpc('app_recompute_usage', {
      p_overwrite_manual: false, p_scope: 'narcotic', p_year: year, p_month: month,
    })
    setApplying(false)
    if (error) { setApplyErr('적용하지 못했습니다: ' + error.message); return }
    setResult(Number(data || 0))
    /* 약품 목록을 다시 읽으면 위 표가 저절로 「달라지는 약품 0종」이 된다 */
    onReload?.()
  }

  const p = useMemo(
    () => (txns == null ? null : buildNarcoticPreview(drugs, txns, year, month)),
    [drugs, txns, year, month])

  const badge = (text, bg, color) => (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 8, fontSize: 10,
      fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>{text}</span>
  )
  const th = { padding: '8px 10px', textAlign: 'left', color: t.textM, fontWeight: 600,
    borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontSize: 11, background: t.bg }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '6px 10px', fontSize: 11, color: t.textM, borderBottom: `1px solid ${t.border}` }
  const tdR = { ...td, textAlign: 'right' }
  const sel = { padding: '6px 10px', border: `1px solid ${t.border}`, borderRadius: 8,
    background: t.bg, color: t.text, fontSize: 12 }

  /* 전 → 후 한 칸. 달라지면 굵게, 같으면 흐리게 — **새 색을 만들지 않는다.** */
  const arrow = (before, after) => {
    const same = String(before) === String(after)
    return <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: t.textL }}>{num(before)}</span>
      <span style={{ color: t.textL, margin: '0 4px' }}>→</span>
      <span style={{ color: same ? t.textL : t.text, fontWeight: same ? 400 : 700 }}>{num(after)}</span>
    </span>
  }

  const shown = p ? (onlyMoved ? p.moved : p.rows) : []

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
    <div ref={box} onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 14,
      padding: '22px 26px', maxWidth: 980, width: '100%', border: `1px solid ${t.border}`,
      boxShadow: t.shadowH, boxSizing: 'border-box' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>마약·향정 사용량 — 달력 기준으로 보기</div>
        <button onClick={onClose} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: 8,
          border: `1px solid ${t.border}`, background: t.bg, color: t.textM, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      {/* ★ 가장 먼저 「쓰지 않는다」를 말한다 — 이 창의 성격이다 */}
      <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12, color: t.textM, lineHeight: 1.7, marginBottom: 14 }}>
        <b style={{ color: t.text }}>보여 주기만 합니다 — 저장하지 않습니다.</b> 마약·향정의 직전1개월·최근3개월은
        NIMS 거래량으로 넣은 <b>출고</b>가 정본입니다. 이 표는 그 출고를 <b>달력</b>(그달 1일~말일)으로
        다시 세면 숫자가 어떻게 되는지 보여 줍니다. 한외마약은 해당하지 않습니다.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>기준월</span>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={sel}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} style={sel}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
        </select>
        {p && <span style={{ fontSize: 11, color: t.textM }}>
          1개월 {p.label.m1} · 3개월 {p.label.m3}
        </span>}
      </div>

      {err && <div style={{ color: t.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {/* ★ 조용한 절단 경고 — 기존 오류 줄과 **똑같은 모양·색**이다(새 색 없음).
          숫자가 틀렸을 수 있으므로 표는 보여 주되 적용 단추는 막는다. */}
      {cutMsg && <div data-testid="narc-cut-warn"
        style={{ color: t.red, fontSize: 12, marginBottom: 10 }}>{cutMsg}</div>}
      {!p && !err && <div style={{ color: t.textM, fontSize: 12, padding: '20px 0' }}>거래를 읽는 중…</div>}

      {p && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {badge('대상 ' + p.rows.length + '종', t.purpleL, t.purple)}
          {badge('값이 달라지는 약품 ' + p.moved.length + '종', t.blueL, t.blue)}
          {p.mixed.length > 0 && badge('잣대가 섞이는 약품 ' + p.mixed.length + '종', t.amberL, t.amber)}
          {p.lost.length > 0 && badge('값을 잃는 약품 ' + p.lost.length + '종', t.redL, t.red)}
        </div>

        {/* ★ 잣대가 섞이는 약품 — 2026-11-04 이정화 님 요청으로 **따로** 보여 준다.
              3개월 출고가 0 이라 월평균이 「전년(원내) ÷ 12」로 잡힌다.
              1·3개월은 NIMS 잣대인데 월평균만 원내 잣대가 되는 약품들이다. */}
        {p.mixed.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 6 }}>
              잣대가 섞이는 약품 {badge(p.mixed.length + '종 (3개월 출고 0 · 전년 쓰임 있음)', t.amberL, t.amber)}
            </div>
            <div style={{ fontSize: 11, color: t.textM, marginBottom: 6, lineHeight: 1.7 }}>
              최근 석 달 동안 <b>출고가 한 건도 없는데 전년에는 쓰임이 있던</b> 약품입니다.
              그래서 월평균이 <b>전년 ÷ 12</b>로 잡혀, 1·3개월(출고 기준)과 <b>잣대가 다릅니다</b>.
              값은 <b>바뀌지 않습니다</b> — 다만 재고 기준을 이 숫자로 두어도 될지 봐 주십시오.
            </div>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>약품코드</th><th style={th}>약품명</th>
                  <th style={th}>구분</th><th style={th}>상태</th>
                  <th style={thR}>전년</th><th style={thR}>월평균</th>
                  <th style={thR}>안전재고</th><th style={thR}>최대재고</th><th style={thR}>현재고</th>
                </tr></thead>
                <tbody>
                  {p.mixed.map(r => (
                    <tr key={r.code}>
                      <td style={td}>{r.code}</td>
                      <td style={{ ...td, color: t.text }}>{r.name}</td>
                      <td style={td}>{r.nt}</td>
                      <td style={td}>{r.status}</td>
                      <td style={tdR}>{num(r.prevYear)}</td>
                      <td style={{ ...tdR, color: t.text, fontWeight: 700 }}>{num(r.maBefore)}</td>
                      <td style={tdR}>{num(r.safetyBefore)}</td>
                      <td style={tdR}>{num(r.maxBefore)}</td>
                      <td style={tdR}>{num(r.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
            달력 기준으로 다시 세면 — 지금 → 새 값
          </div>
          <label style={{ fontSize: 11, color: t.textM, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyMoved} onChange={e => setOnlyMoved(e.target.checked)} />
            달라지는 약품만 보기
          </label>
        </div>
        <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead><tr>
              <th style={th}>약품코드</th><th style={th}>약품명</th><th style={th}>상태</th>
              <th style={thR}>직전1개월</th><th style={thR}>최근3개월</th>
              <th style={thR}>월평균</th><th style={thR}>안전재고</th><th style={thR}>최대재고</th>
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.code}>
                  <td style={td}>{r.code}</td>
                  <td style={{ ...td, color: t.text }}>
                    {r.name}
                    {r.lost && <span style={{ marginLeft: 6, color: t.red, fontSize: 10, fontWeight: 700 }}>값 사라짐</span>}
                  </td>
                  <td style={td}>{r.status}</td>
                  <td style={tdR}>{arrow(r.m1Before, r.m1After)}</td>
                  <td style={tdR}>{arrow(r.m3Before, r.m3After)}</td>
                  <td style={tdR}>{arrow(r.maBefore, r.maAfter)}</td>
                  <td style={tdR}>{arrow(r.safetyBefore, r.safetyAfter)}</td>
                  <td style={tdR}>{arrow(r.maxBefore, r.maxAfter)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td style={{ ...td, color: t.textM }} colSpan={8}>달라지는 약품이 없습니다.</td></tr>
              )}
            </tbody>
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700, color: t.text }} colSpan={3}>합계 (대상 {p.rows.length}종 전부)</td>
              <td style={tdR}>{arrow(p.totals.m1Before, p.totals.m1After)}</td>
              <td style={tdR}>{arrow(p.totals.m3Before, p.totals.m3After)}</td>
              <td style={td} />
              <td style={tdR}>{arrow(p.totals.safetyBefore, p.totals.safetyAfter)}</td>
              <td style={tdR}>{arrow(p.totals.maxBefore, p.totals.maxAfter)}</td>
            </tr></tfoot>
          </table>
        </div>

        {/* 적용 결과 — 기존 초록 안내 띠와 같은 모양 */}
        {result != null && (
          <div style={{ marginTop: 14, background: t.greenL, border: `1px solid ${t.green}`, borderRadius: 8,
            padding: '10px 14px', color: t.green, fontSize: 12, fontWeight: 600, lineHeight: 1.7 }}>
            적용 완료 — {year}년 {month}월 기준으로 <b>{num(result)}종</b>을 다시 셌습니다.
            {result === 0 ? ' 바뀐 것이 없습니다(이미 같은 값입니다).' : ' 위 표가 다시 계산됐습니다.'}
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: t.textM, lineHeight: 1.7 }}>
            {isTenantManager
              ? <>안전재고·최대재고가 바뀌면 <b>발주 기준</b>이 함께 바뀝니다. 적용하기 전에 위 숫자를 봐 주십시오.
                  <br />출고를 입력할 때는 <b>저절로 계산되지 않습니다</b> — 이 단추로만 돕니다.</>
              : <>이 숫자를 실제로 넣는 것은 <b>관리자만</b> 할 수 있습니다.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* ★ owner·admin 에게만 **DOM 에도** 둔다 — 사용량 단추 5곳과 같은 기준 */}
            {/* ★ 거래가 잘렸으면 **적용을 막는다**(cutMsg). 보여 준 숫자가 틀렸는데 적용되면
                틀린 발주 기준이 저장된다 — 멈추는 쪽이 옳다. 모양은 기존 「끌 때」와 같다. */}
            {isTenantManager && (
              <button onClick={() => setConfirming(true)}
                disabled={applying || !p.rows.length || !!cutMsg}
                title={cutMsg ? '거래를 다 읽지 못해 숫자를 믿을 수 없습니다' : undefined}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${t.accent}`,
                  background: t.accent, color: '#fff',
                  cursor: (applying || !p.rows.length || cutMsg) ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 700, opacity: (applying || !p.rows.length || cutMsg) ? 0.5 : 1 }}>
                {applying ? '적용 중…' : `${year}년 ${month}월 기준으로 적용`}
              </button>
            )}
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8,
              border: `1px solid ${t.border}`, background: 'transparent', color: t.textM,
              cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>닫기</button>
          </div>
        </div>
      </>}

      {/* ★ 확인 창 — 부모가 넘긴 기존 CountConfirmModal 을 그대로 쓴다(새 모양·새 색 없음).
            되돌릴 수 없는 조작이므로 escClose·focusCancel 을 켠다(실사 삭제와 같은 취급). */}
      {confirming && p && Confirm && (
        <Confirm t={t} title="마약·향정 사용량 적용" tone={t.purple} busy={applying}
          head={`${year}년 ${month}월 기준으로 ${num(p.rows.length)}종을 다시 셉니다`}
          meta={`직전1개월 ${p.label.m1} · 최근3개월 ${p.label.m3}`}
          strong={`값이 바뀌는 약품 ${num(p.moved.length)}종`}
          body={<>
            마약·향정의 직전1개월·최근3개월을 <b>약플로 출고</b>로 다시 적습니다.
            전년사용량과 한외마약은 바뀌지 않습니다.
            {p.lost.length > 0 && <><br /><b>값이 0 이 되는 약품 {num(p.lost.length)}종</b>이 있습니다.</>}
            <br />안전재고·최대재고가 함께 바뀌어 <b>발주 기준</b>이 달라집니다. 계속할까요?
          </>}
          confirm="적용" escClose focusCancel
          onClose={() => setConfirming(false)} onConfirm={apply} />
      )}
    </div>
  </div>
}
