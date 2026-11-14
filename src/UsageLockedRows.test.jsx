/* 기준확인 — 백신·마약·향정·한외마약은 「적용」 대상에서 **아예 뺀다**
   (2026-11-15 이정화 님 승인)

   ★★ 왜 생겼나 — 2026-11-14 16:24 UTC(한국 01:24) 「적용」 한 번에 **백신 7종**의
     사용량·안전재고·최대재고가 바뀌었다(drug_usage_audit 에 남아 있다).
     백신은 **기본 체크만** 꺼져 있었고 **사람이 켤 수 있었다.** 그래서 켜졌다.
     (그날 01:21 배포로 「전체 선택」이 올라간 직후였다.)

   ★ 이제 세 겹으로 막는다
     ① 화면  — 체크칸이 **잠긴다**(눌러도 안 켜지고 「전체 선택」도 건너뛴다)
     ② 계산  — finalPicked 가 잠긴 약을 **절대 담지 않는다**
     ③ DB    — 0136 이 app_save_usage_bulk(p_source='auto')·app_recompute_usage('all')에서 뺀다

   ★ 「사용량 업로드」·재고현황 직접 저장(manual)은 **그대로다** — 사람이 일부러 넣는 값이고,
     마약·향정 사용량은 NIMS 기준으로 손입력한다(2026-11-04 확정). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
const channel = vi.fn()
vi.mock('./lib/supabase', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a), channel: (...a) => channel(...a), removeChannel: () => {} },
}))

const root = p => resolve(process.cwd(), p)
const UCM = readFileSync(root('src/UsageCompareModal.jsx'), 'utf8')
const LIB = readFileSync(root('src/lib/usageCompare.js'), 'utf8')
const SQL = readFileSync(root('supabase/migrations/0136_auto_paths_vaccine_guard.sql'), 'utf8')
const UsageCompareModal = (await import('./UsageCompareModal')).default
const { LOCKED_MSG } = await import('./UsageCompareModal')
const { buildUsageCompare, applyRows, isLockedNarcotic, LOCKED_NARCOTIC, isVaccine } =
  await import('./lib/usageCompare')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  shadow: 'none', shadowH: 'none' }

const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제', status: '사용',
  current_qty: 100, recent_3m_usage: 0, recent_1m_usage: 0, prev_year_usage: 0,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, atc_code: '', narcotic_type: '일반',
  __unusedSnaps: { 3: 3, 6: 6, 9: 9, 12: 10 }, ...o })

/* 보통 약 하나 + 잠기는 약 넷(백신·마약·향정·한외마약) */
const DRUGS = [
  D({ drug_code: 'PLAIN', drug_name: '보통정', recent_3m_usage: 90, recent_1m_usage: 30, monthly_avg: 30, safety_stock: 36 }),
  D({ drug_code: 'VAC', drug_name: '백신주', atc_code: 'J07BB02', recent_3m_usage: 9, recent_1m_usage: 3, monthly_avg: 3, safety_stock: 4 }),
  D({ drug_code: 'NAR', drug_name: '마약주', narcotic_type: '마약', recent_3m_usage: 9, recent_1m_usage: 3, monthly_avg: 3, safety_stock: 4 }),
  D({ drug_code: 'PSY', drug_name: '향정정', narcotic_type: '향정', recent_3m_usage: 9, recent_1m_usage: 3, monthly_avg: 3, safety_stock: 4 }),
  D({ drug_code: 'HAN', drug_name: '한외정', narcotic_type: '한외마약', recent_3m_usage: 9, recent_1m_usage: 3, monthly_avg: 3, safety_stock: 4 }),
]
const TX = [
  { drug_code: 'PLAIN', type: '출고', transaction_date: '2026-09-10', quantity: 300 },
  { drug_code: 'VAC', type: '출고', transaction_date: '2026-09-12', quantity: 300 },
  { drug_code: 'NAR', type: '출고', transaction_date: '2026-09-12', quantity: 300 },
  { drug_code: 'PSY', type: '출고', transaction_date: '2026-09-12', quantity: 300 },
  { drug_code: 'HAN', type: '출고', transaction_date: '2026-09-12', quantity: 300 },
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
const settle = async (n = 14) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }
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
  const r = render(<UsageCompareModal asScreen t={T} drugs={DRUGS} isTenantManager
    onClose={() => {}} onReload={() => {}} Confirm={Confirm} ColMenu={Head} useSort={useSortReal}
    onRecompute={() => {}} {...props} />)
  await settle()
  return r
}
const cbOf = name => screen.getByLabelText(name + ' 적용하기')
const headCb = () => document.querySelector('thead input[type="checkbox"]')
const picked = () => [...document.querySelectorAll('tbody input[type="checkbox"]')].filter(c => c.checked).length

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: { saved: 1 }, error: null })
  from.mockReset(); from.mockImplementation(() => mockTx())
  channel.mockReset(); channel.mockImplementation(() => { const ch = { on: () => ch, subscribe: () => ch }; return ch })
})
afterEach(() => cleanup())

/* ══ ① 무엇이 잠기나 ═══════════════════════════════════════════ */
describe('★★ ① 잠기는 약 — 백신 + 마약·향정·한외마약', () => {
  it('★ 목록이 DB 0136 과 **같다**', () => {
    expect(LOCKED_NARCOTIC).toEqual(['마약', '향정', '한외마약'])
    for (const k of ['마약', '향정', '한외마약']) expect(SQL, k + ' 가 0136 에 없다').toContain(k)
    expect(SQL, '0136 에 J07 제외가 없다').toContain(`not like 'J07%'`)
  })

  it('★ 판정 — 백신은 ATC J07, 마약류는 narcotic_type', () => {
    expect(isVaccine({ atc_code: 'J07BB02' })).toBe(true)
    expect(isVaccine({ atc_code: 'C07AG' })).toBe(false)
    for (const k of ['마약', '향정', '한외마약']) expect(isLockedNarcotic({ narcotic_type: k }), k).toBe(true)
    for (const k of ['일반', '', null, undefined]) expect(isLockedNarcotic({ narcotic_type: k }), String(k)).toBe(false)
  })

  it('★★ 잠긴 약은 **기본 체크가 꺼진다**', () => {
    const p = buildUsageCompare(DRUGS, TX, 2026, 10)
    const by = c => p.rows.find(r => r.code === c)
    expect(by('PLAIN').locked, '보통 약은 안 잠긴다').toBe(false)
    expect(by('PLAIN').on, '보통 약은 켜져 있다').toBe(true)
    for (const c of ['VAC', 'NAR', 'PSY', 'HAN']) {
      expect(by(c).locked, c + ' 가 안 잠겼다').toBe(true)
      expect(by(c).on, c + ' 가 켜져 있다').toBe(false)
    }
    expect(p.summary.locked, '요약에 잠긴 수가 있다').toBe(4)
  })

  it('★★ applyRows 는 잠긴 약을 **담지 않는다** (마지막 빗장)', () => {
    const p = buildUsageCompare(DRUGS, TX, 2026, 10)
    /* 일부러 전부 넣어 본다 — 그래도 잠긴 약은 안 나간다 */
    const rows = applyRows(p.rows, new Set(['PLAIN', 'VAC', 'NAR', 'PSY', 'HAN']))
    expect(rows.map(r => r.code)).toEqual(['PLAIN'])
  })
})

/* ══ ② 화면에서 못 켠다 ═══════════════════════════════════════ */
describe('★★ ② 화면 — 체크칸이 잠긴다', () => {
  it('★★ 잠긴 약의 체크는 **못 누른다** · 왜 그런지 적혀 있다', async () => {
    await open()
    expect(cbOf('보통정').disabled, '보통 약은 눌려야 한다').toBe(false)
    for (const nm of ['백신주', '마약주', '향정정', '한외정']) {
      const cb = cbOf(nm)
      expect(cb.disabled, nm + ' 가 눌린다').toBe(true)
      expect(cb.checked, nm + ' 가 켜져 있다').toBe(false)
      expect(cb.getAttribute('title'), nm + ' 설명').toBe(LOCKED_MSG)
    }
    expect(LOCKED_MSG).toContain('손으로 넣습니다')
  })

  it('★★ 눌러도 안 켜진다', async () => {
    await open()
    const before = picked()
    for (const nm of ['백신주', '마약주', '향정정', '한외정']) {
      await act(async () => { fireEvent.click(cbOf(nm)) })
    }
    expect(picked(), '눌렀더니 켜졌다').toBe(before)
  })

  it('★★★ 「전체 선택」도 잠긴 약을 **건너뛴다** — 2026-11-14 사고를 막는 자리다', async () => {
    await open()
    /* 처음에는 열린 줄(보통정) 하나가 켜져 있다 — 잠긴 넷은 꺼져 있다 */
    expect(picked(), '처음 상태').toBe(1)
    await act(async () => { fireEvent.click(headCb()) })
    expect(picked(), '다 켜져 있었으니 한 번 누르면 꺼진다').toBe(0)
    await act(async () => { fireEvent.click(headCb()) })
    /* 다시 누르면 **열린 줄만** 켜진다 — 잠긴 넷은 그대로 꺼져 있다 */
    expect(picked()).toBe(1)
    for (const nm of ['백신주', '마약주', '향정정', '한외정']) {
      expect(cbOf(nm).checked, nm + ' 가 전체 선택으로 켜졌다').toBe(false)
    }
    /* 열린 줄이 다 켜졌으므로 머리 체크는 **꽉 참**이다(반쯤이 아니다) */
    expect(headCb().checked).toBe(true)
    expect(headCb().indeterminate).toBe(false)
  })

  it('★★ 「적용」에 잠긴 약이 안 들어간다', async () => {
    await open()
    /* 기본 체크가 보통정 하나다 — 그대로 적용해 본다 */
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /적용$/ })) })
    await settle(4)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })) })
    await settle(8)
    const sent = rpc.mock.calls.find(c => c[0] === 'app_save_usage_bulk')
    expect(sent, 'app_save_usage_bulk 를 안 불렀다').toBeTruthy()
    expect(sent[1].p_rows.map(r => r.code)).toEqual(['PLAIN'])
    expect(sent[1].p_source, '자동 저장이다').toBe('auto')
  })

  it('★ 비고 뱃지가 왜 빠지는지 알려 준다', async () => {
    await open()
    const notes = [...document.querySelectorAll('tbody td:last-child')].map(x => x.textContent).join('|')
    expect(notes).toContain('백신·마약류 — 제외')
    expect(UCM).toContain(`{ k: 'vac', label: '백신·마약류 — 제외', hit: r => r.locked`)
  })

  it('★★ 세 겹이 모두 있다 — 화면·계산·DB', () => {
    expect(UCM, '① 화면 — 체크칸 잠금').toContain('disabled={!!readOnly || !!r.locked}')
    expect(UCM, '② 계산 — finalPicked').toContain('if (r.locked) continue')
    expect(LIB, '② 계산 — applyRows').toContain('r.locked')
    expect(SQL, '③ DB — 자동 저장일 때만 뺀다').toContain(`v_src is distinct from 'auto'`)
  })
})
