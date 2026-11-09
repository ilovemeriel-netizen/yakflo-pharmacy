/* 약품식별 라벨 규칙 — 색·차례·줄임·종이 배치를 못 박는다.
 *
 * 왜 숫자로 못 박나: 라벨은 **종이에 찍혀 약장에 붙는다.** 화면과 달리
 * 틀린 채로 나가면 되돌리기 어렵다. 색 하나·기준 한 글자가 바뀌어도 걸리게 한다.
 */
import { describe, it, expect } from 'vitest'
import {
  LABEL_BG, HIGH_ALERT_BG, LABEL_PRIORITY, CAUTION_LABEL, CAUTION_SHORT,
  ING_LIMIT, LABEL_FILTERS, NAME_MM, SHEET, SHEET_GAP_MM, SHEET_PER_PAGE, QTY_MAX,
  bgKind, badgeKinds, labelBg, labelHead, lighten, ingSizeMm,
  shortenIngredient, ingredientPair, labelPrintCss, sheetPrintCss, matchSearch,
  sheetMargins, expandForSheet, paginate,
} from './labelDefs'

const D = o => ({ caution_dose: false, caution_shape: false, caution_sound: false, is_high_alert: false, ...o })

describe('라벨 색 — 인쇄 전용 값', () => {
  it('주의 3종 바탕색', () => {
    expect(LABEL_BG).toEqual({ none: '#FFFFFF', dose: '#93C5FD', sound: '#FDE047', shape: '#FCA5A5' })
  })

  it('고위험 바탕색 — 원내 게시물 규칙', () => {
    expect(HIGH_ALERT_BG).toEqual({
      electrolyte_na: '#86EFAC',  /* 나트륨 초록 */
      electrolyte_k: '#EF4444',   /* 칼륨 빨강 */
      insulin: '#FED7AA',         /* 인슐린 살구 */
    })
  })

  it('화면 팔레트 색이 섞여 들어오지 않았다', () => {
    const screen = ['#2E4A62', '#C62828', '#FFE082', '#D9342B', '#804A87']
    for (const v of [...Object.values(LABEL_BG), ...Object.values(HIGH_ALERT_BG)]) {
      expect(screen).not.toContain(v)
    }
  })

  it('제목 칸은 바탕보다 연하다 — 흰 바탕은 흰색 그대로', () => {
    expect(lighten('#FFFFFF', 0.45)).toBe('#FFFFFF')
    expect(labelHead(D({}))).toBe('#FFFFFF')
    /* 바탕색을 흰색 쪽으로 45% 섞은 값 — 손으로 고르지 않고 계산해서 쓴다 */
    expect(labelHead(D({ caution_dose: true }))).toBe('#C4DFFE')
    expect(labelHead(D({ caution_shape: true }))).toBe('#FDCECE')
    expect(labelHead(D({ caution_sound: true }))).toBe('#FEEE9A')
    expect(labelHead(D({ is_high_alert: true, high_alert_class: 'electrolyte_na' }))).toBe('#BCF6D1')
    expect(labelHead(D({ is_high_alert: true, high_alert_class: 'electrolyte_k' }))).toBe('#F69898')
    expect(labelHead(D({ is_high_alert: true, high_alert_class: 'insulin' }))).toBe('#FEE9D0')
  })
})

describe('★ 바탕색 우선순위 — 고위험이 주의 3종보다 먼저', () => {
  it('고위험 갈래별 바탕색', () => {
    expect(labelBg(D({ is_high_alert: true, high_alert_class: 'electrolyte_na' }))).toBe('#86EFAC')
    expect(labelBg(D({ is_high_alert: true, high_alert_class: 'electrolyte_k' }))).toBe('#EF4444')
    expect(labelBg(D({ is_high_alert: true, high_alert_class: 'insulin' }))).toBe('#FED7AA')
  })

  it('★ 고위험이면 주의 3종 바탕색을 덮는다', () => {
    const d = D({ is_high_alert: true, high_alert_class: 'electrolyte_k', caution_sound: true, caution_shape: true })
    expect(labelBg(d)).toBe('#EF4444')
    expect(labelBg(d)).not.toBe(LABEL_BG.sound)
  })

  it('★ 고위험인데 갈래가 비면 흰 바탕으로 떨어진다 (안전한 기본값)', () => {
    expect(labelBg(D({ is_high_alert: true }))).toBe('#FFFFFF')
    expect(labelBg(D({ is_high_alert: true, high_alert_class: null }))).toBe('#FFFFFF')
    expect(labelBg(D({ is_high_alert: true, high_alert_class: '아무거나' }))).toBe('#FFFFFF')
  })

  it('고위험이 아니면 갈래 값이 있어도 쓰이지 않는다', () => {
    expect(labelBg(D({ is_high_alert: false, high_alert_class: 'insulin', caution_dose: true }))).toBe('#93C5FD')
  })

  it('주의 3종끼리는 발음 > 모양 > 용량', () => {
    expect(LABEL_PRIORITY).toEqual(['sound', 'shape', 'dose'])
    expect(bgKind(D({ caution_dose: true, caution_shape: true, caution_sound: true }))).toBe('sound')
    expect(bgKind(D({ caution_shape: true, caution_dose: true }))).toBe('shape')
    expect(bgKind(D({}))).toBe(null)
  })
})

describe('★ 뱃지 — 고위험이 언제나 맨 앞', () => {
  it('고위험 + 주의면 고위험이 먼저', () => {
    expect(badgeKinds(D({ is_high_alert: true, caution_dose: true, caution_sound: true })))
      .toEqual(['high', 'sound', 'dose'])
  })

  it('고위험만 있어도 뱃지는 붙는다 (갈래가 비어도)', () => {
    expect(badgeKinds(D({ is_high_alert: true }))).toEqual(['high'])
  })

  it('아무것도 없으면 뱃지도 없다', () => {
    expect(badgeKinds(D({}))).toEqual([])
    expect(badgeKinds(null)).toEqual([])
  })

  it('뱃지 글자 — 짧은 이름 (2026-11-09 차광 추가)', () => {
    expect(CAUTION_SHORT).toEqual({ dose: '용량', shape: '모양', sound: '발음', high: '고위험', shade: '차광' })
    expect(CAUTION_LABEL.dose).toBe('용량 주의')
  })
})

describe('약품명 — 칸에 맞춰 줄인다. 말줄임은 하지 않는다', () => {
  it('시작값·하한·줄이는 폭', () => {
    expect(NAME_MM.start).toBe(7.0)
    expect(NAME_MM.min).toBe(2.6)
    expect(NAME_MM.step).toBe(0.2)
    expect(NAME_MM.min).toBeLessThan(NAME_MM.start)
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
    const p = ingredientPair(en, kr)
    expect(p.cut).toBe(true)
    expect(p.en.text).toBe('Carnitine Orotate 외 6종')
    expect(p.kr.text).toBe('오로트산카르니틴 외 6종')
  })

  it('★ 한글만 길어도 영문까지 함께 줄인다', () => {
    const p = ingredientPair('A/B/C', '가'.repeat(45) + '/나/다')
    expect(p.cut).toBe(true)
    expect(p.en.text).toBe('A 외 2종')
    expect(p.kr.text).toContain('외 2종')
  })

  it('복합제는 「첫 성분 외 N종」', () => {
    expect(shortenIngredient('가/나/다/라')).toBe('가 외 3종')
  })

  it('단일 성분이 아주 길면 끝을 … 로 막는다', () => {
    const v = shortenIngredient('가'.repeat(100))
    expect(v).toHaveLength(61)
    expect(v.endsWith('…')).toBe(true)
  })

  it('한쪽이 비면 그 줄은 없다', () => {
    const p = ingredientPair('Ibuprofen', '')
    expect(p.en.text).toBe('Ibuprofen')
    expect(p.kr).toBe(null)
  })

  it('길수록 글자가 작아진다', () => {
    expect(ingSizeMm('가'.repeat(10))).toBe(3.1)
    expect(ingSizeMm('가'.repeat(40))).toBe(2.7)
    expect(ingSizeMm('가'.repeat(70))).toBe(2.4)
  })
})

describe('★ 인쇄 규칙 — 흰 종이가 나오던 것을 막는다', () => {
  const one = labelPrintCss()
  const sheet = sheetPrintCss()

  it('한 장은 85 × 45mm, 여백 0', () => {
    expect(one).toContain('@page { size: 85mm 45mm; margin: 0; }')
  })

  it('A4 모음은 A4 세로, 여백 0', () => {
    expect(sheet).toContain('@page { size: A4 portrait; margin: 0; }')
  })

  it('★ position: fixed !important — absolute 로는 종이 밖에 그려진다', () => {
    expect(one).toContain('position: fixed !important')
    expect(sheet).toContain('position: fixed !important')
    expect(one).not.toMatch(/position:\s*absolute/)
  })

  it('left·top 도 !important 로 덮는다 (인라인 style 을 이겨야 한다)', () => {
    expect(one).toContain('left: 0 !important')
    expect(one).toContain('top: 0 !important')
  })

  it('인쇄할 때는 그것 하나만 보인다', () => {
    expect(one).toContain('body * { visibility: hidden; }')
    expect(one).toContain('#yakflo-label, #yakflo-label * { visibility: visible; }')
    expect(sheet).toContain('#yakflo-sheet, #yakflo-sheet * { visibility: visible; }')
  })

  it('바탕색이 찍히게 해 둔다', () => {
    expect(one).toContain('print-color-adjust: exact')
    expect(sheet).toContain('print-color-adjust: exact')
  })

  it('A4 는 쪽마다 넘긴다 — 마지막 쪽 뒤에는 빈 장을 만들지 않는다', () => {
    expect(sheet).toContain('page-break-after: always')
    expect(sheet).toContain('.yp-page:last-child { page-break-after: auto')
  })
})

describe('A4 모음 — 2열 × 6행 = 12칸', () => {
  it('칸 수와 크기', () => {
    expect(SHEET).toEqual({ cols: 2, rows: 6, w: 85, h: 45, paperW: 210, paperH: 297 })
    expect(SHEET_PER_PAGE).toBe(12)
  })

  it('★ 간격은 설정값 하나다 — 잘리면 0 으로만 바꾸면 된다', () => {
    expect(SHEET_GAP_MM).toBe(3)
  })

  it('간격 3mm 면 여백이 좌우 18.5mm · 위아래 6mm', () => {
    expect(sheetMargins(3)).toEqual({ x: 18.5, y: 6 })
  })

  it('간격 0mm 면 여백이 좌우 20mm · 위아래 13.5mm (더 안전하다)', () => {
    expect(sheetMargins(0)).toEqual({ x: 20, y: 13.5 })
  })

  it('종이 밖으로 넘치지 않는다', () => {
    for (const gap of [0, 3]) {
      const m = sheetMargins(gap)
      expect(SHEET.w * SHEET.cols + gap * (SHEET.cols - 1) + m.x * 2).toBeCloseTo(SHEET.paperW, 1)
      expect(SHEET.h * SHEET.rows + gap * (SHEET.rows - 1) + m.y * 2).toBeCloseTo(SHEET.paperH, 1)
    }
  })

  it('간격을 넓히면 여백이 줄어든다', () => {
    expect(sheetMargins(3).y).toBeLessThan(sheetMargins(0).y)
  })
})

describe('장수 — 같은 약을 여러 장', () => {
  const A = { drug_code: 'A' }, B = { drug_code: 'B' }

  it('최대 99장', () => { expect(QTY_MAX).toBe(99) })

  it('장수만큼 되풀이한다', () => {
    expect(expandForSheet([A, B], { A: 3, B: 1 }).map(d => d.drug_code))
      .toEqual(['A', 'A', 'A', 'B'])
  })

  it('장수를 안 적으면 한 장', () => {
    expect(expandForSheet([A], {})).toHaveLength(1)
  })

  it('★ 0·음수·글자는 한 장으로, 99 를 넘으면 99 로 막는다', () => {
    expect(expandForSheet([A], { A: 0 })).toHaveLength(1)
    expect(expandForSheet([A], { A: -5 })).toHaveLength(1)
    expect(expandForSheet([A], { A: '아무거나' })).toHaveLength(1)
    expect(expandForSheet([A], { A: 500 })).toHaveLength(99)
  })

  it('12장씩 쪽을 나눈다 — 13장째는 다음 장', () => {
    expect(paginate(new Array(12).fill(A))).toHaveLength(1)
    expect(paginate(new Array(13).fill(A))).toHaveLength(2)
    expect(paginate(new Array(13).fill(A))[1]).toHaveLength(1)
    expect(paginate([])).toHaveLength(0)
  })
})

describe('라벨 인쇄 화면의 거르개·찾기', () => {
  const rows = [
    D({ drug_code: 'A1', drug_name: '가바로닌캡슐100mg', caution_dose: true }),
    D({ drug_code: 'B2', drug_name: '디고신정', caution_shape: true }),
    D({ drug_code: 'C3', drug_name: '마그밀정', caution_sound: true }),
    D({ drug_code: 'D4', drug_name: '게리드정2mg' }),
    D({ drug_code: 'E5', drug_name: '대한염화칼륨-40', is_high_alert: true, high_alert_class: 'electrolyte_k' }),
  ]
  const pick = id => rows.filter(LABEL_FILTERS.find(f => f.id === id).test)

  it('거르개 여섯 개', () => {
    expect(LABEL_FILTERS.map(f => f.id)).toEqual(['caution', 'all', 'dose', 'shape', 'sound', 'high'])
  })

  it('★ 「주의 있는 약만」에 고위험도 들어간다 (뱃지가 붙는 약이 기준)', () => {
    expect(pick('caution').map(d => d.drug_code)).toEqual(['A1', 'B2', 'C3', 'E5'])
  })

  it('종류별로 갈라진다', () => {
    expect(pick('dose').map(d => d.drug_code)).toEqual(['A1'])
    expect(pick('high').map(d => d.drug_code)).toEqual(['E5'])
    expect(pick('all')).toHaveLength(5)
  })

  it('이름·코드로 찾고 대소문자를 가리지 않는다', () => {
    const d = { drug_name: '가바로닌캡슐100mg', drug_code: 'SGBRONNC10' }
    expect(matchSearch(d, '가바로닌')).toBe(true)
    expect(matchSearch(d, 'sgbronnc10')).toBe(true)
    expect(matchSearch(d, '')).toBe(true)
    expect(matchSearch(d, '디고신')).toBe(false)
  })
})
