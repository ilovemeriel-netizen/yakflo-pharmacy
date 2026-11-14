/* 읽기 전용(viewer) — 「사용량 갱신」·「마약·향정 사용량 보기」를 **보여 주되 쓰기만 막는다**
 * (2026-11-14 이정화 님 업무 규칙 변경 · 승인)
 *
 * 바뀐 규칙
 *   전: 뷰어에게 메뉴 칸부터 **안 보였다**. 주소로 들어와도 「관리자만 볼 수 있는 화면입니다」였다.
 *   후: 뷰어도 **화면을 본다**. 쓰기 동작(출고 자동집계 · 고른 N종 적용 · 줄 체크)만
 *       기존 읽기 전용 모양(흐림 · 못 누름)이 된다.
 *   까닭: 뷰어는 약플로 **전체 흐름을 보기 위한** 계정이다. 숨기면 흐름이 끊긴다.
 *
 * ★ 관리자(owner·admin)와 **일반(member)** 의 보임/숨김은 **한 글자도 바뀌지 않는다.**
 *   일반은 전과 같이 메뉴도 화면도 못 본다 — 이 시험이 그것을 못 박는다.
 *
 * ★ 진짜 자물쇠는 화면이 아니다 — DB 의 `trg_viewer_readonly`(표 33개)와
 *   `app_save_usage_bulk`·`app_recompute_usage` 의 관리자 검사가 막는다.
 *   여기 흐림·못 누름은 **헛수고를 줄이는 안내**일 뿐이다(lib/readOnly.js 머리말과 같은 뜻).
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
const channel = vi.fn()
vi.mock('./lib/supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a), from: (...a) => from(...a),
    channel: (...a) => channel(...a), removeChannel: () => {},
  },
}))

const UsageCompareModal = (await import('./UsageCompareModal')).default
const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const UCM = readFileSync(resolve(process.cwd(), 'src/UsageCompareModal.jsx'), 'utf8')
const NUM = readFileSync(resolve(process.cwd(), 'src/NarcoticUsageModal.jsx'), 'utf8')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadow: '0 2px 8px rgba(46,74,98,0.06)', shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, atc_code: '',
  __unusedSnaps: { 3: 3, 6: 6, 9: 9, 12: 10 }, ...o })
const DRUGS = [
  D({ drug_code: 'AAA', drug_name: '가나다정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'BBB', drug_name: '하하하정', recent_3m_usage: 300, recent_1m_usage: 100, monthly_avg: 100, safety_stock: 120 }),
]
const TX = [
  { drug_code: 'AAA', type: '출고', transaction_date: '2026-09-10', quantity: 9 },
  { drug_code: 'BBB', type: '출고', transaction_date: '2026-09-11', quantity: 600 },
]
function mockTx() {
  let lo = 0, hi = 1e9
  const c = {}
  for (const k of ['select', 'eq', 'gte', 'lt', 'order', 'limit']) c[k] = () => c
  c.range = (a, b) => { lo = a; hi = b; return c }
  c.maybeSingle = () => Promise.resolve({ data: { snap_year: 2026, snap_month: 10 }, error: null })
  c.then = res => Promise.resolve({ data: TX.slice(lo, hi + 1), count: TX.length, error: null }).then(res)
  return c
}
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
const Confirm = ({ confirm, onConfirm }) => <button type="button" onClick={onConfirm}>{confirm}</button>
function useSortReal(init) {
  const [v, set] = useState({ sk: init || '', sd: 'asc' })
  return { sk: v.sk, sd: v.sd, setSort: (k, d) => set({ sk: k, sd: d || 'asc' }) }
}
const Head = ({ colKey, label, setSort, sd, sk, filter }) => (
  <span data-head={colKey}>
    <button data-sort={colKey} onClick={() => setSort(colKey, sk === colKey && sd === 'asc' ? 'desc' : 'asc')}>{label}</button>
    {filter && <span data-menu={colKey}>{filter.items.map(v => <button key={v} data-item={v} onClick={() => filter.on(v)}>{v}</button>)}</span>}
  </span>
)
/* asScreen = 「사용량 갱신」 화면. onRecompute 를 주면 제목 줄에 「출고 자동집계」가 선다. */
const openScreen = async (props = {}) => {
  const r = render(<UsageCompareModal asScreen t={T} drugs={DRUGS} year={2026} month={10}
    onClose={() => {}} onReload={() => {}} Confirm={Confirm} ColMenu={Head} useSort={useSortReal}
    onRecompute={() => {}} {...props} />)
  await settle()
  return r
}
const recomputeBtn = () => screen.queryByRole('button', { name: '출고 자동집계' })
const applyBtn = () => screen.queryByRole('button', { name: /^고른 \d+종 적용$/ })
const rowBox = () => screen.getByLabelText('가나다정 적용하기')

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: { saved: 2 }, error: null })
  from.mockReset(); from.mockImplementation(() => mockTx())
  channel.mockReset()
  channel.mockImplementation(() => { const ch = { on: () => ch, subscribe: () => ch }; return ch })
})
afterEach(() => cleanup())

describe('★★ ① 뷰어는 「사용량 갱신」 화면을 **본다**', () => {
  /* ★★ 2026-11-14(저녁) — 메뉴 칸이 없어지고 **재고현황 안 탭**이 되었다.
       뷰어는 재고현황을 보므로 탭도 보인다. 쓰기는 아래 ② 가 지킨다. */
  it('★ 메뉴 칸 대신 재고현황 탭이 되었다 — 뷰어도 재고현황을 본다', () => {
    expect(APP.includes(`{ id: 'usageupdate', l: '사용량 갱신' }`), '메뉴 칸이 남아 있다').toBe(false)
    expect(APP).toContain(`const stockTab = useSyncExternalStore(`)
    /* ★ _mgr 의 뜻은 **그대로**다 — 계정관리 「관리」 단추가 아직 쓴다 */
    expect(APP).toContain(`const _mgr = memberRole !== VIEWER_ROLE && (memberRole === 'owner' || memberRole === 'admin')`)
  })

  it('★ 주소로 들어온 뷰어를 **막지 않는다** — 일반(member)은 전과 같이 막는다', () => {
    const i = APP.indexOf('function UsageUpdateView({ drugs, onReload }) {')
    expect(i, '화면 부품을 찾지 못했다').toBeGreaterThan(0)
    const fn = APP.slice(i, i + 2600)
    expect(fn).toContain(`const isViewer = memberRole === VIEWER_ROLE`)
    expect(fn).toContain('if (!isTenantManager && !isViewer) return')
    expect(fn).toContain('관리자만 볼 수 있는 화면입니다.')   /* 일반에게 쓰던 글은 그대로 */
  })

  it('★ 화면이 뷰어 여부를 모달에 넘긴다', () => {
    expect(APP).toContain('isTenantManager={isTenantManager} readOnly={isViewer}')
  })

  it('★★ 단추가 못 눌려도 자동집계는 **함수에서 한 번 더 멈춘다**', () => {
    const i = APP.indexOf('async function recompute() {')
    expect(i).toBeGreaterThan(0)
    expect(APP.slice(i, i + 160)).toContain('if (isViewer) return')
  })
})

describe('★★ ② 쓰기 동작은 보이되 흐림·못 누름', () => {
  it('★ 뷰어 — 「출고 자동집계」가 **보이고** 못 눌린다', async () => {
    await openScreen({ readOnly: true, isTenantManager: false })
    const b = recomputeBtn()
    expect(b, '단추가 사라지면 안 된다 — 보여 주되 막는 것이다').toBeTruthy()
    expect(b.disabled).toBe(true)
    expect(b.style.opacity).toBe('0.45')
    expect(b.style.cursor).toBe('default')
  })

  it('★ 뷰어 — 「고른 N종 적용」이 **보이고** 못 눌린다', async () => {
    await openScreen({ readOnly: true, isTenantManager: false })
    const b = applyBtn()
    expect(b, '적용 단추가 사라지면 흐름이 끊긴다').toBeTruthy()
    expect(b.disabled).toBe(true)
    expect(b.style.opacity).toBe('0.6')   /* btn() 이 쓰던 기존 흐림값 */
  })

  it('★ 뷰어 — 줄 체크상자가 못 눌린다', async () => {
    await openScreen({ readOnly: true, isTenantManager: false })
    expect(rowBox().disabled).toBe(true)
    expect(rowBox().style.cursor).toBe('default')
  })

  it('★★ 관리자는 **전과 똑같이** 셋 다 눌린다', async () => {
    await openScreen({ isTenantManager: true })
    expect(recomputeBtn().disabled).toBe(false)
    expect(recomputeBtn().style.opacity).toBe('1')
    expect(applyBtn().disabled).toBe(false)
    expect(rowBox().disabled).toBe(false)
  })

  it('★★ 일반(member)에게는 적용 단추가 **아예 없다** — 전과 같다', async () => {
    await openScreen({ isTenantManager: false })
    expect(applyBtn(), '뷰어가 아닌 비관리자에게 단추를 만들면 안 된다').toBeNull()
  })

  it('뷰어가 눌러도 아무 일이 없다 — 저장 RPC 가 불리지 않는다', async () => {
    await openScreen({ readOnly: true, isTenantManager: false })
    await act(async () => { applyBtn().click(); recomputeBtn().click() })
    await settle(4)
    const saves = rpc.mock.calls.filter(c => String(c[0]).startsWith('app_save') || String(c[0]).includes('recompute'))
    expect(saves).toEqual([])
  })
})

describe('★★ ③ 「마약·향정 사용량 보기」도 뷰어에게 보인다', () => {
  it('★ 단추가 뷰어에게도 선다 — 일반(member)은 전과 같이 안 보인다', () => {
    expect(APP).toContain(`const _narcRO=memberRole===VIEWER_ROLE;`)
    expect(APP).toContain('{(_narcMgr||_narcRO)&&<button onClick={()=>setNpOpen(true)}')
    expect(APP).toContain(`const _narcMgr=memberRole!==VIEWER_ROLE&&(memberRole==='owner'||memberRole==='admin');`)
  })

  it('★ 창에 뷰어 여부를 넘긴다', () => {
    expect(APP).toContain('isTenantManager={_narcMgr} readOnly={_narcRO}')
  })

  it('★★ 창 안의 「적용」이 뷰어에게 **보이되** 못 눌린다', () => {
    expect(NUM).toContain('{(isTenantManager || readOnly) && (')
    expect(NUM).toContain('disabled={applying || !p.rows.length || !!cutMsg || !!readOnly}')
    expect(NUM).toContain('(applying || !p.rows.length || cutMsg || readOnly) ? 0.5 : 1')
  })
})

describe('★ ④ 새 글·새 색을 만들지 않았다', () => {
  it('안내 글은 **기존 읽기 전용 문구**를 그대로 쓴다', () => {
    for (const [f, s] of [['UsageCompareModal', UCM], ['NarcoticUsageModal', NUM]]) {
      expect(s, f + ' 가 읽기 전용 문구를 따로 지었다').toContain(`import { READ_ONLY_MSG } from './lib/readOnly'`)
      expect(s).toContain('title={readOnly ? READ_ONLY_MSG')
    }
  })

  it('★ 흐림·못 누름에 **새 색이 없다** — opacity 와 기존 토큰만 쓴다', () => {
    /* readOnly 가 들어간 줄에 hex 색이 적혔으면 팔레트를 벗어난 것이다 */
    const bad = []
    for (const [f, s] of [['App.jsx', APP], ['UsageCompareModal.jsx', UCM], ['NarcoticUsageModal.jsx', NUM]]) {
      for (const line of s.split(/\r?\n/)) {
        if (/readOnly|_narcRO|_menuRO|isViewer/.test(line) && /#[0-9a-fA-F]{3,8}\b/.test(line)) bad.push(f + ': ' + line.trim().slice(0, 90))
      }
    }
    expect(bad, '새 색을 쓰지 말 것\n' + bad.join('\n')).toEqual([])
  })
})
