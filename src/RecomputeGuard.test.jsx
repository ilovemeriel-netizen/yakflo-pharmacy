/* 「출고 자동집계」 보호 — 확인 창 + 관리자 전용.

   ★ 왜 막나
     이 버튼이 부르는 app_recompute_usage 는 **수기로 넣은 직전1개월 값까지** 출고값
     (대개 0)으로 덮어쓴다(0046·0047). 이 약제과는 사용량 정본이 원내 프로그램 값이라
     한 번 누르면 수기 717종의 값이 날아가고 되돌릴 수 없다.

   ★ 고정하는 것
     ① 관리자에게만 버튼이 보인다 — 직원에게는 **DOM 에도 없다**
     ② 누르면 바로 실행하지 않고 확인 창이 뜬다
     ③ 취소·Esc·바깥 클릭 → RPC 0회
     ④ 「계속」 → RPC 1회
     ⑤ {N} 은 화면이 이미 가진 데이터로 센 값과 같다 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'

const mk = (code, r1) => ({
  drug_code: code, drug_name: code + '약', category: '경구제', status: '사용',
  current_qty: 100, safety_stock: 10, max_stock: 300, purchase_price: 100,
  prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100,
  recent_1m_usage: r1, usage_source: 'manual', expiry_date: '2027-06-01',
})
/* 값이 든 약품 3종(90·5·1) · 0 인 약품 1종 · 값이 없는 약품 1종 → {N} 은 3 이어야 한다 */
const DRUGS = [mk('AAA', 90), mk('BBB', 5), mk('CCC', 1), mk('ZER', 0), mk('NUL', null)]
const EXPECT_N = 3

const rpcCalls = []
vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const q = {
    select: () => q, in: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
    range: () => result([]), limit: () => result([]), maybeSingle: () => result(null),
    insert: () => result(null), upsert: () => result(null), update: () => q, delete: () => q,
    then(res) { return result([]).then(res) },
  }
  return {
    supabase: {
      from: () => q,
      rpc: (name, args) => { rpcCalls.push({ name, args }); return result(0) },
      auth: { getUser: () => result(null) },
    },
  }
})

const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
/* ★ 역할을 시험마다 바꿔야 하므로 바깥에서 갈아 끼운다 */
let ROLE = { memberRole: 'owner', profile: { role: 'user' } }
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, setTheme: () => {}, ...ROLE }) }
})

let StockStatus
beforeEach(async () => {
  rpcCalls.length = 0
  ROLE = { memberRole: 'owner', profile: { role: 'user' } }
  if (!StockStatus) StockStatus = (await import('./App.jsx')).StockStatus
})
afterEach(() => cleanup())

const open = () => render(<StockStatus drugs={DRUGS} inv={[]} navFilter={null}
  onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
const btn = () => [...document.querySelectorAll('button')]
  .find(b => b.textContent.trim() === '출고 자동집계')
const dialog = () => [...document.querySelectorAll('div')]
  .find(d => d.textContent.includes('출고 자동집계') && d.textContent.includes('계속할까요?'))
const inDialog = label => [...document.querySelectorAll('button')]
  .find(b => b.textContent.trim() === label)
async function ready() {
  open()
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
}

describe('① 관리자에게만 보인다', () => {
  it('owner — 버튼이 있다', async () => {
    ROLE = { memberRole: 'owner', profile: { role: 'user' } }
    await ready()
    expect(btn()).toBeTruthy()
  })
  it('admin — 버튼이 있다', async () => {
    ROLE = { memberRole: 'admin', profile: { role: 'user' } }
    await ready()
    expect(btn()).toBeTruthy()
  })
  it('★ 일반 직원 — 버튼이 DOM 에도 없다', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'user' } }
    await ready()
    expect(btn(), '숨기는 게 아니라 아예 그리지 않는다').toBeFalsy()
    expect(document.body.textContent).not.toContain('출고 자동집계')
  })
  it('역할이 아예 없을 때도 버튼이 없다', async () => {
    ROLE = { memberRole: null, profile: null }
    await ready()
    expect(btn()).toBeFalsy()
  })
})

describe('② 누르면 바로 실행하지 않는다', () => {
  it('★ 버튼을 눌러도 RPC 는 0회 — 확인 창만 뜬다', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    expect(rpcCalls.filter(c => c.name === 'app_recompute_usage').length).toBe(0)
  })
  it('확인 창 문구가 정해진 대로다', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    const txt = dialog().textContent
    expect(txt).toContain('출고 자동집계')
    expect(txt).toContain('직전1개월 사용량이 출고 기록 값으로 바뀝니다.')
    expect(txt).toContain('되돌릴 수 없습니다.')
    expect(txt).toContain('계속할까요?')
    expect(inDialog('취소'), '취소 단추').toBeTruthy()
    expect(inDialog('계속'), '계속 단추').toBeTruthy()
  })
  it('★ {N} 이 화면 데이터로 센 값과 같다', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    /* 화면이 가진 drugs 로 직접 세어 본 값과 맞춘다 */
    const n = DRUGS.filter(d => Number(d.recent_1m_usage) !== 0 && d.recent_1m_usage != null).length
    expect(n).toBe(EXPECT_N)
    expect(dialog().textContent).toContain('약품 ' + n + '종의 값이 덮어써지고')
  })
  it('기본 포커스가 「취소」다', async () => {
    await ready()
    fireEvent.click(btn())
    /* ★ 포커스는 창이 그려진 **뒤** effect 에서 옮겨진다 — 바로 재면 아직 body 다. 기다린다. */
    await waitFor(() => expect(dialog()).toBeTruthy())
    await waitFor(() => expect(document.activeElement).toBe(inDialog('취소')))
  })
})

describe('③ 취소하면 아무 일도 없다', () => {
  const rpcN = () => rpcCalls.filter(c => c.name === 'app_recompute_usage').length

  it('★ 「취소」 → RPC 0회', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    fireEvent.click(inDialog('취소'))
    await waitFor(() => expect(dialog()).toBeFalsy())
    expect(rpcN()).toBe(0)
  })
  it('★ Esc → RPC 0회', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(dialog()).toBeFalsy())
    expect(rpcN()).toBe(0)
  })
  it('★ 바깥 클릭 → RPC 0회', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    /* 바깥 = 어두운 덮개. 창 자신이 아니라 그 바깥 상자를 누른다 */
    const back = [...document.querySelectorAll('div')]
      .find(d => d.style.position === 'fixed' && d.style.inset === '0px' && d.textContent.includes('계속할까요?'))
    expect(back, '덮개를 찾지 못했다').toBeTruthy()
    fireEvent.click(back)
    await waitFor(() => expect(dialog()).toBeFalsy())
    expect(rpcN()).toBe(0)
  })
})

describe('④ 「계속」을 눌러야 실행된다', () => {
  it('★ RPC 가 딱 1회, 기존 인자 그대로', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    fireEvent.click(inDialog('계속'))
    await waitFor(() => expect(rpcCalls.filter(c => c.name === 'app_recompute_usage').length).toBe(1))
    const call = rpcCalls.find(c => c.name === 'app_recompute_usage')
    expect(call.args, '인자는 손대지 않았다').toEqual({ p_overwrite_manual: false })
  })
  it('실행하면 확인 창이 닫힌다', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    fireEvent.click(inDialog('계속'))
    await waitFor(() => expect(dialog()).toBeFalsy())
  })
})

describe('⑤ 공용 확인 창의 기존 쓰임은 그대로다', () => {
  it('escClose·focusCancel 을 안 넘기면 Esc 리스너를 달지 않는다', () => {
    const { readFileSync } = require('node:fs')
    const src = readFileSync('src/App.jsx', 'utf8')
    /* 두 선택지는 **덧붙인 것**이라 기본값이 없다(= 안 넘기면 꺼짐) */
    expect(src).toContain('if (!escClose) return')
    expect(src).toContain('if (focusCancel && _cancel.current)')
    /* ★ 쓰는 곳을 `<CountConfirmModal[^>]*` 로 잘라 보면 안 된다 —
       속성 안의 화살표 함수(`d=>…`)에 들어 있는 `>` 에서 끊겨 뒤가 날아간다. 세는 쪽을 바꾼다. */
    const uses = (src.match(/<CountConfirmModal\b/g) || []).length
    expect(uses, '쓰는 곳 4군데(실사 3 + 자동집계 1)').toBe(4)
    /* 선언(구조분해) 1 + 본문 3 + 켠 곳 1 = 5. 켠 곳만 따로 센다 */
    expect((src.match(/escClose/g) || []).length, 'escClose 총 등장').toBe(5)
    expect((src.match(/escClose focusCancel/g) || []).length, '켠 곳은 자동집계 1군데뿐').toBe(1)
  })
})
