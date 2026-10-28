/* ═══════════════════════════════════════════════════════════════════════════
   수요조사 명단 내려받기 — 엑셀 · PDF

   ★ 라이브러리는 **버튼을 누를 때만** 동적 import 한다. 한글 글꼴도 그때 fetch 한다.
     그래서 평소 메인 번들에는 jspdf·xlsx·글꼴이 들어가지 않는다.

   ★ audit INSERT 가 성공한 **뒤에만** 호출부가 이 함수를 부른다(지시).
     이 파일은 기록을 남기지 않는다 — 기록과 생성을 한 함수에 섞으면
     「기록은 실패했는데 파일은 나갔다」가 생긴다.

   ★ 엑셀은 기존 xlsx@0.18.5(SheetJS 커뮤니티판)를 그대로 쓴다.
     첫 줄 고정(freeze)은 **이 판으로 쓸 수 없다**(실측: !freeze 가 파일에 기록되지 않음).
     열 너비(!cols)·SUM 수식·두 시트는 그대로 쓴다.
   ★ 신청번호·사번은 **문자열 셀**로 쓴다(t:'s') — 앞자리 0 과 지수 표기를 막는다.

   ★ PDF 는 A4 가로. 희망일마다 쪽을 나누고 날짜별 소계를 붙인다.
     글꼴은 public/fonts 의 Noto Sans KR 부분집합(2.67MB)을 쓴다.
   ═══════════════════════════════════════════════════════════════════════════ */
/* ★ 확장자를 적는다 — Vite 는 둘 다 받지만, 확장자가 없으면 **순수 Node 에서 해석되지 않는다**.
   scripts/sample_survey_export.mjs 가 이 모듈을 그대로 불러 견본 파일을 만든다. */
import { doseOf, doneOf, maskEmpNo, maskName, byDateSummary } from './surveyCalc.js'

const FOOT_NOTE = '업무용 · 사용 후 파기'
const COPYRIGHT = 'Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.'
const FONT_URL = '/fonts/NotoSansKR-Regular-subset.ttf'
const FONT_NAME = 'NotoSansKR'

/* 파일 이름 — 개인정보를 넣지 않는다 */
export function fileName(survey, ext) {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  const ymd = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
  const safe = s => String(s ?? '').replace(/[\\/:*?"<>|]/g, '_')
  return `수요조사_${safe(survey?.title)}_${safe(survey?.season)}_${ymd}.${ext}`
}

function stamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 명단 열 — 엑셀·PDF 가 같은 순서를 쓴다 */
const HEAD = ['신청번호', '사번', '성명', '본인', '가족 수', '도즈', '희망일', '상태', '접종 완료', '비고']

/* raw=true 면 성명·사번 원문. 파기된 회차는 원문 자리가 비어 있다(DB 가 이미 지웠다). */
function rowOf(r, raw) {
  return [
    String(r.receipt_code || ''),
    raw ? (r.emp_no || '—') : maskEmpNo(r.emp_no),
    raw ? (r.name || '—') : maskName(r.name),
    r.self_dose ? 'O' : '—',
    Number(r.family_count || 0),
    doseOf(r),
    String(r.wish_date || ''),
    r.status === 'cancelled' ? '취소' : '신청',
    doneOf(r),
    '',
  ]
}

/* ── 엑셀 ──────────────────────────────────────────────────────────────── */
/* ★ 「만들기(buildWorkbook)」와 「저장(exportXlsx)」을 나눈다 — 저장은 브라우저 동작이라
   단위 시험에서 부를 수 없다. 구조를 시험하려면 buildWorkbook 을 쓴다. */
export async function buildWorkbook({ survey, rows, user, raw = true }) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  /* 시트 1 — 명단. 맨 위 3줄은 회차·출력 정보, 그 아래 표, 맨 아래 SUM */
  const top = [
    [`${survey.title} (${survey.season})`],
    [`출력 ${stamp()} · 출력자 ${user || '—'}`],
    [FOOT_NOTE],
    [],
  ]
  const body = rows.map(r => rowOf(r, raw))
  const aoa = [...top, HEAD, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  const headRow = top.length + 1              /* 1-based */
  const first = headRow + 1
  const last = headRow + body.length
  /* 합계 줄 — 값이 아니라 SUM 수식으로 둔다(Excel 2016 호환 · 값과 SUM 만 사용) */
  if (body.length) {
    const sumRow = last + 1
    const put = (col, formula) => { ws[col + sumRow] = { t: 'n', f: formula } }
    XLSX.utils.sheet_add_aoa(ws, [['합계']], { origin: 'A' + sumRow })
    put('E', `SUM(E${first}:E${last})`)       /* 가족 수 */
    put('F', `SUM(F${first}:F${last})`)       /* 도즈 */
    put('I', `SUM(I${first}:I${last})`)       /* 접종 완료 */
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sumRow - 1, c: HEAD.length - 1 } })
  }
  /* ★ 신청번호(A)·사번(B)·희망일(G) 을 문자열 셀로 — 앞자리 0 과 날짜 자동변환을 막는다 */
  for (let i = 0; i < body.length; i++) {
    const r = first + i
    for (const col of ['A', 'B', 'G']) {
      const cell = ws[col + r]
      if (cell) { cell.t = 's'; cell.v = String(cell.v ?? '') }
    }
  }
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 6 }, { wch: 8 },
    { wch: 7 }, { wch: 13 }, { wch: 7 }, { wch: 10 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ws, '명단')

  /* 시트 2 — 날짜별 집계 */
  const sum = byDateSummary(rows)
  const aoa2 = [
    [`${survey.title} (${survey.season}) · 날짜별 집계`],
    [`출력 ${stamp()} · 출력자 ${user || '—'}`],
    [],
    ['희망일', '신청 인원', '신청 도즈', '접종 완료', '취소'],
    ...sum.map(s => [s.date, s.people, s.dose, s.done, s.cancelled]),
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2)
  if (sum.length) {
    const f = 5, l = 4 + sum.length, sr = l + 1
    XLSX.utils.sheet_add_aoa(ws2, [['합계']], { origin: 'A' + sr })
    for (const col of ['B', 'C', 'D', 'E']) ws2[col + sr] = { t: 'n', f: `SUM(${col}${f}:${col}${l})` }
    ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sr - 1, c: 4 } })
    for (let i = 0; i < sum.length; i++) {
      const cell = ws2['A' + (f + i)]
      if (cell) { cell.t = 's'; cell.v = String(cell.v ?? '') }
    }
  }
  ws2['!cols'] = [{ wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, ws2, '날짜별 집계')
  return wb
}

export async function exportXlsx(args) {
  const XLSX = await import('xlsx')
  const wb = await buildWorkbook(args)
  XLSX.writeFile(wb, fileName(args.survey, 'xlsx'))
}

/* ── PDF ───────────────────────────────────────────────────────────────── */
let fontCache = null       /* base64 — 한 번 받으면 세션 동안 다시 받지 않는다 */

async function loadFont() {
  if (fontCache) return fontCache
  const r = await fetch(FONT_URL)
  if (!r.ok) throw new Error('글꼴을 불러오지 못했습니다 (' + r.status + ')')
  const buf = await r.arrayBuffer()
  /* ArrayBuffer → base64. 큰 파일이라 한 번에 String.fromCharCode 하면 스택이 넘친다 */
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  fontCache = btoa(s)
  return fontCache
}

/* fontB64 를 넘기면 그걸 쓴다 — 단위 시험이 로컬 파일을 읽어 넘길 수 있게 하려는 것이다.
   브라우저에서는 생략하면 /fonts 에서 fetch 한다. */
export async function buildPdf({ survey, rows, user, raw = true, fontB64: injected }) {
  const [{ jsPDF }, autoTableMod, fontB64] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    injected ? Promise.resolve(injected) : loadFont(),
  ])
  const autoTable = autoTableMod.default || autoTableMod

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('NotoSansKR.ttf', fontB64)
  doc.addFont('NotoSansKR.ttf', FONT_NAME, 'normal')
  doc.setFont(FONT_NAME, 'normal')

  /* 희망일별로 묶고 날짜순으로 쪽을 나눈다 */
  const groups = new Map()
  for (const r of rows) {
    const d = String(r.wish_date || '(미정)')
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d).push(r)
  }
  const dates = [...groups.keys()].sort()
  const when = stamp()
  const total = dates.length || 1

  dates.forEach((d, i) => {
    if (i > 0) doc.addPage()
    const list = groups.get(d)

    /* 머리말 */
    doc.setFontSize(13)
    doc.text(`${survey.title} (${survey.season}) · 희망일 ${d}`, 14, 13)
    doc.setFontSize(8.5)
    doc.text(`출력 ${when} · 출력자 ${user || '—'}`, 14, 19)

    autoTable(doc, {
      startY: 23,
      /* ★ fontStyle 을 normal 로 고정한다 — bold 를 쓰면 글꼴을 두 번 임베드해
         PDF 가 두 배로 커진다(Regular 만 서브셋했다). 머리글 강조는 바탕색으로 한다. */
      styles: { font: FONT_NAME, fontStyle: 'normal', fontSize: 8, cellPadding: 1.4 },
      headStyles: { font: FONT_NAME, fontStyle: 'normal', fillColor: [128, 74, 135], textColor: 255 },
      /* 손으로 체크하는 칸 — 비고 열을 넓게 비워 둔다 */
      columnStyles: { 9: { cellWidth: 40 } },
      head: [HEAD],
      body: list.map(r => rowOf(r, raw)),
      margin: { left: 14, right: 14 },
    })

    /* 날짜별 소계 */
    const people = list.filter(r => r.status !== 'cancelled').length
    const dose = list.filter(r => r.status !== 'cancelled').reduce((s, r) => s + doseOf(r), 0)
    const done = list.reduce((s, r) => s + doneOf(r), 0)
    let y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(9)
    doc.text(`${d} 소계 — 인원 ${people}명 · 도즈 ${dose}회분 · 접종 완료 ${done}`, 14, y)

    /* 바닥글 */
    const h = doc.internal.pageSize.getHeight()
    doc.setFontSize(8)
    doc.text(FOOT_NOTE, 14, h - 12)
    doc.text(`${i + 1} / ${total}`, doc.internal.pageSize.getWidth() - 14, h - 12, { align: 'right' })
    doc.text(COPYRIGHT, 14, h - 7)
  })

  if (!dates.length) {
    doc.setFontSize(12)
    doc.text('신청이 없습니다', 14, 20)
    const h = doc.internal.pageSize.getHeight()
    doc.setFontSize(8)
    doc.text(FOOT_NOTE, 14, h - 12)
    doc.text(COPYRIGHT, 14, h - 7)
  }

  return doc
}

export async function exportPdf(args) {
  const doc = await buildPdf(args)
  doc.save(fileName(args.survey, 'pdf'))
}
