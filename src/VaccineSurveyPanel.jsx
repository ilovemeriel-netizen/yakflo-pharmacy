/* ═══════════════════════════════════════════════════════════════════════════
   수요 현황 — 약플로 백신 관리의 탭 하나 (단계 4)

   ★ 공용 컴포넌트를 수정하지 않는다 — ColMenu·useSort 를 props 로 주입받아 **호출만** 한다.
     (VaccineManage 가 이미 쓰는 방식 그대로)
   ★ 산식의 정본은 DB 뷰 v_vaccine_demand 다. 화면에서 D·A·R·S·G·O 를 다시 계산하지 않는다.
     뷰가 주지 않는 것(날짜별 누적·가림표시)만 lib/surveyCalc.js 에서 만든다.
   ★ 차트는 저장소 방식대로 인라인 SVG — 차트 라이브러리를 들이지 않는다.
   ★ 성명·사번은 가려서 보여 준다. 원문은 「원문 보기」를 눌러 audit 을 남긴 뒤에만.
     같은 자리의 「가리기」로 그 줄만 다시 가린다 — 가리기는 audit 을 남기지 않는다.
     탭을 떠나거나 회차를 바꾸거나 새로고침하면 열린 줄이 **모두** 다시 가려진다(저장 안 함).
   ★ 내려받기는 audit INSERT 가 성공한 **뒤에만** 파일을 만든다.
   ★ 1,000행을 넘을 수 있으므로 .range() 로 쪽을 나눠 읽는다.
   ★ 표 컨테이너에 textAlign:'left' 를 명시한다 — #root 의 center 가 상속된다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useTheme } from './lib/theme'
import { dbErrorMsg } from './lib/dbError'
import {
  maskEmpNo, maskName, doseOf, doneOf, cumulativeDemand, firstShortDate, shortDate,
  alertLine, needsPurge, canPurge, defaultCategoryIds,
} from './lib/surveyCalc'

const CHUNK = 500
const PURGE_WORD = '파기'

/* 오늘(KST) — 모듈 로드 시각 기준. 렌더 중에 시계를 읽지 않는다. */
const BOOT_NOW = Date.now()
function kstToday(now) {
  const d = new Date(now + 9 * 60 * 60 * 1000)
  const p = n => String(n).padStart(2, '0')
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}

/* ★ profile prop 을 받지 않는다 — 2026-10-28 결함의 원인이었다.
   호출부가 넘긴 tenant_members 행에는 `id`·`name`·`email` 이 없는데 그걸 읽어 썼다.
   기록의 tenant_id·user_id 는 DB 트리거(0095)가, 출력자 표시는 auth.getUser() 가 맡는다. */
/* eslint-disable-next-line no-unused-vars -- ColMenu 는 JSX 요소 이름으로만 쓰인다.
   이 저장소에는 eslint-plugin-react 가 없어 JSX 사용을 추적하지 못한다(오탐). */
export default function VaccineSurveyPanel({ ColMenu, useSort, accs, cats, isAdmin }) {
  const { t } = useTheme()
  const [now] = useState(BOOT_NOW)
  const today = kstToday(now)

  const [surveys, setSurveys] = useState([])
  const [selId, setSelId] = useState('')
  const [demand, setDemand] = useState(null)
  const [rows, setRows] = useState([])
  const [ld, setLd] = useState(true)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null)      /* { kind:'round'|'purge', ... } */
  const [revealed, setRevealed] = useState({})  /* id → true (「원문 보기」로 공개) */
  /* ── 표 헤더 필터 ────────────────────────────────────────────────────────
     ★ 값은 **스칼라 또는 없음**이다 — 공용 ColMenu 가 `on(v)` 로 값 하나(또는 null)를
       돌려주기 때문이다. 예전에는 배열로 담고 prop 이름도 달라(values·sel·onSel)
       머리글을 누르는 순간 `filter.items.map` 에서 터졌다.
     ★ 값이 없으면 그 열은 거르지 않는다(= 전체).
     ★ 기본값은 **상태=신청** — 취소된 줄은 기본으로 감춘다. 이 상수가 ① 진입 초기값
       ②「필터 초기화」 복원값 ③ 초기화 버튼 표시 판정의 **단일 출처**다
       (약품목록·비보험·아카이브가 쓰는 방식과 같다). */
  const HF_DEFAULT = { status: '신청' }
  const [hfV, setHfV] = useState(HF_DEFAULT)
  const sort = useSort('wish_date', 'asc')

  const sel = useMemo(() => surveys.find(s => s.id === selId) || null, [surveys, selId])

  /* ── 불러오기 ───────────────────────────────────────────────────────────
     ★ 이 함수는 **await 이전에 setState 를 하지 않는다** — effect 에서 불러도
       동기 setState 로 잡히지 않는다(react-hooks/set-state-in-effect).
       「불러오는 중」 표시는 ld 초기값 true 와 호출부가 맡는다. */
  const load = useCallback(async () => {
    const { data: sv, error } = await supabase
      .from('vaccine_surveys')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { setMsg(dbErrorMsg(error)); setLd(false); return }
    setMsg(null); setSurveys(sv || []); setLd(false)
  }, [])

  /* ★ 첫 조회도 타이머로 건다 — effect 본문에서 직접 부르면 동기 setState 로 잡힌다.
     0ms 라 사용자에게는 즉시 시작하는 것과 같다(vaccine-app 과 같은 방식). */
  useEffect(() => {
    if (!isAdmin) return
    const h = setTimeout(() => load(), 0)
    return () => clearTimeout(h)
  }, [isAdmin, load])

  /* 선택이 비어 있으면 열린 회차 → 가장 최근 회차로 (타이머로 미뤄 동기 setState 를 피한다) */
  useEffect(() => {
    if (selId || !surveys.length) return
    const open = surveys.find(s => s.status === 'open')
    const h = setTimeout(() => setSelId((open || surveys[0]).id), 0)
    return () => clearTimeout(h)
  }, [surveys, selId])

  /* 선택된 회차의 산식과 명단 — 여기도 await 이전에 setState 를 하지 않는다 */
  const loadDetail = useCallback(async (id) => {
    if (!id) return
    const { data: dm, error: dErr } = await supabase
      .from('v_vaccine_demand').select('*').eq('survey_id', id).maybeSingle()
    if (dErr) { setMsg(dbErrorMsg(dErr)); return }
    setDemand(dm || null)

    /* ★ 쪽을 나눠 읽는다 — 1,000행을 넘을 수 있다 */
    const all = []
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await supabase
        .from('vaccine_survey_responses')
        .select('id, receipt_code, emp_no, name, name_key, self_dose, family_count, wish_date, status, done_self, done_family, created_at')
        .eq('survey_id', id)
        .order('wish_date', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, from + CHUNK - 1)
      if (error) { setMsg(dbErrorMsg(error)); return }
      all.push(...(data || []))
      if (!data || data.length < CHUNK) break
    }
    setRows(all)
  }, [])

  useEffect(() => {
    if (!isAdmin || !selId) return
    const h = setTimeout(() => loadDetail(selId), 0)
    return () => clearTimeout(h)
  }, [isAdmin, selId, loadDetail])

  /* ★ 「관리자가 아니면 그리지 않는다」는 **훅을 전부 호출한 뒤** 판단한다.
     조건부 return 을 훅 앞에 두면 렌더마다 훅 순서가 달라져 react-hooks/rules-of-hooks 위반이다.
     (호출부 VaccineManage 가 이미 관리자일 때만 이 컴포넌트를 올리므로 이중 방어다.) */

  /* ── 회차 열기·닫기 ───────────────────────────────────────────────────── */
  async function setStatus(next) {
    if (!sel || busy) return
    setBusy(true); setMsg(null)
    const patch = { status: next, updated_at: new Date().toISOString() }
    /* 처음 열 때만 open_at 을 찍는다 — A 산식의 기준 시각이라 다시 쓰면 과거 접종이 섞인다 */
    if (next === 'open' && !sel.open_at) patch.open_at = new Date().toISOString()
    const { error } = await supabase.from('vaccine_surveys').update(patch).eq('id', sel.id)
    setBusy(false)
    if (error) { setMsg(dbErrorMsg(error)); return }
    await load(); await loadDetail(sel.id)
  }

  /* ── 원문 보기 — audit 을 먼저 남긴다 ───────────────────────────── */
  async function reveal(r) {
    if (revealed[r.id]) return
    /* ★ tenant_id·user_id 를 보내지 않는다 — 0095 의 BEFORE INSERT 트리거가
       회차 기준 tenant_id 와 auth.uid() 로 채운다(보내도 덮어쓴다).
       예전에는 user_id 에 `profile?.id` 를 넣었는데 profile 은 tenant_members 행이라
       `id` 열이 없어 undefined → NULL → 정책의 `user_id = auth.uid()` 가 false 가 됐다. */
    const { error } = await supabase.from('vaccine_survey_audit')
      .insert({ survey_id: sel.id, action: 'view_raw', response_id: r.id })
    if (error) { setMsg('열람 기록을 남기지 못해 원문을 열지 않았습니다 — ' + dbErrorMsg(error)); return }
    setRevealed(v => ({ ...v, [r.id]: true }))
  }

  /* ── 가리기 — 그 줄만 다시 가린다 ─────────────────────────────────────
     ★ audit 을 남기지 않는다. 기록해야 할 일은 「원문을 봤다」이지 「다시 가렸다」가 아니다.
       다시 열면 그때 view_raw 가 또 남으므로 열람 횟수는 그대로 다 잡힌다.
     ★ 회차를 바꿀 때(select onChange)·탭을 떠날 때(패널 언마운트)·새로고침할 때는
       revealed 가 통째로 비워지므로 여기서 따로 할 일이 없다. */
  function hide(r) {
    setRevealed(v => {
      if (!v[r.id]) return v
      const next = { ...v }
      delete next[r.id]
      return next
    })
  }

  /* ── 명단 체크 ────────────────────────────────────────────────────────── */
  async function patchRow(r, patch) {
    const { error } = await supabase.from('vaccine_survey_responses')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { setMsg(dbErrorMsg(error)); return }
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...patch } : x))
    await loadDetail(sel.id)
  }

  /* ── 내려받기 — audit 먼저, 성공해야 파일 ─────────────────────────────── */
  async function download(kind) {
    if (busy || !sel) return
    setBusy(true); setMsg(null)
    const action = kind === 'pdf' ? 'export_pdf' : 'export_xlsx'
    /* ★ tenant_id·user_id 는 서버가 채운다 — 위 reveal() 주석 참고 */
    const { error } = await supabase.from('vaccine_survey_audit')
      .insert({ survey_id: sel.id, action, row_count: shown.length })
    if (error) { setBusy(false); setMsg('내려받기 기록을 남기지 못해 파일을 만들지 않았습니다 — ' + dbErrorMsg(error)); return }
    try {
      const mod = await import('./lib/surveyExport')
      /* ★ 출력자는 파일 쪽에서 「약제과」로 고정한다 — 사람 이름·메일을 문서에 남기지 않는다.
         ★ allRows 는 **필터 전 회차 전체** 응답이다. 비고의 「이름 중복」을 필터와 무관하게
           판정하려면 전체가 필요하다(필터로 1건만 보여도 중복이면 표시해야 한다). */
      const args = { survey: sel, rows: shown, allRows: rows, raw: true }
      if (kind === 'pdf') await mod.exportPdf(args); else await mod.exportXlsx(args)
      setMsg(`${kind === 'pdf' ? 'PDF' : '엑셀'} ${shown.length}행을 내려받았습니다 (기록 남김)`)
    } catch (e) {
      setMsg('파일을 만들지 못했습니다 — ' + (e?.message || '알 수 없는 오류'))
    }
    setBusy(false)
  }

  /* ── 파기 ─────────────────────────────────────────────────────────────── */
  async function runPurge() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('purge_vaccine_survey', { p_survey: sel.id })
    setBusy(false); setModal(null)
    if (error) { setMsg(dbErrorMsg(error)); return }
    setRevealed({})
    await load(); await loadDetail(sel.id)
    setMsg(`개인정보 ${data ?? 0}건을 파기했습니다`)
  }

  /* ── 표 ───────────────────────────────────────────────────────────────── */
  const COLS = [
    { k: 'receipt_code', h: '신청번호', w: 110, align: 'left' },
    { k: 'emp_no', h: '사번', w: 110, align: 'left', filter: true },
    { k: 'name', h: '성명', w: 110, align: 'left' },
    { k: 'self_dose', h: '본인', w: 62, align: 'center', filter: true },
    { k: 'family_count', h: '가족 수', w: 76, align: 'right' },
    { k: 'dose', h: '도즈', w: 70, align: 'right' },
    { k: 'wish_date', h: '희망일', w: 110, align: 'center', filter: true },
    { k: 'status', h: '상태', w: 80, align: 'center', filter: true },
    { k: 'done', h: '접종 완료', w: 110, align: 'center' },
    { k: 'memo', h: '비고', w: 120, align: 'left' },
  ]

  /* 필터·정렬 — 가려진 값이 아니라 **원문 기준**으로 건다(눈에 보이는 값으로 걸면 * 끼리 묶인다) */
  const view = useMemo(() => rows.map(r => ({
    ...r,
    dose: doseOf(r),
    done: doneOf(r),
    _self: r.self_dose ? 'O' : '—',
    _status: r.status === 'cancelled' ? '취소' : '신청',
  })), [rows])

  /* ★ 정렬은 useSort 가 주는 so() 를 **그대로 호출**한다 — 정렬 규칙을 자체로 만들지 않는다.
     메모 의존성에는 객체(sort) 대신 원시값(sk·sd)을 넣는다 — 객체는 매 렌더 새로 만들어져
     메모가 보존되지 않는다(react-hooks/preserve-manual-memoization). */
  const { sk, sd, so } = sort
  const filtered = useMemo(() => {
    let out = view
    for (const [k, val] of Object.entries(hfV)) {
      if (val == null || val === '') continue
      out = out.filter(r => {
        const v = k === 'self_dose' ? r._self : k === 'status' ? r._status : String(r[k] ?? '')
        return (v || '—') === val
      })
    }
    return out
  }, [view, hfV])
  /* ★ 여기에 useMemo 를 걸지 않는다 — useSort 는 렌더마다 새 객체를 돌려주므로 so 의
     신원이 매번 바뀌어 메모가 한 번도 적중하지 않는다(있으면 오히려 오해를 준다).
     행 수는 많아야 수천이라 정렬 비용은 무시할 수 있다. */
  const shown = so(filtered)

  /* 필터가 기본값과 다른가 — 초기화 버튼 표시 판정. 괄호 숫자는 걸린 필터 개수다. */
  const hfKeys = [...new Set([...Object.keys(hfV), ...Object.keys(HF_DEFAULT)])]
  const hfDirty = hfKeys.some(k => (hfV[k] ?? null) !== (HF_DEFAULT[k] ?? null))
  const hfCount = Object.values(hfV).filter(v => v != null && v !== '').length

  const series = useMemo(
    () => cumulativeDemand(rows, demand?.balance_qty, today), [rows, demand, today])
  const shortAt = firstShortDate(series)
  const band = alertLine(demand)
  const purgeNeeded = needsPurge(sel, today)
  const purgeOk = canPurge(sel, today)

  /* 접종 완료로 세는 분류 이름 — 화면 설명용(저장은 id) */
  const catNames = useMemo(() => {
    const ids = sel?.category_ids || []
    return ids.map(id => (cats || []).find(c => c.id === id)?.label || '(삭제된 분류)')
  }, [sel, cats])

  const btn = (kind = 'ghost') => ({
    padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
    border: '1px solid ' + (kind === 'main' ? t.accent : t.border),
    background: kind === 'main' ? t.accent : t.card,
    color: kind === 'main' ? t.navText : t.textM,
  })

  if (!isAdmin) return null

  return <div style={{ padding: '20px 24px', textAlign: 'left' }}>
    {/* ── 머리줄 ── */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: t.text }}>수요 현황</span>
      <select value={selId} onChange={e => { setSelId(e.target.value); setRevealed({}) }}
        style={{ padding: '7px 10px', border: '1px solid ' + t.border, borderRadius: 9, fontSize: 12, background: t.bg, color: t.text }}>
        {!surveys.length ? <option value="">회차 없음</option> : null}
        {surveys.map(s => <option key={s.id} value={s.id}>
          {s.title} · {s.season} · {s.status === 'open' ? '진행 중' : s.status === 'closed' ? '종료' : '준비'}
        </option>)}
      </select>
      <div style={{ flex: 1 }} />
      <button onClick={() => setModal({ kind: 'round', form: blankForm(accs, cats) })} style={btn()}>+ 회차 만들기</button>
      {sel ? <button onClick={() => setModal({ kind: 'round', form: formOf(sel) })} style={btn()}>회차 수정</button> : null}
      {sel && sel.status !== 'open' ? <button onClick={() => setStatus('open')} style={btn('main')}>조사 열기</button> : null}
      {sel && sel.status === 'open' ? <button onClick={() => setStatus('closed')} style={btn()}>조사 닫기</button> : null}
    </div>

    {msg ? <div style={{
      background: t.card, border: '1px solid ' + t.border, borderLeft: '3px solid ' + t.accent,
      borderRadius: 10, padding: '10px 14px', fontSize: 12, color: t.text, marginBottom: 12, lineHeight: 1.6,
    }}>{msg}</div> : null}

    {purgeNeeded ? <div style={{
      background: t.amberL, border: '1px solid ' + t.amber, borderRadius: 10,
      padding: '10px 14px', fontSize: 12.5, fontWeight: 700, color: t.text, marginBottom: 12,
    }}>접종 기간이 끝났습니다 · 개인정보 파기가 필요합니다</div> : null}

    {ld ? <div style={{ padding: 40, textAlign: 'center', color: t.textL, fontSize: 12 }}>불러오는 중...</div>
      : !sel ? <div style={{
        background: t.card, border: '1px solid ' + t.border, borderRadius: 14,
        padding: '40px 20px', textAlign: 'center', color: t.textL, fontSize: 13,
      }}>조사 회차가 없습니다. 「+ 회차 만들기」로 시작하세요.</div>
        : <>
          {/* ── 숫자 카드 5개 ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <Num t={t} label="신청 D" v={demand?.demand_qty} unit="도즈" />
            <Num t={t} label="접종 완료 A" v={demand?.administered_qty} unit="도즈" />
            <Num t={t} label="남은 수요 R" v={demand?.remain_qty} unit="도즈" />
            <Num t={t} label="잔량 B" v={demand?.balance_qty} unit="도즈" />
            <Num t={t} label="주문 권장 O" v={demand?.order_qty} unit="도즈" strong
              badge={demand?.demand_status} />
          </div>

          <div style={{ fontSize: 11, color: t.textL, marginBottom: 12, lineHeight: 1.6 }}>
            접종 완료로 세는 분류: {catNames.length ? catNames.join(' · ') : '(없음)'}
            {sel.open_at ? <> · 기준 {String(sel.open_at).slice(0, 10)} 이후 접종</> : <> · 아직 열지 않아 A = 0</>}
          </div>

          {band ? <div style={{
            background: demand.demand_status === '부족' ? t.accentL : t.amberL,
            border: '1px solid ' + (demand.demand_status === '부족' ? t.accent : t.amber),
            borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700,
            color: t.text, marginBottom: 12,
          }}>{band}</div> : null}

          {/* ── 날짜별 누적 수요 · 잔량 ── */}
          <Collapse t={t} title="날짜별 누적 수요와 잔량"
            hint={shortAt ? shortDate(shortAt) + '부터 부족' : '기간 안에서는 잔량으로 충분'}>
            <CumChart t={t} series={series} balance={Number(demand?.balance_qty || 0)} shortAt={shortAt} />
          </Collapse>

          {/* ── 보조 지표 ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            <Chip t={t} label="사번 없음" v={demand?.no_emp_cnt} unit="건" />
            <Chip t={t} label="이름 중복 의심" v={demand?.name_dup_cnt} unit="건" />
            <Chip t={t} label="명단 체크 합" v={demand?.done_checked} unit="" />
            <Chip t={t} label="수요조사 외 접종" v={demand?.outside_qty} unit="" />
          </div>

          {/* ── 신청 명단 ── */}
          <div style={{
            background: t.card, border: '1px solid ' + t.border, borderRadius: 14,
            boxShadow: t.shadow, overflow: 'hidden', textAlign: 'left',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '12px 16px', borderBottom: '1px solid ' + t.border,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>신청 명단</span>
              <span style={{ fontSize: 11, color: t.textL }}>{shown.length}건</span>
              {/* 사양 ⑪ — 필터가 기본값과 다를 때만 보인다. 모양은 약품목록의 초기화 버튼 그대로. */}
              {hfDirty ? <button className="no-print" onClick={() => setHfV(HF_DEFAULT)}
                title="필터 초기화 (상태=신청)" style={{
                  padding: '4px 10px', borderRadius: 8, border: '1px solid ' + t.accent,
                  background: t.accent + '12', color: t.accent, cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                }}>필터 초기화{hfCount > 0 ? ' (' + hfCount + ')' : ''}</button> : null}
              <div style={{ flex: 1 }} />
              <button className="no-print" onClick={() => download('xlsx')} disabled={busy} style={btn()}>엑셀</button>
              <button className="no-print" onClick={() => download('pdf')} disabled={busy} style={btn()}>PDF</button>
              <button className="no-print" onClick={() => setModal({ kind: 'purge', step: 1, word: '' })}
                disabled={!purgeOk || busy}
                title={purgeOk ? '' : '조사를 닫고 접종 끝날이 지난 뒤에만 파기할 수 있습니다'}
                style={{ ...btn(), border: '1px solid ' + (purgeOk ? t.red : t.border), color: purgeOk ? t.red : t.textL, cursor: purgeOk ? 'pointer' : 'not-allowed' }}>
                개인정보 파기
              </button>
            </div>

            <div style={{ overflowX: 'auto', textAlign: 'left' }}>
              <table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse', fontSize: 12 }}>
                <colgroup>{COLS.map(c => <col key={c.k} style={{ width: c.w }} />)}</colgroup>
                <thead>
                  <tr style={{ background: t.bg }}>
                    {COLS.map(c => <th key={c.k} style={{
                      padding: '8px 10px', textAlign: c.align, whiteSpace: 'nowrap',
                      borderBottom: '1px solid ' + t.border, fontSize: 11, color: t.textM, fontWeight: 700,
                    }}>
                      {/* ★ 공용 ColMenu 가 읽는 모양 그대로 — items·value·on.
                          고르는 값은 **원문 기준**이다(가려진 값으로 모으면 * 끼리 묶인다). */}
                      <ColMenu colKey={c.k} label={c.h} sk={sk} sd={sd} setSort={sort.setSort}
                        filter={c.filter ? {
                          items: [...new Set(view.map(r => (
                            c.k === 'self_dose' ? r._self : c.k === 'status' ? r._status : String(r[c.k] ?? '')) || '—'))]
                            .sort((a, b) => a.localeCompare(b, 'ko')),
                          value: hfV[c.k] ?? null,
                          on: v => setHfV(s => {
                            const n = { ...s }
                            if (v) n[c.k] = v; else delete n[c.k]
                            return n
                          }),
                        } : null} />
                    </th>)}
                  </tr>
                </thead>
                <tbody>
                  {!shown.length
                    ? <tr><td colSpan={COLS.length} style={{ padding: '30px 10px', textAlign: 'center', color: t.textL }}>신청이 없습니다</td></tr>
                    : shown.map(r => {
                      const open = !!revealed[r.id]
                      return <tr key={r.id} style={{ borderBottom: '1px solid ' + t.border, opacity: r.status === 'cancelled' ? 0.55 : 1 }}>
                        <td style={td(t, 'left')}><span className="num">{r.receipt_code}</span></td>
                        <td style={td(t, 'left')}>
                          <span className={open ? 'num' : undefined}>{open ? (r.emp_no || '—') : maskEmpNo(r.emp_no)}</span>
                        </td>
                        <td style={td(t, 'left')}>
                          {open ? (r.name || '—') : maskName(r.name)}
                          {/* ★ 같은 자리·같은 모양의 버튼 하나. 열렸으면 글자만 「가리기」로 바뀐다. */}
                          <button onClick={() => (open ? hide(r) : reveal(r))} style={{
                            marginLeft: 6, padding: '1px 7px', borderRadius: 6, border: '1px solid ' + t.border,
                            background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 10, fontWeight: 700,
                          }}>{open ? '가리기' : '원문 보기'}</button>
                        </td>
                        <td style={td(t, 'center')}>{r._self}</td>
                        <td style={td(t, 'right')}><span className="num">{r.family_count}</span></td>
                        <td style={{ ...td(t, 'right'), fontWeight: 700 }}><span className="num">{r.dose}</span></td>
                        <td style={td(t, 'center')}><span className="num">{r.wish_date}</span></td>
                        <td style={td(t, 'center')}>
                          <select value={r.status} onChange={e => patchRow(r, { status: e.target.value })}
                            style={{ padding: '2px 6px', border: '1px solid ' + t.border, borderRadius: 7, fontSize: 11, background: t.bg, color: t.text }}>
                            <option value="applied">신청</option>
                            <option value="cancelled">취소</option>
                          </select>
                        </td>
                        <td style={td(t, 'center')}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!r.done_self} onChange={e => patchRow(r, { done_self: e.target.checked })}
                              style={{ accentColor: t.accent }} />
                            <span style={{ fontSize: 10, color: t.textL }}>본인</span>
                          </label>
                          {r.family_count > 0 ? <input type="number" min={0} max={r.family_count}
                            value={r.done_family}
                            onChange={e => patchRow(r, { done_family: Math.max(0, Math.min(r.family_count, Number(e.target.value) || 0)) })}
                            style={{ width: 46, marginLeft: 6, padding: '2px 4px', border: '1px solid ' + t.border, borderRadius: 6, fontSize: 11, background: t.bg, color: t.text }} /> : null}
                        </td>
                        <td style={{ ...td(t, 'left'), color: t.textL, fontSize: 11 }}>
                          {r.status === 'cancelled' ? '취소됨' : ''}
                        </td>
                      </tr>
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>}

    {modal?.kind === 'round'
      ? <RoundModal t={t} accs={accs} cats={cats} form={modal.form} editing={!!modal.form.id}
        onClose={() => setModal(null)}
        onSaved={async () => { setModal(null); await load(); if (selId) await loadDetail(selId) }}
        onErr={setMsg} />
      : null}

    {modal?.kind === 'purge'
      ? <PurgeModal t={t} survey={sel} step={modal.step} word={modal.word} busy={busy}
        onStep={s => setModal(m => ({ ...m, step: s }))}
        onWord={w => setModal(m => ({ ...m, word: w }))}
        onClose={() => setModal(null)} onRun={runPurge} />
      : null}
  </div>
}

/* ── 작은 조각 ─────────────────────────────────────────────────────────── */
const td = (t, align) => ({ padding: '7px 10px', textAlign: align, color: t.text, whiteSpace: 'nowrap' })

function Num({ t, label, v, unit, strong, badge }) {
  const BADGE = {
    충분: { background: 'transparent', color: t.green, border: '1.5px solid ' + t.green },
    주의: { background: t.lavL || 'rgba(191,166,217,0.45)', color: t.text, border: '1.5px solid transparent' },
    부족: { background: t.purple, color: '#fff', border: '1.5px solid ' + t.purple },
  }
  const b = badge ? (BADGE[badge] || BADGE['충분']) : null
  return <div style={{
    background: t.card, border: '1px solid ' + (strong ? t.accent : t.border),
    borderRadius: 12, padding: '12px 14px', boxShadow: t.shadow,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: t.textM, fontWeight: 600 }}>{label}</span>
      {b ? <span style={{ ...b, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>{badge}</span> : null}
    </div>
    <div className="num" style={{
      fontSize: strong ? 30 : 24, fontWeight: 800, marginTop: 4,
      color: strong ? t.accent : t.text, lineHeight: 1.15,
    }}>{v == null ? '—' : Number(v).toLocaleString()}</div>
    {unit ? <div style={{ fontSize: 10, color: t.textL }}>{unit}</div> : null}
  </div>
}

function Chip({ t, label, v, unit }) {
  return <div style={{
    background: t.card, border: '1px solid ' + t.border, borderRadius: 999,
    padding: '6px 13px', fontSize: 11.5, color: t.textM, whiteSpace: 'nowrap',
  }}>
    {label} <b className="num" style={{ color: t.text }}>{v == null ? '—' : Number(v).toLocaleString()}</b>{unit}
  </div>
}

function Collapse({ t, title, hint, children }) {
  const [open, setOpen] = useState(true)
  return <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, boxShadow: t.shadow, overflow: 'hidden' }}>
    <button onClick={() => setOpen(o => !o)} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px',
      border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{title}</span>
      <span style={{ fontSize: 11, color: t.textL }}>{hint}</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: t.textM }}>{open ? '접기' : '펼치기'}</span>
    </button>
    {open ? <div style={{ padding: '0 16px 16px' }}>{children}</div> : null}
  </div>
}

/* 날짜별 누적 수요 + 잔량 점선 — 인라인 SVG(저장소 방식) */
function CumChart({ t, series, balance, shortAt }) {
  if (!series.length) {
    return <div style={{ padding: '26px 0', textAlign: 'center', color: t.textL, fontSize: 12 }}>
      아직 접종하지 않은 신청이 없습니다
    </div>
  }
  const W = 720, H = 210, L = 44, R = 12, T = 14, B = 30
  const maxY = Math.max(balance, ...series.map(p => p.cum)) * 1.1 || 1
  const x = i => L + (series.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (series.length - 1))
  const y = v => T + (H - T - B) * (1 - v / maxY)
  const line = series.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.cum).toFixed(1)).join(' ')
  const area = line + ` L${x(series.length - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`
  const shortIdx = series.findIndex(p => p.date === shortAt)

  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 210 }} preserveAspectRatio="xMidYMid meet">
    {/* 잔량 수평 점선 */}
    <line x1={L} y1={y(balance)} x2={W - R} y2={y(balance)}
      stroke={t.green} strokeWidth="1.5" strokeDasharray="5 4" />
    <text x={L - 6} y={y(balance) + 4} textAnchor="end" style={{ fontSize: 10, fill: t.green, fontWeight: 700 }}>
      {balance.toLocaleString()}
    </text>
    {/* 누적 면 + 선 */}
    <path d={area} fill={t.accent} opacity="0.12" />
    <path d={line} fill="none" stroke={t.accent} strokeWidth="2" />
    {series.map((p, i) => <g key={p.date}>
      <circle cx={x(i)} cy={y(p.cum)} r={i === shortIdx ? 5 : 3}
        fill={i === shortIdx ? t.purple : t.accent} />
      <title>{p.date + ' · 누적 ' + p.cum + '도즈 (당일 +' + p.add + ')'}</title>
      {(series.length <= 10 || i % Math.ceil(series.length / 8) === 0)
        ? <text x={x(i)} y={H - 10} textAnchor="middle" style={{ fontSize: 9, fill: t.textL }}>{shortDate(p.date)}</text>
        : null}
    </g>)}
    {shortIdx >= 0 ? <text x={Math.min(x(shortIdx) + 8, W - 90)} y={y(series[shortIdx].cum) - 9}
      style={{ fontSize: 10, fill: t.purple, fontWeight: 800 }}>
      {shortDate(shortAt)}부터 부족
    </text> : null}
  </svg>
}

/* ── 회차 만들기·수정 ──────────────────────────────────────────────────── */
function blankForm(accs, cats) {
  const acc = (accs || []).find(a => a.funding_source === '일반' && a.is_active !== false) || (accs || [])[0] || null
  const own = (cats || []).filter(c => c.account_id === acc?.id)
  return {
    id: null,
    title: '독감(유료) 수요조사',
    season: acc?.season || '',
    account_id: acc?.id || '',
    category_ids: defaultCategoryIds(own),
    close_at: '',
    vax_start: '',
    vax_end: '',
    safety_ratio: 0.10,
    safety_min: 5,
    order_unit: 10,
  }
}
function formOf(s) {
  return {
    id: s.id, title: s.title, season: s.season, account_id: s.account_id,
    category_ids: [...(s.category_ids || [])],
    close_at: s.close_at ? String(s.close_at).slice(0, 16) : '',
    vax_start: s.vax_start || '', vax_end: s.vax_end || '',
    safety_ratio: Number(s.safety_ratio), safety_min: Number(s.safety_min), order_unit: Number(s.order_unit),
  }
}

function RoundModal({ t, accs, cats, form: init, editing, onClose, onSaved, onErr }) {
  const [f, setF] = useState(init)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const own = (cats || []).filter(c => c.account_id === f.account_id)
  const ready = f.title.trim() && f.season.trim() && f.account_id && f.category_ids.length
    && f.vax_start && f.vax_end && f.vax_start <= f.vax_end

  async function save() {
    if (!ready || busy) return
    setBusy(true)
    const payload = {
      title: f.title.trim(), season: f.season.trim(), account_id: f.account_id,
      category_ids: f.category_ids,
      close_at: f.close_at ? new Date(f.close_at).toISOString() : null,
      vax_start: f.vax_start, vax_end: f.vax_end,
      safety_ratio: Number(f.safety_ratio), safety_min: Number(f.safety_min), order_unit: Number(f.order_unit),
      updated_at: new Date().toISOString(),
    }
    const res = editing
      ? await supabase.from('vaccine_surveys').update(payload).eq('id', f.id)
      : await supabase.from('vaccine_surveys').insert(payload)
    setBusy(false)
    if (res.error) { onErr(dbErrorMsg(res.error)); return }
    onSaved()
  }

  const ip = { width: '100%', padding: '8px 11px', border: '1px solid ' + t.border, borderRadius: 9, fontSize: 12, background: t.bg, color: t.text, boxSizing: 'border-box' }
  const lb = { display: 'block', fontSize: 11, fontWeight: 700, color: t.textM, margin: '12px 0 5px' }

  return <div className="no-print" onClick={onClose} style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: t.card, borderRadius: 14, border: '1px solid ' + t.border, padding: 20,
      maxWidth: 520, width: '100%', maxHeight: '86vh', overflowY: 'auto', textAlign: 'left',
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>{editing ? '회차 수정' : '회차 만들기'}</div>

      <label style={lb}>제목</label>
      <input value={f.title} onChange={e => set('title', e.target.value)} style={ip} />

      <label style={lb}>절기</label>
      <input value={f.season} onChange={e => set('season', e.target.value)} placeholder="2026-2027" style={ip} />

      <label style={lb}>백신 계정</label>
      <select value={f.account_id} onChange={e => {
        const id = e.target.value
        set('account_id', id)
        set('category_ids', defaultCategoryIds((cats || []).filter(c => c.account_id === id)))
      }} style={ip}>
        <option value="">선택</option>
        {(accs || []).map(a => <option key={a.id} value={a.id}>
          {a.public_label || a.drug_code} · {a.season} · {a.funding_source}
        </option>)}
      </select>

      <label style={lb}>접종 완료(A)로 세는 분류 — 저장은 분류 id 로 합니다</label>
      <div style={{ border: '1px solid ' + t.border, borderRadius: 9, padding: '8px 11px', background: t.bg }}>
        {!own.length ? <div style={{ fontSize: 11, color: t.textL }}>이 계정에 분류가 없습니다</div>
          : own.map(c => {
            const on = f.category_ids.includes(c.id)
            return <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 12, color: t.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} style={{ accentColor: t.accent }}
                onChange={e => set('category_ids', e.target.checked
                  ? [...f.category_ids, c.id]
                  : f.category_ids.filter(x => x !== c.id))} />
              <span>{c.label}</span>
            </label>
          })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><label style={lb}>접종 시작일</label>
          <input type="date" value={f.vax_start} onChange={e => set('vax_start', e.target.value)} style={ip} /></div>
        <div><label style={lb}>접종 끝날</label>
          <input type="date" value={f.vax_end} onChange={e => set('vax_end', e.target.value)} style={ip} /></div>
      </div>

      <label style={lb}>신청 마감 일시 (비우면 제한 없음)</label>
      <input type="datetime-local" value={f.close_at} onChange={e => set('close_at', e.target.value)} style={ip} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div><label style={lb}>안전재고 비율</label>
          <input type="number" step="0.01" min="0" max="1" value={f.safety_ratio}
            onChange={e => set('safety_ratio', e.target.value)} style={ip} /></div>
        <div><label style={lb}>안전재고 최소</label>
          <input type="number" min="0" value={f.safety_min} onChange={e => set('safety_min', e.target.value)} style={ip} /></div>
        <div><label style={lb}>발주 단위</label>
          <input type="number" min="1" value={f.order_unit} onChange={e => set('order_unit', e.target.value)} style={ip} /></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button onClick={onClose} style={{
          padding: '8px 14px', borderRadius: 9, border: '1px solid ' + t.border,
          background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 12, fontWeight: 700,
        }}>취소</button>
        <button onClick={save} disabled={!ready || busy} style={{
          padding: '8px 16px', borderRadius: 9, border: '1px solid ' + (ready ? t.accent : t.border),
          background: ready ? t.accent : t.bg, color: ready ? t.navText : t.textL,
          cursor: ready && !busy ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700,
        }}>{busy ? '저장 중...' : '저장'}</button>
      </div>
    </div>
  </div>
}

/* ── 파기 확인 2단계 ───────────────────────────────────────────────────── */
function PurgeModal({ t, survey, step, word, busy, onStep, onWord, onClose, onRun }) {
  return <div className="no-print" onClick={onClose} style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1101,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: t.card, borderRadius: 14, border: '1px solid ' + t.border, padding: 20,
      maxWidth: 460, width: '100%', textAlign: 'left',
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: t.red }}>개인정보 파기</div>
      {step === 1
        ? <>
          <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.7, marginTop: 10 }}>
            <b>{survey?.title}</b> 회차의 <b>성명·사번·확인번호</b>를 지웁니다.<br />
            도즈 수·희망일·상태·신청번호는 남아 통계는 그대로 볼 수 있습니다.<br />
            <span style={{ color: t.red, fontWeight: 700 }}>되돌릴 수 없습니다.</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button onClick={onClose} style={ghost(t)}>취소</button>
            <button onClick={() => onStep(2)} style={{ ...ghost(t), border: '1px solid ' + t.red, color: t.red }}>계속</button>
          </div>
        </>
        : <>
          <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.7, marginTop: 10 }}>
            확인을 위해 아래에 <b>{PURGE_WORD}</b> 를 입력해 주세요.
          </div>
          <input value={word} onChange={e => onWord(e.target.value)} autoFocus
            style={{
              width: '100%', marginTop: 10, padding: '9px 12px', border: '1px solid ' + t.border,
              borderRadius: 9, fontSize: 13, background: t.bg, color: t.text, boxSizing: 'border-box',
            }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button onClick={onClose} style={ghost(t)}>취소</button>
            <button onClick={onRun} disabled={word !== PURGE_WORD || busy} style={{
              padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700,
              border: '1px solid ' + (word === PURGE_WORD ? t.red : t.border),
              background: word === PURGE_WORD ? t.red : t.bg,
              color: word === PURGE_WORD ? '#fff' : t.textL,
              cursor: word === PURGE_WORD && !busy ? 'pointer' : 'not-allowed',
            }}>{busy ? '파기 중...' : '파기'}</button>
          </div>
        </>}
    </div>
  </div>
}
const ghost = t => ({
  padding: '8px 14px', borderRadius: 9, border: '1px solid ' + t.border,
  background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 12, fontWeight: 700,
})
