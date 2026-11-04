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
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'
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
  it('★ admin — 셋 다 보인다 (이 약국의 관리자다)', async () => {
    ROLE = { memberRole: 'admin', profile: { role: 'user' } }
    await openStock()
    for (const s of 사용량단추) expect(byText(s), s).toBeTruthy()
  })
  /* ★ 전역 프로필의 admin 은 **이 약국의 멤버가 아니다** — DB(tenant_members)가 보는 기준과 맞춘다 */
  it('★ profiles.role=admin 뿐인 사람 — 셋 다 없다', async () => {
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

/* ═══ ② 출고관리 — **입고·출고 탭만** 더 좁게 본다 ═══
   폐기·반품 탭은 지금까지 쓰던 canDel(= owner·admin·profiles.admin) 그대로다. */
describe('② 출고관리 — 입고·출고 탭은 이 약국 관리자만', () => {
  const 체크칸 = () => document.querySelectorAll('thead input[type="checkbox"]').length

  for (const [name, r, 보임] of [
    ['owner', { memberRole: 'owner', profile: { role: 'user' } }, true],
    ['admin', { memberRole: 'admin', profile: { role: 'user' } }, true],
    ['★ profiles.admin 뿐인 사람', { memberRole: 'member', profile: { role: 'admin' } }, false],
    ['★ 일반 직원', { memberRole: 'member', profile: { role: 'user' } }, false],
    ['★ 역할 못 읽음', { memberRole: null, profile: null }, false],
  ]) {
    it(name + ' — 입고 탭 전체삭제가 ' + (보임 ? '보인다' : '없다'), async () => {
      ROLE = r
      await openTx()                       /* 기본 탭이 입고다 */
      if (보임) expect(byText('전체삭제')).toBeTruthy()
      else {
        expect(byText('전체삭제')).toBeFalsy()
        expect(document.body.textContent).not.toContain('전체삭제')
      }
    })
  }

  it('★ 체크박스 열도 함께 사라진다 — 고를 수가 없다', async () => {
    ROLE = { memberRole: 'owner', profile: null }
    await openTx()
    const owner = 체크칸()
    cleanup()
    ROLE = { memberRole: 'member', profile: null }
    await openTx()
    const staff = 체크칸()
    expect(owner, '관리자에게는 전체선택 칸이 있다').toBeGreaterThan(0)
    expect(staff, '직원에게는 없다').toBe(0)
  })

  /* ★ 폐기·반품은 바꾸지 않기로 했다 — profiles.admin 뿐인 사람도 그대로 쓸 수 있어야 한다 */
  it('★ 폐기 탭은 기존 canDel 그대로 — profiles.admin 뿐이어도 체크박스가 있다', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'admin' } }
    await openTx()
    expect(체크칸(), '입고 탭에서는 없다').toBe(0)
    fireEvent.click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '폐기관리'))
    await waitFor(() => expect(document.body.textContent).toContain('폐기 이력'))
    expect(체크칸(), '폐기 탭에서는 있다').toBeGreaterThan(0)
  })

  it('★ 반품 탭도 기존 canDel 그대로', async () => {
    ROLE = { memberRole: 'member', profile: { role: 'admin' } }
    await openTx()
    fireEvent.click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '반품관리'))
    await waitFor(() => expect(document.body.textContent).toContain('반품 이력'))
    expect(체크칸()).toBeGreaterThan(0)
  })
})


/* ═══ ③ 소스 고정 — 되돌아가지 않게 ═══ */
describe('③ 조건을 소스로 못 박는다', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  /* ★ 2026-11-03 기대값 변경 — 2곳 → 3곳. 보고서(Report)가 세 번째다.
       마감 전 「거래일 모두 바꾸기」 단추도 같은 역할(owner·admin)을 쓰며,
       DB 쪽 0107 RPC 가 **같은 기준**으로 다시 판정한다. 화면만 숨기는 것이 아니다. */
  it('★ 이름이 뜻을 드러낸다 — isOwner 가 아니라 isTenantManager', () => {
    expect((APP.match(/const isTenantManager=memberRole==='owner'\|\|memberRole==='admin'/g) || []).length,
      '재고현황·출고관리·보고서 세 곳').toBe(3)
    expect(APP).toContain('const canRecompute=isTenantManager')
  })

  it('★ 전역 프로필 admin 은 새 조건에 들어가지 않는다', () => {
    const i = APP.indexOf("const isTenantManager=memberRole==='owner'||memberRole==='admin'")
    const line = APP.slice(i, APP.indexOf('\n', i))
    expect(line, "profile?.role 을 보면 DB 기준과 어긋난다").not.toContain('profile')
  })

  /* ★ 2026-11-04 — 「사용량 올리기」가 파일 입력을 바로 여는 대신 **등록 모달**을 연다.
       묶인 조건(isTenantManager)은 그대로다. 모달 안의 「등록」 단추도 같은 조건을 보고,
       DB(0108)가 다시 판정하므로 화면만 숨기는 것이 아니다. */
  it('★ 사용량 단추 2곳이 isTenantManager 로 묶였다', () => {
    expect(APP).toContain('{isTenantManager&&<button onClick={dlUsageTemplate}')
    expect(APP).toContain('{isTenantManager&&<button onClick={()=>setUOpen(true)}')
  })

  it('★ 출고관리 canDel 은 **그대로** 두고 탭별로 갈랐다', () => {
    expect(APP, 'canDel 원래 식이 살아 있어야 한다')
      .toContain("const canDel=memberRole==='owner'||memberRole==='admin'||profile?.role==='admin'")
    expect(APP).toContain("const isLedgerTab=tab==='입고'||tab==='출고'")
    expect(APP).toContain('const canDelTab=isLedgerTab?isTenantManager:canDel')
  })

  it('★ 삭제 화면 5줄이 canDelTab 으로 바뀌었다 (단가 「마스터도 변경」은 canDel 그대로)', () => {
    expect((APP.match(/canDelTab&&/g) || []).length, '전체삭제·선택삭제·체크박스 열 2·칸 2').toBe(6)
    expect(APP, '단가 확인 창은 건드리지 않았다')
      .toContain('canDel&&<button onClick={()=>_doSave(ppConfirm.inputPp,true)}')
  })

  it('★ 발주관리·약품변경의 canDel 은 그대로 (건드리지 않았다)', () => {
    const n = (APP.match(/const canDel = memberRole === 'owner' \|\| memberRole === 'admin' \|\| profile\?\.role === 'admin'/g) || []).length
    expect(n, '두 화면은 옛 조건 그대로여야 한다').toBe(2)
  })

  it('★ 월마감 isOwner 도 그대로', () => {
    expect(APP).toContain("const isOwner=memberRole==='owner'")
  })

  /* ★ 역할 읽기 보완(재시도·TOKEN_REFRESHED·console.error)은 이 PR 에서 **뺐다**.
     마감 뒤 별도 작업으로 돌린다 — 인계문서 백로그 참조. */
  it('★ 역할 읽기 보완은 이번 PR 에 들어 있지 않다', () => {
    expect(APP).not.toContain('[역할 읽기 실패]')
    expect(APP).not.toContain('roleTick')
    expect(APP).toContain('useEffect(() => { loadMemberRole() }, [user])')
  })
})
