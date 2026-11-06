/* 약품식별 라벨 규칙 — 색·차례·크기·줄임을 못 박는다.
 *
 * 왜 숫자로 못 박나: 라벨은 **종이에 찍혀 약장에 붙는다.** 화면과 달리
 * 틀린 채로 나가면 되돌리기 어렵다. 색 하나·기준 한 글자가 바뀌어도 걸리게 한다.
 */
import { describe, it, expect } from 'vitest'
import {
  LABEL_BG, LABEL_HEAD, LABEL_PRIORITY, CAUTION_LABEL, ING_LIMIT, LABEL_FILTERS,
  bgKind, badgeKinds, labelBg, labelHead, nameSizeMm, ingSizeMm,
  shortenIngredient, ingredientPair, labelPrintCss, matchSearch,
} from './labelDefs'

const D = o => ({ caution_dose: false, caution_shape: false, caution_sound: false, ...o })

describe('라벨 색 — 인쇄 전용 값', () => {
  it('바탕색 네 가지', () => {
    expect(LABEL_BG).toEqual({
      none: '#FFFFFF', dose: '#93C5FD', sound: '#FDE047', shape: '#FCA5A5',
    })
  })

  it('제목 칸은 바탕보다 연하게 — ★ 흰 바탕은 흰색 그대로', () => {
    expect(LABEL_HEAD.none).toBe('#FFFFFF')
    expect(LABEL_HEAD).toEqual({
      none: '#FFFFFF', dose: '#C9E2FE', sound: '#FEF0A3', shape: '#FDD2D2',
    })
  })

  it('화면 팔레트 색이 섞여 들어오지 않았다', () => {
    const screen = ['#2E4A62', '#C62828', '#FFE082', '#D9342B']
    for (const v of [...Object.values(LABEL_BG), ...Object.values(LABEL_HEAD)]) {
      expect(screen).not.toContain(v)
    }
  })
})

describe('바탕 우선순위 — 발음 > 모양 > 용량', () => {
  it('차례가 그대로다', () => {
    expect(LABEL_PRIORITY).toEqual(['sound', 'shape', 'dose'])
  })

  it('하나만 켜지면 그것이 바탕', () => {
    expect(bgKind(D({ caution_dose: true }))).toBe('dose')
    expect(labelBg(D({ caution_dose: true }))).toBe('#93C5FD')
    expect(labelHead(D({ caution_dose: true }))).toBe('#C9E2FE')
  })

  it('★ 셋 다 켜지면 발음이 바탕', () => {
    const d = D({ caution_dose: true, caution_shape: true, caution_sound: true })
    expect(bgKind(d)).toBe('sound')
    expect(labelBg(d)).toBe('#FDE047')
  })

  it('★ 모양 + 용량이면 모양이 바탕', () => {
    expect(bgKind(D({ caution_shape: true, caution_dose: true }))).toBe('shape')
  })

  it('하나도 없으면 흰 바탕', () => {
    expect(bgKind(D({}))).toBe(null)
    expect(labelBg(D({}))).toBe('#FFFFFF')
    expect(labelHead(D({}))).toBe('#FFFFFF')
    expect(labelBg(null)).toBe('#FFFFFF')
  })

  it('뱃지도 같은 차례로 나온다', () => {
    expect(badgeKinds(D({ caution_dose: true, caution_sound: true }))).toEqual(['sound', 'dose'])
    expect(badgeKinds(D({}))).toEqual([])
    expect(badgeKinds(null)).toEqual([])
  })

  it('뱃지 글자', () => {
    expect(CAUTION_LABEL).toEqual({ dose: '용량 주의', shape: '모양 주의', sound: '발음 주의' })
  })
})

describe('약품명 — 길면 작아진다. 말줄임은 하지 않는다', () => {
  it.each([
    ['디고신정', 7.6],
    ['가바로닌캡슐100mg', 6.4],
    ['삼남아세트아미노펜정500mg', 5.4],
    ['명문니트로글리세린0.6mg설하정', 4.5],
    ['독감-65세 이상 (플루백신VIII-TF주 0.5mL)', 3.4],
  ])('「%s」 → %smm', (name, mm) => {
    expect(nameSizeMm(name)).toBe(mm)
  })

  it('길수록 작아지기만 한다 (커지지 않는다)', () => {
    let prev = Infinity
    for (const n of [5, 10, 13, 18, 23, 40]) {
      const v = nameSizeMm('가'.repeat(n))
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
  })

  it('빈 이름도 터지지 않는다', () => {
    expect(nameSizeMm(null)).toBe(7.6)
    expect(nameSizeMm('')).toBe(7.6)
  })
})

describe('성분명 — 영문·한글에 같은 규칙', () => {
  it('기준 길이', () => {
    expect(ING_LIMIT).toEqual({ en: 80, kr: 44 })
  })

  it('둘 다 짧으면 그대로 둔다', () => {
    const p = ingredientPair('Acetaminophen', '아세트아미노펜')
    expect(p.cut).toBe(false)
    expect(p.en.text).toBe('Acetaminophen')
    expect(p.kr.text).toBe('아세트아미노펜')
  })

  it('★ 영문만 길어도 한글까지 함께 줄인다 (고덱스캡슐 실제 값)', () => {
    const en = 'Carnitine Orotate/Antitoxic Liver Extract/Adenine Hydrochloride/Pyridoxine Hydrochloride/Riboflavin/Cyanocobalamin/Biphenyl Dimethyl Dicarboxylate'
    const kr = '오로트산카르니틴/항독성간장엑스/아데닌염산염/피리독신염산염/리보플라빈/시아노코발라민/비페닐디메틸디카르복실레이트'
    expect(en.length).toBeGreaterThan(ING_LIMIT.en)
    expect(kr.length).toBeLessThanOrEqual(ING_LIMIT.kr + 50)  /* 한글은 짧아도 */
    const p = ingredientPair(en, kr)
    expect(p.cut).toBe(true)
    expect(p.en.text).toBe('Carnitine Orotate 외 6종')
    expect(p.kr.text).toBe('오로트산카르니틴 외 6종')
  })

  it('★ 한글만 길어도 영문까지 함께 줄인다', () => {
    /* 한글 기준은 44자다. 그보다 길게 만든다(45 + 「/나/다」 = 49자) */
    const p = ingredientPair('A/B/C', '가'.repeat(45) + '/나/다')
    expect(p.cut).toBe(true)
    expect(p.en.text).toBe('A 외 2종')
    expect(p.kr.text).toContain('외 2종')
  })

  it('복합제는 「첫 성분 외 N종」', () => {
    expect(shortenIngredient('가/나/다/라')).toBe('가 외 3종')
    expect(shortenIngredient('가/나')).toBe('가 외 1종')
  })

  it('단일 성분이 아주 길면 끝을 … 로 막는다', () => {
    const v = shortenIngredient('가'.repeat(100))
    expect(v).toHaveLength(61)
    expect(v.endsWith('…')).toBe(true)
  })

  it('첫 성분 자체가 길면 그것도 줄인다', () => {
    expect(shortenIngredient('가'.repeat(50) + '/나')).toBe('가'.repeat(30) + '… 외 1종')
  })

  it('한쪽이 비면 그 줄은 없다 (남은 줄만 쓴다)', () => {
    const p = ingredientPair('Ibuprofen', '')
    expect(p.en.text).toBe('Ibuprofen')
    expect(p.kr).toBe(null)
  })

  it('둘 다 비면 둘 다 없다', () => {
    const p = ingredientPair(null, null)
    expect(p.en).toBe(null)
    expect(p.kr).toBe(null)
  })

  it('길수록 글자가 작아진다', () => {
    expect(ingSizeMm('가'.repeat(10))).toBe(3.1)
    expect(ingSizeMm('가'.repeat(40))).toBe(2.7)
    expect(ingSizeMm('가'.repeat(70))).toBe(2.4)
  })
})

describe('인쇄 규칙', () => {
  const css = labelPrintCss()

  it('★ 용지는 85 × 45mm, 여백 0', () => {
    expect(css).toContain('@page { size: 85mm 45mm; margin: 0; }')
  })

  it('인쇄할 때는 라벨 하나만 보인다', () => {
    expect(css).toContain('body * { visibility: hidden; }')
    expect(css).toContain('#yakflo-label, #yakflo-label * { visibility: visible; }')
  })

  it('바탕색이 찍히게 해 둔다', () => {
    expect(css).toContain('print-color-adjust: exact')
  })
})

describe('라벨 인쇄 화면의 거르개', () => {
  const rows = [
    D({ drug_code: 'A1', drug_name: '가바로닌캡슐100mg', caution_dose: true }),
    D({ drug_code: 'B2', drug_name: '디고신정', caution_shape: true }),
    D({ drug_code: 'C3', drug_name: '마그밀정', caution_sound: true }),
    D({ drug_code: 'D4', drug_name: '게리드정2mg' }),
    D({ drug_code: 'E5', drug_name: '휴마로그주', is_high_alert: true }),
  ]
  const pick = id => rows.filter(LABEL_FILTERS.find(f => f.id === id).test)

  it('거르개 여섯 개', () => {
    expect(LABEL_FILTERS.map(f => f.id)).toEqual(['caution', 'all', 'dose', 'shape', 'sound', 'high'])
  })

  it('「주의 있는 약만」이 기본이고 주의 3종을 모두 담는다', () => {
    expect(LABEL_FILTERS[0].id).toBe('caution')
    expect(pick('caution').map(d => d.drug_code)).toEqual(['A1', 'B2', 'C3'])
  })

  it('고위험은 주의 표시와 따로 센다', () => {
    expect(pick('high').map(d => d.drug_code)).toEqual(['E5'])
    expect(pick('caution').map(d => d.drug_code)).not.toContain('E5')
  })

  it('종류별로 갈라진다', () => {
    expect(pick('dose').map(d => d.drug_code)).toEqual(['A1'])
    expect(pick('shape').map(d => d.drug_code)).toEqual(['B2'])
    expect(pick('sound').map(d => d.drug_code)).toEqual(['C3'])
    expect(pick('all')).toHaveLength(5)
  })
})

describe('약품명·코드로 찾기', () => {
  const d = { drug_name: '가바로닌캡슐100mg', drug_code: 'SGBRONNC10' }

  it('이름 일부로 찾는다', () => {
    expect(matchSearch(d, '가바로닌')).toBe(true)
    expect(matchSearch(d, '100mg')).toBe(true)
  })

  it('코드로도 찾고 대소문자를 가리지 않는다', () => {
    expect(matchSearch(d, 'sgbronnc10')).toBe(true)
    expect(matchSearch(d, 'SGBR')).toBe(true)
  })

  it('비어 있으면 모두 통과', () => {
    expect(matchSearch(d, '')).toBe(true)
    expect(matchSearch(d, '   ')).toBe(true)
  })

  it('없는 말이면 걸러진다', () => {
    expect(matchSearch(d, '디고신')).toBe(false)
  })
})
