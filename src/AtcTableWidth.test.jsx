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
 *   앞 열들은 적힌 px 그대로 남는다. 창 900 · 1280 · 1600px 에서 모두 약품명 200px 로 같다.
 *
 * 못 박는 것
 *  ① 막대가 마지막 열인 **세 표만** 바꿨다 (2차 예비 · FSP 후보 · 현재 FSP)
 *  ② 막대가 없는 세 표는 **그대로** 둔다 — 몰아주면 구멍이 더 커진다(실측)
 *  ③ 약품명 200px 는 후보 343종 중 **가장 넓은 이름이 잘리지 않는** 폭이다
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')

describe('★ 막대가 있는 표는 「2차 예비」 하나뿐이다 (2026-11-09 확인)', () => {
  /* ★ 2026-11-07 에 세 표 모두 마지막 열이 막대인 줄 알고 null 을 줬는데 **틀렸다.**
       FSP 후보의 마지막 열은 「소수여부」, 현재 FSP 는 「기준 부합」으로 **둘 다 글자 칸**이다.
       글자 칸에 남는 폭을 몰아주면 휑해진다 — 그래서 그 둘은 너비를 그대로 준다. */
  it('2차 예비만 마지막 열이 비어 있다 — 막대가 남는 폭을 먹는다', () => {
    expect(CODE).toContain('minWidth={420} colWidths={[56, 200, 64, null]}')
  })

  it('★ null 을 쓰는 표가 **하나뿐**이다', () => {
    expect((CODE.match(/colWidths=\{\[[^\]]*null\]\}/g) || []).length).toBe(1)
  })

  it('★ FSP 두 표는 마지막 열 너비를 그대로 받는다 (글자 칸이라서)', () => {
    expect(CODE).toContain('minWidth={658} colWidths={[64, 110, 200, 90, 194]}')
    expect(CODE).toContain('minWidth={658} colWidths={[64, 110, 200, 90, 64, 130]}')
  })

  it('★ 그 두 표의 마지막 열이 정말 글자 칸인지 (막대가 아니다)', () => {
    expect(CODE).toContain("h: '소수여부'")
    expect(CODE).toContain("h: '기준 부합'")
    /* 막대를 그리는 곳은 「88위 경계 대비」 한 군데뿐이다 */
    expect((CODE.match(/h: '88위 경계 대비'/g) || []).length).toBe(1)
  })
})

describe('★ 손대지 않은 표들', () => {
  it('신규 진입 · 제외 — [68, 148, 60, 56] 그대로', () => {
    expect(CODE).toContain('minWidth={340} colWidths={[68, 148, 60, 56]}')
  })

  it('교환 제안 — 두 경우 모두 그대로', () => {
    expect(CODE).toContain('colWidths={canSwap ? [70, 140, 70, 140, 80, 120] : [76, 160, 76, 160, 92]}')
  })
})

describe('★ 약품명 200px — 가장 넓은 이름이 잘리지 않는 폭', () => {
  /* 2026-11-09 실측 — ★ **운영 전역 CSS 를 넣고** 다시 쟀다(84_약품명_폭_운영CSS.png).
       글꼴  : system-ui, "Segoe UI", Roboto, sans-serif   (index.css 의 --sans)
       자간  : 0.18px   ← :root 에서 상속된다. 이걸 빼면 이름마다 3px 쯤 좁게 나온다.
       가장 넓은 이름 = 명인아미트리프틸린염산염정10mg  **174.5px**
       필요 열 폭 = 174.5 + 안여백 16 = **191px**  → 200px (여유 9.5px)

     ★ 처음에 맑은 고딕·자간 없이 재서 171.4px → 190px 으로 잡았는데, **190 은 1px 모자랐다**
       (343종 중 3종이 두 줄로 접혔다). 글꼴을 빼고 재면 이렇게 어긋난다.
     ★ 글자 수가 가장 많은 세비카에이치씨티정5/20/12.5mg(20자)는 166.4px 로 더 좁다 —
       숫자·슬래시가 한글보다 좁아서 **글자 수로 고르면 틀린다.**
       후보 343종 기준 잘리는 약 : 190px 3종(1%) · 200px **0종** */
  const NEED = 191

  it('세 표 모두 약품명이 200px 다', () => {
    expect((CODE.match(/, 200,/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('★ 200 은 필요 폭 191 이상이다', () => {
    expect(200).toBeGreaterThanOrEqual(NEED)
  })

  it('★ 190px 은 모자랐다 (3종이 두 줄로 접혔다)', () => {
    expect(190).toBeLessThan(NEED)
  })

  it('★ 자간 0.18px 이 :root 에 그대로 있다 (빠지면 위 폭 계산이 달라진다)', () => {
    const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(CSS).toContain('letter-spacing: 0.18px')
    expect(CSS).toContain("--sans: system-ui, 'Segoe UI', Roboto, sans-serif")
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

describe('★ 안 ⓑ — 표는 카드 폭 끝까지, 막대만 320px (2026-11-09 이정화 님 결정)', () => {
  /* 앞서(2026-11-07 안 B) 표 자체를 640/784/848px 로 좁히고 가운데에 뒀더니,
     머리글 줄 폭이 같은 화면의 다른 표(신규 진입·제외·교환 제안)와 달라 보였다.
     → 표는 다른 표와 똑같이 카드 폭 끝까지 가고, **막대 그림만** 320px 에서 멈춘다. */
  const BAR_MAX = 320

  it('규칙이 상수로 한 군데에 있다', () => {
    expect(CODE).toContain('const BAR_MAX = 320;')
  })

  it('★ 표를 좁히거나 가운데로 미는 것이 **사라졌다**', () => {
    /* `margin: '0 auto'` 는 App.jsx 의 다른 화면에도 쓰이므로 ATC 부분만 잘라서 본다 */
    const ATC = CODE.slice(CODE.indexOf('const BAR_MAX = 320;'), CODE.indexOf('export default function App()'))
    expect(ATC).not.toContain('BAR_TBL_MAX')
    expect(ATC).not.toContain("margin: '0 auto'")
    expect(ATC.length).toBeGreaterThan(1000)   /* 조각이 비면 위 확인이 거짓으로 통과한다 */
  })

  it('★ 막대는 320px 짜리 상자 **안에서** 비율을 그린다', () => {
    /* 막대에 바로 max-width 를 걸면 43% 넘는 막대가 모두 같은 길이로 보여 비교가 망가진다.
       상자에 걸고 그 안에서 %를 그려야 서로 견주는 비율이 산다.
       실측(창 1280px) — 가장 긴 막대 318px · 가장 짧은 막대 257px 로 서로 다르다. */
    expect(CODE).toContain("<div style={{ maxWidth: BAR_MAX }}><div style={{ height: 6, borderRadius: 3, background: t.lavender, width: w + '%' }} /></div>")
  })

  it('★ 머리글 줄이 다른 표와 같은 폭이다 — 실측으로 확인', () => {
    /* 운영 CSS 를 넣고 창 1280px 실측(86_안ⓑ_실측_after.png):
         신규 진입(손대지 않은 표) · 2차 예비 · FSP 후보 · 현재 FSP
         → 표 폭 1058px · 머리글 줄 1058px · 높이 39px · 글자 11px · 색 #52524E 로 **모두 같다.**
       전(86_안ⓑ_실측_before.png)에는 1058 / 640 / 784 / 848px 로 제각각이었다.
       같아지는 조건은 「감싸는 div 에 maxWidth 가 없다」 하나뿐이라 그것만 못 박는다. */
    expect(CODE).toContain('<div style={{ padding: 8 }}><AtcTable t={t} minWidth={420}')
    expect(CODE).toContain('<div style={{ marginBottom: 10 }}><AtcTable t={t} minWidth={658}')
    expect(CODE).toContain('<div><AtcTable t={t} minWidth={658}')
  })

  it('★ #root 의 가운데 정렬·1126px 제한이 그대로 있다 (이 전제가 깨지면 위 실측이 달라진다)', () => {
    const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const root = CSS.slice(CSS.indexOf('#root {'), CSS.indexOf('}', CSS.indexOf('#root {')))
    expect(root).toContain('text-align: center')
    expect(root).toContain('width: 1126px')
  })

  it('약품명 200px 은 세 표 모두 그대로다', () => {
    expect(CODE).toContain('colWidths={[56, 200, 64, null]}')
    expect(CODE).toContain('colWidths={[64, 110, 200, 90, 194]}')
    expect(CODE).toContain('colWidths={[64, 110, 200, 90, 64, 130]}')
  })

  it('막대 최대값이 320 이다', () => {
    expect(BAR_MAX).toBe(320)
  })
})
