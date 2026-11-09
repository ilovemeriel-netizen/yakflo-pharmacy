/* 「88위 경계 대비」 막대의 기준값 — 방안 A (2026-11-09 이정화 님 승인).
 *
 * 무엇이 잘못됐었나
 *   기준값이 `usageScore(assignable[87])` — 88번 **자리**에 있는 약이었다.
 *   그런데 바로 위 「상비 잔류 보장」이 사용량이 낮은 상비 약을 그 자리에 끼워 넣는다.
 *   운영 실측(2026-11-09) — 애니탈정(원래 135위 · 3개월 213)이 88번 자리에 들어가
 *   기준값이 213 이 되고, 예비 12종(353~457)이 전부 165~215% 라 **100% 에서 잘려**
 *   막대 12개가 모두 같은 길이(320px)가 됐다. 오류가 아니라 **조용히 뜻을 잃은** 자리다.
 *
 * 못 박는 것
 *  ① 기준값이 `barBase` 이고, 끼워 넣은 상비를 **모두** 거른다
 *  ② 배정 목록·상비 끼워넣기·순위 계산은 **하나도 바뀌지 않았다**
 *  ③ 100% 상한은 그대로 둔다 (경계선을 넘은 약은 100% 로 보이는 게 맞다)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')

/* 화면과 같은 식 */
const barOf = (u, bnd) => Math.max(2, Math.min(100, u / bnd * 100))
/* 운영 실측값 (2026-11-09) */
const YEBI = [457, 452, 441, 402, 390, 376, 372, 370, 369, 368.25, 365, 353]
const BND_NOW = 213, BND_A = 462

describe('★ 기준값이 barBase 로 바뀌었다', () => {
  it('막대가 barBase 를 쓴다 — 옛 기준값은 사라졌다', () => {
    expect(CODE).toContain('const w = Math.max(2, Math.min(100, r._u / barBase * 100));')
    /* ★ 「옛 기준값이 없다」를 파일 전체로 보면 안 된다 — **주석에** 왜 바꿨는지 적어 두었기 때문이다.
       파일에 남은 `assignable[87]` 은 그 주석 **한 군데뿐**이어야 한다. */
    expect((APP.match(/assignable\[87\]/g) || []).length).toBe(1)
    const i = APP.indexOf('assignable[87]')
    expect(APP.slice(i - 60, i)).toContain('예전에는')   /* 그 한 군데가 주석인지 */
  })

  it('★ 끼워 넣은 상비를 **모두** 거른다 (하나만 거르지 않는다)', () => {
    expect(CODE).toContain('const earned = top88r.filter(d => pinnedIn.indexOf(d.drug_code) < 0);')
    expect(CODE).toContain('return usageScore(earned[earned.length - 1]) || 1;')
  })

  it('★ 거른 뒤 **가장 낮은** 사용량을 쓴다 (목록이 사용량 내림차순이라 마지막이 최저)', () => {
    expect(CODE).toContain('earned[earned.length - 1]')
  })

  it('비어도 터지지 않는다 — 0 이면 1 로 떨어진다', () => {
    expect(CODE).toContain('|| 1;')
    expect(barOf(100, 1)).toBe(100)
  })
})

describe('★ 배정·순위 쪽은 한 글자도 바뀌지 않았다', () => {
  it('상비 끼워넣기 식이 그대로다 (88 이상이면 87 자리로)', () => {
    expect(CODE).toContain("const ix = assignable.findIndex(d => d.drug_code === pc); if (ix >= 88) { const mv = assignable.splice(ix, 1)[0]; pinnedIn.push(pc); assignable.splice(87, 0, mv); }")
  })

  it('★ pinnedIn 은 적어 두기만 한다 — splice 차례·값에 끼어들지 않는다', () => {
    /* push 가 splice(87,…) **앞**에 있어도 배열에는 영향이 없다(코드 목록일 뿐이다) */
    const line = CODE.split('\n').find(l => l.includes("['SANTLTRPL', 'STCNE', 'AMNP5']"))
    expect(line).toBeTruthy()
    expect(line).toContain('pinnedIn.push(pc)')
    expect(line).toContain('assignable.splice(87, 0, mv)')
  })

  it('배정 목록·예비 목록을 만드는 줄이 그대로다', () => {
    expect(CODE).toContain('const top88r = assignable.slice(0, 88); const yebi12 = assignable.slice(88, 100);')
    expect(CODE).toContain('const assignable = propCand.filter(d => !isN(d) && !d.atc_excluded && !(d.fsp_slot && !d.atc_slot && !d.fsp_note));')
  })

  it('순위 열은 예전처럼 rankFull(걸러내기 전 전체 순위)을 쓴다', () => {
    expect(CODE).toContain('rankFull.set(d.drug_code, i + 1)')
    expect(CODE).toContain('rank: rankFull.get(d.drug_code) || null')
  })

  it('카세트 배정(pIdeal)도 그대로다', () => {
    expect(CODE).toContain('for (let sl = 1; sl <= 80; sl++) pIdeal[String(sl)] = assignable[88 - sl] || null;')
  })
})

describe('★ 운영 값으로 본 전·후 (2026-11-09 실측)', () => {
  it('★ 전 — 12줄이 전부 100% 라 막대가 같은 길이였다', () => {
    const ws = YEBI.map(u => barOf(u, BND_NOW))
    expect(ws.every(w => w === 100)).toBe(true)
    expect(new Set(ws).size).toBe(1)
  })

  it('★ 후 — 12줄이 서로 다르다 (76.4% ~ 98.9%)', () => {
    const ws = YEBI.map(u => barOf(u, BND_A))
    expect(new Set(ws.map(w => Math.round(w * 10))).size).toBeGreaterThanOrEqual(11)
    expect(Math.max(...ws)).toBeCloseTo(98.9, 1)
    expect(Math.min(...ws)).toBeCloseTo(76.4, 1)
  })

  it('★ 100% 상한은 그대로다 — 경계선을 넘는 약이 생기면 100% 로 보인다', () => {
    expect(barOf(999, BND_A)).toBe(100)
    expect(CODE).toContain('Math.min(100,')
  })

  it('가장 짧은 막대도 2% 아래로 내려가지 않는다 (보이지 않게 되는 것을 막는다)', () => {
    expect(barOf(0, BND_A)).toBe(2)
    expect(CODE).toContain('Math.max(2,')
  })
})
