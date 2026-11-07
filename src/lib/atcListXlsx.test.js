/* ATC 배치 목록 엑셀 — 칸 너비 · 첫 줄 고정 · 머리글 굵게 (2026-11-07 이정화 님 지시).
 *
 * ★ 왜 라이브러리를 바꿨나
 *   xlsx@0.18.5 커뮤니티판은 **첫 줄 고정과 셀 스타일을 파일에 쓰지 않는다**(실측).
 *   오류도 나지 않아 「넣었는데 왜 안 되지」로 끝나는 자리라, 이 시험이 그 경계를 못 박는다.
 *
 * 못 박는 것
 *  ① 아홉 칸이 내용에 맞는 너비를 갖는다 (글자 칸 넓게 · 숫자 칸 좁게)
 *  ② 첫 줄이 고정된다
 *  ③ 머리글이 굵고 가운데다 — 열 정렬이 머리글을 덮지 않는다
 *  ④ 숫자 칸은 숫자로, 빈 값은 0 이 아니라 빈 칸이다
 */
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { writeAtcListXlsx, atcListFileName, ATC_COLS } from './atcListXlsx.js'

const ROWS = [
  { slot: 1, code: 'NXZ', name: '낙소졸정500/20mg', ingEn: 'Naproxen/Esomeprazole', ingKr: '나프록센/에스오메프라졸', lasa: '', light: '', r3: 120, r1: 40 },
  { slot: 19, code: 'B-C', name: '삐콤정', ingEn: 'Thiamine Hydrochloride', ingKr: '티아민염산염', lasa: '모양', light: '차광', r3: 0, r1: '' },
  { slot: 'FSP2', code: 'LSX', name: '라식스정40mg', ingEn: 'Furosemide', ingKr: '푸로세미드', lasa: '모양', light: '', r3: '', r1: '' },
]

const read = async blob => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await blob.arrayBuffer()))
  return wb.worksheets[0]
}

describe('★ 칸 너비', () => {
  it('아홉 칸 모두 너비가 있다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    for (let i = 1; i <= ATC_COLS.length; i++) expect(ws.getColumn(i).width).toBeGreaterThan(0)
  })

  it('★ 글자 칸이 숫자 칸보다 넓다 (약품명·성분명이 잘려 보이던 것이 신고 내용이다)', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    const w = k => ws.getColumn(ATC_COLS.findIndex(c => c.key === k) + 1).width
    expect(w('ingEn')).toBeGreaterThanOrEqual(40)
    expect(w('ingKr')).toBeGreaterThanOrEqual(30)
    expect(w('name')).toBeGreaterThanOrEqual(28)
    for (const k of ['ingEn', 'ingKr', 'name']) for (const n of ['r3', 'r1', 'light', 'slot'])
      expect(w(k)).toBeGreaterThan(w(n))
  })

  it('가장 긴 성분명이 들어갈 만한 너비다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    /* 운영 실측 — ATC 88종의 「영문 (한글)」 한 줄은 최대 60자 안팎이다.
       엑셀은 줄이지 않은 원본을 넣으므로 전부 보이게 할 수는 없지만,
       46(영문) + 34(한글) 두 칸이면 대부분이 한눈에 들어온다. */
    expect(ws.getColumn(4).width + ws.getColumn(5).width).toBeGreaterThanOrEqual(70)
  })
})

describe('★ 첫 줄 고정 · 머리글', () => {
  it('★ 첫 줄이 고정된다 (xlsx 판으로는 못 하던 것)', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    expect(ws.views[0].state).toBe('frozen')
    expect(ws.views[0].ySplit).toBe(1)
  })

  it('★ 머리글이 굵다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    for (let i = 1; i <= ATC_COLS.length; i++) expect(ws.getRow(1).getCell(i).font.bold).toBe(true)
  })

  it('★ 머리글이 **모두** 가운데다 — 열 정렬이 머리글을 덮지 않는다', async () => {
    /* 열 정렬(getColumn().alignment)은 머리글 줄까지 덮는다.
       머리글을 **나중에** 주지 않으면 숫자 칸 머리글만 오른쪽으로 쏠린다. */
    const ws = await read(await writeAtcListXlsx(ROWS))
    for (let i = 1; i <= ATC_COLS.length; i++)
      expect(ws.getRow(1).getCell(i).alignment.horizontal).toBe('center')
  })

  it('머리글 이름과 차례가 화면 표와 같다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    const got = []
    ws.getRow(1).eachCell(c => got.push(String(c.value)))
    expect(got).toEqual(['슬롯', '약품코드', '약품명', '성분명(영문)', '성분명(한글)', '유사', '차광', '최근3개월', '직전1개월'])
  })

  it('본문은 숫자 칸이 오른쪽, 슬롯·차광은 가운데다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    expect(ws.getRow(2).getCell(8).alignment.horizontal).toBe('right')
    expect(ws.getRow(2).getCell(1).alignment.horizontal).toBe('center')
  })
})

describe('★ 값', () => {
  it('줄 수와 값이 그대로다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    expect(ws.rowCount - 1).toBe(3)
    expect(ws.getRow(2).getCell(3).value).toBe('낙소졸정500/20mg')
    expect(ws.getRow(3).getCell(7).value).toBe('차광')
    expect(ws.getRow(4).getCell(1).value).toBe('FSP2')
  })

  it('★ 숫자는 숫자로 들어간다 (글자로 들어가면 엑셀에서 합계가 안 된다)', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    expect(typeof ws.getRow(2).getCell(8).value).toBe('number')
    expect(ws.getRow(2).getCell(8).value).toBe(120)
  })

  it('★ 빈 사용량은 0 이 아니라 **빈 칸**이다 (0 으로 둔갑하면 사용량을 잘못 읽는다)', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS))
    expect(ws.getRow(3).getCell(9).value).toBeNull()   /* 삐콤정 직전1개월 '' */
    expect(ws.getRow(4).getCell(8).value).toBeNull()   /* 라식스 최근3개월 '' */
    expect(ws.getRow(3).getCell(8).value).toBe(0)      /* 진짜 0 은 0 으로 남는다 */
  })

  it('꼬리말을 주면 한 줄 띄우고 붙는다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS, { note: '임시 사용량 기준 · a.xlsx' }))
    expect(ws.getRow(6).getCell(1).value).toBe('임시 사용량 기준 · a.xlsx')
  })

  it('시트 이름을 고를 수 있다', async () => {
    const ws = await read(await writeAtcListXlsx(ROWS, { sheetName: 'ATC배치(임시)' }))
    expect(ws.name).toBe('ATC배치(임시)')
  })
})

describe('★ 파일 이름 — 예전 규칙 그대로', () => {
  it('임시가 아니면 ATC배치_<모드>_<날짜>.xlsx', () => {
    expect(atcListFileName('슬롯', false)).toMatch(/^ATC배치_슬롯_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('임시면 「임시_」가 붙는다', () => {
    expect(atcListFileName('가나다', true)).toMatch(/^ATC배치_임시_가나다_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })
})
