/* A단계 화면 — 마약·향정 건너뜀을 **렌더와 저장 호출로** 못 박는다.

   ★ 왜 렌더까지 보나 — lib 쪽 시험(usageNarcotic.test.js)은 「가르는 함수가 맞게 가르는가」만 본다.
     정작 사고는 **갈라 놓고 안 쓰는** 데서 난다(화면이 split.rows 가 아니라 parsed.changes 를 보내면
     건너뜀 묶음은 뜨는데 값은 그대로 덮인다 — 겉보기엔 정상으로 끝난다).
     그래서 **RPC 에 실제로 넘어간 p_rows·p_keep_codes** 를 본다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

const rpc = vi.fn(async () => ({ data: { saved: 1, zeroed: 0, unmatched: [] }, error: null }))
const upsert = vi.fn(async () => ({ error: null }))
vi.mock('./lib/supabase', () => ({ supabase: {
  rpc: (...a) => rpc(...a),
  from: () => ({
    select: () => Promise.resolve({ data: [], error: null }),
    upsert: (...a) => upsert(...a),
  }),
} }))

const T = {
  bg: '#F7F6F3', card: '#FFF', cardSolid: '#FFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', shadowH: 'none',
}
/* 운영 실제 약품 — 2026-11-04 실측 값 */
const DRUGS = [
  { drug_code: 'APR2', drug_name: '알프람정0.25mg', status: '사용', narcotic_type: '향정', recent_1m_usage: 91, recent_3m_usage: 243.5, prev_year_usage: 0, monthly_avg: 51 },
  { drug_code: 'MYPC', drug_name: '마이폴캡슐10mg', status: '사용', narcotic_type: '마약', recent_1m_usage: 0, recent_3m_usage: 0, prev_year_usage: 152, monthly_avg: 13 },
  { drug_code: 'CHNS', drug_name: '코포나시럽', status: '사용', narcotic_type: '한외마약', recent_1m_usage: 768, recent_3m_usage: 2255, prev_year_usage: 0, monthly_avg: 748 },
  { drug_code: 'GABA', drug_name: '가바로닌캡슐100mg', status: '사용', narcotic_type: '일반', recent_1m_usage: 300, recent_3m_usage: 900, prev_year_usage: 3600, monthly_avg: 300 },
]

let Modal
beforeEach(async () => {
  rpc.mockClear(); upsert.mockClear()
  if (!Modal) Modal = (await import('./UsageUploadModal.jsx')).default
})
afterEach(() => cleanup())

const open = (props = {}) => render(
  <Modal t={T} isTenantManager drugs={DRUGS} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} {...props} />)

async function pickFile(aoa) {
  vi.doMock('xlsx', () => ({
    read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
    utils: { sheet_to_json: () => aoa },
  }))
  const input = document.querySelector('input[type="file"][multiple]')
  const file = new File([new Uint8Array([1])], 'u.xlsx')
  file.arrayBuffer = async () => new ArrayBuffer(1)
  await fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText('③ 미리보기')
}
const chooseField = label => fireEvent.click(screen.getByText(label))
/* 「등록」 → 확인 창의 「등록」 까지 눌러 RPC 를 실제로 부른다.
   ★ 두 단추의 글자가 **둘 다 「등록」** 이다 — 기존 시험(UsageUploadModal.test.jsx)과 같은 방법으로
     확인 문구를 기준삼아 창 안쪽 단추를 집는다. */
async function doApply() {
  fireEvent.click(screen.getByText('등록'))
  const dlg = screen.getByText(/을 등록합니다/).closest('div').parentElement
  fireEvent.click(within(dlg).getByText('등록'))
  await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
  return rpc.mock.calls[0][1]
}

/* 파일에는 네 약품 모두 값이 있다 — 그중 마약·향정만 걸러져야 한다 */
const AOA_1M = [['약품코드', '약품명', '직전1개월사용량'],
  ['APR2', '알프람정0.25mg', '103.5'], ['MYPC', '마이폴캡슐10mg', '7'],
  ['CHNS', '코포나시럽', '768'], ['GABA', '가바로닌캡슐100mg', '310']]

describe('화면 — 건너뜀 묶음', () => {
  it('직전1개월에서 마약·향정 2종을 건너뛴다고 알린다', async () => {
    open(); await pickFile(AOA_1M)
    expect(screen.getByText('2종 건너뜀 (출고 기준)')).toBeTruthy()
    expect(screen.getByText(/NIMS 거래량으로 넣은 출고/)).toBeTruthy()
    expect(screen.getByText(/한외마약은 해당하지 않습니다/)).toBeTruthy()
  })
  it('건너뛴 줄에 「지금 값(유지)」과 「파일 값(안 씀)」이 나란히 선다', async () => {
    open(); await pickFile(AOA_1M)
    const row = screen.getByText('알프람정0.25mg').closest('tr')
    expect(within(row).getByText('91'), '지금 값 = 약플로 출고').toBeTruthy()
    expect(within(row).getByText('103.5'), '파일 값 = 원내').toBeTruthy()
  })
  it('★ 「변경」 수는 저장할 것만 센다 — 4종이 아니라 2종', async () => {
    open(); await pickFile(AOA_1M)
    expect(screen.getByText('변경 2종')).toBeTruthy()
    expect(screen.queryByText('변경 4종')).toBeNull()
  })
  it('전년사용량을 고르면 건너뜀 묶음이 사라진다 — 전년은 원내 값을 쓴다', async () => {
    open()
    chooseField('전년사용량')
    await pickFile([['약품코드', '약품명', '전년사용량'],
      ['APR2', '알프람정0.25mg', '200'], ['GABA', '가바로닌캡슐100mg', '3600']])
    expect(screen.queryByText(/건너뜀 \(출고 기준\)/)).toBeNull()
    expect(screen.getByText('변경 2종')).toBeTruthy()
  })
})

describe('저장 — RPC 에 실제로 무엇이 넘어가나', () => {
  it('★ p_rows 에 마약·향정이 없다 (한외마약·일반만 간다)', async () => {
    open(); await pickFile(AOA_1M)
    const args = await doApply()
    const codes = args.p_rows.map(r => r.code).sort()
    expect(codes).toEqual(['CHNS', 'GABA'])
    expect(codes).not.toContain('APR2')
    expect(codes).not.toContain('MYPC')
  })
  it('★ p_keep_codes 에 마약·향정이 늘 들어간다 (0 이 되지 않는다)', async () => {
    open(); await pickFile(AOA_1M)
    const args = await doApply()
    expect(args.p_keep_codes).toContain('APR2')
    expect(args.p_keep_codes).toContain('MYPC')
    expect(args.p_keep_codes, '한외마약은 지키지 않는다').not.toContain('CHNS')
  })
  it('★ 전년을 올릴 때도 마약·향정은 p_keep_codes 에 있다 — 값만 저장하고 0 은 막는다', async () => {
    open()
    chooseField('전년사용량')
    await pickFile([['약품코드', '약품명', '전년사용량'], ['GABA', '가바로닌캡슐100mg', '3600']])
    const args = await doApply()
    expect(args.p_rows.map(r => r.code)).toEqual(['GABA'])
    expect(args.p_keep_codes).toContain('APR2')
    expect(args.p_keep_codes).toContain('MYPC')
  })
  it('고른 칸 하나만 보낸다 (계산식·다른 칸은 건드리지 않는다)', async () => {
    open(); await pickFile(AOA_1M)
    const args = await doApply()
    expect(args.p_fields).toEqual(['recent_1m_usage'])
    expect(args.p_zero_missing).toBe(true)
    for (const r of args.p_rows) expect(Object.keys(r).sort()).toEqual(['code', 'r1'])
  })
  it('파일이 마약·향정뿐이면 보낼 줄이 없어 「등록」을 누를 수 없다', async () => {
    open()
    await pickFile([['약품코드', '약품명', '직전1개월사용량'],
      ['APR2', '알프람정0.25mg', '103.5'], ['MYPC', '마이폴캡슐10mg', '7']])
    expect(screen.getByText('2종 건너뜀 (출고 기준)')).toBeTruthy()
    expect(screen.getByText('등록').disabled, '보낼 줄이 0 이면 막힌다').toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})
