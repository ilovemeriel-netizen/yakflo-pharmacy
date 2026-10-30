/* @vitest-environment node */
/* 내려받기 — 엑셀 구조(시트·SUM·문자열 셀)와 PDF(한글 임베드·바닥글) 를 실제로 만들어 확인한다.
   ★ 저장(writeFile · doc.save)은 브라우저 동작이라 부르지 않는다 — buildWorkbook · buildPdf 만 쓴다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildWorkbook, buildPdf, pdfLayout, fileName } from './surveyExport'

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

  it('머리글이 11개 열이다 — 성명 다음에 소속', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    expect(String(ws.A5.v)).toBe('신청번호')
    expect(String(ws.K5.v)).toBe('확인 사항')
  })

  it('★ 신청번호·사번·희망일은 문자열 셀이다 — 앞자리 0 이 살아야 한다', async () => {
    const wb = await buildWorkbook({ survey, rows, user })
    const ws = wb.Sheets['명단']
    /* 6행이 첫 데이터 (머리글 5행) */
    expect(ws.A6.t).toBe('s')
    expect(ws.B6.t).toBe('s')
    expect(ws.H6.t).toBe('s')
    /* 007890 의 앞자리 0 이 남았는지 — 세 번째 데이터 행 */
    expect(ws.B8.v).toBe('007890')
    expect(ws.H6.v).toBe('2026-11-03')
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
    expect(ws['!cols']).toHaveLength(11)
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

  it('★ 희망일이 달라도 쪽을 나누지 않는다 — 한 목록에 구분 행으로 잇는다', async () => {
    const doc = await buildPdf({ survey, rows, user, fontB64 })
    /* 희망일 2종 · 4명 → 종이가 차지 않으므로 1쪽 */
    expect(doc.getNumberOfPages()).toBe(1)
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
    const L = await pdfLayout({ survey, rows, user, fontB64 })
    /* 신청 4행 + 구분 2 + 소계 2 + 전체 합계 1 = 9 — 취소 행도 빠지지 않는다 */
    expect(L.bodyLen).toBe(9)
    expect(L.kinds.filter(k => k === null)).toHaveLength(4)
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

/* ═══════════════════════════════════════════════════════════════════════════
   한 목록 PDF — 구분 행·소계·합계 · 매 쪽 머리말·바닥글 · 쪽 번호 · 고아 방지
   ★ 쪽별 글자는 평문으로 들어가지 않는다(글리프 코드). ToUnicode 로 되읽어 확인한다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('PDF — 한 목록 · 쪽마다 머리말·바닥글', () => {
  const fontB64 = readFileSync(
    resolve(process.cwd(), 'public/fonts/NotoSansKR-Regular-subset.ttf')).toString('base64')

  /* 쪽별로 그려진 글자 조각을 돌려준다 — [['신청번호', …], …] */
  async function pageTexts(doc) {
    const { inflateSync } = await import('node:zlib')
    const s = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    const unz = i => {
      const st = s.indexOf('stream', i) + 6
      const body = s.slice(st, s.indexOf('endstream', st)).replace(/^\r?\n/, '')
      try { return inflateSync(Buffer.from(body, 'latin1')).toString('latin1') } catch { return body }
    }
    /* 글리프 코드 → 글자 */
    const g2c = new Map()
    for (const m of s.matchAll(/\/ToUnicode\s+(\d+)\s+0\s+R/g)) {
      const i = s.indexOf('\n' + m[1] + ' 0 obj')
      if (i < 0) continue
      for (const p of unz(i).matchAll(/<([0-9a-fA-F]{2,4})>\s*<([0-9a-fA-F]{4,})>/g))
        g2c.set(parseInt(p[1], 16), String.fromCharCode(parseInt(p[2].slice(0, 4), 16)))
    }
    const pages = [...s.matchAll(/\/Type\s*\/Page[^s][\s\S]{0,400}?\/Contents\s+(\d+)\s+0\s+R/g)]
    return pages.map(m => {
      const c = unz(s.indexOf('\n' + m[1] + ' 0 obj'))
      return [...c.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)].map(t => {
        let out = ''
        for (let k = 0; k + 4 <= t[1].length; k += 4) out += g2c.get(parseInt(t[1].slice(k, k + 4), 16)) ?? '?'
        return out
      })
    })
  }

  const manyRows = (n, date) => Array.from({ length: n }, (_, i) => ({
    receipt_code: 'AB' + String(2345 + i).padStart(4, '0'),
    emp_no: String(100000 + i), name: '사람' + i, name_key: '사람' + i,
    self_dose: true, family_count: 1, wish_date: date,
    status: 'applied', done_self: false, done_family: 0,
  }))

  it('★ 같은 희망일 40명 → 2쪽, 모든 쪽에 머리말·바닥글, 쪽 번호 1 / 2 · 2 / 2', async () => {
    const doc = await buildPdf({ survey, rows: manyRows(40, '2026-11-03'), fontB64 })
    expect(doc.getNumberOfPages()).toBe(2)
    const pt = await pageTexts(doc)
    expect(pt).toHaveLength(2)
    pt.forEach((parts, i) => {
      const has = t => parts.some(p => p.includes(t))
      expect(has('독감(유료) 수요조사'), (i + 1) + '쪽 머리말 제목').toBe(true)
      expect(has('출력자 약제과'), (i + 1) + '쪽 머리말 출력자').toBe(true)
      expect(has('업무용 · 사용 후 파기'), (i + 1) + '쪽 바닥글 업무용 표기').toBe(true)
      expect(has('무단 복제 및 재배포를 금지합니다'), (i + 1) + '쪽 바닥글 저작권').toBe(true)
      expect(has('Copyright'), (i + 1) + '쪽에 옛 「Copyright」 가 남았다').toBe(false)
      expect(parts, (i + 1) + '쪽 쪽번호').toContain(`${i + 1} / 2`)
    })
  })

  it('★ 표 머리가 매 쪽 반복된다', async () => {
    const doc = await buildPdf({ survey, rows: manyRows(40, '2026-11-03'), fontB64 })
    const pt = await pageTexts(doc)
    for (const parts of pt) {
      expect(parts).toContain('신청번호')
      expect(parts).toContain('확인 사항')
      expect(parts).toContain('확인')
    }
  })

  it('★ 희망일 3종 각 1명 → 1쪽 (날짜마다 쪽을 나누지 않는다)', async () => {
    const rows3 = ['2026-11-03', '2026-11-04', '2026-11-05'].map(d => manyRows(1, d)[0])
    const L = await pdfLayout({ survey, rows: rows3, fontB64 })
    expect(L.pages).toBe(1)
    /* 신청 3 + 구분 3 + 소계 3 + 전체 합계 1 */
    expect(L.bodyLen).toBe(10)
  })

  it('구분 행·소계 행·전체 합계 행이 글자로 들어간다', async () => {
    const rows2 = [...manyRows(2, '2026-11-03'), ...manyRows(1, '2026-11-04')]
    const doc = await buildPdf({ survey, rows: rows2, fontB64 })
    const parts = (await pageTexts(doc)).flat()
    expect(parts).toContain('희망일 2026-11-03')
    expect(parts).toContain('희망일 2026-11-04')
    expect(parts.some(p => /^소계 2명 · 4도즈 · 접종 완료 0$/.test(p))).toBe(true)
    expect(parts.some(p => /^전체 합계 3명 · 6도즈 · 접종 완료 0$/.test(p))).toBe(true)
  })

  it('★ 구분 행이 쪽 마지막 줄에 단독으로 오지 않는다 — 그룹 수 × 인원 훑기', async () => {
    for (const groups of [3, 8, 10, 14]) {
      for (const per of [1, 3, 4, 5]) {
        const rows = []
        for (let g = 0; g < groups; g++)
          for (const r of manyRows(per, '2026-11-' + String(3 + g).padStart(2, '0')))
            rows.push({ ...r, receipt_code: 'AB' + String(2000 + rows.length).padStart(4, '0') })
        const L = await pdfLayout({ survey, rows, fontB64 })
        expect(L.orphans, `그룹 ${groups} × ${per}명 — 고아 구분 행`).toEqual([])
      }
    }
  }, 60000)

  it('쪽을 강제로 끊어도 쪽 번호는 실제 전체 쪽수로 찍힌다', async () => {
    const rows = []
    for (let g = 0; g < 14; g++)
      for (const r of manyRows(3, '2026-11-' + String(3 + g).padStart(2, '0')))
        rows.push({ ...r, receipt_code: 'AB' + String(2000 + rows.length).padStart(4, '0') })
    const doc = await buildPdf({ survey, rows, fontB64 })
    const n = doc.getNumberOfPages()
    expect(n).toBeGreaterThan(1)
    const pt = await pageTexts(doc)
    pt.forEach((parts, i) => expect(parts).toContain(`${i + 1} / ${n}`))
  }, 30000)
})

describe('출력자 · 비고 · 확인 열 — 엑셀과 PDF 가 같아야 한다', () => {
  const fontB64 = readFileSync(
    resolve(process.cwd(), 'public/fonts/NotoSansKR-Regular-subset.ttf')).toString('base64')

  it('★ 출력자는 고정 「약제과」 — 로그인 이름을 묻지 않는다', async () => {
    const wb = await buildWorkbook({ survey, rows })
    expect(String(wb.Sheets['명단'].A2.v)).toContain('출력자 약제과')
    expect(String(wb.Sheets['날짜별 집계'].A2.v)).toContain('출력자 약제과')
    const doc = await buildPdf({ survey, rows, fontB64 })
    const s = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    expect(s).toContain('FontFile2')      /* 문서가 정상으로 만들어졌다 */
  })

  it('★ 비고가 행마다 자동으로 들어간다 — 사번 없음 · 이름 중복', async () => {
    const dupRows = [
      { receipt_code: 'AB2345', emp_no: '123456', name: '김정화', name_key: '김정화', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied' },
      { receipt_code: 'CD2345', emp_no: null, name: '김정화', name_key: '김정화', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied' },
      { receipt_code: 'EF2345', emp_no: null, name: '박영수', name_key: '박영수', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied' },
      { receipt_code: 'GH2345', emp_no: '999999', name: '최윤서', name_key: '최윤서', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied' },
    ]
    const ws = (await buildWorkbook({ survey, rows: dupRows })).Sheets['명단']
    expect(ws.K6.v).toBe('동일 성명 확인 필요')
    expect(ws.K7.v).toBe('사번 미입력 · 동일 성명 확인 필요')
    expect(ws.K8.v).toBe('사번 미입력')
    expect(ws.K9?.v ?? '').toBe('')
  })

  it('★ 중복 판정은 회차 전체로 한다 — 화면 필터로 1건만 보여도 「이름 중복」', async () => {
    const all = [
      { receipt_code: 'AB2345', emp_no: '1', name: '김정화', name_key: '김정화', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied' },
      { receipt_code: 'CD2345', emp_no: '2', name: '김정화', name_key: '김정화', self_dose: true, family_count: 0, wish_date: '2026-11-04', status: 'applied' },
    ]
    const ws = (await buildWorkbook({ survey, rows: [all[0]], allRows: all })).Sheets['명단']
    expect(ws.K6.v).toBe('동일 성명 확인 필요')
    /* allRows 를 주지 않으면 보이는 1건만 보므로 중복이 아니다 — 호출부가 꼭 넘겨야 한다 */
    const ws2 = (await buildWorkbook({ survey, rows: [all[0]] })).Sheets['명단']
    expect(ws2.K6.v).toBe('')
  })

  it('★ 확인 열은 PDF 에만 있다 — 엑셀은 11열 그대로', async () => {
    const ws = (await buildWorkbook({ survey, rows })).Sheets['명단']
    expect(String(ws.K5.v)).toBe('확인 사항')
    expect(ws.L5).toBeUndefined()
    expect(ws['!cols']).toHaveLength(11)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   확인 칸의 네모 — 글꼴 부분집합에 ☐(U+2610) 가 없어 글자가 아니라 선으로 그린다.
   그러니 「글자가 있는가」가 아니라 「네모를 데이터 행 수만큼만 그렸는가」를 본다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('PDF 확인 칸 — 네모를 선으로 그린다', () => {
  const fontB64 = readFileSync(
    resolve(process.cwd(), 'public/fonts/NotoSansKR-Regular-subset.ttf')).toString('base64')

  const mk = (n, date, from = 0) => Array.from({ length: n }, (_, i) => ({
    receipt_code: 'AB' + String(2345 + from + i).padStart(4, '0'),
    emp_no: String(100000 + from + i),
    name: '사람' + (from + i), name_key: '사람' + (from + i),
    self_dose: true, family_count: 1, wish_date: date,
    status: 'applied', done_self: false, done_family: 0,
  }))

  it('★ 글꼴에 ☐(U+2610)·□(U+25A1) 글리프가 없다 — 글자로 넣으면 깨진다', () => {
    const b = readFileSync(resolve(process.cwd(), 'public/fonts/NotoSansKR-Regular-subset.ttf'))
    /* cmap 의 유니코드 서브테이블(형식 4)을 읽어 코드포인트 → 글리프 를 모은다 */
    let cmapOff = 0
    const nT = b.readUInt16BE(4)
    for (let i = 0; i < nT; i++) {
      const o = 12 + i * 16
      if (b.toString('latin1', o, o + 4) === 'cmap') cmapOff = b.readUInt32BE(o + 8)
    }
    expect(cmapOff).toBeGreaterThan(0)
    const has = new Set()
    const nS = b.readUInt16BE(cmapOff + 2)
    for (let i = 0; i < nS; i++) {
      const off = cmapOff + b.readUInt32BE(cmapOff + 4 + i * 8 + 4)
      if (b.readUInt16BE(off) !== 4) continue
      const segX2 = b.readUInt16BE(off + 6)
      const endO = off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2
      for (let k = 0; k < segX2 / 2; k++) {
        const end = b.readUInt16BE(endO + k * 2), start = b.readUInt16BE(startO + k * 2)
        const delta = b.readInt16BE(deltaO + k * 2), ro = b.readUInt16BE(rangeO + k * 2)
        if (start === 0xFFFF) continue
        for (let c = start; c <= end; c++) {
          let g
          if (ro === 0) g = (c + delta) & 0xFFFF
          else {
            const gi = rangeO + k * 2 + ro + (c - start) * 2
            if (gi + 1 >= b.length) continue
            g = b.readUInt16BE(gi)
            if (g) g = (g + delta) & 0xFFFF
          }
          if (g) has.add(c)
        }
      }
    }
    expect(has.has(0x00A9), '대조군 © 는 있어야 한다').toBe(true)
    expect(has.has(0xC9C4), '대조군 한글 「진」 은 있어야 한다').toBe(true)
    expect(has.has(0x2610), '☐ U+2610').toBe(false)
    expect(has.has(0x25A1), '□ U+25A1').toBe(false)
  })

  it('★ 네모가 데이터 행 수만큼만 그려진다 — 구분·소계·합계 행은 0개', async () => {
    /* 희망일 3종 × 각 2명 → 데이터 6행, 띠 행 7개(구분 3 + 소계 3 + 합계 1) */
    const rows = [...mk(2, '2026-11-03', 0), ...mk(2, '2026-11-04', 2), ...mk(2, '2026-11-05', 4)]
    const L = await pdfLayout({ survey, rows, fontB64 })
    const dataIdx = L.kinds.map((k, i) => (k === null ? i : -1)).filter(i => i >= 0)
    expect(dataIdx).toHaveLength(6)
    expect(L.kinds.filter(k => k !== null)).toHaveLength(7)
    expect(L.boxes).toHaveLength(6)
    /* 네모가 붙은 본문 행이 전부 데이터 행이다 — 띠 행에는 하나도 없다 */
    expect(L.boxes.map(b => b.row).sort((a, b2) => a - b2)).toEqual(dataIdx)
    for (const b of L.boxes) expect(L.kinds[b.row]).toBe(null)
  })

  it('쪽이 넘쳐도 쪽마다 그 쪽의 데이터 행만큼 그린다', async () => {
    const L = await pdfLayout({ survey, rows: mk(40, '2026-11-10'), fontB64 })
    expect(L.pages).toBe(2)
    expect(L.boxes).toHaveLength(40)
    const per = {}
    for (const b of L.boxes) per[b.page] = (per[b.page] || 0) + 1
    expect(Object.keys(per).map(Number).sort()).toEqual([1, 2])
    /* 각 쪽의 네모 수 = 그 쪽에 떨어진 데이터 행 수 */
    for (const p of [1, 2]) {
      const onPage = L.kinds.filter((k, i) => k === null && L.pageOf[i] === p).length
      expect(per[p], p + '쪽').toBe(onPage)
    }
  })

  it('신청이 없으면 네모를 하나도 그리지 않는다', async () => {
    const L = await pdfLayout({ survey, rows: [], fontB64 })
    expect(L.boxes).toHaveLength(0)
  })

  it('★ 네모는 3.5mm 정사각형 · 선 굵기 0.2mm 로 선만 그린다(칠하지 않는다)', async () => {
    const { inflateSync } = await import('node:zlib')
    const doc = await buildPdf({ survey, rows: mk(3, '2026-11-03'), fontB64 })
    const s = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    const m = /\/Type\s*\/Page[^s][\s\S]{0,400}?\/Contents\s+(\d+)\s+0\s+R/.exec(s)
    const o = s.indexOf('\n' + m[1] + ' 0 obj')
    const st = s.indexOf('stream', o) + 6
    let c = s.slice(st, s.indexOf('endstream', st)).replace(/^\r?\n/, '')
    try { c = inflateSync(Buffer.from(c, 'latin1')).toString('latin1') } catch { /* 압축 안 됨 */ }
    /* 3.5mm = 9.9213pt · 0.2mm = 0.5669pt. re 뒤에 S(선) 가 와야 한다 — f(칠) 가 아니다. */
    const strokes = [...c.matchAll(/9\.921[\d]* -?9\.921[\d]* re\s*\nS/g)]
    expect(strokes).toHaveLength(3)
    expect((c.match(/0\.5669[\d]* w/g) || []).length).toBe(3)
    expect(c).not.toMatch(/9\.921[\d]* -?9\.921[\d]* re\s*\nf/)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   머리글 칸 수 = 행 값 수 — 2026-10-30 화면 결함의 짝 시험

   화면에서 「소속」 열을 머리글에만 더하고 행에는 칸을 넣지 않아 내용이 한 칸씩
   밀렸다(VaccineSurveyColumns.test.jsx 가 화면 쪽을 본다). 엑셀·PDF 는 그때
   멀쩡했지만, **열을 더할 때 네 곳(머리글·화면 행·엑셀·PDF)을 함께 바꾸라**는
   규칙을 지키게 여기서도 같은 성질을 고정한다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('★ 머리글 칸 수 = 행 값 수 (엑셀·PDF)', () => {
  const fontB64 = readFileSync(
    resolve(process.cwd(), 'public/fonts/NotoSansKR-Regular-subset.ttf')).toString('base64')
  /* 소속이 있는 줄·없는 줄·취소된 줄을 섞는다 */
  const mixed = [
    { ...rows[0], dept: '약제과' },
    { ...rows[1], dept: null },
    { ...rows[2], dept: '간호부' },
    { ...rows[3], dept: '원무과' },
  ]

  it('엑셀 — 머리글 11칸이고, 모든 자료 줄이 같은 칸 수다', async () => {
    const XLSX = await import('xlsx')
    const wb = await buildWorkbook({ survey, rows: mixed, user })
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['명단'], { header: 1, blankrows: true })
    const hi = aoa.findIndex(r => r[0] === '신청번호')
    expect(hi, '머리글 줄을 찾지 못했다').toBeGreaterThan(-1)
    const head = aoa[hi]
    expect(head).toHaveLength(11)
    expect(head[3], '성명 다음이 소속이다').toBe('소속')

    /* 머리글 아래 자료 줄 — 신청번호가 있는 줄만(맨 아래 SUM 띠는 뺀다) */
    const body = aoa.slice(hi + 1).filter(r => mixed.some(m => r[0] === m.receipt_code))
    expect(body).toHaveLength(mixed.length)
    for (const r of body) {
      expect(r, '행 ' + r[0] + ' 의 값 수가 머리글과 다르다').toHaveLength(head.length)
    }
    /* 소속 칸의 내용 — 없으면 「—」 */
    expect(body.map(r => r[3])).toEqual(['약제과', '—', '간호부', '원무과'])
  })

  it('PDF — 머리글 12칸(확인 포함)이고, 자료 줄이 모두 같은 칸 수다', async () => {
    const L = await pdfLayout({ survey, rows: mixed, fontB64 })
    expect(L.head).toHaveLength(12)
    expect(L.head[3]).toBe('소속')
    expect(L.head[11], '맨 오른쪽은 손 체크용 빈 칸이다').toBe('확인')

    const data = L.body.filter((_, i) => L.kinds[i] === null)
    expect(data).toHaveLength(mixed.length)
    for (const r of data) {
      expect(r, '행 ' + r[0] + ' 의 값 수가 머리글과 다르다').toHaveLength(L.head.length)
    }
    expect(data.map(r => r[3])).toEqual(['약제과', '—', '간호부', '원무과'])

    /* 띠 행(구분·소계·합계)은 한 칸으로 표 전체를 덮는다 */
    const bands = L.body.filter((_, i) => L.kinds[i] !== null)
    expect(bands.length).toBeGreaterThan(0)
    for (const b of bands) {
      expect(b).toHaveLength(1)
      expect(b[0].colSpan, '띠 행이 표 전체를 덮지 않는다').toBe(L.head.length)
    }
  })

  it('★ 엑셀과 PDF 가 같은 열 순서를 쓴다 — PDF 만 「확인」이 하나 더 붙는다', async () => {
    const XLSX = await import('xlsx')
    const wb = await buildWorkbook({ survey, rows: mixed, user })
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['명단'], { header: 1, blankrows: true })
    const xhead = aoa[aoa.findIndex(r => r[0] === '신청번호')]
    const L = await pdfLayout({ survey, rows: mixed, fontB64 })
    expect(L.head.slice(0, 11)).toEqual(xhead)
  })
})
