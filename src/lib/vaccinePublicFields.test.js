/* @vitest-environment node */
/* 공개 잔량 조회가 내보내는 필드를 **정확히** 고정한다.
   ★ 2026-10-28 — 어느 제품인지 묻는 문의가 잦아 items 에 drug_name·maker 를 더했다.
     여기서 고정하지 않으면 다음에 누가 단가·입고량까지 끌어오기 쉽다.
   ★ drugs 에서 읽는 열은 drug_name·manufacturer·current_qty 세 개뿐이어야 한다.
     ★ 2026-11-13 — current_qty 가 더해졌다. **상시 백신(폐렴구균·대상포진)의 잔량**이
       약플로 재고현황에서 오기 때문이다(이정화 님 승인). 그 값은 이미 공개하던 qty 와
       **같은 숫자**라 새로 새는 것이 없다.
     ★ 단가 3종·입고량·배정량·LOT·유효기한은 **여전히 금지**다 — 아래 목록이 지킨다.
   ★ 함수를 실행하지 않고 소스를 읽는다. 운영 DB·네트워크에 닿지 않는다. */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const P_STOCK = resolve(process.cwd(), 'vaccine-app/netlify/functions/_lib/stock.js')
const P_FN = resolve(process.cwd(), 'vaccine-app/netlify/functions/vaccine-stock.js')
const has = existsSync(P_STOCK) && existsSync(P_FN)
/* 주석은 빼고 본다 — 머리말이 「싣지 않는다」고 적어 두고 있다 */
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

;(has ? describe : describe.skip)('공개 잔량 조회 — 내보내는 필드', () => {
  const stock = has ? readFileSync(P_STOCK, 'utf8') : ''
  const fn = has ? readFileSync(P_FN, 'utf8') : ''

  /* ★ 2026-11-13 — public_group(시즌/상시) 한 열이 늘었다. 공개 화면이 두 칸으로 나뉜다. */
  it('★ 계정에서 읽는 열은 id · season · public_label · drug_code · public_group 뿐이다', () => {
    const body = code(stock)
    const m = /\.select\('([^']*)'\)/.exec(body.slice(body.indexOf('vaccine_accounts')))
    expect(m, 'vaccine_accounts select 를 찾지 못했다').toBeTruthy()
    expect(m[1].split(',').map(s => s.trim()).sort())
      .toEqual(['drug_code', 'id', 'public_group', 'public_label', 'season'])
  })

  it('★ drugs 에서 읽는 열은 drug_name · manufacturer · current_qty 뿐이다 — 단가는 읽지 않는다', () => {
    const body = code(stock)
    const i = body.indexOf("from('drugs')")
    expect(i, "drugs 조회를 찾지 못했다").toBeGreaterThan(-1)
    const m = /\.select\('([^']*)'\)/.exec(body.slice(i))
    /* ★ current_qty 는 **상시 백신의 잔량**이다(2026-11-13 승인).
         이미 공개하던 qty 와 같은 숫자라 새로 새는 것이 없다. */
    expect(m[1].split(',').map(s => s.trim()).sort())
      .toEqual(['current_qty', 'drug_code', 'drug_name', 'manufacturer'])

    /* ★ 끝까지 금지 — 단가 3종과 입고·배정·LOT·유효기한. 여기 있는 글자가 하나라도
         파일에 나타나면 시험이 깨진다(주석은 이미 걷어 낸 본문만 본다). */
    for (const bad of ['purchase_price', 'price_unit', 'edi_price',
      'safety_stock', 'lot', 'expiry', 'allocated_qty']) {
      expect(body.includes(bad), 'drugs 에서 ' + bad + ' 를 읽으면 안 된다').toBe(false)
    }
    /* received_qty 는 잔량 뷰에서 오는 값이라 예외다(drugs 에서 오는 것이 아니다) */
    expect(body.includes('received_qty')).toBe(true)

    /* ★ 읽은 재고를 **그대로 내보내지 않는다** — qty 라는 이름으로만 나간다 */
    expect(body).not.toMatch(/current_qty\s*[,}]/)
  })

  /* ★ 2026-11-13 — 약플로 입출고는 **시각 한 칸**만 읽는다.
       수량·금액·사유를 읽으면 공개 화면으로 샐 길이 생긴다. */
  it('★ transactions 에서 읽는 열은 created_at 하나뿐이다', () => {
    const body = code(stock)
    const i = body.indexOf("from('transactions')")
    if (i < 0) return                 /* 입출고를 안 읽는 판이면 볼 것이 없다 */
    const m = /\.select\('([^']*)'\)/.exec(body.slice(i))
    expect(m[1].split(',').map(s => s.trim()).sort()).toEqual(['created_at'])
    for (const bad of ['quantity', 'total_amount', 'unit_price', 'supplier', 'reason', 'handler']) {
      expect(body.includes(bad), 'transactions 에서 ' + bad + ' 를 읽으면 안 된다').toBe(false)
    }
  })

  it('★ 품목 한 건이 담는 키는 label · qty · status · group · drug_name · maker 여섯뿐이다', () => {
    const m = /return \{\s*label:[\s\S]*?\n\s*\}/.exec(code(stock))
    expect(m, '품목을 만드는 자리를 찾지 못했다').toBeTruthy()
    /* 중괄호 안을 쉼표로 끊어 각 조각의 **이름만** 센다(`qty` 처럼 줄여 쓴 것 포함) */
    const inner = m[0].replace(/^return \{/, '').replace(/\}$/, '')
    const keys = inner.split(/,(?![^(]*\))/)
      .map(s => s.trim().split(':')[0].trim()).filter(Boolean)
    /* ★ 2026-11-13 — group(시즌/상시) 한 칸이 늘었다. 그 밖에는 늘지 않았다. */
    expect([...new Set(keys)].sort()).toEqual(['drug_name', 'group', 'label', 'maker', 'qty', 'status'])
  })

  it('★ 응답 묶음은 season · updated_at · items 셋뿐이다', () => {
    expect(stock).toContain('{ season: null, updated_at: null, items: [] }')
    const body = code(stock)
    const i = body.lastIndexOf('season:')
    const tail = body.slice(i, i + 200)
    for (const k of ['season', 'updated_at', 'items']) expect(tail).toContain(k)
  })

  it('★ 함수 본체는 약품 열을 직접 다루지 않는다 — 조립은 _lib/stock.js 한 곳에서만', () => {
    for (const bad of ['drug_name', 'manufacturer', 'drug_code']) {
      expect(code(fn).includes(bad), 'vaccine-stock.js 에 ' + bad + ' 가 있으면 안 된다').toBe(false)
    }
  })

  it('★ 약품 조회가 실패해도 잔량은 그대로 내려간다', () => {
    /* drugRes.error 를 보고 조용히 넘어가야 한다 — return 으로 끊으면 안 된다 */
    expect(code(stock)).toContain('if (!drugRes.error)')
    expect(code(stock)).not.toContain("step: '약품'")
  })
})
