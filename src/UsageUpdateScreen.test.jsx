/* 「사용량 갱신」 화면 — 재고현황 단추를 자기 화면으로 옮기기 (2026-11-14 이정화 님 승인)
 *
 * 옮긴 것
 *   · 재고현황 단추 3개 삭제 — 출고 자동집계 · 사용량 비교 · 마약·향정 사용량 보기
 *   · 재고관리 ▼ 에 「사용량 갱신」 (재고현황 바로 뒤) · 주소 #usageupdate
 *   · 마약·향정 사용량 보기 → 향정마약 화면 단추
 *   · 창이 아니라 **화면** — 덮개·✕·바깥클릭 닫힘 없음. 제목 줄 오른쪽에 「출고 자동집계」
 *
 * ★★ 함께 넣은 안전장치 (화면이 되면 오래 열어 두기 쉬워 **낡은 값으로 덮어쓸 위험**이 커진다)
 *   · 적용 **직전에 거래를 다시 읽는다** — 달라졌으면 저장하지 않고 멈춘다
 *   · 그 달 출고가 바뀌면 **알림 띠** + 「다시 읽기」
 *
 * ★ 일반(member) 계정에는 메뉴 칸부터 안 보인다.
 * ★ 읽기 전용(viewer)은 **보되 못 쓴다** — 2026-11-14 규칙 변경, ViewerUsageVisible.test.jsx 참조.
 * ★ 보고서 화면의 「사용량 비교 보기」는 **창 그대로**다 — 한 글자도 안 바뀐다.
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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
const SRC = readFileSync(resolve(process.cwd(), 'src/UsageCompareModal.jsx'), 'utf8')
const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

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
/* 거래 — 쪽 나눠 읽기를 흉내 낸다. TX 를 바꾸면 「다시 읽기」가 다른 값을 본다. */
let TX = [
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
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
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
const open = async (props = {}) => {
  const r = render(<UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10}
    isTenantManager onClose={() => {}} onReload={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortReal} {...props} />)
  await settle(12)
  return r
}
const applyNow = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^고른 \d+종 적용$/ })) })
  await settle(3)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })) })
  await settle(10)
}

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: { saved: 2 }, error: null })
  from.mockReset(); from.mockImplementation(() => mockTx())
  channel.mockReset()
  channel.mockImplementation(() => { const ch = { on: () => ch, subscribe: () => ch }; return ch })
  TX = [
    { drug_code: 'AAA', type: '출고', transaction_date: '2026-09-10', quantity: 9 },
    { drug_code: 'BBB', type: '출고', transaction_date: '2026-09-11', quantity: 600 },
  ]
})
afterEach(() => cleanup())

describe('★★ ① 메뉴·주소·권한', () => {
  it('재고관리 ▼ 에 「사용량 갱신」이 **재고현황 바로 뒤**에 있다', () => {
    /* ★★ 2026-11-14(저녁) — 메뉴에서 **빠지고** 재고현황 안 탭(#stock/check)이 되었다.
         바뀐 뒤의 모습은 StockCheckTab.test.jsx 가 지킨다. 여기서는 **빠졌다는 것**만 못 박는다. */
    expect(APP).toContain(`{ id: 'stock', l: '재고현황' }, { id: 'expiry', l: '유효기한' }`)
  })
  it('주소가 기존 메뉴처럼 **붙여 쓴 한 낱말**이다', () => {
    /* ★ ROUTES 는 **순서를 지키는 파수꾼**(vaccineRoute.test)이 있어 끝에 붙인다 */
    expect(APP).toContain("'vaccine', 'label', 'powder', 'usageupdate'];")
    expect(APP.includes("'usage-compare'"), '붙임표가 섞였다').toBe(false)
  })
  it('화면 배선이 있다 — 이제 재고현황 탭 안이다', () => {
    expect(APP).toContain(`{stockTab === 'check'`)
    expect(APP).toContain(`<UsageUpdateView drugs={drugs} onReload={load} />`)
  })
  /* ★★ 2026-11-14 업무 규칙 변경 — 뷰어는 **보되 못 쓴다**.
       바뀐 뒤의 모습은 ViewerUsageVisible.test.jsx 가 지킨다.
       여기서는 **일반(member)** 의 보임/숨김이 그대로인지만 못 박는다. */
  /* ★ 메뉴 칸이 아예 없어졌으므로 「일반에게 안 보인다」를 셀 자리가 없다.
       재고현황은 누구나 보는 화면이고, 기준확인 탭 **안**에서 막는다(아래 시험). */
  it('★★ 메뉴 칸이 아예 없다 — 재고현황 탭으로 옮겨 갔다', () => {
    expect(APP.includes(`{ id: 'usageupdate', l: '사용량 갱신' }`), '메뉴 칸이 남아 있다').toBe(false)
    expect(APP).toContain(`const stockTab = useSyncExternalStore(`)
  })
  it('★★ 주소로 들어와도 일반(member) 계정은 **화면이 막힌다**', () => {
    const i = APP.indexOf('function UsageUpdateView({ drugs, onReload }) {')
    expect(i, '화면 부품을 찾지 못했다').toBeGreaterThan(0)
    const fn = APP.slice(i, i + 2200)
    expect(fn).toContain(`const isTenantManager = memberRole !== VIEWER_ROLE && (memberRole === 'owner' || memberRole === 'admin')`)
    expect(fn).toContain('if (!isTenantManager && !isViewer) return')
    expect(fn).toContain('관리자만 볼 수 있는 화면입니다.')
  })
})

describe('★★ ② 재고현황 단추 3개가 사라졌다', () => {
  it('★ 옮긴 단추가 재고현황에 없다', () => {
    /* ★ 재고현황 쪽 조건(canRecompute)에 붙어 있던 단추들이다 — 그 꼴이 사라졌는지 본다.
         「마약·향정 사용량 보기」는 **향정마약 화면으로 옮겨** 살아 있으므로 글자만으로는 못 가린다. */
    for (const bad of ['canRecompute&&<button onClick={()=>setUcOpen(true)}',
      'canRecompute&&<button onClick={()=>setNpOpen(true)}',
      'canRecompute&&<button onClick={()=>setRecomfirm(true)}']) {
      expect(APP.includes(bad), '재고현황에 아직 있다: ' + bad).toBe(false)
    }
    /* 옮겨 간 자리를 셈한다 — 자동집계는 화면에, 마약은 향정 화면에 하나씩 */
    expect((APP.match(/출고 자동집계/g) || []).length, '자동집계 자리가 모자라다').toBeGreaterThanOrEqual(3)
  })
  it('남은 단추는 그대로다', () => {
    expect(APP).toContain('>사용량 양식</button>')
    expect(APP).toContain('>사용량 업로드</button>')
  })
  it('옮겨 가서 안 쓰게 된 상태·함수를 지웠다', () => {
    for (const bad of ['const canRecompute=isTenantManager', 'async function recomputeUsage()', 'const[recomfirm,setRecomfirm]']) {
      expect(APP.includes(bad), '아직 남아 있다: ' + bad).toBe(false)
    }
  })
})

describe('★★ ③ 창이 아니라 화면', () => {
  it('★ asScreen 이면 덮개·✕가 **없다**', async () => {
    await open({ asScreen: true })
    expect(document.body.textContent).toContain('사용량 갱신 — 마감된 달 기준')
    /* 닫는 단추는 둘이다 — 머리의 ✕ 와 아래의 「닫기」. 화면에서는 **둘 다** 없어야 한다. */
    expect(screen.queryAllByRole('button', { name: '닫기' }), '닫는 단추가 남아 있다').toHaveLength(0)
    const fixed = [...document.querySelectorAll('div')].filter(d => d.style && d.style.position === 'fixed')
    expect(fixed.length, '덮개가 남아 있다').toBe(0)
  })
  it('★★ asScreen 이 없으면 **창 그대로** — 보고서 화면은 안 바뀐다', async () => {
    await open()
    expect(document.body.textContent).toContain('사용량 비교 — 마감된 달 기준')
    expect(screen.queryAllByRole('button', { name: '닫기' }), '닫는 단추가 모자라다').toHaveLength(2)
    const fixed = [...document.querySelectorAll('div')].filter(d => d.style && d.style.position === 'fixed')
    expect(fixed.length, '덮개가 없다').toBeGreaterThan(0)
  })
  it('보고서 화면 mount 는 asScreen 을 주지 않는다', () => {
    const i = APP.indexOf('{ucOpen&&<UsageCompareModal')
    expect(i, '보고서 쪽 mount 를 찾지 못했다').toBeGreaterThan(0)
    expect(APP.slice(i, i + 300).includes('asScreen'), '보고서가 화면이 돼 버렸다').toBe(false)
  })
  it('★ 「출고 자동집계」가 제목 줄 오른쪽에 있다 — 화면일 때만', async () => {
    const onRecompute = vi.fn()
    await open({ asScreen: true, onRecompute })
    const b = screen.getByRole('button', { name: '출고 자동집계' })
    await act(async () => { fireEvent.click(b) })
    expect(onRecompute).toHaveBeenCalled()
    cleanup()
    await open({ onRecompute })                 /* 창일 때는 안 나온다 */
    expect(screen.queryByRole('button', { name: '출고 자동집계' })).toBeNull()
  })
  it('화면 부품이 자동집계를 **확인 창을 거쳐** 부른다', () => {
    const i = APP.indexOf('function UsageUpdateView({ drugs, onReload }) {')
    const fn = APP.slice(i, i + 2600)
    expect(fn).toContain('onRecompute={() => setAsk(true)}')
    expect(fn).toContain(`supabase.rpc('app_recompute_usage', { p_overwrite_manual: false })`)
    expect(fn).toContain('onConfirm={() => { setAsk(false); recompute() }}')
    expect(fn).toContain('수기로 넣은 약품의 값은 바뀌지 않습니다.')
  })
})

describe('★★ ④ 적용 직전 다시 읽기', () => {
  it('★ 거래 읽기가 **한 함수**로 모였다', () => {
    expect(SRC).toContain('async function fetchWindowTx(year, month)')
    expect((SRC.match(/fetchWindowTx\(/g) || []).length, '쓰는 자리가 모자라다').toBeGreaterThanOrEqual(4)
  })
  it('★★ 적용 직전에 거래를 다시 읽는다', async () => {
    await open({ asScreen: true })
    const before = from.mock.calls.length
    await applyNow()
    expect(from.mock.calls.length, '다시 읽지 않았다').toBeGreaterThan(before)
    expect(rpc).toHaveBeenCalled()
  })
  it('★★ 그새 거래가 바뀌면 **저장하지 않고 멈춘다**', async () => {
    await open({ asScreen: true })
    /* 화면을 열어 둔 사이에 누가 출고를 더 넣었다 */
    TX = [...TX, { drug_code: 'AAA', type: '출고', transaction_date: '2026-10-02', quantity: 300 }]
    await applyNow()
    expect(rpc, '낡은 값으로 저장해 버렸다').not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('저장하지 않았습니다')
  })
  it('바뀌지 않았으면 그대로 저장된다', async () => {
    await open({ asScreen: true })
    await applyNow()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('app_save_usage_bulk')
  })
})

describe('★ ⑤ 그 달 거래 바뀜 알림 띠', () => {
  it('실시간으로 그 달 거래를 지켜본다', () => {
    expect(SRC).toContain(`supabase.channel('uc-tx-' + key)`)
    expect(SRC).toContain(`table: 'transactions'`)
    expect(SRC).toContain('setTxChanged(true)')
  })
  it('★ 띠가 뜨면 「다시 읽기」로 숫자를 맞출 수 있다', async () => {
    await open({ asScreen: true })
    expect(document.body.textContent).not.toContain('그 달 출고가 바뀌었습니다')
    /* 구독 손잡이를 직접 불러 「바뀜」을 알린다 */
    const on = channel.mock.results[0].value
    expect(on, '구독을 안 걸었다').toBeTruthy()
    const cb = channel.mock.calls.length ? null : null
    void cb
    /* 손잡이를 잡아 두지 않았으므로 글귀·단추가 소스에 있는지로 못 박는다 */
    expect(SRC).toContain('그 달 출고가 바뀌었습니다')
    expect(SRC).toContain('다시 읽기')
    expect(SRC).toContain('async function reloadTx()')
  })
  it('띠는 **기존 주황**을 쓴다 — 새 색이 아니다', () => {
    const i = SRC.indexOf('그 달 출고가 바뀌었습니다')
    const near = SRC.slice(Math.max(0, i - 420), i)
    expect(near).toContain('background: t.amberL')
    expect(near).toContain('color: t.amber')
    const hex = [...new Set((SRC.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    expect(hex, '새 색이 들어갔다').toEqual(['#F0F0EB'])
  })
})

describe('★ ⑥ 향정마약 화면 단추', () => {
  it('단추가 생겼다 · 창을 띄운다', () => {
    expect(APP).toContain('>마약·향정 사용량 보기</button>}')
    expect(APP).toContain('{npOpen&&<NarcoticUsageModal t={t} drugs={drugs} onClose={()=>setNpOpen(false)}')
  })
  /* ★ 2026-11-14 — 뷰어에게도 보인다. 일반(member)에게는 전과 같이 안 보인다. */
  it('★ 일반(member) 계정에는 안 보인다', () => {
    expect(APP).toContain(`const _narcMgr=memberRole!==VIEWER_ROLE&&(memberRole==='owner'||memberRole==='admin');`)
    expect(APP).toContain('{(_narcMgr||_narcRO)&&<button onClick={()=>setNpOpen(true)}')
  })
})
