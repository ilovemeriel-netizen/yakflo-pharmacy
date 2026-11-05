/* @vitest-environment node */
/* 쪽 나눠 끝까지 읽기 — 1,000줄 조용한 절단을 막는지 본다. */
import { describe, it, expect } from 'vitest'
import { selectAll, PAGE_SIZE, MAX_PAGES } from './selectAll'

/* 흉내 질의 — `.range(from,to)` 를 받아 그 구간만 돌려준다.
   ★ 질의 객체는 한 번만 쓸 수 있으므로 **매번 새로 만드는지**도 함께 센다. */
function fake(total, opts) {
  const o = opts || {}
  const calls = []
  let made = 0
  const build = () => {
    made++
    return {
      range: async (from, to) => {
        calls.push([from, to])
        if (o.failAt != null && calls.length === o.failAt) return { data: null, error: { message: '끊겼다' } }
        const rows = []
        for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: i + 1 })
        return { data: rows, error: null }
      },
    }
  }
  return { build, calls, made: () => made }
}

describe('한 쪽에 들어가는 양', () => {
  it('0줄 — 한 번만 묻고 끝낸다', async () => {
    const f = fake(0)
    const { data, error } = await selectAll(f.build)
    expect(error).toBe(null)
    expect(data).toEqual([])
    expect(f.calls).toEqual([[0, 999]])
  })
  it('999줄 — 한 번만 묻는다', async () => {
    const f = fake(999)
    const { data } = await selectAll(f.build)
    expect(data.length).toBe(999)
    expect(f.calls.length).toBe(1)
  })
})

describe('★ 딱 1,000줄 — 여기서 멈추면 안 된다', () => {
  it('1,000줄이면 한 번 더 물어 끝을 확인한다', async () => {
    const f = fake(1000)
    const { data } = await selectAll(f.build)
    expect(data.length).toBe(1000)
    expect(f.calls).toEqual([[0, 999], [1000, 1999]])
  })
})

describe('★ 운영 실제 크기 — 잘리지 않는지', () => {
  it('거래 1,079줄 (마약·향정 창) — 1,079줄 전부', async () => {
    const { data } = await selectAll(fake(1079).build)
    expect(data.length).toBe(1079)
  })
  it('재고 1,141줄 (실사 비교) — 1,141줄 전부, 141줄이 사라지지 않는다', async () => {
    const { data } = await selectAll(fake(1141).build)
    expect(data.length).toBe(1141)
  })
  it('스냅샷 11,014줄 — 11,014줄 전부, 12쪽에 나눠 받는다', async () => {
    const f = fake(11014)
    const { data } = await selectAll(f.build)
    expect(data.length).toBe(11014)
    expect(f.calls.length).toBe(12)
    expect(data[0].id).toBe(1)
    expect(data[11013].id).toBe(11014)
  })
  it('1년 뒤 22,028줄도 끝까지', async () => {
    const { data } = await selectAll(fake(22028).build)
    expect(data.length).toBe(22028)
  })
})

describe('질의를 매번 새로 만든다 — 한 번 쓴 질의를 다시 쓰면 터진다', () => {
  it('쪽 수만큼 새로 만든다', async () => {
    const f = fake(2500)
    await selectAll(f.build)
    expect(f.made()).toBe(3)
  })
})

describe('★ 실패하면 반쪽을 돌려주지 않는다', () => {
  it('둘째 쪽에서 끊기면 data=null — 반쪽 합계가 맞는 합계처럼 보이면 안 된다', async () => {
    const f = fake(5000, { failAt: 2 })
    const { data, error } = await selectAll(f.build)
    expect(data).toBe(null)
    expect(error.message).toBe('끊겼다')
  })
  it('질의 만드는 함수를 안 넘기면 오류', async () => {
    const { data, error } = await selectAll(null)
    expect(data).toBe(null)
    expect(error.message).toContain('함수를 넘겨야')
  })
})

describe('한도', () => {
  it('한 쪽은 1,000줄 · 최대 300쪽', () => {
    expect(PAGE_SIZE).toBe(1000)
    expect(MAX_PAGES).toBe(300)
  })
  it('★ 한도를 넘으면 조용히 끝내지 않고 오류로 알린다', async () => {
    const f = fake(100, { })
    /* 한 쪽을 10줄로 줄이고 2쪽만 허용 → 100줄은 다 못 읽는다 */
    const { data, error } = await selectAll(f.build, { pageSize: 10, maxPages: 2 })
    expect(data).toBe(null)
    expect(error.message).toContain('넘었습니다')
  })
  it('쪽 크기를 바꿔도 결과는 같다', async () => {
    const a = await selectAll(fake(1234).build)
    const b = await selectAll(fake(1234).build, { pageSize: 97 })
    expect(b.data.length).toBe(a.data.length)
    expect(b.data).toEqual(a.data)
  })
})
