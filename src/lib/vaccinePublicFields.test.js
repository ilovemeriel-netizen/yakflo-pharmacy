/* @vitest-environment node */
/* 공개 잔량 조회가 내보내는 필드가 늘어나지 않았는지 **소스에서** 확인한다.
   ★ 약플로 관리 화면에 약품명·제약사를 붙였다(2026-10-28). 같은 값이 공개 사이트로
     새면 안 된다 — 공개 화면은 품목을 식별할 수 없어야 한다는 것이 0090~0092 의 전제다.
   ★ 함수를 실행하지 않고 소스를 읽는다. 운영 DB·네트워크에 닿지 않는다. */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const P_STOCK = resolve(process.cwd(), 'vaccine-app/netlify/functions/_lib/stock.js')
const P_FN = resolve(process.cwd(), 'vaccine-app/netlify/functions/vaccine-stock.js')
const has = existsSync(P_STOCK) && existsSync(P_FN)

;(has ? describe : describe.skip)('공개 잔량 조회 — 내보내는 필드', () => {
  const stock = has ? readFileSync(P_STOCK, 'utf8') : ''
  const fn = has ? readFileSync(P_FN, 'utf8') : ''

  it('★ 계정에서 읽는 열은 id · season · public_label 뿐이다', () => {
    const m = /\.select\('([^']*)'\)/.exec(stock.slice(stock.indexOf('vaccine_accounts')))
    expect(m, 'vaccine_accounts select 를 찾지 못했다').toBeTruthy()
    const cols = m[1].split(',').map(s => s.trim()).sort()
    expect(cols).toEqual(['id', 'public_label', 'season'])
  })

  it('★ drug_code 를 읽지도 내보내지도 않는다 — 품목이 식별되면 안 된다', () => {
    /* 주석은 뺀다 — 머리말이 「drug_code 는 싣지 않는다」고 적어 두고 있다 */
    const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const bad of ['drug_code', 'drug_name', 'manufacturer', 'lot', 'expiry', 'allocated']) {
      expect(code(stock).includes(bad), '_lib/stock.js 에 ' + bad + ' 가 있으면 안 된다').toBe(false)
      expect(code(fn).includes(bad), 'vaccine-stock.js 에 ' + bad + ' 가 있으면 안 된다').toBe(false)
    }
  })

  it('★ 품목 한 건이 담는 키는 label · qty · status 셋뿐이다', () => {
    const m = /return \{ label:[^}]*\}/.exec(stock)
    expect(m, '품목을 만드는 자리를 찾지 못했다').toBeTruthy()
    /* `qty` 처럼 줄여 쓴 키도 센다 — 쉼표로 끊어 각 조각의 이름만 본다 */
    const keys = m[0].replace(/^return \{/, '').replace(/\}$/, '')
      .split(/,(?![^(]*\))/)
      .map(s => s.trim().split(':')[0].trim())
      .filter(Boolean).sort()
    expect(keys).toEqual(['label', 'qty', 'status'])
  })

  it('★ 응답 묶음은 season · updated_at · items 셋뿐이다', () => {
    /* 빈 목록일 때와 정상일 때 두 자리 모두 같은 키를 쓴다 */
    expect(stock).toContain('{ season: null, updated_at: null, items: [] }')
    const i = stock.lastIndexOf('season:')
    const tail = stock.slice(i, i + 220)
    for (const k of ['season', 'updated_at', 'items']) expect(tail).toContain(k)
    for (const bad of ['drug', 'maker', 'lot', 'expiry']) {
      expect(tail.includes(bad), '응답 묶음에 ' + bad + ' 가 섞이면 안 된다').toBe(false)
    }
  })
})
