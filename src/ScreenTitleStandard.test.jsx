/* 화면 제목 표준 (2026-11-14 이정화 님 승인 · PR B)
 *
 *   제목 — 크기 16 · 굵기 700 · 색 `t.accent`
 *   부제 — 크기 12 · 굵기 400 · 색 `t.textM`
 *
 * 이 꼴을 이미 쓰던 6화면(발주 관리 · 약품변경 관리 · 병동신청 · 실사 · 사용 점검 ·
 * ATC 카세트 배치)이 사실상 표준이었다. 어긋나 있던 **9화면**을 맞춘다.
 *
 * ★ 색은 **새로 만들지 않았다** — 밝은 화면에서 `t.accent` 와 `t.purple` 은 둘 다 `#804A87`,
 *   어두운 화면에서는 둘 다 `#BFA6D9` 로 **같은 값**이다. 그래서 보이는 변화가 없다.
 *   다만 비상조제가 쓰던 `PURPLE` 은 **고정 상수**(#804A87)라 어두운 화면에서 안 바뀌었다 —
 *   `t.accent` 로 바꾸면 **어두운 화면에서 제대로 밝아진다**(고쳐지는 쪽).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const VAC = readFileSync(root('src/VaccineManage.jsx'), 'utf8')
const EMG = readFileSync(root('src/EmergencyDispense.jsx'), 'utf8')
const UCM = readFileSync(root('src/UsageCompareModal.jsx'), 'utf8')

/* 제목 한 줄에서 크기·굵기·색을 뽑는다 */
function titleOf(src, text) {
  /* ★ 같은 글자가 메뉴 칸·안내 글에도 있다 — **크기가 적힌 태그**를 만날 때까지 찾는다 */
  let from = 0
  for (;;) {
    const i = src.indexOf('>' + text, from)
    if (i < 0) return null
    from = i + 1
    const open = src.lastIndexOf('<', i)
    if (open < 0) continue
    const tag = src.slice(open, i + 1)
    const size = (tag.match(/fontSize:\s*(\d+)/) || [])[1]
    if (!size) continue
    const weight = (tag.match(/fontWeight:\s*(\d+)/) || [])[1]
    const color = (tag.match(/color:\s*([A-Za-z.]+)/) || [])[1]
    return { size, weight, color }
  }
}
const STD = { size: '16', weight: '700', color: 't.accent' }

/* ══ ① 색이 정말 같은가 ══════════════════════════════════════════ */
describe('★★ ① 색 — accent 와 purple 은 같은 값이다', () => {
  it('★ 밝은 화면 — accent 와 purple 이 같다', () => {
    const i = APP.indexOf('light: {')
    const seg = APP.slice(i, i + 900)
    const accent = (seg.match(/accent:\s*'(#[0-9A-Fa-f]+)'/) || [])[1]
    const purple = (seg.match(/purple:\s*'(#[0-9A-Fa-f]+)'/) || [])[1]
    expect(accent).toBe('#804A87')
    expect(purple, 'purple 이 accent 와 달라지면 이 PR 의 전제가 깨진다').toBe(accent)
  })

  it('★ 어두운 화면 — accent 와 purple 이 같다', () => {
    const i = APP.indexOf('dark: {')
    const seg = APP.slice(i, i + 900)
    const accent = (seg.match(/accent:\s*'(#[0-9A-Fa-f]+)'/) || [])[1]
    const purple = (seg.match(/purple:\s*'(#[0-9A-Fa-f]+)'/) || [])[1]
    expect(accent).toBe('#BFA6D9')
    expect(purple).toBe(accent)
  })

  it('★★ 비상조제가 쓰던 PURPLE 은 **고정 상수**였다 — 더는 제목에 쓰지 않는다', () => {
    expect(EMG, '상수 자체는 다른 데서 쓰므로 남는다').toContain(`const PURPLE = '#804A87'`)
    expect(EMG.includes(`color: PURPLE }}>비상조제`), '제목에 고정 상수를 쓰면 어두운 화면에서 안 바뀐다').toBe(false)
  })
})

/* ══ ② 어긋났던 9화면이 표준이 되었다 ═══════════════════════════ */
describe('★★ ② 어긋났던 9화면', () => {
  const CASES = [
    ['🔔 통합 알림센터', () => titleOf(APP, '🔔 통합 알림센터')],
    ['향정·마약류 관리', () => titleOf(APP, '향정·마약류 관리')],
    ['마이페이지', () => titleOf(APP, '마이페이지')],
    ['보관위치', () => titleOf(APP, '보관위치')],
    ['가입자 관리', () => titleOf(APP, '가입자 관리')],
    ['🗓️ 일정', () => titleOf(APP, '🗓️ 일정')],
    ['백신관리', () => titleOf(VAC, '백신관리')],
    ['비상조제', () => titleOf(EMG, '비상조제')],
    ['기준확인', () => titleOf(UCM, "기준확인{' '}")],
  ]
  for (const [name, get] of CASES) {
    it(`★ ${name} — 16 · 700 · t.accent`, () => {
      const got = get()
      expect(got, name + ' 제목을 못 찾았다').toBeTruthy()
      expect(got, name).toEqual(STD)
    })
  }
})

/* ══ ③ 이미 표준이던 6화면은 안 건드렸다 ════════════════════════ */
describe('★★ ③ 이미 표준이던 화면은 그대로다', () => {
  const STD_RE = name => new RegExp('fontSize: ?16, ?fontWeight: ?700, ?color: ?t[.]accent[^>]{0,60}}}>' + name)
  for (const name of ['발주 관리', '약품변경 관리', '병동신청', '실사', '사용 점검', 'ATC 카세트 배치']) {
    it(name + ' — 그대로', () => {
      /* ★ 같은 글자가 작은 뱃지·안내에도 있다 — **표준 꼴 그대로**가 있는지 본다 */
      expect(STD_RE(name).test(APP), name + ' 제목이 표준 꼴이 아니다').toBe(true)
    })
  }
})

/* ══ ④ 부제 꼴 ═════════════════════════════════════════════════ */
describe('★ ④ 부제 — 12 · 400 · t.textM', () => {
  it('★ 기준확인에 부제가 갈라져 있다', () => {
    expect(UCM).toContain(`<span style={{ fontSize: 12, fontWeight: 400, color: t.textM }}>· 마감된 달 기준</span>`)
    expect(UCM.includes(`'기준확인' : '사용량 비교'} — 마감된 달 기준`), '옛 한 덩어리 꼴이 남아 있다').toBe(false)
  })

  it('이미 쓰던 화면들의 부제 꼴과 같다', () => {
    const n = (APP.match(/fontSize: 12, fontWeight: 400, color: t\.textM/g) || []).length
    expect(n, '부제 꼴을 쓰는 화면이 여럿 있어야 한다').toBeGreaterThanOrEqual(4)
  })
})

/* ══ ⑤ 새 색이 안 생겼다 ═══════════════════════════════════════ */
describe('★ ⑤ 새 색 없음', () => {
  it('고친 제목 줄에 hex 색이 없다', () => {
    const bad = []
    for (const [f, src] of [['App.jsx', APP], ['VaccineManage.jsx', VAC], ['EmergencyDispense.jsx', EMG], ['UsageCompareModal.jsx', UCM]]) {
      for (const line of src.split(/\r?\n/)) {
        if (/fontSize: ?16, ?fontWeight: ?700/.test(line) && /#[0-9a-fA-F]{3,8}\b/.test(line)) bad.push(f + ': ' + line.trim().slice(0, 80))
      }
    }
    expect(bad, '제목에 새 색을 쓰지 말 것\n' + bad.join('\n')).toEqual([])
  })
})
