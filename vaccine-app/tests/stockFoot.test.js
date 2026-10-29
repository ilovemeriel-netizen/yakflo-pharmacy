/* 잔량 탭 하단 정보 영역 — 사용자 확정본(2026-10-30).

   ★ 이 앱의 화면 시험은 소스 대조로 한다(pwScreen.test.js 와 같은 방식) —
     루트와 vaccine-app 에 React 사본이 둘이라 공용 설정으로는 렌더할 수 없다.
     배치 자체는 **실제 App 을 렌더한 캡처**로 따로 확인했다(바탕 화면/잔량하단_시안).

   ★ 고정하는 것
     ① 마지막 입력이 **전체 잔량 카드 안**에 있고 하단에는 없다
     ② 하단에는 **문의만** 남았고, 절기 중복이 사라졌다
     ③ 문의는 **잔량 탭에만** 있다 — 공용 저작권 줄(Ft)은 손대지 않았다
     ④ 저작권 문구는 한 글자도 바뀌지 않았다
     ⑤ 띠는 기존 토큰 색만 쓴다 — 새 hex 가 늘지 않았다 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* ★ 저장소는 CRLF 로 체크아웃된다(.gitattributes eol=crlf) — 줄바꿈을 먼저 맞춰야
   줄 단위 대조가 플랫폼을 타지 않는다. */
const rd = p => readFileSync(resolve(process.cwd(), p), 'utf8').split('\r\n').join('\n')
const APP = rd('vaccine-app/src/App.jsx')

/* 화면 조각을 이름으로 잘라 본다 — 「어느 자리에 있나」를 보기 위해서다 */
const slice = (from, to) => {
  const a = APP.indexOf(from)
  expect(a, '조각을 찾지 못했다: ' + from).toBeGreaterThan(-1)
  const b = APP.indexOf(to, a)
  return APP.slice(a, b > -1 ? b : undefined)
}
const totalBox = () => slice('const totalBox =', 'const cards =')
const foot = () => slice('const foot =', '/* 안내 상자')

describe('① 마지막 입력 — 전체 잔량 카드 안으로', () => {
  it('★ 카드 안에 「마지막 입력」이 있다', () => {
    expect(totalBox()).toContain('마지막 입력')
  })
  it('★ 「N종」 아래에 구분선과 함께 온다', () => {
    const t = totalBox()
    expect(t.indexOf('종\n'), '종 표시를 찾지 못했다').toBeGreaterThan(-1)
    expect(t.indexOf('마지막 입력')).toBeGreaterThan(t.indexOf('</span>종'))
    expect(t).toContain("borderTop: '1px solid var(--v-line)'")
  })
  it('★ 시각 숫자는 .num 이다 — tabular-nums 가 붙는다', () => {
    expect(totalBox()).toContain('<span className="num">{when}</span>')
    expect(rd('vaccine-app/src/index.css')).toContain('font-variant-numeric: tabular-nums')
  })
  it('★ 입력 기록이 없으면 그 자리에 그렇게 적는다', () => {
    expect(totalBox()).toContain('입력 기록이 없습니다')
  })
  it('★ 하단에는 더 이상 없다', () => {
    expect(foot().includes('마지막 입력'), '하단에 옛 줄이 남아 있다').toBe(false)
  })
})

describe('② 하단 — 문의만, 절기 중복 삭제', () => {
  it('★ 문의 줄이 있다', () => {
    expect(foot()).toContain('문의 ')
    expect(foot()).toContain('{TEL}')
  })
  it('★ 절기가 하단에서 사라졌다 — 머리말에 이미 있다', () => {
    expect(foot().includes('절기'), '하단에 절기가 남아 있다').toBe(false)
    expect(foot().includes('data?.season'), '하단이 아직 season 을 읽는다').toBe(false)
    /* 머리말 쪽에는 그대로 있어야 한다 */
    expect(APP).toContain('seasonLabel(data?.season || survey?.season)')
  })
  it('★ 13px · --v-ink-dim · 가운데 정렬(PC 도)', () => {
    const f = foot()
    expect(f).toContain('fontSize: 13')
    expect(f).toContain("color: 'var(--v-ink-dim)'")
    expect(f).toContain("textAlign: 'center'")
    expect(f.includes("wide ? 'left'"), 'PC 만 왼쪽 정렬이 남아 있다').toBe(false)
  })
})

describe('③ 문의는 잔량 탭에만 · 공용 저작권 줄은 그대로', () => {
  it('★ 수요조사 탭 분기에는 foot 이 없다', () => {
    /* 끝 표식은 **들여쓰기 2칸**의 return — 분기 안쪽 return 은 4칸이라 걸리지 않는다 */
    const sv = slice("if (tab === 'survey' && survey) {", '\n  return <main style=')
    expect(sv).toContain('<SurveyTab')
    expect(sv).toContain('<Ft />')
    expect(sv.includes('{foot}'), '수요조사 탭에 문의가 생겼다').toBe(false)
  })
  it('★ 잔량 탭에서는 문의가 저작권 바로 위에 온다', () => {
    expect(APP).toContain('{foot}\n    <Ft />')
  })
  it('★ 공용 Ft 안에는 문의를 넣지 않았다', () => {
    const ft = slice('function Ft() {', '/* ═══ 안내 띠')
    expect(ft.includes('TEL'), '공용 저작권 줄에 문의가 들어갔다').toBe(false)
  })
})

describe('④ 저작권 — 한 글자도 바꾸지 않았다', () => {
  it('★ 문구 그대로', () => {
    expect(APP).toContain('Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.')
  })
  it('★ 모양도 그대로 (11px · --v-ink-dim · 가운데 · no-print)', () => {
    const ft = slice('function Ft() {', '/* ═══ 안내 띠')
    expect(ft).toContain('className="no-print"')
    expect(ft).toContain("margin: '10px 16px 26px', fontSize: 11, color: 'var(--v-ink-dim)'")
    expect(ft).toContain("textAlign: 'center'")
  })
})

describe('⑤ 오래됨 띠', () => {
  const notice = () => slice('function Notice(', '/* ═══ 시안 ⓐ-2')

  it('★ 라벤더 45% 바탕 + --v-navy 글자 + 라벤더 왼쪽 막대', () => {
    const n = notice()
    expect(n).toContain("background: 'rgba(191, 166, 217, 0.45)'")
    expect(n).toContain("borderLeft: '3px solid var(--v-lav)'")
    expect(n).toContain("color: 'var(--v-navy)'")
  })
  it('★ role 은 status — 오류가 아니다', () => {
    expect(notice()).toContain('role="status"')
  })
  it('★ 카드 격자 위에 온다 (휴대폰은 전체 잔량 띠 위)', () => {
    /* 배치 블록보다 먼저 그려진다 */
    const main = slice('    {alert}', '    {foot}')
    expect(main.indexOf('{stale}')).toBeGreaterThan(-1)
    expect(main.indexOf('{stale}')).toBeLessThan(main.indexOf("state === 'empty'"))
  })
  it('★ 「지금」은 서버 시각이다 — 기기 시계를 쓰지 않는다', () => {
    expect(APP).toContain('isStale(data?.updated_at, serverNow())')
    expect(APP).toContain("noteServerDate(r.headers?.get?.('date'))")
    /* 잔량 조회와 로그인 두 경로 모두에서 잡는다 (import 줄은 괄호가 없어 안 세인다) */
    expect((APP.match(/noteServerDate\(/g) || []).length, '잔량 조회와 로그인 두 곳').toBe(2)
  })
  it('★ 입력 기록이 없으면 띠를 띄우지 않는다', () => {
    expect(APP).toContain('const stale = when && isStale(')
  })
  it('★ 문구는 lib/stale.js 한 곳에서 온다 — 화면에 직접 적지 않는다', () => {
    expect(APP).toContain('{STALE_HEAD}<span className="num">{when}</span>{STALE_TAIL}')
    expect(APP.includes('기준입니다'), '문구를 화면에 직접 적었다').toBe(false)
  })
})

describe('새 색을 만들지 않았다', () => {
  it('★ App.jsx 의 hex 리터럴은 흰색뿐이다', () => {
    const hex = [...new Set((APP.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    for (const h of hex) expect(['#FFFFFF'], '허용 밖 색: ' + h).toContain(h)
  })
  it('★ 라벤더 45% 는 이미 쓰던 값이다 — 「주의」 배지와 같다', () => {
    expect((APP.match(/rgba\(191, 166, 217, 0\.45\)/g) || []).length).toBe(2)
  })
  it('★ 공개 앱에 금지 문자열이 들어오지 않았다', () => {
    for (const bad of ['supabase', 'eyJ', 'createClient', 'scrypt', 'service_role']) {
      expect(APP.includes(bad), '금지 문자열: ' + bad).toBe(false)
    }
  })
})
