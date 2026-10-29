/* 신청 명단 표 — 머리글 칸 수 = 모든 행의 칸 수.

   ★ 왜 이 시험이 있나 (2026-10-30 운영 결함)
     PR #363 에서 「소속」 열을 **머리글·엑셀·PDF 에만** 더하고 **화면 행에는 칸을 넣지 않았다.**
     머리글 11칸 / 행 10칸이 되어 성명 다음부터 내용이 **한 칸씩 왼쪽으로 밀렸고**,
     「확인 사항」에 있어야 할 「취소됨·확인 완료」가 「접종 완료」 아래에 보였다.
     ※ 이 결함은 **시안 그림으로는 안 잡힌다** — 시안은 손으로 그린 표라 칸이 맞아 있었다.
       그래서 **진짜 컴포넌트를 렌더해** 칸을 센다.

   ★ 열을 더할 때는 네 곳을 함께 본다: 머리글(COLS) · 화면 행(<td>) · 엑셀 · PDF.
     엑셀·PDF 쪽은 src/lib/surveyExport.test.js 가 같은 성질을 본다. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

/* ── 가짜 데이터 — 행 모양을 전부 섞는다 ──────────────────────────────────
   ① 소속 있음 + 동명이인 선언(확인 전)  ② 소속 없음(옛 신청)
   ③ 소속 있음 + 확인 완료               ④ 취소 + 제한 중 접수
   칸이 하나라도 빠지면 그 줄에서 바로 걸린다. */
const SURVEYS = [
  { id: 's1', tenant_id: 'tn', account_id: 'ac', title: '독감(유료) 수요조사', season: '2026-2027', status: 'open', open_at: '2026-10-28T00:00:00Z', vax_start: '2026-11-01', vax_end: '2027-04-30', purged_at: null, category_ids: ['c1'], safety_ratio: 0.1, safety_min: 5, order_unit: 10 },
]
const ROWS = [
  { id: 'r1', receipt_code: 'AB2345', emp_no: '123456', name: '시험_가', name_key: '시험_가', dept: '약제과', dup_declared: true, dup_checked_at: null, locked_bypass: false, self_dose: true, family_count: 1, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0, created_at: '2026-10-28T00:00:00Z' },
  { id: 'r2', receipt_code: 'CD6789', emp_no: '777777', name: '시험_나', name_key: '시험_나', dept: null, dup_declared: false, dup_checked_at: null, locked_bypass: false, self_dose: false, family_count: 0, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0, created_at: '2026-10-28T01:00:00Z' },
  { id: 'r3', receipt_code: 'EF2345', emp_no: '888888', name: '시험_다', name_key: '시험_다', dept: '간호부', dup_declared: true, dup_checked_at: '2026-10-29T00:00:00Z', locked_bypass: false, self_dose: true, family_count: 2, wish_date: '2026-11-04', status: 'applied', done_self: true, done_family: 1, created_at: '2026-10-28T02:00:00Z' },
  { id: 'r4', receipt_code: 'GH2345', emp_no: null, name: '시험_라', name_key: '시험_라', dept: '원무과', dup_declared: true, dup_checked_at: null, locked_bypass: true, self_dose: true, family_count: 0, wish_date: '2026-11-05', status: 'cancelled', done_self: false, done_family: 0, created_at: '2026-10-28T03:00:00Z' },
]
const DEMAND = { survey_id: 's1', demand_qty: 5, administered_qty: 0, remain_qty: 5, balance_qty: 10, safety_qty: 5, gap_qty: 0, order_qty: 0, demand_status: '충분', no_emp_cnt: 1, name_dup_cnt: 0, done_checked: 2, outside_qty: 0 }

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  function from(table) {
    const q = {
      _tbl: table,
      select() { return q },
      eq() { return q },
      order() { return q },
      range() { return q },
      limit() { return q },
      maybeSingle() { return result(q._tbl === 'v_vaccine_demand' ? DEMAND : null) },
      insert() { return result(null) },
      update() { return q },
      then(res) {
        if (q._tbl === 'vaccine_surveys') return result(SURVEYS).then(res)
        if (q._tbl === 'vaccine_survey_responses') return result(ROWS).then(res)
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

function ColMenu({ label, filter }) {
  const [open, setOpen] = useState(false)
  return <span>
    <button onClick={() => setOpen(o => !o)}>{label}</button>
    {open && filter ? <span>
      <button onClick={() => { filter.on(null); setOpen(false) }}>전체</button>
      {filter.items.map(v => <button key={v} onClick={() => { filter.on(v); setOpen(false) }}>{v}</button>)}
    </span> : null}
  </span>
}
function useSort(initKey, initDir) {
  return { sk: initKey, sd: initDir, setSort: () => {}, hs: () => ({}), so: list => list, SI: () => null, TS: () => null }
}
const props = { ColMenu, useSort, accs: [{ id: 'ac', label: '유료' }], cats: [{ id: 'c1', label: '직원(유료)' }], isAdmin: true }

/* 명단 표 — 화면에 표가 하나뿐이다(회차 목록은 select 로 고른다) */
const table = () => document.querySelector('table')
const heads = () => [...table().querySelectorAll('thead th')]
/* 한 줄의 「칸 수」 — colSpan 을 더해 센다(띠 행은 한 칸으로 전체를 덮는다) */
const widthOf = tr => [...tr.children].reduce((n, c) => n + (Number(c.getAttribute('colspan')) || 1), 0)
const bodyRows = () => [...table().querySelectorAll('tbody tr')]

/* 상태 필터를 풀어 취소 줄까지 보이게 한다 */
function showAll() {
  fireEvent.click(screen.getByRole('button', { name: '신청 상태' }))
  fireEvent.click(screen.getByRole('button', { name: '전체' }))
}

beforeEach(cleanup)

describe('표 칸 수 — 머리글과 행이 어긋나지 않는다', () => {
  it('★ 머리글이 11칸이다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('AB2345')
    expect(heads().map(th => th.textContent.trim())).toEqual([
      '신청번호', '사번', '성명', '소속', '본인 접종', '가족 접종인원',
      '신청 수량(도즈)', '접종 희망일', '신청 상태', '접종 완료', '확인 사항',
    ])
  })

  it('★★ 보이는 모든 행의 칸 수가 머리글과 같다 (이 결함의 회귀 시험)', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('AB2345')
    showAll()
    await screen.findByText('GH2345')

    const n = heads().length
    const rows = bodyRows()
    expect(rows.length, '네 줄이 모두 보여야 한다').toBe(4)
    for (const tr of rows) {
      const code = tr.children[0].textContent.trim()
      expect(widthOf(tr), '행 ' + code + ' 의 칸 수가 머리글과 다르다').toBe(n)
    }
  })

  it('★ 「신청이 없습니다」 줄도 표 전체를 덮는다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('AB2345')
    /* 아무 값도 없는 소속으로 걸러 빈 표를 만든다 */
    fireEvent.click(screen.getByRole('button', { name: '소속' }))
    fireEvent.click(screen.getByRole('button', { name: '간호부' }))
    fireEvent.click(screen.getByRole('button', { name: '신청 상태' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    const empty = await screen.findByText('신청이 없습니다')
    expect(widthOf(empty.closest('tr'))).toBe(heads().length)
  })
})

describe('소속 칸의 내용', () => {
  it('★ 소속이 있으면 그 값이, 없으면 「—」 가 성명 **다음** 칸에 온다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('AB2345')
    showAll()
    await screen.findByText('GH2345')

    const iName = heads().findIndex(th => th.textContent.trim() === '성명')
    const iDept = heads().findIndex(th => th.textContent.trim() === '소속')
    expect(iDept, '소속은 성명 바로 다음이다').toBe(iName + 1)

    const got = Object.fromEntries(bodyRows().map(tr =>
      [tr.children[0].textContent.trim(), tr.children[iDept].textContent.trim()]))
    expect(got).toEqual({ AB2345: '약제과', CD6789: '—', EF2345: '간호부', GH2345: '원무과' })
  })

  it('★★ 「확인 사항」 내용이 「확인 사항」 칸에 들어간다 — 밀리면 여기서 걸린다', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('AB2345')
    showAll()
    await screen.findByText('GH2345')

    const iMemo = heads().findIndex(th => th.textContent.trim() === '확인 사항')
    const iDone = heads().findIndex(th => th.textContent.trim() === '접종 완료')
    const cell = (code, i) => bodyRows().find(tr => tr.children[0].textContent.trim() === code).children[i].textContent

    /* 확인 전 = 누를 수 있는 「확인 완료」 · 확인 후 = 되돌리는 「확인됨」 */
    expect(cell('AB2345', iMemo)).toContain('확인 완료')
    expect(cell('EF2345', iMemo)).toContain('확인됨')
    expect(cell('GH2345', iMemo)).toContain('취소됨')
    expect(cell('GH2345', iMemo)).toContain('입력 제한 중 접수')
    /* 밀렸을 때 이 글자들이 나타나던 자리 */
    expect(cell('AB2345', iDone), '「접종 완료」 칸에 확인 사항이 보이면 안 된다').not.toContain('확인 완료')
    expect(cell('GH2345', iDone)).not.toContain('취소됨')
  })

  it('★ 「확인 완료」는 **누르는 버튼**이다(상태 표시가 아니다)', async () => {
    render(<VaccineSurveyPanel {...props} />)
    await screen.findByText('AB2345')
    const b = screen.getByRole('button', { name: '확인 완료' })
    expect(b.tagName).toBe('BUTTON')
    expect(b.disabled).toBe(false)
    /* 이미 확인한 줄은 되돌리는 버튼이 된다 */
    expect(screen.getByRole('button', { name: '확인됨' }).tagName).toBe('BUTTON')
  })
})

describe('네 곳을 함께 바꿨는지 — 소스 대조', () => {
  const PANEL = readFileSync(resolve(process.cwd(), 'src/VaccineSurveyPanel.jsx'), 'utf8')
  const EXPORT = readFileSync(resolve(process.cwd(), 'src/lib/surveyExport.js'), 'utf8')

  it('★ 화면 행에 dept 칸이 있다', () => {
    const tbody = PANEL.slice(PANEL.indexOf('<tbody>'), PANEL.indexOf('</tbody>'))
    expect(tbody.includes('r.dept'), '행 렌더링에 소속 칸이 없다').toBe(true)
  })
  it('★ 엑셀·PDF 행에도 dept 가 있다', () => {
    expect(EXPORT).toContain("'소속'")
    expect(EXPORT).toContain('r.dept')
  })
  it('★ COLS 가 11개다', () => {
    const block = PANEL.slice(PANEL.indexOf('const COLS'), PANEL.indexOf('const COLS') + 2000)
    const keys = [...block.matchAll(/\{ k: '([a-z_]+)'/g)].map(m => m[1])
    expect(keys).toEqual(['receipt_code', 'emp_no', 'name', 'dept', 'self_dose',
      'family_count', 'dose', 'wish_date', 'status', 'done', 'memo'])
  })
})
