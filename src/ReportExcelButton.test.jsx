/* 보고서 화면 — 결산 엑셀 버튼과 「흑백」 선택.

   ★ 실제 Report 컴포넌트를 그대로 띄운다. supabase 는 통째로 가짜로 바꿔 **질의에 붙은
     조건을 받아 적고**, 쓰기 계층(writeMonthlyReportXlsx)만 가로채 「어떤 dto 로, 흑백인지」를 본다.
     그래서 조회 → DTO 는 진짜 코드가 지나간다.

   ★ 고정하는 것
     ① 월간 탭에 「엑셀」과 「흑백」이 나란히 있고, 연간 탭에는 「흑백」이 없다
     ② 「흑백」은 눌린 상태가 바뀌고, 그 값이 그대로 쓰기 계층에 전달된다
     ③ ★ 화면 필터(상태 칩)를 건드려도 내려받는 내용이 바뀌지 않는다
        — 예전 다운로드는 화면 필터를 썼고, 그래서 기준 양식에서 71,965원이 빠져 있었다
     ④ 마감월은 사이드카 금액을 그대로 쓴다
     ⑤ 시안 캡처 — CAPTURE_DIR 이 있으면 도구줄 HTML 을 떠 둔다(실제 렌더 결과) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const cy = new Date().getFullYear(), cm = new Date().getMonth() + 1

/* ── 재료 — 마감된 당월. 중지 약품 1종이 그달에 폐기로 움직였다 ─────────── */
const DRUGS = [
  { drug_code: 'AAA', drug_name: '가나다정', category: '경구제', status: '사용', purchase_price: 198, expiry_date: '2027-03-01', current_qty: 120 },
  { drug_code: 'PLC', drug_name: '시험_폴리콜정', category: '경구제', status: '중지', purchase_price: 111, expiry_date: '2026-11-15', current_qty: 215 },
  { drug_code: 'QUIET', drug_name: '조용한정', category: '경구제', status: '중지', purchase_price: 50, expiry_date: '2026-12-01', current_qty: 0 },
]
const SNAPS = [
  { drug_code: 'AAA', snap_year: cy, snap_month: cm, opening_qty: 100, opening_amount: 19800.4, total_in_qty: 50, total_in_amount: 9900, total_out_qty: 30, total_out_amount: 5940, total_disp_qty: 0, total_ret_qty: 0, closing_qty: 120, closing_amount: 23760 },
  { drug_code: 'PLC', snap_year: cy, snap_month: cm, opening_qty: 669, opening_amount: 74259, total_in_qty: 0, total_in_amount: 0, total_out_qty: 0, total_out_amount: 0, total_disp_qty: 454, total_ret_qty: 0, closing_qty: 215, closing_amount: 23865 },
  { drug_code: 'QUIET', snap_year: cy, snap_month: cm, opening_qty: 0, opening_amount: 0, total_in_qty: 0, total_in_amount: 0, total_out_qty: 0, total_out_amount: 0, total_disp_qty: 0, total_ret_qty: 0, closing_qty: 0, closing_amount: 0 },
]
const TOTALS = {
  snap_year: cy, snap_month: cm,
  opening_amount: '94059.4000', in_amount: '9900.0000', out_amount: '5940.0000',
  disposal_amount: '50394.0000', return_amount: '0.0000', actual_closing: '47625.0000',
  in_count: 7, out_count: 9, disposal_count: 2, return_count: 0,
  exp_expired: 1, exp_urgent30: 2, exp_caution60: 3, exp_check90: 4, item_count: 999,
}

const calls = []
vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  function from(table) {
    const st = { table, eq: {}, kind: 'select' }
    calls.push(st)
    const rowsFor = () => {
      if (table === 'monthly_snapshots') return SNAPS
      if (table === 'monthly_report_totals') return [TOTALS]
      if (table === 'drugs') return DRUGS
      return []
    }
    const q = {
      select(c) { st.cols = c; return q },
      in(col, vals) { st.in = { col, vals }; return q },
      eq(col, v) { st.eq[col] = v; return q },
      gte() { return q }, lt() { return q }, order() { return q },
      range(a, b) { st.range = [a, b]; return a === 0 ? result(rowsFor()) : result([]) },
      limit(n) { return result(rowsFor().slice(0, n)) },
      maybeSingle() { return result(rowsFor()[0] || null) },
      insert(v) { st.kind = 'insert'; st.payload = v; return result(null) },
      upsert(v) { st.kind = 'upsert'; st.payload = v; return result(null) },
      update(v) { st.kind = 'update'; st.payload = v; return q },
      delete() { st.kind = 'delete'; return q },
      then(res) { return result(rowsFor()).then(res) },
    }
    return q
  }
  return { supabase: { from, rpc: () => result(null), auth: { getUser: () => result(null) } } }
})

/* 쓰기 계층만 가로챈다 — 조회·DTO 는 진짜 코드가 지나간다 */
const written = []
vi.mock('./lib/monthlyReportXlsx.js', () => ({
  writeMonthlyReportXlsx: (dto, opts) => { written.push({ dto, opts }); return Promise.resolve(new Blob(['x'])) },
  monthlyReportFileName: (dto, mono) => dto.year + '년 ' + dto.month + '월 의약품 결산 내역' + (mono ? '(흑백)' : '') + '.xlsx',
}))

/* 화면 색은 실제 밝은 테마 값을 쓴다 — 시안 캡처가 운영과 같은 색이 되게 한다 */
const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E',
  accent: '#804A87', accentL: '#F5EDF6', purple: '#804A87', purpleL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE',
  blue: '#2E4A62', blueL: '#EAF0F5', amber: '#B8860B', amberL: '#FFF8E1',
  shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, memberRole: 'owner', setTheme: () => {} }) }
})

let Report
beforeEach(async () => {
  calls.length = 0; written.length = 0
  global.URL.createObjectURL = () => 'blob:stub'
  global.URL.revokeObjectURL = () => {}
  if (!Report) Report = (await import('./App.jsx')).Report
})
afterEach(() => cleanup())

const toolbar = () => screen.getByRole('button', { name: '엑셀' }).parentElement

/* 떠낸 HTML 을 그림으로 구울 때, 드롭다운이 실제 선택을 보이게 한다.
   React 는 select 의 값을 **속성이 아니라 DOM 속성**으로 넣어서, outerHTML 만 떼면
   늘 첫 항목이 그려진다 — 시안이 「2024년 1월」로 보이는 함정. */
function withSelected(el) {
  const clone = el.cloneNode(true)
  const live = el.querySelectorAll('select')
  clone.querySelectorAll('select').forEach((sel, i) => {
    const want = live[i] ? live[i].value : null
    sel.querySelectorAll('option').forEach(o => {
      if (want != null && o.value === want) o.setAttribute('selected', 'selected')
      else o.removeAttribute('selected')
    })
  })
  return clone.outerHTML
}

describe('① 버튼 배치', () => {
  it('월간 탭에 「엑셀」과 「흑백」이 나란히 있다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    expect(await screen.findByRole('button', { name: '엑셀' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /엑셀 색상/ })).toBeTruthy()
  })
  it('「흑백」이 「엑셀」 바로 옆에 온다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    const bar = toolbar()
    const names = [...bar.querySelectorAll('button')].map(b => b.textContent)
    /* ★ 글자가 상태에 따라 「컬러」/「흑백」으로 바뀐다 — 처음에는 꺼짐이라 「컬러」다 */
    expect(names.indexOf('컬러') - names.indexOf('엑셀')).toBe(1)
  })
  it('연간 탭에는 「흑백」이 없다 — 기준 양식은 월간 전용이다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: '엑셀' })
    fireEvent.click(screen.getByRole('button', { name: '연간' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /엑셀 색상/ })).toBeNull())
    expect(screen.getByRole('button', { name: '엑셀' })).toBeTruthy()
  })
  it('기존 버튼 색만 쓴다 — 새 색을 들이지 않는다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    const mono = await screen.findByRole('button', { name: /엑셀 색상/ })
    const used = (mono.getAttribute('style') || '').toLowerCase()
    for (const m of used.match(/#[0-9a-f]{3,8}/g) || []) {
      expect([T.green.toLowerCase(), T.greenL.toLowerCase(), '#fff', '#ffffff'], '쓰인 색 ' + m).toContain(m)
    }
  })
})

describe('② 흑백 선택이 그대로 전달된다', () => {
  /* ★ aria-pressed 는 **채움**과 같이 간다(2026-11-01 결정) — 채워져 있는 컬러 모드가 true 다.
     어느 모드인지는 aria-label 이 말하므로, 눌림 표시는 눈에 보이는 채움과 어긋나지 않게 둔다. */
  it('처음엔 컬러판이다 — 채워져 있으므로 aria-pressed 는 true', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    const b = await screen.findByRole('button', { name: /엑셀 색상/ })
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.getAttribute('aria-label')).toBe('엑셀 색상: 컬러')
  })
  it('누르면 흑백(테두리만)이 되고, 다시 누르면 돌아온다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    const b = await screen.findByRole('button', { name: /엑셀 색상/ })
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('false'))
    expect(b.getAttribute('aria-label')).toBe('엑셀 색상: 흑백')
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'))
  })
  it('컬러판으로 내려받으면 mono:false 로 간다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBe(1))
    expect(written[0].opts.mono).toBe(false)
  })
  it('흑백을 누른 뒤 내려받으면 mono:true 로 간다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /엑셀 색상/ }))
    fireEvent.click(screen.getByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBe(1))
    expect(written[0].opts.mono).toBe(true)
  })
})

describe('③ ★ 화면 필터가 내려받는 내용에 섞이지 않는다', () => {
  async function download() {
    fireEvent.click(screen.getByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBeGreaterThan(0))
    return written[written.length - 1].dto
  }

  it('움직인 중지 약품이 들어 있고, 조용한 약품은 빠진다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: '엑셀' })
    const dto = await download()
    expect(dto.list.map(r => r.code).sort()).toEqual(['AAA', 'PLC'])
    expect(dto.list.map(r => r.code)).not.toContain('QUIET')
  })

  it('★ 상태 칩에서 「중지」를 끄더라도 내려받는 줄이 그대로다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: '엑셀' })
    const before = await download()

    /* 화면의 「중지」 상태 칩을 끈다 — 표에서는 사라지지만 파일은 달라지지 않아야 한다 */
    const chip = screen.queryByRole('button', { name: '중지' }) || screen.queryByText('중지')
    if (chip) fireEvent.click(chip)
    written.length = 0
    const after = await download()

    expect(after.list.map(r => r.code)).toEqual(before.list.map(r => r.code))
    expect(after.summary.opening).toBe(before.summary.opening)
    expect(after.list.map(r => r.code)).toContain('PLC')
  })

  it('관리 품목수는 약품목록 줄 수와 같다 (사이드카 item_count 999 를 쓰지 않는다)', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: '엑셀' })
    const dto = await download()
    expect(dto.summary.itemCount).toBe(dto.list.length)
    expect(dto.summary.itemCount).not.toBe(999)
  })
})

describe('④ 마감월은 사이드카 금액을 그대로 쓴다', () => {
  it('요약 금액이 사이드카 값과 같다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBe(1))
    const s = written[0].dto.summary
    expect(written[0].dto.closed).toBe(true)
    expect(s.opening).toBe(94059.4)
    expect(s.inAmount).toBe(9900)
    expect(s.outAmount).toBe(5940)
    expect(s.dispAmount).toBe(50394)
    expect(s.closing).toBe(47625)
    expect([s.inCount, s.outCount, s.dispCount, s.retCount]).toEqual([7, 9, 2, 0])
  })
  it('사이드카 총계와 스냅샷을 둘 다 선택한 연·월로 물었다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBe(1))
    const asked = calls.filter(c => c.table === 'monthly_report_totals' || c.table === 'monthly_snapshots')
    expect(asked.length).toBeGreaterThan(0)
    for (const c of asked.filter(c => c.eq.snap_month !== undefined)) {
      expect(c.eq.snap_year).toBe(cy)
    }
  })
})

/* ★ 인쇄 빈 쪽 — 안내 띠가 인쇄에 끼면 월간 요약이 1쪽을 넘긴다.
     요약 블록은 min-height 265mm, 인쇄 가능 높이는 273mm(@page margin 12mm) → **여유 8mm**.
     띠는 약 18mm 라 그것만으로 12.7mm 넘겨, 넘친 꼬리만 2쪽에 남고 목록은 3쪽부터 나왔다.
     (헤드리스 Chrome 실측: 524행 16쪽 → 17쪽, 1,131행 33쪽 → 34쪽) */
describe('⑥ 안내 띠는 인쇄에서 빠진다', () => {
  const banner = () => [...document.querySelectorAll('div')]
    .find(d => /^[✅❌]/.test((d.textContent || '').trim()) && d.children.length === 0)

  it('★ 내려받은 뒤 뜨는 안내 띠에 no-print 가 붙는다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(banner()).toBeTruthy())
    expect(banner().className, '인쇄에서 빠져야 한다').toContain('no-print')
  })
  it('화면에서는 그대로 보인다 — 숨긴 게 아니라 인쇄에서만 뺀다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(banner()).toBeTruthy())
    const el = banner()
    expect(window.getComputedStyle(el).display, '화면에서는 숨기지 않는다').not.toBe('none')
    expect(el.textContent).toContain('내려받았습니다')
  })
  it('전역 인쇄 규칙이 .no-print 를 숨긴다 (띠가 기대는 규칙)', () => {
    const src = readFileSync('src/App.jsx', 'utf8')
    expect(src).toMatch(/\.no-print\s*\{\s*display:\s*none\s*!important/)
  })
})

/* ★ 연속 다운로드는 Chrome 의 「여러 파일 자동 다운로드」 권한에 막힐 수 있다.
     앱은 그것을 **알 방법이 없다** — click() 은 성공하고 ✅ 도 뜬다.
     그래서 화면에 줄을 늘리지 않고 툴팁에만 길을 적어 둔다. */
/* ★ 버튼 글자가 **지금 상태**를 말한다. 전에는 「흑백」으로 고정이라 켜짐/꺼짐을
     채움 색 하나로만 읽어야 했고, 색을 놓치면 「눌러도 안 바뀐다」로 보였다. */
describe('⑧ 흑백 버튼 글자가 상태를 말한다', () => {
  const b = () => screen.getByRole('button', { name: /엑셀 색상/ })

  it('★ 마운트 「컬러」 → 1회 「흑백」 → 2회 「컬러」', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: /엑셀 색상/ })
    expect(b().textContent).toBe('컬러')
    fireEvent.click(b())
    await waitFor(() => expect(b().textContent).toBe('흑백'))
    fireEvent.click(b())
    await waitFor(() => expect(b().textContent).toBe('컬러'))
  })

  it('★ 글자·채움·툴팁·aria-pressed 가 늘 한 몸이다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: /엑셀 색상/ })
    const look = () => ({
      text: b().textContent,
      filled: b().style.background !== 'transparent',
      pressed: b().getAttribute('aria-pressed'),
      tip: (b().getAttribute('title') || '').startsWith('흑백판'),
      label: b().getAttribute('aria-label'),
    })
    for (let i = 0; i < 4; i++) {
      const s = look()
      const isMono = s.text === '흑백'
      /* ★ 채움은 **컬러 모드**가 가져간다(2026-11-01 결정) — 흑백일 때는 테두리만 */
      expect(s.filled, i + '회: 채움은 컬러 모드').toBe(!isMono)
      expect(s.pressed, i + '회: aria-pressed 는 채움과 같이 간다').toBe(String(!isMono))
      expect(s.tip, i + '회: 툴팁').toBe(isMono)
      expect(s.label, i + '회: aria-label').toBe('엑셀 색상: ' + (isMono ? '흑백' : '컬러'))
      fireEvent.click(b())
      await waitFor(() => expect(b().textContent).toBe(isMono ? '컬러' : '흑백'))
    }
  })

  it('★ 내려받는 모드가 글자와 같다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: /엑셀 색상/ })
    expect(b().textContent).toBe('컬러')
    fireEvent.click(screen.getByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBe(1))
    expect(written[0].opts.mono, '글자가 「컬러」면 mono:false').toBe(false)

    fireEvent.click(b())
    await waitFor(() => expect(b().textContent).toBe('흑백'))
    fireEvent.click(screen.getByRole('button', { name: '엑셀' }))
    await waitFor(() => expect(written.length).toBe(2))
    expect(written[1].opts.mono, '글자가 「흑백」이면 mono:true').toBe(true)
  })

  it('글자는 늘 두 글자다 — 버튼 폭이 흔들리지 않는다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: /엑셀 색상/ })
    expect(b().textContent.length).toBe(2)
    fireEvent.click(b())
    await waitFor(() => expect(b().textContent).toBe('흑백'))
    expect(b().textContent.length).toBe(2)
  })

  /* ★ 색 **값**까지 못 박는다 — 조건만 뒤집었지 새 색을 쓰지 않았음을 보증한다.
     흑백 모드의 배경/글자색이 예전 컬러 모드 값과 같고, 그 반대도 같아야 한다. */
  it('★ 채움은 컬러 모드가 가져간다 — 색 값은 쓰던 것 그대로', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: /엑셀 색상/ })
    const rgbGreen = 'rgb(1, 151, 72)'          /* T.green 을 jsdom 이 돌려주는 모양 */
    expect(b().textContent).toBe('컬러')
    expect(b().style.background, '컬러: 초록 채움').toBe(rgbGreen)
    expect(b().style.color, '컬러: 흰 글자').toBe('rgb(255, 255, 255)')

    fireEvent.click(b())
    await waitFor(() => expect(b().textContent).toBe('흑백'))
    expect(b().style.background, '흑백: 테두리만').toBe('transparent')
    expect(b().style.color, '흑백: 초록 글자').toBe(rgbGreen)
    expect(b().style.border, '테두리는 두 모드 모두 그대로').toBe('1px solid ' + rgbGreen)
  })

  it('스타일 규칙은 그대로다 — 색·여백·테두리를 건드리지 않았다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: /엑셀 색상/ })
    const s = b().style
    expect(s.padding).toBe('6px 12px')
    expect(s.borderRadius).toBe('8px')
    expect(s.fontSize).toBe('11px')
    expect(s.fontWeight).toBe('600')
    /* jsdom 은 hex 를 rgb() 로 바꿔 돌려준다 — 값을 맞춰 비교한다 */
    expect(s.border).toBe('1px solid rgb(1, 151, 72)')
  })
})

describe('⑦ 「엑셀」 툴팁에 다운로드 차단 안내가 있다', () => {
  it('툴팁에 사이트 설정 › 자동 다운로드 안내가 들어 있다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    const b = await screen.findByRole('button', { name: '엑셀' })
    const title = b.getAttribute('title') || ''
    expect(title, '기존 설명은 그대로 둔다').toContain('기준 양식')
    expect(title).toContain('자동 다운로드')
    expect(title).toContain('사이트 설정')
  })
  it('화면에 새 줄을 만들지 않았다 — 안내는 툴팁에만 있다', async () => {
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    await screen.findByRole('button', { name: '엑셀' })
    expect(document.body.textContent, '보이는 글자로 나오면 안 된다').not.toContain('자동 다운로드')
  })
})

describe('⑤ 시안 캡처', () => {
  it('도구줄 HTML 을 떠 둔다 (CAPTURE_DIR 이 있을 때만)', async () => {
    const dir = process.env.CAPTURE_DIR
    render(<Report drugs={DRUGS} onNav={() => {}} />)
    const b = await screen.findByRole('button', { name: /엑셀 색상/ })
    const off = withSelected(toolbar())
    fireEvent.click(b)
    /* 컬러(채움·pressed true) → 흑백(테두리만·pressed false) */
    await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('false'))
    const on = withSelected(toolbar())
    expect(off).not.toBe(on)          /* 눌린 모양이 실제로 달라진다 */
    /* 시안이 실제 선택 월을 보여 준다 — 「2024년 1월」로 굳어 버리지 않는다 */
    expect(off).toContain('value="' + cy + '" selected')
    expect(off).toContain('value="' + cm + '" selected')
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(dir + '/toolbar_off.html', off, 'utf8')
      writeFileSync(dir + '/toolbar_on.html', on, 'utf8')
    }
  })
})

describe('화면 색 상수가 운영 테마와 같은지', () => {
  it('시험이 쓰는 green·greenL 이 App.jsx 밝은 테마 값과 같다', () => {
    const src = readFileSync('src/App.jsx', 'utf8')
    const light = src.slice(src.indexOf('const themes = {'), src.indexOf('dark:', src.indexOf('const themes = {')))
    expect(light, 'green').toContain("green:'" + T.green + "'")
    expect(light, 'greenL').toContain("greenL:'" + T.greenL + "'")
  })
})
