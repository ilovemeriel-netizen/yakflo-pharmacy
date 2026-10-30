/* 위치별 약품 창 — 정렬·구분 필터·원내 검색·가져오기.

   ★ 실제 컴포넌트를 그대로 띄운다. supabase 는 통째로 가짜로 바꿔 **질의에 붙은 조건과
     rpc 인자를 받아 적는다.** 「50건만 받는가」·「RPC 로 보내는가」를 소스 대조가 아니라
     실제 호출로 확인한다.

   ★ 고정하는 것
     ① 기본 정렬이 약품명 가나다순 · 머리글 건수 = 보이는 줄 수
     ② 구분 복수 필터(ColMenu) — 두 개를 골라도 메뉴가 닫히지 않는다
     ③ 검색은 서버로 가고, 입력이 멈춘 뒤 한 번만 나간다(디바운스)
     ④ 50건 상한 + 「더 좁혀」 안내 · 1,000행을 받지 않는다
     ⑤ 중지·이미 이 위치인 약품은 체크 불가(전체 선택에도 안 들어온다)
     ⑥ 가져오기 확인 문구에 「지금 위치」가 들어간다
     ⑦ 가져오기·이동이 RPC 한 번으로 나간다(원자성) · 실패하면 목록이 그대로다 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { SEARCH_LIMIT, DEBOUNCE_MS } from './lib/locPick'

/* ── D-1 에 있는 약품(중지 제외하고 서버가 준다) ───────────────────────── */
const HERE = [
  { id: 'h2', drug_code: 'BBB', drug_name: '나다라주', category: '주사제', current_qty: 5, status: '사용', storage_location: 'D-1' },
  { id: 'h1', drug_code: 'AAA', drug_name: '가나다정', category: '경구제', current_qty: 10, status: '사용', storage_location: 'D-1' },
  { id: 'h3', drug_code: 'CCC', drug_name: '다라마연고', category: '외용제', current_qty: 0, status: '휴면', storage_location: 'D-1' },
]
/* ── 원내 전체 검색이 돌려줄 것 — 중지·이미 D-1·다른 위치가 섞여 있다 ── */
const FOUND = [
  { id: 'h1', drug_code: 'AAA', drug_name: '가나다정', category: '경구제', current_qty: 10, status: '사용', storage_location: 'D-1' },
  { id: 's1', drug_code: 'DDD', drug_name: '가라마정', category: '경구제', current_qty: 3, status: '사용', storage_location: 'O-1' },
  { id: 's2', drug_code: 'EEE', drug_name: '가마바정', category: '경구제', current_qty: 7, status: '사용', storage_location: 'O-1' },
  { id: 's3', drug_code: 'FFF', drug_name: '가바사정', category: '주사제', current_qty: 1, status: '중지', storage_location: 'T-1' },
  { id: 's4', drug_code: 'GGG', drug_name: '가사아정', category: '경구제', current_qty: 2, status: '사용', storage_location: null },
]
const VOCAB = [
  { label: '임시보관(미지정)', code: '보관 위치를 정하기 전 잠시 두는 약품', sort_order: 0, is_system: true, is_active: true },
  { label: 'D-1', code: 'D-1', sort_order: 1, is_system: false, is_active: true },
  { label: 'O-1', code: '주사 냉장', sort_order: 2, is_system: false, is_active: true },
]

const calls = []          /* from() 질의 */
const rpcs = []           /* rpc() 호출 */
let searchExtra = []      /* 50건 상한 시험용으로 결과를 부풀린다 */
let rpcResult = { data: 0, error: null }

vi.mock('./lib/supabase', () => {
  const result = (data, error = null) => Promise.resolve({ data, error })
  function from(table) {
    const st = { table, eq: {}, in: null, or: null, range: null }
    calls.push(st)
    const q = {
      select(c) { st.cols = c; return q },
      in(col, vals) { st.in = { col, vals }; return q },
      eq(col, v) { st.eq[col] = v; return q },
      or(s) { st.or = s; return q },
      order() { return q },
      limit() { return q },
      range(a, b) {
        st.range = [a, b]
        if (table === 'drugs' && st.or) return result([...FOUND, ...searchExtra].slice(a, b + 1))
        if (table === 'drugs') return result(HERE.map(d => ({ ...d })))
        return result([])
      },
      then(res) {
        if (table === 'location_vocab') return result(VOCAB.map(v => ({ ...v }))).then(res)
        return result([]).then(res)
      },
    }
    return q
  }
  return {
    supabase: {
      from,
      rpc: (name, args) => { rpcs.push({ name, args }); return Promise.resolve(rpcResult) },
      auth: { getUser: () => result(null) },
    },
  }
})

const T = {
  bg: '#F7F6F3', card: '#fff', cardSolid: '#fff', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, profile: { id: 'u1' }, memberRole: 'owner' }) }
})

let LocDrugsModal
beforeEach(async () => {
  calls.length = 0; rpcs.length = 0; searchExtra = []; rpcResult = { data: 0, error: null }
  if (!LocDrugsModal) LocDrugsModal = (await import('./App.jsx')).LocDrugsModal
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const open = (props = {}) => render(<LocDrugsModal loc="D-1" desc="" onClose={() => {}} onSaved={() => {}} onFlash={() => {}} {...props} />)
const bodyRows = () => [...document.querySelectorAll('tbody tr')]
const nameAt = i => bodyRows()[i].querySelectorAll('td')[2].textContent.trim()
const boxes = () => [...document.querySelectorAll('tbody input[type="checkbox"]')]
const headCount = () => [...document.querySelectorAll('div')].filter(e => /^(원내 검색 )?[\d,]+건$/.test(e.textContent.trim())).map(e => e.textContent.trim())[0] || ''

describe('① 기본 정렬과 건수', () => {
  it('약품명 가나다순으로 보인다', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect([nameAt(0), nameAt(1), nameAt(2)]).toEqual(['가나다정', '나다라주', '다라마연고'])
  })
  it('머리글 건수 = 보이는 줄 수', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect(headCount()).toContain('3건')
  })
  it('이 위치 목록은 중지를 빼고 조회한다 (#372 규칙 유지)', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    const c = calls.find(x => x.table === 'drugs' && x.eq.storage_location === 'D-1')
    expect(c.in).toEqual({ col: 'status', vals: ['사용', '휴면'] })
  })
})

describe('② 구분 복수 필터 (공용 ColMenu)', () => {
  async function openCatMenu() {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    fireEvent.click(screen.getByTitle('필터'))
    await waitFor(() => expect(screen.getByRole('button', { name: /^전체/ })).toBeTruthy())
  }
  it('머리글에서 메뉴가 열리고 구분 목록이 보인다', async () => {
    await openCatMenu()
    for (const c of ['경구제', '주사제', '외용제']) expect(screen.getByRole('button', { name: new RegExp('^' + c) })).toBeTruthy()
  })
  it('하나를 끄면 그 구분이 사라지고 건수도 함께 준다', async () => {
    await openCatMenu()
    fireEvent.click(screen.getByRole('button', { name: /^주사제/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(headCount()).toContain('2건')
    expect(bodyRows().map((_, i) => nameAt(i))).not.toContain('나다라주')
  })
  it('★ 복수 선택 — 고를 때마다 메뉴가 닫히지 않는다', async () => {
    await openCatMenu()
    fireEvent.click(screen.getByRole('button', { name: /^주사제/ }))
    expect(screen.queryByRole('button', { name: /^외용제/ }), '메뉴가 열린 채여야 한다').toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^외용제/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(nameAt(0)).toBe('가나다정')
  })
  it('「전체」로 한 번에 되돌린다', async () => {
    await openCatMenu()
    fireEvent.click(screen.getByRole('button', { name: /^주사제/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /^전체/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
  })
})

describe('③④ 원내 전체 검색 — 디바운스·상한', () => {
  const typeSearch = async (text) => {
    const box = screen.getByPlaceholderText('약품코드 · 약품명 검색')
    for (const ch of text) fireEvent.change(box, { target: { value: box.value + ch } })
    return box
  }
  it('★ 입력이 멈춘 뒤 한 번만 조회한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    open()
    await vi.advanceTimersByTimeAsync(10)
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    const before = calls.filter(c => c.or).length
    await typeSearch('가나')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 50)
    expect(calls.filter(c => c.or).length, '아직 안 나갔다').toBe(before)
    await vi.advanceTimersByTimeAsync(100)
    await waitFor(() => expect(calls.filter(c => c.or).length).toBe(before + 1))
  })
  it('검색은 원내 전체를 본다 — 상태 조건을 걸지 않는다', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    await typeSearch('가')
    await waitFor(() => expect(calls.some(c => c.or)).toBe(true))
    const s = calls.find(c => c.or)
    expect(s.in, '상태 조건 없음').toBe(null)
    expect(s.eq.storage_location, '위치 조건 없음').toBeUndefined()
    expect(s.or).toContain('drug_name.ilike')
    expect(s.or).toContain('drug_code.ilike')
  })
  it('★ 50건 + 1 만 받는다 — 1,000행을 받지 않는다', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    await typeSearch('가')
    await waitFor(() => expect(calls.some(c => c.or)).toBe(true))
    expect(calls.find(c => c.or).range).toEqual([0, SEARCH_LIMIT])
    expect(calls.every(c => !c.range || c.range[1] <= 999)).toBe(true)
  })
  it('50건을 넘으면 「더 좁혀 검색해 주세요」가 뜬다', async () => {
    searchExtra = Array.from({ length: 60 }, (_, i) => ({
      id: 'x' + i, drug_code: 'X' + i, drug_name: '가짜' + i, category: '경구제',
      current_qty: 0, status: '사용', storage_location: 'O-1',
    }))
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    await typeSearch('가')
    await waitFor(() => expect(screen.getByText(/더 좁혀 검색해 주세요/)).toBeTruthy())
    expect(bodyRows().length).toBe(SEARCH_LIMIT)
  })
})

describe('⑤ 검색 결과에서 고를 수 없는 줄', () => {
  async function search() {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    fireEvent.change(screen.getByPlaceholderText('약품코드 · 약품명 검색'), { target: { value: '가' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(FOUND.length))
  }
  it('검색 중에만 「현재 위치」 열이 보인다', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect(screen.queryByText('현재 위치')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('약품코드 · 약품명 검색'), { target: { value: '가' } })
    await waitFor(() => expect(screen.getByText('현재 위치')).toBeTruthy())
  })
  it('★ 중지 약품은 체크할 수 없다', async () => {
    await search()
    const i = FOUND.findIndex(d => d.status === '중지')
    expect(boxes()[i].disabled).toBe(true)
    expect(boxes()[i].title).toContain('중지')
  })
  it('★ 이미 이 위치에 있는 약품도 체크할 수 없다', async () => {
    await search()
    const i = FOUND.findIndex(d => d.storage_location === 'D-1')
    expect(boxes()[i].disabled).toBe(true)
    expect(boxes()[i].title).toContain('이미')
  })
  it('가져올 수 있는 줄만 켜져 있다', async () => {
    await search()
    expect(boxes().filter(b => !b.disabled)).toHaveLength(3)   /* O-1 둘 + 위치 없음 하나 */
  })
  it('★ 전체 선택도 고를 수 있는 줄만 집는다', async () => {
    await search()
    fireEvent.click(screen.getByTitle('전체 선택'))
    await waitFor(() => expect(screen.getByText(/3건 선택됨/)).toBeTruthy())
  })
})

/* ★ 시안 캡처 — 손으로 만든 모형이 아니라 **실제 렌더 결과**를 떠 둔다(함정 #27).
   CAPTURE_DIR 이 있을 때만 파일로 남기고, 없으면 상태가 실제로 달라지는지만 확인한다. */
describe('⑧ 시안 캡처', () => {
  const dir = process.env.CAPTURE_DIR
  const shot = (name, html) => {
    if (!dir) return
    mkdirSync(dir, { recursive: true })
    writeFileSync(dir + '/' + name + '.html', html, 'utf8')
  }
  /* 모달 본체 + 포털로 띄운 메뉴를 함께 담는다 — 메뉴는 document.body 밑에 붙는다 */
  const frame = () => {
    const modal = document.querySelector('[style*="position: fixed"]')
    const menus = [...document.body.children].filter(el => !el.contains(modal) && el !== modal.parentElement)
    return (modal ? modal.outerHTML : '') + menus.map(m => m.innerHTML).join('')
  }

  it('01~05 를 떠 둔다', async () => {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    const s01 = document.body.innerHTML
    shot('01_default', s01)
    expect(headCount()).toContain('3건')

    fireEvent.click(screen.getByTitle('필터'))
    await waitFor(() => expect(screen.getByRole('button', { name: /^전체/ })).toBeTruthy())
    const s02 = document.body.innerHTML
    shot('02_filter_menu', s02)
    expect(s02).not.toBe(s01)

    fireEvent.click(screen.getByRole('button', { name: /^주사제/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    shot('03_filter_applied', document.body.innerHTML)
    expect(headCount()).toContain('2건')

    fireEvent.click(screen.getByRole('button', { name: /^전체/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(screen.getByPlaceholderText('약품코드 · 약품명 검색'), { target: { value: '가' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(FOUND.length))
    shot('04_search', document.body.innerHTML)
    expect(screen.getByText('현재 위치')).toBeTruthy()

    const b = boxes()
    fireEvent.click(b[FOUND.findIndex(d => d.id === 's1')])
    fireEvent.click(b[FOUND.findIndex(d => d.id === 's2')])
    await waitFor(() => expect(screen.getByText(/2건 선택됨/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '이 위치로 가져오기' }))
    await waitFor(() => expect(screen.getByText(/2건을 「D-1」로 옮깁니다/)).toBeTruthy())
    shot('05_pick_confirm', document.body.innerHTML)
  })
})

describe('⑥⑦ 이 위치로 가져오기', () => {
  async function pickTwo() {
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    fireEvent.change(screen.getByPlaceholderText('약품코드 · 약품명 검색'), { target: { value: '가' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(FOUND.length))
    const b = boxes()
    fireEvent.click(b[FOUND.findIndex(d => d.id === 's1')])
    fireEvent.click(b[FOUND.findIndex(d => d.id === 's2')])
    await waitFor(() => expect(screen.getByText(/2건 선택됨/)).toBeTruthy())
  }
  it('확인 문구에 목적지와 「지금 위치」가 들어간다', async () => {
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: '이 위치로 가져오기' }))
    await waitFor(() => expect(screen.getByText(/2건을 「D-1」로 옮깁니다/)).toBeTruthy())
    expect(screen.getByText(/지금 위치: O-1 2건/)).toBeTruthy()
  })
  it('★ RPC 한 번으로 나간다 — 청크로 쪼개지 않는다', async () => {
    rpcResult = { data: 2, error: null }
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: '이 위치로 가져오기' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '가져오기' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(rpcs[0].name).toBe('app_move_drug_location')
    expect(rpcs[0].args.p_dest).toBe('D-1')
    expect(rpcs[0].args.p_ids.sort()).toEqual(['s1', 's2'])
  })
  it('★ RPC 가 실패하면 아무것도 반영하지 않는다', async () => {
    rpcResult = { data: null, error: { message: '중지된 약품 1건이 들어 있어 옮기지 않았습니다' } }
    const flashed = []
    open({ onFlash: (m, k) => flashed.push([m, k]) })
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    fireEvent.change(screen.getByPlaceholderText('약품코드 · 약품명 검색'), { target: { value: '가' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(FOUND.length))
    fireEvent.click(boxes()[FOUND.findIndex(d => d.id === 's1')])
    fireEvent.click(screen.getByRole('button', { name: '이 위치로 가져오기' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '가져오기' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '가져오기' }))
    await waitFor(() => expect(flashed.some(f => f[1] === 'err')).toBe(true))
    expect(screen.getByPlaceholderText('약품코드 · 약품명 검색').value, '검색어가 그대로다').toBe('가')
  })
  it('이동(목적지 선택)도 같은 RPC 로 나간다', async () => {
    rpcResult = { data: 1, error: null }
    open()
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    fireEvent.click(boxes()[0])
    await waitFor(() => expect(screen.getByText(/1건 선택됨/)).toBeTruthy())
    fireEvent.change(document.querySelector('select'), { target: { value: 'O-1' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '이동' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '이동' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '확인' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(rpcs[0].name).toBe('app_move_drug_location')
    expect(rpcs[0].args.p_dest).toBe('O-1')
  })
})
