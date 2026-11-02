/* @vitest-environment node */
/* 창 시인성 — 보관위치 창(LocDrugsModal)·약품 360 창(Drug360Modal). 2026-11-02.

   ★ 막으려는 결함 (실측)
     · 창 머리가 메인 머리와 **같은 t.nav** 라 둘이 이어져 보였다 — 대비비 **1.00:1**
     · 뒤가 어두워지지 않아(딤 없음) 어느 쪽이 앞인지 알 수 없었다
     · X 단추에 테두리가 없어 바탕 대비 **1.52:1** (WCAG 1.4.11 비텍스트 3:1 **미달**)
     · 창이 40px 에서 시작해 54px 짜리 메인 머리와 **14px 겹쳤다**

   ★ 그대로 두는 것 — pointerEvents:'none'
     f0869ec4(2026-07-19)가 **일부러** 넣은 모덜리스 설계다
     (「백드롭 클릭 닫기 제거 → 모달을 옆으로 치워두고 뒤 작업 가능」).
     딤을 넣어도 클릭은 뒤로 통과한다. 바꾸려면 따로 승인을 받아야 한다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

/* 두 창의 바깥 틀 줄을 통째로 집는다 — zIndex:1000 + pointerEvents:'none' 이 표식이다 */
const overlays = APP.split('\n').filter(l =>
  /position: 'fixed', inset: 0/.test(l) && /zIndex: 1000/.test(l) && /pointerEvents: 'none'/.test(l))
/* 그 바로 다음 줄이 창 상자 */
const lines = APP.split('\n')
const boxes = lines.filter((l, i) => i > 0 && overlays.includes(lines[i - 1]))

describe('① 두 창이 모두 고쳐졌다', () => {
  it('바깥 틀이 2개 잡힌다 (보관위치 창 · 약품 360 창)', () => {
    expect(overlays.length, '두 창을 못 찾음').toBe(2)
    expect(boxes.length).toBe(2)
  })
})

/* ═══ ② 딤은 **일부러 넣지 않는다** (2026-11-02 이정화 님 결정) ═══
   이 두 창은 클릭이 뒤로 통과하는 모덜리스 설계다. 딤을 씌우면
   「막힌 것처럼 보이는데 뒤의 삭제 단추가 실제로 눌리는」 오조작 위험이 생긴다.
   떠 있는 느낌은 **테두리 + 진한 그림자**로만 낸다. */
describe('② 딤을 넣지 않는다 — 오조작 위험', () => {
  it('★ 두 창의 바깥 틀은 투명하다', () => {
    for (const o of overlays) expect(o).toContain("background: 'transparent'")
  })
  it('★ 딤이 몰래 다시 들어오지 않았다', () => {
    for (const o of overlays) expect(o).not.toMatch(/background: 'rgba\(0,\s*0,\s*0/)
  })
  /* 다른 창들은 딤을 쓴다 — 그쪽 값이 흐트러지지 않았는지도 함께 본다.
     ★ 딤만 본다. 그림자(boxShadow)에도 rgba(0,0,0,…) 가 있어 파일 전체를 훑으면
       엉뚱한 것을 잡는다(처음에 그렇게 걸렸다). */
  it('다른 창들의 딤 값은 그대로 — 0.4·0.45·0.5 만 쓴다', () => {
    const dims = APP.split('\n')
      .filter(l => /position: ?'fixed', ?inset: ?0/.test(l))
      .flatMap(l => [...l.matchAll(/background: ?'rgba\(0, ?0, ?0, ?([\d.]+)\)'/g)].map(m => m[1]))
    expect(dims.length, '딤을 하나도 못 찾음').toBeGreaterThan(10)
    for (const v of new Set(dims)) expect(['0.4', '0.45', '0.5'], '새 딤 값 ' + v).toContain(v)
  })
})

describe('②-2 떠 있는 느낌은 그림자로 — 새 값 금지', () => {
  it('★ 두 창이 기존 값 중 가장 진한 그림자를 쓴다', () => {
    for (const b of boxes) expect(b).toContain("boxShadow: '0 20px 60px rgba(0,0,0,0.3)'")
  })
  it('★ 그 값은 **원래 있던** 값이다 — 로그인 카드도 같은 값을 쓴다', () => {
    const n = (APP.match(/boxShadow: '0 20px 60px rgba\(0,0,0,0\.3\)'/g) || []).length
    expect(n, '두 창 + 원래 쓰던 곳').toBeGreaterThanOrEqual(4)
  })
  it('옅은 t.shadowH 로 되돌아가지 않았다', () => {
    for (const b of boxes) expect(b).not.toContain('boxShadow: t.shadowH')
  })
})

describe('③ 메인 머리와 겹치지 않는다', () => {
  it('★ 위 여백이 72px 다 (메인 머리 54px 보다 아래)', () => {
    for (const o of overlays) expect(o).toContain("padding: '72px 16px 40px'")
  })
  it('옛 40px 로 되돌아가지 않았다', () => {
    for (const o of overlays) expect(o).not.toContain("padding: '40px 16px'")
  })
  it('메인 머리 높이는 그대로 54px — 이 값이 바뀌면 72px 도 다시 봐야 한다', () => {
    expect(APP).toMatch(/cnc-header"[^>]*height: 54/)
  })
})

describe('④ 창 바깥 테두리', () => {
  /* ★ t.border 가 아니라 **t.borderH** 다 — 딤을 뺀 뒤 라이트에서 t.border(#E8E6E1)가
     바깥 바탕(#F7F6F3)과 1.15:1 밖에 안 돼 사실상 안 보였다(2026-11-02 실측).
     t.borderH 는 기존 토큰이다(라이트 #D7D7D7 · 다크 #3A4A5A) — 새 색이 아니다.
     바꾼 뒤: 라이트 1.15 → 1.33:1 · 다크 1.45 → 1.96:1. */
  it('★ 두 창 모두 t.borderH 로 1px 테두리를 두른다', () => {
    for (const b of boxes) expect(b).toContain('border: `1px solid ${t.borderH}`')
  })
  it('옅은 t.border 로 되돌아가지 않았다', () => {
    for (const b of boxes) expect(b).not.toContain('border: `1px solid ${t.border}`')
  })
  it('창 바탕·둥근 모서리는 그대로 (그림자는 ②-2 에서 따로 본다)', () => {
    for (const b of boxes) {
      expect(b).toContain('background: t.card')
      expect(b).toContain('borderRadius: 16')
    }
  })
})

describe('⑤ X 단추 경계 — WCAG 1.4.11 (3:1)', () => {
  const xs = [...APP.matchAll(/onClick=\{onClose\} style=\{\{([^}]*width: 28, height: 28[^}]*)\}/g)].map(m => m[1])
  it('X 단추가 2개 잡힌다', () => expect(xs.length).toBe(2))
  it('★ 흰 테두리 1px 이 있다 (전엔 border: none 이라 1.52:1 이었다)', () => {
    for (const x of xs) {
      expect(x).toContain("border: '1px solid rgba(255,255,255,0.55)'")
      expect(x).not.toContain("border: 'none'")
    }
  })
  it('바탕을 0.15 → 0.22 로 올렸다', () => {
    for (const x of xs) expect(x).toContain("background: 'rgba(255,255,255,0.22)'")
  })
  it('새 색을 쓰지 않았다 — 흰색 투명도만', () => {
    for (const x of xs) {
      expect(x).toContain("color: '#fff'")
      expect(x).not.toMatch(/#(?!fff\b)[0-9a-fA-F]{3,6}/)
    }
  })
})

describe('⑥ ★ 모덜리스 설계는 건드리지 않았다 (f0869ec4 의 의도)', () => {
  it('★ 오버레이가 클릭을 그대로 뒤로 흘린다 — pointerEvents:none 유지', () => {
    for (const o of overlays) expect(o).toContain("pointerEvents: 'none'")
  })
  it('★ 창 상자만 클릭을 받는다 — pointerEvents:auto 유지', () => {
    for (const b of boxes) expect(b).toContain("pointerEvents: 'auto'")
  })
  it('바깥 클릭으로 닫는 코드를 넣지 않았다', () => {
    for (const o of overlays) expect(o).not.toMatch(/onClick/)
  })
  it('왜 그대로 두는지 코드에 적어 두었다 — 다음 사람이 모르고 바꾸지 않게', () => {
    expect(APP).toContain('모덜리스')
    expect(APP).toContain('f0869ec4')
  })
})

describe('⑦ 닫기 동작은 그대로', () => {
  it('Esc 로 닫는다 — 편집 중이면 편집만 취소한다', () => {
    expect(APP).toMatch(/if \(e\.key !== 'Escape'\) return; if \(editing\) \{ setEditId\(null\); return \} onClose\(\)/)
  })
  it('X 단추 닫기가 두 창 모두 살아 있다', () => {
    expect((APP.match(/onClick=\{onClose\} style=\{\{[^}]*width: 28, height: 28/g) || []).length).toBe(2)
  })
})
