/* 0118 — 옛 「출고 자동집계」 단추의 선 두 가지. 마이그레이션 **글자**를 못 박는다.
 *
 * 왜 소스를 읽어 확인하나: DB 함수는 시험에서 돌릴 수 없다. 그래서 파일이
 * 「값을 바꾸지 않는다」·「두 곳만 고쳤다」를 지키는지 글자로 본다.
 * (0110·0113·0115·AtcBadges·ShadeBadge 와 같은 방식)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/0118_recompute_usage_guards.sql'), 'utf8')
/* 주석을 뺀 실행문만 — 「무엇을 안 한다」는 주석이 아니라 코드로 봐야 한다 */
const CODE = SQL.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')

describe('★ 자료를 바꾸지 않는다 — 함수 정의만 바꾼다', () => {
  it('표에 직접 쓰는 문장이 없다 (함수 안의 update 는 함수 본문이다)', () => {
    /* create or replace 바깥에 insert·delete·truncate·drop 이 없어야 한다 */
    expect(/^\s*(insert|delete|truncate|drop|alter table)\b/im.test(CODE.replace(/\$function\$[\s\S]*\$function\$/, ''))).toBe(false)
  })

  it('create or replace function 하나뿐이다', () => {
    expect((CODE.match(/create or replace function/gi) || []).length).toBe(1)
  })

  it('권한·정책을 건드리지 않는다', () => {
    for (const w of ['grant', 'revoke', 'row level security', 'create policy', 'drop policy']) {
      expect(CODE.toLowerCase()).not.toContain(w)
    }
  })

  it('트리거를 끄지 않는다', () => {
    expect(CODE.toLowerCase()).not.toContain('disable trigger')
    expect(CODE.toLowerCase()).not.toContain('alter table')
  })
})

describe('★ 고친 곳 ① — (A2) 가 수기 값을 건너뛴다', () => {
  it('(A2) 안에 dd.usage_source 조건이 있다', () => {
    expect(CODE).toContain("and (p_overwrite_manual or dd.usage_source is distinct from 'manual')")
  })

  it('manual 보존 조건이 모두 네 군데다 — (A)·(A2)·(B) + 마약향정 갈래', () => {
    expect((CODE.match(/is distinct from 'manual'/g) || []).length).toBe(4)
  })
})

describe('★ 고친 곳 ② — (A) 가 전년을 덮지 않는다', () => {
  it('전년에 값을 넣는 줄이 없다', () => {
    expect(CODE).not.toContain('prev_year_usage = c.py')
  })

  it('★ 월평균을 전년으로 채우는 갈래는 그대로 있다 — 지운 건 대입 한 줄뿐', () => {
    expect(CODE).toContain('when coalesce(py,0) > 0 then round(coalesce(py,0) / 12.0)')
  })

  it('(A2) 폴백의 전년 갈래도 그대로다', () => {
    expect(CODE).toContain('when coalesce(dd.prev_year_usage,0) > 0 then round(coalesce(dd.prev_year_usage,0) / 12.0)')
  })
})

describe('★ 나머지는 그대로다', () => {
  it('마약·향정 달력 갈래(0111)가 살아 있다', () => {
    expect(CODE).toContain("if p_scope = 'narcotic' then")
    expect(CODE).toContain("where d.narcotic_type in ('마약', '향정')")
    expect(CODE).toContain("usage_source = 'manual'")
  })

  it('세는 거래는 출고 하나뿐이다', () => {
    const types = CODE.match(/t\.type = '[^']+'/g) || []
    expect(new Set(types)).toEqual(new Set(["t.type = '출고'"]))
  })

  it('계산식이 그대로다 — 1.2배 · 3배 · ÷3 · ÷12', () => {
    expect(CODE).toContain('ceil(c.mavg * 1.2)')
    expect(CODE).toContain('round(c.mavg * 3)')
    expect(CODE).toContain('ceil(fb.mavg * 1.2)')
    expect(CODE).toContain('round(fb.mavg * 3)')
  })

  it('권한 검사가 살아 있다', () => {
    expect(CODE).toContain('insufficient_privilege')
    expect(CODE).toContain("'출고 자동집계는 관리자만 실행할 수 있습니다")
  })

  it('서명과 기본값이 운영과 같다', () => {
    expect(CODE).toContain('p_overwrite_manual boolean default false')
    expect(CODE).toContain("p_scope            text    default 'all'")
    expect(CODE).toContain('p_year             integer default null')
    expect(CODE).toContain('p_month            integer default null')
    expect(CODE).toContain('returns integer')
    expect(CODE).toContain("set search_path to 'public'")
  })

  it('SECURITY DEFINER 를 새로 붙이지 않았다', () => {
    expect(CODE.toLowerCase()).not.toContain('security definer')
  })
})
