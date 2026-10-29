/* 「일부 미반영」 화면 표시 — **진짜 컴포넌트**(App.jsx)를 렌더해 확인한다.
   ★ 가짜 대역으로는 못 잡는 결함을 잡으려는 시험이다(VaccineSurveyFilter.test.jsx 와 같은 방식).
   ★ supabase 는 통째로 가짜다. 운영 DB 에 닿지 않는다.
   ★ 확인하는 것
     ① 폴백이 컬럼을 버리면 성공 배너 대신 연보라 「일부 미반영」이 뜬다
     ② 그때 모달이 **자동으로 닫히지 않는다**(onClose 미호출) — 목록 새로고침은 한다(onSaved 호출)
     ③ 버린 것이 없으면 「✅ 저장 완료」 (예전 「✅ API 조회 완료!」 오표기 교정)
     ④ 표 인라인 칸은 연보라 + title 안내 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { PARTIAL_BG, PARTIAL_FG, PARTIAL_LINE, partialText } from './lib/saveWithFallback'

/* PostgREST PGRST204 — 폴백을 발동시키는 유일한 문구 */
const pgrst = col => ({ message: `Could not find the '${col}' column of 'drugs' in the schema cache`, code: 'PGRST204' })

/* drugs 쓰기에 돌려줄 오류를 시험마다 바꾼다 */
let drugsErrors = []
let drugsCalls = []

vi.mock('./lib/supabase', () => {
  const ok = d => Promise.resolve({ data: d, error: null })
  function from(table) {
    const q = {
      _tbl: table, _payload: null,
      select() { return q }, eq() { return q }, order() { return q }, limit() { return q },
      maybeSingle() { return ok(null) },
      insert(p) { q._payload = p; return finish() },
      update(p) { q._payload = p; return q },
      then(res) { return finish().then(res) },
    }
    function finish() {
      if (q._tbl !== 'drugs') return ok([])
      drugsCalls.push(q._payload)
      const e = drugsErrors.shift()
      return Promise.resolve({ data: null, error: e || null })
    }
    /* update 는 .eq() 뒤에 await 되므로 then 으로 마무리된다 */
    return q
  }
  return { supabase: { from, rpc: () => ok(null), auth: { getUser: () => ok({ user: { id: 'u1' } }) } } }
})

import { ThemeCtx } from './lib/theme'
import { DrugEditModal, IdleRegisterModal, ET } from './App'

/* 컴포넌트가 실제로 읽는 토큰만 채운다 — themes 를 export 하면 react-refresh 규칙에 걸린다 */
const T = {
  t: {
    bg: '#fff', card: '#fff', cardSolid: '#fff', border: '#e5e5e5', borderH: '#ccc',
    text: '#222', textM: '#666', textL: '#999', accent: '#BFA6D9',
    green: '#019748', greenL: '#E6F4EA', red: '#D9342B', redL: '#FDECEA',
    amber: '#E65100', blue: '#2B7BB9', purple: '#BFA6D9', shadow: 'none', shadowH: 'none',
  },
  profile: { role: 'admin' }, memberRole: 'owner',
}
const wrap = ui => render(<ThemeCtx.Provider value={T}>{ui}</ThemeCtx.Provider>)

beforeEach(() => { drugsErrors = []; drugsCalls = []; vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/* 연보라 배너를 문구로 찾아 그 요소를 돌려준다 */
const partialBanner = cols => screen.queryByText(partialText(cols))

/* ★ 색 비교는 자기 보정으로 한다 — jsdom 이 `rgba(191,166,217,0.45)` 를
   `rgba(191, 166, 217, 0.45)` 로, 8자리 hex 를 다른 표기로 바꿔 쓴다.
   같은 값을 같은 엔진에 한 번 통과시켜 비교하면 표기 차이에 흔들리지 않는다. */
const css = (prop, v) => { const d = document.createElement('div'); d.style[prop] = v; return String(d.style[prop]).replace(/\s/g, '').toLowerCase() }
const bgOf = el => String(el.style.background).replace(/\s/g, '').toLowerCase()
const fgOf = el => String(el.style.color).replace(/\s/g, '').toLowerCase()

describe('DrugEditModal — 약품 정보 수정', () => {
  const DRUG = { id: 'd1', drug_code: 'A001', drug_name: '가바로닌캡슐100mg', category: '경구제', status: '사용' }

  async function save(errors) {
    drugsErrors = errors
    const onClose = vi.fn(), onSaved = vi.fn()
    wrap(<DrugEditModal drug={DRUG} onClose={onClose} onSaved={onSaved} />)
    const btn = screen.getAllByRole('button', { name: /저장/ })[0]
    await act(async () => { fireEvent.click(btn) })
    return { onClose, onSaved }
  }

  it('★ 버린 컬럼이 있으면 연보라 「일부 미반영」이 뜨고, 모달이 닫히지 않는다', async () => {
    const { onClose, onSaved } = await save([pgrst('efficacy_class')])
    const el = partialBanner(['efficacy_class'])
    expect(el, '「일부 미반영」 문구가 없다').toBeTruthy()
    expect(bgOf(el)).toBe(css('background', PARTIAL_BG))
    expect(fgOf(el)).toBe(css('color', PARTIAL_FG))
    /* ② 자동으로 닫지 않는다 — 사용자가 읽고 닫는다 */
    expect(onClose, '모달이 자동으로 닫혔다').not.toHaveBeenCalled()
    /* 저장은 됐으므로 목록은 새로고침한다 */
    expect(onSaved).toHaveBeenCalled()
    /* 성공 배너는 뜨지 않는다 */
    expect(screen.queryByText('✅ 저장 완료')).toBeNull()
  })

  it('★ 버린 것이 없으면 「✅ 저장 완료」 — 예전엔 「✅ API 조회 완료!」가 떴다', async () => {
    await save([])
    expect(screen.getByText('✅ 저장 완료')).toBeTruthy()
    expect(screen.queryByText('✅ API 조회 완료!'), '조회 문구가 저장에 뜬다').toBeNull()
    expect(partialBanner([])).toBeNull()
  })

  it('두 컬럼을 버리면 둘 다 이름으로 알려 준다', async () => {
    await save([pgrst('additive'), pgrst('efficacy_class')])
    /* additive 는 FIELD_DEFS 라벨(첨가제), efficacy_class 는 라벨이 없어 컬럼 이름 그대로 */
    expect(partialBanner(['additive', 'efficacy_class'])).toBeTruthy()
    expect(screen.getByText(/첨가제, efficacy_class/)).toBeTruthy()
  })

  it('저장 자체가 실패하면 기존 오류 표시 그대로 — 연보라 아님', async () => {
    await save([{ message: 'permission denied for table drugs', code: '42501' }])
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    expect(screen.queryByText(/일부 미반영/)).toBeNull()
  })
})

describe('IdleRegisterModal — 사용 점검 등록', () => {
  const DRUGS = [{ drug_code: 'A001', drug_name: '가바로닌캡슐100mg', last_used_date: null }]

  it('★ 버린 컬럼이 있으면 연보라 안내 + 닫지 않는다', async () => {
    drugsErrors = [pgrst('last_used_dept')]
    const onClose = vi.fn(), onSaved = vi.fn()
    wrap(<IdleRegisterModal drugs={DRUGS} onClose={onClose} onSaved={onSaved} />)
    /* 약품 검색 → 선택 */
    fireEvent.change(screen.getByPlaceholderText(/약품 검색/), { target: { value: '가바로닌' } })
    fireEvent.click(screen.getByText(/가바로닌캡슐100mg/))
    /* 마지막 사용일 입력 */
    const dates = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dates[0], { target: { value: '2026-01-02' } })
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0]) })

    const el = partialBanner(['last_used_dept'])
    expect(el, '「일부 미반영」 문구가 없다').toBeTruthy()
    expect(bgOf(el)).toBe(css('background', PARTIAL_BG))
    expect(onClose, '모달이 자동으로 닫혔다').not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalled()
    expect(screen.queryByText('저장 완료')).toBeNull()
  })
})

describe('표 인라인 칸 — 유효기한(ET)', () => {
  const ITEM = { drug_code: 'A001', drug_name: '가바로닌캡슐100mg', category: '경구제', current_qty: 10, expiry_date: '2026-11-15', status: '사용', last_used_dept: '내과', last_used_date: '2026-10-01', recommended_action: null, expiry_notes: null }
  const props = {
    items: [ITEM], color: '#D9342B', label: '긴급', sub: '≤30일',
    editRow: null, editField: null, startEdit: () => {}, saveField: () => {}, closeEdit: () => {}, saveNote: () => {},
    onEdit: () => {}, unusedDays: () => null, isUnused: () => false,
    alertSt: () => ({ text: '▲긴급▲', c: '#fff', bg: '#E65100' }),
    ip2: {}, onDispose: () => {}, canDispose: true,
  }
  const cellOf = key => document.querySelector(`td[title="${key}"]`)

  it('★ partial 이면 연보라 배경 + title 안내 (초록·빨강 아님)', () => {
    const msg = partialText(['last_used_dept'])
    wrap(<table><tbody><ET {...props} fb={{ 'A001:last_used_dept': { k: 'partial', m: msg } }} /></tbody></table>)
    const td = cellOf(msg)
    expect(td, 'title 에 안내 문구가 실린 칸이 없다').toBeTruthy()
    expect(bgOf(td)).toBe(css('background', PARTIAL_BG))
  })

  it('ok 는 기존 초록 틴트 그대로 · title 없음', () => {
    wrap(<table><tbody><ET {...props} fb={{ 'A001:last_used_dept': { k: 'ok' } }} /></tbody></table>)
    const tds = [...document.querySelectorAll('td')].filter(x => bgOf(x) === css('background', '#01974826'))
    expect(tds.length, '초록 틴트 칸이 없다').toBe(1)
    expect(tds[0].getAttribute('title')).toBeNull()
  })

  it('err 는 기존 빨강 틴트 그대로', () => {
    wrap(<table><tbody><ET {...props} fb={{ 'A001:last_used_dept': { k: 'err' } }} /></tbody></table>)
    const tds = [...document.querySelectorAll('td')].filter(x => bgOf(x) === css('background', T.t.redL))
    expect(tds.length).toBe(1)
  })
})

describe('표 인라인 칸 — 사용점검(IdleCheck) 색 값', () => {
  /* ★ IdleCheck 의 _fbSt 는 내부 클로저라 렌더로 직접 찍기 어렵다.
     색 값이 승인받은 것인지, partial 분기가 있는지를 소스에서 확인한다(렌더 시험이 아님을 밝힌다). */
  it('partial 분기가 연보라 테두리를 쓴다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/App.jsx', 'utf8')
    const i = src.indexOf("const _fbSt = key => { const v = fb[key]")
    expect(i, 'IdleCheck 의 _fbSt 를 못 찾음').toBeGreaterThan(0)
    const line = src.slice(i, src.indexOf('\n', i))
    expect(line).toContain("v.k === 'partial' ? PARTIAL_LINE")
    expect(line).toContain("inset 0 0 0 2px")
    /* 두 칸에 title 이 달려 있다 */
    expect((src.match(/_fbTi\(r\.drug_code \+ ':/g) || []).length).toBe(2)
  })
  it('승인받은 색 값만 쓴다', () => {
    expect(PARTIAL_LINE).toBe('#BFA6D9')
    expect(PARTIAL_BG).toBe('rgba(191,166,217,0.45)')
    expect(PARTIAL_FG).toBe('#2E4A62')
  })
})
