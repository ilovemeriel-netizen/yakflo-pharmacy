/* @vitest-environment node */
/* transactions 컬럼 → 화면 이름 — 입출고 화면의 표 머리글과 어긋나지 않는지 본다.

   ★ 왜 시험으로 묶는가
     저장 폴백이 칸을 버렸을 때 사용자에게 보여 줄 이름이다. 화면 머리글만 바꾸고
     이 표를 잊으면 **안내 문구와 화면의 칸 이름이 달라진다**.
     TxForm 의 cols 배열(App.jsx)을 직접 읽어 비교한다
     (lib/vaccineRoute.test.js 가 ROUTES 를 고정하는 것과 같은 방식).

   ★ 그리고 **조용히 빠질 수 있는 칸(nullable)** 에는 반드시 이름이 있어야 한다.
     NOT NULL 칸은 빠지면 저장 자체가 실패해 조용할 수 없으므로 덜 중요하다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TX_COL_LABEL, txColLabel } from './txTypes'

const SRC = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

/* TxForm 의 cols 정의에서 [컬럼, 머리글] 짝을 모두 뽑는다 */
function screenLabels() {
  const i = SRC.indexOf("const cols=tab==='입고'?[")
  expect(i, 'TxForm 의 cols 정의를 못 찾음 — 표 정의가 움직였는지 확인할 것').toBeGreaterThan(0)
  const line = SRC.slice(i, SRC.indexOf('\n', i))
  const out = {}
  for (const m of line.matchAll(/\['([a-z_]+)','([^']+)'\]/g)) {
    /* 같은 컬럼이 탭마다 나오지만 머리글은 같아야 한다 */
    if (out[m[1]] && out[m[1]] !== m[2]) throw new Error(`화면 머리글이 탭마다 다르다: ${m[1]}`)
    out[m[1]] = m[2]
  }
  return out
}

/* transactions 의 nullable 칸 — 2026-10-29 운영 실측(information_schema).
   ★ 이 목록이 바뀌면(컬럼 추가·NOT NULL 변경) 라벨도 함께 챙기라는 뜻이다. */
const TX_NULLABLE = [
  'unit_price', 'total_amount', 'lot_no', 'expiry_date', 'supplier', 'reason',
  'handler', 'approver', 'process_status', 'transaction_date', 'memo',
]
const TX_NOT_NULL = ['drug_code', 'type', 'quantity']

describe('화면 머리글과 어긋나지 않는다', () => {
  const screen = screenLabels()

  it('cols 에서 머리글을 읽어냈다', () => {
    expect(Object.keys(screen).length).toBeGreaterThan(8)
    expect(screen.total_amount).toBe('금액')
  })

  it('★ 화면에 머리글이 있는 칸은 같은 이름을 쓴다', () => {
    for (const [col, label] of Object.entries(screen)) {
      /* drug_name·category 는 transactions 칸이 아니라 약품에서 붙인 표시용이다 */
      if (col === 'drug_name' || col === 'category') continue
      expect(TX_COL_LABEL[col], `TX_COL_LABEL 에 ${col} 이 없다`).toBe(label)
    }
  })
})

describe('조용히 빠질 수 있는 칸에는 반드시 이름이 있다', () => {
  it('★ nullable 11칸 전부', () => {
    const missing = TX_NULLABLE.filter(c => !TX_COL_LABEL[c])
    expect(missing, `이름 없는 nullable 칸: ${missing.join(', ')}`).toEqual([])
  })

  it('★ 금액·단가·일자가 날컬럼 이름으로 뜨지 않는다 — 가장 중요한 세 칸', () => {
    expect(txColLabel('total_amount')).toBe('금액')
    expect(txColLabel('unit_price')).toBe('거래단가')
    expect(txColLabel('transaction_date')).toBe('일자')
  })

  it('NOT NULL 칸도 이름이 있다(빠지면 저장 자체가 실패하지만 문구는 필요)', () => {
    for (const c of TX_NOT_NULL) expect(TX_COL_LABEL[c], c).toBeTruthy()
  })

  it('모르는 컬럼은 이름 그대로', () => {
    expect(txColLabel('없는칸')).toBe('없는칸')
    expect(txColLabel('tenant_id')).toBe('tenant_id')
  })
})

describe('drugs 라벨과 섞이지 않는다', () => {
  it('★ drugs 사전(FIELD_DEFS)에는 transactions 핵심 칸이 없다 — 그래서 별도 표가 필요하다', async () => {
    const { FIELD_DEFS } = await import('./drugRules')
    const drugCols = new Set(FIELD_DEFS.map(f => f.col))
    for (const c of ['unit_price', 'total_amount', 'supplier', 'handler', 'approver', 'process_status', 'transaction_date']) {
      expect(drugCols.has(c), `FIELD_DEFS 에 ${c} 가 생겼다면 라벨 출처를 다시 검토할 것`).toBe(false)
    }
  })
})
