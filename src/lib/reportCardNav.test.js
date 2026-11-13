/* 월간 보고서 카드 → 입출고 화면 이동 (2026-11-13 이정화 님 승인)
 *
 * 못 박는 것 — **소스를 읽어** 확인한다(화면을 띄우지 않는다)
 *   ① 입고·출고·폐기·반품 네 카드에만 종류(txTab)가 붙어 있다
 *   ② 전월재고·기말재고·보정값에는 붙지 않는다 — 연결하지 않기로 했다
 *   ③ 누를 때 종류와 **연·월**을 함께 넘긴다
 *   ④ handleNav 가 주소에 'YYYY-MM' 만 적는다(그 밖의 값은 적지 않는다)
 *   ⑤ 카드 모양(색·글자·커서)은 한 군데도 바뀌지 않았다
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { TX_IN, TX_OUT, TX_DISPOSE, TX_RETURN } from './txTypes'

const APP = fs.readFileSync('src/App.jsx', 'utf8')
/* 월간 보고서 카드 묶음 — 「전월재고」로 시작해 「기말재고」로 끝나는 한 줄 */
const CARDS = (() => {
  const i = APP.indexOf("{l:'전월재고'")
  const j = APP.indexOf("nav:'stock'}]", i)
  expect(i, '카드 묶음을 찾지 못했다').toBeGreaterThan(0)
  expect(j).toBeGreaterThan(i)
  return APP.slice(i, j + 13)
})()

describe('★ ① 네 카드에만 종류가 붙는다', () => {
  for (const [label, tab] of [['입고 금액', TX_IN], ['출고 금액', TX_OUT]]) {
    it(label + ' → ' + tab, () => {
      const k = CARDS.indexOf("{l:'" + label + "'")
      expect(k, label + ' 카드가 없다').toBeGreaterThan(-1)
      const end = CARDS.indexOf('}', CARDS.indexOf("nav:'transaction'", k))
      expect(CARDS.slice(k, end)).toContain('txTab:')
    })
  }
  it('폐기 → ' + TX_DISPOSE, () => {
    expect(CARDS).toContain("c:t.red,nav:'transaction',txTab:TX_DISPOSE}")
  })
  it('반품 → ' + TX_RETURN, () => {
    expect(CARDS).toContain("c:t.amber,nav:'transaction',txTab:TX_RETURN}")
  })
  it('종류는 거래 타입 SSOT 에서 가져온다 — 글자를 새로 적지 않는다', () => {
    for (const name of ['TX_IN', 'TX_OUT', 'TX_DISPOSE', 'TX_RETURN']) {
      expect(CARDS, name).toContain('txTab:' + name)
    }
  })
})

describe('★ ② 연결하지 않기로 한 카드에는 붙지 않는다', () => {
  for (const label of ['전월재고', '기말재고']) {
    it(label + ' 은 재고 화면으로만 간다', () => {
      const k = CARDS.indexOf("{l:'" + label + "'")
      expect(k).toBeGreaterThan(-1)
      const end = CARDS.indexOf('}', k)
      const one = CARDS.slice(k, end)
      expect(one).toContain("nav:'stock'")
      expect(one.includes('txTab'), label + ' 에 종류가 붙었다').toBe(false)
    })
  }
  it('★ 보정값은 카드 묶음에 아예 없다 — 연결하지 않는다', () => {
    expect(CARDS.includes('보정값'), '보정값이 묶음에 들어왔다').toBe(false)
  })
})

describe('★ ③ 누를 때 종류와 연·월을 함께 넘긴다', () => {
  it('종류가 있는 카드만 연·월을 싣는다', () => {
    expect(APP).toContain(
      "onClick={()=>onNav?.(x.txTab?{menu:x.nav,txTab:x.txTab,ym:year+'-'+String(month).padStart(2,'0')}:{menu:x.nav})}")
  })
  it('연·월은 보고서가 보고 있는 그 달이다', () => {
    /* year·month 는 월간 보고서의 연·월 상태다(다른 변수를 쓰면 엉뚱한 달로 간다) */
    expect(APP).toContain("const[year,setYear]=useState(cy);const[month,setMonth]=useState(cm);")
  })
})

describe('★ ④ 주소에 적는 연·월', () => {
  it("'YYYY-MM' 모양일 때만 적는다", () => {
    expect(APP).toContain("const _ym = /^[0-9]{4}-[0-9]{2}$/.test(String(nav.ym || '')) ? '/' + nav.ym : ''")
  })
  it('주소 끝에 연·월을 붙인다', () => {
    expect(APP).toContain("'#transaction/' + (TX_URL_KEY[nav.txTab] || encodeURIComponent(nav.txTab)) + _ym")
  })
  it('★ 주소에서 연·월을 읽는 쪽이 같은 모양을 본다', () => {
    /* ymFromHash 가 'YYYY-MM' 만 받아들인다 — 적는 쪽과 읽는 쪽이 어긋나면 이번 달로 떨어진다 */
    expect(APP).toContain("if (m && /^[0-9]{4}-[0-9]{2}$/.test(m))")
  })
})

describe('★ ⑤ 카드 모양은 바뀌지 않았다', () => {
  it('손가락 커서·테두리·여백이 그대로다', () => {
    const i = APP.indexOf('onClick={()=>onNav?.(x.txTab?')
    const style = APP.slice(i, i + 400)
    expect(style).toContain("borderRadius:12")
    expect(style).toContain("padding:'14px 18px'")
    expect(style).toContain("cursor:'poi")
  })
})
