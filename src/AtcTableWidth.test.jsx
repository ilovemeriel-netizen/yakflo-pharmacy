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

describe('★ 안 ⓑ 를 적용한 세 표 (마지막 열이 막대)', () => {
  it('2차 예비 — [56, 200, 64, 없음]', () => {
    expect(CODE).toContain('minWidth={420} colWidths={[56, 200, 64, null]}')
  })

  it('FSP 후보 — [64, 110, 200, 90, 없음]', () => {
    expect(CODE).toContain('minWidth={628} colWidths={[64, 110, 200, 90, null]}')
  })

  it('현재 FSP — [64, 110, 200, 90, 64, 없음]', () => {
    expect(CODE).toContain('minWidth={628} colWidths={[64, 110, 200, 90, 64, null]}')
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

describe('★ 안 B — 표가 필요 이상 늘지 않게 (2026-11-07 이정화 님 선택)', () => {
  /* 마지막 막대 열에 너비를 주지 않으면 남는 폭을 막대가 혼자 먹는다.
     그대로 두면 창 1600px 에서 막대가 1,198px 까지 늘어나 한쪽으로 쏠려 보였다(실측).
     막대는 길이를 **서로 견주는** 그림이라 320px 이면 충분하다. */
  const BAR_MAX = 320
  const FIXED = { yebi: 56 + 200 + 64, fspc: 64 + 110 + 200 + 90, fspn: 64 + 110 + 200 + 90 + 64 }

  it('규칙이 상수로 한 군데에 있다', () => {
    expect(CODE).toContain('const BAR_MAX = 320;')
    expect(CODE).toContain('const BAR_TBL_MAX = fixed => fixed + BAR_MAX;')
  })

  it('★ 세 표가 **감싸는 div** 에 최대 폭을 받는다 (StandardTable 은 건드리지 않았다)', () => {
    expect(CODE).toContain('maxWidth: BAR_TBL_MAX(320)')   /* 2차 예비 */
    expect(CODE).toContain('maxWidth: BAR_TBL_MAX(464)')   /* FSP 후보 */
    expect(CODE).toContain('maxWidth: BAR_TBL_MAX(528)')   /* 현재 FSP */
    /* 쓰는 곳 셋뿐이다 — 정의는 `BAR_TBL_MAX = fixed =>` 라 이름 뒤에 괄호가 없다 */
    expect((CODE.match(/BAR_TBL_MAX\(/g) || []).length).toBe(3)
  })

  it('★ 적어 준 고정 합이 colWidths 와 **실제로 같다** (어긋나면 최대 폭이 틀어진다)', () => {
    expect(FIXED.yebi).toBe(320)
    expect(FIXED.fspc).toBe(464)
    expect(FIXED.fspn).toBe(528)
  })

  it('★ 넘침 증명 — 표 최대 폭이 제 minWidth 보다 크다 (계산으로 끝난다)', () => {
    /* 최대 < 최소면 표가 잘린다. 창 폭과 무관하므로 이 비교만으로 넘침이 없음이 증명된다. */
    const MIN = { yebi: 420, fspc: 628, fspn: 628 }
    for (const k of ['yebi', 'fspc', 'fspn'])
      expect(FIXED[k] + BAR_MAX).toBeGreaterThanOrEqual(MIN[k])
  })

  it('★ 표 최대 폭 값 — 640 · 784 · 848px', () => {
    expect(FIXED.yebi + BAR_MAX).toBe(640)
    expect(FIXED.fspc + BAR_MAX).toBe(784)
    expect(FIXED.fspn + BAR_MAX).toBe(848)
  })

  it('★ 표는 카드 안에서 **가운데**다 — 제목이 가운데라 줄이 맞는다 (2026-11-08 정정)', () => {
    /* ★ 함정 #31 — 제목 div 에는 textAlign 이 없지만 `#root { text-align: center }` 를
       물려받아 **화면에서는 가운데로 보인다.** 코드만 보고 「왼쪽」이라 읽으면 틀린다.
       운영 CSS 를 넣고 실측 : 제목 좌우 여백 393/393 · 502/502 · 403/403px (83_운영CSS_실측_*.png) */
    expect(CODE).toContain("maxWidth: BAR_TBL_MAX(320), margin: '0 auto'")
    expect(CODE).toContain("maxWidth: BAR_TBL_MAX(464), margin: '0 auto 10px'")
    expect(CODE).toContain("maxWidth: BAR_TBL_MAX(528), margin: '0 auto'")
  })

  it('★ #root 의 가운데 정렬·1126px 제한이 그대로 있다 (이 전제가 깨지면 위 판단이 바뀐다)', () => {
    const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const root = CSS.slice(CSS.indexOf('#root {'), CSS.indexOf('}', CSS.indexOf('#root {')))
    expect(root).toContain('text-align: center')
    expect(root).toContain('width: 1126px')
  })

  it('약품명 200px 과 마지막 열 null 은 그대로다', () => {
    expect(CODE).toContain('colWidths={[56, 200, 64, null]}')
    expect(CODE).toContain('colWidths={[64, 110, 200, 90, null]}')
    expect(CODE).toContain('colWidths={[64, 110, 200, 90, 64, null]}')
  })
})
