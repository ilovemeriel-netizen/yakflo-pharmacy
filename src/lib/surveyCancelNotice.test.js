/* 취소 안내 띠 + 감사 기록 before/after.

   ★ 막으려는 것
     ⓐ 취소하면 그 줄이 기본 필터에 걸려 사라지고 **되살릴 방법이 없어지는 것**
       (2026-10-30 운영에서 실제로 cancel 1건 · restore 0건으로 드러났다)
     ⓑ 되살리기를 **새 경로**로 만들어 기록이 안 남는 것
     ⓒ 감사 기록에 **개인정보**가 섞여 들어가는 것 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  nextNotice, visibleNotice, noticeText, NOTICE_BG, NOTICE_FG, NOTICE_LINE,
} from './surveyCancelNotice.js'

const read = f => readFileSync(resolve(process.cwd(), f), 'utf8')
const PANEL = read('src/VaccineSurveyPanel.jsx')
const M97 = read('supabase/migrations/0097_vaccine_audit_changes_column.sql')
const M98 = read('supabase/migrations/0098_vaccine_audit_changes_record.sql')

describe('띠 상태 — 언제 뜨고 언제 사라지는가', () => {
  it('★ 취소하면 뜬다', () => {
    const n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'VGK9PA', selId: 's1' })
    expect(n).toEqual({ id: 'r1', code: 'VGK9PA', selId: 's1' })
  })
  it('★ 연속으로 취소하면 마지막 건만 보여 준다', () => {
    let n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'AAA111', selId: 's1' })
    n = nextNotice(n, { type: 'cancelled', id: 'r2', code: 'BBB222', selId: 's1' })
    expect(n.id).toBe('r2')
    expect(n.code).toBe('BBB222')
  })
  it('★ 그 줄을 되돌리면 사라진다', () => {
    const n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'AAA111', selId: 's1' })
    expect(nextNotice(n, { type: 'restored', id: 'r1' })).toBe(null)
  })
  it('다른 줄을 되돌려도 띠는 남는다', () => {
    const n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'AAA111', selId: 's1' })
    expect(nextNotice(n, { type: 'restored', id: 'r9' })).toBe(n)
  })
  it('★ 닫기(×) 를 누르면 사라진다', () => {
    const n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'AAA111', selId: 's1' })
    expect(nextNotice(n, { type: 'closed' })).toBe(null)
  })
  it('★ 화면을 옮기면 사라진다', () => {
    const n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'AAA111', selId: 's1' })
    expect(nextNotice(n, { type: 'moved' })).toBe(null)
  })
  it('id 없는 취소는 무시한다', () => {
    expect(nextNotice(null, { type: 'cancelled' })).toBe(null)
  })
  it('모르는 사건은 그대로 둔다', () => {
    const n = nextNotice(null, { type: 'cancelled', id: 'r1', code: 'A', selId: 's1' })
    expect(nextNotice(n, { type: '???' })).toBe(n)
    expect(nextNotice(n, null)).toBe(n)
  })
})

describe('띠는 그 회차에서만 보인다 — effect 에서 setState 하지 않으려고 파생값으로 푼다', () => {
  const n = { id: 'r1', code: 'AAA111', selId: 's1' }
  it('같은 회차면 보인다', () => { expect(visibleNotice(n, 's1')).toBe(n) })
  it('★ 다른 회차면 보이지 않는다', () => { expect(visibleNotice(n, 's2')).toBe(null) })
  it('회차가 없으면 보이지 않는다', () => { expect(visibleNotice(n, null)).toBe(null) })
  it('띠가 없으면 null', () => { expect(visibleNotice(null, 's1')).toBe(null) })
})

describe('문구·색', () => {
  it('문구는 「{신청번호} 취소했습니다」', () => {
    expect(noticeText('VGK9PA')).toBe('VGK9PA 취소했습니다')
    expect(noticeText(null)).toBe(' 취소했습니다')
  })
  it('★ 새 색을 만들지 않는다 — 「일부 미반영」 안내와 같은 라벤더', () => {
    expect(NOTICE_BG).toBe('rgba(191,166,217,0.45)')
    expect(NOTICE_FG).toBe('#2E4A62')
    expect(NOTICE_LINE).toBe('#BFA6D9')
  })
  it('★ 패널에 색 리터럴을 직접 쓰지 않는다 — 토큰·상수만', () => {
    expect(PANEL.match(/#[0-9A-Fa-f]{6}/g)).toBe(null)
  })
})

describe('배선 — 되돌아가지 않게', () => {
  it('★ 되돌리기는 새 경로가 아니라 setRowStatus 를 그대로 쓴다', () => {
    expect(PANEL).toContain('async function undoCancel()')
    expect(PANEL).toContain("await setRowStatus(row, 'applied')")
    /* 그 함수 안에서 supabase 를 직접 부르지 않는다 */
    const i = PANEL.indexOf('async function undoCancel()')
    const body = PANEL.slice(i, PANEL.indexOf('}', PANEL.indexOf('await setRowStatus', i)))
    expect(body.includes('supabase'), 'undoCancel 이 직접 supabase 를 부른다').toBe(false)
  })
  it('★ RPC 는 기존 3개뿐 — 새 함수를 만들지 않았다', () => {
    const calls = [...PANEL.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1]).sort()
    expect(calls).toEqual(['edit_vaccine_survey_response', 'purge_vaccine_survey', 'set_vaccine_survey_status'])
  })
  it('★ 취소 줄 숨기기 기본값은 그대로', () => {
    expect(PANEL).toContain("const HF_DEFAULT = { status: '신청' }")
  })
  it('★ 띠는 msg 띠와 같은 자리에 둔다 — 표 배치를 건드리지 않는다', () => {
    const iMsg = PANEL.indexOf('}}>{msg}</div> : null}')
    const iBand = PANEL.indexOf('background: NOTICE_BG')
    const iTable = PANEL.indexOf('purgeNeeded ? <div')
    expect(iMsg).toBeGreaterThan(-1)
    expect(iBand).toBeGreaterThan(iMsg)
    expect(iBand, '띠가 purgeNeeded 안내보다 뒤에 있다').toBeLessThan(iTable)
  })
  it('캡처가 쓰는 치수가 소스와 같다', () => {
    expect(PANEL).toContain("borderRadius: 10, padding: '10px 14px', fontSize: 12, color: NOTICE_FG, marginBottom: 12")
  })
})

describe('마이그레이션 0097 — 칸만 만든다', () => {
  it('★ changes jsonb 를 NULL 허용으로 더한다', () => {
    expect(M97).toContain('add column if not exists changes jsonb')
    expect(M97, 'NOT NULL 로 만들면 기존 31건이 막힌다').not.toMatch(/changes\s+jsonb\s+not\s+null/i)
  })
  it('★ 스키마 캐시 갱신을 함께 보낸다(CLAUDE.md 규칙)', () => {
    expect(M97).toContain("notify pgrst, 'reload schema'")
  })
  it('★ 함수는 건드리지 않는다 — 0098 이 한다', () => {
    expect(M97).not.toMatch(/create\s+or\s+replace\s+function/i)
  })
  it('★ 소급해 채우지 않는다', () => {
    expect(M97).not.toMatch(/\bupdate\s+public\.vaccine_survey_audit\b/i)
  })
})

describe('마이그레이션 0098 — 바뀐 칸만 기록한다', () => {
  it('★ 두 함수가 changes 를 함께 넣는다', () => {
    const inserts = [...M98.matchAll(/insert into public\.vaccine_survey_audit \(([^)]*)\)/g)].map(m => m[1])
    expect(inserts.length, '기록 삽입이 3곳이어야 한다(edit · 상태 · 접종완료)').toBe(3)
    for (const cols of inserts) expect(cols).toContain('changes')
  })
  it('★ 기록 대상 칸만 담는다', () => {
    const keys = [...M98.matchAll(/jsonb_build_object\(\s*'([a-z_]+)'/g)].map(m => m[1])
    const allowed = new Set(['self_dose', 'family_count', 'wish_date', 'dose', 'status', 'done_self', 'done_family', 'from'])
    for (const k of keys) expect(allowed.has(k), '허용 밖 키: ' + k).toBe(true)
    for (const need of ['family_count', 'self_dose', 'dose', 'wish_date', 'status', 'done_self', 'done_family']) {
      expect(keys.includes(need), need + ' 가 빠졌다').toBe(true)
    }
  })
  it('★★ 개인정보 칸은 한 개도 담지 않는다', () => {
    for (const bad of ['name', 'name_key', 'emp_no', 'receipt_code', 'phone', 'pin_hash', 'pin_salt', 'consent_at']) {
      expect(M98.includes("'" + bad + "'"), '개인정보 키가 들어 있다: ' + bad).toBe(false)
    }
  })
  it('★ 바뀐 것이 없으면 여전히 기록하지 않는다', () => {
    expect(M98).toContain('바뀐 것이 없으면 기록도 남기지 않는다')
    expect(M98).toContain("if cur.status = p_status then")
  })
  it('★ 접종 완료 트리거는 로그인 사용자만 — 공개 경로를 막지 않는다', () => {
    expect(M98).toContain('if auth.uid() is null then')
    expect(M98).toContain('after update of done_self, done_family')
  })
  it('★ append-only 가드와 권한을 건드리지 않는다', () => {
    expect(M98).not.toMatch(/append_only/i)
    expect(M98).not.toMatch(/^\s*(grant|revoke)\s/im)
    expect(M98).not.toMatch(/drop\s+(table|policy|constraint)/i)
  })
  it('★ 거절 조건·메시지는 0096 과 같다', () => {
    for (const msg of ['가족 접종 완료 %명보다 적게 바꿀 수 없습니다',
      '가족 수는 0~20 사이여야 합니다 (받은 값 %)',
      '본인 또는 가족 중 최소 1명은 접종해야 합니다',
      '희망일이 접종 기간(% ~ %) 밖입니다',
      '알 수 없는 상태입니다 (%)']) {
      expect(M98.includes(msg), '문구가 바뀌었다: ' + msg).toBe(true)
    }
  })
})
