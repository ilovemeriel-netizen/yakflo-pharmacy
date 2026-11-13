/* 사용량 비교 창 — 「3개월 출고 0」 인쇄·엑셀 (2026-11-13 이정화 님 승인)
 *
 * ★★ 이 두 단추는 **읽기만** 한다. 체크·적용과 아무 상관이 없다.
 *    ⑭ 를 실제로 눌러서 **DB 로 아무것도 안 간다**는 것을 못 박는다.
 *
 * 승인받은 범위
 *   · 「3개월 출고 0」으로 걸렀을 때만 단추가 나온다(칩이든 비고 메뉴든 같은 상태)
 *   · 단추는 보고서 화면의 「엑셀」·「인쇄」와 같은 모양 — 글자만, 아이콘·새 색 없음
 *   · 엑셀은 저장소에 이미 있는 xlsx(SheetJS) — **새 라이브러리 없음**
 *   · 엑셀 10열(직전3개월을 예전/지금 두 칸) · 차이 칸에 식 · 인쇄는 9열 한 칸
 *   · 인쇄 A4 가로 · 약국 이름 · 서명란 · 쪽 번호
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }))

/* ★ 가짜 xlsx — 진짜 파일을 쓰지 않고 **무엇을 넘겼는지** 들여다본다.
     encode_cell 은 진짜와 같은 모양으로 돌려준다(A1·I2 …). */
const xl = { aoa: null, ws: null, sheetName: null, fileName: null }
vi.mock('xlsx', () => {
  const utils = {
    aoa_to_sheet: (aoa) => { xl.aoa = aoa; xl.ws = {}; for (let r = 0; r < aoa.length; r++) for (let c = 0; c < aoa[r].length; c++) xl.ws[String.fromCharCode(65 + c) + (r + 1)] = { t: 's', v: aoa[r][c] }; return xl.ws },
    encode_cell: ({ c, r }) => String.fromCharCode(65 + c) + (r + 1),
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    book_append_sheet: (wb, ws, name) => { xl.sheetName = name },
  }
  return { utils, writeFile: (wb, name) => { xl.fileName = name }, default: { utils } }
})

const UsageCompareModal = (await import('./UsageCompareModal')).default
const SRC = readFileSync(resolve(process.cwd(), 'src/UsageCompareModal.jsx'), 'utf8')
const PKG = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, atc_code: '', ...o })

/* ZZ1·VAC1 만 「3개월 출고 0」이다. AAA·BBB 는 기본 체크된 줄이라 걸러지면 화면 밖으로 간다. */
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
  D({ drug_code: 'ZZ1', drug_name: '영출고정', category: '외용제', current_qty: 77, recent_3m_usage: 50, recent_1m_usage: 0, monthly_avg: 17, safety_stock: 20 }),
  D({ drug_code: 'VAC1', drug_name: '백신출고0주', category: '주사제', current_qty: 5, atc_code: 'J07BB02', recent_3m_usage: 12, recent_1m_usage: 0, monthly_avg: 4, safety_stock: 5 }),
]
const TXNS = [
  { drug_code: 'AAA', type: '출고', transaction_date: '2026-09-10', quantity: 9 },
  { drug_code: 'BBB', type: '출고', transaction_date: '2026-09-11', quantity: 600 },
]

function mockTx(rows) {
  let lo = 0, hi = 1e9
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, lt: () => chain,
    order: () => chain, limit: () => chain,
    range: (a, b) => { lo = a; hi = b; return chain },
    maybeSingle: () => chain,
    then: (res) => Promise.resolve({ data: rows.slice(lo, hi + 1), count: rows.length, error: null }).then(res),
  }
  return chain
}
/* 약국 이름 — 머리말이 쓰는 것과 같은 한 줄(tenants.name) */
function mockTenant() {
  const chain = {
    select: () => chain, limit: () => chain, maybeSingle: () => chain,
    then: (res) => Promise.resolve({ data: { name: '씨엔씨재활의학과병원' }, error: null }).then(res),
  }
  return chain
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>
function useSortReal(init) {
  const [v, set] = useState({ sk: init || '', sd: 'asc' })
  return { sk: v.sk, sd: v.sd, setSort: (k, d) => set({ sk: k, sd: d || 'asc' }) }
}
const Head = ({ colKey, label, setSort, sd, sk, filter }) => (
  <span data-head={colKey}>
    <button data-sort={colKey} onClick={() => setSort(colKey, sk === colKey && sd === 'asc' ? 'desc' : 'asc')}>{label}</button>
    {filter && <span data-menu={colKey}>
      <button data-item="전체" onClick={() => filter.on(null)}>전체</button>
      {filter.items.map(v => <button key={v} data-item={v} onClick={() => filter.on(v)}>{v}</button>)}
    </span>}
  </span>
)

let onDoneMsg = null
const open = async (props = {}) => {
  onDoneMsg = null
  const r = render(<UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10}
    isTenantManager onClose={() => {}} onReload={() => {}} onDone={m => { onDoneMsg = m }}
    Confirm={Confirm} ColMenu={Head} useSort={useSortReal} {...props} />)
  await settle(10)
  return r
}
const chip = () => screen.getByRole('button', { name: /^3개월 출고 0 \d+종$/ })
const pressChip = async () => { await act(async () => { fireEvent.click(chip()) }); await settle(6) }
const pickMenu = async (item) => {
  const b = document.querySelector('[data-menu="note"] button[data-item="' + item + '"]')
  await act(async () => { fireEvent.click(b) }); await settle(6)
}
const btn = name => screen.queryByRole('button', { name })
const clickXlsx = async () => { await act(async () => { fireEvent.click(btn('엑셀')) }); await settle(8) }

beforeEach(() => {
  rpc.mockReset(); from.mockReset()
  from.mockImplementation(tbl => (tbl === 'tenants' ? mockTenant() : mockTx(TXNS)))
  xl.aoa = null; xl.ws = null; xl.sheetName = null; xl.fileName = null
  window.print = vi.fn()
})
afterEach(() => cleanup())

describe('★ ①②③④ 단추가 나오는 자리', () => {
  it('① 걸렀을 때 「엑셀」·「인쇄」 두 단추가 나온다', async () => {
    await open()
    await pressChip()
    expect(btn('엑셀'), '엑셀 단추가 없다').toBeTruthy()
    expect(btn('인쇄'), '인쇄 단추가 없다').toBeTruthy()
  })
  it('② 안 걸렀으면 단추가 없다', async () => {
    await open()
    expect(btn('엑셀')).toBeNull()
    expect(btn('인쇄')).toBeNull()
  })
  it('③ 비고 메뉴로 걸러도 똑같이 나온다 — 칩과 같은 상태다', async () => {
    await open()
    await pickMenu('3개월 출고 0')
    expect(btn('엑셀')).toBeTruthy()
    expect(btn('인쇄')).toBeTruthy()
  })
  it('④ 다른 거리로 걸렀을 때는 안 나온다', async () => {
    await open()
    await pickMenu('백신 — 제외')
    expect(btn('엑셀')).toBeNull()
    expect(btn('인쇄')).toBeNull()
  })
})

describe('★ ⑤ 단추 모양이 보고서 화면과 같다', () => {
  it('⑤ 글자만 쓴다 — 아이콘·새 색이 없다', async () => {
    await open(); await pressChip()
    expect(btn('엑셀').textContent).toBe('엑셀')
    expect(btn('인쇄').textContent).toBe('인쇄')
    /* 보고서 화면이 쓰는 값과 같은 꼴 — 초록(엑셀)·파랑(인쇄) */
    expect(SRC).toContain('background: t.greenL, color: t.green')
    expect(SRC).toContain('background: t.blueL, color: t.blue')
    expect(APP).toContain("background:t.greenL,color:t.green")
    expect(APP).toContain("background:t.blueL,color:t.blue")
  })
})

describe('★★ ⑥⑦ 엑셀 줄 — 보이는 줄 그대로 · 체크와 무관', () => {
  it('★ ⑥ 엑셀 줄 = 지금 걸러진 줄, 화면 차례 그대로', async () => {
    await open(); await pressChip()
    const seen = [...document.querySelectorAll('tbody tr')]
      .map(tr => (tr.querySelector('td:nth-child(2) div')?.textContent || '').trim()).filter(Boolean)
    await clickXlsx()
    expect(xl.aoa).not.toBeNull()
    expect(xl.aoa.length).toBe(seen.length + 1)             /* 머리 1줄 + 보이는 줄 */
    expect(xl.aoa.slice(1).map(r => r[1])).toEqual(seen)    /* 차례까지 같다 */
  })
  it('★ ⑦ 체크를 바꿔도 엑셀 줄이 안 변한다 — 읽기만 한다', async () => {
    await open(); await pressChip()
    await clickXlsx()
    const before = JSON.stringify(xl.aoa)
    /* 보이는 줄의 체크를 모두 뒤집는다 */
    for (const b of document.querySelectorAll('tbody input[type="checkbox"]')) {
      await act(async () => { fireEvent.click(b) }); await settle(2)
    }
    await clickXlsx()
    expect(JSON.stringify(xl.aoa)).toBe(before)
  })
})

describe('★ ⑧⑨⑩⑪ 엑셀 모양', () => {
  it('⑧ 10열 머리말이 정확하다 — 직전3개월이 두 칸이다', async () => {
    await open(); await pressChip(); await clickXlsx()
    expect(xl.aoa[0]).toEqual(['약품코드', '약품명', '구분', '현재고',
      '직전3개월(예전)', '직전3개월(지금)', '비고', '실사수량', '차이', '확인'])
  })
  it('⑨ 실사수량·확인은 빈칸이고, 「차이」에는 식이 들어간다', async () => {
    await open(); await pressChip(); await clickXlsx()
    for (const r of xl.aoa.slice(1)) { expect(r[7]).toBe(''); expect(r[9]).toBe('') }
    /* 2번째 줄(엑셀 2행)의 차이 칸 = I2 */
    expect(xl.ws.I2.f).toBe('IF(H2="","",H2-D2)')
    expect(xl.ws.I2.v, '값은 비워 둔다 — 실사수량이 빈칸이면 빈칸으로 보인다').toBe('')
  })
  it('⑩ 약품코드 열은 텍스트 서식이다 — APR2 가 46114 로 바뀌지 않게', async () => {
    await open(); await pressChip(); await clickXlsx()
    expect(xl.ws.A2.t).toBe('s')
    expect(xl.ws.A2.z).toBe('@')
  })
  it('⑪ 파일 이름과 시트 이름이 정해진 대로다', async () => {
    await open(); await pressChip(); await clickXlsx()
    expect(xl.fileName).toMatch(/^재고실사_3개월출고0_\d{8}\.xlsx$/)
    expect(xl.sheetName).toBe('3개월출고0')
    /* ★ 날짜는 **그 지역 날짜**로 적는다 — toISOString() 은 UTC 라 자정 언저리에 하루 밀린다 */
    const d = new Date()
    const want = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
    expect(xl.fileName).toBe('재고실사_3개월출고0_' + want + '.xlsx')
  })
  it('⑪-2 현재고·직전3개월 값이 화면과 같다', async () => {
    await open(); await pressChip(); await clickXlsx()
    const zz = xl.aoa.slice(1).find(r => r[0] === 'ZZ1')
    expect(zz, 'ZZ1 줄이 없다').toBeTruthy()
    expect(zz[2]).toBe('외용제')
    expect(zz[3]).toBe(77)      /* 현재고 — 창이 이미 들고 있는 값(추가 조회 없음) */
    expect(zz[4]).toBe(50)      /* 직전3개월 예전 */
    expect(zz[5]).toBe(0)       /* 직전3개월 지금 */
    expect(zz[6]).toBe('3개월 출고 0')
  })
  it('⑪-3 비고는 해당하는 말을 모두 적는다', async () => {
    await open(); await pressChip(); await clickXlsx()
    const v = xl.aoa.slice(1).find(r => r[0] === 'VAC1')
    expect(v[6]).toBe('백신 — 제외 · 3개월 출고 0')
  })
})

describe('★ ⑫ 새 라이브러리 없음', () => {
  it('⑫ 엑셀은 저장소에 이미 있는 xlsx 만 쓴다', () => {
    expect(SRC).toContain("await import('xlsx')")
    expect(PKG.dependencies.xlsx, 'xlsx 가 이미 들어 있어야 한다').toBeTruthy()
    /* 이 파일이 들여오는 것은 react·react-dom 과 **우리 파일**뿐이다(xlsx 는 동적) */
    const froms = [...(SRC.match(/^import .*$/gm) || []).join('\n').matchAll(/from '([^']+)'/g)].map(m => m[1])
    for (const fr of froms) {
      expect(fr === 'react' || fr === 'react-dom' || fr.startsWith('./'), '새 라이브러리: ' + fr).toBe(true)
    }
  })
})

describe('★ ⑬ 인쇄 — A4 가로 · 머리 반복 · 줄 안 잘림 · 약국 · 서명 · 쪽 번호', () => {
  it('★ ⑬-0 다른 화면 인쇄에 번지지 않는다 — @page 는 누를 때만 문서에 넣는다', async () => {
    /* ★★ @page 는 **선택자로 범위를 좁힐 수 없다.** 문서에 있기만 하면 그 문서의
         모든 인쇄에 걸린다. 2026-11-13 실측: 늘 띄워 두니 향정 인쇄 종이가
         216×279mm → 297×210mm 로 바뀌었다. 그래서 두 덩어리로 나눠 둔다. */
    expect(SRC).toContain('const UC_PRINT_ON_CSS')
    /* ★ **CSS 본문만** 본다 — 주석에 적힌 「@page」 글자를 잡으면 뜻이 없다 */
    const body = name => {
      const m = SRC.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`'))
      expect(m, name + ' 을 찾지 못했다').not.toBeNull()
      return m[1]
    }
    /* 늘 떠 있는 쪽에는 종이를 바꾸거나 앱을 숨기는 규칙이 **없어야** 한다 */
    const always = body('UC_PRINT_CSS')
    expect(always.includes('@page'), '늘 떠 있는 CSS 에 @page 가 있다').toBe(false)
    expect(always.includes('body>*'), '늘 떠 있는 CSS 가 앱을 숨긴다').toBe(false)
    /* 누를 때만 넣는 쪽에 둘 다 있다 */
    const onCss = body('UC_PRINT_ON_CSS')
    expect(onCss).toContain('@page{size:A4 landscape')
    expect(onCss).toContain('body>*:not(.uc-print){display:none!important}')
    /* 화면에 그려지는 것은 **인쇄를 누른 동안만** */
    expect(SRC).toContain('{printing ? <style>{UC_PRINT_ON_CSS}</style> : null}')
    /* 끝나면 반드시 뺀다 */
    expect(SRC).toContain("window.addEventListener('afterprint', off)")
  })
  it('★ ⑬-0-2 창을 열어 걸러 두기만 해서는 종이를 바꾸는 규칙이 문서에 없다', async () => {
    await open(); await pressChip()
    const styles = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    expect(styles, '인쇄 블록이 붙어 있어야 한다').toContain('.uc-print')
    expect(styles.includes('@page'), '누르지도 않았는데 @page 가 문서에 있다').toBe(false)
  })
  it('★ ⑬-0-3 「인쇄」를 누르면 그때 들어온다', async () => {
    await open(); await pressChip()
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    const styles = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    expect(styles).toContain('@page{size:A4 landscape')
  })
  it('★ ⑬-0-4 거르기를 풀었다 다시 걸면 종이 규칙이 **되살아나지 않는다**', async () => {
    /* ★★ afterprint 가 안 불리는 자리를 메운다.
         인쇄 표시(printing)를 안 끄면, 거르기를 풀었다 다시 걸었을 때
         「인쇄」를 누르지도 않았는데 @page 가 돌아와 **다른 화면 인쇄에 번진다.** */
    const pageRule = () => [...document.querySelectorAll('style')]
      .map(s => s.textContent).join('\n').includes('@page{size:A4 landscape')
    await open(); await pressChip()
    expect(pageRule(), '누르기 전엔 없어야 한다').toBe(false)
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(pageRule(), '누르면 들어와야 한다').toBe(true)
    await pressChip()                       /* 거르기 해제 → 인쇄 블록째 사라진다 */
    expect(pageRule(), '거르기를 풀면 없어야 한다').toBe(false)
    await pressChip()                       /* 다시 걸기 — 여기서 되살아나면 안 된다 */
    expect(pageRule(), '★ 누르지도 않았는데 되살아났다').toBe(false)
  })
  it('★ ⑬-0-5 비고 메뉴로 풀었다 걸어도 되살아나지 않는다', async () => {
    const pageRule = () => [...document.querySelectorAll('style')]
      .map(s => s.textContent).join('\n').includes('@page{size:A4 landscape')
    await open(); await pickMenu('3개월 출고 0')
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(pageRule()).toBe(true)
    const all = document.querySelector('[data-menu="note"] button[data-item="전체"]')
    await act(async () => { fireEvent.click(all) }); await settle(6)
    expect(pageRule(), '전체로 풀면 없어야 한다').toBe(false)
    await pickMenu('3개월 출고 0')
    expect(pageRule(), '★ 누르지도 않았는데 되살아났다').toBe(false)
  })
  it('★ ⑬-0-6 창을 닫으면 인쇄용 CSS 가 문서에서 사라진다', async () => {
    const r = await open(); await pressChip()
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(document.querySelector('.uc-print'), '인쇄 블록이 있어야 한다').toBeTruthy()
    r.unmount()
    const styles = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    expect(styles.includes('@page{size:A4 landscape'), '창을 닫았는데 @page 가 남았다').toBe(false)
    expect(styles.includes('.uc-print'), '창을 닫았는데 인쇄 CSS 가 남았다').toBe(false)
    expect(document.querySelector('.uc-print'), '창을 닫았는데 인쇄 블록이 남았다').toBeNull()
  })
  it('⑬ 인쇄 CSS 에 정해진 규칙이 다 있다', () => {
    expect(SRC).toContain('@page{size:A4 landscape')
    expect(SRC).toContain('thead{display:table-header-group}')
    expect(SRC).toContain('break-inside:avoid;page-break-inside:avoid')
    /* 덮개까지 찍히지 않게 — 표만 body 바로 밑으로 내보낸다 */
    expect(SRC).toContain('body>*:not(.uc-print){display:none!important}')
    expect(SRC).toContain('createPortal(')
  })
  it('⑬-2 약국 이름을 머리말이 쓰는 것과 같은 한 줄로 읽는다', async () => {
    await open(); await pressChip()
    expect(from.mock.calls.some(c => c[0] === 'tenants'), 'tenants 를 안 읽었다').toBe(true)
    expect(document.body.textContent).toContain('씨엔씨재활의학과병원')
  })
  it('⑬-3 창을 열기만 해서는 약국 이름을 읽지 않는다', async () => {
    await open()
    expect(from.mock.calls.some(c => c[0] === 'tenants')).toBe(false)
  })
  it('⑬-4 인쇄본에 제목·서명란·쪽 번호가 있고, 적는 칸은 빈칸이다', async () => {
    await open(); await pressChip()
    const prn = document.querySelector('.uc-print')
    expect(prn, '인쇄 블록이 없다').toBeTruthy()
    expect(prn.textContent).toContain('3개월 출고 0 재고 실사 리스트')
    expect(prn.querySelector('.up-sign').textContent).toContain('실사자')
    expect(prn.querySelector('.up-sign').textContent).toContain('확인자')
    expect(prn.querySelector('.up-ft').textContent).toMatch(/^\d+ \/ \d+$/)
    /* 인쇄는 9열(직전3개월 한 칸) */
    const th = [...prn.querySelectorAll('.up-main thead th')].map(x => x.textContent)
    expect(th).toEqual(['약품코드', '약품명', '구분', '현재고', '직전3개월', '비고', '실사수량', '차이', '확인'])
    /* 마지막 세 칸은 **손으로 적는 자리** — 빈칸이다 */
    const td = [...prn.querySelectorAll('.up-main tbody tr')[0].querySelectorAll('td')]
    expect(td.slice(-3).map(x => x.textContent)).toEqual(['', '', ''])
  })
  it('⑬-5 ★ 줄 수를 셀 때 서명 칸이 섞이지 않는다 — 이름(.up-main)을 따로 준다', () => {
    /* 2026-11-13 에 실제로 겪었다: 서명 줄까지 세어 없는 줄을 찾다 터졌다 */
    expect(SRC).toContain("el.querySelectorAll('.up-main tbody tr')")
    expect(SRC).toContain("hOf('.up-main thead')")
  })
})

describe('★★ ⑭ 읽기만 한다', () => {
  it('★ ⑭ 엑셀·인쇄를 눌러도 DB 로 아무것도 가지 않는다', async () => {
    await open(); await pressChip()
    const readsBefore = from.mock.calls.length
    await clickXlsx()
    await act(async () => { fireEvent.click(btn('인쇄')) }); await settle(6)
    expect(rpc, '저장 함수가 불렸다').not.toHaveBeenCalled()
    expect(from.mock.calls.length, '새로 읽은 것이 있다').toBe(readsBefore)
    expect(window.print).toHaveBeenCalled()
  })
  it('⑭-2 엑셀을 내려받으면 기존 알림 길로 알린다', async () => {
    await open(); await pressChip(); await clickXlsx()
    expect(onDoneMsg, '알림이 없다').not.toBeNull()
    expect(onDoneMsg.ok).toBe(true)
    expect(onDoneMsg.message).toContain('엑셀')
  })
})
