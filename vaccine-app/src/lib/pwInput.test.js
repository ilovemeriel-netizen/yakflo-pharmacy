/* 비밀번호 4칸 입력 — 숫자만 · 4자리 · 붙여넣기 */
import { describe, it, expect } from 'vitest'
import { sanitizePw, boxFill, pwReady } from './pwInput'

describe('sanitizePw — 숫자만 남긴다', () => {
  it('숫자는 그대로', () => {
    expect(sanitizePw('1234')).toBe('1234')
    expect(sanitizePw('0000')).toBe('0000')
  })
  it('글자·공백·기호는 버린다', () => {
    expect(sanitizePw('a1b2')).toBe('12')
    expect(sanitizePw('1 2')).toBe('12')
    expect(sanitizePw('12-34')).toBe('1234')
    expect(sanitizePw('１２３４')).toBe('')      /* 전각 숫자는 \d 가 아니다 */
    expect(sanitizePw('abcd')).toBe('')
  })
  it('4자리를 넘기면 앞에서 자른다', () => {
    expect(sanitizePw('123456')).toBe('1234')
    expect(sanitizePw('12345678')).toBe('1234')
  })
  it('길이를 바꿔 쓸 수 있다', () => {
    expect(sanitizePw('123456', 6)).toBe('123456')
    expect(sanitizePw('1234', 2)).toBe('12')
  })
  it('빈 값·null·숫자 타입도 안전하다', () => {
    expect(sanitizePw('')).toBe('')
    expect(sanitizePw(null)).toBe('')
    expect(sanitizePw(undefined)).toBe('')
    expect(sanitizePw(1234)).toBe('1234')
  })
})

describe('sanitizePw — 붙여넣기', () => {
  it('섞여 붙은 긴 문자열에서 앞 4자리 숫자만 쓴다', () => {
    expect(sanitizePw('비밀번호 1234 입니다')).toBe('1234')
    expect(sanitizePw('tel: 02-217-1234')).toBe('0221')
  })
  it('줄바꿈·탭이 붙어도 걸러진다', () => {
    expect(sanitizePw('12\n34')).toBe('1234')
    expect(sanitizePw('\t1234\n')).toBe('1234')
  })
  it('숫자가 하나도 없으면 빈 값', () => {
    expect(sanitizePw('아무 글자')).toBe('')
  })
})

describe('boxFill — 칸별 채움', () => {
  it('길이만큼 앞에서 채운다', () => {
    expect(boxFill('')).toEqual([false, false, false, false])
    expect(boxFill('1')).toEqual([true, false, false, false])
    expect(boxFill('12')).toEqual([true, true, false, false])
    expect(boxFill('1234')).toEqual([true, true, true, true])
  })
  it('항상 4칸을 돌려준다 — 값이 넘쳐도 5칸이 되지 않는다', () => {
    expect(boxFill('123456')).toHaveLength(4)
    expect(boxFill('123456')).toEqual([true, true, true, true])
  })
  it('숫자 아닌 입력은 칸을 채우지 않는다', () => {
    expect(boxFill('ab')).toEqual([false, false, false, false])
    expect(boxFill('a1')).toEqual([true, false, false, false])
  })
})

describe('pwReady — 보낼 수 있는가', () => {
  it('정확히 4자리일 때만 참', () => {
    expect(pwReady('')).toBe(false)
    expect(pwReady('123')).toBe(false)
    expect(pwReady('1234')).toBe(true)
  })
  it('넘치게 들어와도 잘린 값이 4자리면 참', () => {
    expect(pwReady('123456')).toBe(true)
  })
  it('숫자가 섞여 모자라면 거짓', () => {
    expect(pwReady('12ab')).toBe(false)
  })
})
