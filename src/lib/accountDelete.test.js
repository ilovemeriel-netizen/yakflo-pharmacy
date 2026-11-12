/* 회원 탈퇴 막기 — 함수 단위 시험 (2026-11-12 이정화 님 승인)
 *
 * ★ 왜 함수 단위인가
 *   탈퇴는 **되돌릴 수 없다**. auth 계정을 지우면 profiles·tenant_members 가
 *   CASCADE 로 함께 사라진다(외래키 실측). 실제 계정을 하나도 건드리지 않고
 *   막는 조건을 전수로 확인한다.
 *
 * 못 박는 것
 *   ① 아이디 계정(@id.yakflo.invalid) → 막힘
 *   ② created_by 가 있는 계정 → 막힘
 *   ③ 마지막 대표(켜진 대표 1명) → 막힘
 *   ④ ★ 대표가 2명이면 1명은 탈퇴할 수 있다
 *   ⑤ 서버와 화면이 **같은 판단**을 한다
 *   ⑥ 서버가 그 판단을 실제로 쓴다 — 403 으로 끝낸다 (소스 검사)
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  canDeleteAccount, isIssuedAccount, LEAVE_MSG, ID_DOMAIN,
} from '../../netlify/functions/_lib/accountDeleteRules.js'
import {
  leaveBlockReason, LEAVE_BLOCK, isIssuedAccount as uiIssued,
} from './leaveNotice'

const normal = {
  email: 'someone@example.com', createdBy: null,
  role: 'member', isActive: true, activeOwnerCount: 1,
}

describe('★ ① 아이디 계정은 탈퇴할 수 없다', () => {
  it('viewer01@id.yakflo.invalid → 막힘', () => {
    const v = canDeleteAccount({ ...normal, email: 'viewer01@' + ID_DOMAIN })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('issued_account')
    expect(v.msg).toBe('발급 계정은 탈퇴할 수 없습니다')
  })
  it('대문자·빈칸이 섞여도 막힌다', () => {
    for (const e of [' VIEWER01@ID.YAKFLO.INVALID ', 'User01@Id.Yakflo.Invalid']) {
      expect(canDeleteAccount({ ...normal, email: e }).ok, e).toBe(false)
    }
  })
  it('비슷하지만 다른 주소는 안 막힌다', () => {
    for (const e of ['viewer01@yakflo.invalid', 'viewer01@id.yakflo.com', 'id.yakflo.invalid@example.com']) {
      expect(canDeleteAccount({ ...normal, email: e }).ok, e).toBe(true)
    }
  })
})

describe('★ ② created_by 가 있으면 탈퇴할 수 없다', () => {
  it('이메일 계정이어도 막힌다', () => {
    const v = canDeleteAccount({ ...normal, createdBy: '4ba8322d-ee14-4395-b09d-5fbf9618aa77' })
    expect(v.ok).toBe(false); expect(v.code).toBe('issued_account')
  })
  it('빈 글자·공백은 「없음」으로 본다', () => {
    for (const c of [null, undefined, '', '   ']) {
      expect(canDeleteAccount({ ...normal, createdBy: c }).ok, JSON.stringify(c)).toBe(true)
    }
  })
  it('isIssuedAccount 가 둘 다 본다', () => {
    expect(isIssuedAccount({ email: 'a@' + ID_DOMAIN })).toBe(true)
    expect(isIssuedAccount({ email: 'a@b.com', createdBy: 'x' })).toBe(true)
    expect(isIssuedAccount({ email: 'a@b.com' })).toBe(false)
    expect(isIssuedAccount()).toBe(false)
  })
})

describe('★ ③④ 마지막 대표 보호', () => {
  const owner = { ...normal, role: 'owner' }
  it('켜진 대표가 1명이면 막힌다', () => {
    const v = canDeleteAccount({ ...owner, activeOwnerCount: 1 })
    expect(v.ok).toBe(false); expect(v.code).toBe('last_owner')
    expect(v.msg).toBe('대표 계정은 탈퇴할 수 없습니다 · 다른 분을 대표로 지정한 뒤 가능합니다')
  })
  it('대표가 0명으로 셈되어도 막는다 (안전한 쪽으로)', () => {
    expect(canDeleteAccount({ ...owner, activeOwnerCount: 0 }).code).toBe('last_owner')
  })
  it('★ 대표가 2명이면 1명은 탈퇴할 수 있다', () => {
    expect(canDeleteAccount({ ...owner, activeOwnerCount: 2 }).ok).toBe(true)
  })
  it('대표가 아니면 대표 수와 상관없다', () => {
    for (const r of ['admin', 'member', 'viewer', null]) {
      expect(canDeleteAccount({ ...normal, role: r, activeOwnerCount: 1 }).ok, String(r)).toBe(true)
    }
  })
  it('꺼진 대표는 마지막 대표로 안 센다 — 그 사람은 탈퇴할 수 있다', () => {
    expect(canDeleteAccount({ ...owner, isActive: false, activeOwnerCount: 1 }).ok).toBe(true)
  })
  it('★ 발급 계정이 대표여도 **발급 계정**으로 먼저 막힌다', () => {
    const v = canDeleteAccount({ ...owner, email: 'admin01@' + ID_DOMAIN, activeOwnerCount: 2 })
    expect(v.code).toBe('issued_account')
  })
})

describe('그 밖의 계정은 지금 그대로', () => {
  it('이메일 계정 · 대표 아님 → 탈퇴 가능', () => {
    expect(canDeleteAccount(normal).ok).toBe(true)
  })
  it('값이 하나도 없어도 터지지 않는다', () => {
    expect(canDeleteAccount().ok).toBe(true)
    expect(canDeleteAccount({}).ok).toBe(true)
  })
})

describe('★ ⑤ 서버와 화면이 같은 판단을 한다', () => {
  const cases = [
    { email: 'viewer01@' + ID_DOMAIN, createdBy: null, role: 'viewer', isActive: true, activeOwnerCount: 2 },
    { email: 'a@b.com', createdBy: 'uuid', role: 'member', isActive: true, activeOwnerCount: 2 },
    { email: 'a@b.com', createdBy: null, role: 'owner', isActive: true, activeOwnerCount: 1 },
    { email: 'a@b.com', createdBy: null, role: 'owner', isActive: true, activeOwnerCount: 2 },
    { email: 'a@b.com', createdBy: null, role: 'member', isActive: true, activeOwnerCount: 1 },
  ]
  for (const c of cases) {
    it(JSON.stringify(c).slice(0, 60) + ' — 둘이 같다', () => {
      const srv = canDeleteAccount(c)
      const ui = leaveBlockReason(c)
      expect(!!ui, '화면').toBe(!srv.ok)
      if (ui) expect(ui.code).toBe(srv.code)
    })
  }
  it('막는 글자가 같다', () => {
    expect(LEAVE_BLOCK.issued.title).toBe(LEAVE_MSG.issued)
    expect(LEAVE_BLOCK.lastOwner.title + ' · ' + LEAVE_BLOCK.lastOwner.help).toBe(LEAVE_MSG.lastOwner)
  })
  it('내부 도메인이 서버·화면·로그인에서 모두 같다', () => {
    const login = fs.readFileSync('src/lib/loginId.js', 'utf8')
    expect(login).toContain("ID_DOMAIN = 'id.yakflo.invalid'")
    expect(ID_DOMAIN).toBe('id.yakflo.invalid')
    expect(uiIssued('x@id.yakflo.invalid')).toBe(true)
  })
})

/* ★ ⑥ 서버가 그 판단을 실제로 쓰는가 */
describe('★ ⑥ 서버가 403 으로 막는다', () => {
  const SRC = fs.readFileSync('netlify/functions/account-delete.js', 'utf8')
  it('판단 함수를 가져다 쓴다', () => {
    expect(SRC).toContain("from './_lib/accountDeleteRules.js'")
    expect(SRC).toContain('canDeleteAccount({')
  })
  it('★ 막히면 403 으로 끝내고 **계정을 지우지 않는다**', () => {
    const v = SRC.indexOf('const verdict = canDeleteAccount({')
    const del = SRC.indexOf('deleteUser(user.id)')
    expect(v).toBeGreaterThan(0)
    expect(del, '삭제가 판단보다 앞에 있다').toBeGreaterThan(v)
    const between = SRC.slice(v, del)
    expect(between).toContain('if (!verdict.ok)')
    expect(between).toContain('403')
    expect(between).toContain('return json(')
  })
  it('대표일 때만 대표 수를 센다', () => {
    expect(SRC).toContain("if (mem && mem.role === 'owner')")
    expect(SRC).toContain("eq('role', 'owner')")
    expect(SRC).toContain("eq('is_active', true)")
  })
  it('비밀번호 재확인은 그대로 남아 있다', () => {
    expect(SRC).toContain('signInWithPassword')
  })
})

describe('화면 — 막으면 단추를 안 그린다', () => {
  const APP = fs.readFileSync('src/App.jsx', 'utf8')
  it('leaveBlock 이 있으면 안내 한 줄만', () => {
    expect(APP).toContain('const leaveBlock = leaveBlockReason({')
    expect(APP).toContain('{leaveBlock ? <div')
    expect(APP).toContain('탈퇴 불가')
  })
  it('★ 막힌 경우 「탈퇴하기」 단추가 그려지지 않는다', () => {
    const i = APP.indexOf('{leaveBlock ? <div')
    const j = APP.indexOf('</div> : <div', i)   /* 여기서부터가 「막지 않은」 쪽이다 */
    expect(j).toBeGreaterThan(i)
    expect(APP.slice(i, j).includes('setShowDeleteModal(true)'), '막힌 쪽에 단추가 있다').toBe(false)
  })
  it('대표일 때만 대표 수를 센다', () => {
    expect(APP).toContain("if (memberRole !== 'owner') { if (!dead) setOwnerCount(null); return }")
  })
})
