/* ATC 엑셀 내려받기 「유사」 칸 — 화면과 같은 자료를 본다 (2026-11-07 이정화 님 신고).
 *
 * 무슨 일이 있었나
 *   PR #419 에서 **화면**의 「유사」 칸을 lasa_type(28종) → caution_*(74종) 로 바꿨는데
 *   **엑셀 내려받기만 빠뜨렸다.** 그래서 라식스정40mg 처럼 화면에는 모양 뱃지가 있는데
 *   엑셀 「유사」 칸은 빈칸인 약이 생겼다. 조용히 틀린 자료가 나가던 자리다.
 *
 * 못 박는 것
 *  ① 엑셀이 `lasa_type` 이 아니라 `cautionKey`(caution_*)를 본다
 *  ② 여러 개면 **화면 뱃지와 같은 차례**(용량 · 모양 · 발음)로 적는다
 *  ③ 하나도 없으면 화면의 '-' 가 아니라 **빈칸**이다 (같은 파일의 「차광」 칸과 맞춘다)
 *  ④ `lasa_type` 칸 자체는 그대로 둔다
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cautionKey, CAUTION_ORDER } from './lib/cautionDefs'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
const CODE = APP.split('\n').filter(l => !/^\s*\/\*|^\s*\*/.test(l)).join('\n')

/* 화면 코드와 같은 식 */
const xlLasa = d => { const s = cautionKey(d); return s === '-' ? '' : s }
const D = o => ({ caution_dose: false, caution_shape: false, caution_sound: false, lasa_type: null, ...o })

describe('★ 엑셀 「유사」 칸이 화면과 같은 자료를 본다', () => {
  it('★ 엑셀이 cautionKey 를 쓴다 — lasa_type 을 직접 읽지 않는다', () => {
    expect(CODE).toContain('const xlLasa = d => { const s = cautionKey(d); return s === ')
    expect(CODE).toContain('유사: xlLasa(d)')
    expect(CODE).not.toContain("유사: d.lasa_type || ''")
  })

  it('★ 신고된 사례 — 라식스정40mg(모양만 켜짐) : 전 빈칸 → 후 「모양」', () => {
    /* 운영 실측 2026-11-07 — lasa_type=null, caution_shape=true */
    const lasix = D({ drug_code: 'LSX', caution_shape: true })
    expect(lasix.lasa_type || '').toBe('')      /* 전 — 빈칸이었다 */
    expect(xlLasa(lasix)).toBe('모양')           /* 후 */
  })

  it('★ 씨르탄정80mg 도 같다 : 전 빈칸 → 후 「모양」', () => {
    const s = D({ caution_shape: true })
    expect(s.lasa_type || '').toBe('')
    expect(xlLasa(s)).toBe('모양')
  })

  it('★ 여러 개면 화면 뱃지와 같은 차례다 (용량 · 모양 · 발음)', () => {
    expect(CAUTION_ORDER.map(x => x.label)).toEqual(['용량', '모양', '발음'])
    expect(xlLasa(D({ caution_dose: true, caution_shape: true }))).toBe('용량·모양')
    expect(xlLasa(D({ caution_shape: true, caution_sound: true }))).toBe('모양·발음')
    expect(xlLasa(D({ caution_dose: true, caution_shape: true, caution_sound: true }))).toBe('용량·모양·발음')
  })

  it('★ 켜진 차례를 넣는 순서와 상관없이 결과가 같다 (자료 차례가 아니라 정해진 차례)', () => {
    const a = xlLasa(D({ caution_sound: true, caution_dose: true }))
    const b = xlLasa(D({ caution_dose: true, caution_sound: true }))
    expect(a).toBe(b)
    expect(a).toBe('용량·발음')
  })

  it('★ 하나도 없으면 빈칸이다 — 화면의 「-」를 엑셀에 넣지 않는다', () => {
    expect(cautionKey(D({}))).toBe('-')        /* 화면은 '-' */
    expect(xlLasa(D({}))).toBe('')             /* 엑셀은 빈칸 */
  })

  it('★ lasa_type 이 있어도 무시한다 — 이제 기준이 caution_* 다', () => {
    /* 옛 값이 남아 있는 약이 있어도 화면과 엑셀이 어긋나면 안 된다 */
    expect(xlLasa(D({ lasa_type: '외관유사', caution_dose: true }))).toBe('용량')
    expect(xlLasa(D({ lasa_type: '외관유사' }))).toBe('')
  })
})

describe('★ 건드리지 않은 것', () => {
  it('lasa_type 칸은 파일에 그대로 있다 (지우지도 고치지도 않았다)', () => {
    expect(APP).toContain('lasa_type')
  })

  it('같은 파일의 다른 칸은 그대로다', () => {
    for (const k of ['슬롯: slot', '약품코드: d.drug_code', '약품명: d.drug_name',
      "'성분명(영문)': d.ingredient_en || ''", "'성분명(한글)': d.ingredient_kr || ''",
      "차광: isShade(d) ? '차광' : ''"]) expect(CODE).toContain(k)
  })

  it('★ 빈 값 표기가 「차광」 칸과 같은 방식이다 (둘 다 빈칸)', () => {
    expect(CODE).toContain("차광: isShade(d) ? '차광' : ''")
    expect(xlLasa(D({}))).toBe('')
  })

  it('화면 표의 「유사」 칸은 예전처럼 cautionKey 로 정렬·필터한다', () => {
    expect(CODE).toContain('lasa: cautionKey(d)')
    expect(CODE).toContain("{ k: 'lasa', h: '유사' }")
  })
})
