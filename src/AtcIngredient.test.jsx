/* ATC 배치 목록 — 성분명 두 줄 (2026-11-07 이정화 님 지시).
 *
 * 못 박는 것
 *  ① 표 칸이 **영문 위 · 한글 아래** 두 줄이다
 *  ② 긴 복합제는 영문·한글 **같은 규칙**으로 「첫 성분 외 N종」
 *  ③ 「외 N종」의 N 은 **영문 기준 한 번만** 센다 — 두 줄이 어긋나면 안 된다
 *  ④ 정렬·필터 키가 **영문**이다
 *  ⑤ 엑셀은 성분명(영문)·성분명(한글) **두 칸**이고, 줄이지 않은 **원본**이다
 *
 * `ingShort` 는 `AtcView` 안에 있어 따로 불러올 수 없다 — 소스를 읽어 확인하고,
 * 셈 규칙은 같은 식을 여기서 다시 만들어 값으로 확인한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')

/* 화면 코드와 **같은 식** — 바뀌면 아래 시험이 먼저 깨진다 */
const ingParts = s => String(s || '').split('/').map(x => x.trim()).filter(Boolean)
const ingCount = d => (ingParts(d && d.ingredient_en).length || ingParts(d && d.ingredient_kr).length)
const ingShort = (s, cnt) => { const p = ingParts(s); if (!p.length) return ''; return cnt > 1 ? p[0] + ' 외 ' + (cnt - 1) + '종' : p[0] }

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

  it('★ 줄 하나(mkRow)에서 **한 번만** 세어 두 줄에 같이 쓴다', () => {
    expect(CODE).toContain('const _ic = ingCount(d);')
    expect(CODE).toContain('ing_en: ingShort(d.ingredient_en, _ic), ing_kr: ingShort(d.ingredient_kr, _ic)')
  })

  it('★ 정렬·필터 키가 영문이다', () => {
    expect(CODE).toContain("{ k: 'ing_en', h: '성분명' }")
    expect(CODE).not.toContain("{ k: 'ingredient_kr', h: '성분명' }")
  })

  it('★ 표 칸이 두 줄이다 — 영문 위(기본), 한글 아래(작은 보조)', () => {
    const i = CODE.indexOf('{e.ing_en')
    const j = CODE.indexOf('{e.ing_kr')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)                     /* 영문이 위 */
    expect(CODE).toContain("fontSize: 10.5, color: t.textL")  /* 한글이 작은 보조 글씨 */
  })

  it('긴 이름은 줄마다 말줄임한다 (칸이 넓어지지 않게)', () => {
    const cell = CODE.slice(CODE.indexOf('{e.ing_en') - 400, CODE.indexOf('{e.ing_kr') + 200)
    expect((cell.match(/textOverflow: 'ellipsis'/g) || []).length).toBeGreaterThanOrEqual(2)
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
  it('인쇄용 printIng 은 그대로다 (인쇄는 「영문(한글)」 한 줄)', () => {
    expect(CODE).toContain('const printIng = d =>')
    expect(CODE).toContain("first = fe && fk ? fe + '(' + fk + ')' : (fe || fk)")
  })

  it('검색(q)은 그대로 약품코드·약품명·성분명(한글)을 본다', () => {
    expect(CODE).toContain("String(d.ingredient_kr||'').toLowerCase().includes(kw)")
  })

  it('표의 열 폭·고정 열은 그대로다', () => {
    expect(CODE).toContain('colWidths={[120, 120, 208, 220, 80, 72, 96, 96, 84]}')
    expect(CODE).toContain("{ k: 'drug_name', h: '약품명', sticky: { left: 120, w: 208 }")
  })
})
