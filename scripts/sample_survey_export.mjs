// 견본 내려받기 파일 생성 — 눈으로 열어 확인하기 위한 일회용 스크립트.
// ★ 운영 DB 를 읽지 않는다. 아래 가짜 데이터만 쓴다.
// ★ 화면이 쓰는 것과 **같은 모듈**(src/lib/surveyExport.js)을 부른다 — 레이아웃이 갈라지지 않는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildPdf, buildWorkbook, fileName } from '../src/lib/surveyExport.js'
import * as XLSX from 'xlsx'

const out = process.argv[2] || '.'
const survey = { title: '독감(유료) 수요조사', season: '2026-2027' }
const user = '이정화'
const rows = [
  { receipt_code: 'AB2345', emp_no: '123456', name: '김정화', self_dose: true, family_count: 2, wish_date: '2026-11-03', status: 'applied', done_self: true, done_family: 1 },
  { receipt_code: 'CD6789', emp_no: null, name: '박영수', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'EF2345', emp_no: '007890', name: '최윤서하늘', self_dose: false, family_count: 3, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'GH2345', emp_no: '999', name: '정하늘', self_dose: true, family_count: 1, wish_date: '2026-11-04', status: 'cancelled', done_self: false, done_family: 0 },
  { receipt_code: 'JK2345', emp_no: '246810', name: '윤서진', self_dose: true, family_count: 4, wish_date: '2026-11-04', status: 'applied', done_self: false, done_family: 0 },
]

const fontB64 = readFileSync('public/fonts/NotoSansKR-Regular-subset.ttf').toString('base64')
const doc = await buildPdf({ survey, rows, user, fontB64 })
const pdfName = out + '/' + fileName(survey, 'pdf')
writeFileSync(pdfName, Buffer.from(doc.output('arraybuffer')))
console.log('PDF  ' + pdfName + '  (' + doc.getNumberOfPages() + '쪽)')

const wb = await buildWorkbook({ survey, rows, user })
const xlsName = out + '/' + fileName(survey, 'xlsx')
XLSX.writeFile(wb, xlsName)
console.log('엑셀 ' + xlsName + '  (시트: ' + wb.SheetNames.join(', ') + ')')
