// 견본 내려받기 파일 생성 — 눈으로 열어 확인하기 위한 일회용 스크립트.
// ★ 운영 DB 를 읽지 않는다. 아래 가짜 데이터만 쓴다.
// ★ 화면이 쓰는 것과 **같은 모듈**(src/lib/surveyExport.js)을 부른다 — 레이아웃이 갈라지지 않는다.
// ★ 출력자는 모듈이 「약제과」로 고정한다 — 여기서 이름을 넘기지 않는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildPdf, buildWorkbook, fileName } from '../src/lib/surveyExport.js'
import * as XLSX from 'xlsx'

const out = process.argv[2] || '.'
const survey = { title: '독감(유료) 수요조사', season: '2026-2027' }

// 1쪽짜리 — 확인 칸의 네모를 가까이서 보기 위한 2명.
// 한 명은 사번이 없고 둘은 이름이 같아 비고 3가지가 모두 보인다.
const two = [
  { receipt_code: 'AB2345', emp_no: '123456', name: '김정화', name_key: '김정화', self_dose: true, family_count: 2, wish_date: '2026-11-03', status: 'applied', done_self: true, done_family: 1 },
  { receipt_code: 'CD6789', emp_no: null, name: '김정화', name_key: '김정화', self_dose: true, family_count: 0, wish_date: '2026-11-04', status: 'applied', done_self: false, done_family: 0 },
]

// 엑셀 견본용 — 희망일 3종에 걸쳐 있어도 한 목록으로 이어진다.
const few = [
  { receipt_code: 'AB2345', emp_no: '123456', name: '김정화', name_key: '김정화', self_dose: true, family_count: 2, wish_date: '2026-11-03', status: 'applied', done_self: true, done_family: 1 },
  { receipt_code: 'CD6789', emp_no: null, name: '김정화', name_key: '김정화', self_dose: true, family_count: 0, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'EF2345', emp_no: '007890', name: '최윤서하늘', name_key: '최윤서하늘', self_dose: false, family_count: 3, wish_date: '2026-11-03', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'GH2345', emp_no: '999', name: '정하늘', name_key: '정하늘', self_dose: true, family_count: 1, wish_date: '2026-11-04', status: 'cancelled', done_self: false, done_family: 0 },
  { receipt_code: 'JK2345', emp_no: '246810', name: '윤서진', name_key: '윤서진', self_dose: true, family_count: 4, wish_date: '2026-11-04', status: 'applied', done_self: false, done_family: 0 },
  { receipt_code: 'LM2345', emp_no: null, name: '한가람', name_key: '한가람', self_dose: true, family_count: 0, wish_date: '2026-11-05', status: 'applied', done_self: false, done_family: 0 },
]

// 2쪽짜리 — 같은 희망일 40명. 쪽이 넘치면 표 머리·머리말·바닥글이 다음 쪽에도 나와야 한다.
const many = Array.from({ length: 40 }, (_, i) => ({
  receipt_code: 'MN' + String(2345 + i).padStart(4, '0'),
  emp_no: i % 7 === 0 ? null : String(100000 + i),
  name: '직원' + String(i + 1).padStart(2, '0'),
  name_key: i % 11 === 0 ? '직원01' : '직원' + String(i + 1).padStart(2, '0'),
  self_dose: true, family_count: i % 4,
  wish_date: '2026-11-10', status: 'applied',
  done_self: i % 5 === 0, done_family: 0,
}))

const fontB64 = readFileSync('public/fonts/NotoSansKR-Regular-subset.ttf').toString('base64')

const d1 = await buildPdf({ survey, rows: two, allRows: two, fontB64 })
const p1 = out + '/' + fileName(survey, 'pdf').replace('.pdf', '_2명_1쪽.pdf')
writeFileSync(p1, Buffer.from(d1.output('arraybuffer')))
console.log('PDF  ' + p1 + '  (' + d1.getNumberOfPages() + '쪽, 신청 ' + two.length + '건)')

const d2 = await buildPdf({ survey, rows: many, fontB64 })
const p2 = out + '/' + fileName(survey, 'pdf').replace('.pdf', '_40명.pdf')
writeFileSync(p2, Buffer.from(d2.output('arraybuffer')))
console.log('PDF  ' + p2 + '  (' + d2.getNumberOfPages() + '쪽, 신청 ' + many.length + '건)')

const wb = await buildWorkbook({ survey, rows: few, allRows: few })
const x1 = out + '/' + fileName(survey, 'xlsx')
XLSX.writeFile(wb, x1)
console.log('엑셀 ' + x1 + '  (시트: ' + wb.SheetNames.join(', ') + ')')
