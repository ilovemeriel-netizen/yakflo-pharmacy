/* 2단계 — 수기 도장 풀기 + 반올림 꼬리 규칙 맞추기 (2026-11-14 이정화 님 승인)
 *
 * 무엇을 하나
 *   ① `0131` — **출고 자동집계**에도 반올림 꼬리 규칙을 넣는다
 *   ② `0133` — **저장 함수(적용)**에도 같은 규칙을 넣는다
 *   ③ 화면 — 「적용」이 3개월 숫자를 **사실대로** 보낸다(기준 지키기는 DB 가 한다)
 *   ④ `0132` — 묵은 수기 도장 **474종**을 푼다(마약·향정·한외마약·백신 25종은 그대로)
 *   ⑤ 뱃지 — 「자동」 → **「수기」** (StockUsageBadge.test.jsx 가 자세히 지킨다)
 *
 * 왜 세 곳에 같은 규칙을 넣나 — **잣대는 하나여야 한다.**
 *   화면 예고(lib/usageCompare) · 적용 저장(0133) · 자동집계(0131) 가 서로 다르면
 *   「화면에는 유지라고 떠 있는데 저장은 0」 같은 어긋남이 또 생긴다(PR #466 사례).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compareOne, applyRows } from './lib/usageCompare.js'

const root = p => resolve(process.cwd(), p)
const S31 = readFileSync(root('supabase/migrations/0131_recompute_tiny_keep.sql'), 'utf8')
const S32 = readFileSync(root('supabase/migrations/0132_release_manual_stamp.sql'), 'utf8')
const S33 = readFileSync(root('supabase/migrations/0133_save_usage_bulk_tiny_keep.sql'), 'utf8')
const UC = readFileSync(root('src/lib/usageCompare.js'), 'utf8')

/* 마감 줄이 3개 이상이면 「기록이 있는 약」이다 */
const D = o => ({ drug_code: 'X', drug_name: '약', category: '경구제',
  monthly_avg: 10, safety_stock: 12, max_stock: 30,
  recent_3m_usage: 30, recent_1m_usage: 10, prev_year_usage: 120,
  __unusedSnaps: { 3: 3, 6: 6, 9: 9, 12: 10 }, ...o })

/* ══ ① 화면 예고 — 세 갈래가 갈린다 ═══════════════════════════════════ */
describe('★★ ① 화면 예고 — 0 이 세 가지다', () => {
  it('★ 출고 0 + 기록 있음 → **0 으로 내린다**(안 쓰는 약)', () => {
    const r = compareOne(D({}), 0, 0)
    expect(r.nm).toBe(0)
    expect(r.nsf).toBe(0)
    expect(r.tiny).toBe(false)
    expect(r.noBasis).toBe(false)
  })

  it('★★ 출고 1 → 반올림 0 → **기존 기준을 그대로 둔다**', () => {
    const r = compareOne(D({}), 1, 0)
    expect(r.tiny, '반올림 꼬리로 봐야 한다').toBe(true)
    expect(r.nm, '월평균 그대로').toBe(10)
    expect(r.nsf, '안전재고 그대로').toBe(12)
    expect(r.nmx, '최대재고 그대로').toBe(30)
    expect(r.n3, '3개월 숫자는 **사실**대로 1').toBe(1)
  })

  it('★ 바탕이 아예 없는 약(기록도 전년도 없음) → 아무것도 안 바꾼다', () => {
    const r = compareOne(D({ __unusedSnaps: { 3: 0 }, prev_year_usage: 0 }), 0, 0)
    expect(r.noBasis).toBe(true)
    expect(r.nm).toBe(10)
    expect(r.nsf).toBe(12)
  })

  it('보통 약은 전과 같이 다시 센다', () => {
    const r = compareOne(D({}), 90, 30)
    expect(r.nm).toBe(30)
    expect(r.nsf).toBe(36)
    expect(r.tiny).toBe(false)
  })
})

/* ══ ② 적용이 보내는 값 ═════════════════════════════════════════════ */
describe('★★ ② 「적용」이 보내는 값 — 사실은 그대로, 기준은 DB 가 지킨다', () => {
  it('★★ 극소량도 3개월 숫자를 **그대로** 보낸다', () => {
    const r = compareOne(D({}), 1, 0)
    expect(applyRows([r], [r.code])).toEqual([{ code: 'X', r3: 1, r1: 0 }])
  })

  it('★ 바탕 없는 약만 3개월을 **안 보낸다**', () => {
    const r = compareOne(D({ __unusedSnaps: { 3: 0 }, prev_year_usage: 0 }), 0, 0)
    expect(applyRows([r], [r.code])).toEqual([{ code: 'X', r3: null, r1: 0 }])
  })

  it('★ 옛 꼴(tiny 면 숨김)이 남아 있지 않다', () => {
    expect(UC.includes('r3: r.tiny ? null : r.n3'), '옛 줄이 남아 있다').toBe(false)
    expect(UC).toContain('r3: r.noBasis ? null : r.n3')
  })
})

/* ══ ③ 0131 — 자동집계 ═══════════════════════════════════════════════ */
describe('★★ ③ 0131 — 자동집계도 같은 규칙', () => {
  it('★★ 출고 0 이면 0, 출고 있는데 반올림 0 이면 **빈 값**(그대로 둔다)', () => {
    const want = [
      `then case when coalesce(a.r3,0) = 0 then 0`,
      `else nullif(round(coalesce(a.r3,0) / 3.0), 0) end`,
      `when coalesce(a.r3,0) > 0 then nullif(round(coalesce(a.r3,0) / 3.0), 0)`,
    ]
    for (const w of want) expect(S31, w).toContain(w)
  })

  it('★ (A) 와 (A2) **두 군데** 모두 고쳤다', () => {
    expect((S31.match(/nullif\(round\(coalesce\(a\.r3,0\) \/ 3\.0\), 0\)/g) || []).length).toBe(2)
    expect((S31.match(/nullif\(round\(coalesce\(txa\.r3,0\) \/ 3\.0\), 0\)/g) || []).length).toBe(2)
  })

  it('★★ 빈 값이 「그대로 둔다」가 되는 줄이 살아 있다', () => {
    expect(S31).toContain('monthly_avg  = coalesce(c.mavg, d.monthly_avg)')
    expect(S31).toContain('safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end')
  })

  it('★ 3개월 숫자는 **언제나 갱신**한다 — 사실이기 때문', () => {
    expect(S31).toContain('recent_3m_usage = c.r3')
  })

  it('반올림(round) 자체와 마약 갈래는 안 건드렸다', () => {
    expect(S31).toContain("p_scope = 'narcotic'")
    expect(S31).toContain('ceil(c.mavg * 1.2)')
    expect(S31).toContain('CREATE OR REPLACE FUNCTION public.app_recompute_usage(')
  })
})

/* ══ ④ 0133 — 저장 함수 ═════════════════════════════════════════════ */
describe('★★ ④ 0133 — 저장(적용)도 같은 규칙', () => {
  it('★★ 월평균 — 출고 있는데 반올림 0 이면 기존 값', () => {
    expect(S33).toContain(`then coalesce(nullif(round(i.r3 / 3), 0), case when i.r3 > 0 then d.monthly_avg else 0 end)`)
  })

  it('★★ 안전재고·최대재고도 같이 지킨다', () => {
    expect(S33).toContain(`then (case when round(i.r3 / 3) = 0 and i.r3 > 0 then d.safety_stock`)
    expect(S33).toContain(`then (case when round(i.r3 / 3) = 0 and i.r3 > 0 then d.max_stock`)
  })

  it('★ 3개월 칸은 **받은 값 그대로** 쓴다', () => {
    expect(S33).toContain('recent_3m_usage = case when v_do_r3 and i.r3 is not null then i.r3 else d.recent_3m_usage end')
  })

  it('★ 전년(py) 갈래와 p_source 는 안 건드렸다', () => {
    expect(S33).toContain('when v_do_py and i.py is not null then round(i.py / 12)')
    expect(S33).toContain(`p_source text DEFAULT 'manual'`)
    expect(S33).toContain('CREATE OR REPLACE FUNCTION public.app_save_usage_bulk(')
  })
})

/* ══ ⑤ 0132 — 도장 풀기 ═════════════════════════════════════════════ */
describe('★★ ⑤ 0132 — 묵은 수기 도장 풀기', () => {
  it('★★ 마약·향정·**한외마약**·백신은 손대지 않는다', () => {
    for (const w of ["is distinct from '마약'", "is distinct from '향정'", "is distinct from '한외마약'"]) {
      expect(S32, w).toContain(w)
    }
    expect(S32, '백신은 ATC J07 로 가린다 — 이름으로 가리면 지씨플루가 샌다')
      .toContain(`coalesce(d.atc_code, '') not like 'J07%'`)
  })

  it('★★ 숫자는 건드리지 않는다 — 출처 글자만 바꾼다', () => {
    expect(S32).toContain(`set usage_source = 'auto'`)
    for (const col of ['monthly_avg', 'safety_stock', 'max_stock', 'recent_3m_usage']) {
      expect(S32.includes('set ' + col), col + ' 을 건드리면 안 된다').toBe(false)
    }
  })

  it('★★ 되돌릴 수 있다 — 푼 약을 먼저 적어 둔다', () => {
    expect(S32).toContain('create table if not exists public.usage_source_release_0132')
    expect(S32).toContain('insert into public.usage_source_release_0132')
    expect(S32).toContain('-- update public.drugs d set usage_source = r.old_source')
  })

  it('사용 중 약만, manual 만 푼다', () => {
    expect(S32).toContain(`d.status = '사용'`)
    expect(S32).toContain(`d.usage_source = 'manual'`)
  })
})
