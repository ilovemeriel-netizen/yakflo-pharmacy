/* @vitest-environment jsdom */
/* 화면별 「값 입력 → 포커스 해제 → 갱신 미룸 → 저장 후 갱신」.

   ★ 막으려는 것: 폼에 값을 써 둔 채 포커스를 빼 놓았는데 새 배포가 들어와
     새로고침이 걸리고, **쓰던 값이 사라지는 것.**
   ★ 포커스가 빠진 뒤에도 미뤄야 한다는 점이 핵심이다 — 포커스 검사만으로는 못 막는다.
   ★ 화면을 실제로 렌더하지 않는다(App.jsx 는 1MB·Supabase 의존). 대신
     ⓐ 그 화면이 쓰는 「손댄 상태」 판정을 실제 함수로 돌리고,
     ⓑ 등록대에 올렸을 때 갱신 문이 닫히는지 보고,
     ⓒ 화면 코드에 그 열쇠가 실제로 연결돼 있는지 글자로 확인한다. */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  markBusy, clearBusyKeys, isBusy, readBusy, shouldReload, formDirty, anyFilled,
} from './pwaUpdate'

const SRC = {}
const read = f => (SRC[f] = SRC[f] || readFileSync(resolve(process.cwd(), f), 'utf8'))

beforeEach(() => { clearBusyKeys(); document.body.innerHTML = '' })

/* 지금 새 배포를 적용해도 되는가 — main.jsx 가 하는 판단과 같은 식 */
function 갱신가능() {
  return shouldReload({
    hadController: true, refreshing: false, lastReloadAt: 0,
    now: 1_000_000, busy: isBusy(readBusy(document)),
  })
}

/* ── 폼이 있는 화면 — 초기값과 입력 후 값을 실제 모양으로 적는다 ──────── */
const FORMS = [
  {
    key: 'tx-form', 화면: '입출고 입력', file: 'src/App.jsx',
    init: { qty: '', purchase_price: '', supplier: '', note: '', transaction_date: '2026-10-29' },
    typed: { qty: '120', purchase_price: '', supplier: '', note: '', transaction_date: '2026-10-29' },
  },
  {
    key: 'drug-register', 화면: '약품 등록', file: 'src/App.jsx',
    init: { drug_code: '', drug_name: '', category: '경구제', manufacturer: '' },
    typed: { drug_code: '', drug_name: '가바로닌캡슐100mg', category: '경구제', manufacturer: '' },
  },
  {
    key: 'drug-edit-form', 화면: '약품 수정 모달', file: 'src/App.jsx',
    init: { drug_code: 'A001', drug_name: '가바로닌캡슐100mg', purchase_price: 198 },
    typed: { drug_code: 'A001', drug_name: '가바로닌캡슐100mg', purchase_price: '210' },
  },
  {
    key: 'ward-window', 화면: '병동 신청 회차 설정(마감 일시)', file: 'src/App.jsx',
    init: { season: '추석', request_year: 2026, opens_at: '', closes_at: '', notice: '' },
    typed: { season: '추석', request_year: 2026, opens_at: '', closes_at: '2026-11-05T18:00', notice: '' },
  },
  {
    key: 'mypage-form', 화면: '내 정보', file: 'src/App.jsx',
    init: { full_name: '이정화', phone: '', dept: '약제과', position: '' },
    typed: { full_name: '이정화', phone: '010-0000-0000', dept: '약제과', position: '' },
  },
  {
    key: 'plan-modal', 화면: '약품 변경 계획 모달', file: 'src/App.jsx',
    init: { to_drug_name: '', to_drug_code: '', purchased: '○' },
    typed: { to_drug_name: '대체약품', to_drug_code: '', purchased: '○' },
  },
  {
    key: 'idle-register', 화면: '사용점검 등록 모달', file: 'src/App.jsx',
    init: { last_used_date: '', last_used_dept: '', status: '관찰', memo: '' },
    typed: { last_used_date: '', last_used_dept: '', status: '관찰', memo: '3개월 미사용' },
  },
  {
    key: 'survey-round', 화면: '수요조사 회차 설정(마감 시각)', file: 'src/VaccineSurveyPanel.jsx',
    init: { title: '2026 독감', close_at: '2026-11-01T18:00' },
    typed: { title: '2026 독감', close_at: '2026-11-02T09:00' },
  },
  {
    key: 'emerg-form', 화면: '응급 조제', file: 'src/EmergencyDispense.jsx',
    init: { patient: '', room: '', patientNo: '' },
    typed: { patient: '홍길동', room: '', patientNo: '' },
  },
]

describe('폼이 있는 화면 — 값 입력 → 포커스 해제 → 미룸 → 저장 후 갱신', () => {
  for (const s of FORMS) {
    it('★ ' + s.화면 + ' (' + s.key + ')', () => {
      /* ① 손대지 않았으면 갱신해도 된다 */
      expect(formDirty(s.init, s.init), '초기값끼리는 손댄 것이 아니다').toBe(false)
      expect(갱신가능()).toBe(true)

      /* ② 값을 하나 입력했다 → 「손댄 상태」 */
      expect(formDirty(s.typed, s.init), '입력했는데 손댄 것으로 보지 않는다').toBe(true)
      markBusy(s.key, formDirty(s.typed, s.init))

      /* ③ 포커스를 뺐다 — 그래도 미뤄야 한다(포커스 검사만으로는 못 막는 자리) */
      expect(readBusy(document).activeTag, '포커스는 입력칸이 아니다').not.toBe('input')
      expect(갱신가능(), '값을 써 둔 채 포커스만 빠졌는데 갱신됐다').toBe(false)

      /* ④ 저장했다 → 폼이 초기값으로 돌아가며 등록이 풀린다 */
      markBusy(s.key, formDirty(s.init, s.init))
      expect(갱신가능(), '저장했는데도 계속 미루고 있다').toBe(true)
    })
  }
})

/* ── 켜짐·꺼짐만 있는 화면(표 칸 수정·모달 열림 등) ───────────────────── */
const FLAGS = [
  { key: 'stock-drafts', 화면: '재고현황 사용량 수기 입력', file: 'src/App.jsx' },
  { key: 'tx-bulk', 화면: '입출고 엑셀 일괄(반영 전 행)', file: 'src/App.jsx' },
  { key: 'plan-drafts', 화면: '약품 변경 계획 표 수기 입력', file: 'src/App.jsx' },
  { key: 'plan-count', 화면: '약품 변경 계획 [실사] 모달', file: 'src/App.jsx' },
  { key: 'expiry-edit', 화면: '유효기한 표 칸 수정', file: 'src/App.jsx' },
  { key: 'idle-edit', 화면: '사용점검 표 칸 수정', file: 'src/App.jsx' },
  { key: 'idle-reason', 화면: '사용점검 사유 모달', file: 'src/App.jsx' },
  { key: 'order-supplier', 화면: '발주 거래처 등록·수정', file: 'src/App.jsx' },
  { key: 'order-qty', 화면: '발주 수량 수기 조정', file: 'src/App.jsx' },
  { key: 'ward-edit', 화면: '병동 신청 수량 수정·비밀번호', file: 'src/App.jsx' },
  { key: 'count-input', 화면: '재고 실사 수량·사유 입력', file: 'src/App.jsx' },
  { key: 'count-scan', 화면: '재고 실사 스캔 수량', file: 'src/App.jsx' },
  { key: 'locdrugs-edit', 화면: '위치별 약품 수정·이동', file: 'src/App.jsx' },
  { key: 'locvocab-edit', 화면: '위치 이름 등록·수정', file: 'src/App.jsx' },
  { key: 'adminuser-edit', 화면: '사용자 수정 모달', file: 'src/App.jsx' },
  { key: 'schedule-edit', 화면: '일정 수정', file: 'src/App.jsx' },
  { key: 'atc-edit', 화면: 'ATC 배치 편집·제외 사유', file: 'src/App.jsx' },
  { key: 'modal-edit-drug', 화면: '약품 수정 모달(열림)', file: 'src/App.jsx' },
  { key: 'modal-adjust', 화면: '재고 보정 모달', file: 'src/App.jsx' },
  { key: 'modal-dispose', 화면: '폐기 모달', file: 'src/App.jsx' },
  { key: 'modal-lot', 화면: '로트 관리 모달', file: 'src/App.jsx' },
  { key: 'modal-360', 화면: '약품 360° 모달', file: 'src/App.jsx' },
  { key: 'vaccine-modal', 화면: '백신 계정·행사·분류·보정 모달', file: 'src/VaccineManage.jsx' },
  { key: 'vaccine-fix', 화면: '백신 보정 사유 입력', file: 'src/VaccineManage.jsx' },
  { key: 'vaxpub-labels', 화면: '공개 사이트 이름표 수정', file: 'src/VaccinePublicPanel.jsx' },
  { key: 'survey-modal', 화면: '수요 현황 모달(회차·정리)', file: 'src/VaccineSurveyPanel.jsx' },
]

describe('켜짐·꺼짐만 있는 화면 — 작업 중이면 미루고, 끝나면 갱신', () => {
  for (const s of FLAGS) {
    it('★ ' + s.화면 + ' (' + s.key + ')', () => {
      expect(갱신가능()).toBe(true)
      markBusy(s.key, true)                 /* 고치기 시작 · 모달 열림 */
      expect(갱신가능(), '작업 중인데 갱신됐다').toBe(false)
      markBusy(s.key, false)                /* 저장 · 취소 · 닫기 */
      expect(갱신가능(), '끝났는데도 계속 미루고 있다').toBe(true)
    })
  }
})

/* ── 화면 코드에 실제로 연결돼 있는가 ─────────────────────────────────── */
describe('연결이 코드에 남아 있는가', () => {
  it('★ 모든 열쇠가 해당 화면 파일에서 useBusy 로 등록된다', () => {
    for (const s of [...FORMS, ...FLAGS]) {
      const src = read(s.file)
      expect(src.includes("useBusy('" + s.key + "'"), s.화면 + ' (' + s.key + ') 가 ' + s.file + ' 에 없다').toBe(true)
    }
  })

  it('★ 등록된 열쇠 수와 목록 수가 같다 — 빠뜨리거나 몰래 늘지 않게', () => {
    const files = ['src/App.jsx', 'src/EmergencyDispense.jsx', 'src/VaccineManage.jsx',
      'src/VaccinePublicPanel.jsx', 'src/VaccineSurveyPanel.jsx']
    const found = new Set()
    for (const f of files) {
      for (const m of read(f).matchAll(/useBusy\('([a-z0-9-]+)'/g)) found.add(m[1])
    }
    const listed = new Set([...FORMS, ...FLAGS].map(s => s.key))
    expect([...found].sort(), '코드에만 있거나 목록에만 있는 열쇠가 있다').toEqual([...listed].sort())
  })

  it('★ 수요 현황의 수량 칸은 저장이 끝날 때까지 미룬다 — 미저장 state 가 없는 자리', () => {
    /* 비제어 입력 + onBlur 즉시 저장이라 「손댄 상태」가 머무는 state 가 없다.
       칸을 벗어나는 순간 저장이 시작되므로, 그 저장이 끝날 때까지 미뤄야 한다. */
    const src = read('src/VaccineSurveyPanel.jsx')
    expect(src).toContain("markBusy('survey-save-' + r.id, true)")
    expect(src).toContain("finally { markBusy('survey-save-' + r.id, false) }")
    for (const fn of ['_patchRow', '_editRow', '_setRowStatus']) {
      expect(src.includes('async function ' + fn + '('), fn + ' 가 없다').toBe(true)
    }
  })

  it('★ 저장 중 등록대도 갱신 문을 닫는다', () => {
    markBusy('survey-save-42', true)
    expect(갱신가능()).toBe(false)
    markBusy('survey-save-42', false)
    expect(갱신가능()).toBe(true)
  })
})

/* ── 판정 함수 자체 ───────────────────────────────────────────────────── */
describe('손댄 상태 판정', () => {
  it('느슨하게 비교한다 — 숫자 198 과 글자 "198" 은 같다', () => {
    expect(formDirty({ p: '198' }, { p: 198 })).toBe(false)
    expect(formDirty({ p: '199' }, { p: 198 })).toBe(true)
  })
  it('null 과 빈 칸은 같다 — 초기값이 null 인 칸을 손댄 것으로 보지 않는다', () => {
    expect(formDirty({ a: '' }, { a: null })).toBe(false)
    expect(formDirty({ a: '' }, {})).toBe(false)
  })
  it('목록은 길이로 본다 — 엑셀 행을 올려 두면 손댄 것이다', () => {
    expect(formDirty({ rows: [] }, { rows: [] })).toBe(false)
    expect(formDirty({ rows: [1] }, { rows: [] })).toBe(true)
  })
  it('초기값이 없으면 빈 값만 손대지 않은 것이다', () => {
    expect(formDirty({ a: '' }, null)).toBe(false)
    expect(formDirty({ a: 'x' }, null)).toBe(true)
    expect(formDirty(null, null)).toBe(false)
  })
  it('anyFilled — 하나라도 채워졌는가', () => {
    expect(anyFilled({})).toBe(false)
    expect(anyFilled({ a: '', b: null, c: false })).toBe(false)
    expect(anyFilled({ a: '', b: '0' })).toBe(true)
    expect(anyFilled({ a: [] })).toBe(false)
    expect(anyFilled({ a: [1] })).toBe(true)
    expect(anyFilled(null)).toBe(false)
  })
})
