/* 비밀번호 화면 문구 — 사용자 확정본(2026-10-30).

   ★ 문구는 사용자가 정한 것이다. 바뀌면 바로 걸리게 **원문 그대로** 박아 둔다.
   ★ 저작권 문구는 2026-10-30 에 시스템 전체 일괄로 바뀌었다(PR #371) — 새 문구인지 본다.
   ★ 배치·색·크기·굵기는 건드리지 않았다 — 색 리터럴이 늘지 않았는지 함께 본다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = readFileSync(resolve(process.cwd(), 'vaccine-app/src/App.jsx'), 'utf8')

describe('비밀번호 화면 — 바뀐 문구', () => {
  const NEW = [
    ['안내', '직원 공용 비밀번호 {PW_LEN}자리를<br />입력해 주시기 바랍니다.'],
    ['칸 이름', '공용 비밀번호(숫자 {PW_LEN}자리)'],
    ['버튼', "'조회하기'"],
    ['버튼(진행 중)', "'조회 중...'"],
    ['버튼 아래', '인증 완료 시 당일에는 비밀번호를 다시 입력하지 않아도 됩니다.'],
    ['문의', '비밀번호 확인이 필요한 경우 약제과로 문의해 주시기 바랍니다.'],
  ]
  for (const [what, text] of NEW) {
    it('★ ' + what, () => { expect(APP.includes(text), text).toBe(true) })
  }

  it('★ 옛 문구가 남아 있지 않다', () => {
    for (const old of [
      '입력해 주세요</p>',
      '}}>비밀번호</label>',
      "'확인'}</button>",
      "'확인 중...'",
      '확인하면 오늘 하루 동안 다시 묻지 않습니다.',
      '비밀번호를 모르면 약제과로 문의해 주세요',
    ]) {
      expect(APP.includes(old), '옛 문구가 남아 있다: ' + old).toBe(false)
    }
  })

  it('★ 읽어 주는 이름(aria)도 같은 말로 맞춘다', () => {
    expect(APP).toContain('label={`공용 비밀번호(숫자 ${PW_LEN}자리)`}')
  })
})

describe('바꾸지 않기로 한 것', () => {
  it('★ 문의처 줄은 그대로', () => {
    expect(APP).toContain("const TEL = '약제과(내선 217)'")
    expect(APP).toContain('{TEL}</span>')
  })
  /* ★ 2026-10-30 뒤집음 — 보류하던 시스템 전체 일괄 변경이 끝났다(PR #371).
     이제는 **새 문구가 들어 있고 옛 문구가 없다**를 고정한다. */
  it('★ 저작권은 새 문구다 — 시스템 전체 일괄 변경 완료', () => {
    const ft = readFileSync(resolve(process.cwd(), 'vaccine-app/src/App.jsx'), 'utf8')
    expect(ft).toContain("© 2026 JEONGHWALEE. All rights reserved. 무단 복제 및 재배포를 금지합니다.")
    expect(ft, '옛 저작권 문구가 남아 있다').not.toContain('무단 전재 및 재배포 금지')
    expect(ft, '「Copyright」 단어는 새 문구에 없다').not.toContain('Copyright')
  })
  it('★ 버튼의 색 동작(비활성·활성)은 그대로', () => {
    expect(APP).toContain("background: ready && !busy ? 'var(--v-purple)' : 'rgba(128, 74, 135, 0.3)'")
  })
  it('★ 새 색을 만들지 않았다 — 흰색 말고는 리터럴이 없다', () => {
    const hex = [...new Set((APP.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    for (const h of hex) expect(['#FFFFFF'], '허용 밖 색: ' + h).toContain(h)
  })
})
