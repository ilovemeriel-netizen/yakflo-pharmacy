/* ATC 배치 목록 — 성분명 한 줄 「영문 (한글)」 (2026-11-07 이정화 님 지시).
 *
 * 못 박는 것
 *  ① 표 칸이 **한 줄**이고 모양이 「영문 (한글)」이다 — **괄호 앞에 빈칸 하나**
 *  ② 화면 표와 인쇄 표가 **같은 함수 하나**(ingOne)를 쓴다
 *  ③ 복합제는 「첫 성분 영문 (첫 성분 한글) 외 N종」, N 은 **영문 기준 한 번만**
 *  ④ 정렬·필터 키가 **영문**이다(ing_en)
 *  ⑤ 엑셀은 성분명(영문)·성분명(한글) **두 칸**이고, 줄이지 않은 **원본**이다
 *
 * `ingOne` 은 `AtcView` 안에 있어 따로 불러올 수 없다 — 소스를 읽어 확인하고,
 * 셈 규칙은 같은 식을 여기서 다시 만들어 값으로 확인한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
/* ATC 화면 전체 — 구역별 인쇄(복제본)와 섞이지 않게 잘라 본다.
   `_chip` 은 AtcView 맨 앞, `export default function App()` 은 AtcView 바로 뒤다. */
const ATC = CODE.slice(CODE.indexOf('const _chip = k => cautionChipColors'), CODE.indexOf('export default function App()'))

/* 화면 코드와 **같은 식** — 바뀌면 아래 시험이 먼저 깨진다 */
const ingParts = s => String(s || '').split('/').map(x => x.trim()).filter(Boolean)
const ingCount = d => (ingParts(d && d.ingredient_en).length || ingParts(d && d.ingredient_kr).length)
const ingShort = (s, cnt) => { const p = ingParts(s); if (!p.length) return ''; return cnt > 1 ? p[0] + ' 외 ' + (cnt - 1) + '종' : p[0] }
const ingOne = d => { const cnt = ingCount(d); const fe = ingParts(d && d.ingredient_en)[0] || ''; const fk = ingParts(d && d.ingredient_kr)[0] || ''; const first = fe && fk ? fe + ' (' + fk + ')' : (fe || fk); return cnt > 1 ? first + ' 외 ' + (cnt - 1) + '종' : first }

describe('★ 한 줄 「영문 (한글)」', () => {
  it('★ 괄호 앞에 빈칸이 하나 있다 (지시 예시 그대로)', () => {
    expect(ingOne({ ingredient_en: 'Tiropramide HCl', ingredient_kr: '티로프라미드염산염' }))
      .toBe('Tiropramide HCl (티로프라미드염산염)')
  })

  it('★ 빈칸 없는 옛 모양이 아니다', () => {
    expect(ingOne({ ingredient_en: 'Gabapentin', ingredient_kr: '가바펜틴' })).not.toBe('Gabapentin(가바펜틴)')
    expect(ingOne({ ingredient_en: 'Gabapentin', ingredient_kr: '가바펜틴' })).toBe('Gabapentin (가바펜틴)')
  })

  it('★ 복합제는 「첫 성분 영문 (첫 성분 한글) 외 N종」', () => {
    expect(ingOne({ ingredient_en: 'Naproxen/Esomeprazole', ingredient_kr: '나프록센/에스오메프라졸' }))
      .toBe('Naproxen (나프록센) 외 1종')
  })

  it('★ N 은 영문 기준 한 번만 센다 (한글 개수가 달라도 숫자가 흔들리지 않는다)', () => {
    expect(ingOne({ ingredient_en: 'A/B', ingredient_kr: '가/나/다' })).toBe('A (가) 외 1종')
  })

  it('한쪽이 비면 괄호를 쓰지 않는다', () => {
    expect(ingOne({ ingredient_en: 'Gabapentin', ingredient_kr: '' })).toBe('Gabapentin')
    expect(ingOne({ ingredient_en: '', ingredient_kr: '가바펜틴' })).toBe('가바펜틴')
  })

  it('둘 다 비면 빈 문자열이다 (화면에서는 「-」로 보인다)', () => {
    expect(ingOne({ ingredient_en: '', ingredient_kr: '' })).toBe('')
  })

  it('영문만 비고 한글이 여럿이면 한글 개수로 센다', () => {
    expect(ingOne({ ingredient_en: '', ingredient_kr: '가/나/다' })).toBe('가 외 2종')
  })
})

describe('★ 줄임 규칙', () => {
  it('성분이 하나면 그대로 둔다', () => {
    const d = { ingredient_en: 'Gabapentin', ingredient_kr: '가바펜틴' }
    expect(ingShort(d.ingredient_en, ingCount(d))).toBe('Gabapentin')
    expect(ingShort(d.ingredient_kr, ingCount(d))).toBe('가바펜틴')
  })

  it('★ 복합제는 영문·한글 **같은 규칙**으로 줄인다', () => {
    const d = { ingredient_en: 'Naproxen/Esomeprazole', ingredient_kr: '나프록센/에스오메프라졸' }
    expect(ingShort(d.ingredient_en, ingCount(d))).toBe('Naproxen 외 1종')
    expect(ingShort(d.ingredient_kr, ingCount(d))).toBe('나프록센 외 1종')
  })

  it('★ N 은 영문 기준 한 번만 센다 — 한글 개수가 달라도 두 줄이 어긋나지 않는다', () => {
    /* 한글만 구분자가 더 있는 실제 사례를 흉내 낸다 */
    const d = { ingredient_en: 'A/B', ingredient_kr: '가/나/다' }
    const n = ingCount(d)
    expect(n).toBe(2)
    expect(ingShort(d.ingredient_en, n)).toBe('A 외 1종')
    expect(ingShort(d.ingredient_kr, n)).toBe('가 외 1종')   /* 「외 2종」이 되면 안 된다 */
  })

  it('★ 영문이 비면 한글 개수로 센다', () => {
    const d = { ingredient_en: '', ingredient_kr: '가/나/다' }
    expect(ingCount(d)).toBe(3)
    expect(ingShort(d.ingredient_kr, ingCount(d))).toBe('가 외 2종')
    expect(ingShort(d.ingredient_en, ingCount(d))).toBe('')
  })

  it('둘 다 비면 빈 문자열이다 (화면에서는 「-」로 보인다)', () => {
    const d = { ingredient_en: '', ingredient_kr: '' }
    expect(ingCount(d)).toBe(0)
    expect(ingShort(d.ingredient_en, ingCount(d))).toBe('')
  })

  it('빈 조각·앞뒤 공백을 버린다', () => {
    expect(ingParts(' A / / B ')).toEqual(['A', 'B'])
  })
})

describe('★ 화면 코드가 그 식을 그대로 쓴다', () => {
  it('세 함수가 있다', () => {
    expect(CODE).toContain('const ingParts = s =>')
    expect(CODE).toContain('const ingCount = d =>')
    expect(CODE).toContain('const ingShort = (s, cnt) =>')
  })

  it('★ 한 줄 함수 ingOne 이 있고, 괄호 앞 빈칸이 코드에도 그대로 있다', () => {
    expect(CODE).toContain('const ingOne = d =>')
    expect(ATC).toContain("fe + ' (' + fk + ')'")
    expect(ATC).not.toContain("fe + '(' + fk + ')'")   /* ATC 안에 빈칸 없는 옛 모양이 남으면 안 된다 */
  })

  it('★ 인쇄 표도 **같은 함수**를 쓴다 (따로 구현하지 않는다)', () => {
    expect(CODE).toContain('const printIng = ingOne;')
  })

  it('★ 줄 하나(mkRow)가 한 줄 값과 영문 정렬키를 같이 담는다', () => {
    expect(CODE).toContain('ing_one: ingOne(d), ing_en: ingShort(d.ingredient_en, ingCount(d))')
    expect(CODE).not.toContain('ing_kr: ingShort')   /* 두 줄 시절의 한글 칸은 사라졌다 */
  })

  it('★ 정렬·필터 키가 영문이다', () => {
    expect(CODE).toContain("{ k: 'ing_en', h: '성분명' }")
    expect(CODE).not.toContain("{ k: 'ingredient_kr', h: '성분명' }")
  })

  it('★ 표 칸이 한 줄이다 — 칸 안에 줄을 나누는 div 가 없다', () => {
    const i = CODE.indexOf('{e.ing_one')
    expect(i).toBeGreaterThan(-1)
    const cell = CODE.slice(CODE.lastIndexOf('<td', i), CODE.indexOf('</td>', i) + 5)
    expect(cell).not.toContain('<div')        /* 두 줄 시절에는 div 가 둘 있었다 */
    expect(cell).not.toContain('ing_kr')
    expect(CODE).not.toContain('{e.ing_kr')
  })

  it('긴 이름은 한 줄 말줄임한다 (칸이 넓어지지 않게)', () => {
    const i = CODE.indexOf('{e.ing_one')
    const cell = CODE.slice(i - 420, i + 40)
    expect(cell).toContain("textOverflow: 'ellipsis'")
    expect(cell).toContain("whiteSpace: 'nowrap'")
  })

  it('마우스를 올리면 **줄이지 않은 원본**이 뜬다', () => {
    /* 줄바꿈 문자를 시험 글에 직접 적으면 셸·편집기가 먹어 버린다 — 조각으로 확인한다 */
    expect(CODE).toContain('title={[d.ingredient_en, d.ingredient_kr].filter(Boolean).join(')
    expect(CODE).not.toContain('title={[e.ing_en, e.ing_kr]')   /* 줄인 값이 아니라 원본이어야 한다 */
  })
})

describe('★ 엑셀 — 성분명 두 칸', () => {
  it('★ 성분명(영문) · 성분명(한글) 두 칸이다', () => {
    expect(CODE).toContain("'성분명(영문)': d.ingredient_en || '', '성분명(한글)': d.ingredient_kr || ''")
  })

  it('★ 엑셀은 **줄이지 않은 원본**이다 (줄이면 뒤 성분이 사라진다)', () => {
    const xl = CODE.slice(CODE.indexOf('XLSX.utils.json_to_sheet(src.map'), CODE.indexOf('XLSX.utils.json_to_sheet(src.map') + 600)
    expect(xl).not.toContain('ingShort')
    expect(xl).not.toContain('ing_en')
  })

  it('옛 한 칸짜리 「성분명」은 사라졌다', () => {
    expect(CODE).not.toContain("성분명: d.ingredient_kr || ''")
  })

  it('다른 칸은 그대로다', () => {
    for (const k of ['슬롯: slot', '약품코드: d.drug_code', '약품명: d.drug_name', '유사: d.lasa_type', '차광: isShade(d)'])
      expect(CODE).toContain(k)
  })
})

describe('★ 건드리지 않은 것', () => {
  it('★ 구역별 인쇄(복제본)는 지시 밖이라 건드리지 않았다 — 그쪽은 빈칸이 없다', () => {
    /* 판정 기준이 달라(compound_type · 괄호 밖 '/' 만 자름) 일부러 복제해 둔 별도 구현이다.
       ATC 만 「영문 (한글)」로 바뀌었으므로 지금은 두 인쇄의 띄어쓰기가 다르다 — 보고 대상. */
    expect(CODE).toContain('function lpSplitTop(s)')
    expect(CODE).toContain("const first = fe && fk ? fe + '(' + fk + ')' : (fe || fk)")
  })

  it('검색(q)은 그대로 약품코드·약품명·성분명(한글)을 본다', () => {
    expect(CODE).toContain("String(d.ingredient_kr||'').toLowerCase().includes(kw)")
  })

  it('표의 열 폭·고정 열은 그대로다', () => {
    expect(CODE).toContain('colWidths={[120, 120, 208, 220, 80, 72, 96, 96, 84]}')
    expect(CODE).toContain("{ k: 'drug_name', h: '약품명', sticky: { left: 120, w: 208 }")
  })
})
