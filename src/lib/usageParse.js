/* 사용량 파일 읽기 — 순수 함수만. xlsx·supabase·화면을 모른다.
   화면(UsageUploadModal)은 이 함수들을 쓰고, 시험은 여기만 보면 된다.

   ★ 왜 분리했나 — 지금 업로드 파서는 App.jsx 안에 섞여 있어(2266~2296) 시험할 수가 없다.
     그래서 「머리글이 2행에 있으면?」「같은 코드가 두 번 나오면?」 같은 것을 확인할 방법이 없었다.

   ★ 바뀌지 않는 것 — 월평균·안전재고 계산식은 여기 없다. 그건 DB(0108)와 App.jsx 가 그대로 쓴다. */

/* 약품코드 다듬기 — App.jsx 의 normDrugCode 와 **같은 규칙**이라야 매칭이 갈리지 않는다 */
export const normCode = v => String(v ?? '').trim().replace(/,/g, '').toUpperCase()

/* ── 머리글 줄 찾기 ──────────────────────────────────────────────────────
   「약품코드」가 들어 있는 첫 줄을 머리글로 본다(앞 10줄만 뒤진다).

   ★ 왜 필요한가 — 지금 파서는 **1행 고정**이다. 통합 파일처럼 위에 제목·기간이 적혀 있으면
     머리글을 못 찾아 그 파일 전체가 통째로 빈 결과가 된다(조용히 0건).
   ★ 왜 10줄인가 — 더 깊이 뒤지면 머리글이 아닌 줄을 머리글로 오해할 위험이 커진다.
     실제 양식은 많아야 서너 줄 위에 제목이 붙는다. */
export const CODE_HEADERS = ['약품코드', 'drug_code', '코드']
export function findHeaderRow(aoa, limit = 10) {
  const n = Math.min(limit, (aoa || []).length)
  for (let r = 0; r < n; r++) {
    const row = (aoa[r] || []).map(c => String(c ?? '').trim())
    if (row.some(c => CODE_HEADERS.includes(c))) return r
  }
  return -1
}

/* 열 이름 → 자리. 같은 뜻의 이름을 여럿 받는다(지금 파서와 같은 별칭 + 몇 가지 더) */
export const VALUE_HEADERS = {
  prev_year_usage: ['전년사용량', '전년도사용량', 'prev_year_usage', '전년'],
  recent_3m_usage: ['최근3개월사용량', '최근3개월', 'recent_3m_usage', '3개월'],
  recent_1m_usage: ['직전1개월사용량', '직전1개월', 'recent_1m_usage', '1개월', '사용량', '총사용량'],
}
export const NAME_HEADERS = ['약품명(참고용)', '약품명', 'drug_name', '품명']

export function mapColumns(headerRow, field) {
  const cells = (headerRow || []).map(c => String(c ?? '').trim())
  const find = names => cells.findIndex(c => names.includes(c))
  return {
    code: find(CODE_HEADERS),
    name: find(NAME_HEADERS),
    value: find(VALUE_HEADERS[field] || []),
  }
}

/* ── 날짜로 바뀐 약품코드 가려내기 ────────────────────────────────────────
   엑셀이 「2002」 같은 코드를 날짜 서식으로 저장해 두면 읽을 때 「2002-01-01」처럼 온다.
   ★ 운영에 실제로 숫자 코드가 있다(2002 · 20006 티크앤이지…). 그래서 **버리지 않고 알린다** —
     사용자가 보고 고칠 수 있어야 한다. */
export function looksLikeDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return false
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true                 /* 2002-01-01 */
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return true         /* 1/1/2002 */
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/.test(s)) return true    /* Date 객체가 글자로 샌 경우 */
  return false
}

/* 숫자 읽기 — 쉼표를 떼고 본다. 빈 칸은 undefined(건너뜀), 숫자가 아니면 NaN(사유 목록으로) */
export function toNum(v) {
  const s = String(v ?? '').trim()
  if (s === '') return undefined
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}

/* ── 파일 하나를 줄 목록으로 ──────────────────────────────────────────────
   aoa = [[셀,...], ...] (xlsx 의 header:1 결과)
   돌려주는 것: { rows, headerRow, cols, badHeader }
     rows = [{ code, name, raw, value }]  — value 는 숫자 또는 NaN 또는 undefined */
export function readSheet(aoa, field) {
  const hr = findHeaderRow(aoa)
  if (hr < 0) return { rows: [], headerRow: -1, cols: null, badHeader: '머리글 줄을 찾지 못했습니다(「약품코드」가 있는 줄이 앞 10줄 안에 없습니다)' }
  const cols = mapColumns(aoa[hr], field)
  if (cols.code < 0) return { rows: [], headerRow: hr, cols, badHeader: '「약품코드」 열이 없습니다' }
  if (cols.value < 0) return { rows: [], headerRow: hr, cols, badHeader: '값 열을 찾지 못했습니다' }
  const rows = []
  for (let r = hr + 1; r < aoa.length; r++) {
    const line = aoa[r] || []
    const raw = line[cols.code]
    const code = normCode(raw)
    if (!code) continue
    rows.push({
      code,
      name: cols.name >= 0 ? String(line[cols.name] ?? '').trim() : '',
      raw: String(raw ?? '').trim(),
      value: toNum(line[cols.value]),
    })
  }
  return { rows, headerRow: hr, cols, badHeader: null }
}

/* ── 여러 파일을 약품코드로 합치기 ────────────────────────────────────────
   병동·외래를 따로 받으면 **더한다**(2026-11-04 이정화 님 결정).
   같은 파일 안에 같은 코드가 두 번 나와도 더한다 — 그 수를 세어 뱃지로 알린다.

   ★ 숫자가 아닌 값은 더하지 않고 **사유 목록**으로 뺀다. 그 코드는 저장하지 않는다
     (반쪽짜리 합계가 들어가면 눈치채지 못한다). */
export function mergeRows(fileRows) {
  const sum = new Map()       /* code → { code, name, value, parts, raws } */
  const bad = []              /* 숫자가 아닌 줄 */
  const dateLike = []         /* 날짜처럼 보이는 코드 */
  for (const { rows, label } of fileRows) {
    for (const r of rows) {
      if (looksLikeDate(r.raw)) dateLike.push({ code: r.code, raw: r.raw, name: r.name, label })
      if (r.value === undefined) continue                  /* 빈 칸은 건너뛴다 */
      if (Number.isNaN(r.value)) { bad.push({ code: r.code, name: r.name, label, why: '숫자가 아님' }); continue }
      const cur = sum.get(r.code)
      if (cur) { cur.value += r.value; cur.parts += 1; if (!cur.name && r.name) cur.name = r.name }
      else sum.set(r.code, { code: r.code, name: r.name, value: r.value, parts: 1 })
    }
  }
  /* 숫자가 아닌 값이 하나라도 섞인 코드는 통째로 뺀다 — 합계가 반쪽이 되지 않게 */
  for (const b of bad) sum.delete(b.code)
  return {
    merged: [...sum.values()],
    bad,
    dateLike,
    mergedCount: [...sum.values()].filter(x => x.parts > 1).length,
  }
}

/* ── 미리보기 만들기 ──────────────────────────────────────────────────────
   drugs = 지금 약품 목록, merged = 파일에서 온 값, field = 고른 칸
   돌려주는 것: { changes, unmatched, zeros }
     changes  파일에 있고 약품도 있는 것 (지금 값 → 새 값)
     unmatched 파일에는 있는데 약품에 없는 코드
     zeros    파일에 없어서 0 이 될 약품 (지금 값이 0 이 아닌 것만) */
export function buildPreview(drugs, merged, field) {
  const byCode = new Map((drugs || []).map(d => [normCode(d.drug_code), d]))
  const inFile = new Set(merged.map(m => m.code))
  const changes = [], unmatched = []
  for (const m of merged) {
    const d = byCode.get(m.code)
    if (!d) { unmatched.push(m); continue }
    changes.push({
      code: m.code,
      name: d.drug_name || m.name || m.code,
      status: d.status || '',
      before: d[field] == null ? null : Number(d[field]),
      after: m.value,
      parts: m.parts,
    })
  }
  const zeros = []
  for (const d of (drugs || [])) {
    const code = normCode(d.drug_code)
    if (inFile.has(code)) continue
    const cur = d[field] == null ? null : Number(d[field])
    if (cur === 0) continue                 /* 이미 0 이면 바뀌는 것이 없다 */
    zeros.push({ code, name: d.drug_name || code, status: d.status || '', before: cur })
  }
  return { changes, unmatched, zeros }
}

/* 확인 문구 — 「2026년 10월분 직전1개월사용량을 등록합니다. 357종 변경, 355종 0으로.」 */
export const FIELD_LABEL = {
  prev_year_usage: '전년사용량',
  recent_3m_usage: '최근3개월사용량',
  recent_1m_usage: '직전1개월사용량',
}
export function confirmText({ year, month, field, changeCount, zeroCount }) {
  const ym = (year && month) ? `${year}년 ${month}월분 ` : ''
  return `${ym}${FIELD_LABEL[field] || field}을 등록합니다. `
    + `${Number(changeCount || 0).toLocaleString()}종 변경, ${Number(zeroCount || 0).toLocaleString()}종 0으로.`
}
