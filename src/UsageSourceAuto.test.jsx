/* 「적용」이 **수기 도장을 함부로 찍지 않는다** — 0130 (2026-11-14 이정화 님 승인 · A안)
 *
 * 무엇이 문제였나
 *   `app_save_usage_bulk` 가 `usage_source = 'manual'` 을 **조건 없이** 찍었다.
 *   사용량 갱신의 「적용」은 **화면이 계산한 값**을 그대로 저장하는데도 수기로 찍혔다.
 *   「출고 자동집계」는 manual 을 건너뛰므로, 한 번 적용한 약은 **영영 자동집계에서 빠졌다.**
 *   그 결과 사용 중 524종 중 499종(95%)이 manual 이고 auto 는 **0종**이다(2026-11-14 실측).
 *
 * 무엇을 바꿨나
 *   · DB — 인자 `p_source` 를 두고 **기본값은 'manual'**(옛 호출은 지금과 똑같다)
 *   · 화면 — 사용량 갱신의 「적용」만 `'auto'` 로 부른다
 *   · 급변 판정 — 출처가 **아직 비어 있는 약만** 「? 확인 필요」. auto 0 은 ▼ 급감 그대로
 *
 * 무엇을 **안** 바꿨나
 *   · 재고현황 표에서 **직접 고쳐 저장**하는 길 → 그대로 manual
 *   · 사용량 업로드(엑셀) → `p_source` 를 안 보내므로 그대로 manual
 *   · 월평균·안전재고·최대재고 계산식 · 마약·향정 건너뛰기 · 「자동」 뱃지(2단계로 미룸)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
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
const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const UCM = readFileSync(root('src/UsageCompareModal.jsx'), 'utf8')
const UPL = readFileSync(root('src/UsageUploadModal.jsx'), 'utf8')
const SQL = readFileSync(root('supabase/migrations/0130_save_usage_bulk_source.sql'), 'utf8')

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
const open = async () => {
  const r = render(<UsageCompareModal t={T} drugs={DRUGS} year={2026} month={10}
    isTenantManager onClose={() => {}} onReload={() => {}} Confirm={Confirm}
    ColMenu={Head} useSort={useSortReal} />)
  await settle()
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
})
afterEach(() => cleanup())

/* ══ ① 함수(SQL) — 4건 ═══════════════════════════════════════════════ */
describe('★★ ① 0130 — 함수에 출처 인자를 둔다', () => {
  it('★ 기본값이 **manual** 이다 — 옛 호출은 지금과 똑같이 돈다', () => {
    expect(SQL).toContain(`p_source text DEFAULT 'manual'`)
  })

  it('★★ 저장 두 자리 모두 받은 출처를 쓴다 — manual 고정이 하나도 안 남았다', () => {
    /* ★ 머리말 설명에도 같은 글자가 있다 — **들여쓴 코드 줄만** 센다 */
    const body = SQL.split(String.fromCharCode(10)).filter(l => /^[ ]+usage_source = v_src/.test(l))
    expect(body.length, '값 저장 자리 + 「0으로」 자리').toBe(2)
    /* 머리말 설명에도 같은 글자가 있다 — 들여쓴 코드 줄만 본다 */
    const still = SQL.split(String.fromCharCode(10)).filter(l => /^[ ]+usage_source = .manual./.test(l))
    expect(still, 'manual 고정이 남아 있다').toEqual([])
  })

  it('★ 모르는 출처는 **멈춘다** — usage_source 에 쓰레기가 들어가지 않는다', () => {
    expect(SQL).toContain(`if v_src not in ('manual', 'auto') then`)
    expect(SQL).toContain('알 수 없는 사용량 출처입니다')
  })

  it('★★ 옛 함수를 **지우고** 다시 만든다 — 둘이 함께 있으면 PostgREST 가 못 고른다', () => {
    expect(SQL).toContain(`drop function if exists public.app_save_usage_bulk(text[], jsonb, boolean, text[]);`)
    expect(SQL).toContain(`grant execute on function public.app_save_usage_bulk(text[], jsonb, boolean, text[], text) to authenticated;`)
    /* ★ 스키마 캐시를 안 읽히면 실재하는 인자에도 PGRST204 가 난다(인계문서 함정 #22) */
    expect(SQL).toContain(`notify pgrst, 'reload schema';`)
  })

  it('계산식·권한 검사는 한 글자도 안 바꿨다', () => {
    /* 월평균·안전재고·최대재고 — 운영 정의 그대로 */
    expect(SQL).toContain('when v_do_r3 and i.r3 is not null then round(i.r3 / 3)')
    expect(SQL).toContain('when v_do_r3 and i.r3 is not null then ceil(round(i.r3 / 3) * 1.2)')
    expect(SQL).toContain('when v_do_r3 and i.r3 is not null then round(round(i.r3 / 3) * 3)')
    expect(SQL).toContain('사용량은 관리자만 등록할 수 있습니다')
    /* 임시표 함정(한 트랜잭션에서 두 번 부르기) 방어도 그대로 */
    expect(SQL).toContain('drop table if exists _in;')
  })
})

/* ══ ② 화면 — 3건 ═══════════════════════════════════════════════════ */
describe('★★ ② 「적용」만 auto 로 부른다', () => {
  it('★★ 적용이 **p_source: \'auto\'** 를 보낸다', async () => {
    await open()
    await applyNow()
    const call = rpc.mock.calls.find(c => c[0] === 'app_save_usage_bulk')
    expect(call, '적용 호출을 못 찾았다').toBeTruthy()
    expect(call[1].p_source).toBe('auto')
  })

  it('★★ 사용량 갱신 창에는 **숫자 입력칸이 없다** — 그래서 auto 라고 말해도 된다', () => {
    const inputs = UCM.match(/<input[^>]*type=["'{]?[a-z]*/g) || []
    const nonCheck = (UCM.match(/<input\s+type="(?!checkbox)[a-z]+"/g) || [])
    expect(nonCheck, '숫자·글자 입력칸이 생기면 「화면이 센 값」이라는 전제가 깨진다').toEqual([])
    expect(inputs.length, '체크상자는 있어야 한다').toBeGreaterThan(0)
  })

  it('★★ 사용량 업로드(엑셀)는 **그대로 manual** — p_source 를 보내지 않는다', () => {
    const i = UPL.indexOf(`supabase.rpc('app_save_usage_bulk'`)
    expect(i, '업로드의 저장 호출을 못 찾았다').toBeGreaterThan(0)
    expect(UPL.slice(i, i + 400).includes('p_source'), '업로드가 출처를 보내면 안 된다').toBe(false)
  })

  it('★ 재고현황에서 **직접 고쳐 저장**하는 길은 그대로 manual 이다', () => {
    expect(APP).toContain(`const upd={prev_year_usage:pv,recent_3m_usage:rv,usage_source:'manual'}`)
  })
})

/* ══ ③ 급변 판정 — 3건 ══════════════════════════════════════════════ */
describe('★★ ③ 직전1개월 0 — auto 도 ▼ 급감 그대로', () => {
  it('★★ 잣대가 「출처가 비어 있는가」로 바뀌었다', () => {
    expect(APP).toContain(`if (Number(v1) === 0 && !src) return SURGE_CHECK`)
    expect(APP.includes(`Number(v1) === 0 && src !== 'manual'`), '옛 잣대가 남아 있다').toBe(false)
  })

  /* ★ surgeOf 는 App.jsx 안의 내부 함수라 따로 못 부른다 —
       재고현황을 **실제로 그려서** 줄에 붙는 표시를 읽는다. */
  const MARKS = async rows => {
    const A = await import('./App.jsx')
    const { ThemeCtx } = await import('./lib/theme')
    render(<ThemeCtx.Provider value={{ t: T, memberRole: 'owner', profile: { role: 'member' },
      user: {}, dark: false, toggle: () => {}, open360: () => {}, openSearch: () => {},
      navTo: () => {}, setMenu: () => {}, menu: 'stock' }}>
      <A.StockStatus drugs={rows} inv={[]} onEdit={() => {}} onAdjust={() => {}}
        onReload={() => {}} onDispose={() => {}} />
    </ThemeCtx.Provider>)
    await settle(22)
    const out = {}
    for (const tr of document.querySelectorAll('tbody tr')) {
      const txt = tr.textContent || ''
      const code = (txt.match(/AUTOX|MANX|NULX/) || [''])[0]
      const m = (tr.textContent.match(/[▲▼?]/g) || []).join('')
      if (code) out[code] = m
    }
    return out
  }
  const R = (code, src) => ({ id: code, drug_code: code, drug_name: code + '약', category: '경구제',
    status: '사용', narcotic_type: '일반', current_qty: 10, purchase_price: 100,
    monthly_avg: 10, safety_stock: 12, max_stock: 30,
    prev_year_usage: 120, recent_3m_usage: 30, recent_1m_usage: 0, usage_source: src })

  it('★★ 1개월 0 + **auto** → ▼ 급감 (「? 확인 필요」가 아니다)', async () => {
    const m = await MARKS([R('AUTOX', 'auto')])
    expect(m.AUTOX, '자동으로 센 0 은 ▼ 급감이어야 한다').toBe('▼')
  })

  it('★ 1개월 0 + **수기** → ▼ 급감 (전과 같다)', async () => {
    const m = await MARKS([R('MANX', 'manual')])
    expect(m.MANX).toBe('▼')
  })

  it('★ 1개월 0 + 출처 **빈값** → 「? 확인 필요」 그대로', async () => {
    const m = await MARKS([R('NULX', null)])
    expect(m.NULX, '아직 아무도 안 넣은 0 은 ? 확인 필요여야 한다').toBe('?')
  })

  /* ★ 2026-11-14 2단계 — 뱃지가 「자동」에서 **「수기」**로 뒤바뀌었다.
       자세한 뜻은 StockUsageBadge.test.jsx 가 지킨다. */
  it('★ 뱃지는 이제 **수기**에 붙는다', () => {
    expect(APP).toContain(`d.usage_source==='manual'&&d.monthly_avg?<span`)
    expect(APP.includes(`usage_source==='auto'&&d.monthly_avg?<span`), '옛 「자동」 뱃지가 남아 있다').toBe(false)
  })
})

/* ══ ④ 회귀 — 2건 ══════════════════════════════════════════════════ */
describe('★★ ④ 나머지는 그대로다', () => {
  it('★ 적용이 보내는 **다른 인자들**은 전과 같다', async () => {
    await open()
    await applyNow()
    const call = rpc.mock.calls.find(c => c[0] === 'app_save_usage_bulk')
    expect(call[1].p_zero_missing).toBe(false)
    expect(call[1].p_keep_codes).toEqual([])
    expect(Array.isArray(call[1].p_rows)).toBe(true)
    expect(Object.keys(call[1]).sort()).toEqual(
      ['p_fields', 'p_keep_codes', 'p_rows', 'p_source', 'p_zero_missing'])
  })

  it('★ 마약·향정 건너뛰기(업로드)는 손대지 않았다', () => {
    expect(UPL).toContain('p_keep_codes: [...new Set([...keep, ...narcSet])]')
  })
})
