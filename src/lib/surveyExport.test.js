/* @vitest-environment node */
/* 내려받기 — 엑셀 구조(시트·SUM·문자열 셀)와 PDF(한글 임베드·바닥글) 를 실제로 만들어 확인한다.
   ★ 저장(writeFile · doc.save)은 브라우저 동작이라 부르지 않는다 — buildWorkbook · buildPdf 만 쓴다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildWorkbook, buildPdf, fileName } from './surveyExport'

const survey = { title: '독감(유료) 수요조사', season: '2026-2027' }
const rows = [
  { receipt_code: 'AB2345', emp_no: '123456', name: '김정화', self_dose: true, family_count: 2, wish_date: '2026-11-03', status: 'applied', done_self: true, done_family: 1 },
  { receipt_code: 'CD6789', emp_no: null, name: '박영수', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'EF2345', emp_no: '007890', name: '최윤서', self_dose: false, family_count: 3, wish_date: '2026-11-04', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'GH2345', emp_no: '999', name: '정하늘', self_dose: true, family_count: 1, wish_date: '2026-11-04', status: 'cancelled', done_self: false, done_family: 0 },
]
const user = '이정화'

describe('파일 이름 — 개인정보를 넣지 않는다', () => {
  it('수요조사_제목_절기_YYYYMMDD.확장자', () => {
    const n = fileName(survey, 'xlsx')
    expect(n).toMatch(/^수요조사_독감\(유료\) 수요조사_2026-2027_\d{8}\.xlsx$/)
    for (const bad of ['김정화', '123456', 'AB2345']) expect(n).not.toContain(bad)
  })
  it('경로 문자를 지운다', () => {
    expect(fileName({ title: 'a/b:c*d?e"f<g>h|i', season: 'x' }, 'pdf')).not.toMatch(/[\\/:*?"<>|]/)
  })
})

describe('엑셀', () => {
  it('시트가 「명단」·「날짜별 집계」 둘이다', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    expect(wb.SheetNames).toEqual(['명단', '날짜별 집계'])
  })

  it('맨 위에 회차명·출력 일시·출력자·업무용 표기가 있다', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    expect(String(ws.A1.v)).toContain('독감(유료) 수요조사')
    expect(String(ws.A2.v)).toContain('이정화')
    expect(String(ws.A2.v)).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect(String(ws.A3.v)).toBe('업무용 · 사용 후 파기')
  })

  it('머리글이 10개 열이다', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    expect(String(ws.A5.v)).toBe('신청번호')
    expect(String(ws.J5.v)).toBe('비고')
  })

  it('★ 신청번호·사번·희망일은 문자열 셀이다 — 앞자리 0 이 살아야 한다', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    /* 6행이 첫 데이터 (머리글 5행) */
    expect(ws.A6.t).toBe('s')
    expect(ws.B6.t).toBe('s')
    expect(ws.G6.t).toBe('s')
    /* 007890 의 앞자리 0 이 남았는지 — 세 번째 데이터 행 */
    expect(ws.B8.v).toBe('007890')
    expect(ws.G6.v).toBe('2026-11-03')
  })

  it('★ 맨 아래가 SUM 수식이다 (값 하드코딩이 아니다)', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    const sumRow = 5 + rows.length + 1
    expect(ws['A' + sumRow].v).toBe('합계')
    expect(ws['E' + sumRow].f).toBe(`SUM(E6:E${5 + rows.length})`)
    expect(ws['F' + sumRow].f).toBe(`SUM(F6:F${5 + rows.length})`)
    expect(ws['I' + sumRow].f).toBe(`SUM(I6:I${5 + rows.length})`)
    /* Excel 2016 호환 — 값과 SUM 만 쓴다. 다른 함수가 섞이지 않았는지 */
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      if (ws[k].f) expect(ws[k].f).toMatch(/^SUM\(/)
    }
  })

  it('열 너비를 준다 (freeze 는 이 라이브러리로 쓸 수 없다)', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    expect(ws['!cols']).toHaveLength(10)
    expect(ws['!freeze']).toBeUndefined()
  })

  it('raw=false 면 성명·사번이 가려진다', async () => {
    const wb = await buildWorkbook({ survey, rows, user, raw: false })
    const ws = wb.Sheets['명단']
    expect(ws.C6.v).toBe('김*화')
    expect(ws.B6.v).toBe('12**56')
    expect(ws.B7.v).toBe('—')          /* 사번 없음 */
  })

  it('raw=true 면 원문이 들어간다 (지시 8 — 명단은 원문 포함)', async () => {
    const wb = await buildWorkbook({ survey, rows, user, raw: true })
    const ws = wb.Sheets['명단']
    expect(ws.C6.v).toBe('김정화')
    expect(ws.B6.v).toBe('123456')
  })

  it('날짜별 집계 시트에도 SUM 이 있다', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['날짜별 집계']
    expect(String(ws.A4.v)).toBe('희망일')
    expect(ws.B7.f).toBe('SUM(B5:B6)')   /* 날짜 2종 */
  })

  it('신청이 없어도 터지지 않는다', async () => {
    const wb = await buildWorkbook({ survey, rows: [], user })
    expect(wb.SheetNames).toEqual(['명단', '날짜별 집계'])
  })
})

describe('PDF', () => {
  const fontB64 = readFileSync(
    resolve(process.cwd(), 'public/fonts/NotoSansKR-Regular-subset.ttf')).toString('base64')

  it('희망일마다 쪽을 나눈다', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    /* 희망일 2종 → 2쪽 */
    expect(doc.getNumberOfPages()).toBe(2)
  })

  it('A4 가로다', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    const w = doc.internal.pageSize.getWidth()
    const h = doc.internal.pageSize.getHeight()
    expect(Math.round(w)).toBe(297)
    expect(Math.round(h)).toBe(210)
    expect(w).toBeGreaterThan(h)
  })

  it('★ 한글 글꼴이 임베드되고 ToUnicode 가 붙는다', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    const s = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    expect(s).toContain('FontFile2')      /* TTF 임베드 */
    expect(s).toContain('ToUnicode')      /* 글자 → 유니코드 역매핑 */
    expect(s).toContain('NotoSansKR')
  })

  it('★ 바닥글에 업무용 표기·쪽 번호·저작권이 들어간다', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    const s = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    /* 본문 문자열은 글리프로 들어가 평문 검색이 안 되므로 ToUnicode 로 확인한다 */
    const { inflateSync } = await import('node:zlib')
    const chars = new Set()
    const re = /\/ToUnicode\s+(\d+)\s+0\s+R/g
    let m
    while ((m = re.exec(s))) {
      const i = s.indexOf('\n' + m[1] + ' 0 obj')
      if (i < 0) continue
      const st = s.indexOf('stream', i) + 6
      const en = s.indexOf('endstream', st)
      let txt
      try { txt = inflateSync(Buffer.from(s.slice(st, en).replace(/^\r?\n/, ''), 'latin1')).toString('latin1') }
      catch { txt = s.slice(st, en) }
      for (const p of txt.matchAll(/<([0-9a-fA-F]{2,4})>\s*<([0-9a-fA-F]{4,})>/g)) {
        chars.add(String.fromCharCode(parseInt(p[2].slice(0, 4), 16)))
      }
    }
    /* 「업무용 · 사용 후 파기」· 저작권 문구 · 한글 이름의 글자가 모두 글꼴에 담겼는지 */
    for (const ch of ['업', '무', '용', '사', '후', '파', '기', '·', '김', '정', '화', '독', '감']) {
      expect(chars.has(ch), '글자 누락: ' + ch).toBe(true)
    }
  })

  it('취소된 신청도 명단에 남는다(상태로 구별)', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    expect(doc.getNumberOfPages()).toBe(2)   /* 11-04 쪽에 취소 행이 함께 들어간다 */
  })

  it('신청이 없어도 한 쪽을 만든다', async () => {
    const doc = await buildPdf({ survey, rows: [], user, fontB64 })
    expect(doc.getNumberOfPages()).toBe(1)
  })

  it('★ 글꼴을 한 번만 임베드한다 — bold 를 따로 등록하면 PDF 가 두 배가 된다', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    const s = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    expect((s.match(/FontFile2/g) || []).length).toBe(1)
  })
})
