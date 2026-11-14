/* A4 가로 인쇄 종이 — PR 461(「3개월 사용량 0」 실사 리스트)에서 **검증된 방식**을 공통으로 뺀 것.
 *
 * ★★ 왜 둘로 나누나 — @page 는 **선택자로 범위를 좁힐 수 없다.** 문서에 있기만 하면
 *   그 문서의 **모든 인쇄**에 걸린다. 2026-11-13 실측: 늘 띄워 두니 향정 인쇄 종이가
 *   216×279mm → 297×210mm 로 바뀌었다. 그래서
 *     · SHEET_CSS    — 모양 규칙. 늘 띄워 둬도 **다른 인쇄에 번지지 않는다.**
 *     · SHEET_ON_CSS — 종이를 가로로 바꾸고 앱을 숨기는 규칙. **「인쇄」를 누른 동안에만** 넣는다.
 *
 * ★ 쪽 번호는 **직접 나눠야** 적을 수 있다 — 크롬·엣지는 @page 여백 상자
 *   (@bottom-right{content:counter(page)})를 지원하지 않는다.
 *
 * ★ 쪽 높이를 고정하지 않는다 — 고정하면 1px만 넘쳐도 그 쪽이 다음 장으로 밀리고
 *   break-after 가 또 한 장을 만들어 **빈 장이 생긴다**(2026-11-13 실측).
 */

export const A4L_H_MM = 210
export const A4L_MARGIN_MM = 10
/* ★ 한 쪽에 담을 높이. 여유 8mm 를 둔다 — 재기는 바깥 여백(margin)을 세지 않아
     여유가 없으면 쪽이 종이보다 커진다(2026-11-13 실측: 여유 3mm 일 때 190mm 턱걸이). */
export const SHEET_CONTENT_H_MM = A4L_H_MM - A4L_MARGIN_MM * 2 - 8   /* 182mm */
export const MM_PX = 96 / 25.4

/* 늘 띄워 둬도 되는 쪽 — 모양만. 「ps-」로 시작하는 이름 안에서만 걸린다. */
export const SHEET_CSS = `
.ps-print{display:none}
.ps-measure{position:absolute;left:-99999px;top:0;width:${297 - A4L_MARGIN_MM * 2}mm}
@media print{
  .ps-measure{display:none!important}
}
.ps .ps-page{break-after:page;page-break-after:always}
.ps .ps-page:last-child{break-after:auto;page-break-after:auto}
.ps .ps-h{font-size:15pt;font-weight:700;margin:0 0 1.5mm;text-align:left}
.ps .ps-h::after{content:"";display:block;width:70mm;height:0;border-top:1.6pt solid #000;margin-top:1.2mm}
.ps .ps-m{font-size:8.5pt;line-height:1.5;margin:2.5mm 0 4mm;text-align:left}
.ps table{width:100%;border-collapse:collapse;table-layout:fixed}
.ps thead{display:table-header-group}
.ps tr{break-inside:avoid;page-break-inside:avoid}
/* ★ !important 를 붙인다 — 앱 전역 인쇄 CSS 에 th,td{padding:4px 6px!important;font-size:9px!important}
     가 있어서, 안 붙이면 **우리가 잰 크기와 다른 크기로 인쇄된다.** */
.ps th,.ps td{border:0.5pt solid #666;padding:0.8mm 2mm!important;font-size:9pt!important;line-height:1.15;vertical-align:middle}
.ps th{font-weight:700;border-bottom:3pt double #000;text-align:center}
/* ★ 칸마다 정렬을 직접 적는다 — #root{text-align:center} 가 전 화면에 상속된다(함정 #31) */
.ps .ps-l{text-align:left}
.ps .ps-r{text-align:right}
.ps .ps-c{text-align:center}
.ps .ps-name{font-size:8pt!important;word-break:keep-all;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* 네모 칸 — 종이에 손으로 표시하는 자리 */
.ps .ps-box{display:inline-block;border:0.5pt solid #000;border-radius:1pt;padding:0.2mm 1.2mm;font-size:7.5pt;margin-right:1.2mm;white-space:nowrap}
/* 서명 칸 — 향정 인쇄 np-sign 과 같은 모양 */
.ps .ps-sign{margin-top:8mm;font-size:9pt;width:auto}
.ps .ps-sign td{border:none;padding:0 6mm 0 0;white-space:nowrap}
.ps .ps-ft{padding-top:3mm;text-align:center;font-size:8.5pt}
`

/* 「인쇄」를 누른 동안에만 넣는 쪽 — 종이를 가로로 바꾸고 앱을 숨긴다 */
export const SHEET_ON_CSS = `
@media print{
  @page{size:A4 landscape;margin:${A4L_MARGIN_MM}mm}
  body>*:not(.ps-print){display:none!important}
  .ps-print{display:block!important;background:#fff!important;color:#000!important}
  .ps-print *{background:transparent!important;color:#000!important;box-shadow:none!important}
}`

/* 화면 밖에 그려 둔 한 벌을 재서 쪽을 나눈다.
   el = 재는 자리(.ps-measure) · 돌려주는 것 = [[줄번호…], …]
   ★ 표 이름(.ps-main)을 따로 본다 — 서명 칸도 table 이라, 안 가르면 **서명 줄까지 세어**
     없는 줄을 찾다 터진다(2026-11-13 실제로 겪음 · 향정 인쇄 np-main 과 같은 처리).
   ★ 서명 자리는 **모든 쪽에서 미리 뺀다** — 마지막 쪽에만 빼려 하면 그 쪽이 종이를 넘긴다. */
export function measureSheetPages(el, opts) {
  if (!el) return null
  const H = ((opts && opts.contentHmm) || SHEET_CONTENT_H_MM) * MM_PX
  const hOf = sel => { const x = el.querySelector(sel); return x ? x.getBoundingClientRect().height : 0 }
  const headH = hOf('.ps-main thead')
  const titleH = hOf('.ps-title')
  const footH = hOf('.ps-ft')
  const signH = hOf('.ps-sign')
  const trs = [...el.querySelectorAll('.ps-main tbody tr')].map(x => x.getBoundingClientRect().height)
  const out = []
  let cur = []
  let used = titleH + headH + footH + signH
  for (let i = 0; i < trs.length; i++) {
    if (used + trs[i] > H && cur.length) { out.push(cur); cur = []; used = headH + footH + signH }
    cur.push(i); used += trs[i]
  }
  if (cur.length) out.push(cur)
  return out
}

/* 오늘 YYYYMMDD — ★ toISOString() 은 UTC 라 한국 시각 자정 언저리에 하루가 밀린다.
   파일 이름에 쓰이므로 **그 지역 날짜**로 적는다. */
export function sheetYmd(now) {
  const d = now || new Date()
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
}
