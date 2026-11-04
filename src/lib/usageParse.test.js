/* 사용량 파일 읽기 — 순수 함수 시험.

   ★ 왜 이 시험이 있나
     지금 파서는 App.jsx 안에 섞여 있어(2266~2296) 시험할 수가 없었다. 그래서
     「머리글이 2행에 있으면?」「같은 코드가 두 번 나오면?」을 확인할 길이 없었다.
     여기서 **운영에서 실제로 걸린 모양**을 고정한다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  normCode, findHeaderRow, mapColumns, looksLikeDate, toNum,
  readSheet, mergeRows, buildPreview, confirmText, FIELD_LABEL,
} from './usageParse.js'

describe('약품코드 다듬기 — App.jsx 와 같은 규칙', () => {
  it('앞뒤 공백·쉼표를 떼고 대문자로', () => {
    expect(normCode('  grd2 ')).toBe('GRD2')
    expect(normCode('1,234')).toBe('1234')
    expect(normCode(null)).toBe('')
  })
})

describe('머리글 줄 찾기 — 1행 고정이 아니다', () => {
  it('1행에 있으면 0', () => {
    expect(findHeaderRow([['약품코드', '사용량']])).toBe(0)
  })
  it('★ 위에 제목 줄이 있어도 찾는다 (지금 파서가 못 하던 것)', () => {
    const aoa = [
      ['2026년 10월 병동·외래 사용량'],
      [''],
      ['약품코드', '약품명', '사용량'],
      ['GRD2', '게리드정', '10'],
    ]
    expect(findHeaderRow(aoa)).toBe(2)
  })
  it('앞 10줄 안에 없으면 -1 — 더 깊이 뒤지지 않는다', () => {
    const aoa = Array.from({ length: 12 }, () => [''])
    aoa[11] = ['약품코드']
    expect(findHeaderRow(aoa)).toBe(-1)
  })
  it('「코드」·「drug_code」도 머리글로 본다', () => {
    expect(findHeaderRow([['코드', '값']])).toBe(0)
    expect(findHeaderRow([['drug_code', 'v']])).toBe(0)
  })
})

describe('열 자리 찾기', () => {
  it('고른 칸의 별칭을 받는다', () => {
    const h = ['약품코드', '약품명', '직전1개월사용량']
    expect(mapColumns(h, 'recent_1m_usage')).toEqual({ code: 0, name: 1, value: 2 })
  })
  it('「사용량」·「총사용량」도 직전1개월로 본다 — 통합 파일이 그렇게 적는다', () => {
    expect(mapColumns(['약품코드', '사용량'], 'recent_1m_usage').value).toBe(1)
    expect(mapColumns(['약품코드', '총사용량'], 'recent_1m_usage').value).toBe(1)
  })
  it('없는 열은 -1', () => {
    expect(mapColumns(['약품코드'], 'prev_year_usage').value).toBe(-1)
  })
})

describe('날짜로 바뀐 약품코드', () => {
  it('★ 엑셀이 숫자 코드를 날짜로 저장한 모양을 가려낸다', () => {
    expect(looksLikeDate('2002-01-01')).toBe(true)
    expect(looksLikeDate('1/1/2002')).toBe(true)
    expect(looksLikeDate('Mon Nov 30 2026')).toBe(true)
  })
  it('운영에 실제로 있는 숫자 코드는 날짜가 아니다', () => {
    /* 2002 · 20006(티크앤이지227g) 은 진짜 약품코드다 — 버리면 안 된다 */
    expect(looksLikeDate('2002')).toBe(false)
    expect(looksLikeDate('20006')).toBe(false)
    expect(looksLikeDate('GRD2')).toBe(false)
  })
})

describe('숫자 읽기', () => {
  it('쉼표를 떼고 읽는다', () => { expect(toNum('1,234')).toBe(1234) })
  it('빈 칸은 undefined (건너뛴다)', () => { expect(toNum('')).toBeUndefined() })
  it('글자는 NaN (사유 목록으로)', () => { expect(Number.isNaN(toNum('없음'))).toBe(true) })
  it('★ 음수도 읽는다 — 직전1개월은 반납으로 음수가 정당하다', () => {
    expect(toNum('-3')).toBe(-3)
  })
})

describe('시트 읽기', () => {
  const aoa = [
    ['2026년 10월 사용량'],
    ['약품코드', '약품명', '직전1개월사용량'],
    ['grd2', '게리드정', '10'],
    ['', '빈 코드', '5'],
    ['GRD4', '게리드정4', ''],
  ]
  const r = readSheet(aoa, 'recent_1m_usage')
  it('머리글을 2행에서 찾았다', () => { expect(r.headerRow).toBe(1) })
  it('코드를 대문자로 다듬는다', () => { expect(r.rows[0].code).toBe('GRD2') })
  it('코드가 빈 줄은 건너뛴다', () => { expect(r.rows.map(x => x.code)).toEqual(['GRD2', 'GRD4']) })
  it('값이 빈 칸이면 undefined 로 둔다', () => { expect(r.rows[1].value).toBeUndefined() })
  it('머리글이 없으면 왜 못 읽었는지 알려 준다', () => {
    const bad = readSheet([['제목만'], ['값']], 'recent_1m_usage')
    expect(bad.badHeader).toContain('머리글')
    expect(bad.rows).toEqual([])
  })
  it('값 열이 없으면 그 사유를 알려 준다', () => {
    const bad = readSheet([['약품코드', '약품명'], ['GRD2', 'x']], 'recent_1m_usage')
    expect(bad.badHeader).toContain('값 열')
  })
})

describe('여러 파일 합치기 — 병동 + 외래', () => {
  const A = { label: '병동', rows: [{ code: 'GRD2', name: '게리드정', raw: 'GRD2', value: 10 }] }
  const B = { label: '외래', rows: [{ code: 'GRD2', name: '', raw: 'GRD2', value: 7 }] }
  it('★ 같은 약품은 더한다', () => {
    const m = mergeRows([A, B])
    expect(m.merged).toEqual([{ code: 'GRD2', name: '게리드정', value: 17, parts: 2 }])
    expect(m.mergedCount).toBe(1)
  })
  it('★ 같은 파일 안에 두 번 나와도 더한다', () => {
    const C = { label: '전체', rows: [
      { code: 'GRD2', name: 'x', raw: 'GRD2', value: 3 },
      { code: 'GRD2', name: 'x', raw: 'GRD2', value: 4 },
    ] }
    expect(mergeRows([C]).merged[0].value).toBe(7)
    expect(mergeRows([C]).mergedCount).toBe(1)
  })
  it('빈 칸은 더하지 않는다', () => {
    const C = { label: 'x', rows: [{ code: 'A', name: '', raw: 'A', value: undefined }] }
    expect(mergeRows([C]).merged).toEqual([])
  })
  it('★ 숫자가 아닌 값이 섞이면 그 코드는 통째로 뺀다 — 반쪽 합계를 만들지 않는다', () => {
    const C = { label: '병동', rows: [{ code: 'A', name: '', raw: 'A', value: 5 }] }
    const D = { label: '외래', rows: [{ code: 'A', name: '', raw: 'A', value: NaN }] }
    const m = mergeRows([C, D])
    expect(m.merged, 'A 는 저장하지 않는다').toEqual([])
    expect(m.bad).toHaveLength(1)
    expect(m.bad[0]).toMatchObject({ code: 'A', label: '외래' })
  })
  it('날짜로 보이는 코드를 따로 모아 알린다', () => {
    const C = { label: 'x', rows: [{ code: '2002-01-01', name: '', raw: '2002-01-01', value: 1 }] }
    expect(mergeRows([C]).dateLike).toHaveLength(1)
  })
})

describe('미리보기', () => {
  const drugs = [
    { drug_code: 'A', drug_name: '가', status: '사용', recent_1m_usage: 5 },
    { drug_code: 'B', drug_name: '나', status: '중지', recent_1m_usage: 9 },
    { drug_code: 'C', drug_name: '다', status: '사용', recent_1m_usage: 0 },
  ]
  const merged = [{ code: 'A', name: '가', value: 12, parts: 1 }, { code: 'Z', name: '모름', value: 3, parts: 1 }]
  const p = buildPreview(drugs, merged, 'recent_1m_usage')
  it('지금 값 → 새 값', () => {
    expect(p.changes).toEqual([{ code: 'A', name: '가', status: '사용', before: 5, after: 12, parts: 1 }])
  })
  it('약품에 없는 코드는 따로 모은다', () => {
    expect(p.unmatched.map(x => x.code)).toEqual(['Z'])
  })
  it('★ 파일에 없는 약품은 0 이 될 목록에 — 이미 0 인 것은 빼고', () => {
    expect(p.zeros.map(x => x.code), 'C 는 이미 0 이라 바뀌는 것이 없다').toEqual(['B'])
  })
  it('★ 상태로 거르지 않는다 — 중지도 0 대상이다(승인 전 기본값)', () => {
    expect(p.zeros[0].status).toBe('중지')
  })
})

describe('확인 문구', () => {
  it('기준년월이 있으면 함께 적는다 (저장하지는 않는다)', () => {
    expect(confirmText({ year: 2026, month: 10, field: 'recent_1m_usage', changeCount: 357, zeroCount: 355 }))
      .toBe('2026년 10월분 직전1개월사용량을 등록합니다. 357종 변경, 355종 0으로.')
  })
  it('기준년월을 안 고르면 그 부분을 빼고 적는다', () => {
    expect(confirmText({ field: 'prev_year_usage', changeCount: 1, zeroCount: 0 }))
      .toBe('전년사용량을 등록합니다. 1종 변경, 0종 0으로.')
  })
  it('칸 이름 세 가지', () => {
    expect(Object.keys(FIELD_LABEL)).toEqual(['prev_year_usage', 'recent_3m_usage', 'recent_1m_usage'])
  })
})

/* ── 0108 RPC 소스 고정 — dryrun 에서 걸린 것을 되돌아가지 않게 ──────────── */
describe('0108 app_save_usage_bulk — 소스로 못 박는다', () => {
  const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/0108_save_usage_bulk.sql'), 'utf8')
  const CODE = SQL.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')

  /* ★ 2026-11-04 dryrun 에서 걸린 것 — 한 트랜잭션에서 두 번 부르면
       `relation "_in" already exists` 로 통째로 실패했다. */
  it('★ 임시 표를 만들기 전에 지운다 — 두 번 불러도 터지지 않게', () => {
    const i = CODE.indexOf('drop table if exists _in')
    const j = CODE.indexOf('create temporary table _in')
    expect(i, 'drop 이 없다').toBeGreaterThan(0)
    expect(j, 'create 가 없다').toBeGreaterThan(i)
  })
  it('권한은 0105c·0107 과 같은 판정', () => {
    expect(CODE).toContain("tm.role in ('owner', 'admin')")
    expect(CODE).toContain('session_user')
    expect(CODE).toContain('auth.uid()')
    expect(CODE, 'DEFINER 함정을 부르는 current_user 는 쓰지 않는다').not.toContain('current_user')
  })
  it('거절 문구에 진단값 · 비밀값 없음', () => {
    expect(CODE).toContain('[진단: uid=%, member_role=%, guc_role=%]')
    expect(CODE).toContain('left(auth.uid()::text, 8)')
    expect(CODE).not.toMatch(/service_role_key|password|Bearer/i)
  })
  it('★ 1개월만이면 월평균 계열을 건드리지 않는다 — 조건이 전년·3개월에만 걸려 있다', () => {
    for (const col of ['monthly_avg', 'safety_stock', 'max_stock']) {
      const i = CODE.indexOf(col + ' = case when')
      expect(i, col + ' 재계산 분기가 없다').toBeGreaterThan(0)
      const seg = CODE.slice(i, i + 120)
      expect(seg, col + ' 이 1개월에도 걸리면 안 된다').not.toContain('v_do_r1')
    }
  })
  it('계산식이 지금 화면과 같다 (÷3 · ÷12 · ×1.2 · ×3)', () => {
    expect(CODE).toContain('round(i.r3 / 3)')
    expect(CODE).toContain('round(i.py / 12)')
    expect(CODE).toContain('* 1.2')
    expect(CODE).toContain('* 3)')
  })
  it('SECURITY INVOKER — DEFINER 로 만들면 0105 트리거 판정이 무력해진다', () => {
    expect(CODE).toContain('security invoker')
    expect(CODE).not.toContain('security definer')
  })
  it('실행 권한을 좁힌다 — anon 회수 · authenticated 유지', () => {
    expect(CODE).toContain('from anon')
    expect(CODE).toContain('to authenticated')
  })
})
