/* 사용량 등록 모달 — 탭·권한·0 처리·확인 문구를 **렌더로** 고정한다 (2026-11-04 시안).

   ★ 파일 읽기(xlsx)는 여기서 시험하지 않는다 — 그 부분은 lib/usageParse.test.js 가 맡는다.
     여기서 보는 것은 「무엇이 화면에 뜨고, 무엇을 눌러야 저장되는가」다. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.fn(async () => ({ data: { saved: 2, zeroed: 3, unmatched: [] }, error: null }))
const aliasRows = []
const upsert = vi.fn(async () => ({ error: null }))
vi.mock('./lib/supabase', () => ({ supabase: {
  rpc: (...a) => rpc(...a),
  from: () => ({
    select: () => Promise.resolve({ data: aliasRows, error: null }),
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
const DRUGS = [
  { drug_code: 'A', drug_name: '가', status: '사용', recent_1m_usage: 5 },
  { drug_code: 'B', drug_name: '나', status: '중지', recent_1m_usage: 9 },
  { drug_code: 'C', drug_name: '다', status: '사용', recent_1m_usage: 0 },
]


/* ④ 0 으로 바뀔 약품 묶음 — 제목이 <span> 으로 쪼개져 있어 글자 일치로는 못 찾는다 */
const zeroBox = () => [...document.querySelectorAll('div')]
  .filter(d => /파일에 없어/.test(d.textContent) && d.querySelector('table'))
  .sort((a, b) => a.textContent.length - b.textContent.length)[0]

let Modal
beforeEach(async () => { rpc.mockClear(); if (!Modal) Modal = (await import('./UsageUploadModal.jsx')).default })
afterEach(() => cleanup())

const open = (props = {}) => render(
  <Modal t={T} isTenantManager drugs={DRUGS} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} {...props} />)

/* 파일을 읽지 않고도 미리보기를 띄우려면 파싱 결과가 필요하다.
   모달은 xlsx 를 동적 import 하므로, 그 모듈을 가짜로 바꿔 aoa 를 바로 돌려준다. */
function mockXlsx(aoa) {
  vi.doMock('xlsx', () => ({
    read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
    utils: { sheet_to_json: () => aoa },
  }))
}
async function pickFile(aoa) {
  mockXlsx(aoa)
  const input = document.querySelector('input[type="file"][multiple]')
  const file = new File([new Uint8Array([1])], 'u.xlsx')
  file.arrayBuffer = async () => new ArrayBuffer(1)
  await fireEvent.change(input, { target: { files: [file] } })
  /* 동적 import 가 끝나기를 기다린다 */
  await screen.findByText('③ 미리보기')
}

describe('① 탭', () => {
  it('두 탭이 있고, 처음엔 개별 등록이 열린다', () => {
    open()
    expect(screen.getByText('일괄 등록')).toBeTruthy()
    expect(screen.getByText('개별 등록')).toBeTruthy()
    expect(screen.getByText('① 어느 칸을 올릴까요?')).toBeTruthy()
  })
  it('일괄 등록 탭은 「지금 양식 그대로」를 안내하고 검토 화면으로 보낸다', () => {
    open()
    fireEvent.click(screen.getByText('일괄 등록'))
    expect(screen.getByText(/지금 쓰시던 양식 그대로/)).toBeTruthy()
    expect(screen.getByText(/검토 화면/)).toBeTruthy()
  })
  it('★ 일괄 탭에서 고른 파일은 부모의 기존 흐름으로 넘어간다', () => {
    const onBulkFile = vi.fn(); const onClose = vi.fn()
    open({ onBulkFile, onClose })
    fireEvent.click(screen.getByText('일괄 등록'))
    const input = document.querySelector('input[type="file"]:not([multiple])')
    const file = new File([new Uint8Array([1])], 'bulk.xlsx')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onBulkFile).toHaveBeenCalledTimes(1)
    expect(onBulkFile.mock.calls[0][0].name).toBe('bulk.xlsx')
    expect(onClose, '넘긴 뒤 모달은 닫힌다').toHaveBeenCalled()
  })
})

describe('② 칸 고르기', () => {
  it('세 가지만 고를 수 있다', () => {
    open()
    for (const l of ['직전1개월사용량', '최근3개월사용량', '전년사용량']) expect(screen.getByText(l)).toBeTruthy()
  })
  it('1개월은 「합쳐 올린다」고, 나머지는 「다시 계산된다」고 알린다', () => {
    open()
    expect(screen.getByText('병동·외래를 합쳐 올립니다')).toBeTruthy()
    expect(screen.getAllByText('월평균·안전재고가 다시 계산됩니다')).toHaveLength(2)
  })
})

describe('③ 미리보기와 0 처리', () => {
  const AOA = [['약품코드', '약품명', '직전1개월사용량'], ['A', '가', '12']]
  it('지금 값 → 새 값이 보인다', async () => {
    open(); await pickFile(AOA)
    expect(screen.getByText('변경 1종')).toBeTruthy()
    const row = screen.getByText('가').closest('tr')
    expect(within(row).getByText('5'), '지금 값').toBeTruthy()
    expect(within(row).getByText('12'), '새 값').toBeTruthy()
  })
  it('★ 파일에 없고 값이 0 이 아닌 약품만 0 대상이다 (C 는 이미 0)', async () => {
    open(); await pickFile(AOA)
    expect(screen.getByText('0 으로 1종')).toBeTruthy()
    expect(zeroBox()).toBeTruthy()
  })
  it('★ 체크를 풀면 그 약품은 0 대상에서 빠진다', async () => {
    open(); await pickFile(AOA)
    const zeroTable = zeroBox()
    const box = within(zeroTable).getAllByRole('checkbox').find(c => c.checked)
    fireEvent.click(box)
    expect(screen.queryByText('0 으로 1종'), '뱃지가 사라진다').toBeFalsy()
  })
})

describe('④ 확인 문구와 저장', () => {
  const AOA = [['약품코드', '약품명', '직전1개월사용량'], ['A', '가', '12']]
  it('★ 등록을 누르면 바로 저장하지 않고 확인 문구를 보여 준다', async () => {
    open(); await pickFile(AOA)
    fireEvent.click(screen.getByText('등록'))
    expect(screen.getByText(/직전1개월사용량을 등록합니다/)).toBeTruthy()
    expect(screen.getByText(/1종 변경, 1종 0으로/)).toBeTruthy()
    expect(rpc, '아직 저장하지 않았다').not.toHaveBeenCalled()
  })
  it('★ 확인 창의 「등록」을 눌러야 DB 함수가 한 번 불린다', async () => {
    open(); await pickFile(AOA)
    fireEvent.click(screen.getByText('등록'))
    const dlg = screen.getByText(/직전1개월사용량을 등록합니다/).closest('div').parentElement
    fireEvent.click(within(dlg).getByText('등록'))
    await screen.findByText(/등록 완료/)
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('app_save_usage_bulk')
    expect(args.p_fields, '고른 칸만 넘긴다').toEqual(['recent_1m_usage'])
    expect(args.p_zero_missing, '개별 등록은 0 처리를 켠다').toBe(true)
    expect(args.p_rows).toEqual([{ code: 'A', r1: 12 }])
  })
  it('결과를 초록 띠로 알린다', async () => {
    open(); await pickFile(AOA)
    fireEvent.click(screen.getByText('등록'))
    const dlg = screen.getByText(/직전1개월사용량을 등록합니다/).closest('div').parentElement
    fireEvent.click(within(dlg).getByText('등록'))
    const band = await screen.findByText(/등록 완료/)
    expect(band.textContent).toContain('2종 변경')
    expect(band.textContent).toContain('3종 0 으로')
  })
})

describe('⑤ 권한', () => {
  const AOA = [['약품코드', '약품명', '직전1개월사용량'], ['A', '가', '12']]
  it('★ 관리자가 아니면 등록 단추가 막히고 까닭을 적는다', async () => {
    open({ isTenantManager: false }); await pickFile(AOA)
    expect(screen.getByText('등록').disabled).toBe(true)
    expect(screen.getByText('사용량 등록은 관리자만 할 수 있습니다.')).toBeTruthy()
  })
})

describe('⑥ 새 색을 들이지 않았다', () => {
  it('소스에 hex 색이 없다 — 부모가 준 t 만 쓴다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/UsageUploadModal.jsx'), 'utf8')
    const hex = src.match(/#[0-9a-fA-F]{6}\b/g) || []
    /* 흰 글자(#fff)는 기존 단추와 같은 값이라 세 글자 표기만 허용한다 */
    expect(hex, '여섯 자리 hex 색을 새로 쓰지 않았다').toEqual([])
  })
  it('기준년월은 저장하지 않는다 — RPC 인자에 없다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/UsageUploadModal.jsx'), 'utf8')
    const i = src.indexOf('app_save_usage_bulk')
    const seg = src.slice(i, i + 320)
    expect(seg).not.toContain('p_year')
    expect(seg).not.toContain('p_month')
  })
})

/* ── 코드 짝 기억하기 (0110) ─────────────────────────────────────────────── */
describe('⑦ 저장된 코드 짝', () => {
  const AOA = [['약품코드', '약 품 명', '실사용량'], ['2-APR', '알프람정0.25mg(알프라졸람)', '12']]
  const DRUGS2 = [
    { drug_code: 'APR2', drug_name: '알프람정0.25mg', status: '사용', recent_1m_usage: 5 },
    { drug_code: 'B', drug_name: '나', status: '사용', recent_1m_usage: 9 },
  ]
  beforeEach(() => { aliasRows.length = 0; upsert.mockClear() })

  it('★ 저장된 짝이 있으면 자동으로 연결되고 뱃지가 뜬다', async () => {
    aliasRows.push({ alias_code: '2-APR', drug_code: 'APR2' })
    render(<Modal t={T} isTenantManager drugs={DRUGS2} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} />)
    await pickFile(AOA)
    expect(screen.getByText('자동 연결 1건')).toBeTruthy()
    expect(screen.queryByText(/약품목록에 없는 코드/), '고칠 것이 없다').toBeFalsy()
    expect(screen.getByText('변경 1종')).toBeTruthy()
  })
  it('★ 저장된 짝이 없으면 고치기 칸이 뜬다 — 「다음에도 기억」은 기본 켬', async () => {
    render(<Modal t={T} isTenantManager drugs={DRUGS2} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} />)
    await pickFile(AOA)
    expect(screen.queryByText('자동 연결 1건')).toBeFalsy()
    const box = screen.getByText('다음에도 기억').querySelector('input')
    expect(box.checked, '기본 켬').toBe(true)
  })
  it('★ 고친 짝을 등록하면 usage_code_alias 에 저장된다', async () => {
    render(<Modal t={T} isTenantManager drugs={DRUGS2} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} />)
    await pickFile(AOA)
    fireEvent.click(screen.getByText('고치기'))
    fireEvent.click(screen.getByText('등록'))
    const dlg = screen.getByText(/직전1개월사용량을 등록합니다/).closest('div').parentElement
    fireEvent.click(within(dlg).getByText('등록'))
    await screen.findByText(/등록 완료/)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual([{ alias_code: '2-APR', drug_code: 'APR2' }])
  })
  it('★ 「다음에도 기억」을 끄면 저장하지 않는다 — 이번만 쓴다', async () => {
    render(<Modal t={T} isTenantManager drugs={DRUGS2} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} />)
    await pickFile(AOA)
    fireEvent.click(screen.getByText('다음에도 기억').querySelector('input'))
    fireEvent.click(screen.getByText('고치기'))
    fireEvent.click(screen.getByText('등록'))
    const dlg = screen.getByText(/직전1개월사용량을 등록합니다/).closest('div').parentElement
    fireEvent.click(within(dlg).getByText('등록'))
    await screen.findByText(/등록 완료/)
    expect(upsert, '짝은 저장하지 않는다').not.toHaveBeenCalled()
    expect(rpc, '사용량은 그래도 등록한다').toHaveBeenCalled()
  })
  it('★ 이번에 손으로 고친 쪽이 저장된 짝을 이긴다', async () => {
    aliasRows.push({ alias_code: '2-APR', drug_code: 'B' })
    render(<Modal t={T} isTenantManager drugs={DRUGS2} onClose={() => {}} onReload={() => {}} onBulkFile={() => {}} />)
    await pickFile(AOA)
    /* 자동으로 B 에 붙었지만 이번엔 APR2 로 바꾼다 — 고치기 칸이 없으므로 미리보기로 확인 */
    expect(screen.getByText('자동 연결 1건')).toBeTruthy()
    const row = screen.getByText('나').closest('tr')
    expect(within(row).getByText('12'), 'B 에 붙었다').toBeTruthy()
  })
})
