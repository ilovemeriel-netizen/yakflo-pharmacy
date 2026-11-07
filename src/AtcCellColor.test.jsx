/* ATC 카세트 칸 색 · 「유사」 정렬·필터 키 — 2026-11-07.
 *
 * 못 박는 것
 *  ① 칸 색(cs·pcs)이 lasa_type(28종) 이 아니라 caution_*(74종) 을 본다
 *  ② 색 자체는 **바뀌지 않았다** — 자료만 바꿨다
 *  ③ 주의가 여러 개면 발음 > 모양 > 용량 차례로 하나만 칠한다(라벨 바탕색과 같은 차례)
 *  ④ 표 「유사」 칸의 정렬·필터 키가 **칸에 그려지는 뱃지와 같다**
 *  ⑤ lasa_type 칸 자체는 지우지 않았다
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cellCaution, cautionKey, CELL_PRIORITY, CAUTION_ORDER } from './lib/cautionDefs'
import { LABEL_PRIORITY } from './lib/labelDefs'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')
const between = (a, b) => { const i = CODE.indexOf(a); return i < 0 ? '' : CODE.slice(i, CODE.indexOf(b, i) + b.length) }

const D = o => ({ caution_dose: false, caution_shape: false, caution_sound: false, ...o })

describe('★ 칸 색 고르기 — cellCaution', () => {
  it.each([
    ['아무것도 없음', {}, null],
    ['용량만', { caution_dose: true }, 'dose'],
    ['모양만', { caution_shape: true }, 'shape'],
    ['발음만', { caution_sound: true }, 'sound'],
  ])('%s → %s', (_n, o, want) => {
    expect(cellCaution(D(o))).toBe(want)
  })

  it('★ 여러 개면 발음이 이긴다', () => {
    expect(cellCaution(D({ caution_sound: true, caution_shape: true, caution_dose: true }))).toBe('sound')
    expect(cellCaution(D({ caution_sound: true, caution_dose: true }))).toBe('sound')
  })

  it('★ 발음이 없으면 모양이 이긴다', () => {
    expect(cellCaution(D({ caution_shape: true, caution_dose: true }))).toBe('shape')
  })

  it('★ 라벨 바탕색과 **같은 차례**다 (종이와 화면이 다른 색이면 더 헷갈린다)', () => {
    expect(CELL_PRIORITY).toEqual(LABEL_PRIORITY)
  })

  it('약이 없으면 null 이다 (빈 칸에서 터지지 않는다)', () => {
    expect(cellCaution(null)).toBeNull()
    expect(cellCaution(undefined)).toBeNull()
    expect(cellCaution({})).toBeNull()
  })

  it('lasa_type 은 보지 않는다', () => {
    expect(cellCaution(D({ lasa_type: '모양' }))).toBeNull()
    expect(cellCaution(D({ lasa_type: '용량', caution_shape: true }))).toBe('shape')
  })
})

describe('★ 「유사」 칸 정렬·필터 키 — cautionKey', () => {
  it.each([
    ['아무것도 없음', {}, '-'],
    ['용량', { caution_dose: true }, '용량'],
    ['모양', { caution_shape: true }, '모양'],
    ['발음', { caution_sound: true }, '발음'],
  ])('%s → %s', (_n, o, want) => {
    expect(cautionKey(D(o))).toBe(want)
  })

  it('★ 여러 개면 **칩에 그려지는 차례**(용량 → 모양 → 발음) 그대로 잇는다', () => {
    expect(cautionKey(D({ caution_dose: true, caution_shape: true }))).toBe('용량·모양')
    expect(cautionKey(D({ caution_shape: true, caution_sound: true }))).toBe('모양·발음')
    expect(cautionKey(D({ caution_dose: true, caution_shape: true, caution_sound: true }))).toBe('용량·모양·발음')
  })

  it('★ 칸에 그려지는 뱃지와 **글자가 같다**', () => {
    for (const bits of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
      const d = D({ caution_dose: !!bits[0], caution_shape: !!bits[1], caution_sound: !!bits[2] })
      const drawn = CAUTION_ORDER.filter(x => d[x.col] === true).map(x => x.label).join('·') || '-'
      expect(cautionKey(d)).toBe(drawn)
    }
  })

  it('약이 없으면 - 다', () => {
    expect(cautionKey(null)).toBe('-')
    expect(cautionKey(undefined)).toBe('-')
  })

  it('lasa_type 은 보지 않는다', () => {
    expect(cautionKey(D({ lasa_type: '모양' }))).toBe('-')
  })
})

describe('★ 화면이 실제로 그 함수를 쓴다', () => {
  const CS = between('const cs = d => {', 'const Cell =')
  const PCS = between('const pcs = (d, exp) =>', 'const PCell =')
  const MK = between('const mkRow = (slot, d, fsp) =>', 'mavg:')

  it('카세트 칸 색(cs)이 cellCaution 을 쓴다', () => {
    expect(CS).toContain('cellCaution(d)')
    expect(CS).not.toContain('lasa_type')
  })

  it('사용량순 제안 칸 색(pcs)도 cellCaution 을 쓴다', () => {
    expect(PCS).toContain('cellCaution(d)')
    expect(PCS).not.toContain('lasa_type')
  })

  it('★ 표 「유사」 키(mkRow.lasa)가 cautionKey 를 쓴다', () => {
    expect(MK).toContain('lasa: cautionKey(d)')
    expect(MK).not.toContain('lasa_type')
  })

  it('필터·정렬이 같은 키를 본다 (atcHf.lasa · atcFiltered)', () => {
    expect(CODE).toContain('lasa: { items: _uA(atcRows.map(r => r.lasa))')
    expect(CODE).toContain("atcLasa === '전체' || r.lasa === atcLasa")
  })
})

describe('★ 색은 바뀌지 않았다 — 자료만 바꿨다', () => {
  const CS = between('const cs = d => {', 'const Cell =')
  const PCS = between('const pcs = (d, exp) =>', 'const PCell =')

  it('카세트 칸 — 모양 coral · 용량 blueL · 발음 amberL 그대로', () => {
    expect(CODE).toContain("const CELL_SHAPE = { bg: t.coral, bd: t.coral, fg: t.text };")
    expect(CODE).toContain("const CELL_DOSE = { bg: t.blueL, bd: t.blue, fg: t.text };")
    expect(CODE).toContain("const CELL_SOUND = { bg: t.amberL, bd: t.amber, fg: t.text };")
  })

  it('제안 칸 — 각자의 글씨색도 그대로 (blue·amber)', () => {
    /* 2026-11-07 — 제안 칸도 현재배치와 **같은 상수**를 쓴다(글씨색 blue·amber 가 사라졌다) */
    expect(PCS).toContain('return CELL_SHAPE')
    expect(PCS).toContain('return CELL_DOSE')
    expect(PCS).toContain('return CELL_SOUND')
  })

  it('★ 차광 칸은 검정 바탕 + 노랑 글씨다 (두 곳 다 같은 값 · 2026-11-07 지시)', () => {
    for (const part of [CS, PCS])
      expect(part).toContain('if (isShade(d)) return CELL_SHADE')
  })

  it('상비·빈 칸·기본색도 그대로', () => {
    expect(PCS).toContain('if (d.atc_pinned) return CELL_PIN')
    expect(CODE).toContain('const CELL_PLAIN = { bg: t.purpleL, bd: t.lavender, fg: t.text };')
  })
})

describe('★ lasa_type 칸은 건드리지 않았다', () => {
  it('파일에 그대로 남아 있다', () => {
    expect(APP).toContain('lasa_type')
  })

  it('어디에도 지우는 코드가 없다', () => {
    expect(APP).not.toMatch(/drop column[\s\S]{0,40}lasa_type/i)
  })
})
