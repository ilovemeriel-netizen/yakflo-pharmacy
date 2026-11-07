/* 사용량순 제안 화면 표 — 열 너비 (2026-11-07 이정화 님 지시).
 *
 * 증상
 *   「2차 예비」 표에서 약품명 열이 너무 넓어 약품명과 「3개월」 사이가 크게 비어 보였다.
 *
 * 원인 — 적힌 colWidths 는 **비율로만** 쓰인다
 *   표는 `width:100%` 라 칸보다 좁으면 늘어난다. 모든 열에 너비가 있으면 **비율대로** 늘어나
 *   글자 칸까지 같이 넓어진다. 창 1280px 실측: 약품명 170 → 481px, 남는 빈 공간 321px.
 *
 * 고친 방법 — 안 ⓑ
 *   마지막 **막대(그래프)** 열에 너비를 주지 않는다(null). 그러면 그 열이 남는 폭을 혼자 먹고
 *   앞 열들은 적힌 px 그대로 남는다. 창 900 · 1280 · 1600px 에서 모두 약품명 190px 로 같다.
 *
 * 못 박는 것
 *  ① 막대가 마지막 열인 **세 표만** 바꿨다 (2차 예비 · FSP 후보 · 현재 FSP)
 *  ② 막대가 없는 세 표는 **그대로** 둔다 — 몰아주면 구멍이 더 커진다(실측)
 *  ③ 약품명 190px 는 후보 343종 중 **가장 넓은 이름이 잘리지 않는** 폭이다
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')

describe('★ 안 ⓑ 를 적용한 세 표 (마지막 열이 막대)', () => {
  it('2차 예비 — [56, 190, 64, 없음]', () => {
    expect(CODE).toContain('minWidth={420} colWidths={[56, 190, 64, null]}')
  })

  it('FSP 후보 — [64, 110, 190, 90, 없음]', () => {
    expect(CODE).toContain('minWidth={628} colWidths={[64, 110, 190, 90, null]}')
  })

  it('현재 FSP — [64, 110, 190, 90, 64, 없음]', () => {
    expect(CODE).toContain('minWidth={628} colWidths={[64, 110, 190, 90, 64, null]}')
  })

  it('★ 세 표 모두 **마지막 열만** null 이다 (중간에 null 이 있으면 열이 엉킨다)', () => {
    for (const m of CODE.matchAll(/colWidths=\{\[([^\]]*null[^\]]*)\]\}/g)) {
      const parts = m[1].split(',').map(s => s.trim())
      expect(parts[parts.length - 1]).toBe('null')
      expect(parts.slice(0, -1).some(p => p === 'null')).toBe(false)
    }
  })

  it('★ null 을 쓰는 표가 정확히 셋이다', () => {
    expect((CODE.match(/colWidths=\{\[[^\]]*null\]\}/g) || []).length).toBe(3)
  })
})

describe('★ 손대지 않은 세 표 (마지막 열이 막대가 아니다)', () => {
  /* 남는 폭은 어디론가 가야 한다. 막대가 없는 표에서 마지막 글자 칸에 몰아주면
     구멍이 더 커진다 — 실측(창 1280px): 신규 진입의 「사유」 222px · 교환 제안의 「실행」 650px.
     지금처럼 고르게 퍼지는 쪽이 낫다(가장 큰 구멍 160~192px). */
  it('신규 진입 · 제외 — [68, 148, 60, 56] 그대로', () => {
    expect(CODE).toContain('minWidth={340} colWidths={[68, 148, 60, 56]}')
  })

  it('교환 제안 — 두 경우 모두 그대로', () => {
    expect(CODE).toContain('colWidths={canSwap ? [70, 140, 70, 140, 80, 120] : [76, 160, 76, 160, 92]}')
  })
})

describe('★ 약품명 190px — 가장 넓은 이름이 잘리지 않는 폭', () => {
  /* 2026-11-07 실측 (글자 11px 맑은 고딕, 좌우 안여백 8px씩):
       가장 넓은 이름 = 명인아미트리프틸린염산염정10mg  171.4px
       ★ 글자 수가 가장 많은 세비카에이치씨티정5/20/12.5mg(20자)는 162.8px 로 더 좁다 —
         숫자·슬래시가 한글보다 좁아서, **글자 수로 고르면 틀린다.**
       필요 열 폭 = 171.4 + 16 = 188px  → 190px 로 잡았다(여유 2.6px)
       후보 343종 기준 잘리는 약: 170px 10종(3%) · 185px 3종(1%) · 188px 0종 · 190px 0종 */
  const NEED = 188

  it('세 표 모두 약품명이 190px 다', () => {
    expect((CODE.match(/, 190,/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('★ 190 은 필요 폭 188 이상이다', () => {
    expect(190).toBeGreaterThanOrEqual(NEED)
  })

  it('★ 예전 170px 은 모자랐다 (10종이 잘렸다)', () => {
    expect(170).toBeLessThan(NEED)
  })
})

describe('★ StandardTable — null 규칙이 코드에 적혀 있다', () => {
  it('colgroup 이 colWidths 를 그대로 쓴다 (null 이면 리액트가 지운다)', () => {
    expect(CODE).toContain('<col key={ci} style={{ width: w }} />')
  })

  it('★ 왜 그런지 주석이 남아 있다 — 다음 사람이 비율 함정에 다시 빠지지 않게', () => {
    const i = APP.indexOf('colWidths.map((w, ci)')
    const before = APP.slice(Math.max(0, i - 700), i)
    expect(before).toContain('null')
    expect(before).toContain('비율')
  })
})
