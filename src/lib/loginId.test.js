/* 아이디 로그인 — 2026-11-12
 *
 * 못 박는 것
 *   ① 「@」가 있으면 **이메일 그대로** — 기존 로그인이 하나도 안 바뀐다
 *   ② 「@」가 없으면 아이디 → 내부 주소
 *   ③ 아이디 규칙 (영문 소문자·숫자 4~20자 · 첫 글자 영문)
 *   ④ 내부 도메인이 `.invalid` 다 — 메일이 갈 수 없는 이름
 *   ⑤ 화면에는 아이디만 보인다
 *   ★ ⑥ Edge Function 이 **비밀번호를 로그에 찍지 않는다** (소스로 못 박는다)
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  ID_DOMAIN, ID_RE, isLoginId, idToEmail, emailToId, displayAccount, toLoginEmail,
  rolePrefix, nextLoginId, ID_MAX_NO,
} from './loginId'

describe('★ ① 이메일 로그인은 하나도 안 바뀐다', () => {
  for (const e of ['ilovemeriel@gmail.com', 'A@B.co', ' name@example.com ', 'x@y']) {
    it(JSON.stringify(e) + ' → 그대로', () => {
      expect(toLoginEmail(e)).toBe(e.trim())
    })
  }
  it('대문자 이메일을 소문자로 바꾸지 않는다 — 건드리지 않는다', () => {
    expect(toLoginEmail('Name@Example.COM')).toBe('Name@Example.COM')
  })
})

describe('② 아이디 → 내부 주소', () => {
  it('yakjo1 → yakjo1@' + ID_DOMAIN, () => {
    expect(toLoginEmail('yakjo1')).toBe('yakjo1@' + ID_DOMAIN)
  })
  it('대문자로 적어도 소문자로 바꾼다', () => {
    expect(toLoginEmail('YAKJO1')).toBe('yakjo1@' + ID_DOMAIN)
  })
  it('앞뒤 빈칸은 떼어 낸다', () => {
    expect(toLoginEmail('  yakjo1  ')).toBe('yakjo1@' + ID_DOMAIN)
  })
})

describe('③ 아이디 규칙', () => {
  it('되는 것', () => {
    for (const v of ['yakjo', 'yakjo1', 'a123', 'abcdefghij1234567890']) {
      expect(isLoginId(v), v).toBe(true)
    }
  })
  it('안 되는 것', () => {
    for (const v of ['abc', '1yakjo', 'yak jo', 'yak-jo', 'yak_jo', 'yak.jo', '약플로',
      'abcdefghij12345678901', 'yakjo!', '']) {
      expect(isLoginId(v), JSON.stringify(v)).toBe(false)
    }
  })
  it('규칙에 안 맞고 「@」도 없으면 null — 화면이 안내한다', () => {
    expect(toLoginEmail('abc')).toBeNull()
    expect(toLoginEmail('약플로')).toBeNull()
    expect(toLoginEmail('')).toBeNull()
  })
  it('ID_RE 가 Edge Function 과 같은 글자다', () => {
    expect(ID_RE.source).toBe('^[a-z][a-z0-9]{3,19}$')
  })
})

describe('★ ④ 내부 도메인은 메일이 갈 수 없는 이름이다', () => {
  it('.invalid 로 끝난다 (RFC 2606)', () => {
    expect(ID_DOMAIN.endsWith('.invalid')).toBe(true)
  })
  it('우리 진짜 도메인이 아니다 — 실수로 메일이 나갈 수 없다', () => {
    expect(ID_DOMAIN.includes('ehwaa.com')).toBe(false)
  })
})

describe('⑤ 화면에는 아이디만 보인다', () => {
  it('아이디 계정은 아이디로', () => {
    expect(displayAccount('yakjo1@' + ID_DOMAIN)).toBe('yakjo1')
    expect(emailToId('yakjo1@' + ID_DOMAIN)).toBe('yakjo1')
  })
  it('이메일 계정은 이메일 그대로', () => {
    expect(displayAccount('ilovemeriel@gmail.com')).toBe('ilovemeriel@gmail.com')
    expect(emailToId('ilovemeriel@gmail.com')).toBeNull()
  })
  it('빈 값에도 안 터진다', () => {
    expect(displayAccount(null)).toBe('')
    expect(emailToId(undefined)).toBeNull()
    expect(idToEmail('')).toBe('@' + ID_DOMAIN)
  })
})

/* ★ ⑥ Edge Function 이 비밀번호를 로그에 흘리지 않는지 **소스로** 본다.
   운영 로그를 열어 볼 수 없으므로, 코드가 그럴 수 없게 생겼는지 못 박는다. */
describe('★ ⑥ Edge Function 이 비밀번호를 로그에 찍지 않는다', () => {
  const read = p => fs.readFileSync(p, 'utf8')
  const SHARED = read('supabase/functions/_shared/adminAuth.ts')
  const CREATE = read('supabase/functions/admin-create-user/index.ts')
  const RESET = read('supabase/functions/admin-reset-password/index.ts')

  it('safeLog 는 **허용한 열쇠만** 남긴다 — password 는 명단에 없다', () => {
    const m = /const LOG_KEYS = \[([^\]]*)\]/.exec(SHARED)
    expect(m, 'LOG_KEYS 를 찾지 못했다').toBeTruthy()
    const keys = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)
    expect(keys).not.toContain('password')
    expect(keys).not.toContain('pw')
    expect(keys.length).toBeGreaterThan(0)
  })

  it('두 함수 모두 console.log 를 직접 쓰지 않는다 — safeLog 만 쓴다', () => {
    for (const [name, src] of [['create', CREATE], ['reset', RESET]]) {
      expect((src.match(/console\.(log|info|debug|warn|error)/g) || []), name).toEqual([])
    }
  })

  /* ★ 글자값(따옴표 안)은 지우고 본다 — 함수 이름 'admin-reset-password' 나
     안내 문구 「비밀번호는 8자 이상」은 **값이 아니라 글자**라 샐 수 없다.
     우리가 막으려는 것은 **변수 password** 가 로그·응답·DB 로 흘러드는 것이다. */
  const bare = s => s.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``')

  it('★ password 가 safeLog·응답·감사에 들어가지 않는다', () => {
    for (const [name, src] of [['create', CREATE], ['reset', RESET]]) {
      for (const call of src.match(/safeLog\(\{[^}]*\}\)/g) || []) {
        expect(/\bpassword\b/.test(bare(call)), name + ' · ' + call).toBe(false)
      }
      for (const call of src.match(/json\(\{[^}]*\}/g) || []) {
        expect(/\bpassword\b/.test(bare(call)), name + ' · ' + call).toBe(false)
      }
    }
  })

  it('비밀번호를 DB 나 감사에 넣지 않는다', () => {
    for (const [name, src] of [['create', CREATE], ['reset', RESET]]) {
      for (const call of src.match(/\.insert\(\{[\s\S]*?\}\)/g) || []) {
        expect(/\bpassword\b/.test(bare(call)), name + ' · ' + call).toBe(false)
      }
      for (const call of src.match(/\.upsert\(\{[\s\S]*?\}/g) || []) {
        expect(/\bpassword\b/.test(bare(call)), name + ' · ' + call).toBe(false)
      }
    }
  })

  it('★ password 변수는 **Supabase 로 넘기는 자리**에만 쓴다', () => {
    /* create: createUser({ … password … }) 한 곳 · reset: updateUserById(…, { password }) 한 곳 */
    const uses = s => (bare(s).match(/\bpassword\b/g) || []).length
    expect(uses(CREATE)).toBeGreaterThan(0)
    expect(CREATE).toContain('password,')
    expect(RESET).toContain('{ password }')
  })

  it('메일을 보내지 않는다 — 확인 완료로 만든다', () => {
    expect(CREATE).toContain('email_confirm: true')
    expect(/sendEmail|inviteUserByEmail|resetPasswordForEmail/.test(CREATE)).toBe(false)
  })

  it('서비스 키는 환경변수에서만 읽는다 — 값이 소스에 없다', () => {
    expect(SHARED).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")')
    for (const src of [SHARED, CREATE, RESET]) {
      expect(/eyJ[A-Za-z0-9_-]{20,}/.test(src), '키처럼 생긴 글자가 있다').toBe(false)
    }
  })

  it('★ 관리자만 부를 수 있다 — 두 함수 모두 서버에서 역할을 다시 본다', () => {
    for (const [name, src] of [['create', CREATE], ['reset', RESET]]) {
      expect(src, name).toContain('requireTenantAdmin(req)')
      expect(src, name).toContain('403')
    }
    expect(SHARED).toContain("m.role !== \"owner\" && m.role !== \"admin\"")
    expect(SHARED).toContain('m.is_active === false')
  })

  it('★ 자기 자신 비밀번호는 못 바꾼다', () => {
    expect(RESET).toContain('target === caller.userId')
  })

  it('★ 남의 약국 계정은 못 건드린다', () => {
    expect(RESET).toContain('mem.tenant_id !== caller.tenantId')
  })

  it('내부 도메인이 화면과 같다', () => {
    expect(SHARED).toContain('id.yakflo.invalid')
  })
})

/* ★ ⑦ 아이디 자동 만들기 (2026-11-12 승인) */
describe('★ ⑦ 아이디 자동 만들기', () => {
  it('접두어 — 관리=admin · 일반=user · 읽기 전용=viewer · 대표는 없음', () => {
    expect(rolePrefix('admin')).toBe('admin')
    expect(rolePrefix('member')).toBe('user')
    expect(rolePrefix('viewer')).toBe('viewer')
    expect(rolePrefix('owner')).toBeNull()
    expect(rolePrefix('')).toBeNull()
  })
  it('아무도 없으면 01 부터', () => {
    expect(nextLoginId('viewer', [])).toBe('viewer01')
    expect(nextLoginId('member', [])).toBe('user01')
    expect(nextLoginId('admin', [])).toBe('admin01')
  })
  it('★ 비어 있는 **가장 작은** 번호를 쓴다 — 지운 번호도 다시 쓴다', () => {
    expect(nextLoginId('viewer', ['viewer01', 'viewer03'])).toBe('viewer02')
    expect(nextLoginId('viewer', ['viewer02'])).toBe('viewer01')
  })
  it('다른 역할 아이디는 셈에 안 넣는다', () => {
    expect(nextLoginId('viewer', ['user01', 'admin01'])).toBe('viewer01')
  })
  it('대표는 자동으로 넣지 않는다', () => {
    expect(nextLoginId('owner', [])).toBeNull()
  })
  it('99까지 차면 멈춘다', () => {
    const all = []
    for (let i = 1; i <= ID_MAX_NO; i++) all.push('user' + String(i).padStart(2, '0'))
    expect(nextLoginId('member', all)).toBeNull()
    all.pop()
    expect(nextLoginId('member', all)).toBe('user99')
  })
  it('★ 자동으로 지은 아이디가 규칙을 지킨다', () => {
    for (const r of ['admin', 'member', 'viewer']) {
      const id = nextLoginId(r, [])
      expect(isLoginId(id), r + ' → ' + id).toBe(true)
    }
  })
  it('★ Edge Function 과 접두어가 같다', () => {
    const src = fs.readFileSync('supabase/functions/admin-suggest-id/index.ts', 'utf8')
    expect(src).toContain('admin: "admin", member: "user", viewer: "viewer"')
    expect(src).toContain('MAX_NO = 99')
  })
  it('★ 아이디 제안 함수는 계정을 만들지 않는다 — 읽기만', () => {
    const src = fs.readFileSync('supabase/functions/admin-suggest-id/index.ts', 'utf8')
    expect(/createUser|updateUserById|deleteUser/.test(src)).toBe(false)
    expect(/\bpassword\b/.test(src)).toBe(false)
    expect(src).toContain('requireTenantAdmin(req)')
  })
})
