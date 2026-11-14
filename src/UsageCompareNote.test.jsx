/* 사용량 비교 창 — 「비고」 머리글 거르기·정렬 + 뱃지 모두 (2026-11-13 이정화 님 승인)
 *
 * ★★ 이 창에는 **「적용」 단추**가 있다. 걸러서 안 보이게 된 약이 적용에서 빠지거나
 *    엉뚱한 약이 들어가면 사용량이 틀린 약에 저장된다. ⑪⑫ 를 **실제로 눌러서** 못 박는다.
 *
 * 승인받은 설계
 *   · 비고에 해당하는 뱃지를 **모두** 보여 준다 (한 약에 둘·셋)
 *   · 거르기는 **글자가 아니라 약의 성질** 기준
 *   · 비고 정렬은 **첫 뱃지** 차례 (백신 → 출고0 → 극소량 → 차이없음)
 *   · 메뉴 숫자 없음 · **지금 0줄인 거리는 메뉴에서 숨김**
 *   · 비고 칸 너비를 정해 **약품 칸 너비는 그대로**
 *
 * ★ 2026-11-14 이정화 님 결정 — 반품 검토가 재고현황으로 옮겨져서
 *   「0으로 바뀌는 약」 **칩·안내 줄·인쇄·엑셀을 들어냈다.**
 *   · 뱃지는 **남긴다** (적용 전에 확인할 값이다)
 *   · 비고 거르기는 **남기되 그 항목만 뺀다** — 뱃지로만 보이고 거르지는 못한다
 *   · 「적용」이 무엇을 저장하는지는 **한 글자도 안 바뀐다**
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

const UsageCompareModal = (await import('./UsageCompareModal')).default
const SRC = readFileSync(resolve(process.cwd(), 'src/UsageCompareModal.jsx'), 'utf8')
const LIB = readFileSync(resolve(process.cwd(), 'src/lib/usageCompare.js'), 'utf8')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, atc_code: '', ...o })

/* ★ 일부러 이렇게 골랐다 —
     · AAA·BBB : 뱃지 없음 · 기본 **체크됨** → 거르면 화면 밖으로 간다
     · VAC1    : 백신 + 0으로 바뀌는 약 (뱃지 2개) ← **글자로 거르면 숨는 약**
     · VAC2    : 백신만
     · TRI     : 백신 + 출고0 + 극소량 (뱃지 **3개**)
     · SAME    : 차이 없음 → 「달라지는 약만 보기」를 켜면 **0줄**이 된다 */
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
  D({ drug_code: 'VAC1', drug_name: '백신하나주', atc_code: 'J07BB02', recent_3m_usage: 50, recent_1m_usage: 0, monthly_avg: 17, safety_stock: 20 }),
  D({ drug_code: 'VAC2', drug_name: '백신둘주', atc_code: 'J07AL01', recent_3m_usage: 10, recent_1m_usage: 4, monthly_avg: 3, safety_stock: 4 }),
  D({ drug_code: 'TRI', drug_name: '세뱃지주', atc_code: 'J07CA02', recent_3m_usage: 5, recent_1m_usage: 2, prev_year_usage: 3, monthly_avg: 2, safety_stock: 2 }),
  D({ drug_code: 'SAME', drug_name: '그대로정', recent_3m_usage: 30, recent_1m_usage: 10, monthly_avg: 10, safety_stock: 12 }),
]
/* VAC1·TRI 는 거래가 **한 줄도 없다** → 새 3개월 = 0 → 「0으로 바뀌는 약」 */
const TXNS = [
  { drug_code: 'AAA', type: '출고', transaction_date: '2026-09-10', quantity: 9 },
  { drug_code: 'BBB', type: '출고', transaction_date: '2026-09-11', quantity: 600 },
  { drug_code: 'VAC2', type: '출고', transaction_date: '2026-09-12', quantity: 30 },
  { drug_code: 'SAME', type: '출고', transaction_date: '2026-09-13', quantity: 20 },
  { drug_code: 'SAME', type: '출고', transaction_date: '2026-10-05', quantity: 10 },
]

function mockTx(rows) {
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, lt: () => chain,
    order: () => chain, limit: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    maybeSingle: () => Promise.resolve({ data: { snap_year: 2026, snap_month: 10 }, error: null }),
    then: (res) => Promise.resolve({ data: rows.slice(lo, hi + 1), count: rows.length, error: null }).then(res),
  }
  return chain
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>
function useSortReal(init) {
  const [v, set] = useState({ sk: init || '', sd: 'asc' })
  return { sk: v.sk, sd: v.sd, setSort: (k, d) => set({ sk: k, sd: d || 'asc' }) }
}
/* 머리글 부품 — 진짜 ColMenu 대신 **같은 자리**를 채운다.
   거르기 메뉴는 고를 거리를 단추로 펼쳐 둬서 시험이 바로 누를 수 있게 한다. */
const Head = ({ colKey, label, setSort, sd, sk, filter }) => (
  <span data-head={colKey}>
    <button data-sort={colKey} data-filter={filter ? 'yes' : 'no'}
      data-fval={filter && filter.value != null ? filter.value : ''}
      onClick={() => setSort(colKey, sk === colKey && sd === 'asc' ? 'desc' : 'asc')}>{label}</button>
    {filter && <span data-menu={colKey}>
      <button data-item="전체" onClick={() => filter.on(null)}>전체</button>
      {filter.items.map(v => <button key={v} data-item={v} onClick={() => filter.on(v)}>{v}</button>)}
    </span>}
  </span>
)

const open = async (props = {}) => {
  const r = render(<UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10}
    isTenantManager onClose={() => {}} onReload={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortReal} {...props} />)
  await settle(10)
  return r
}
const menuItems = () => [...document.querySelectorAll('[data-menu="note"] button')]
  .map(b => b.getAttribute('data-item')).filter(v => v !== '전체')
const pickMenu = async (item) => {
  const b = document.querySelector('[data-menu="note"] button[data-item="' + item + '"]')
  expect(b, '메뉴에 「' + item + '」 가 없다').toBeTruthy()
  await act(async () => { fireEvent.click(b) }); await settle(4)
}
const noteValue = () => document.querySelector('[data-head="note"] button[data-sort="note"]').getAttribute('data-fval')
const rowNames = () => [...document.querySelectorAll('tbody tr')]
  .map(tr => (tr.querySelector('td:nth-child(2) div')?.textContent || '').trim()).filter(Boolean)
/* 한 줄의 비고 뱃지를 **적힌 차례대로** 읽는다 */
const notesOf = (name) => {
  const tr = [...document.querySelectorAll('tbody tr')]
    .find(x => (x.querySelector('td:nth-child(2) div')?.textContent || '').trim() === name)
  if (!tr) return null
  /* 짜임새: td > span(줄바꿈 상자) > span(뱃지 하나) > span(뱃지 모양).
     바로 아래 자식만 읽어야 같은 글자를 두 번 세지 않는다. */
  return [...tr.querySelectorAll('td:last-child > span > span')].map(s => s.textContent.trim()).filter(Boolean)
}
const checkedLabels = () => [...document.querySelectorAll('tbody input[type="checkbox"]')]
  .filter(b => b.checked).map(b => b.getAttribute('aria-label'))
const applyNow = async () => {
  rpc.mockResolvedValue({ data: { saved: 2 }, error: null })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^고른 \d+종 적용$/ })) })
  await settle(3)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })) })
  await settle(8)
  return rpc.mock.calls[rpc.mock.calls.length - 1][1].p_rows
}

beforeEach(() => { rpc.mockReset(); from.mockReset(); from.mockImplementation(() => mockTx(TXNS)) })
afterEach(() => cleanup())

describe('★ ①④⑤ 비고 머리글과 뱃지', () => {
  it('① 비고 머리글이 다른 열과 같은 부품이다 — 정렬이 붙는다', async () => {
    await open()
    const h = document.querySelector('[data-head="note"] button[data-sort="note"]')
    expect(h, '비고 머리글 부품이 없다').toBeTruthy()
    expect(h.textContent).toBe('비고')
  })
  it('★ ④ 해당하는 뱃지를 모두 보여 준다 — 둘도 셋도', async () => {
    await open()
    expect(notesOf('백신하나주')).toEqual(['백신 — 제외', '0으로 바뀌는 약'])
    expect(notesOf('세뱃지주')).toEqual(['백신 — 제외', '0으로 바뀌는 약', '극소량 — 3개월 그대로'])
    expect(notesOf('백신둘주')).toEqual(['백신 — 제외'])
    expect(notesOf('가나다정'), '뱃지가 없는 줄은 비어 있다').toEqual([])
  })
  it('⑤ 뱃지 차례는 백신 → 출고0 → 극소량 → 차이없음', () => {
    const i = SRC.indexOf('const NOTE_DEFS')
    expect(i, '뱃지 정의를 찾지 못했다').toBeGreaterThan(0)
    const near = SRC.slice(i, i + 700)
    const order = ['vac', 'zero', 'tiny', 'same'].map(k => near.indexOf("k: '" + k + "'"))
    expect(order.every(x => x > 0), '네 갈래가 다 있어야 한다').toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('★★ ②③ 거르기는 글자가 아니라 약의 성질로', () => {
  it('★ ③ 뱃지가 셋인 약도 「극소량」에 걸린다 — 첫 뱃지만 보지 않는다', async () => {
    /* 세뱃지주의 비고는 「백신 · 0으로 바뀌는 약 · 극소량」이다.
       첫 뱃지(백신)만 보고 걸렀다면 이 약은 극소량에서 빠졌을 것이다. */
    await open()
    expect(notesOf('세뱃지주')[0]).toBe('백신 — 제외')
    await pickMenu('극소량 — 3개월 그대로')
    expect(rowNames()).toEqual(['세뱃지주'])
  })
  it('★ ② 비고 거르기 줄 수 = 그 성질을 가진 줄 수', async () => {
    await open()
    const all = rowNames()
    const n = all.filter(nm => (notesOf(nm) || []).includes('백신 — 제외')).length
    expect(n, '백신 줄이 없다 — 시험이 뜻을 잃는다').toBeGreaterThan(0)
    await pickMenu('백신 — 제외')
    expect(rowNames().length).toBe(n)
  })
})

describe('★★ ⑥⑦⑧ 비고 메뉴 하나로만 거른다 (칩은 없앴다)', () => {
  it('★ ⑥ 메뉴에서 고르면 머리글이 그 값을 들고 있다', async () => {
    await open()
    expect(noteValue()).toBe('')
    await pickMenu('백신 — 제외')
    expect(noteValue()).toBe('백신 — 제외')
  })
  it('★ ⑦ 「전체」를 고르면 풀린다', async () => {
    await open()
    await pickMenu('백신 — 제외')
    const all = document.querySelector('[data-menu="note"] button[data-item="전체"]')
    await act(async () => { fireEvent.click(all) }); await settle(4)
    expect(noteValue()).toBe('')
  })
  it('⑧ 다른 것을 고르면 그쪽으로 바뀐다', async () => {
    await open()
    await pickMenu('백신 — 제외')
    await pickMenu('극소량 — 3개월 그대로')
    expect(noteValue()).toBe('극소량 — 3개월 그대로')
  })
  it('★ ⑧-2 칩 줄에 **누를 수 있는 단추가 하나도 없다**', async () => {
    await open()
    /* 요약 뱃지 줄(사용 중·달라짐·적용·백신 제외·극소량)은 전부 글자일 뿐이다 */
    expect(screen.queryByRole('button', { name: /0으로 바뀌는 약/ }), '칩이 남아 있다').toBeNull()
    expect(SRC.includes('aria-pressed={zeroOnly}'), '칩 코드가 남아 있다').toBe(false)
  })
})

describe('★ ⑨⑩ 비고 정렬', () => {
  it('⑨ 비고로 줄을 세우면 백신이 먼저 온다', async () => {
    await open()
    const before = rowNames()
    await act(async () => { fireEvent.click(document.querySelector('button[data-sort="note"]')) })
    await settle(4)
    const after = rowNames()
    expect(after.length).toBe(before.length)
    expect(notesOf(after[0])[0], '첫 줄이 백신이 아니다').toBe('백신 — 제외')
    expect(notesOf(after[after.length - 1]), '맨 뒤는 뱃지 없는 줄이다').toEqual([])
  })
  it('⑩ 비고 정렬도 복사본만 세운다 — 원본을 안 건드린다', () => {
    expect(SRC).toContain("if (st.sk === 'note') return [...list].sort(")
    expect(/\b(p\.rows|p\.moved)\.(sort|splice|reverse)\(/.test(SRC), '원본을 건드렸다').toBe(false)
  })
})

describe('★★ ⑪⑫⑬ 체크·적용·알림 띠', () => {
  it('★ ⑪ 머리글로 걸렀다 풀어도 체크가 그 약품에 그대로다', async () => {
    await open()
    const before = checkedLabels().slice().sort()
    expect(before.length, '체크된 줄이 없다 — 시험이 뜻을 잃는다').toBeGreaterThan(0)
    await pickMenu('극소량 — 3개월 그대로')
    const all = document.querySelector('[data-menu="note"] button[data-item="전체"]')
    await act(async () => { fireEvent.click(all) }); await settle(4)
    expect(checkedLabels().slice().sort()).toEqual(before)
  })
  it('★ ⑫ 「적용」에 넘어가는 줄이 머리글 거르기 전·후로 글자 단위로 같다', async () => {
    const a = await open()
    const plain = JSON.stringify(await applyNow())
    a.unmount(); cleanup(); rpc.mockReset()
    await open()
    await pickMenu('극소량 — 3개월 그대로')   /* 체크된 약이 전부 화면 밖으로 간다 */
    expect(JSON.stringify(await applyNow())).toBe(plain)
  })
  it('★ ⑫-2 거르고 **정렬까지** 해도 적용 대상이 그대로다', async () => {
    /* ★ 옛 UsageCompareZeroChip.test.jsx ⑭ 가 지키던 자리다 — 칩을 없애며 이리로 옮겼다.
         거르기와 정렬을 **함께** 걸어도 「적용」에 넘어가는 줄이 흔들리면 안 된다. */
    const a = await open()
    const plain = JSON.stringify(await applyNow())
    a.unmount(); cleanup(); rpc.mockReset()
    await open()
    await pickMenu('백신 — 제외')
    await act(async () => { fireEvent.click(document.querySelector('button[data-sort="note"]')) })
    await settle(4)
    expect(JSON.stringify(await applyNow())).toBe(plain)
  })
  it('⑬ 숨은 체크 알림 띠가 머리글 거르기에서도 뜬다', async () => {
    const BAND = /체크한 (\d+)종 중 (\d+)종이 지금 안 보입니다/
    await open()
    const n = checkedLabels().length
    expect(document.body.textContent).not.toMatch(BAND)
    await pickMenu('극소량 — 3개월 그대로')
    const m = document.body.textContent.match(BAND)
    expect(m, '띠가 안 떴다').not.toBeNull()
    expect(Number(m[1])).toBe(n)
    expect(Number(m[2])).toBe(n)
  })
})

describe('★ ⑭ 메뉴에 올릴 거리', () => {
  it('⑭ 지금 0줄인 거리는 메뉴에 없다', async () => {
    await open()
    /* 「달라지는 약만 보기」가 켜져 있어 「차이 없음」은 0줄이다 */
    expect(menuItems()).toEqual(['백신 — 제외', '극소량 — 3개월 그대로'])
    expect(menuItems()).not.toContain('차이 없음')
  })
  it('★★ ⑭-0 「0으로 바뀌는 약」은 뱃지로만 남는다 — 거르기 거리에는 없다', async () => {
    await open()
    /* 뱃지는 그대로 붙는다 */
    expect(notesOf('백신하나주')).toContain('0으로 바뀌는 약')
    /* 그런데 메뉴에는 없다 */
    expect(menuItems()).not.toContain('0으로 바뀌는 약')
    expect(SRC).toContain("const NOTE_FILTERABLE = NOTE_DEFS.filter(d => d.k !== 'zero')")
  })
  it('⑭-2 「달라지는 약만 보기」를 끄면 「차이 없음」이 나타난다', async () => {
    await open()
    await act(async () => { fireEvent.click(screen.getByLabelText?.('달라지는 약만 보기') || screen.getByRole('checkbox', { name: '' })) })
    await settle(2)
    const box = [...document.querySelectorAll('input[type="checkbox"]')][0]
    if (box.checked) { await act(async () => { fireEvent.click(box) }); await settle(4) }
    expect(menuItems()).toContain('차이 없음')
  })
  it('⑭-3 고른 거리는 0줄이 돼도 메뉴에 남는다 — ✓ 를 풀 길이 있어야 한다', () => {
    expect(SRC).toContain("const noteOpts = NOTE_FILTERABLE.filter(d => d.k === noteF || base0.some(d.hit))")
  })
})

describe('★★ ⑱ 인쇄·엑셀은 창에서 사라졌다', () => {
  it('★ ⑱ 단추가 없다 — 어떻게 걸러도', async () => {
    await open()
    expect(screen.queryByRole('button', { name: '엑셀' }), '엑셀 단추가 남아 있다').toBeNull()
    expect(screen.queryByRole('button', { name: '인쇄' }), '인쇄 단추가 남아 있다').toBeNull()
    await pickMenu('백신 — 제외')
    expect(screen.queryByRole('button', { name: '엑셀' })).toBeNull()
    expect(screen.queryByRole('button', { name: '인쇄' })).toBeNull()
  })
  it('★★ ⑱-2 종이를 가로로 바꾸는 규칙이 문서에 **아예 없다**', async () => {
    /* ★ @page 는 선택자로 범위를 좁힐 수 없다 — 문서에 있기만 하면 다른 화면 인쇄까지
         가로로 바뀐다(2026-11-13 실측). 들어낸 뒤에는 흔적조차 없어야 한다. */
    await open()
    const styles = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    expect(styles.includes('@page'), '@page 가 남아 있다').toBe(false)
    expect(document.querySelector('.uc-print'), '인쇄 블록이 남아 있다').toBeNull()
  })
  it('⑱-3 인쇄·엑셀 코드가 파일에서 사라졌다', () => {
    for (const bad of ['UC_PRINT_CSS', 'UC_PRINT_ON_CSS', 'dlXlsx', 'doPrint', 'measurePages',
      'ymdToday', 'createPortal', 'flushSync', 'up-main', 'zeroPicked']) {
      expect(SRC.includes(bad), '아직 남아 있다: ' + bad).toBe(false)
    }
  })
  it('★ ⑱-4 「적용」 경로는 한 글자도 안 바뀌었다', () => {
    expect(SRC).toContain('const rows = applyRows(p ? p.rows : [], finalPicked)')
    expect(SRC).toContain("p_fields: APPLY_FIELDS, p_rows: rows, p_zero_missing: false, p_keep_codes: []")
  })
})

describe('★ ⑮⑯⑰ 색 · 적용 규칙 · 칸 너비', () => {
  it('⑮ 새 색을 만들지 않았다 — hex 리터럴이 늘지 않았다', () => {
    const hex = [...new Set((SRC.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    expect(hex).toEqual(['#F0F0EB'])
  })
  it('★ ⑯ 적용 대상 규칙을 바꾸지 않았다 · 계산식 파일도 그대로다', () => {
    expect(SRC).toContain('const rows = applyRows(p ? p.rows : [], finalPicked)')
    expect(SRC).toContain('finalPicked.has(r.code)')
    /* 비고는 **화면이 셈한다** — 계산식 파일에 칸을 더하지 않았다 */
    for (const bad of ['noteRank', 'NOTE_DEFS', 'noteHit']) {
      expect(LIB.includes(bad), '계산식 파일에 비고가 들어갔다: ' + bad).toBe(false)
    }
  })
  it('★ ⑰ 비고 칸에만 너비를 주고, 약품 칸은 그대로 둔다', async () => {
    await open()
    const th = [...document.querySelectorAll('thead th')]
    const note = th[th.length - 1]
    expect(note.style.width, '비고 칸에 너비가 없다').toBe('149px')
    expect(note.style.boxSizing, '여백이 너비에 들어가야 한다').toBe('border-box')
    /* 약품 칸(둘째)에는 너비를 주지 않는다 — PR 459 와 같은 폭으로 남는다 */
    expect(th[1].style.width, '약품 칸에 너비가 생겼다').toBe('')
    /* 본문 비고 칸도 같은 너비다 — 머리칸만 좁히면 칸이 어긋난다 */
    const td = [...document.querySelectorAll('tbody tr')[0].querySelectorAll('td')]
    expect(td[td.length - 1].style.width).toBe('149px')
  })
})
