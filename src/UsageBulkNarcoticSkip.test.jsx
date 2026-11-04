/* A단계 — **일괄 등록 탭**도 마약·향정 1개월·3개월을 건너뛴다 (확정 업무 규칙 9).

   ★ 왜 이 시험이 따로 있나
     일괄 등록은 개별 등록과 **다른 길**로 저장한다 — 개별은 DB 함수(app_save_usage_bulk),
     일괄은 `drugs` 를 줄마다 update 한다. 그래서 한쪽만 고치면 **탭에 따라 답이 달라진다.**
     이정화 님이 ⓐ(둘 다 건너뜀)로 정하셨으므로 두 길을 **같은 함수 하나**(narcCodes)로 묶고
     그 결과를 여기서 본다.

   ★ 함께 고정하는 것 — 모달이 File 을 그대로 넘길 때 `e.target.value=''` 로 터지지 않는다.
     (#399 에서 들어간 결함. 파일 읽기는 이미 시작돼 화면은 뜨지만 누를 때마다 예외가 났다.) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'

/* 운영 실제 약품 — 2026-11-04 실측 */
const mk = (code, name, nt, extra = {}) => ({
  drug_code: code, drug_name: name, category: '경구제', status: '사용', narcotic_type: nt,
  current_qty: 100, safety_stock: 10, max_stock: 300, purchase_price: 100,
  prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100,
  recent_1m_usage: 50, usage_source: 'manual', expiry_date: '2027-06-01', ...extra,
})
const DRUGS = [
  mk('APR2', '알프람정0.25mg', '향정'),
  mk('MYPC', '마이폴캡슐10mg', '마약'),
  mk('CHNS', '코포나시럽', '한외마약'),
  mk('GABA', '가바로닌캡슐100mg', '일반'),
]

/* 올라온 파일 — 네 약품 모두 세 칸에 값이 있다 */
let SHEET_ROWS = []
vi.mock('xlsx', () => ({
  read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
  utils: {
    sheet_to_json: () => SHEET_ROWS,
    book_new: () => ({}), book_append_sheet: () => {}, json_to_sheet: () => ({}),
    aoa_to_sheet: () => ({}), sheet_add_aoa: () => {}, encode_cell: () => 'A1',
  },
  writeFile: () => {},
}))

const updates = []
vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const mkQ = () => {
    const st = {}
    const q = {
      select: () => q, in: () => q, gte: () => q, lt: () => q, order: () => q,
      range: () => result([]), limit: () => result([]), maybeSingle: () => result(null),
      insert: () => result(null), upsert: () => result(null), delete: () => q,
      update: payload => { st.payload = payload; return q },
      eq: (col, val) => {
        if (st.payload && col === 'drug_code') { updates.push({ code: val, upd: st.payload }); return result(null) }
        return q
      },
      then(res) { return result([]).then(res) },
    }
    return q
  }
  return { supabase: { from: () => mkQ(), rpc: () => result(0), auth: { getUser: () => result(null) } } }
})
const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, setTheme: () => {}, memberRole: 'owner', profile: { role: 'user' } }) }
})

let StockStatus
beforeEach(async () => {
  updates.length = 0
  SHEET_ROWS = [
    { '약품코드': 'APR2', '약품명(참고용)': '알프람정0.25mg', '전년사용량': '200', '최근3개월사용량': '250', '직전1개월사용량': '103.5' },
    { '약품코드': 'MYPC', '약품명(참고용)': '마이폴캡슐10mg', '전년사용량': '152', '최근3개월사용량': '30', '직전1개월사용량': '7' },
    { '약품코드': 'CHNS', '약품명(참고용)': '코포나시럽', '전년사용량': '0', '최근3개월사용량': '2255', '직전1개월사용량': '768' },
    { '약품코드': 'GABA', '약품명(참고용)': '가바로닌캡슐100mg', '전년사용량': '3600', '최근3개월사용량': '900', '직전1개월사용량': '300' },
  ]
  if (!StockStatus) StockStatus = (await import('./App.jsx')).StockStatus
})
afterEach(() => cleanup())

const byText = s => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === s)

/* 모달을 열고 [일괄 등록] 탭에서 파일을 넘긴다 — 운영에서 실제로 쓰는 길이다 */
async function bulkUpload() {
  render(<StockStatus drugs={DRUGS} inv={[]} navFilter={null}
    onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
  fireEvent.click(byText('사용량 업로드'))
  fireEvent.click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '일괄 등록'))
  const input = document.querySelector('input[type="file"]:not([multiple])')
  const file = new File([new Uint8Array([1, 2, 3])], 'bulk.xlsx')
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(document.body.textContent).toMatch(/반영 대상/))
}

describe('일괄 등록 — 검토 화면', () => {
  it('★ File 을 그대로 넘겨도 터지지 않는다 (e.target 가드)', async () => {
    const errs = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errs.push(String(a[0])))
    await bulkUpload()
    spy.mockRestore()
    expect(errs.join(' ')).not.toMatch(/Cannot set properties of undefined/)
  })
  it('마약·향정 2종을 건너뛴다고 알린다', async () => {
    await bulkUpload()
    expect(document.body.textContent).toContain('마약·향정 2종 건너뜀 (출고 기준)')
    expect(document.body.textContent).toMatch(/전년사용량은 그대로 반영/)
    expect(document.body.textContent).toMatch(/한외마약은 해당하지 않습니다/)
  })
  it('건너뛴 약품 이름을 보여 준다', async () => {
    await bulkUpload()
    expect(document.body.textContent).toContain('알프람정0.25mg')
    expect(document.body.textContent).toContain('마이폴캡슐10mg')
  })
  it('반영 대상은 4종 그대로다 — 마약·향정도 전년은 들어간다', async () => {
    await bulkUpload()
    expect(document.body.textContent).toMatch(/반영 대상\s*4건/)
  })
})

describe('일괄 등록 — 실제로 저장되는 값', () => {
  const apply = async () => {
    await bulkUpload()
    fireEvent.click([...document.querySelectorAll('button')].find(b => /^반영 /.test(b.textContent.trim())))
    await waitFor(() => expect(updates.length).toBe(4))
    return Object.fromEntries(updates.map(u => [u.code, u.upd]))
  }
  it('★ 마약·향정에는 1개월·3개월이 아예 없다', async () => {
    const u = await apply()
    expect('recent_1m_usage' in u.APR2, '향정 1개월').toBe(false)
    expect('recent_3m_usage' in u.APR2, '향정 3개월').toBe(false)
    expect('recent_1m_usage' in u.MYPC, '마약 1개월').toBe(false)
    expect('recent_3m_usage' in u.MYPC, '마약 3개월').toBe(false)
  })
  it('★ 마약·향정의 전년사용량은 원내 값으로 저장된다', async () => {
    const u = await apply()
    expect(u.APR2.prev_year_usage).toBe(200)
    expect(u.MYPC.prev_year_usage).toBe(152)
  })
  it('★ 한외마약은 세 칸 모두 저장된다 — 일반약과 같다', async () => {
    const u = await apply()
    expect(u.CHNS.recent_1m_usage).toBe(768)
    expect(u.CHNS.recent_3m_usage).toBe(2255)
    expect(u.GABA.recent_1m_usage).toBe(300)
    expect(u.GABA.recent_3m_usage).toBe(900)
  })
  it('월평균 계산식은 그대로다 — 3개월이 있으면 ÷3, 없으면 ÷12', async () => {
    const u = await apply()
    /* 한외마약·일반 — 3개월이 있으므로 ÷3 (계산식 무변경) */
    expect(u.GABA.monthly_avg).toBe(Math.round(900 / 3))
    expect(u.GABA.safety_stock).toBe(Math.ceil(300 * 1.2))
    expect(u.GABA.max_stock).toBe(900)
    /* 마약·향정 — 3개월을 안 담았으므로 「3개월 없는 줄」과 똑같이 전년 ÷12 로 흐른다 */
    expect(u.APR2.monthly_avg).toBe(Math.round(200 / 12))
    expect(u.MYPC.monthly_avg).toBe(Math.round(152 / 12))
  })
  it('모든 줄에 usage_source=manual 이 붙는다 (수기 보호가 계속 걸린다)', async () => {
    const u = await apply()
    for (const code of ['APR2', 'MYPC', 'CHNS', 'GABA']) expect(u[code].usage_source).toBe('manual')
  })
})

describe('일괄 등록 — 넣을 값이 없어지는 경우', () => {
  it('마약·향정에 1개월·3개월만 있으면 그 줄은 반영 대상에서 빠진다', async () => {
    SHEET_ROWS = [
      { '약품코드': 'APR2', '약품명(참고용)': '알프람정0.25mg', '전년사용량': '', '최근3개월사용량': '250', '직전1개월사용량': '103.5' },
      { '약품코드': 'GABA', '약품명(참고용)': '가바로닌캡슐100mg', '전년사용량': '3600', '최근3개월사용량': '900', '직전1개월사용량': '300' },
    ]
    await bulkUpload()
    expect(document.body.textContent).toMatch(/반영 대상\s*1건/)
    expect(document.body.textContent).toContain('마약·향정 1종 건너뜀 (출고 기준)')
  })
})
