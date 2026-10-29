/* 수요 현황 표 머리글 필터 — **진짜 ColMenu(App.jsx)** 와 함께 렌더해 재현한다.
   ★ 가짜 대역으로는 못 잡는 결함을 잡으려는 시험이다. 대역은 늘 「내가 생각한 대로」 동작한다.
   ★ 표준 사양 ① — 글자 클릭 = 필터, 삼각형 클릭 = 정렬.
   ★ supabase 는 통째로 가짜다. 운영 DB 에 닿지 않는다. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const SURVEYS = [{ id: 's1', tenant_id: 'tn', account_id: 'ac', title: '독감(유료) 수요조사', season: '2026-2027', status: 'open', open_at: '2026-10-28T00:00:00Z', vax_start: '2026-11-01', vax_end: '2027-04-30', purged_at: null, category_ids: ['c1'], safety_ratio: 0.1, safety_min: 5, order_unit: 10 }]
/* 값이 서로 다른 3줄 — 희망일 3종 · 사번 2종(하나는 없음) · 상태 2종 · 본인 2종 */
const ROWS = [
  { id: 'r1', receipt_code: 'AB2345', emp_no: '123456', name: '김정화', name_key: '김정화', self_dose: true, family_count: 1, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0, created_at: '2026-10-28T00:00:00Z' },
  { id: 'r2', receipt_code: 'CD6789', emp_no: null, name: '박영수', name_key: '박영수', self_dose: false, family_count: 2, wish_date: '2026-11-04', status: 'applied', done_self: false, done_family: 0, created_at: '2026-10-28T01:00:00Z' },
  { id: 'r3', receipt_code: 'EF2345', emp_no: '777777', name: '한가람', name_key: '한가람', self_dose: true, family_count: 0, wish_date: '2026-11-05', status: 'cancelled', done_self: false, done_family: 0, created_at: '2026-10-28T02:00:00Z' },
]
const DEMAND = { survey_id: 's1', demand_qty: 5, administered_qty: 0, remain_qty: 5, balance_qty: 10, safety_qty: 5, gap_qty: 0, order_qty: 0, demand_status: '충분', no_emp_cnt: 1, name_dup_cnt: 0, done_checked: 0, outside_qty: 0 }

vi.mock('./lib/supabase', () => {
  const result = d => Promise.resolve({ data: d, error: null })
  function from(table) {
    const q = {
      _tbl: table,
      select() { return q }, eq() { return q }, order() { return q },
      range() { return q }, limit() { return q },
      maybeSingle() { return result(q._tbl === 'v_vaccine_demand' ? DEMAND : null) },
      insert() { return result(null) }, update() { return q },
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

/* 진짜 ColMenu 와 진짜 useSort 를 App.jsx 에서 가져온다 */
import { ThemeCtx } from './lib/theme'
import { ColMenu } from './App'
import VaccineSurveyPanel from './VaccineSurveyPanel'

/* ★ ColMenu 는 **진짜**(App.jsx) 를 쓴다. 테마 토큰과 정렬 훅만 최소로 흉내 낸다 —
   App.jsx 에서 themes·useSort 까지 export 하면 react-refresh 규칙에 걸려 lint 가 늘어난다.
   ColMenu 가 실제로 읽는 토큰만 채운다(cardSolid·borderH·accent·text·bg·textL). */
const T = { bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', amber: '#E65100', purple: '#804A87',
  lavender: '#BFA6D9', lavL: '#F5EDF6', navText: '#F7F6F3', shadow: 'none' }
function useSort(ik, id) {
  const [sk, s1] = useState(ik); const [sd, s2] = useState(id)
  return { sk, sd, setSort(k, d) { s1(k); s2(d) }, so: a => a, hs: () => ({}), SI: () => null, TS: () => ({}) }
}

const props = { ColMenu, useSort, accs: [{ id: 'ac', label: '유료' }], cats: [{ id: 'c1', label: '직원(유료)' }], isAdmin: true }

/* 머리글 「글자」 — 삼각형(▲)이 아니라 라벨 span 을 누른다(표준 사양 ①) */
const headText = name => {
  const el = screen.getAllByTitle('필터').find(x => x.textContent === name)
  if (!el) throw new Error('머리글 「' + name + '」 의 필터 글자를 찾지 못했다 — ' +
    '필터가 걸린 머리글: ' + screen.getAllByTitle('필터').map(x => x.textContent).join(', '))
  return el
}
/* 열린 드롭다운 = 포털로 body 에 붙은 「전체」 버튼을 가진 상자 */
const menu = () => screen.queryByRole('button', { name: /^전체/ })

/* 진짜 테마를 끼운다 — ColMenu 가 t.cardSolid·t.borderH 를 쓴다 */
const renderPanel = () => render(
  <ThemeCtx.Provider value={{ t: T }}><VaccineSurveyPanel {...props} /></ThemeCtx.Provider>)

beforeEach(() => cleanup())

describe('머리글 글자를 누르면 필터 드롭다운이 열린다', () => {
  it('★ 상태 머리글 — 드롭다운이 열리고 「전체」+값 목록이 보인다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    expect(menu(), '누르기 전에는 닫혀 있어야 한다').toBeNull()

    fireEvent.click(headText('신청 상태'))
    expect(menu(), '★ 드롭다운이 열리지 않았다').toBeTruthy()
    expect(screen.getByRole('button', { name: /^신청/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^취소/ })).toBeTruthy()
  })

  it('★ 사번·희망일 머리글도 열린다 (값이 1~2개뿐인 열 포함)', async () => {
    renderPanel()
    await screen.findByText('김*화')
    for (const h of ['사번', '접종 희망일', '본인 접종']) {
      fireEvent.click(headText(h))
      expect(menu(), h + ' 머리글에서 드롭다운이 열리지 않았다').toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /^전체/ }))   /* 닫기 */
    }
  })

  it('★ 값을 고르면 줄 수가 바뀐다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    expect(screen.getByText('2건')).toBeTruthy()        /* 기본 신청만 → 2건 */

    fireEvent.click(headText('접종 희망일'))
    fireEvent.click(screen.getByRole('button', { name: '2026-11-04' }))
    expect(await screen.findByText('1건')).toBeTruthy()
    expect(screen.getByText('박*수')).toBeTruthy()
  })

  it('★ 필터 초기화 — 기본값과 다를 때만 보이고 누르면 돌아온다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    expect(screen.queryByRole('button', { name: /필터 초기화/ })).toBeNull()

    fireEvent.click(headText('신청 상태'))
    fireEvent.click(screen.getByRole('button', { name: /^전체/ }))
    expect(await screen.findByText('3건')).toBeTruthy()
    const reset = screen.getByRole('button', { name: /필터 초기화/ })
    fireEvent.click(reset)
    expect(await screen.findByText('2건')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /필터 초기화/ })).toBeNull()
  })
})
