/* @vitest-environment node */
/* 발주관리 「사용량 분석 → 금액」 — 달별 합계를 DB 에서 받는다.
   ★ 2026-11-05 이전에는 스냅샷 11,014줄을 전부 받아 브라우저에서 더했고,
     1,000줄에서 조용히 잘려 대부분의 달이 0원으로 보였다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TREND_MONTHS, amountMap } from './usageTrend'

const rd = p => readFileSync(resolve(process.cwd(), p), 'utf8')

/* ★ 2026-08-27·11-05 운영 실측 — 생 SQL `sum(coalesce(total_out_amount,0))` 를
     (연,월)로 묶은 값 그대로다. 숫자를 손으로 다듬지 않았다. */
const REAL = [
  ['2026-01', '47478010.168000000016', 47478010],
  ['2026-02', '35015600.274', 35015600],
  ['2026-03', '33194044.133000000001', 33194044],
  ['2026-04', '30115498.569800000009', 30115499],
  ['2026-05', '30242670.626800000016', 30242671],
  ['2026-06', '29357583.782200000001', 29357584],
  ['2026-07', '32002763', 32002763],
  ['2026-08', '29404648.84189999999', 29404649],
  ['2026-09', '33519715.90', 33519716],
  ['2026-10', '29274135.369999999996', 29274135],
]

describe('★ 열 달 모두 「옳은 금액」과 원 단위까지 같다', () => {
  const rows = REAL.map(([ym, amt]) => ({ ym, out_amount: amt }))
  const map = amountMap(rows)

  for (const [ym, raw, won] of REAL) {
    it(`${ym} — 화면에 ₩${won.toLocaleString()} 로 보인다`, () => {
      expect(map[ym]).toBe(Number(raw))
      /* 화면은 Math.round 로 원 단위까지만 보여 준다 */
      expect(Math.round(map[ym])).toBe(won)
    })
  }

  it('열 달이 다 있다 — 한 달도 0원으로 빠지지 않는다', () => {
    expect(Object.keys(map).length).toBe(10)
    for (const [ym] of REAL) expect(map[ym], ym + ' 가 0원이다').toBeGreaterThan(0)
  })

  it('열 달 합계도 같다', () => {
    const sum = Object.values(map).reduce((a, b) => a + b, 0)
    expect(Math.round(sum)).toBe(329604671)
  })

  /* ★ 옛 방식(줄 단위로 받아 브라우저에서 더하기)이 1,000줄에서 잘리면 어떻게 되는지 */
  it('★ 옛 방식은 1,000줄에서 잘려 2026-07 이 32,002,763 대신 거의 0원이 됐다', () => {
    /* 달마다 1,065~1,133줄이라 **첫 달조차** 한 쪽에 안 들어간다 */
    const perMonth = [1065, 1078, 1085, 1090, 1101, 1103, 1117, 1117, 1125, 1133]
    expect(perMonth.every(n => n > 1000), '달마다 1,000줄을 넘는다').toBe(true)
    expect(perMonth.reduce((a, b) => a + b, 0)).toBe(11014)
  })
})

describe('amountMap — 지저분한 값에 안 터진다', () => {
  it('빈 값·null 이면 빈 꾸러미', () => {
    expect(amountMap(null)).toEqual({})
    expect(amountMap([])).toEqual({})
  })
  it('ym 이 없는 줄은 버린다', () => {
    expect(amountMap([{ out_amount: 100 }, { ym: null, out_amount: 5 }])).toEqual({})
  })
  it('금액이 null 이면 0 으로 센다 — NaN 이 되지 않는다', () => {
    const m = amountMap([{ ym: '2026-10', out_amount: null }])
    expect(m['2026-10']).toBe(0)
    expect(Number.isNaN(m['2026-10'])).toBe(false)
  })
  it('같은 달이 두 줄이면 더한다', () => {
    expect(amountMap([{ ym: '2026-10', out_amount: 1 }, { ym: '2026-10', out_amount: 2 }]))
      .toEqual({ '2026-10': 3 })
  })
  it('★ 반올림하지 않는다 — 화면이 보여 줄 때만 반올림한다', () => {
    expect(amountMap([{ ym: '2026-04', out_amount: '30115498.5698' }])['2026-04'])
      .toBe(30115498.5698)
  })
})

describe('화면이 DB 함수를 쓰는지 — 소스로 못 박는다', () => {
  const APP = rd('src/App.jsx')

  it('★ 스냅샷을 줄 단위로 받아 더하는 옛 코드가 없다', () => {
    expect(APP, 'total_out_amount 를 줄 단위로 받고 있다')
      .not.toContain("select('snap_year,snap_month,total_out_amount')")
  })
  it('달별 합계를 DB 함수로 받는다', () => {
    expect(APP).toContain("supabase.rpc('usage_monthly_amount', { p_months: TREND_MONTHS })")
    expect(APP).toContain('setUtAmt(amountMap(')
  })
  it('★ 수량과 금액이 같은 개월 수를 쓴다 — 어긋나면 막대가 다른 달을 가리킨다', () => {
    expect(APP).toContain("supabase.rpc('usage_monthly_trend', { p_months: TREND_MONTHS })")
    expect(TREND_MONTHS).toBe(6)
  })
})

describe('0113 usage_monthly_amount — 소스로 못 박는다', () => {
  const SQL = rd('supabase/migrations/0113_usage_monthly_amount.sql')
  const CODE = SQL.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')

  it('수식이 화면이 하던 것과 같다 — total_out_amount 를 더한다', () => {
    expect(CODE).toContain('sum(coalesce(s.total_out_amount, 0))')
    expect(CODE, '반올림하면 원 단위가 틀어진다').not.toMatch(/round\(/)
  })
  it('★ 창(窓)이 수량 함수와 글자 그대로 같다 — 두 막대가 어긋나면 안 된다', () => {
    const QTY = rd('supabase/migrations/0026_forecast_usage_rpc.sql')
    const win = /where make_date\(s\.snap_year, s\.snap_month, 1\)\s*\n?\s*>= \(date_trunc\('month', current_date\) - \(\(greatest\(p_months,1\) - 1\) \|\| ' months'\)::interval\)/
    expect(QTY, '0026 의 창 모양이 바뀌었다').toMatch(win)
    expect(CODE, '0113 의 창이 0026 과 다르다').toMatch(win)
  })
  it('★ 기존 함수를 지우거나 바꾸지 않는다 — 쌍둥이를 새로 더할 뿐이다', () => {
    expect(CODE).not.toMatch(/drop function/i)
    expect(CODE, 'usage_monthly_trend 를 손대면 안 된다')
      .not.toMatch(/function public\.usage_monthly_trend/)
  })
  it('읽기 전용이다 — invoker · stable, 쓰기 문장 없음', () => {
    expect(CODE).toContain('language sql stable')
    expect(CODE, 'DEFINER 면 RLS 를 건너뛴다').not.toMatch(/security definer/i)
    expect(CODE).not.toMatch(/\b(insert|update|delete|truncate)\b/i)
  })
  it('anon·PUBLIC 은 못 부르고 authenticated 만 부른다', () => {
    expect(CODE).toMatch(/revoke all on function public\.usage_monthly_amount\(integer\) from public/)
    expect(CODE).toMatch(/revoke all on function public\.usage_monthly_amount\(integer\) from anon/)
    expect(CODE).toMatch(/grant execute on function public\.usage_monthly_amount\(integer\) to authenticated/)
  })
  it('PostgREST 캐시 갱신을 빠뜨리지 않았다 (함정 #22)', () => {
    expect(SQL).toMatch(/notify pgrst, 'reload schema'/)
  })
})

describe('급한 네 곳이 쪽 나눠 읽는지 — 소스로 못 박는다', () => {
  const APP = rd('src/App.jsx')
  const SNAP = rd('src/SnapshotUploadModal.jsx')

  it('② 스냅샷 올리기 미리보기 — selectAll 로 받는다', () => {
    expect(SNAP).toContain("import { selectAll } from './lib/selectAll'")
    expect(SNAP).toMatch(/selectAll\(\(\) => supabase\.from\('monthly_snapshots'\)/)
    expect(SNAP, '순서가 없으면 쪽마다 줄이 겹치거나 빠진다').toMatch(/\.order\('id', \{ ascending: true \}\)\)/)
  })
  it('③ 실사 화면 재고 비교 — inventory_stock 을 끝까지', () => {
    expect(APP).toMatch(/selectAll\(\(\) => supabase\.from\('inventory_stock'\)\.select\('\*'\)\.order\('id'/)
    expect(APP, '옛 한 번 받기가 남아 있다')
      .not.toContain("await supabase.from('inventory_stock').select('*')\r\n")
  })
  it('④ 마감된 달 목록 두 곳 — 둘 다 끝까지', () => {
    const hits = [...APP.matchAll(/selectAll\(\(\) => supabase\.from\('monthly_snapshots'\)\.select\('snap_year,snap_month'\)/g)]
    expect(hits.length, '두 곳 가운데 하나만 고쳐졌다').toBe(2)
  })
  it('★ 옛 한 번 받기가 한 군데도 남지 않았다', () => {
    /* 이미 3386 에 `.range` 로 쪽 나눠 읽는 곳이 하나 더 있다 — 그것도 통과해야 한다 */
    expect(APP).not.toMatch(/supabase\.from\('monthly_snapshots'\)\.select\('snap_year,snap_month'\)(?!\.order|\.range)/)
  })
})
