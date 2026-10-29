/* 서버 시각 — 기기 시계가 틀려도 판정이 흔들리지 않아야 한다. */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { noteServerDate, serverNow, hasServerTime, resetServerClock } from './serverClock'

beforeEach(() => { resetServerClock(); vi.useRealTimers() })
afterEach(() => { vi.useRealTimers() })

describe('Date 헤더를 잡는다', () => {
  it('★ 헤더를 넣으면 그 시각이 「지금」이 된다 — 기기 시계가 3시간 틀려 있어도', () => {
    /* 기기 시계를 일부러 3시간 빠르게 돌려 둔다 */
    const real = Date.parse('2026-10-30T12:00:00+09:00')
    vi.useFakeTimers(); vi.setSystemTime(real + 3 * 3600000)

    noteServerDate(new Date(real).toUTCString())
    /* 초 단위로 끊기므로 1초 안쪽이면 맞다 */
    expect(Math.abs(serverNow() - real)).toBeLessThan(1000)
  })

  it('★ 받은 뒤 흐른 시간이 반영된다 — 시각을 통째로 들고 있지 않는다', () => {
    const real = Date.parse('2026-10-30T12:00:00+09:00')
    vi.useFakeTimers(); vi.setSystemTime(real)
    noteServerDate(new Date(real).toUTCString())

    vi.setSystemTime(real + 90_000)          /* 90초 흘렀다 */
    expect(Math.abs(serverNow() - (real + 90_000))).toBeLessThan(1000)
  })

  it('★ 헤더가 없거나 이상하면 기기 시각으로 떨어진다 — 기능이 멈추지 않는다', () => {
    expect(noteServerDate(null)).toBe(false)
    expect(noteServerDate('')).toBe(false)
    expect(noteServerDate('그런 날짜 없음')).toBe(false)
    expect(hasServerTime()).toBe(false)
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50)
  })

  it('★ 한 번 맞춘 뒤 이상한 헤더가 와도 맞춰 둔 값을 버리지 않는다', () => {
    const real = Date.parse('2026-10-30T12:00:00+09:00')
    vi.useFakeTimers(); vi.setSystemTime(real + 3 * 3600000)
    noteServerDate(new Date(real).toUTCString())
    noteServerDate('쓰레기')
    expect(Math.abs(serverNow() - real)).toBeLessThan(1000)
    expect(hasServerTime()).toBe(true)
  })

  it('헤더를 잡았는지 알 수 있다', () => {
    expect(hasServerTime()).toBe(false)
    noteServerDate(new Date().toUTCString())
    expect(hasServerTime()).toBe(true)
  })
})
