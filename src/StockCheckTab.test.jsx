/* 「사용량 갱신」을 재고관리 ▼ 에서 빼고 **재고현황 단추 하나**로 (2026-11-14 이정화 님 승인)
 *
 *   재고현황 단추 줄 … [엑셀][사용량 양식][사용량 업로드][기준확인]  → 주소 #stock/check
 *   기준확인 화면 머리 … [← 재고현황]  월평균·안전재고를 마감월 출고로 …
 *
 * ★ 기준 달은 **창이 스스로 최근 마감월을 찾는다** — 연·월을 넘기지 않는다.
 *   그래서 「마감 안 된 달」이 들어올 길이 없고, 미마감 가드도 필요 없다.
 *
 * ★★ 왜 **그려서** 재나 — 2026-11-14 월마감 고장의 교훈이다.
 *   그때 시험은 소스 글자만 세어 「개수 20」을 통과시켰고, 화면에는 코드가 찍히고
 *   단추가 둘 다 나오는데도 아무도 못 잡았다. 그래서 여기서는 **두 화면을 실제로 그려서**
 *   어떤 단추가 보이는지 읽는다 — 서로 새지 않는지가 핵심이다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  STOCK_TABS, STOCK_TAB_DEFAULT,
  stockTabFromHash, stockHash, redirectOldHash, OLD_ROUTE_REDIRECT,
} from './lib/stockRoute.js'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./lib/supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a), from: (...a) => from(...a),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch },
    removeChannel: () => {},
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  },
}))

const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const UCM = readFileSync(root('src/UsageCompareModal.jsx'), 'utf8')
const S35 = readFileSync(root('supabase/migrations/0135_recompute_scope_message.sql'), 'utf8')
const { ThemeCtx } = await import('./lib/theme')
const A = await import('./App.jsx')

const T = { mode: 'light', bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', redL: '#FFEBEE', amber: '#E65100',
  amberL: '#FFF3E0', blue: '#2E4A62', blueL: '#EAF0F5', purple: '#804A87', purpleL: '#F5EDF6',
  lavender: '#BFA6D9', shadow: 'none', shadowH: 'none' }

const DRUGS = [{ id: 1, drug_code: 'AAA', drug_name: '가나다정', category: '경구제', status: '사용',
  narcotic_type: '일반', current_qty: 420, purchase_price: 198, monthly_avg: 30, safety_stock: 36,
  max_stock: 90, recent_3m_usage: 90, recent_1m_usage: 30, prev_year_usage: 360, usage_source: 'auto' }]

function chain() {
  const c = {}
  for (const k of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) c[k] = () => c
  c.maybeSingle = () => Promise.resolve({ data: null, error: null })
  c.then = res => Promise.resolve({ data: [], count: 0, error: null }).then(res)
  return c
}
const settle = async (n = 16) => { for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve() }) }

const ctx = role => ({ t: T, memberRole: role, profile: { role: 'member' }, user: {}, dark: false,
  toggle: () => {}, open360: () => {}, openSearch: () => {}, navTo: () => {}, setMenu: () => {}, menu: 'stock' })

const drawStock = async (role = 'owner', onCheck = () => {}) => {
  const r = render(<ThemeCtx.Provider value={ctx(role)}>
    <A.StockStatus drugs={DRUGS} inv={[]} onEdit={() => {}} onAdjust={() => {}}
      onReload={() => {}} onDispose={() => {}} onCheck={onCheck} />
  </ThemeCtx.Provider>)
  await settle()
  return r
}
const drawCheck = async (role = 'owner', onBack = () => {}) => {
  const r = render(<ThemeCtx.Provider value={ctx(role)}>
    <A.UsageUpdateView drugs={DRUGS} onReload={() => {}} onBack={onBack} />
  </ThemeCtx.Provider>)
  await settle()
  return r
}
const names = () => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)

beforeEach(() => {
  rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null })
  from.mockReset(); from.mockImplementation(() => chain())
})
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/') })

/* ══ ① 주소 규칙 ═══════════════════════════════════════════════════ */
describe('★★ ① 주소 — #stock/check', () => {
  it('★ 주소에서 읽는다', () => {
    expect(stockTabFromHash('#stock/check')).toBe('check')
    expect(stockTabFromHash('#stock')).toBeNull()
    expect(stockTabFromHash('#stock/없는것')).toBeNull()
    expect(stockTabFromHash('#report/check'), '다른 화면 주소는 안 읽는다').toBeNull()
  })

  it('★ 주소로 적는다 — 기본은 꼬리를 안 붙인다', () => {
    expect(stockHash('check')).toBe('#stock/check')
    expect(stockHash('stock')).toBe('#stock')
    expect(stockHash('없는것')).toBe('#stock')
  })

  it('★★ 옛 주소 #usageupdate 를 넘긴다 — 즐겨찾기가 안 깨진다', () => {
    expect(redirectOldHash('#usageupdate')).toBe('#stock/check')
    expect(redirectOldHash('#usageupdate/무엇이든')).toBe('#stock/check')
    expect(redirectOldHash('#stock'), '지금 주소는 안 건드린다').toBeNull()
    expect(OLD_ROUTE_REDIRECT.usageupdate).toBe('#stock/check')
  })

  it('키와 기본값', () => {
    expect(STOCK_TABS).toEqual(['stock', 'check'])
    expect(STOCK_TAB_DEFAULT).toBe('stock')
  })
})

/* ══ ② 그려서 읽기 — 서로 새지 않는가 ═══════════════════════════ */
describe('★★ ② 두 화면을 그려서 — 단추가 서로 새지 않는다', () => {
  it('★★ 재고현황에 「기준확인」이 있고, 기준확인 단추들은 **없다**', async () => {
    await drawStock()
    const n = names()
    expect(n, '기준확인 단추').toContain('기준확인')
    expect(n, '엑셀').toContain('엑셀')
    expect(n, '사용량 양식').toContain('사용량 양식')
    expect(n.some(x => x.indexOf('출고 자동집계') === 0), '출고 자동집계가 새면 안 된다').toBe(false)
    expect(n.some(x => x.indexOf('고른') === 0), '적용 단추가 새면 안 된다').toBe(false)
    expect(n, '돌아가기가 새면 안 된다').not.toContain('← 재고현황')
  })

  it('★★ 기준확인 화면에 「← 재고현황」이 있고, 재고현황 단추들은 **없다**', async () => {
    await drawCheck()
    const n = names()
    expect(n, '돌아가기').toContain('← 재고현황')
    expect(n.some(x => x.indexOf('출고 자동집계') === 0), '출고 자동집계').toBe(true)
    expect(n.some(x => x.indexOf('고른') === 0), '고른 N종 적용').toBe(true)
    expect(n, '재고현황 전용 단추가 새면 안 된다').not.toContain('사용량 양식')
    expect(n, '재고현황 전용 단추가 새면 안 된다').not.toContain('사용량 업로드')
    expect(n, '자기 자신으로 가는 단추가 있으면 안 된다').not.toContain('기준확인')
  })

  it('★★ 화면 글자에 코드 조각이 없다 — 두 화면 모두', async () => {
    for (const draw of [drawStock, drawCheck]) {
      cleanup()
      await draw()
      const txt = document.body.innerText || document.body.textContent || ''
      for (const bit of ['===', '&&', '=>', 'stockTab', '_ro', 'undefined']) {
        expect(txt.includes(bit), '화면에 「' + bit + '」이 찍혔다').toBe(false)
      }
    }
  })

  it('★ 기준확인 화면 — 제목과 한 줄 설명', async () => {
    await drawCheck()
    const txt = document.body.textContent || ''
    expect(txt, '제목').toContain('기준확인')
    expect(txt, '부제').toContain('· 마감된 달 기준')
    expect(txt.includes('사용량 갱신'), '옛 제목이 남아 있다').toBe(false)
    expect(txt).toContain('월평균·안전재고를 마감월 출고로 다시 센 결과입니다')
    expect(txt).toContain('마감할 때 저절로 다시 셉니다')
  })

  it('★ 누르면 알려 준다 — 가기·돌아오기', async () => {
    const go = []
    await drawStock('owner', () => go.push('check'))
    fireEvent.click(screen.getByRole('button', { name: '기준확인' }))
    cleanup()
    const back = []
    await drawCheck('owner', () => back.push('stock'))
    fireEvent.click(screen.getByRole('button', { name: '← 재고현황' }))
    expect(go).toEqual(['check'])
    expect(back).toEqual(['stock'])
  })

  it('★★ 읽기 전용 — 단추·화면은 **보이고**, 쓰기만 흐림·못 누름', async () => {
    await drawStock('viewer')
    const btn = screen.getByRole('button', { name: '기준확인' })
    expect(btn, '뷰어에게도 보인다').toBeTruthy()
    expect(btn.disabled, '보는 화면으로 가는 단추는 눌려야 한다').toBe(false)
    cleanup()
    await drawCheck('viewer')
    expect(screen.getByRole('button', { name: '← 재고현황' }).disabled, '돌아가기는 눌려야 한다').toBe(false)
    const rec = [...document.querySelectorAll('button')].find(b => b.textContent.trim().indexOf('출고 자동집계') === 0)
    const app = [...document.querySelectorAll('button')].find(b => b.textContent.trim().indexOf('고른') === 0)
    expect(rec.disabled, '출고 자동집계는 못 눌러야 한다').toBe(true)
    expect(rec.style.opacity).toBe('0.45')
    expect(app.disabled, '적용은 못 눌러야 한다').toBe(true)
  })
})

/* ══ ③ 배선 ═══════════════════════════════════════════════════════ */
describe('★★ ③ 배선 — 메뉴·라우팅·띠·모양', () => {
  it('★★ 재고관리 ▼ 에서 「사용량 갱신」이 빠졌다 (9 → 8칸)', () => {
    expect(APP).toContain(`{ id: 'stock', l: '재고현황' }, { id: 'expiry', l: '유효기한' }`)
    expect(APP.includes(`{ id: 'usageupdate', l: '사용량 갱신' }`), '메뉴 칸이 남아 있다').toBe(false)
    const i = APP.indexOf(`{ id: 'stock', l: '재고관리'`)
    const seg = APP.slice(i, i + 600)
    const n = (seg.slice(0, seg.indexOf('] },')).match(/\{ id: '/g) || []).length - 1
    expect(n, '재고관리 ▼ 는 8칸이어야 한다').toBe(8)
  })

  it('★ 옛 라우팅이 사라지고 화면 갈아타기가 되었다', () => {
    expect(APP.includes(`{menu === 'usageupdate' && <UsageUpdateView`), '옛 라우팅이 남아 있다').toBe(false)
    expect(APP).toContain(`{menu === 'stock' && (stockTab === 'check'`)
    expect(APP).toContain(`onBack={() => goStockTab('stock')}`)
    expect(APP).toContain(`onCheck={() => goStockTab('check')}`)
  })

  it('★ 탭 띠는 만들지 않았다 — 단추 하나뿐이다', () => {
    expect(APP.includes('function StockTabs'), '탭 부품이 남아 있다').toBe(false)
    expect(APP.includes('STOCK_TAB_LABEL'), '탭 이름표가 남아 있다').toBe(false)
  })

  it('★★ 주소에서 바로 읽는다 — 따로 담아 두지 않는다', () => {
    expect(APP).toContain('const stockTab = useSyncExternalStore(')
    expect(APP).toContain('() => stockTabFromHash() || STOCK_TAB_DEFAULT,')
    expect(APP.includes('const [stockTab, setStockTab]'), '상태로 담으면 주소와 어긋난다').toBe(false)
  })

  it('★ 첫 진입에서 옛 주소를 넘긴다', () => {
    expect(APP).toContain('const _old = redirectOldHash()')
    expect(APP).toContain(`window.history.replaceState({ ykMenu: 'stock', ykStockTab: 'check' }, '', _old)`)
  })

  it('★★ 보고서 띠 「바뀐 약 N종 보기」가 기준확인으로 보낸다', () => {
    expect(APP).toContain(`window.history.pushState({ykMenu:'stock',ykStockTab:'check'},'',stockHash('check'))`)
    expect(APP).toContain(`onNav&&onNav({menu:'stock'})`)
  })

  it('★ 단추는 **기존 모양**이다 — 새 색 없음', () => {
    const i = APP.indexOf(`>기준확인</button>`)
    expect(i, '기준확인 단추를 못 찾았다').toBeGreaterThan(0)
    const line = APP.slice(APP.lastIndexOf('\n', i) + 1, i)
    expect(line).toContain(`padding:'6px 14px',borderRadius:8`)
    expect(line).toContain(`fontSize:11,fontWeight:600`)
    expect(line).toContain('t.purple')          /* 이미 쓰는 토큰 */
    expect(line.match(/#[0-9a-fA-F]{3,8}\b/g) || [], '새 색을 쓰지 말 것').toEqual([])
  })

  it('★ 검색창 스타일은 한 글자도 안 바꿨다', () => {
    expect(APP).toContain(`placeholder="검색..." style={{flex:1,minWidth:120,padding:'8px 12px'`)
  })

  it('★ 화면 제목이 「기준확인」이다 — 창일 때는 「사용량 비교」 그대로', () => {
    expect(UCM, '화면은 기준확인').toContain(`>기준확인{' '}`)
    expect(UCM, '부제가 갈라졌다').toContain(`· 마감된 달 기준</span>`)
    expect(UCM, '창은 그대로').toContain(`>사용량 비교 — 마감된 달 기준</div>`)
  })
})

/* ══ ④ 오류 글 ═══════════════════════════════════════════════════ */
describe('★ ④ 0135 — 오류 글 한 줄', () => {
  it('★ normal 이 글에 들어갔다', () => {
    expect(S35).toContain('알 수 없는 대상 범위입니다(all · normal · narcotic 만 됩니다)')
    expect(S35.includes('알 수 없는 대상 범위입니다(all · narcotic 만 됩니다)'), '옛 글이 남아 있다').toBe(false)
  })

  it('★ 동작은 한 글자도 안 바뀌었다 — 글자만 고쳤다', () => {
    expect(S35).toContain(`if p_scope = 'normal' then`)
    expect(S35).toContain(`where d.narcotic_type in ('마약', '향정')`)
    expect(S35).toContain('CREATE OR REPLACE FUNCTION public.app_recompute_usage(')
  })
})
