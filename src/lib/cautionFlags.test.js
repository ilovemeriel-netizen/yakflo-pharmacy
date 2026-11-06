/* 0115 주의 표시(용량·모양·발음) — 소스로 못 박는다.
 *
 * 왜 소스를 읽어 시험하나: 이 마이그레이션의 핵심은 「무엇을 **안** 하는가」다.
 * 기존 기록 함수·가드·트리거 배선을 건드리지 않고, drugs 의 값도 바꾸지 않는다.
 * 그 약속은 실행해 봐야 알 수 있는 것이 아니라 **파일에 적혀 있어야** 하는 것이므로
 * 파일을 직접 읽어 확인한다(0110·0113·0114 와 같은 방식).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0115_drug_caution_flags.sql'), 'utf8')
const ROWS = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/_caution_rows.json'), 'utf8'))

/* ★ 주석을 뺀 **실행문만** — 「무엇을 안 하는가」는 주석이 아니라 코드로 봐야 한다.
   (이 파일의 머리말 주석에 기존 함수 이름이 적혀 있어, 그대로 보면 늘 걸린다) */
const CODE = SQL.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')

const KINDS = ['용량', '모양', '발음']
const COLS = ['caution_dose', 'caution_shape', 'caution_sound']

describe('0115 — 칸 3개를 더한다', () => {
  it.each(COLS)('%s 를 참/거짓·빈값 불가·기본 거짓으로 더한다', (col) => {
    expect(SQL).toContain(
      `add column if not exists ${col}`)
    const line = SQL.split('\n').find(l => l.includes(`add column if not exists ${col}`))
    expect(line).toMatch(/boolean\s+not null\s+default false/)
  })

  it('세 칸 모두 if not exists 로 더한다 (두 번 돌려도 안전하다)', () => {
    const n = (SQL.match(/add column if not exists/g) || []).length
    expect(n).toBe(3)
  })

  it('한 약에 주의가 여러 개 가능하도록 칸을 나눠 둔다 (한 칸에 몰아넣지 않는다)', () => {
    expect(CODE).not.toMatch(/caution_tags|caution_type\s+text/)
  })

  it('세 칸에 설명을 붙여 둔다', () => {
    for (const col of COLS) expect(SQL).toContain(`comment on column public.drugs.${col}`)
  })
})

describe('0115 — 기록은 남기되 기존 것은 건드리지 않는다', () => {
  it('주의 표시 전용 함수를 따로 만든다', () => {
    expect(SQL).toContain('create or replace function public.log_drugs_caution()')
  })

  it('★ 기존 기록 함수 log_drugs_usage 를 다시 쓰지 않는다', () => {
    expect(CODE).not.toContain('function public.log_drugs_usage')
  })

  it('★ 기존 가드 함수를 다시 쓰지 않는다', () => {
    expect(CODE).not.toContain('enforce_usage_edit_owner')
    expect(CODE).not.toContain('enforce_price_edit_role')
    expect(CODE).not.toContain('guard_drugs_qty_direct')
  })

  it('★ 기존 트리거 배선을 다시 걸지 않는다', () => {
    for (const t of ['trg_log_drugs_usage', 'trg_log_drugs_status',
                     'trg_log_drugs_location', 'trg_log_drugs_qty',
                     'trg_enforce_usage_edit_owner', 'trg_enforce_price_edit_role']) {
      expect(CODE).not.toContain(t)
    }
  })

  it('새 트리거는 주의 3칸이 바뀔 때만 깨어난다', () => {
    expect(SQL).toContain(
      'after update of caution_dose, caution_shape, caution_sound on public.drugs')
  })

  it('기록 함수는 security definer + search_path 고정 (0105·0112 와 같은 틀)', () => {
    const i = SQL.indexOf('create or replace function public.log_drugs_caution()')
    const body = SQL.slice(i, SQL.indexOf('$function$;', i))
    expect(body).toContain('security definer')
    expect(body).toContain("set search_path to 'public'")
  })

  it('세 칸 모두 바뀔 때 기록한다 (is distinct from 으로 비교)', () => {
    for (const col of COLS) {
      expect(SQL).toContain(`new.${col} is distinct from old.${col}`)
      expect(SQL).toContain(`'${col}'`)
    }
  })

  it('누가·언제가 남는다 (changed_by 에 auth.uid())', () => {
    expect(SQL).toContain('changed_by')
    expect(SQL).toContain('auth.uid()')
  })

  it('★ 사용량 출처(old_source/new_source)는 적지 않는다 — 주의 표시와 무관하다', () => {
    const i = SQL.indexOf('create or replace function public.log_drugs_caution()')
    const body = SQL.slice(i, SQL.indexOf('$function$;', i))
    expect(body).not.toContain('old_source')
    expect(body).not.toContain('new_source')
    expect(body).not.toContain('usage_source')
  })
})

describe('0115 — 값과 기록을 건드리지 않는다', () => {
  it('★ drugs 의 값을 바꾸지 않는다 (반영은 별도 단계다)', () => {
    expect(CODE).not.toMatch(/update\s+public\.drugs\s+set/i)
  })

  it('★ 지난 기록을 소급해서 채우지 않는다', () => {
    expect(CODE).not.toMatch(/insert\s+into\s+public\.drug_usage_audit\s*\(\s*tenant_id[\s\S]{0,200}select/i)
  })

  it('★ 지우는 말이 없다', () => {
    expect(CODE).not.toMatch(/\b(delete\s+from|truncate|drop\s+table|drop\s+column)\b/i)
  })

  it('★ 권한을 회수하지 않는다 (0114 와 방향이 다르다)', () => {
    expect(CODE).not.toMatch(/\brevoke\b/i)
  })

  it('칸을 더했으므로 스키마 캐시를 갱신한다 (함정 #22)', () => {
    expect(SQL).toContain("notify pgrst, 'reload schema'")
  })

  it('하나의 거래로 묶여 있다', () => {
    expect(SQL).toMatch(/^\s*begin;\s*$/m)
    expect(SQL).toMatch(/^\s*commit;\s*$/m)
  })
})

describe('엑셀에서 뽑은 73종 목록 — 뽑기 결과를 못 박는다', () => {
  it('73종이다', () => {
    expect(ROWS).toHaveLength(73)
  })

  it('용량 28 · 모양 38 · 발음 7', () => {
    const n = k => ROWS.filter(r => r.kind === k).length
    expect(n('용량')).toBe(28)
    expect(n('모양')).toBe(38)
    expect(n('발음')).toBe(7)
  })

  it('주의 종류는 셋뿐이다', () => {
    expect([...new Set(ROWS.map(r => r.kind))].sort()).toEqual([...KINDS].sort())
  })

  it('외용제 시트에서 나온 줄은 없다 (그 시트에는 해당 열이 없다)', () => {
    expect(ROWS.filter(r => r.sheet === '외용제')).toHaveLength(0)
  })

  it('★ 한 약에 주의가 두 개 이상인 줄은 없다 (셀 색은 하나뿐이다)', () => {
    const seen = new Set()
    for (const r of ROWS) {
      const k = r.sheet + '|' + r.row
      expect(seen.has(k)).toBe(false)
      seen.add(k)
    }
  })

  it('★ 약품명(C열)에서만 뽑았다 — 성분명(D열) 2곳은 실수로 확인되어 뺐다', () => {
    expect(ROWS.some(r => r.name === 'Ursodeoxycholic Acid')).toBe(false)
    expect(ROWS.some(r => r.name === 'Gabapentin')).toBe(false)
  })

  it('모든 줄에 코드와 약품명이 있다', () => {
    for (const r of ROWS) {
      expect(String(r.code).trim().length).toBeGreaterThan(0)
      expect(String(r.name).trim().length).toBeGreaterThan(0)
    }
  })

  it('용량 28종은 「같은 이름에 함량만 다른 약」 14쌍이다', () => {
    const stem = n => n
      .replace(/\s*[\d.]+(?:\s*[-/]\s*[\d.]+)*\s*(?:mg|밀리그램|g|μg|mcg|ug|IU|단위)?\s*$/i, '')
      .replace(/\s+/g, '')
    const grp = {}
    for (const r of ROWS.filter(x => x.kind === '용량')) {
      const k = stem(r.name)
      grp[k] = (grp[k] || 0) + 1
    }
    const keys = Object.keys(grp)
    expect(keys).toHaveLength(14)
    for (const k of keys) expect(grp[k]).toBe(2)
  })
})
