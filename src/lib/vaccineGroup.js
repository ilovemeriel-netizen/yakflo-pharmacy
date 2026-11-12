/* ═══════════════════════════════════════════════════════════════
   백신 계정의 묶음 — 「시즌 백신」과 「상시 백신」 (0127 public_group)

   ★ 왜 나누나
     독감·코로나는 절기마다 열렸다 닫히는 **시즌 백신**이고,
     폐렴구균·대상포진은 끝없이 이어지는 **상시 백신**이다.
     공개 화면을 위(시즌)·아래(상시)로 나누고, 등록 창에서 뜻 없는 칸을 숨긴다.

   ★ 시즌 칸을 '상시' 로 고정하는 까닭
     vaccine_accounts 의 season 은 UNIQUE(tenant, season, drug_code, funding) 구성이라
     **계정 수정에서 고칠 수 없다**. 상시 백신에 절기 이름(2026-2027)을 적으면
     내년에 백신관리 목록(= season 으로 거름)에서 **사라진다**.

   ★ 종료일 2099-12-31
     공개 화면은 「오늘이 season_start ~ season_end 안인 계정」만 보여 준다.
     상시 백신은 끝나는 날이 없으므로 아주 먼 날을 둔다.

   ★ 이 파일은 React 를 모른다 — 순수 함수만 둔다(시험이 쉽다).
   ═══════════════════════════════════════════════════════════════ */

export const GROUP_SEASON = '시즌'
export const GROUP_ALWAYS = '상시'
export const GROUPS = [GROUP_SEASON, GROUP_ALWAYS]

/** 상시 백신의 고정값 — 화면에서 고칠 수 없는 칸 */
export const ALWAYS = { season: GROUP_ALWAYS, end: '2099-12-31' }

/** DB 에 보낼 값으로 다듬는다 — 아는 값이 아니면 '시즌'(DB 기본값과 같다) */
export function normGroup(v) {
  return v === GROUP_ALWAYS ? GROUP_ALWAYS : GROUP_SEASON
}

export const isAlways = v => normGroup(v) === GROUP_ALWAYS

/** 묶음별로 고를 수 있는 대상 구분 프리셋 —
 *  상시 창에 독감용 구분을 보여 주면 잘못 고르기 쉽다. */
export function presetsOf(group, presets) {
  const all = presets || []
  return isAlways(group)
    ? all.filter(p => p.id === 'always' || p.id === 'none')
    : all.filter(p => p.id !== 'always')
}

/** 묶음을 고르면 기본으로 선택될 프리셋
 *  ★ 시즌은 'staff' — 창을 처음 열었을 때의 기존 기본값과 같은 값이다(동작이 안 바뀐다). */
export const defPresetOf = group => (isAlways(group) ? 'always' : 'staff')

/**
 * 묶음을 바꿨을 때의 새 입력값.
 *   f     : 지금 입력값
 *   group : 고른 묶음
 *   today : 'YYYY-MM-DD' (상시의 시작일)
 *   def   : 시즌 백신의 기본값 { season, start, end }
 *
 * ★ 상시로 갈 때 시즌·종료일을 **덮어쓴다**. 화면에서 못 고치는 칸이라
 *   예전 값이 남으면 보이는 것과 저장되는 것이 달라진다.
 * ★ 숨기는 칸(정산 주체·접종 종료·반납 기한)은 비운다 —
 *   보이지 않는 값이 조용히 저장되지 않게.
 */
export function formForGroup(f, group, today, def) {
  const cur = f || {}
  const on = isAlways(group)
  if (on) {
    return {
      ...cur,
      public_group: GROUP_ALWAYS,
      season: ALWAYS.season,
      season_start: today,
      season_end: ALWAYS.end,
      settlement_body: '',
      admin_end: '',
      return_due: '',
    }
  }
  return {
    ...cur,
    public_group: GROUP_SEASON,
    season: def.season,
    season_start: def.start,
    season_end: def.end,
    admin_end: cur.admin_end || def.end,
    return_due: cur.return_due || def.end,
  }
}
