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

   ★ PDF 는 A4 가로이고 **한 목록**이다(2026-10-28 변경).
     희망일마다 새 쪽을 만들지 않는다 — 날짜가 바뀌는 곳에 구분 행을, 그 날짜 끝에 소계 행을
     넣고, 쪽은 종이가 찰 때만 넘어간다. 맨 끝에 전체 합계 행.
     글꼴은 public/fonts 의 Noto Sans KR 부분집합(2.67MB)을 쓴다.
   ═══════════════════════════════════════════════════════════════════════════ */
/* ★ 확장자를 적는다 — Vite 는 둘 다 받지만, 확장자가 없으면 **순수 Node 에서 해석되지 않는다**.
   scripts/sample_survey_export.mjs 가 이 모듈을 그대로 불러 견본 파일을 만든다. */
import { doseOf, doneOf, maskEmpNo, maskName, byDateSummary, dupNameKeys, rowNote } from './surveyCalc.js'

const FOOT_NOTE = '업무용 · 사용 후 파기'
const COPYRIGHT = '© 2026 JEONGHWALEE. All rights reserved. 무단 복제 및 재배포를 금지합니다.'
const FONT_URL = '/fonts/NotoSansKR-Regular-subset.ttf'
const FONT_NAME = 'NotoSansKR'
/* 출력자 — 사람 이름·메일을 넣지 않는다(문서가 밖으로 나갈 수 있다). 부서로 고정한다. */
const ISSUER = '약제과'

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

/* 명단 열 — 엑셀·PDF 가 같은 순서를 쓴다.
   ★ PDF 에만 맨 오른쪽 「확인」 열을 하나 더 붙인다(손 체크용 빈칸). 엑셀에는 넣지 않는다. */
const HEAD = ['신청번호', '사번', '성명', '소속', '본인 접종', '가족 접종 인원',
  '신청 수량(도즈)', '접종 희망일', '신청 상태', '접종 완료', '확인 사항']
const HEAD_PDF = [...HEAD, '확인']
const NCOL_PDF = HEAD_PDF.length
const CHECK_COL = NCOL_PDF - 1   /* 맨 오른쪽 「확인」 열 */
const CHECK_MM = 3.5             /* 확인 네모 한 변(mm) — 행 높이 약 5.6mm 안에 들어간다 */

/* raw=true 면 성명·사번 원문. 파기된 회차는 원문 자리가 비어 있다(DB 가 이미 지웠다).
   note = 비고(행 단위 자동 표기) — surveyCalc.rowNote() 가 만든 값을 그대로 받는다. */
function rowOf(r, raw, note) {
  return [
    String(r.receipt_code || ''),
    raw ? (r.emp_no || '—') : maskEmpNo(r.emp_no),
    raw ? (r.name || '—') : maskName(r.name),
    r.dept || '—',
    r.self_dose ? 'O' : '—',
    Number(r.family_count || 0),
    doseOf(r),
    String(r.wish_date || ''),
    r.status === 'cancelled' ? '취소' : '신청',
    doneOf(r),
    note || '',
  ]
}

/* 날짜 묶음 — 희망일 오름차순. 취소도 그 날짜 안에 남긴다(상태 열로 구별). */
function groupByDate(rows) {
  const m = new Map()
  for (const r of rows) {
    const d = String(r.wish_date || '(미정)')
    if (!m.has(d)) m.set(d, [])
    m.get(d).push(r)
  }
  return [...m.keys()].sort().map(date => ({ date, list: m.get(date) }))
}

/* 소계·합계 — 취소는 인원·도즈에서 빼고, 체크 합은 전부 센다(byDateSummary 와 같은 규칙) */
function totalsOf(list) {
  const live = list.filter(r => r.status !== 'cancelled')
  return {
    people: live.length,
    dose: live.reduce((s, r) => s + doseOf(r), 0),
    done: list.reduce((s, r) => s + doneOf(r), 0),
  }
}

/* ── 엑셀 ──────────────────────────────────────────────────────────────── */
/* ★ 「만들기(buildWorkbook)」와 「저장(exportXlsx)」을 나눈다 — 저장은 브라우저 동작이라
   단위 시험에서 부를 수 없다. 구조를 시험하려면 buildWorkbook 을 쓴다. */
export async function buildWorkbook({ survey, rows, allRows, user = ISSUER, raw = true }) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  /* 시트 1 — 명단. 맨 위 3줄은 회차·출력 정보, 그 아래 표, 맨 아래 SUM */
  const top = [
    [`${survey.title} (${survey.season})`],
    [`출력 ${stamp()} · 출력자 ${user || ISSUER}`],
    [FOOT_NOTE],
    [],
  ]
  /* 비고 — PDF 와 **같은 함수**를 쓴다. 중복 판정은 회차 전체 응답으로 한다 */
  const dupKeys = dupNameKeys(allRows || rows)
  const body = rows.map(r => rowOf(r, raw, rowNote(r, dupKeys)))
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
  /* ★ 소속이 성명 다음에 들어가 열이 10 → 11 로 늘었다 — 폭도 함께 늘린다 */
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 6 }, { wch: 8 },
    { wch: 7 }, { wch: 13 }, { wch: 7 }, { wch: 10 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ws, '명단')

  /* 시트 2 — 날짜별 집계 */
  const sum = byDateSummary(rows)
  const aoa2 = [
    [`${survey.title} (${survey.season}) · 날짜별 집계`],
    [`출력 ${stamp()} · 출력자 ${user || ISSUER}`],
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
/* 내부 — 문서와 **배치 정보**를 함께 돌려준다. 시험이 고아 방지를 직접 확인할 수 있게 하려는 것이다. */
async function composePdf({ survey, rows, allRows, user = ISSUER, raw = true, fontB64: injected }) {
  const [{ jsPDF }, autoTableMod, fontB64] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    injected ? Promise.resolve(injected) : loadFont(),
  ])
  const autoTable = autoTableMod.default || autoTableMod

  const when = stamp()
  const title = `${survey.title} (${survey.season})`
  /* ★ 비고의 이름 중복 판정은 **회차 전체 응답**으로 한다 — allRows 를 주면 그걸,
     없으면 rows 를 쓴다. 화면 필터로 1건만 보여도 중복이면 표시해야 한다. */
  const dupKeys = dupNameKeys(allRows || rows)

  /* ── 본문 구성 — 한 목록. 날짜가 바뀌는 곳에 구분 행, 날짜 끝에 소계 행, 맨 끝에 합계 행 ── */
  const SEP = 'sep', SUB = 'sub', TOT = 'tot'
  const kinds = []          /* body 각 행의 종류 — 고아 판정과 칸 모양에 쓴다 */
  const body = []
  const bandCell = (text, kind) => ({
    content: text, colSpan: NCOL_PDF,
    styles: kind === SEP
      ? { fillColor: [238, 232, 243], textColor: [46, 74, 98], fontSize: 8.5, halign: 'left' }
      : { fillColor: [245, 245, 245], textColor: [46, 74, 98], fontSize: 8, halign: 'right' },
  })
  for (const g of groupByDate(rows)) {
    body.push([bandCell(`희망일 ${g.date}`, SEP)]); kinds.push(SEP)
    for (const r of g.list) { body.push([...rowOf(r, raw, rowNote(r, dupKeys)), '']); kinds.push(null) }
    const t = totalsOf(g.list)
    body.push([bandCell(`소계 ${t.people}명 · ${t.dose}도즈 · 접종 완료 ${t.done}`, SUB)]); kinds.push(SUB)
  }
  if (body.length) {
    const a = totalsOf(rows)
    body.push([bandCell(`전체 합계 ${a.people}명 · ${a.dose}도즈 · 접종 완료 ${a.done}`, TOT)]); kinds.push(TOT)
  }

  /* ── 표 설정 — 색·글꼴·보라 머리는 그대로 ── */
  const tableOpts = {
    /* ★ fontStyle 을 normal 로 고정한다 — bold 를 쓰면 글꼴을 두 번 임베드해
       PDF 가 두 배로 커진다(Regular 만 서브셋했다). 머리글 강조는 바탕색으로 한다. */
    styles: { font: FONT_NAME, fontStyle: 'normal', fontSize: 8, cellPadding: 1.4 },
    headStyles: { font: FONT_NAME, fontStyle: 'normal', fillColor: [128, 74, 135], textColor: 255 },
    /* 비고는 내용에 맞게(22), 확인은 좁게(12) — 확인 칸의 **글자는 빈 문자열**이다.
       ※ 글꼴 부분집합에 ☐(U+2610)·□(U+25A1)가 없다(cmap 확인). 글자로 넣으면 네모로 깨지므로
         글꼴을 건드리지 않고 didDrawCell 에서 네모를 **선으로 그린다**. */
    /* ★ 소속이 끼면서 비고·확인 열 번호가 하나씩 밀렸다(9·10 → 10·11) */
    columnStyles: { 10: { cellWidth: 22 }, 11: { cellWidth: 12, halign: 'center' } },
    head: [HEAD_PDF],
    margin: { left: 14, right: 14, top: 23, bottom: 18 },
    showHead: 'everyPage',      /* 표 머리를 매 쪽 반복 — 기본값이지만 뜻을 적어 둔다 */
    rowPageBreak: 'avoid',      /* 한 행이 쪽을 가로질러 쪼개지지 않게 */
  }

  /* ── 한 번 그리기 — breaks 에 든 body 인덱스에서 쪽을 강제로 끊는다 ──
     여러 번 autoTable 을 부르지만 각 조각이 **쪽 머리에서 시작**하므로 한 목록처럼 이어진다. */
  function renderInto(target, breaks) {
    const cuts = [0, ...[...breaks].sort((a, b) => a - b), body.length]
      .filter((v, i, arr) => i === 0 || v !== arr[i - 1])
    const pageOf = new Array(body.length).fill(0)
    const boxes = []          /* 확인 칸에 그린 네모 — 데이터 행 수와 같아야 한다(시험용) */
    for (let ci = 0; ci + 1 < cuts.length; ci++) {
      const from = cuts[ci], to = cuts[ci + 1]
      if (from >= to) continue
      if (ci > 0) target.addPage()
      autoTable(target, {
        ...tableOpts,
        startY: 23,
        body: body.slice(from, to),
        didDrawPage: () => { drawHeaderOn(target) },
        didDrawCell: d => {
          if (d.section !== 'body') return
          const bi = from + d.row.index
          if (d.column.index === 0) pageOf[bi] = d.pageNumber
          /* ★ 확인 칸의 네모 — 글꼴에 ☐ 가 없어 선으로 그린다.
             띠 행(구분·소계·합계)은 colSpan 한 칸이라 열 10 이 아예 없으므로 자연히 빠지지만,
             뜻을 분명히 하려고 kinds 로도 한 번 더 막는다. */
          if (d.column.index !== CHECK_COL || kinds[bi] !== null) return
          const tc = d.cell.styles.textColor
          const c = Array.isArray(tc) ? tc : [tc, tc, tc]
          const x = d.cell.x + (d.cell.width - CHECK_MM) / 2
          const y = d.cell.y + (d.cell.height - CHECK_MM) / 2
          const lw = target.getLineWidth()
          target.setLineWidth(0.2)
          target.setDrawColor(c[0], c[1], c[2])
          target.rect(x, y, CHECK_MM, CHECK_MM)
          target.setLineWidth(lw)
          boxes.push({ page: d.pageNumber, row: bi })
        },
      })
    }
    return { pageOf, boxes }
  }
  function drawHeaderOn(target) {
    target.setFont(FONT_NAME, 'normal')
    target.setFontSize(13)
    target.text(title, 14, 13)
    target.setFontSize(8.5)
    target.text(`출력 ${when} · 출력자 ${user || ISSUER}`, 14, 19)
  }

  /* ── 고아 방지 — 구분 행이 쪽 맨 아래 혼자 남지 않게 ──
     전용 옵션이 없으므로 **측정 후 끊기**로 한다: 버리는 문서에 한 번 그려 각 행이 몇 쪽에
     떨어지는지 보고, 구분 행 바로 다음 행이 다음 쪽으로 넘어갔으면 그 구분 행 앞에서 끊는다.
     옮긴 구분 행은 쪽 머리로 가므로 반복이 수렴한다(보통 1~2회). */
  const breaks = new Set()
  if (body.length) {
    for (let iter = 0; iter < 6; iter++) {
      const probe = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      probe.addFileToVFS('NotoSansKR.ttf', fontB64)
      probe.addFont('NotoSansKR.ttf', FONT_NAME, 'normal')
      probe.setFont(FONT_NAME, 'normal')
      const { pageOf } = renderInto(probe, breaks)
      let added = false
      for (let i = 0; i < kinds.length - 1; i++) {
        if (kinds[i] !== SEP) continue
        if (pageOf[i + 1] > pageOf[i] && !breaks.has(i)) { breaks.add(i); added = true }
      }
      if (!added) break
    }
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('NotoSansKR.ttf', fontB64)
  doc.addFont('NotoSansKR.ttf', FONT_NAME, 'normal')
  doc.setFont(FONT_NAME, 'normal')

  let pageOf = []
  let boxes = []
  if (!body.length) {
    drawHeaderOn(doc)
    doc.setFontSize(12)
    doc.text('신청이 없습니다', 14, 30)
  } else {
    ({ pageOf, boxes } = renderInto(doc, breaks))
  }

  /* ── 바닥글 — 쪽 번호를 실제 전체 쪽수로 찍으려면 표를 다 그린 뒤에 돌아야 한다 ── */
  const pages = doc.getNumberOfPages()
  const h = doc.internal.pageSize.getHeight()
  const w = doc.internal.pageSize.getWidth()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont(FONT_NAME, 'normal')
    doc.setFontSize(8)
    doc.text(FOOT_NOTE, 14, h - 12)
    doc.text(`${p} / ${pages}`, w - 14, h - 12, { align: 'right' })
    doc.text(COPYRIGHT, 14, h - 7)
  }
  doc.setPage(1)

  return { doc, pages, kinds, pageOf, boxes, breaks: [...breaks].sort((a, b) => a - b), body }
}

/* 문서만 필요할 때 */
export async function buildPdf(args) {
  return (await composePdf(args)).doc
}

/* 배치만 필요할 때(시험용) — 구분 행이 쪽 맨 아래 혼자 남지 않았는지 확인할 수 있다.
   orphans 가 비어 있어야 정상이다. */
export async function pdfLayout(args) {
  const { pages, kinds, pageOf, boxes, breaks, body } = await composePdf(args)
  const orphans = []
  for (let i = 0; i < kinds.length - 1; i++) {
    if (kinds[i] === 'sep' && pageOf[i + 1] > pageOf[i]) orphans.push(i)
  }
  /* ★ body 를 그대로 돌려준다 — 「머리글 칸 수 = 행 값 수」를 시험이 직접 셀 수 있게.
     2026-10-30 에 화면 쪽에서 이 어긋남이 실제로 났다(소속 열 누락). */
  return { pages, kinds, pageOf, boxes, breaks, orphans, bodyLen: body.length, body, head: HEAD_PDF }
}

export async function exportPdf(args) {
  const doc = await buildPdf(args)
  doc.save(fileName(args.survey, 'pdf'))
}
