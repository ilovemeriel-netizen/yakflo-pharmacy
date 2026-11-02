/* 사용량·삭제 단추 5곳을 최고 관리자(owner)만 쓰게 한다 — 2026-11-02 이정화 님 결정.

   ★ 왜
     · 사용량 업로드는 화면에도 DB 에도 역할 제한이 **아예 없었다** — 직원 한 명이
       1,131종 사용량을 한 번에 덮어쓸 수 있었다.
     · 거래 이력 삭제는 DB(0037)는 이미 owner·admin 전용인데 화면은 누구에게나 보였다
       — 눌러도 안 되는 단추가 보이던 셈이다.
     · DB(0105)가 tenant_members.role='owner' 만 통과시키므로 화면 기준을 거기에 맞춘다.

   ★ 고정하는 것
     ① 역할 4종(owner / admin / profiles.admin / 일반 직원)에서 보임·안 보임
     ② 역할을 **아직 못 읽었을 때**(null) 도 안 보인다
     ③ 숨기는 게 아니라 **DOM 에서 아예 뺀다** (개발자도구로도 못 누른다)
     ④ 역할과 **상관없는** 단추(엑셀)는 늘 보인다 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mk = (code, src = 'manual') => ({
  drug_code: code, drug_name: code + '약', category: '경구제', status: '사용',
  current_qty: 100, safety_stock: 10, max_stock: 300, purchase_price: 100,
  prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100,
  recent_1m_usage: 50, usage_source: src, expiry_date: '2027-06-01',
})
const DRUGS = [mk('AAA'), mk('BBB'), mk('CCC', null)]

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const q = {
    select: () => q, in: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
    range: () => result([]), limit: () => result([]), maybeSingle: () => result(null),
    insert: () => result(null), upsert: () => result(null), update: () => q, delete: () => q,
    then(res) { return result([]).then(res) },
  }
  return { supabase: { from: () => q, rpc: () => result(0), auth: { getUser: () => result(null) } } }
})
const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
let ROLE = { memberRole: 'owner', profile: { role: 'user' } }
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, setTheme: () => {}, ...ROLE }) }
})

let StockStatus, TransactionForm
beforeEach(async () => {
  ROLE = { memberRole: 'owner', profile: { role: 'user' } }
  if (!StockStatus) {
    const m = await import('./App.jsx')
    StockStatus = m.StockStatus; TransactionForm = m.TransactionForm
  }
})
afterEach(() => cleanup())

const byText = s => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === s)
const openStock = async () => {
  render(<StockStatus drugs={DRUGS} inv={[]} navFilter={null}
    onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
}
const openTx = async () => {
  render(<TransactionForm drugs={DRUGS} onReload={() => {}} navFilter={null} />)
  await waitFor(() => expect(document.body.textContent).toContain('이력'))
}

const 사용량단추 = ['사용량 양식', '사용량 업로드', '출고 자동집계']

describe('① 재고현황 — 사용량 단추 3곳', () => {
  it('owner — 셋 다 보인다', async () => {
    ROLE = { memberRole: 'owner', profile: { role: 'user' } }
    await openStock()
    for (const s of 사용량단추) expect(byText(s), s).toBeTruthy()
  })
  it('★ admin — 셋 다 없다', async () => {
    ROLE = { memberRole: 'admin', profile: { role: 'user' } }
    await openStock()
    for (const s of 사용량단추) expect(byText(s), s).toBeFalsy()
  })
  it('★ profiles.role=admin — 셋 다 없다', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'admin' } }
    await openStock()
    for (const s of 사용량단추) expect(byText(s), s).toBeFalsy()
  })
  it('★ 일반 직원 — 셋 다 없다', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'user' } }
    await openStock()
    for (const s of 사용량단추) expect(byText(s), s).toBeFalsy()
  })
  it('★ 역할을 아직 못 읽었을 때(null) 도 없다', async () => {
    ROLE = { memberRole: null, profile: null }
    await openStock()
    for (const s of 사용량단추) expect(byText(s), s).toBeFalsy()
  })
  it('★ DOM 에서 아예 뺀다 — 글자도 안 남는다', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'user' } }
    await openStock()
    for (const s of 사용량단추) expect(document.body.textContent, s).not.toContain(s)
  })
  it('★ 역할과 무관한 「엑셀」은 누구에게나 보인다', async () => {
    for (const r of [{ memberRole: 'owner', profile: null }, { memberRole: 'member', profile: null }, { memberRole: null, profile: null }]) {
      ROLE = r
      await openStock()
      expect(byText('엑셀'), JSON.stringify(r)).toBeTruthy()
      cleanup()
    }
  })
})

describe('② 출고관리 — 삭제 단추 2곳 + 체크박스', () => {
  it('owner — 전체삭제가 보인다', async () => {
    ROLE = { memberRole: 'owner', profile: { role: 'user' } }
    await openTx()
    expect(byText('전체삭제')).toBeTruthy()
  })
  for (const [name, r] of [
    ['admin', { memberRole: 'admin', profile: { role: 'user' } }],
    ['profiles.admin', { memberRole: 'member', profile: { role: 'admin' } }],
    ['일반 직원', { memberRole: 'member', profile: { role: 'user' } }],
    ['역할 못 읽음', { memberRole: null, profile: null }],
  ]) {
    it('★ ' + name + ' — 전체삭제가 없다', async () => {
      ROLE = r
      await openTx()
      expect(byText('전체삭제')).toBeFalsy()
      expect(document.body.textContent).not.toContain('전체삭제')
    })
  }
  it('★ 체크박스 열도 함께 사라진다 — 고를 수가 없다', async () => {
    ROLE = { memberRole: 'owner', profile: null }
    await openTx()
    const owner = document.querySelectorAll('thead input[type="checkbox"]').length
    cleanup()
    ROLE = { memberRole: 'member', profile: null }
    await openTx()
    const staff = document.querySelectorAll('thead input[type="checkbox"]').length
    expect(owner, 'owner 에게는 전체선택 칸이 있다').toBeGreaterThan(0)
    expect(staff, '직원에게는 없다').toBe(0)
  })
})

/* ═══ ③ 소스 고정 — 되돌아가지 않게 ═══ */
describe('③ 조건이 owner 단독인지 소스로 못 박는다', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  it('★ 이름이 뜻을 드러낸다 — isOwner 가 아니라 isTenantOwner', () => {
    expect(APP).toContain("const isTenantOwner=memberRole==='owner'")
    expect(APP).toContain('const canRecompute=isTenantOwner')
  })
  it('★ 사용량 단추 2곳이 isTenantOwner 로 묶였다', () => {
    expect(APP).toContain('{isTenantOwner&&<button onClick={dlUsageTemplate}')
    expect(APP).toContain('{isTenantOwner&&<button onClick={()=>uRef.current.click()}')
  })
  it('★ 출고관리 canDel 이 owner 단독이다', () => {
    expect(APP).toContain("const canDel=memberRole==='owner';")
  })
  it('★ 발주관리·약품변경의 canDel 은 그대로 (건드리지 않았다)', () => {
    const n = (APP.match(/const canDel = memberRole === 'owner' \|\| memberRole === 'admin' \|\| profile\?\.role === 'admin'/g) || []).length
    expect(n, '두 화면은 옛 조건 그대로여야 한다').toBe(2)
  })
  it('★ 월마감 isOwner(5707 쪽)도 그대로', () => {
    expect(APP).toContain("const isOwner=memberRole==='owner'")
  })
})

/* ═══ ④ 역할 읽기 보완 ═══ */
describe('④ 역할을 못 읽어 단추가 사라지던 것을 푼다', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  it('★ 실패하면 원문을 콘솔에 남긴다 — 왜 안 보이는지 알 수 있게', () => {
    expect(APP).toContain("console.error('[역할 읽기 실패]'")
  })
  it('★ 최대 2번 더 해 본다 (지연 뒤)', () => {
    expect(APP).toMatch(/if \(tries < 2\) \{ setTimeout\(\(\) => loadMemberRole\(tries \+ 1\), 800 \* \(tries \+ 1\)\); return \}/)
  })
  it('★ 로그인·토큰 갱신 때 역할을 다시 읽는다', () => {
    expect(APP).toContain("if (_event === 'TOKEN_REFRESHED' || _event === 'SIGNED_IN') setRoleTick(n => n + 1)")
    expect(APP).toContain('useEffect(() => { loadMemberRole() }, [user, roleTick])')
  })
  it('화면에 새로 그리는 것은 없다 — 안내 문구를 넣지 않았다', () => {
    const i = APP.indexOf('[역할 읽기 실패]')
    const block = APP.slice(i - 600, i + 600)
    expect(block).not.toContain('setMsg')
    expect(block).not.toContain('setDialog')
  })
})
