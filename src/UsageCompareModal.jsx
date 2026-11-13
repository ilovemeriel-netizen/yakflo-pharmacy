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
import { createPortal, flushSync } from 'react-dom'
import { supabase } from './lib/supabase'
import { buildUsageCompare, applyRows, applySummary, APPLY_FIELDS, closedWindow } from './lib/usageCompare'
import { checkRowLimit } from './lib/rowLimit'
import { dbErrorMsg } from './lib/dbError'

const num = v => Number(v || 0).toLocaleString()

/* ★ 비고 칸 너비 — 뱃지가 둘·셋이어도 **이 칸 안에서만** 줄바꿈시켜
     약품 칸 너비를 PR 459 와 같게 지킨다. 한곳에서 정한다.
   ★ 149 는 PR 459 화면에서 **실제로 재어 본** 비고 칸 너비다(약품 칸 234px).
     ★ 표 칸은 기본이 content-box 라 width 에 안쪽 여백(좌우 10px)이 **안 들어간다** —
       그냥 149 를 주면 169 가 되어 약품 칸이 22px 줄어든다. 그래서 border-box 로 못 박는다. */
const NOTE_W = 149
const noteCell = { width: NOTE_W, boxSizing: 'border-box' }

/* ── 인쇄 — 「3개월 출고 0」 재고 실사 리스트 ────────────────────────────
   ★ NARC_PRINT_CSS(향정 인쇄)와 **같은 방식**이다. 새 방식을 만들지 않는다.
   ★ 이 창은 덮개 위에 뜨는 모달이라 그대로 찍으면 검은 덮개까지 인쇄된다.
     그래서 인쇄할 표만 **body 바로 밑으로 따로 내보내고**(createPortal),
     인쇄 때 body 의 다른 자식(= #root 전체)을 숨긴다.
   ★ 앱 전역에 @page{size:A4 portrait} 가 걸려 있다 — 이 블록이 문서에서
     **뒤에 오므로** 가로가 이긴다(실제 인쇄로 297×210mm 확인).
   ★★ 쪽 번호 「1 / 2」 때문에 **쪽을 직접 나눈다.** 크롬·엣지는 @page 여백 상자
     (@bottom-right{content:counter(page)})를 **지원하지 않아** CSS 만으로는 못 적는다.
     병동 인쇄(.wp-page)와 같은 길이다. 줄 높이를 재서 끊고, 브라우저의
     break-inside:avoid 를 **받침**으로 남겨 둔다(재기가 어긋나도 줄이 안 잘린다). */
const A4L_H_MM = 210, A4L_MARGIN_MM = 10
/* ★ 한 쪽에 담을 높이. 여유 **8mm** 를 둔다.
     ★ 재기는 바깥 여백(margin)을 세지 않는다 — 제목 아래 4mm 처럼 셈에서 빠지는 높이가 있어
       여유가 없으면 쪽이 종이보다 커진다(2026-11-13 실측: 여유 3mm 일 때 190mm 로 턱걸이).
   ★★ 쪽 상자에 **높이를 고정하지 않는다.** 고정하면 인쇄 때 1px만 넘쳐도 그 쪽이
      다음 장으로 밀리고 break-after 가 또 한 장을 만들어 **빈 장이 생긴다**
      (2026-11-13 실제로 겪었다: 2쪽짜리가 3쪽이 됐다).
      대신 쪽 번호를 표 바로 아래에 둔다 — 자리는 아래쪽이 아니지만 **빈 장이 없다.** */
const PRINT_CONTENT_H_MM = A4L_H_MM - A4L_MARGIN_MM * 2 - 8   /* 182mm */
const MM_PX = 96 / 25.4
const UC_PRINT_CSS = `
.uc-print{display:none}
.uc-print-measure{position:absolute;left:-99999px;top:0;width:${297 - A4L_MARGIN_MM * 2}mm}
@media print{
  .uc-print-measure{display:none!important}
}
.uc-pr .up-page{break-after:page;page-break-after:always}
.uc-pr .up-page:last-child{break-after:auto;page-break-after:auto}
.uc-pr .up-h{font-size:15pt;font-weight:700;margin:0 0 1.5mm;text-align:left}
.uc-pr .up-h::after{content:"";display:block;width:70mm;height:0;border-top:1.6pt solid #000;margin-top:1.2mm}
.uc-pr .up-m{font-size:8.5pt;line-height:1.5;margin:2.5mm 0 4mm;text-align:left}
.uc-pr table{width:100%;border-collapse:collapse;table-layout:fixed}
.uc-pr thead{display:table-header-group}
.uc-pr tr{break-inside:avoid;page-break-inside:avoid}
/* ★ !important 를 붙인다 — 앱 전역 인쇄 CSS 에 th,td{padding:4px 6px!important;font-size:9px!important}
     가 있어서, 안 붙이면 **우리가 잰 크기와 다른 크기로 인쇄된다.** */
.uc-pr th,.uc-pr td{border:0.5pt solid #666;padding:0.8mm 2mm!important;font-size:9pt!important;line-height:1.15;vertical-align:middle}
.uc-print th{font-weight:700;border-bottom:3pt double #000;text-align:center}
/* ★ 칸마다 정렬을 직접 적는다 — #root{text-align:center} 가 전 화면에 상속된다(함정 #31) */
.uc-pr .up-l{text-align:left}
.uc-pr .up-r{text-align:right}
.uc-pr .up-c{text-align:center}
/* 약품명 — 글씨를 줄여 한 줄 우선, 넘치면 두 줄까지만 */
.uc-pr .up-name{font-size:8pt!important;word-break:keep-all;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* 서명 칸 — 향정 인쇄 .np-sign 과 같은 모양 */
.uc-pr .up-sign{margin-top:8mm;font-size:9pt;width:auto}
.uc-pr .up-sign td{border:none;padding:0 6mm 0 0;white-space:nowrap}
/* 쪽 번호 — 쪽 맨 아래 가운데 */
.uc-pr .up-ft{padding-top:3mm;text-align:center;font-size:8.5pt}
.uc-pr col.c1{width:12%} .uc-pr col.c2{width:26%} .uc-pr col.c3{width:7%}
.uc-pr col.c4{width:8%}  .uc-pr col.c5{width:13%} .uc-pr col.c6{width:14%}
.uc-pr col.c7{width:8%}  .uc-pr col.c8{width:6%}  .uc-pr col.c9{width:6%}
`

/* ── 인쇄 조각 — **창 밖(모듈)에 둔다.** 렌더 안에서 만들면 리액트가 매번
     새 부품으로 보고 통째로 다시 그린다(이 저장소 eslint 도 막는다).
   ★ 재는 자리와 진짜 쪽이 **같은 모양**이어야 잰 높이가 맞는다 — 둘 다 이 조각을 쓴다. */
const PrnCols = () => <colgroup>
  <col className="c1" /><col className="c2" /><col className="c3" /><col className="c4" />
  <col className="c5" /><col className="c6" /><col className="c7" /><col className="c8" /><col className="c9" />
</colgroup>
const PrnHead = () => <thead><tr>
  <th>약품코드</th><th>약품명</th><th>구분</th><th>현재고</th>
  <th>직전3개월</th><th>비고</th><th>실사수량</th><th>차이</th><th>확인</th>
</tr></thead>
const PrnRow = ({ r }) => <tr>
  <td className="up-l">{r.code}</td>
  <td className="up-l"><span className="up-name">{r.name}</span></td>
  <td className="up-c">{r.category}</td>
  <td className="up-r">{num(r.qty)}</td>
  <td className="up-r">{num(r.o3)} → {num(r.n3)}</td>
  <td className="up-l">{r.note}</td>
  {/* ★ 실사수량·차이·확인은 **종이에서 손으로 적는 자리**다 — 빈칸으로 둔다 */}
  <td /><td /><td />
</tr>
/* 서명 칸 — 향정 인쇄 .np-sign 과 같은 모양 */
const PrnSign = () => <table className="up-sign"><tbody><tr>
  <td>실사자 ______________________ (서명)</td>
  <td>확인자 ______________________ (서명)</td>
</tr></tbody></table>

/* ★★ **「인쇄」를 누른 동안에만** 문서에 넣는 규칙이다.
     ★ @page 는 선택자로 범위를 좁힐 수 없다 — 문서에 있기만 하면 **그 문서의 모든 인쇄**에
       걸린다. 늘 띄워 두면 창이 열려 있는 동안 다른 화면을 Ctrl+P 로 뽑을 때
       종이가 가로로 바뀐다(2026-11-13 실측: 향정 인쇄가 216×279mm → 297×210mm 로 변했다).
       그래서 이 덩어리는 누를 때 넣고 afterprint 에서 뺀다.
     ★ 앱 전체를 숨기는 규칙도 여기 둔다 — 같은 이유다. */
const UC_PRINT_ON_CSS = `
@media print{
  @page{size:A4 landscape;margin:${A4L_MARGIN_MM}mm}
  body>*:not(.uc-print){display:none!important}
  .uc-print{display:block!important;background:#fff!important;color:#000!important}
  .uc-print *{background:transparent!important;color:#000!important;box-shadow:none!important}
}`

/* 오늘 YYYYMMDD — ★ toISOString() 은 UTC 라 한국 시각 자정 언저리에 하루가 밀린다.
   파일 이름에 쓰이므로 **그 지역 날짜**로 적는다. */
function ymdToday() {
  const d = new Date()
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
}

/* 「8·9·10월」처럼 석 달을 적는다. 해가 바뀌어도 맞게 — 1월이면 11·12·1월이 된다. */
function monthLabel(year, month) {
  if (!year || !month) return ''
  const m = [2, 1, 0].map(k => new Date(Date.UTC(year, month - 1 - k, 1)).getUTCMonth() + 1)
  return m.join('·') + '월'
}

export default function UsageCompareModal({ t, drugs, year: fixedY, month: fixedM, isTenantManager, onClose, onReload, onDone, Confirm, ColMenu, useSort }) {
  const box = useRef(null)
  const [loaded, setLoaded] = useState(null)
  const [onlyMoved, setOnlyMoved] = useState(true)
  /* ★ 머리 정렬 — ⇅ 만. ColMenu 에 filter 를 주지 않으므로 거르기 메뉴는 나오지 않는다.
       ★ JSX 태그 이름으로만 쓰인 식별자는 이 저장소 eslint 가 미사용으로 본다 — 변수로 한 번 받는다. */
  const HeadMenu = ColMenu
  const sortTbl = useSort('')
  /* ★ 거르기 — **보기만** 좁힌다. 적용 대상 규칙(원본 p.rows + 약품코드 Set)은
       **한 글자도 바뀌지 않는다**.
     ★★ 칩과 비고 머리글 메뉴가 **상태 하나**를 함께 쓴다 — 칩을 누르면 메뉴에 ✓ 가
        붙고, 메뉴에서 풀면 칩도 풀린다. 두 벌로 두면 **서로 어긋난 상태**가 생긴다.
        null = 전체. (2026-11-13 이정화 님 승인) */
  const [noteF, setNoteF] = useState(null)
  /* 인쇄 머리말에 적을 약국 이름 — Header 가 쓰는 것과 **같은 한 줄**(tenants.name).
     ★ 「3개월 출고 0」으로 걸렀을 때만 읽는다 — 창을 열기만 해서는 조회하지 않는다.
     ★ 못 읽어도 인쇄는 그대로 된다(이름만 비고 나머지는 같다). */
  const [org, setOrg] = useState('')
  const zeroOnly = noteF === 'zero'
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

  const [prnPages, setPrnPages] = useState(null)   /* 인쇄 쪽 나눔 결과 */
  const [printing, setPrinting] = useState(false)  /* 「인쇄」를 누른 동안만 참 */
  const offRef = useRef(null)                      /* afterprint 를 떼어 낼 자리 */
  const prnRef = useRef(null)

  /* ★★ 거르기를 바꿀 때는 인쇄 표시를 **반드시 끈다.**
       안 끄면 거르기를 풀었다가 **다시 걸었을 때**, 「인쇄」를 누르지도 않았는데
       종이를 가로로 바꾸는 규칙이 되살아난다(= 다른 화면 인쇄에 번진다).
       칩이든 비고 메뉴든 **이 문 하나로만** 바꾼다. */
  function changeNote(v) {
    setPrinting(false)
    if (offRef.current) { window.removeEventListener('afterprint', offRef.current); offRef.current = null }
    setNoteF(v)
  }
  /* ★ 창이 사라질 때도 손잡이를 떼어 낸다 — 인쇄 규칙은 포털과 함께 사라지지만
       걸어 둔 afterprint 는 저절로 사라지지 않는다.
       (상태를 바꾸지 않으므로 효과에 둬도 된다) */
  useEffect(() => () => {
    if (offRef.current) { window.removeEventListener('afterprint', offRef.current); offRef.current = null }
  }, [])

  const year = ym ? ym.y : null
  const month = ym ? ym.m : null
  const key = year + '-' + month

  /* 거래 읽기 — 그 창의 출고만. 읽기만 한다.
     ★ **한 번에 읽지 않는다.** `supabase.from(...).select(...)` 는 기본 1,000줄만 주고
       넘치면 오류도 경고도 없이 조용히 잘린다(lib/rowLimit.js 첫머리 참고).
       8·9·10월 출고가 1,079줄이라 79줄이 빠져 **합계가 작게** 나왔다(2026-11-10 실측).
       월마감의 `_fetchMonthTx` 와 같은 방식으로 1,000줄씩 끝까지 읽는다.
     ★ 쪽을 나눌 때는 **차례를 고정**한다(id). 고정하지 않으면 쪽마다 같은 줄이
       겹치거나 빠질 수 있다 — 그러면 또 조용히 틀린다. */
  useEffect(() => {
    if (!year || !month) return undefined
    let dead = false
    const w = closedWindow(year, month)
    const PAGE = 1000
    ;(async () => {
      let rows = [], from = 0, total = null
      for (;;) {
        const { data, error, count } = await supabase.from('transactions')
          .select('drug_code,type,transaction_date,quantity', { count: 'exact' })
          .eq('type', '출고')
          .gte('transaction_date', w.m3From)
          .lt('transaction_date', w.toExclusive)
          .order('id')
          .range(from, from + PAGE - 1)
        if (dead) return
        if (error) {
          setLoaded({ key, rows: [], err: '거래를 읽지 못했습니다: ' + dbErrorMsg(error), cutMsg: '' })
          return
        }
        if (count != null) total = count
        rows = rows.concat(data || [])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      /* 다 읽었는지 한 번 더 센다 — 쪽 나누기가 잘못돼도 여기서 걸린다 */
      const lim = checkRowLimit(rows, total)
      setLoaded({ key, rows, err: '', cutMsg: lim.message })
    })()
    return () => { dead = true }
  }, [year, month, key])

  useEffect(() => {
    if (noteF !== 'zero' || org) return undefined
    let dead = false
    supabase.from('tenants').select('name').limit(1).maybeSingle()
      .then(({ data }) => { if (!dead && data && data.name) setOrg(String(data.name)) })
    return () => { dead = true }
  }, [noteF, org])

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

  /* ★ 결과를 **창 밖으로도** 알린다 — 창이 닫히거나 다시 그려져도 사라지지 않게.
     2026-11-10 사례: 「적용했다」는데 DB 는 0건이었고, 화면에는 빨간 띠도 초록 띠도
     남아 있지 않아 **무슨 일이 났는지 알 길이 없었다.** 창 안에만 적으면 또 그렇게 된다.
     그래서 세 가지를 한다 —
       ① 던져진 예외까지 잡는다(try/catch)
       ② 결과를 부모 화면 띠로 올려 보낸다(onDone)
       ③ 보낸 줄 수와 저장된 줄 수가 다르면 **성공으로 치지 않는다** */
  async function apply() {
    setConfirming(false); setApplying(true); setApplyErr(''); setResult(null)
    const rows = applyRows(p ? p.rows : [], finalPicked)
    let data = null, error = null
    try {
      const r = await supabase.rpc('app_save_usage_bulk', {
        p_fields: APPLY_FIELDS, p_rows: rows, p_zero_missing: false, p_keep_codes: [],
      })
      data = r.data; error = r.error
    } catch (e) {
      /* 그물 밖으로 새는 예외도 잡는다 — 조용히 사라지면 「눌렀는데 아무 일도」가 된다 */
      error = e
    }
    setApplying(false)
    if (error) {
      const msg = '적용하지 못했습니다: ' + dbErrorMsg(error)
      setApplyErr(msg)
      onDone?.({ ok: false, message: msg })
      return
    }
    const saved = Number((data && data.saved) || 0)
    setResult(data || { saved: 0 })
    if (saved !== rows.length) {
      /* 보낸 줄과 저장된 줄이 다르면 그냥 넘기지 않는다 */
      onDone?.({ ok: false, message: '적용은 됐지만 보낸 ' + num(rows.length)
        + '종 가운데 ' + num(saved) + '종만 저장됐습니다. 약플로 담당자에게 알려 주세요.' })
    } else {
      onDone?.({ ok: true, message: '사용량 적용 완료 — ' + num(saved) + '종을 저장했습니다.' })
    }
    onReload?.()
  }

  /* ── 모양 — NarcoticUsageModal 과 같은 값 ─────────────────────────── */
  const badge = (text, bg, color) => (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 8, fontSize: 10,
      fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>{text}</span>
  )
  /* ★★ 비고 — 해당하는 뱃지를 **모두** 보여 준다(한 약에 둘·셋이 붙을 수 있다).
       ★ 거르기는 **글자가 아니라 약의 성질**로 한다. 글자로 거르면 「백신이면서
         3개월 출고 0」인 약이 백신 쪽에만 걸려 **숫자가 어긋난다**
         (2026-11-13 실측: 글자 기준 40줄 vs 성질 기준 42줄 — 칩은 42종).
       ★ 차례(= 비고 정렬 차례)도 이 줄 차례를 따른다. */
  const NOTE_DEFS = [
    { k: 'vac', label: '백신 — 제외', hit: r => r.vac, bg: t.blueL, fg: t.blue },
    { k: 'zero', label: '3개월 출고 0', hit: r => r.zeroOut, bg: t.amberL, fg: t.amber },
    { k: 'tiny', label: '극소량 — 3개월 그대로', hit: r => r.tiny, bg: t.purpleL, fg: t.purple },
    { k: 'same', label: '차이 없음', hit: r => !r.changed, bg: '#F0F0EB', fg: t.textL },
  ]
  const noteHit = r => NOTE_DEFS.filter(d => d.hit(r))
  /* 비고 정렬은 **첫 뱃지** 차례로 센다. 뱃지가 없으면 맨 뒤로 */
  const noteRank = r => { const i = NOTE_DEFS.findIndex(d => d.hit(r)); return i < 0 ? NOTE_DEFS.length : i }

  /* ★★ 보여 줄 때만 줄을 세운다 — **원본(p.rows·p.moved)은 한 줄도 건드리지 않는다.**
       체크는 약품코드(Set)로 기억하고 「적용」도 원본 p.rows 로 만들기 때문에,
       보이는 차례가 바뀌어도 **체크와 적용 대상이 달라지지 않는다**(시험으로 못 박는다). */
  const sortRows = (list, st) => {
    if (!st || !st.sk) return list
    const dir = st.sd === 'desc' ? -1 : 1
    /* ★ 비고는 표에 **없는 값**이다 — 첫 뱃지 차례로 센다.
         계산식 파일(lib/usageCompare.js)에 칸을 더하지 않는다. */
    if (st.sk === 'note') return [...list].sort((a, b) => (noteRank(a) - noteRank(b)) * dir)
    return [...list].sort((a, b) => {
      const x = a[st.sk], y = b[st.sk]
      const nx = Number(x), ny = Number(y)
      const bothNum = x != null && y != null && !Number.isNaN(nx) && !Number.isNaN(ny) && String(x).trim() !== '' && String(y).trim() !== ''
      if (bothNum) return (nx - ny) * dir
      return String(x ?? '').localeCompare(String(y ?? ''), 'ko') * dir
    })
  }
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
  const base0 = p ? (onlyMoved ? p.moved : p.rows) : []
  const noteDef = NOTE_DEFS.find(d => d.k === noteF)
  const shown = noteDef ? base0.filter(noteDef.hit) : base0
  /* 메뉴에 올릴 거리 — **지금 화면에서 0줄인 것은 올리지 않는다**(눌러도 빈 표다).
     ★ 다만 **지금 고른 것**은 0줄이 돼도 남긴다 — 메뉴에서 사라지면 ✓ 를 풀 길이 없다. */
  const noteOpts = NOTE_DEFS.filter(d => d.k === noteF || base0.some(d.hit))
  const noteItems = noteOpts.map(d => d.label)
  const noteKeyOf = v => { const d = noteOpts.find(x => x.label === v); return d ? d.k : null }
  const noteLabelOf = k => { const d = NOTE_DEFS.find(x => x.k === k); return d ? d.label : null }
  /* ★★ 걸러서 **화면 밖으로 간 체크**를 센다 — 「적용」은 여전히 체크한 모두에 들어가므로
       조용히 두지 않고 말해 준다. 세기만 할 뿐 **적용 대상을 바꾸지 않는다.** */
  const shownSet = new Set(shown.map(r => r.code))
  const hiddenPicked = [...finalPicked].filter(c => !shownSet.has(c)).length

  /* ── 인쇄·엑셀 — 「3개월 출고 0」으로 걸렀을 때만 ────────────────────────
     ★ **읽기만 한다.** 체크·적용과 아무 상관이 없다 — 지금 **보이는 줄**을
       보이는 차례 그대로 내보낸다. 적용 대상 규칙은 건드리지 않는다. */
  const zeroPicked = noteF === 'zero'
  const prnRows = sortRows(shown, sortTbl)
    .map(r => ({ ...r, note: noteHit(r).map(d => d.label).join(' · ') }))

  /* 엑셀 — 저장소에 이미 있는 xlsx(SheetJS)를 **동적으로** 불러 쓴다.
     실사양식·재고·유효기한 등 아홉 곳이 같은 방식이다. **새 라이브러리 없음.** */
  async function dlXlsx() {
    try {
      const XL = await import('xlsx')
      const HDR = ['약품코드', '약품명', '구분', '현재고',
        '직전3개월(예전)', '직전3개월(지금)', '비고', '실사수량', '차이', '확인']
      const aoa = [HDR, ...prnRows.map(r => [
        r.code, r.name, r.category, r.qty, r.o3, r.n3,
        r.note, '', '', '',
      ])]
      const ws = XL.utils.aoa_to_sheet(aoa)
      for (let i = 0; i < prnRows.length; i++) {
        const rowNo = i + 2                       /* 엑셀 행 번호(머리 1줄 다음부터) */
        /* ★ 약품코드는 **텍스트 서식**으로 둔다 — 2026-08 마감에서 APR2 가 46114 로
             자동 변환된 사고가 실재한다(실사양식과 같은 처리). */
        const a = XL.utils.encode_cell({ c: 0, r: i + 1 })
        if (ws[a]) { ws[a].t = 's'; ws[a].z = '@' }
        /* ★ 「차이」 = 실사수량 − 현재고. 실사수량이 비어 있으면 **빈칸으로 보이게** 한다.
             값을 미리 박지 않고 **식**을 넣는다 — 종이에서 옮겨 적으면 바로 셈이 된다. */
        const d = XL.utils.encode_cell({ c: 8, r: i + 1 })
        ws[d] = { t: 's', v: '', f: 'IF(H' + rowNo + '="","",H' + rowNo + '-D' + rowNo + ')' }
      }
      ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 9 }, { wch: 10 },
        { wch: 15 }, { wch: 15 }, { wch: 26 }, { wch: 11 }, { wch: 9 }, { wch: 9 }]
      const wb = XL.utils.book_new()
      XL.utils.book_append_sheet(wb, ws, '3개월출고0')
      XL.writeFile(wb, '재고실사_3개월출고0_' + ymdToday() + '.xlsx')
      onDone?.({ ok: true, message: '엑셀을 내려받았습니다 — ' + num(prnRows.length) + '줄' })
    } catch (e) {
      onDone?.({ ok: false, message: '엑셀을 만들지 못했습니다: ' + (e && e.message ? e.message : String(e)) })
    }
  }
  const s = p ? p.summary : null
  const as = p ? applySummary(p.rows, finalPicked) : null

  /* ★★ 쪽 나눔 — 화면 밖에 한 벌 그려 **줄 높이를 재고** 끊는다.
       크롬·엣지는 @page 여백 상자(@bottom-right{content:counter(page)})를 **지원하지 않아**
       CSS 만으로는 쪽 번호를 못 적는다. 병동 인쇄(.wp-page)와 같은 길이다.
     ★ 재기가 어긋나도 break-inside:avoid 가 받쳐 주므로 **줄이 잘리지는 않는다.**
     ★ 「인쇄」를 누를 때만 잰다 — 창이 떠 있는 내내 재면 괜히 다시 그려진다. */
  function measurePages() {
    const el = prnRef.current
    if (!el) return null
    const H = PRINT_CONTENT_H_MM * MM_PX
    const hOf = sel => { const x = el.querySelector(sel); return x ? x.getBoundingClientRect().height : 0 }
    /* ★★ 서명 칸도 table 이다 — 이름(.up-main)을 따로 주지 않으면 **서명 줄까지 세어**
         줄이 하나 더 있는 줄 알고 없는 줄을 찾다 터진다(향정 인쇄 np-main 과 같은 처리).
         2026-11-13 에 실제로 겪었다: 42줄인데 43으로 세어 42번째에서 멈췄다. */
    const headH = hOf('.up-main thead'), titleH = hOf('.up-title'), footH = hOf('.up-ft'), signH = hOf('.up-sign')
    const trs = [...el.querySelectorAll('.up-main tbody tr')].map(x => x.getBoundingClientRect().height)
    /* ★★ 서명 칸 자리를 **모든 쪽에서 미리 뺀다.** 마지막 쪽에만 빼려 하면
         어느 쪽이 마지막인지 끝나야 알 수 있어, 그 쪽이 종이를 넘겨 버린다
         (2026-11-13 실측: 안 빼니 2쪽이 199.9mm 로 190mm 를 넘었다). */
    const out = []; let cur = []; let used = titleH + headH + footH + signH
    for (let i = 0; i < trs.length; i++) {
      if (used + trs[i] > H && cur.length) { out.push(cur); cur = []; used = headH + footH + signH }
      cur.push(i); used += trs[i]
    }
    if (cur.length) out.push(cur)
    return out
  }
  /* 쪽을 나눠 **그려 놓은 뒤에** 인쇄 창을 연다 — flushSync 가 그 차례를 지킨다 */
  function doPrint() {
    const pages = measurePages()
    /* 쪽을 나눠 **그려 놓고** 인쇄 규칙을 문서에 넣은 **뒤에** 인쇄 창을 연다 */
    flushSync(() => { if (pages) setPrnPages(pages); setPrinting(true) })
    /* ★ 끝나면 규칙을 **반드시** 뺀다 — 남겨 두면 다른 화면 인쇄까지 가로로 바뀐다.
         ★ 뒤늦게 빼는 받침(setTimeout)은 두지 않는다 — 브라우저가 인쇄를 그리기 전에
           빼 버리면 **앱이 그대로 찍힌다.** */
    const off = () => { setPrinting(false); window.removeEventListener('afterprint', off); offRef.current = null }
    offRef.current = off
    window.addEventListener('afterprint', off)
    window.print()
  }

  const prnTitle = <div className="up-title">
    <div className="up-h">3개월 출고 0 재고 실사 리스트</div>
    <div className="up-m">
      {org ? org + '  ·  ' : ''}출력 {new Date().toLocaleString('ko-KR', { hour12: false })}
      {'  ·  '}기준 최근 마감 {year}년 {month}월{'  ·  '}모두 {num(prnRows.length)}줄
    </div>
  </div>

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
        {/* ★ 누를 수 있는 칩은 **이것 하나뿐**이다(2026-11-13 이정화 님 승인).
             눌림 모양은 재고현황 「급변」 단추와 **같은 꼴** — 테두리 + 같은 색 18%.
             ★ 새 색을 만들지 않는다: t.amberL·t.amber 는 이미 쓰던 색이고
               t.amber + '18' 은 그 주황을 옅게 쓴 것이다(App.jsx 와 같은 방식).
             ★ 안 눌렸을 때도 테두리 자리를 비워 둔다 — 누를 때 칩이 들썩이지 않게. */}
        <button type="button" onClick={() => changeNote(zeroOnly ? null : 'zero')} aria-pressed={zeroOnly}
          title={zeroOnly ? '모두 보기' : '이 약만 보기'}
          style={{ padding: '3px 10px', borderRadius: 8, fontSize: 10, whiteSpace: 'nowrap',
            cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            border: '1px solid ' + (zeroOnly ? t.amber : 'transparent'),
            background: zeroOnly ? t.amber + '18' : t.amberL,
            color: t.amber, fontWeight: zeroOnly ? 700 : 600 }}>
          {'3개월 출고 0 ' + s.zero + '종'}
        </button>
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

      {/* ★ 걸러서 안 보이게 된 체크를 **말해 준다** — 「적용」은 체크한 모두에 들어간다.
           2026-11-13 이정화 님이 정한 문구 그대로. 숨은 체크가 있을 때만 뜬다. */}
      {hiddenPicked > 0 && <div style={{ background: t.amberL, border: `1px solid ${t.border}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 12, color: t.amber, marginBottom: 10 }}>
        체크한 {finalPicked.size}종 중 {hiddenPicked}종이 지금 안 보입니다 · 「적용」을 누르면 체크한 {finalPicked.size}종 모두 바뀝니다
      </div>}

      {!ready && !err && <div style={{ padding: '28px 0', textAlign: 'center', color: t.textL, fontSize: 12 }}>거래를 읽는 중…</div>}

      {/* ★ 「3개월 출고 0」으로 걸렀을 때만 나온다 — 칩이든 비고 메뉴든 같은 상태(noteF)다.
           단추 모양은 보고서 화면의 「엑셀」·「인쇄」와 **같은 값**이다(글자만·아이콘 없음·새 색 없음). */}
      {ready && zeroPicked && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <button onClick={dlXlsx} title="지금 보이는 줄을 엑셀로 내려받습니다" style={{ padding: '6px 14px', borderRadius: 8,
          border: `1px solid ${t.green}`, background: t.greenL, color: t.green,
          cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>엑셀</button>
        <button onClick={doPrint} title="지금 보이는 줄을 A4 가로로 인쇄합니다" style={{ padding: '6px 14px', borderRadius: 8,
          border: `1px solid ${t.blue}`, background: t.blueL, color: t.blue,
          cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>인쇄</button>
      </div>}

      {ready && <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left' }}>
          <thead><tr>
            <th style={{ ...th, width: 34 }} aria-label="고르기" />
            {[['name', '약품', th], ['n3', '직전3개월', thR], ['n1', '직전1개월', thR],
              ['nm', '월평균', thR], ['nsf', '안전재고', thR], ['after', '상태', th]].map(([k, lab, stl]) =>
              <th key={k} style={stl}>
                <HeadMenu colKey={k} label={lab} sk={sortTbl.sk} sd={sortTbl.sd} setSort={sortTbl.setSort} />
              </th>)}
            {/* ★ 비고 칸은 **너비를 정해 둔다** — 뱃지가 둘·셋이어도 이 칸 안에서만
                 줄바꿈하고, **약품 칸 너비는 그대로**다(2026-11-13 이정화 님 승인 ㉡안). */}
            <th style={{ ...th, ...noteCell }}>
              <HeadMenu colKey="note" label="비고" sk={sortTbl.sk} sd={sortTbl.sd} setSort={sortTbl.setSort}
                filter={{ items: noteItems, value: noteLabelOf(noteF), on: v => changeNote(v ? noteKeyOf(v) : null) }} />
            </th>
          </tr></thead>
          <tbody>
            {sortRows(shown, sortTbl).map(r => (
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
                <td style={{ ...td, ...noteCell }}>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {noteHit(r).map(d => <span key={d.k}>{badge(d.label, d.bg, d.fg)}</span>)}
                  </span>
                </td>
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
            () => setConfirming(true), applying || !ready || finalPicked.size === 0 || !!err || !!cutMsg)}
        </span>
      </div>
    </div>

    {/* 클릭을 여기서 멈춘다 — 이 바깥 덮개에는 onClick={onClose} 가 걸려 있다.
        ★ 단정하지 말 것: 진짜 CountConfirmModal 로 재어 보니 **이것만으로는 창이
          닫히지 않았다**(UsageCompareClose.test.jsx). 2026-11-10 의 「적용했는데
          0건」의 원인은 **아직 못 찾았다.** 이 한 줄은 그 가설을 막아 두는 빗장일 뿐,
          원인 규명이 아니다. 원인은 onDone 이 남기는 띠로 다음 번에 잡는다. */}
    {/* ★★ 인쇄할 표 — **body 바로 밑**으로 내보낸다(createPortal).
           이 창은 덮개 위에 뜨는 모달이라 그대로 찍으면 검은 덮개까지 인쇄된다.
           화면에는 안 보이고 **종이에만** 나온다. */}
    {ready && zeroPicked && createPortal(<>
      <style>{UC_PRINT_CSS}</style>
      {printing ? <style>{UC_PRINT_ON_CSS}</style> : null}
      {/* 재는 자리 — 화면 밖에 한 벌 그려 높이만 잰다. 인쇄에는 안 나온다. */}
      <div ref={prnRef} className="uc-pr uc-print-measure" aria-hidden="true">
        {prnTitle}
        <table className="up-main"><PrnCols /><PrnHead /><tbody>{prnRows.map(r => <PrnRow key={r.code} r={r} />)}</tbody></table>
        <PrnSign />
        <div className="up-ft">1 / 1</div>
      </div>
      <div className="uc-pr uc-print">
        {(prnPages || [prnRows.map((_, i) => i)]).map((idx, pi, all) => (
          <section className="up-page" key={pi}>
            {pi === 0 ? prnTitle : null}
            <table className="up-main"><PrnCols /><PrnHead />
              <tbody>{idx.map(i => <PrnRow key={prnRows[i].code} r={prnRows[i]} />)}</tbody></table>
            {pi === all.length - 1 ? <PrnSign /> : null}
            <div className="up-ft">{pi + 1} / {all.length}</div>
          </section>
        ))}
      </div>
    </>, document.body)}

    {confirming && Confirm && <div onClick={e => e.stopPropagation()}><Confirm t={t} title="사용량 적용"
      tone={t.accent} escClose focusCancel
      head={`${year}년 ${month}월 마감 기준으로 ${finalPicked.size}종을 저장합니다.`}
      body={as ? `안전재고 ${as.safety}종 · 재고 상태 ${as.stat}종이 바뀝니다 (나빠지는 쪽 ${as.worse}종).\n`
        + `전년 사용량은 건드리지 않습니다. 극소량 ${as.tiny}종은 직전1개월만 바뀌고 3개월·안전재고는 그대로입니다.` : ''}
      confirm="적용" busy={applying}
      onClose={() => setConfirming(false)} onConfirm={apply} /></div>}
  </div>
}
