/* 수요 현황 — 「원문 보기 / 가리기」 버튼의 동작을 실제로 눌러 확인한다.
   ★ supabase 는 통째로 가짜로 바꾼다 — 운영 DB 에 닿지 않는다.
   ★ 확인하려는 것은 네 가지다:
     ① 가린 상태에서 「원문 보기」를 누르면 원문이 보이고 view_raw 가 1건 남는다
     ② 열린 상태의 버튼은 「가리기」이고, 누르면 다시 가려지되 audit 은 **늘지 않는다**
     ③ 회차를 바꾸면 열린 줄이 모두 다시 가려진다
     ④ 탭을 떠나면(언마운트) 상태가 남지 않는다 = 다시 들어오면 가려져 있다
   ★ 새로고침은 브라우저가 모듈을 다시 읽는 것이므로 ④ 와 같은 성질이다(메모리 밖에 저장하지 않는다). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

/* ── 가짜 데이터 ───────────────────────────────────────────────────────── */
const SURVEYS = [
  { id: 's1', tenant_id: 'tn', account_id: 'ac', title: '독감(유료) 수요조사', season: '2026-2027', status: 'open', open_at: '2026-10-28T00:00:00Z', vax_start: '2026-11-01', vax_end: '2027-04-30', purged_at: null, category_ids: ['c1'], safety_ratio: 0.1, safety_min: 5, order_unit: 10 },
  { id: 's2', tenant_id: 'tn', account_id: 'ac', title: '독감(무료) 수요조사', season: '2026-2027', status: 'closed', open_at: '2026-10-01T00:00:00Z', vax_start: '2026-11-01', vax_end: '2027-04-30', purged_at: null, category_ids: ['c1'], safety_ratio: 0.1, safety_min: 5, order_unit: 10 },
]
const ROWS = {
  s1: [
    { id: 'r1', receipt_code: 'AB2345', emp_no: '123456', name: '김정화', name_key: '김정화', self_dose: true, family_count: 1, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0, created_at: '2026-10-28T00:00:00Z' },
    /* ★ 취소된 줄 — 기본 필터(상태=신청)에서는 보이지 않아야 한다 */
    { id: 'r2', receipt_code: 'CD6789', emp_no: '777777', name: '한가람', name_key: '한가람', self_dose: true, family_count: 0, wish_date: '2026-11-04', status: 'cancelled', done_self: false, done_family: 0, created_at: '2026-10-28T01:00:00Z' },
  ],
  s2: [{ id: 'r9', receipt_code: 'ZZ2345', emp_no: '999999', name: '박영수', name_key: '박영수', self_dose: true, family_count: 0, wish_date: '2026-11-05', status: 'applied', done_self: false, done_family: 0, created_at: '2026-10-28T00:00:00Z' }],
}
const DEMAND = { survey_id: 's1', demand_qty: 2, administered_qty: 0, remain_qty: 2, balance_qty: 10, safety_qty: 5, gap_qty: 0, order_qty: 0, demand_status: '충분', no_emp_cnt: 0, name_dup_cnt: 0, done_checked: 0, outside_qty: 0 }

/* 이 시험에서 일어난 audit INSERT 를 모아 둔다 */
const audits = []

vi.mock('./lib/supabase', () => {
  const result = (data) => Promise.resolve({ data, error: null })
  function from(table) {
    const q = {
      _tbl: table, _id: null,
      select() { return q },
      eq(col, v) { if (col === 'survey_id' || col === 'id') q._id = v; return q },
      order() { return q },
      range() { return q },
      limit() { return q },
      maybeSingle() { return result(q._tbl === 'v_vaccine_demand' ? DEMAND : null) },
      insert(row) { if (q._tbl === 'vaccine_survey_audit') audits.push(row); return result(null) },
      update() { return q },
      then(res) {
        if (q._tbl === 'vaccine_surveys') return result(SURVEYS).then(res)
        if (q._tbl === 'vaccine_survey_responses') return result(ROWS[q._id] || []).then(res)
        return result([]).then(res)
      },
    }
    return q
  }
  return { supabase: { from, rpc: () => result(null), auth: { getUser: () => result(null) } } }
})

vi.mock('./lib/theme', () => ({
  useTheme: () => ({
    t: {
      bg: '#fff', card: '#fff', border: '#ddd', text: '#111', textM: '#555', textL: '#888',
      accent: '#804A87', accentL: '#eee', navText: '#fff', purple: '#804A87', green: '#019748',
      greenL: '#eafaf0', red: '#c00', amber: '#c80', lavender: '#BFA6D9', lavL: '#f2ecf7',
    },
  }),
}))

import VaccineSurveyPanel from './VaccineSurveyPanel'

/* 화면이 쓰는 공용 컴포넌트는 props 로 받는다 — 진짜를 끌어오지 않고 최소한으로 흉내 낸다. */
/* ★ filter 를 읽는 방식은 **진짜 ColMenu(App.jsx)와 똑같이** 한다 —
     filter.items.map · filter.value · filter.on. 모양이 어긋나면 여기서 그대로 터진다.
     진짜가 이 세 키를 쓴다는 것은 아래 「ColMenu 계약」 시험이 소스에서 확인한다. */
function ColMenu({ label, filter }) {
  const [open, setOpen] = useState(false)
  return <span>
    <button onClick={() => setOpen(o => !o)}>{label}</button>
    {open && filter ? <span>
      <button onClick={() => { filter.on(null); setOpen(false) }}>
        {filter.value ? '전체' : '전체(선택됨)'}
      </button>
      {filter.items.map(v => <button key={v} onClick={() => { filter.on(v); setOpen(false) }}>
        {v}{filter.value === v ? '✓' : ''}
      </button>)}
    </span> : null}
  </span>
}
function useSort(initKey, initDir) {
  return {
    sk: initKey, sd: initDir, setSort: () => {},
    hs: () => ({}), so: list => list, SI: () => null, TS: () => null,
  }
}
const props = { ColMenu, useSort, accs: [{ id: 'ac', label: '유료' }], cats: [{ id: 'c1', label: '직원(유료)' }], isAdmin: true }

/* 명단 **첫 줄**의 열람 버튼. 줄이 여럿일 수 있으므로 첫 번째를 쓴다. */
const btn = () => screen.getAllByRole('button', { name: /원문 보기|가리기/ })[0]

beforeEach(() => { audits.length = 0; cleanup() })

describe('원문 보기 / 가리기', () => {
  it('① 처음에는 가려져 있고 버튼 글자가 「원문 보기」다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    expect(await screen.findByText('김*화')).toBeTruthy()
    expect(btn().textContent).toBe('원문 보기')
    expect(screen.getByText('12**56')).toBeTruthy()
    expect(audits).toHaveLength(0)
  })

  it('② 「원문 보기」를 누르면 성명·사번이 원문이 되고 view_raw 가 1건 남는다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    fireEvent.click(btn())
    expect(await screen.findByText('김정화')).toBeTruthy()
    expect(screen.getByText('123456')).toBeTruthy()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toEqual({ survey_id: 's1', action: 'view_raw', response_id: 'r1' })
  })

  it('★ ③ 열린 줄의 버튼은 「가리기」이고, 누르면 다시 가려진다 — audit 은 늘지 않는다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    fireEvent.click(btn())
    await screen.findByText('김정화')
    expect(btn().textContent).toBe('가리기')

    fireEvent.click(btn())
    expect(await screen.findByText('김*화')).toBeTruthy()
    expect(screen.getByText('12**56')).toBeTruthy()
    expect(screen.queryByText('김정화')).toBeNull()
    expect(btn().textContent).toBe('원문 보기')
    /* ★ 가리기는 기록을 남기지 않는다 — 여는 동안 쌓인 1건 그대로다 */
    expect(audits).toHaveLength(1)
  })

  it('★ ④ 다시 열면 view_raw 가 또 남는다 — 열람 횟수는 빠짐없이 잡힌다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    fireEvent.click(btn())                       /* 보기 1 */
    await screen.findByText('김정화')
    fireEvent.click(btn())                       /* 가리기 (기록 없음) */
    await screen.findByText('김*화')
    fireEvent.click(btn())                       /* 보기 2 */
    await screen.findByText('김정화')
    expect(audits).toHaveLength(2)
    expect(audits.every(a => a.action === 'view_raw')).toBe(true)
  })

  it('★ ⑤ 버튼 모양은 「원문 보기」와 「가리기」가 완전히 같다 — 글자만 다르다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    const before = btn().getAttribute('style')
    fireEvent.click(btn())
    await screen.findByText('김정화')
    expect(btn().getAttribute('style')).toBe(before)
    expect(btn().textContent).toBe('가리기')
  })

  it('★ ⑥ 회차를 바꾸면 열린 줄이 다시 가려진다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    fireEvent.click(btn())
    await screen.findByText('김정화')

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 's2' } })
    expect(await screen.findByText('박*수')).toBeTruthy()
    expect(screen.queryByText('박영수')).toBeNull()
    expect(btn().textContent).toBe('원문 보기')
  })

  it('★ ⑦ 탭을 떠나면(언마운트) 열린 상태가 남지 않는다 — 새로고침과 같은 성질', async () => {
    const { unmount } = render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    fireEvent.click(btn())
    await screen.findByText('김정화')
    unmount()

    render(<VaccineSurveyPanel {...props} />)
    expect(await screen.findByText('김*화')).toBeTruthy()
    expect(screen.queryByText('김정화')).toBeNull()
    expect(btn().textContent).toBe('원문 보기')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   표 헤더 필터 — 2026-10-28 흰 화면 결함의 회귀 시험

   결함: 패널이 { values, sel, onSel } 을 넘겼는데 공용 ColMenu 는
   { items, value, on } 을 읽는다. ColMenu 가 filter.items.map 을 무조건 부르므로
   머리글을 누르는 순간 TypeError → ErrorBoundary 가 없어 화면 전체가 하얘졌다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('ColMenu 계약 — 공용 컴포넌트가 읽는 키', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
  it('★ 진짜 ColMenu 는 items·value·on 을 읽는다 (대역이 이것과 같아야 한다)', () => {
    expect(APP).toContain('filter.items.map')
    expect(APP).toContain('filter.on(')
    expect(APP).toContain('filter.value')
  })
  it('★ 패널은 values·sel·onSel 을 더 이상 넘기지 않는다', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/VaccineSurveyPanel.jsx'), 'utf8')
    const jsx = panel.slice(panel.indexOf('<ColMenu'))
    for (const bad of ['values:', 'sel:', 'onSel:']) {
      expect(jsx.includes(bad), '옛 prop 이 남아 있다: ' + bad).toBe(false)
    }
    expect(jsx).toContain('items:')
    expect(jsx).toContain('value:')
    expect(jsx).toContain('on:')
  })
})

describe('헤더 필터 — 눌러도 터지지 않고 실제로 걸린다', () => {
  const head = name => screen.getByRole('button', { name })

  it('★ 사번·본인·희망일·상태 머리글을 눌러도 오류가 없다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    for (const h of ['사번', '본인', '희망일', '상태']) {
      expect(() => fireEvent.click(head(h)), h + ' 머리글').not.toThrow()
      expect(screen.getByRole('button', { name: /전체/ }), h + ' 메뉴가 열려야 한다').toBeTruthy()
      fireEvent.click(head(h))        /* 닫기 */
    }
  })

  it('★ 값을 고르면 줄 수가 바뀐다 — 희망일로 거르기', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('김*화')
    expect(screen.getByText('2건')).toBeTruthy()          /* 거르기 전 2건 */

    fireEvent.click(head('희망일'))
    fireEvent.click(screen.getByRole('button', { name: /2026-11-04/ }))
    expect(await screen.findByText('1건')).toBeTruthy()
    expect(screen.getByText('한*람')).toBeTruthy()
    expect(screen.queryByText('김*화')).toBeNull()

    fireEvent.click(head('희망일'))
    fireEvent.click(screen.getByRole('button', { name: /^전체/ }))
    expect(await screen.findByText('2건')).toBeTruthy()   /* 해제하면 다시 2건 */
  })
})
