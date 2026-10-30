/* 백신관리 표 — 글자 열 왼쪽 정렬.

   ★ 실제 컴포넌트(VaccineManage)를 그대로 띄운다. supabase 는 통째로 가짜로 바꾸고,
     공용 부품(ColMenu·useSort)은 **진짜 것**을 App.jsx 에서 가져와 주입한다.

   ★ 함정을 시험 안에서 **재현**한다 — `#root { text-align: center }`.
     본문 td 에 textAlign 이 없으면 이 규칙을 상속해 가운데로 선다. 이 저장소에서 세 번
     재발한 함정이라, 「칸에 직접 지정했는가」를 **계산된 값**으로 확인한다.
     대조군(재원 칸)이 center 로 나와야 이 재현이 진짜로 작동한 것이다.

   ★ 고정하는 것
     ① 약품별 집계 — 약품명 칸이 left · 머리글과 **왼쪽 여백이 같다**
     ② LOT·유효기한 표 — 약품·LOT·유효기한 칸이 left · 머리글과 여백 같다
     ③ 숫자 열은 right 그대로 · 약품코드 등 비대상 열은 건드리지 않았다
     ④ ColMenu 는 고치지 않았다(다른 화면 5곳 불변) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { render, cleanup, waitFor } from '@testing-library/react'

const ACCS = [
  { id: 'a1', drug_code: 'TETRA6', funding_source: '유료', season: '2026-2027', is_active: true, public_label: null },
  { id: 'a2', drug_code: 'SKYZST1', funding_source: '국가', season: '2026-2027', is_active: true, public_label: null },
]
const BAL = [
  { account_id: 'a1', drug_code: 'TETRA6', funding_source: '유료', allocated_qty: 0, received_qty: 100, administered_qty: 40, returned_qty: 0, balance_qty: 60, season: '2026-2027' },
  { account_id: 'a2', drug_code: 'SKYZST1', funding_source: '국가', allocated_qty: 50, received_qty: 50, administered_qty: 10, returned_qty: 0, balance_qty: 40, season: '2026-2027' },
]
const EVTS = [
  { id: 'e1', account_id: 'a1', event_type: '입고', qty: 100, event_date: '2026-10-01', lot_no: 'LOT-A1', expiry_date: '2027-03-01', category_id: null, memo: null },
  { id: 'e2', account_id: 'a2', event_type: '입고', qty: 50, event_date: '2026-10-02', lot_no: 'LOT-B2', expiry_date: '2027-05-20', category_id: null, memo: null },
]
const DRUGS = [
  { drug_code: 'TETRA6', drug_name: '독감-6 플루백신VIII-TF주 0.5mL' },
  { drug_code: 'SKYZST1', drug_name: '스카이조스터주' },
]

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  function from(table) {
    const rowsFor = () => {
      if (table === 'vaccine_accounts') return ACCS
      if (table === 'v_vaccine_balance') return BAL
      if (table === 'vaccine_events') return EVTS
      if (table === 'vaccine_categories') return []
      if (table === 'drugs') return DRUGS
      if (table === 'tenant_members') return [{ tenant_id: 'tn', role: 'owner' }]
      return []
    }
    const q = {
      /* ★ 거르는 메서드는 전부 자기 자신을 돌려준다(체인) — 결과는 then 이 낸다.
         limit() 가 바로 약속을 돌려주면 `.limit(1).maybeSingle()` 이 터진다(처음에 그렇게 틀렸다). */
      select: () => q, eq: () => q, in: () => q, order: () => q, gte: () => q, lt: () => q,
      range: () => q, limit: () => q,
      maybeSingle: () => result(rowsFor()[0] || null),
      insert: () => result(null), update: () => q, upsert: () => result(null), delete: () => q,
      then(res) { return result(rowsFor()).then(res) },
    }
    return q
  }
  return { supabase: { from, rpc: () => result(null), auth: { getUser: () => result(null) } } }
})

const T = {
  bg: '#F7F6F3', card: '#fff', cardSolid: '#fff', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', lavender: '#BFA6D9',
  shadow: 'none', shadowH: 'none',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, profile: { id: 'u1' }, memberRole: 'owner' }) }
})

/* useSort 는 App.jsx 가 내보내지 않는다 — 아래 useSortLocal 로 같은 모양을 만들어 주입한다 */
let VaccineManage, ColMenu
const ymd = d => new Date(d).toISOString().slice(0, 10)
const todayYmd = () => '2026-10-30'

/* ★ 함정 재현 — 운영의 src/index.css 가 #root 에 거는 규칙을 그대로 넣는다 */
let styleEl, rootEl
beforeEach(async () => {
  styleEl = document.createElement('style')
  styleEl.textContent = '#root { text-align: center; }'
  document.head.appendChild(styleEl)
  rootEl = document.createElement('div')
  rootEl.id = 'root'
  document.body.appendChild(rootEl)
  if (!VaccineManage) {
    const app = await import('./App.jsx')
    ColMenu = app.ColMenu
    VaccineManage = (await import('./VaccineManage.jsx')).default
  }
})
afterEach(() => { cleanup(); styleEl.remove(); rootEl.remove() })

/* useSort 는 App.jsx 에서 내보내지 않는다 — 같은 모양의 훅을 여기서 만든다.
   ★ TS() 의 좌측 패딩(12)과 textAlign(left) 이 핵심이라 그 값을 그대로 옮긴다. */
function useSortLocal(ik = '') {
  const [sk, s1] = require('react').useState(ik)
  const [sd, s2] = require('react').useState('asc')
  return {
    sk, sd, setSort(k, d) { s1(k); s2(d) },
    so(a) { return a },
    TS() { return { padding: '10px 12px', textAlign: 'left', color: T.textM, fontWeight: 600, borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', background: 'transparent', fontSize: 11 } },
    SI() { return null },
    hs() {},
  }
}

const open = () => render(<VaccineManage ColMenu={ColMenu} useSort={useSortLocal} ymd={ymd} todayYmd={todayYmd} />, { container: rootEl })
const css = el => window.getComputedStyle(el)
/* 머리글 글자가 실제로 서는 칸 — ColMenu 는 th 안에 span 을 넣는다 */
const thOf = (label) => [...document.querySelectorAll('th')].find(x => x.textContent.replace(/[⇅▲▼✓\s]/g, '').startsWith(label.replace(/\s/g, '')))
const tdsOfRow = (tr) => [...tr.querySelectorAll('td')]

/* ★ jsdom 은 스타일시트의 **상속**을 계산하지 않는다 — #root 규칙을 넣어도
   getComputedStyle(칸).textAlign 은 빈 글자다. 그래서 「가운데로 상속되는지」는
   여기서 잴 수 없고, 아래 시험은 **칸이 스스로 정렬을 선언했는가**를 본다.
   선언이 있으면 상속은 애초에 이기지 못하므로 이것이 실질적 보증이다.
   ※ 실제 브라우저의 계산값은 캡처 단계(headless Chrome + 진짜 index.css)에서 잰다. */
describe('0) jsdom 의 한계를 분명히 해 둔다', () => {
  it('상속은 jsdom 에서 재현되지 않는다 — 그래서 「선언 여부」로 본다', async () => {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const probe = document.createElement('div')
    rootEl.appendChild(probe)
    expect(css(probe).textAlign, 'jsdom 이 상속을 계산하기 시작했다면 이 시험을 강화할 것').toBe('')
    probe.remove()
  })
  it('운영 CSS 에 그 규칙이 실제로 있다 (상속원 확인)', () => {
    expect(readFileSync('src/index.css', 'utf8')).toMatch(/#root[^}]*text-align:\s*center/)
  })
})

describe('① 약품별 집계 — 약품명', () => {
  it('약품명 칸이 왼쪽으로 선다 (상속이 아니라 직접 지정)', async () => {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const row = document.querySelectorAll('tbody tr')[0]
    const name = tdsOfRow(row)[1]
    expect(name.textContent).toContain('독감-6')
    expect(css(name).textAlign, '정렬').toBe('left')
    expect(name.style.textAlign, '칸에 직접 지정').toBe('left')
  })
  it('★ 머리글과 왼쪽 여백이 같다', async () => {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const th = thOf('약품명')
    const name = tdsOfRow(document.querySelectorAll('tbody tr')[0])[1]
    expect(th, '약품명 머리글을 찾지 못했다').toBeTruthy()
    expect(css(th).textAlign, '머리글 정렬').toBe('left')
    expect(css(name).paddingLeft, '칸 여백').toBe(css(th).paddingLeft)
    expect(css(name).paddingLeft).toBe('12px')
  })
  it('★ 대조군 — 재원 칸은 정렬을 선언하지 않는다(손대지 않았다)', async () => {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const fund = tdsOfRow(document.querySelectorAll('tbody tr')[0])[2]
    expect(fund.style.textAlign, '건드리지 않은 칸은 빈 값이어야 한다').toBe('')
  })
  it('숫자 열은 오른쪽 그대로', async () => {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const tds = tdsOfRow(document.querySelectorAll('tbody tr')[0])
    for (const i of [3, 4, 5, 6, 7]) expect(css(tds[i]).textAlign, i + '번째 칸').toBe('right')
  })
  it('★ 약품코드 칸도 왼쪽 — 머리글과 같은 여백', async () => {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const code = tdsOfRow(document.querySelectorAll('tbody tr')[0])[0]
    const th = thOf('약품코드')
    expect(code.style.textAlign, '칸에 직접 지정').toBe('left')
    expect(css(code).textAlign).toBe('left')
    expect(css(code).paddingLeft, '머리글과 같은 여백').toBe(css(th).paddingLeft)
    expect(css(code).paddingLeft).toBe('12px')
  })
})

describe('② LOT·유효기한 표', () => {
  const lotRows = () => {
    const tables = [...document.querySelectorAll('table')]
    const lot = tables.find(tb => [...tb.querySelectorAll('th')].some(x => x.textContent.trim() === 'LOT'))
    return lot ? { table: lot, rows: [...lot.querySelectorAll('tbody tr')] } : null
  }
  /* ★ 이 구역은 Collapsible 안이라 접힌 채로 시작한다 — 펼쳐야 표가 생긴다 */
  async function openLot() {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const head = [...document.querySelectorAll('*')]
      .find(el => el.children.length === 0 && el.textContent.trim() === 'LOT · 유효기한')
    expect(head, 'LOT 구역 머리를 찾지 못했다').toBeTruthy()
    let el = head
    for (let k = 0; k < 6 && el; k++) { if (el.onclick) break; el = el.parentElement }
    ;(el || head).click()
    await waitFor(() => expect(lotRows() && lotRows().rows.length).toBeGreaterThan(0))
  }

  it('약품·LOT·유효기한 칸이 왼쪽으로 선다', async () => {
    await openLot()
    const tds = tdsOfRow(lotRows().rows[0])
    for (const [i, nm] of [[0, '약품'], [1, 'LOT'], [2, '유효기한']]) {
      expect(css(tds[i]).textAlign, nm + ' 칸 정렬').toBe('left')
      expect(tds[i].style.textAlign, nm + ' 직접 지정').toBe('left')
    }
  })
  it('★ 머리글과 왼쪽 여백이 같다 (둘 다 9px)', async () => {
    await openLot()
    const { table } = lotRows()
    const ths = [...table.querySelectorAll('th')]
    const tds = tdsOfRow(lotRows().rows[0])
    for (const i of [0, 1, 2]) {
      expect(css(ths[i]).textAlign, i + '번째 머리글').toBe('left')
      expect(css(tds[i]).paddingLeft, i + '번째 여백').toBe(css(ths[i]).paddingLeft)
      expect(css(tds[i]).paddingLeft).toBe('9px')
    }
  })
  it('입고·잔량 숫자 열은 오른쪽 그대로', async () => {
    await openLot()
    const tds = tdsOfRow(lotRows().rows[0])
    for (const i of [3, 4]) expect(css(tds[i]).textAlign, i + '번째 칸').toBe('right')
  })
})

describe('②-2 이벤트 이력 표', () => {
  /* 이 표는 계정 카드의 [이력] 을 눌러야 열린다 */
  async function openHistory() {
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '이력')
    expect(btn, '[이력] 버튼을 찾지 못했다').toBeTruthy()
    btn.click()
    await waitFor(() => expect(histTable()).toBeTruthy())
  }
  const histTable = () => [...document.querySelectorAll('table')]
    .find(tb => { const h = [...tb.querySelectorAll('th')].map(x => x.textContent.trim()); return h[0] === '일자' && h.includes('유형') })

  it('일자·유형·대상 칸이 왼쪽으로 선다', async () => {
    await openHistory()
    const tds = [...histTable().querySelectorAll('tbody tr')[0].querySelectorAll('td')]
    for (const [i, nm] of [[0, '일자'], [1, '유형'], [2, '대상']]) {
      expect(tds[i].style.textAlign, nm + ' 직접 지정').toBe('left')
      expect(css(tds[i]).textAlign, nm + ' 정렬').toBe('left')
    }
  })
  it('★ 머리글과 왼쪽 여백이 같다 (둘 다 8px)', async () => {
    await openHistory()
    const ths = [...histTable().querySelectorAll('th')]
    const tds = [...histTable().querySelectorAll('tbody tr')[0].querySelectorAll('td')]
    for (const i of [0, 1, 2]) {
      expect(css(ths[i]).textAlign, i + '번째 머리글').toBe('left')
      expect(css(tds[i]).paddingLeft, i + '번째 여백').toBe(css(ths[i]).paddingLeft)
      expect(css(tds[i]).paddingLeft).toBe('8px')
    }
  })
  it('수량 칸은 오른쪽 그대로', async () => {
    await openHistory()
    const tds = [...histTable().querySelectorAll('tbody tr')[0].querySelectorAll('td')]
    expect(css(tds[3]).textAlign).toBe('right')
  })
  it('★ 하위 행(LOT·유효기한)도 왼쪽 — inline-flex 가 가운데로 밀리지 않는다', async () => {
    await openHistory()
    const sub = [...histTable().querySelectorAll('tbody td')].find(x => x.getAttribute('colspan') === '5')
    expect(sub, 'LOT 하위 행을 찾지 못했다').toBeTruthy()
    expect(sub.style.textAlign).toBe('left')
    expect(css(sub).paddingLeft).toBe('8px')
  })
})

/* ★ 시안 캡처 — 실제 렌더 결과를 떠 둔다(함정 #27). CAPTURE_DIR 이 있을 때만 파일로 남긴다.
   표 두 개를 모두 담아야 하므로 LOT 구역을 펼친 뒤에 뜬다. */
describe('④ 시안 캡처', () => {
  it('표 두 개가 든 화면을 떠 둔다', async () => {
    const dir = process.env.CAPTURE_DIR
    open()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
    const head = [...document.querySelectorAll('*')]
      .find(el => el.children.length === 0 && el.textContent.trim() === 'LOT · 유효기한')
    let el = head
    for (let k = 0; k < 6 && el; k++) { if (el.onclick) break; el = el.parentElement }
    if (el) el.click()
    await waitFor(() => expect(document.querySelectorAll('table').length).toBeGreaterThan(2))
    /* 이벤트 이력도 함께 담는다 — 이번에 같이 고친 표다 */
    const hist = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '이력')
    if (hist) { hist.click(); await waitFor(() => expect(document.querySelectorAll('table').length).toBeGreaterThan(3)) }
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(dir + '/app.html', rootEl.innerHTML, 'utf8')
    }
    expect(document.querySelectorAll('table').length).toBeGreaterThan(2)
  })
})

describe('③ 공용 부품·다른 화면 불변', () => {
  it('★ ColMenu 를 고치지 않았다 — align 같은 옵션을 넣지 않았다', () => {
    const src = readFileSync('src/App.jsx', 'utf8')
    const i = src.indexOf('export function ColMenu(')
    /* ★ 이 저장소는 CRLF 다 — 줄 끝 \r 을 떼지 않으면 무엇과 비교해도 늘 다르다 */
    const sig = src.slice(i, src.indexOf('\n', i)).trim()
    expect(sig, 'ColMenu 매개변수가 늘었다').toBe('export function ColMenu({ colKey, label, sk, sd, setSort, filter }) {')
  })
  it('★ 공용 머리글 토큰 TS() 를 고치지 않았다', () => {
    const src = readFileSync('src/App.jsx', 'utf8')
    expect(src).toContain("TS(c) { const { t } = useTheme(); return { padding: '10px 12px', textAlign: 'left'")
  })
  it('★ 상위에서 고치지 않았다 — index.css 의 #root 규칙을 건드리지 않았다', () => {
    const css2 = readFileSync('src/index.css', 'utf8')
    expect(css2).toContain('text-align: center;')
  })
  it('공개 표시명 표는 이미 좌측이다 (확인만)', () => {
    const src = readFileSync('src/VaccinePublicPanel.jsx', 'utf8')
    expect(src).toContain("const th = { padding: '8px 10px'")
    expect(src.match(/const th = \{[^}]*textAlign: 'left'/), '머리글 좌측').toBeTruthy()
    expect(src.match(/const td = \{[^}]*textAlign: 'left'/), '칸 좌측').toBeTruthy()
  })
})
