/* @vitest-environment node */
/* datetime-local ↔ timestamptz — 회차 「신청 마감 일시」가 밀리지 않는지 본다.

   ★ 막으려는 결함(2026-10-29 실측): 회차를 열어 **제목만 바꿔 저장해도**
     마감이 KST 18:00 → 09:00 으로 9시간 당겨졌다.
   ★ 그래서 이 시험의 핵심은 **왕복 불변**이다 — 저장값을 폼에 넣고 그대로
     저장하면 한 밀리초도 달라지지 않아야 한다. */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { kstInputValue, kstInputToIso, kstDateOnly, KST_OFFSET_MS } from './kstDatetime'

/* 브라우저(프로세스) 시간대를 바꿔 가며 같은 답이 나오는지 본다 */
const TZ0 = process.env.TZ
afterEach(() => { process.env.TZ = TZ0 })

describe('저장값 → 폼 표시 (KST 벽시계)', () => {
  it('★ 2026-10-31T09:00Z → 2026-10-31T18:00', () => {
    expect(kstInputValue('2026-10-31T09:00:00.000Z')).toBe('2026-10-31T18:00')
  })
  it('오프셋이 붙은 표기도 같은 순간이면 같은 값', () => {
    expect(kstInputValue('2026-10-31T18:00:00+09:00')).toBe('2026-10-31T18:00')
    expect(kstInputValue('2026-10-31T09:00:00+00:00')).toBe('2026-10-31T18:00')
  })
  it('★ 자정 경계 — 전날 15:30Z 는 KST 다음날 00:30', () => {
    expect(kstInputValue('2026-10-31T15:30:00Z')).toBe('2026-11-01T00:30')
  })
  it('빈 값·이상한 값은 빈 문자열 — 폼이 「마감 없음」으로 비어 있게', () => {
    for (const v of ['', null, undefined, 'abc']) expect(kstInputValue(v), String(v)).toBe('')
  })
})

describe('폼 값 → 저장값 (KST 로 읽어 UTC 로)', () => {
  it('★ 2026-10-31T18:00 → 2026-10-31T09:00Z', () => {
    expect(kstInputToIso('2026-10-31T18:00')).toBe('2026-10-31T09:00:00.000Z')
  })
  it('★ 자정 경계 — KST 00:30 은 전날 15:30Z', () => {
    expect(kstInputToIso('2026-11-01T00:30')).toBe('2026-10-31T15:30:00.000Z')
  })
  it('초가 붙어 와도 분까지만 쓴다', () => {
    expect(kstInputToIso('2026-10-31T18:00:45')).toBe('2026-10-31T09:00:00.000Z')
  })
  it('빈 값·모양이 틀리면 null — 「마감 없음」으로 저장된다', () => {
    for (const v of ['', null, undefined, '2026-10-31', 'abc']) {
      expect(kstInputToIso(v), String(v)).toBeNull()
    }
  })
})

describe('★★ 왕복 불변 — 이 결함의 핵심', () => {
  const CASES = [
    '2026-10-31T09:00:00.000Z',   /* KST 18:00 — 현재 운영 회차 값 */
    '2026-10-31T15:30:00.000Z',   /* KST 다음날 00:30 */
    '2026-01-01T00:00:00.000Z',   /* KST 09:00 */
    '2026-06-30T14:59:00.000Z',   /* KST 23:59 */
    '2026-12-31T15:00:00.000Z',   /* KST 다음 해 00:00 */
  ]
  it('저장값 → 폼 → 저장값 이 그대로다', () => {
    for (const iso of CASES) {
      expect(kstInputToIso(kstInputValue(iso)), iso).toBe(iso)
    }
  })
  it('폼 값 → 저장값 → 폼 값 도 그대로다', () => {
    for (const v of ['2026-10-31T18:00', '2026-11-01T00:30', '2027-04-30T23:59']) {
      expect(kstInputValue(kstInputToIso(v)), v).toBe(v)
    }
  })
})

describe('★ 브라우저 시간대와 무관하다', () => {
  /* ★ Date.parse 는 오프셋이 붙은 문자열에는 시간대를 쓰지 않는다. 그래도
     구현이 getHours()·new Date('YYYY-MM-DDTHH:mm') 같은 현지 해석으로
     되돌아가면 여기서 걸린다. */
  for (const tz of ['UTC', 'Asia/Seoul', 'America/New_York']) {
    it(`TZ=${tz} 에서도 같은 값`, () => {
      process.env.TZ = tz
      expect(kstInputValue('2026-10-31T09:00:00.000Z')).toBe('2026-10-31T18:00')
      expect(kstInputToIso('2026-10-31T18:00')).toBe('2026-10-31T09:00:00.000Z')
      expect(kstInputToIso(kstInputValue('2026-10-31T15:30:00.000Z'))).toBe('2026-10-31T15:30:00.000Z')
    })
  }

  it('★ 고친 뒤와 고치기 전의 차이를 못으로 박는다', () => {
    const iso = '2026-10-31T09:00:00.000Z'
    /* 옛 방식: 그냥 잘라서 넣고 new Date 로 되읽는다 */
    const oldShown = String(iso).slice(0, 16)
    expect(oldShown, '옛 방식은 09:00 으로 보였다').toBe('2026-10-31T09:00')
    /* 새 방식은 18:00 으로 보여 준다 */
    expect(kstInputValue(iso)).toBe('2026-10-31T18:00')
    /* 그리고 그대로 저장하면 원래 값이다 */
    expect(kstInputToIso(kstInputValue(iso))).toBe(iso)
  })

  it('오프셋 상수는 9시간', () => {
    expect(KST_OFFSET_MS).toBe(9 * 60 * 60 * 1000)
  })
})

describe('kstDateOnly — 「기준 … 이후 접종」 날짜', () => {
  it('★ KST 00:30 에 연 회차는 **그날** 날짜 — slice(0,10) 은 하루 전을 보여 줬다', () => {
    /* UTC 2026-10-28T15:30Z = KST 2026-10-29 00:30 */
    const iso = '2026-10-28T15:30:00.000Z'
    expect(kstDateOnly(iso)).toBe('2026-10-29')
    expect(String(iso).slice(0, 10), '옛 방식은 하루 전').toBe('2026-10-28')
  })
  it('★ KST 08:59 까지가 경계 — 09:00 부터는 UTC 와 같은 날짜', () => {
    expect(kstDateOnly('2026-10-28T23:59:00.000Z')).toBe('2026-10-29')  /* KST 08:59 */
    expect(kstDateOnly('2026-10-29T00:00:00.000Z')).toBe('2026-10-29')  /* KST 09:00 */
  })
  it('운영 회차의 open_at — 2026-10-28T05:51Z 는 KST 2026-10-28 14:51', () => {
    expect(kstDateOnly('2026-10-28T05:51:24.736Z')).toBe('2026-10-28')
  })
  it('빈 값·이상한 값은 빈 문자열', () => {
    for (const v of ['', null, undefined, 'abc']) expect(kstDateOnly(v), String(v)).toBe('')
  })
  it('시간대를 바꿔도 같은 값', () => {
    for (const tz of ['UTC', 'Asia/Seoul', 'America/New_York']) {
      process.env.TZ = tz
      expect(kstDateOnly('2026-10-28T15:30:00.000Z'), tz).toBe('2026-10-29')
    }
  })
})

describe('회차 폼 배선 — 고친 곳이 되돌아가지 않게', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'src/VaccineSurveyPanel.jsx'), 'utf8')

  it('★ 여는 쪽이 KST 로 바꿔 넣는다', () => {
    expect(SRC).toContain('close_at: kstInputValue(s.close_at)')
    expect(SRC, '옛 방식이 남아 있다').not.toContain('String(s.close_at).slice(0, 16)')
  })

  it('★ 저장 쪽이 KST 로 읽는다', () => {
    expect(SRC).toContain('close_at: kstInputToIso(f.close_at)')
    expect(SRC, '옛 방식이 남아 있다').not.toContain('new Date(f.close_at)')
  })

  it('★ datetime-local 칸은 close_at 하나뿐 — 늘면 같은 변환을 붙이라고 걸린다', () => {
    const inputs = SRC.match(/type="datetime-local"/g) || []
    expect(inputs.length).toBe(1)
    const i = SRC.indexOf('type="datetime-local"')
    const line = SRC.slice(SRC.lastIndexOf('\n', i) + 1, SRC.indexOf('\n', i))
    expect(line, 'datetime-local 칸이 close_at 이 아니다').toContain('f.close_at')
  })

  it('날짜만 쓰는 칸(vax_start·vax_end)은 영향이 없다 — 그대로 주고받는다', () => {
    /* date 컬럼이라 시간대가 없다. 폼에서도 문자열을 그대로 넘긴다. */
    expect(SRC).toContain("vax_start: s.vax_start || '', vax_end: s.vax_end || ''")
    expect(SRC).toContain('vax_start: f.vax_start, vax_end: f.vax_end')
    for (const k of ['vax_start', 'vax_end']) {
      expect(SRC, `${k} 에 시간대 변환이 끼면 안 된다`).not.toContain(`kstInputValue(s.${k})`)
      expect(SRC, `${k} 에 시간대 변환이 끼면 안 된다`).not.toContain(`kstInputToIso(f.${k})`)
    }
  })

  it('open_at 은 폼 칸이 아니다 — 열 때 서버 시각을 그대로 찍는다', () => {
    expect(SRC).toContain('patch.open_at = new Date().toISOString()')
    expect(SRC, 'open_at 이 폼에 들어왔다면 같은 변환이 필요하다').not.toContain('f.open_at')
  })

  it('★ open_at 표시가 KST 날짜다 — slice(0,10) 은 UTC 라 새벽에 하루 전이 됐다', () => {
    expect(SRC).toContain('{kstDateOnly(sel.open_at)}')
    expect(SRC, '옛 방식이 남아 있다').not.toContain('String(sel.open_at).slice(0, 10)')
  })
})
