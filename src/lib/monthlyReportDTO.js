/* 월간보고서 결산 엑셀 — 순수 변환 계층.
   화면 상태·supabase·exceljs 를 전혀 모른다. 조회 결과를 받아 「엑셀에 적을 값」만 만든다.

   ★ 왜 분리했나
     기존 다운로드(App.jsx dl)는 화면 필터(cats·stats·검색)를 거친 배열을 썼다. 그래서 상태 필터를
     한 번만 건드려도 금액 합이 달라졌다. 이 계층은 화면 상태를 받지 않으므로 그럴 수 없다.

   ★ 금액과 수량을 다르게 다룬다 — 섞으면 합계가 어긋난다
     · 금액: 원본값 그대로 담고, 반올림은 엑셀 표시 형식(#,##0)에 맡긴다.
       행마다 1원 단위로 반올림해 저장하면 531행에서 10원이 누적된다(기준 양식 실측).
     · 수량: 소수 둘째 자리에서 반올림한 값을 담는다(표시용). 금액은 스냅샷의 금액 칸에서
       그대로 오므로, 수량을 반올림해도 금액·합계는 영향받지 않는다. */

/* 마감월 금액의 유일한 출처. 월 총계·건수·유효기간은 monthly_report_totals,
   약품별 행은 monthly_snapshots — 둘을 섞지 않는다. */
export const CLOSED_SOURCE = { totals: 'monthly_report_totals', rows: 'monthly_snapshots' }

/* ── 수량 반올림 — 소수 둘째 자리, round half up ────────────────────────────
   잘라내기·내림이 아니다. 0.005 는 올라간다.

   ★ 2진 오차를 먼저 떨어뜨린다.
     1038.005 * 100 은 103800.49999999999 이 되어 그냥 반올림하면 **내려간다**.
     toPrecision(15) 로 한 번 정규화하면 103800.5 가 되어 올라간다.
     상수(1e-9 같은 눈가림 보정)를 더하지 않으므로 1038.564 가 잘못 올라가지도 않는다.
   ★ 부호는 마지막에 붙인다 → 음수는 절대값이 올라간다(-3.455 → -3.46). */
export function roundQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const norm = Number(n.toPrecision(15))          /* 12.219999999999999 → 12.22 */
  const sign = norm < 0 ? -1 : 1
  const scaled = Number((Math.abs(norm) * 100).toPrecision(15))
  return sign * Math.round(scaled) / 100          /* Math.round = 양수에서 half up */
}

/* ── 약품목록 행 선정 — 상태를 보지 않는다 ──────────────────────────────────
   「그달 입고·출고·폐기·반품이 1건이라도 있거나, 전월재고 또는 기말재고가 0이 아닌 약품」
   사용·휴면·중지에 같은 규칙을 적용한다.

   ★ 상태를 보지 않는 까닭 — 상태는 **지금** 값이고 결산은 **그달** 값이다.
     9월 마감 뒤 중지로 바꾼 약품을 상태로 걸러내면 그 약품의 전월재고금액이 합계에서
     사라진다(기준 양식에서 71,965원이 그렇게 빠져 있었다). 거래와 잔량으로만 고르면
     약품별 합이 월 총계와 일치한다. */
export function isListRow(r) {
  const nz = v => Number(v || 0) !== 0
  return nz(r.total_in_qty) || nz(r.total_out_qty) || nz(r.total_disp_qty) || nz(r.total_ret_qty)
    || nz(r.opening_qty) || nz(r.closing_qty)
}

/* ── 「관리 품목수」 판정 — 기말재고가 남아 있는 품목만 센다 ──────────────────
   2026-11-03 이정화 님 결정 A. **PDF·엑셀 요약·CSV 가 이 함수 하나를 쓴다.**

   ★ 왜 함수로 빼나 — 전에는 세 곳이 각자 셌다.
     · 인쇄: 화면 필터를 거친 배열에서 기말≠0 (상태·검색을 바꾸면 종이 숫자가 달라졌다)
     · 엑셀: 약품목록 행 수 (거래나 전월재고만 있어도 세어 10월 기준 10품목 더 많았다)
     그래서 같은 달 보고서인데 PDF 534 · 엑셀 544 로 갈렸다(2026-10 실측).

   ★ 약품목록(isListRow)과 다른 질문이다 — 목록에는 그달에 움직임이 있던 약품을 **다 싣고**,
     품목수는 그중 **재고가 남은 것**만 센다. 폐기로 0이 된 약품은 목록에 보이되 수에는 빠진다.

   ★ 키 이름 두 가지를 다 받는다 — 이 함수는 **세 군데**에서 불린다.
     · 스냅샷·live 행: `closing_qty` (스네이크)
     · DTO 가 만든 list 행: `closingQty` (카멜)
     한쪽만 보면 다른 쪽에서 **조용히 0 을 세고** 품목수가 0 이 된다(실제로 그랬다). */
export function isCountedItem(r) {
  const v = r.closing_qty != null ? r.closing_qty : r.closingQty
  return Number(v || 0) !== 0
}

/* 유효기한 오름차순(문자열 YYYY-MM-DD). 빈 값은 맨 뒤 — 기준 양식에는 빈 값이 없었으므로
   순서가 달라질 여지가 없고, 늘어난 행에 빈 값이 생기면 끝에 모인다.
   같은 날짜는 약품코드로 묶어 순서를 고정한다(같은 데이터 → 같은 파일). */
function byExpiry(a, b) {
  const ea = a.expiry || '', eb = b.expiry || ''
  if (ea !== eb) {
    if (!ea) return 1
    if (!eb) return -1
    return ea < eb ? -1 : 1
  }
  return String(a.code).localeCompare(String(b.code))
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/* 유효기한을 YYYY-MM-DD 글자로 ─────────────────────────────────────────────
   ★ 드라이버에 따라 Date 객체로 온다. 그때 String(v).slice(0,10) 을 하면
     「Fri Apr 02」가 되어 날짜가 아니라 요일이 들어간다(실제로 당했다).
   ★ toISOString() 도 쓰지 않는다 — 한국 시간 자정은 UTC 로 전날 15시라 하루가 밀린다.
     달력 값 그대로를 쓰려면 지역 시각 조각으로 맞춰야 한다. */
export function isoDate(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    const p = n => String(n).padStart(2, '0')
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate())
  }
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/* ── 본체 ───────────────────────────────────────────────────────────────────
   입력
     closed   그달이 마감되었나
     totals   monthly_report_totals 한 행(마감월) · 미마감월이면 null
     rows     약품별 행 — 마감월은 monthly_snapshots, 미마감월은 현재 데이터 집계
     drugs    약품 기본정보(이름·구분·유효기한·구입단가)
     live     미마감월 집계 보조값({ oa, da, ra, inCnt, outCnt, dispCnt, retCnt }) · 마감월이면 null
     expiry   유효기간 건수 4종(미마감월에만 쓴다)
     year/month, stamp(작성 시각 글자), copyright
   출력은 엑셀이 그대로 적을 수 있는 값뿐이다. */
export function buildMonthlyReportDTO(input) {
  const { closed, totals, rows, drugs, live, expiry, year, month, stamp, copyright } = input
  const dmap = new Map()
  for (const d of (drugs || [])) dmap.set(d.drug_code, d)

  const picked = (rows || []).filter(isListRow)
  const list = picked.map(r => {
    const d = dmap.get(r.drug_code) || {}
    const exp = isoDate(d.expiry_date)
    return {
      code: r.drug_code,
      name: d.drug_name || r.drug_name || r.drug_code,
      category: d.category || r.category || '-',
      /* 상태 — 엑셀 약품목록 O열. drugs.status 를 그대로 싣는다(사용·중지·휴면).
         ★ 이 값으로 **거르지 않는다**. 재고 0 이 된 중지 약품이 목록에 보이는 까닭을
           표에서 바로 알 수 있게 적어 두는 것뿐이다. 품목수 판정은 isCountedItem 이 한다. */
      status: d.status || r.status || '',
      /* 수량 — 표시용 반올림 */
      openingQty: roundQty(r.opening_qty),
      inQty: roundQty(r.total_in_qty),
      outQty: roundQty(r.total_out_qty),
      dispQty: roundQty(r.total_disp_qty),
      retQty: roundQty(r.total_ret_qty),
      closingQty: roundQty(r.closing_qty),
      /* 금액 — 원본값. 반올림하지 않는다 */
      openingAmount: num(r.opening_amount),
      inAmount: num(r.total_in_amount),
      outAmount: num(r.total_out_amount),
      closingAmount: num(r.closing_amount),
      expiry: exp,
    }
  }).sort(byExpiry)

  /* 월 총계 — 마감월은 사이드카, 미마감월은 집계값 */
  const sum = (k) => list.reduce((a, r) => a + r[k], 0)
  const opening = closed ? num(totals && totals.opening_amount) : num(live && live.oa)
  const inAmt = closed ? num(totals && totals.in_amount) : sum('inAmount')
  const outAmt = closed ? num(totals && totals.out_amount) : sum('outAmount')
  const dispAmt = closed ? num(totals && totals.disposal_amount) : num(live && live.da)
  const retAmt = closed ? num(totals && totals.return_amount) : num(live && live.ra)
  const closing = closed ? num(totals && totals.actual_closing) : sum('closingAmount')
  const cnt = (key, fallback) => closed
    ? num(totals && totals[key])
    : num(live && live[fallback])

  return {
    year, month, closed: !!closed,
    source: closed ? CLOSED_SOURCE : { totals: '현재 데이터 집계', rows: '현재 데이터 집계' },
    summary: {
      /* 관리 품목수 = **기말재고가 남은 품목 수**(isCountedItem) — PDF·CSV 와 같은 식이다.
         ★ 이미 마감된 달은 **사이드카에 적힌 결재본 숫자를 그대로** 쓴다
           (2026-11-03 이정화 님 결정 B). 1~9월은 마감 당시 전 약품 수가 적혀 있는데,
           그 숫자로 이미 결재가 끝났으므로 다시 뽑아도 같은 값이 나와야 한다.
           새 기준은 10월 마감부터 사이드카에 기록된다(runClose). */
      itemCount: (closed && totals && totals.item_count != null)
        ? num(totals.item_count)
        : list.filter(isCountedItem).length,
      opening, closing, delta: closing - opening,
      inCount: cnt('in_count', 'inCnt'), inAmount: inAmt,
      outCount: cnt('out_count', 'outCnt'), outAmount: outAmt,
      dispCount: cnt('disposal_count', 'dispCnt'), dispAmount: dispAmt,
      retCount: cnt('return_count', 'retCnt'), retAmount: retAmt,
      expExpired: closed ? num(totals && totals.exp_expired) : num(expiry && expiry.expired),
      expUrgent30: closed ? num(totals && totals.exp_urgent30) : num(expiry && expiry.urgent30),
      expCaution60: closed ? num(totals && totals.exp_caution60) : num(expiry && expiry.caution60),
      expCheck90: closed ? num(totals && totals.exp_check90) : num(expiry && expiry.check90),
    },
    list,
    stamp: stamp || '',
    copyright: copyright || '',
  }
}

/* 합계 대조용 — 시험과 실측 보고가 같은 식을 쓴다 */
export function listTotals(dto) {
  const s = k => dto.list.reduce((a, r) => a + r[k], 0)
  return {
    rows: dto.list.length,
    openingAmount: s('openingAmount'), inAmount: s('inAmount'),
    outAmount: s('outAmount'), closingAmount: s('closingAmount'),
  }
}
