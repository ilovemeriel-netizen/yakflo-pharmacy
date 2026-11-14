/* 「직전 3개월 출고가 0 이면 월평균·안전재고도 0」 — 네 곳을 한 규칙으로 맞춘다
 * (2026-11-14 이정화 님 승인)
 *
 * 왜 — 업무 규칙은 「3개월 실제 출고 0 이면 발주·긴급 대상이 아니다」인데,
 *   월평균이 **전년÷12** 로 넘어가 안전재고가 되살아났다.
 *   실측: 5D/W10 대한5%포도당주사액1000mL — 창의 출고 0 인데 화면이 월평균 0→1 · 안전 0→2 로 예고.
 *
 * 네 곳
 *   ① 화면 미리보기 lib/usageCompare monthlyAvgOf  ← 넘어갔다 (고침)
 *   ② 적용 저장 app_save_usage_bulk               ← 이미 0 을 0 으로 저장 (그대로)
 *   ③ 다시 세기 app_recompute_usage              ← 넘어갔다 (0129 마이그레이션)
 *   ④ 한 줄 저장 saveRowUsage                    ← 이미 0 을 0 으로 저장 · ①과 같은 함수로 모음
 *
 * 「기록이 있다」의 잣대는 재고현황 「N개월 사용량 0」과 **같다** — 최근 마감 3개월에 줄 3개.
 * 마약·향정은 ③에서 **빠진다**(출고를 NIMS 로 따로 본다 — 이정화 님 결정).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { monthlyAvgOf, hasRecord, compareOne, applyRows, MIN_SNAPS } from './usageCompare.js'

const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
/* ★ 저장소 파일이 CRLF 라 여러 줄 대조가 어긋난다 — 줄바꿈을 맞춰 읽는다 */
const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/0129_recompute_no_prevyear_fallback.sql'), 'utf8')
  .split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10))

/* 마감 줄이 n개인 약 */
const snaps = n => ({ 3: n, 6: n * 2, 9: n * 3, 12: n * 3 })
const D = o => ({
  drug_code: 'X', drug_name: '약', category: '주사제', current_qty: 10,
  recent_3m_usage: 1, recent_1m_usage: 0, prev_year_usage: 6,
  monthly_avg: 0, safety_stock: 0, max_stock: 0, atc_code: '',
  __unusedSnaps: snaps(3), ...o,
})

describe('★★ ① 월평균 — 3개월이 0 이면 0', () => {
  it('잣대는 마감 줄 3개 — 재고현황과 같다', () => {
    expect(MIN_SNAPS).toBe(3)
    expect(hasRecord(D({}))).toBe(true)
    expect(hasRecord(D({ __unusedSnaps: snaps(2) })), '줄 2개는 기록이 모자라다').toBe(false)
    expect(hasRecord(D({ __unusedSnaps: null })), '재료가 없으면 기록 없음').toBe(false)
    expect(hasRecord(null)).toBe(false)
  })
})

describe('★★ ② 화면 미리보기 — 예고가 **저장될 값과 같다**', () => {
  /* 5D/W10 과 같은 모양: 저장된 3개월 1 · 전년 6 · 창의 출고 0 · 마감 줄 3개 */
  const d = D({ drug_code: '5D/W10', drug_name: '대한5%포도당주사액1000mL', recent_3m_usage: 1, prev_year_usage: 6 })
  it('★ 창의 출고가 0 이면 월평균·안전재고를 **0 으로** 예고한다', () => {
    const r = compareOne(d, 0, 0)
    expect(r.n3).toBe(0)
    expect(r.nm, '전년÷12 로 넘어갔다').toBe(0)
    expect(r.nsf).toBe(0)
    expect(r.nmx).toBe(0)
  })
  it('★ 예고한 값과 **저장에 보내는 값**이 같다', () => {
    const r = compareOne(d, 0, 0)
    const sent = applyRows([r], new Set([r.code]))
    /* r3=0 을 보낸다 → app_save_usage_bulk 가 round(0/3)=0 을 저장한다(②는 이미 맞다) */
    expect(sent).toEqual([{ code: '5D/W10', r3: 0, r1: 0 }])
    expect(r.nm, '화면이 예고한 월평균').toBe(Math.round(sent[0].r3 / 3))
  })
  it('★ 마감 줄이 모자란 약은 **건드리지 않는다** — 전년으로 받친다', () => {
    const r = compareOne(D({ __unusedSnaps: snaps(2), prev_year_usage: 120 }), 0, 0)
    expect(r.nm).toBe(10)                     /* round(120/12) */
    expect(r.nsf).toBe(12)
  })
  it('출고가 1~2개인 극소량은 지금처럼 **기존 값을 지킨다**', () => {
    const r = compareOne(D({ monthly_avg: 7, safety_stock: 9 }), 1, 1)
    expect(r.tiny).toBe(true)
    expect(r.nm).toBe(7)
    expect(r.nsf).toBe(9)
  })
  it('전년이 1~5 라 반올림으로 0 이 되는 것도 기존 값을 지킨다', () => {
    const r = compareOne(D({ __unusedSnaps: null, prev_year_usage: 3, monthly_avg: 7, safety_stock: 9 }), 0, 0)
    expect(r.tiny).toBe(true)
    expect(r.nm).toBe(7)
  })
})

describe('★ ③ 다시 세기 마이그레이션(0129)', () => {
  it('★ 기록이 있는데 출고 0 이면 0 — 전년 갈래를 안 탄다', () => {
    expect(SQL).toContain('and coalesce(s.n, 0) >= 3')
    expect(SQL).toContain('then round(coalesce(a.r3,0) / 3.0)')
    expect(SQL).toContain('and coalesce(s2.n, 0) >= 3')
  })
  it('★★ 마약·향정은 이 규칙에서 빠진다', () => {
    const n = (SQL.match(/narcotic_type is distinct from '마약'/g) || []).length
    expect(n, '(A)·(A2) 두 곳에 있어야 한다').toBe(2)
    expect((SQL.match(/narcotic_type is distinct from '향정'/g) || []).length).toBe(2)
  })
  it('★★ 마약 갈래(p_scope=narcotic)는 한 글자도 안 바꾼다', () => {
    expect(SQL).toContain(`where d.narcotic_type in ('마약', '향정')`)
    expect(SQL).toContain(`case when coalesce(tx.m3, 0) > 0 then round(coalesce(tx.m3, 0) / 3.0)
             when coalesce(d.prev_year_usage, 0) > 0 then round(coalesce(d.prev_year_usage, 0) / 12.0)`)
  })
  it('★ 마감 표를 건드리지 않는다 — 금액이 안 바뀐다', () => {
    expect(/update\s+public\.monthly_snapshots/i.test(SQL), '마감 표에 쓴다').toBe(false)
    expect(/insert\s+into\s+public\.monthly_snapshots/i.test(SQL), '마감 표에 쓴다').toBe(false)
    expect(/delete\s+from\s+public\.monthly_snapshots/i.test(SQL), '마감 표에 쓴다').toBe(false)
  })
})

describe('★ ④ 한 줄 저장 — 같은 함수를 쓴다', () => {
  it('★ saveRowUsage 가 monthlyAvgOf 를 쓴다 — 식을 따로 적지 않는다', () => {
    const i = APP.indexOf('async function saveRowUsage(d){')
    expect(i, 'saveRowUsage 를 찾지 못했다').toBeGreaterThan(0)
    const fn = APP.slice(i, i + 900)
    expect(fn).toContain('const m=monthlyAvgOf(rv,pv);if(m!=null)')
    expect(fn.includes('Math.round(rv/3)'), 'saveRowUsage 에 옛 식이 남아 있다').toBe(false)
    expect(APP).toContain(`import { monthlyAvgOf } from './lib/usageCompare'`)
  })
  it('발견 메모 — 대량등록 쪽에 같은 식이 **2곳 더** 있다(동작은 이미 맞다)', () => {
    /* ★ 이번 범위 밖이라 고치지 않았다. rv 가 0 이면 0 을 쓰므로 **지금도 맞게 동작한다** —
         다만 식이 세 곳에 흩어져 있어 다음에 또 엇갈릴 수 있다. 백로그 한 줄로 남긴다. */
    expect((APP.match(/if\(rv!=null\)m=Math\.round\(rv\/3\)/g) || []).length).toBe(2)
  })
  it('칸을 비우면(null) 전년으로 받치고, 0 을 적으면 0 이다', () => {
    expect(monthlyAvgOf(null, 120)).toBe(10)
    expect(monthlyAvgOf(0, 120)).toBe(0)
  })
})
