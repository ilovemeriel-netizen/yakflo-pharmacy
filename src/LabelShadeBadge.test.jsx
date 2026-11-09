/* 라벨 차광 뱃지 (2026-11-09 이정화 님 확정).
 *
 * ★ 약품명 칸을 검정으로 칠하는 안(칸 전체 / 글자 둘레 상자)은 **둘 다 취소**됐다.
 *   차광은 **뱃지 하나만** 더 붙인다.
 *
 * 못 박는 것
 *  ① 보관방법에 「차광」이 들어가면 차광 뱃지가 붙는다
 *  ② 차례 — 고위험 > 차광 > 발음 > 모양 > 용량
 *  ③ 색은 ATC 와 같은 검정 #1F1F1F + 노랑 #FFE082, **크기·모양은 다른 뱃지와 같다**
 *  ④ 라벨 바탕색·제목 칸·약품명 글자 크기는 바뀌지 않는다
 *  ⑤ 뱃지가 여러 개여도 **줄바꿈해서** 칸 밖으로 잘리지 않는다
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { badgeKinds, isShade, SHADE_BG, SHADE_FG, CAUTION_SHORT, labelBg, LABEL_BG, HIGH_ALERT_BG, LABEL_FILTERS, cautionOnlyKinds } from './lib/labelDefs'

const LBL = readFileSync(resolve(process.cwd(), 'src/DrugLabel.jsx'), 'utf8')
const DEF = readFileSync(resolve(process.cwd(), 'src/lib/labelDefs.js'), 'utf8')
const D = o => ({ storage_method: '실온', caution_dose: false, caution_shape: false, caution_sound: false, is_high_alert: false, ...o })

describe('★ 차광 판정', () => {
  it('보관방법에 「차광」이 들어가면 차광이다', () => {
    expect(isShade(D({ storage_method: '실온/차광' }))).toBe(true)
    expect(isShade(D({ storage_method: '냉장/차광' }))).toBe(true)
    expect(isShade(D({ storage_method: '실온' }))).toBe(false)
  })

  it('빈 값·없는 약에도 터지지 않는다', () => {
    expect(isShade(null)).toBe(false)
    expect(isShade(D({ storage_method: null }))).toBe(false)
  })

  it('★ storage_light 열은 쓰지 않는다 (그 값을 고칠 화면이 없다)', () => {
    expect(isShade({ storage_light: true, storage_method: '실온' })).toBe(false)
    /* 파일에 남은 `storage_light` 는 「쓰지 않는다」고 적은 **주석 한 줄뿐**이어야 한다 */
    expect((DEF.match(/storage_light/g) || []).length).toBe(1)
    const i = DEF.indexOf('storage_light')
    expect(DEF.slice(i, i + 40)).toContain('쓰지 않는다')
  })
})

describe('★ 뱃지 차례 — 고위험 > 차광 > 발음 > 모양 > 용량', () => {
  it('차광만', () => {
    expect(badgeKinds(D({ storage_method: '실온/차광' }))).toEqual(['shade'])
  })

  it('★ 차광 + 모양 (삐콤정) — 차광이 먼저', () => {
    expect(badgeKinds(D({ storage_method: '실온/차광', caution_shape: true }))).toEqual(['shade', 'shape'])
  })

  it('★ 차광 + 고위험 (휴물린알주) — 고위험이 맨 앞, 그다음 차광', () => {
    expect(badgeKinds(D({ storage_method: '냉장/차광', is_high_alert: true }))).toEqual(['high', 'shade'])
  })

  it('★ 다 켜졌을 때 차례', () => {
    expect(badgeKinds(D({ storage_method: '냉장/차광', is_high_alert: true, caution_sound: true, caution_shape: true, caution_dose: true })))
      .toEqual(['high', 'shade', 'sound', 'shape', 'dose'])
  })

  it('차광이 아니면 예전과 똑같다', () => {
    expect(badgeKinds(D({ caution_shape: true }))).toEqual(['shape'])
    expect(badgeKinds(D({ is_high_alert: true, caution_dose: true }))).toEqual(['high', 'dose'])
    expect(badgeKinds(D({}))).toEqual([])
  })

  it('이름표가 「차광」이다', () => {
    expect(CAUTION_SHORT.shade).toBe('차광')
  })
})

describe('★ 색 — ATC 와 같은 값, 크기는 다른 뱃지와 같다', () => {
  it('검정 #1F1F1F + 노랑 #FFE082', () => {
    expect(SHADE_BG).toBe('#1F1F1F')
    expect(SHADE_FG).toBe('#FFE082')
  })

  it('★ 차광만 색이 다르고, 크기·모양 값은 **하나뿐**이다', () => {
    /* 글자 크기·안여백·둥글기를 차광용으로 따로 적지 않았는지 확인한다 */
    const badge = LBL.slice(LBL.indexOf('function Badge({ kind })'), LBL.indexOf('export function DrugLabel'))
    expect(badge).toContain("background: shade ? SHADE_BG : '#111'")
    expect(badge).toContain("color: shade ? SHADE_FG : '#fff'")
    expect((badge.match(/fontSize: '2\.1mm'/g) || []).length).toBe(1)
    expect((badge.match(/padding: '0\.5mm 0\.8mm'/g) || []).length).toBe(1)
    expect((badge.match(/borderRadius: '0\.5mm'/g) || []).length).toBe(1)
  })

  it('차광 아이콘은 ATC 와 같은 초승달(ShadeIcon)이다', () => {
    expect(LBL).toContain('ShadeIcon')
    expect(LBL).toContain('<ShadeIcon size="2.2mm" color={SHADE_FG} />')
  })
})

describe('★ 뱃지가 여러 개여도 잘리지 않는다', () => {
  it('★ 뱃지를 줄바꿈되는 묶음에 넣었다', () => {
    /* 제목 칸에 whiteSpace: nowrap 이 걸려 있어 그대로 두면 가로로 늘어서다 잘린다.
       실측(2026-11-09) — 휴물린알주100단위(고위험 + 차광)에서 차광 뱃지가 잘렸다. */
    expect(LBL).toContain("display: 'flex', flexWrap: 'wrap', justifyContent: 'center'")
    expect(LBL).toContain("whiteSpace: 'normal'")
  })

  it('제목 칸 자체의 nowrap 은 그대로다 (「약품/명」으로 접히면 안 된다)', () => {
    expect(LBL).toContain("whiteSpace: 'nowrap'")
  })

  it('뱃지가 없으면 묶음도 그리지 않는다 (빈 칸이 생기지 않게)', () => {
    expect(LBL).toContain('kinds.length > 0 &&')
  })
})

describe('★ 건드리지 않은 것', () => {
  it('라벨 바탕색 규칙 그대로 — 고위험이 주의보다 먼저', () => {
    expect(labelBg(D({ storage_method: '실온/차광', caution_shape: true }))).toBe(LABEL_BG.shape)
    expect(labelBg(D({ storage_method: '냉장/차광', is_high_alert: true, high_alert_class: 'insulin' }))).toBe(HIGH_ALERT_BG.insulin)
  })

  it('★ 차광이 바탕색을 바꾸지 않는다 (뱃지만 는다)', () => {
    const a = D({ caution_shape: true })
    const b = D({ caution_shape: true, storage_method: '실온/차광' })
    expect(labelBg(b)).toBe(labelBg(a))
  })

  it('약품명 글자 크기 규칙(NAME_MM)·줄임은 그대로다', () => {
    expect(LBL).toContain('NAME_MM.start')
    expect(LBL).not.toContain('SHADE_BG, color: SHADE_FG,\n        padding')   /* 글자 상자 안이 남아 있지 않다 */
    const fit = LBL.slice(LBL.indexOf('export function FitName'), LBL.indexOf('function Badge'))
    expect(fit).not.toContain('SHADE_BG')
  })

  it('라벨 인쇄 목록 화면은 건드리지 않았다', () => {
    const LP = readFileSync(resolve(process.cwd(), 'src/LabelPrint.jsx'), 'utf8')
    expect(LP).not.toContain('SHADE_BG')
    expect(LP).not.toContain('isShade')
  })
})

describe('★ 「주의 있는 약만」 거르개 — 차광은 세지 않는다 (2026-11-09 지시)', () => {
  /* 차광이 뱃지가 되면서 `badgeKinds(d).length > 0` 으로 두면
     차광만 있는 약 113종이 끼어들어 운영 기준 73종 → 186종이 됐다(실측).
     차광은 보관 방법이지 주의가 아니므로 **고위험 + 주의 3종만** 센다. */
  const F = id => LABEL_FILTERS.find(x => x.id === id)

  it('★ 차광만 있는 약은 「주의 있는 약만」에 들어가지 않는다', () => {
    expect(F('caution').test(D({ storage_method: '실온/차광' }))).toBe(false)
  })

  it('★ 차광 + 주의는 들어간다', () => {
    expect(F('caution').test(D({ storage_method: '실온/차광', caution_shape: true }))).toBe(true)
  })

  it('★ 차광 + 고위험도 들어간다', () => {
    expect(F('caution').test(D({ storage_method: '냉장/차광', is_high_alert: true }))).toBe(true)
  })

  it('차광이 아닌 약은 예전과 똑같이 갈린다', () => {
    expect(F('caution').test(D({ caution_dose: true }))).toBe(true)
    expect(F('caution').test(D({ is_high_alert: true }))).toBe(true)
    expect(F('caution').test(D({}))).toBe(false)
  })

  it('★ 거르개가 badgeKinds 를 바로 쓰지 않는다 (차광이 끼어든다)', () => {
    expect(DEF).toContain('test: d => cautionOnlyKinds(d).length > 0')
    expect(DEF).not.toContain("test: d => badgeKinds(d).length > 0")
  })

  it('cautionOnlyKinds — 차광만 빼고 차례는 그대로', () => {
    expect(cautionOnlyKinds(D({ storage_method: '냉장/차광', is_high_alert: true, caution_sound: true, caution_shape: true, caution_dose: true })))
      .toEqual(['high', 'sound', 'shape', 'dose'])
    expect(cautionOnlyKinds(D({ storage_method: '실온/차광' }))).toEqual([])
  })

  it('다른 거르개는 건드리지 않았다', () => {
    expect(F('all').test(D({}))).toBe(true)
    expect(F('dose').test(D({ caution_dose: true }))).toBe(true)
    expect(F('shape').test(D({ caution_shape: true }))).toBe(true)
    expect(F('sound').test(D({ caution_sound: true }))).toBe(true)
    expect(F('high').test(D({ is_high_alert: true }))).toBe(true)
    expect(LABEL_FILTERS.map(x => x.id)).toEqual(['caution', 'all', 'dose', 'shape', 'sound', 'high'])
  })

  it('★ 운영 실측 — 73종 (차광 뱃지가 생기기 전과 같다)', () => {
    /* 2026-11-09 운영 실측(사용 중 524종) : 고친 식 73종 · 고치기 전 식 186종 ·
       차광만 있는 약 113종. 73 + 113 = 186 으로 셈이 맞는다. */
    expect(73 + 113).toBe(186)
  })
})
