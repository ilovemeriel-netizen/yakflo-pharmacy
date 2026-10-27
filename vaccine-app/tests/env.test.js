/* 환경변수 형식 검사 — 정상값 통과 / 2026-10-27 사고값 거부 / 값이 새지 않는지 */
import { describe, it, expect } from 'vitest'
import { checkEnv, ENV_SPECS, CONFIG_CODE, CONFIG_MSG } from '../netlify/functions/_lib/env.js'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl'
const GOOD = {
  SUPABASE_URL: 'https://phgkjrvdtcdrdiuigici.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: JWT,
  SUPABASE_ANON_KEY: JWT,
  VACCINE_TOKEN_SECRET: 'x'.repeat(32),
  VACCINE_TENANT_ID: '1b7e1f6a-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
}
const ALL = Object.keys(GOOD)

describe('정상값은 전부 통과한다', () => {
  it('운영에서 쓰는 모양 그대로', () => {
    expect(checkEnv(GOOD, ALL)).toEqual([])
  })
  it('URL 끝 슬래시가 있어도 통과', () => {
    expect(checkEnv({ ...GOOD, SUPABASE_URL: 'https://abc.supabase.co/' }, ['SUPABASE_URL'])).toEqual([])
  })
  it('새 키 형식(sb_secret_ · sb_publishable_)도 통과', () => {
    expect(checkEnv({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abcdef123456' }, ['SUPABASE_SERVICE_ROLE_KEY'])).toEqual([])
    expect(checkEnv({ ...GOOD, SUPABASE_ANON_KEY: 'sb_publishable_abcdef123456' }, ['SUPABASE_ANON_KEY'])).toEqual([])
  })
  it('비밀키 32자 경계 — 32자는 통과, 31자는 거부', () => {
    expect(checkEnv({ VACCINE_TOKEN_SECRET: 'y'.repeat(32) }, ['VACCINE_TOKEN_SECRET'])).toEqual([])
    expect(checkEnv({ VACCINE_TOKEN_SECRET: 'y'.repeat(31) }, ['VACCINE_TOKEN_SECRET'])).toHaveLength(1)
  })
  it('UUID 는 대문자도 통과', () => {
    expect(checkEnv({ VACCINE_TENANT_ID: GOOD.VACCINE_TENANT_ID.toUpperCase() }, ['VACCINE_TENANT_ID'])).toEqual([])
  })
})

describe('★ 2026-10-27 운영 장애를 일으킨 값을 거부한다', () => {
  it('한 글자 값 — 기존 !value 검사는 통과하던 값이다', () => {
    const bad = checkEnv({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x' },
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
    expect(bad).toHaveLength(2)
    expect(Boolean('x')).toBe(true)      /* 예전 검사라면 통과했다는 뜻 */
  })
  it('두 변수에 같은 값이 들어가도 각각 걸린다', () => {
    const v = 'same'
    expect(checkEnv({ SUPABASE_URL: v, SUPABASE_SERVICE_ROLE_KEY: v },
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])).toHaveLength(2)
  })
})

describe('어긋난 모양을 거부한다', () => {
  const cases = [
    ['SUPABASE_URL', 'http://abc.supabase.co', 'http 는 거부'],
    ['SUPABASE_URL', 'https://abc.supabase.io', '.supabase.co 가 아니면 거부'],
    ['SUPABASE_URL', 'https://evil.com/abc.supabase.co', '경로에만 들어간 것은 거부(호스트를 본다)'],
    ['SUPABASE_URL', 'abc.supabase.co', 'https:// 없으면 거부'],
    ['SUPABASE_URL', 'https://', '호스트 없으면 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'a.b', '점 1개는 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'a.b.c.d', '점 3개는 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'a..c', '빈 조각은 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'sb_publishable_abc', 'service_role 자리에 공개키는 거부'],
    ['SUPABASE_ANON_KEY', 'sb_secret_abc', 'anon 자리에 비밀키는 거부'],
    ['VACCINE_TENANT_ID', '1b7e1f6a2c3d4e5f8a9b0c1d2e3f4a5b', '하이픈 없으면 거부'],
    ['VACCINE_TENANT_ID', '1b7e1f6a-2c3d-4e5f-8a9b-0c1d2e3f4a5', '길이가 모자라면 거부'],
    ['VACCINE_TENANT_ID', 'zzzzzzzz-2c3d-4e5f-8a9b-0c1d2e3f4a5b', '16진수가 아니면 거부'],
  ]
  for (const [name, value, why] of cases) {
    it(`${name} — ${why}`, () => {
      expect(checkEnv({ [name]: value }, [name])).toHaveLength(1)
    })
  }
})

describe('빈 값 · 없는 변수', () => {
  it('없거나 빈 문자열은 「비어 있음」', () => {
    expect(checkEnv({}, ['SUPABASE_URL'])[0]).toBe('SUPABASE_URL: 비어 있음')
    expect(checkEnv({ SUPABASE_URL: '' }, ['SUPABASE_URL'])[0]).toBe('SUPABASE_URL: 비어 있음')
    expect(checkEnv({ SUPABASE_URL: null }, ['SUPABASE_URL'])[0]).toBe('SUPABASE_URL: 비어 있음')
  })
  it('검사표에 없는 이름을 물으면 조용히 통과시키지 않는다', () => {
    expect(checkEnv({ NOPE: 'x' }, ['NOPE'])[0]).toBe('NOPE: 검사표에 없는 변수')
  })
  it('env 자체가 없어도 던지지 않는다', () => {
    expect(checkEnv(undefined, ['SUPABASE_URL'])).toHaveLength(1)
  })
})

describe('★ 값이 절대 새지 않는다', () => {
  it('실패 설명에 값이 섞이지 않는다', () => {
    const secrets = {
      SUPABASE_URL: 'https://SECRET-HOST.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'SECRET-KEY-VALUE',
      SUPABASE_ANON_KEY: 'SECRET-ANON-VALUE',
      VACCINE_TOKEN_SECRET: 'SECRET-TOKEN',
      VACCINE_TENANT_ID: 'SECRET-TENANT',
    }
    const text = checkEnv(secrets, ALL).join(' | ')
    expect(checkEnv(secrets, ALL)).toHaveLength(5)
    for (const v of Object.values(secrets)) expect(text).not.toContain(v)
    for (const frag of ['SECRET', 'HOST', 'VALUE', 'TOKEN', 'TENANT']) {
      /* 변수 이름에 들어 있는 글자는 제외하고 본다 — 값에서 온 조각이 없어야 한다 */
      if (!ALL.some(n => n.includes(frag))) expect(text).not.toContain(frag)
    }
  })
  it('검사표의 why 에도 값이 들어갈 자리가 없다', () => {
    for (const [name, spec] of Object.entries(ENV_SPECS)) {
      expect(typeof spec.why).toBe('string')
      expect(spec.why).not.toMatch(/\$\{|%s/)      /* 끼워넣기 틀이 없다 */
      expect(name).toBeTruthy()
    }
  })
})

describe('응답에 쓰는 상수', () => {
  it('code 와 message 가 지시서와 같다', () => {
    expect(CONFIG_CODE).toBe('SERVER_CONFIG')
    expect(CONFIG_MSG).toBe('서버 설정 오류입니다 · 문의 약제과 내선 217')
  })
  it('message 에 변수 이름이나 원인이 들어가지 않는다', () => {
    for (const n of ALL) expect(CONFIG_MSG).not.toContain(n)
  })
})
