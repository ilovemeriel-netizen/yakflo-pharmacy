/* ★★ 2026-11-14 긴급 고침의 파수꾼 — **화면에 코드가 글자로 찍히면 안 된다.**
 *
 * 무슨 일이 있었나
 *   PR #469 에서 숨겨진 단추를 뷰어에게 보이게 하면서 `{게이트 && …}` 스무 곳을
 *   `{(게이트 || _ro) && <RO on={_ro}>…</RO>}` 로 바꿨다.
 *   그런데 보고서 화면의 한 곳은 안쪽이 **홑 원소가 아니라 괄호식**이었다.
 *
 *     {isOwner&&(rtype==='monthly' ? <button/>월마감 : <button/>연마감)}
 *
 *   이것을 통째로 <RO> 안에 넣으면 괄호식이 **JSX 의 글자**가 되어
 *   화면에 「(rtype==='monthly' ? ... )」 가 그대로 찍히고,
 *   두 단추가 **함께** 나오며, RO 는 자식이 하나가 아니라 **아무것도 안 막았다.**
 *
 * 왜 3,170건이 못 잡았나 — 그때 시험은 **소스 글자만 셌고 화면을 그려 보지 않았다.**
 *   `|| _ro) && <RO on={_ro}>` 개수가 20 이면 통과였는데, 고장난 곳도 그 꼴이었다.
 *
 * 그래서 여기서는 **진짜로 그려 보고** 글자를 읽는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    from: (...a) => from(...a),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch },
    removeChannel: () => {},
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  },
}))

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const { ThemeCtx } = await import('./lib/theme')
const A = await import('./App.jsx')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  lavender: '#BFA6D9', yellow: '#F9A825', grayB: '#CCCCCC', navText: '#F7F6F3', nav: '#2E4A62',
  shadow: '0 2px 8px rgba(46,74,98,0.06)', shadowH: '0 8px 24px rgba(46,74,98,0.10)' }

const DRUGS = [
  { id: 1, drug_code: 'AAA', drug_name: '가나다정', category: '경구제', status: '사용', narcotic_type: '일반',
    current_qty: 420, purchase_price: 198, monthly_avg: 30, safety_stock: 36, max_stock: 90,
    recent_3m_usage: 90, recent_1m_usage: 30, prev_year_usage: 360, usage_source: 'manual' },
]

/* 조회를 흉내 낸다 — 어떤 이어 붙이기가 와도 빈 결과를 준다 */
function chain() {
  const c = {}
  const keys = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not', 'or', 'order',
    'limit', 'range', 'filter', 'match', 'contains', 'overlaps', 'abortSignal']
  for (const k of keys) c[k] = () => c
  c.maybeSingle = () => Promise.resolve({ data: null, error: null })
  c.single = () => Promise.resolve({ data: null, error: null })
  c.then = res => Promise.resolve({ data: [], count: 0, error: null }).then(res)
  return c
}

const settle = async (n = 14) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }

const ctx = role => ({
  t: T, memberRole: role, profile: { role: 'member' }, user: { email: role + '@yakflo.local' },
  dark: false, toggle: () => {}, open360: () => {}, openSearch: () => {}, navTo: () => {},
  setMenu: () => {}, menu: 'report',
})

async function draw(role, node) {
  const r = render(<ThemeCtx.Provider value={ctx(role)}>{node}</ThemeCtx.Provider>)
  await settle()
  return r
}

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null })
  from.mockReset(); from.mockImplementation(() => chain())
})
afterEach(() => cleanup())

/* ★ 화면 글자에 섞이면 안 되는 코드 조각 */
const CODE_BITS = [
  "==='", '===', '!==', '&&', '=>', 'rtype', 'isOwner', '_ro', 'memberRole',
  'undefined', 'NaN', '[object Object]',
]
function leaks(text) {
  return CODE_BITS.filter(b => text.includes(b))
}

describe('★★ ① 보고서 화면 — 코드가 글자로 찍히지 않는다', () => {
  for (const role of ['viewer', 'owner']) {
    it(`${role} — 화면 글자에 코드 조각이 없다`, async () => {
      await draw(role, <A.Report drugs={DRUGS} onNav={() => {}} onReload={() => {}} />)
      const txt = document.body.innerText || document.body.textContent || ''
      expect(leaks(txt), '화면에 코드가 찍혔다: ' + leaks(txt).join(' · ')).toEqual([])
    })
  }

  it('★★ 월간 탭에는 **월마감만** 있고 연마감은 없다 (뷰어)', async () => {
    await draw('viewer', <A.Report drugs={DRUGS} onNav={() => {}} onReload={() => {}} />)
    expect(screen.queryByRole('button', { name: /월마감/ }), '월마감이 없다').toBeTruthy()
    expect(screen.queryByRole('button', { name: /연마감/ }), '월간인데 연마감이 함께 나온다').toBeNull()
  })

  it('★★ 뷰어의 월마감은 **흐리고 못 눌린다**', async () => {
    await draw('viewer', <A.Report drugs={DRUGS} onNav={() => {}} onReload={() => {}} />)
    const b = screen.getByRole('button', { name: /월마감/ })
    expect(b.disabled, '뷰어가 월마감을 누를 수 있으면 안 된다').toBe(true)
    expect(b.style.opacity).toBe('0.45')
  })

  it('관리자(owner)의 월마감은 전과 같다 — 사라지지도, 흐려지지도 않는다', async () => {
    await draw('owner', <A.Report drugs={DRUGS} onNav={() => {}} onReload={() => {}} />)
    const b = screen.getByRole('button', { name: /월마감/ })
    expect(b.style.opacity).not.toBe('0.45')
  })
})

describe('★ ② 다른 화면들도 — 뷰어로 그려 보고 글자를 읽는다', () => {
  const SCREENS = [
    ['재고현황', () => <A.StockStatus drugs={DRUGS} inv={[]} onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />],
    ['약품등록', () => <A.DrugRegister drugs={DRUGS} onRefresh={() => {}} />],
    ['향정마약', () => <A.NarcoticMgmt drugs={DRUGS} onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} />],
    ['입출고', () => <A.TransactionForm drugs={DRUGS} onReload={() => {}} />],
  ]
  for (const [name, make] of SCREENS) {
    it(`${name} — 뷰어 화면 글자에 코드 조각이 없다`, async () => {
      await draw('viewer', make())
      const txt = document.body.innerText || document.body.textContent || ''
      expect(leaks(txt), name + ' 에 코드가 찍혔다: ' + leaks(txt).join(' · ')).toEqual([])
    })
  }
})

describe('★★ ③ 소스 모양 파수꾼 — 같은 실수를 **글자 단계에서** 막는다', () => {
  it('★ 모든 <RO …> 바로 뒤에는 **JSX 원소**가 온다 (괄호식·글자 금지)', () => {
    const bad = []
    const re = /<RO on=\{[^}]*\}>/g
    let m
    while ((m = re.exec(APP))) {
      const after = APP.slice(m.index + m[0].length, m.index + m[0].length + 40)
      if (!/^\s*</.test(after)) {
        bad.push(APP.slice(0, m.index).split(/\r?\n/).length + '줄: ' + after.replace(/\r?\n/g, '⏎').slice(0, 40))
      }
    }
    expect(bad, '<RO> 안에는 **원소 하나만** 넣을 것. 갈래(삼항)는 **갈래마다 따로** 감쌀 것\n' + bad.join('\n')).toEqual([])
  })

  it('여는 <RO> 와 닫는 </RO> 수가 맞다', () => {
    const open = (APP.match(/<RO\s/g) || []).length
    const close = (APP.match(/<\/RO>/g) || []).length
    expect(open).toBe(close)
  })

  it('★ 보고서의 월마감·연마감은 **갈래마다 따로** 감쌌다', () => {
    expect(APP).toContain(`{(isOwner || _ro) && (rtype==='monthly'`)
    expect(APP).toContain(`? <RO on={_ro}><button onClick={requestClose}`)
    expect(APP).toContain(`: <RO on={_ro}><button onClick={showAnnualInfo}`)
  })
})

describe('★ ④ 부품 RO — 자식이 하나가 아니어도 **새지 않는다**', () => {
  it('여럿이면 하나씩 막는다', () => {
    const { container } = render(<RO2 />)
    const bs = [...container.querySelectorAll('button')]
    expect(bs.length).toBe(2)
    for (const b of bs) expect(b.disabled, '하나라도 안 막히면 안 된다').toBe(true)
  })
})
const { RO } = await import('./lib/readOnlyUi.jsx')
function RO2() {
  return <RO on><button>하나</button><button>둘</button></RO>
}
