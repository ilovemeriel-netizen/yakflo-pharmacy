/* 백신 묶음(시즌/상시) — 함수 단위 시험 (2026-11-13 이정화 님 승인)
 *
 * 못 박는 것
 *   ① 아는 값이 아니면 '시즌' — DB 기본값과 같다
 *   ② 상시 고정값(시즌='상시' · 종료일 2099-12-31)
 *   ③ 묶음별 대상 구분 프리셋
 *   ④ 묶음을 바꿀 때 칸이 어떻게 바뀌는가 — **숨기는 칸은 비운다**
 *   ⑤ 창이 실제로 그 판단을 쓴다 (소스 검사)
 *   ⑥ 0127 마이그레이션이 기본값·검사·스키마 캐시 갱신을 담고 있다
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  GROUP_SEASON, GROUP_ALWAYS, GROUPS, ALWAYS,
  normGroup, isAlways, presetsOf, defPresetOf, formForGroup,
} from './vaccineGroup.js'

const DEF = { season: '2026-2027', start: '2026-09-01', end: '2027-06-30' }
const TODAY = '2026-11-13'
/* VaccineManage.jsx 의 PRESETS 와 같은 모양 */
const PRESETS = [
  { id: 'staff', label: '직원 · 일반 · 간병사', items: ['직원', '일반', '간병사'] },
  { id: 'elder', label: '75세이상 · 70~74세 · 65~69세', items: ['75세이상', '70~74세', '65~69세'] },
  { id: 'always', label: '일반', items: ['일반'] },
  { id: 'none', label: '없음 — 나중에 직접 추가', items: [] },
]

describe('★ ① 아는 값이 아니면 「시즌」', () => {
  it('두 값만 그대로 간다', () => {
    expect(normGroup('상시')).toBe(GROUP_ALWAYS)
    expect(normGroup('시즌')).toBe(GROUP_SEASON)
  })
  it('빈 값·이상한 값은 「시즌」 — DB 기본값과 같다', () => {
    for (const v of [null, undefined, '', '기타', '상 시', 'always', 0, {}]) {
      expect(normGroup(v), JSON.stringify(v)).toBe(GROUP_SEASON)
    }
  })
  it('isAlways 가 같은 판단을 한다', () => {
    expect(isAlways('상시')).toBe(true)
    expect(isAlways('시즌')).toBe(false)
    expect(isAlways(undefined)).toBe(false)
  })
  it('묶음은 둘뿐이다', () => {
    expect(GROUPS).toEqual(['시즌', '상시'])
  })
})

describe('★ ② 상시 고정값', () => {
  it("시즌은 '상시', 종료일은 2099-12-31", () => {
    expect(ALWAYS.season).toBe('상시')
    expect(ALWAYS.end).toBe('2099-12-31')
  })
})

describe('★ ③ 묶음별 대상 구분 프리셋', () => {
  it('상시에는 「일반」과 「없음」만 보인다 — 독감용은 안 보인다', () => {
    expect(presetsOf(GROUP_ALWAYS, PRESETS).map(p => p.id)).toEqual(['always', 'none'])
  })
  it('시즌에는 독감용 셋이 보이고 상시용은 안 보인다', () => {
    expect(presetsOf(GROUP_SEASON, PRESETS).map(p => p.id)).toEqual(['staff', 'elder', 'none'])
  })
  it('값이 없으면 시즌으로 본다', () => {
    expect(presetsOf(undefined, PRESETS).map(p => p.id)).toEqual(['staff', 'elder', 'none'])
    expect(presetsOf(GROUP_ALWAYS, undefined)).toEqual([])
  })
  it('기본 선택', () => {
    expect(defPresetOf(GROUP_ALWAYS)).toBe('always')
    expect(defPresetOf(GROUP_SEASON)).toBe('staff')   /* 창을 처음 열었을 때와 같은 값 */
  })
})

describe('★ ④ 묶음을 바꾸면 칸이 따라 바뀐다', () => {
  const base = {
    public_group: '시즌', season: '2026-2027', season_start: '2026-09-01', season_end: '2027-06-30',
    drug_code: 'PRVN20PFS', funding_source: '일반',
    settlement_body: '보건소', storage_location: '냉장고1',
    admin_end: '2027-06-30', return_due: '2027-06-30',
  }

  it('상시로 바꾸면 시즌·기간이 고정값이 된다', () => {
    const r = formForGroup(base, GROUP_ALWAYS, TODAY, DEF)
    expect(r.public_group).toBe('상시')
    expect(r.season).toBe('상시')
    expect(r.season_start).toBe(TODAY)
    expect(r.season_end).toBe('2099-12-31')
  })

  it('★ 숨기는 칸 3개는 비운다 — 안 보이는 값이 조용히 저장되지 않게', () => {
    const r = formForGroup(base, GROUP_ALWAYS, TODAY, DEF)
    expect(r.settlement_body).toBe('')
    expect(r.admin_end).toBe('')
    expect(r.return_due).toBe('')
  })

  it('숨기지 않는 칸은 그대로 둔다', () => {
    const r = formForGroup(base, GROUP_ALWAYS, TODAY, DEF)
    expect(r.drug_code).toBe('PRVN20PFS')
    expect(r.funding_source).toBe('일반')
    expect(r.storage_location).toBe('냉장고1')
  })

  it('시즌으로 되돌리면 독감 기본값이 다시 온다', () => {
    const away = formForGroup(base, GROUP_ALWAYS, TODAY, DEF)
    const back = formForGroup(away, GROUP_SEASON, TODAY, DEF)
    expect(back.public_group).toBe('시즌')
    expect(back.season).toBe(DEF.season)
    expect(back.season_start).toBe(DEF.start)
    expect(back.season_end).toBe(DEF.end)
    expect(back.admin_end).toBe(DEF.end)
    expect(back.return_due).toBe(DEF.end)
  })

  it('★ 시즌→상시→시즌 을 되풀이해도 값이 꼬이지 않는다', () => {
    let f = { ...base }
    for (let i = 0; i < 3; i++) {
      f = formForGroup(f, GROUP_ALWAYS, TODAY, DEF)
      f = formForGroup(f, GROUP_SEASON, TODAY, DEF)
    }
    expect(f.season).toBe(DEF.season)
    expect(f.season_end).toBe(DEF.end)
    expect(f.drug_code).toBe('PRVN20PFS')
  })

  it('값이 하나도 없어도 터지지 않는다', () => {
    expect(formForGroup(undefined, GROUP_ALWAYS, TODAY, DEF).season).toBe('상시')
    expect(formForGroup(null, GROUP_SEASON, TODAY, DEF).season).toBe(DEF.season)
  })

  it('아는 값이 아니면 시즌 쪽으로 간다', () => {
    expect(formForGroup(base, '기타', TODAY, DEF).public_group).toBe('시즌')
  })
})

/* ★ ⑤ 창이 실제로 그 판단을 쓰는가 */
describe('★ ⑤ 계정 만들기 창이 판단을 쓴다', () => {
  const SRC = fs.readFileSync('src/VaccineManage.jsx', 'utf8')

  it('lib 를 가져다 쓴다 — 판단이 두 곳으로 갈라지지 않는다', () => {
    expect(SRC).toContain("from './lib/vaccineGroup.js'")
    expect(SRC).toContain('formForGroup(p, g, todayYmd(), DEF)')
    expect(SRC).toContain('defPresetOf(g)')
  })

  it('★ 저장할 때 public_group 을 싣는다', () => {
    expect(SRC).toContain('public_group: normGroup(f.public_group)')
  })

  it('단추 글자는 「시즌 백신」·「상시 백신」', () => {
    expect(SRC).toContain('{g} 백신')
    expect(SRC).toContain('GROUPS.map(g =>')
  })

  it('★ 상시면 정산 주체·접종 종료·반납 기한이 그려지지 않는다', () => {
    /* 상시 가지가 먼저 오고(보관 위치 하나만), 시즌 가지에 세 칸이 있다 */
    const storage = SRC.indexOf('<div style={lb}>보관 위치</div>')
    expect(storage, '상시 가지의 보관 위치').toBeGreaterThan(0)
    for (const label of ['정산 주체', '접종 종료', '반납 기한']) {
      const at = SRC.indexOf('<div style={lb}>' + label + '</div>')
      expect(at, label + ' 가 상시 가지에 있다').toBeGreaterThan(storage)
    }
    expect(SRC).toContain('{alwaysOn')
  })

  it('상시면 시즌·종료일 칸을 고칠 수 없다', () => {
    expect(SRC).toContain('value={ALWAYS.season} readOnly disabled')
    expect(SRC).toContain('value={ALWAYS.end} readOnly disabled')
  })

  it('대상 구분이 필요하다는 안내가 있다', () => {
    expect(SRC).toContain('CAT_NEEDED_MSG')
    expect(SRC).toContain('불출(접종) 기록에는 대상 구분이 반드시 있어야 합니다')
  })

  it('프리셋은 묶음에 따라 걸러 보여 준다', () => {
    expect(SRC).toContain('presetsOf(alwaysOn ? GROUP_ALWAYS : GROUP_SEASON, PRESETS)')
  })
})

/* ★ ⑥ 0127 마이그레이션 */
describe('★ ⑥ 0127 마이그레이션', () => {
  const SQL = fs.readFileSync('supabase/migrations/0127_vaccine_public_group.sql', 'utf8')
  it('칸을 더하고 기본값이 「시즌」 이다 — 기존 계정을 손대지 않아도 된다', () => {
    expect(SQL).toContain('add column if not exists public_group text not null default \'시즌\'')
  })
  it('두 값만 받는다', () => {
    expect(SQL).toContain("check (public_group in ('시즌', '상시'))")
  })
  it('★ 스키마 캐시를 갱신한다 (함정 #22)', () => {
    expect(SQL).toContain("notify pgrst, 'reload schema'")
  })
})
