/* 신청 명단 수량 수정 — 화면이 **기록을 남기는 함수**로 보내는지, 거절을 어떻게 알리는지.
   ★ 수정·취소·되살리기는 전부 RPC 로 나가야 한다. 직접 UPDATE 로 나가면 0096 이
     status 열 권한을 회수했으므로 운영에서 42501 로 막힌다 — 그걸 여기서 먼저 잡는다.
   ★ supabase 는 통째로 가짜다. 운영 DB 에 닿지 않는다. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const SURVEYS = [{
  id: 's1', tenant_id: 'tn', account_id: 'ac', title: '독감(유료) 수요조사', season: '2026-2027',
  status: 'open', open_at: '2026-10-28T00:00:00Z', vax_start: '2026-11-01', vax_end: '2027-04-30',
  purged_at: null, category_ids: ['c1'], safety_ratio: 0.1, safety_min: 5, order_unit: 10,
}]
const ROWS = [{
  id: 'r1', receipt_code: 'AB2345', emp_no: '123456', name: '김정화', name_key: '김정화',
  self_dose: true, family_count: 3, wish_date: '2026-12-01', status: 'applied',
  done_self: false, done_family: 2, created_at: '2026-10-28T00:00:00Z',
}]
const DEMAND = { survey_id: 's1', demand_qty: 4, administered_qty: 0, remain_qty: 4, balance_qty: 10, safety_qty: 5, gap_qty: 0, order_qty: 0, demand_status: '충분', no_emp_cnt: 0, name_dup_cnt: 0, done_checked: 0, outside_qty: 0 }

/* 이 시험에서 나간 호출을 모아 둔다 */
const rpcs = []
const updates = []
let rpcError = null

vi.mock('./lib/supabase', () => {
  const result = (d, e = null) => Promise.resolve({ data: d, error: e })
  function from(table) {
    const q = {
      _tbl: table,
      select() { return q }, eq() { return q }, order() { return q },
      range() { return q }, limit() { return q },
      maybeSingle() { return result(q._tbl === 'v_vaccine_demand' ? DEMAND : null) },
      insert() { return result(null) },
      update(patch) { updates.push({ table: q._tbl, patch }); return q },
      then(res) {
        if (q._tbl === 'vaccine_surveys') return result(SURVEYS).then(res)
        if (q._tbl === 'vaccine_survey_responses') return result(ROWS).then(res)
        return result([]).then(res)
      },
    }
    return q
  }
  return {
    supabase: {
      from,
      rpc: (name, args) => { rpcs.push({ name, args }); return result(null, rpcError) },
      auth: { getUser: () => result(null) },
    },
  }
})

import { ColMenu } from './App'
import VaccineSurveyPanel from './VaccineSurveyPanel'

const T = { bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  green: '#019748', greenL: '#E6F7EE', red: '#C62828', amber: '#E65100', purple: '#804A87',
  lavender: '#BFA6D9', lavL: '#F5EDF6', navText: '#F7F6F3', shadow: 'none' }
function useSort(ik, id) {
  const [sk, s1] = useState(ik); const [sd, s2] = useState(id)
  return { sk, sd, setSort(k, d) { s1(k); s2(d) }, so: a => a, hs: () => ({}), SI: () => null, TS: () => ({}) }
}
import { ThemeCtx } from './lib/theme'
const props = { ColMenu, useSort, accs: [{ id: 'ac', label: '유료' }], cats: [{ id: 'c1', label: '직원(유료)' }], isAdmin: true }
const renderPanel = () => render(
  <ThemeCtx.Provider value={{ t: T }}><VaccineSurveyPanel {...props} /></ThemeCtx.Provider>)

const famBox = () => screen.getByDisplayValue('3')
const wishBox = () => screen.getByDisplayValue('2026-12-01')
const selfBox = () => screen.getByTitle('본인 접종 여부')
const statusBox = () => screen.getAllByRole('combobox').find(s => s.value === 'applied' || s.value === 'cancelled')

beforeEach(() => { rpcs.length = 0; updates.length = 0; rpcError = null; cleanup() })

describe('수량·희망일 수정 — 기록을 남기는 함수로 보낸다', () => {
  it('★ 가족 수를 고치면 edit_vaccine_survey_response 로 나간다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.blur(famBox(), { target: { value: '5' } })
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(rpcs[0].name).toBe('edit_vaccine_survey_response')
    expect(rpcs[0].args).toEqual({ p_id: 'r1', p_self_dose: null, p_family_count: 5, p_wish_date: null })
    /* 응답 테이블로 직접 UPDATE 가 나가면 안 된다 */
    expect(updates.filter(u => u.table === 'vaccine_survey_responses')).toHaveLength(0)
  })

  it('★ 본인 체크를 바꾸면 같은 함수로 나간다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.click(selfBox())
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(rpcs[0].name).toBe('edit_vaccine_survey_response')
    expect(rpcs[0].args.p_self_dose).toBe(false)
    expect(rpcs[0].args.p_family_count).toBeNull()
  })

  it('★ 희망일을 고치면 같은 함수로 나간다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.blur(wishBox(), { target: { value: '2026-12-25' } })
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(rpcs[0].args.p_wish_date).toBe('2026-12-25')
  })

  it('값이 그대로면 아무것도 보내지 않는다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.blur(famBox(), { target: { value: '3' } })
    fireEvent.blur(wishBox(), { target: { value: '2026-12-01' } })
    expect(rpcs).toHaveLength(0)
  })
})

describe('상태 변경 — 취소·되살리기도 함수로', () => {
  it('★ 취소하면 set_vaccine_survey_status 로 나간다 (직접 UPDATE 0건)', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.change(statusBox(), { target: { value: 'cancelled' } })
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(rpcs[0].name).toBe('set_vaccine_survey_status')
    expect(rpcs[0].args).toEqual({ p_id: 'r1', p_status: 'cancelled' })
    expect(updates.filter(u => u.table === 'vaccine_survey_responses')).toHaveLength(0)
  })
})

describe('거절 — 값을 되돌리고 무엇을 먼저 고칠지 알린다', () => {
  it('★ 가족 수를 접종 완료(2)보다 적게 바꾸면 보내지 않고 안내한다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    const box = famBox()
    fireEvent.blur(box, { target: { value: '1' } })
    expect(await screen.findByText(/접종 완료 2명보다 적게 바꿀 수 없습니다/)).toBeTruthy()
    expect(screen.getByText(/접종 완료를 먼저 고쳐/)).toBeTruthy()
    /* 서버로 나가지 않았다 — 화면에서 먼저 걸렀다 */
    expect(rpcs).toHaveLength(0)
    /* 값이 원래대로 돌아왔다 */
    await waitFor(() => expect(box.value).toBe('3'))
  })

  it('★ 접종 완료와 같은 수까지는 된다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.blur(famBox(), { target: { value: '2' } })
    await waitFor(() => expect(rpcs).toHaveLength(1))
  })

  it('가족 수가 20을 넘으면 보내지 않고 안내한다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.blur(famBox(), { target: { value: '21' } })
    expect(await screen.findByText(/0~20/)).toBeTruthy()
    expect(rpcs).toHaveLength(0)
  })

  it('희망일이 접종 기간 밖이면 보내지 않고 기간을 알려 준다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    fireEvent.blur(wishBox(), { target: { value: '2027-05-01' } })
    expect(await screen.findByText(/2026-11-01 ~ 2027-04-30/)).toBeTruthy()
    expect(rpcs).toHaveLength(0)
  })

  it('★ 서버가 거절해도(2F000) 같은 안내로 바꿔 준다 — 화면 검사를 지나친 경우', async () => {
    rpcError = { code: '2F000', message: 'restrict_violation' }
    renderPanel()
    await screen.findByText('김*화')
    const box = famBox()
    fireEvent.blur(box, { target: { value: '5' } })
    await waitFor(() => expect(rpcs).toHaveLength(1))
    expect(await screen.findByText(/접종 완료 2명보다 적게 바꿀 수 없습니다/)).toBeTruthy()
    await waitFor(() => expect(box.value).toBe('3'))
  })
})

describe('접종 완료 칸은 그대로 직접 저장한다', () => {
  it('done_self 는 기록 대상이 아니라 UPDATE 로 나간다', async () => {
    renderPanel()
    await screen.findByText('김*화')
    const chk = screen.getAllByRole('checkbox').find(c => c !== selfBox())
    fireEvent.click(chk)
    await waitFor(() => expect(updates.filter(u => u.table === 'vaccine_survey_responses')).toHaveLength(1))
    expect(updates[0].patch).toHaveProperty('done_self')
    expect(rpcs).toHaveLength(0)
  })
})
