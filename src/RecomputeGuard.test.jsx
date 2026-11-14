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

const mk = (code, r1, src = 'manual') => ({
  drug_code: code, drug_name: code + '약', category: '경구제', status: '사용',
  current_qty: 100, safety_stock: 10, max_stock: 300, purchase_price: 100,
  prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100,
  recent_1m_usage: r1, usage_source: src, expiry_date: '2027-06-01',
})
/* ★ 2026-11-02 — 0105 가 수기(manual) 약품을 보호하므로 **바뀌는 것은 수기가 아닌 약품**뿐이다.
   그래서 {N} 은 「값이 든 약품 수」가 아니라 **usage_source 가 manual 이 아닌 약품 수**다.
   수기 3종(AAA·BBB·CCC) · 미설정 1종(NUL) · 자동 1종(AUT) → {N} 은 2 */
const DRUGS = [
  mk('AAA', 90), mk('BBB', 5), mk('CCC', 1),
  mk('NUL', 0, null), mk('AUT', 7, 'auto'),
]
const EXPECT_N = 2

const rpcCalls = []
vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const q = {
    select: () => q, in: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
    /* ★ limit() 뒤에 maybeSingle() 이 또 오는 길이 있다(사용량 갱신 화면의 기준월 찾기).
         q 는 then 을 가진 thenable 이라 await 해도 그대로 동작한다. */
    range: () => result([]), limit: () => q, maybeSingle: () => result(null),
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

/* ★ 2026-11-14 — 「출고 자동집계」가 재고현황에서 **「사용량 갱신」 화면**으로 옮겨 갔다.
     지키려는 것(관리자만·확인 창을 거쳐야 함·RPC 인자)은 그대로다. 보는 자리만 바꾼다. */
let UsageUpdateView
beforeEach(async () => {
  rpcCalls.length = 0
  ROLE = { memberRole: 'owner', profile: { role: 'user' } }
  if (!UsageUpdateView) UsageUpdateView = (await import('./App.jsx')).UsageUpdateView
})
afterEach(() => cleanup())

const open = () => render(<UsageUpdateView drugs={DRUGS} onReload={() => {}} />)
const btn = () => [...document.querySelectorAll('button')]
  .find(b => b.textContent.trim() === '출고 자동집계')
const dialog = () => [...document.querySelectorAll('div')]
  .find(d => d.textContent.includes('출고 자동집계') && d.textContent.includes('계속할까요?'))
const inDialog = label => [...document.querySelectorAll('button')]
  .find(b => b.textContent.trim() === label)
async function ready() {
  open()
  /* 화면이 그려지면 단추(관리자) 또는 막음 글귀(그 밖)가 뜬다 */
  await waitFor(() => expect(btn() || document.body.textContent.includes('관리자만 볼 수 있는')).toBeTruthy())
}

describe('① 관리자에게만 보인다', () => {
  it('owner — 버튼이 있다', async () => {
    ROLE = { memberRole: 'owner', profile: { role: 'user' } }
    await ready()
    expect(btn()).toBeTruthy()
  })
  it('admin — 버튼이 있다 (이 약국의 관리자다)', async () => {
    ROLE = { memberRole: 'admin', profile: { role: 'user' } }
    await ready()
    expect(btn()).toBeTruthy()
  })
  /* ★ 2026-11-02 새로 막은 것 — 전역 프로필의 admin 은 **이 약국의 멤버가 아니다**.
     전에는 profile?.role==='admin' 만으로도 버튼이 보였다. DB(tenant_members) 기준과 맞춘다. */
  it('★ profiles.role=admin 뿐인 사람 — 버튼이 없다', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'admin' } }
    await ready()
    expect(btn()).toBeFalsy()
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
    /* ★ 2026-11-02 문구 교체 —
       전: 「직전1개월 사용량이 출고 기록 값으로 바뀝니다.」 + 「…덮어써지고, 되돌릴 수 없습니다.」
       후: 「출고 기록으로 수기 입력이 없는 약품 {N}종의 사용량을 다시 계산합니다.」
           + 「수기로 넣은 약품의 값은 바뀌지 않습니다.」
       0105 가 수기 값을 보호하므로 「되돌릴 수 없다」가 더 이상 사실이 아니다. */
    expect(txt).toContain('출고 기록으로 수기 입력이 없는 약품 ')
    expect(txt).toContain('종의 사용량을 다시 계산합니다.')
    expect(txt).toContain('수기로 넣은 약품의 값은 바뀌지 않습니다.')
    expect(txt, '옛 문구가 남으면 안 된다').not.toContain('되돌릴 수 없습니다')
    expect(txt).toContain('계속할까요?')
    expect(inDialog('취소'), '취소 단추').toBeTruthy()
    expect(inDialog('계속'), '계속 단추').toBeTruthy()
  })
  it('★ {N} 이 화면 데이터로 센 값과 같다', async () => {
    await ready()
    fireEvent.click(btn())
    await waitFor(() => expect(dialog()).toBeTruthy())
    /* 화면이 가진 drugs 로 직접 세어 본 값과 맞춘다 — **수기가 아닌 약품 수** */
    const n = DRUGS.filter(d => d.usage_source !== 'manual').length
    expect(n).toBe(EXPECT_N)
    expect(dialog().textContent).toContain('수기 입력이 없는 약품 ' + n + '종')
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
    /* ★ 2026-11-02 기대값 변경 — 전 5군데 / 후 **6군데**.
       향정·마약 인쇄의 「게시용 / 심사용」 고르는 창이 이 부품을 그대로 쓴다. */
    const uses = (src.match(/<CountConfirmModal\b/g) || []).length
    expect(uses, '쓰는 곳 6군데(실사 3 + 자동집계 1 + 엑셀 범위 1 + 인쇄 쓰임새 1)').toBe(6)
    /* 선언(구조분해) 1 + 본문 3 + 켠 곳 N. 켠 곳만 따로 센다 */
    expect((src.match(/escClose/g) || []).length, 'escClose 총 등장').toBe(7)
    expect((src.match(/escClose focusCancel/g) || []).length, '켠 곳 3군데(자동집계·엑셀 범위·인쇄 쓰임새)').toBe(3)
  })
})
