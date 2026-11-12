/* 약국 역할 바꾸기 — 함수 단위 시험 (2026-11-12 이정화 님 요구)
 *
 * ★ 이 함수에서는 「관리자 확인」이 **유일한 자물쇠**다.
 *   tenant_members 에는 뷰어 트리거가 없다(쓰기 정책이 없어 대상이 아니다).
 *   그래서 막아야 할 경우를 **전수**로 못 박는다.
 *
 * 못 박는 것
 *   ① 뷰어·일반·역할 없음·**중지된 관리자**가 부르면 403
 *   ② 남의 약국 계정은 404
 *   ③ ★ 자기 자신은 못 바꾼다
 *   ④ ★ 마지막 대표를 지킨다
 *   ⑤ 역할 값·빈 값 확인
 *   ⑥ ★ 서비스 키는 **확인을 통과한 뒤에만** 쓴다 (소스로 못 박는다)
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  ROLES, callerAllowed, validateSetRole, roleLabel,
} from '../../supabase/functions/_shared/roleRules.ts'

const T1 = 'tenant-1', T2 = 'tenant-2'
const ME = 'me', YOU = 'you'
const base = {
  callerId: ME, callerTenant: T1, target: YOU,
  role: 'viewer', isActive: null, activeOwnerCount: 5,
  current: { tenant_id: T1, role: 'member', is_active: true },
}

describe('★ ① 누가 부를 수 있나', () => {
  it('owner · admin 은 된다', () => {
    expect(callerAllowed({ tenant_id: T1, role: 'owner', is_active: true }).ok).toBe(true)
    expect(callerAllowed({ tenant_id: T1, role: 'admin', is_active: true }).ok).toBe(true)
  })
  it('★ 뷰어는 403', () => {
    const v = callerAllowed({ tenant_id: T1, role: 'viewer', is_active: true })
    expect(v.ok).toBe(false); expect(v.status).toBe(403); expect(v.code).toBe('forbidden')
  })
  it('★ 일반(member)도 403', () => {
    expect(callerAllowed({ tenant_id: T1, role: 'member', is_active: true }).status).toBe(403)
  })
  it('★ 역할 없음(약국에 안 속함)은 403', () => {
    expect(callerAllowed(null).status).toBe(403)
    expect(callerAllowed(undefined).status).toBe(403)
  })
  it('★ 중지된 관리자도 403 — 역할이 owner 여도 막는다', () => {
    const v = callerAllowed({ tenant_id: T1, role: 'owner', is_active: false })
    expect(v.ok).toBe(false); expect(v.status).toBe(403)
    expect(callerAllowed({ tenant_id: T1, role: 'admin', is_active: false }).status).toBe(403)
  })
  it('is_active 가 없으면(옛 줄) 사용 중으로 본다', () => {
    expect(callerAllowed({ tenant_id: T1, role: 'owner' }).ok).toBe(true)
  })
  it('모르는 역할 글자는 403', () => {
    for (const r of ['Owner', 'OWNER', 'superadmin', '', 'viewer ']) {
      expect(callerAllowed({ tenant_id: T1, role: r, is_active: true }).status, r).toBe(403)
    }
  })
})

describe('★ ② 남의 약국 · ③ 자기 자신', () => {
  it('★ 남의 약국 계정은 404', () => {
    const v = validateSetRole({ ...base, current: { tenant_id: T2, role: 'member', is_active: true } })
    expect(v.ok).toBe(false); expect(v.status).toBe(404); expect(v.code).toBe('not_found')
  })
  it('없는 계정도 404', () => {
    const v = validateSetRole({ ...base, current: null })
    expect(v.status).toBe(404)
  })
  it('★ 자기 자신은 400 self — 약국이 같아도', () => {
    const v = validateSetRole({ ...base, target: ME, current: { tenant_id: T1, role: 'owner', is_active: true } })
    expect(v.ok).toBe(false); expect(v.status).toBe(400); expect(v.code).toBe('self')
  })
  it('★ 자기 자신은 **남의 약국보다 먼저** 걸린다', () => {
    const v = validateSetRole({ ...base, target: ME, current: { tenant_id: T2, role: 'owner', is_active: true } })
    expect(v.code).toBe('self')
  })
})

describe('★ ④ 마지막 대표 보호', () => {
  const owner = { tenant_id: T1, role: 'owner', is_active: true }
  it('대표가 1명일 때 내리면 막힌다', () => {
    const v = validateSetRole({ ...base, role: 'admin', current: owner, activeOwnerCount: 1 })
    expect(v.ok).toBe(false); expect(v.code).toBe('last_owner'); expect(v.status).toBe(400)
  })
  it('대표가 1명일 때 **끄는 것**도 막힌다', () => {
    const v = validateSetRole({ ...base, role: null, isActive: false, current: owner, activeOwnerCount: 1 })
    expect(v.code).toBe('last_owner')
  })
  it('대표가 2명이면 1명은 내릴 수 있다', () => {
    const v = validateSetRole({ ...base, role: 'admin', current: owner, activeOwnerCount: 2 })
    expect(v.ok).toBe(true); expect(v.nextRole).toBe('admin')
  })
  it('대표를 그대로 두고 다른 것만 바꾸면 안 걸린다', () => {
    const v = validateSetRole({ ...base, role: 'owner', isActive: true, current: owner, activeOwnerCount: 1 })
    expect(v.ok).toBe(true)
  })
  it('대표가 아닌 사람은 몇 명이든 상관없다', () => {
    const v = validateSetRole({ ...base, role: 'viewer', current: { tenant_id: T1, role: 'member', is_active: true }, activeOwnerCount: 1 })
    expect(v.ok).toBe(true)
  })
  it('★ 대표 수를 모르면 다시 물으라고 알려 준다', () => {
    const v = validateSetRole({ ...base, role: 'admin', current: owner, activeOwnerCount: null })
    expect(v.ok).toBe(false); expect(v.losingOwner).toBe(true); expect(v.code).toBeUndefined()
  })
  it('대표가 줄지 않는 변경은 대표 수를 안 물어도 된다', () => {
    const v = validateSetRole({ ...base, role: 'viewer', current: { tenant_id: T1, role: 'admin', is_active: true }, activeOwnerCount: null })
    expect(v.ok).toBe(true)
  })
})

describe('⑤ 값 확인', () => {
  it('대상이 없으면 400', () => {
    expect(validateSetRole({ ...base, target: '' }).code).toBe('bad_target')
  })
  it('바꿀 값이 없으면 400', () => {
    expect(validateSetRole({ ...base, role: null, isActive: null }).code).toBe('nothing')
  })
  it('모르는 역할이면 400', () => {
    for (const r of ['superadmin', 'Viewer', 'owner ', '']) {
      expect(validateSetRole({ ...base, role: r }).code, r).toBe('bad_role')
    }
  })
  it('쓸 수 있는 역할 넷', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'member', 'viewer'])
    for (const r of ROLES) expect(validateSetRole({ ...base, role: r }).ok, r).toBe(true)
  })
  it('역할만 바꾸면 사용 상태는 그대로', () => {
    const v = validateSetRole({ ...base, role: 'viewer', isActive: null, current: { tenant_id: T1, role: 'member', is_active: false } })
    expect(v.nextRole).toBe('viewer'); expect(v.nextActive).toBe(false)
  })
  it('사용 상태만 바꾸면 역할은 그대로', () => {
    const v = validateSetRole({ ...base, role: null, isActive: true, current: { tenant_id: T1, role: 'viewer', is_active: false } })
    expect(v.nextRole).toBe('viewer'); expect(v.nextActive).toBe(true)
  })
  it('감사 글자', () => {
    expect(roleLabel('owner', true)).toBe('owner · 사용 중')
    expect(roleLabel('viewer', false)).toBe('viewer · 중지')
  })
})

/* ★ ⑥ 소스 검사 — 서비스 키를 확인 뒤에만 쓰는가 */
describe('★ ⑥ 서비스 키는 확인을 통과한 뒤에만 쓴다', () => {
  const read = p => fs.readFileSync(p, 'utf8')
  const SHARED = read('supabase/functions/_shared/adminAuth.ts')
  const SET = read('supabase/functions/admin-set-role/index.ts')

  it('★ requireTenantAdmin 은 서비스 키를 쓰지 않는다 — anon 키 + 부른 사람 토큰', () => {
    const i = SHARED.indexOf('export async function requireTenantAdmin')
    const fnSrc = SHARED.slice(i)
    expect(fnSrc).toContain('SUPABASE_ANON_KEY')
    expect(fnSrc.includes('SERVICE_ROLE'), 'requireTenantAdmin 안에 서비스 키가 있다').toBe(false)
    expect(fnSrc.includes('adminClient()'), 'requireTenantAdmin 이 adminClient 를 부른다').toBe(false)
  })

  it('★ admin-set-role 은 **확인 뒤에** adminClient() 를 부른다', () => {
    const auth = SET.indexOf('requireTenantAdmin(req)')
    const svc = SET.indexOf('adminClient()')
    expect(auth).toBeGreaterThan(0)
    expect(svc).toBeGreaterThan(auth)
    /* 확인 실패면 그 자리에서 끝난다 */
    expect(SET.slice(auth, svc)).toContain('403')
  })

  it('403·404 를 돌려주는 길이 살아 있다', () => {
    expect(SET).toContain('403')
    expect(SHARED).toContain("m.role !== \"owner\" && m.role !== \"admin\"")
    expect(SHARED).toContain('m.is_active === false')
  })

  it('판단을 순수 함수에 맡긴다 — 함수 안에서 따로 판단하지 않는다', () => {
    expect(SET).toContain('validateSetRole(')
    expect(SET).toContain('roleRules.ts')
  })

  it('console.log 를 직접 쓰지 않는다 · 서비스 키 글자가 소스에 없다', () => {
    expect((SET.match(/console\.(log|info|debug|warn|error)/g) || [])).toEqual([])
    expect(/eyJ[A-Za-z0-9_-]{20,}/.test(SET)).toBe(false)
    expect(/eyJ[A-Za-z0-9_-]{20,}/.test(SHARED)).toBe(false)
  })

  it('비밀번호를 받지도 남기지도 않는다', () => {
    expect(/\bpassword\b/.test(SET)).toBe(false)
  })
})
