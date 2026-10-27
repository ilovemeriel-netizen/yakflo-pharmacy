/* 환경변수 형식 검사(루트 Function 공용) — 정상값 통과 / 2026-10-27 사고값 거부 /
   값이 새지 않음 / 공개 조회 사이트 쌍둥이 파일과 판정이 어긋나지 않음.

   ★ 시험 파일을 netlify/functions/ 안에 두지 않는다 — 그 디렉터리의 최상위 .js 는
     Netlify 가 Function 으로 묶어 공개 엔드포인트로 올린다(2026-10-27 실제 빌드 실패).
     그래서 루트 vitest 가 이미 보고 있는 src/lib/ 에 둔다. */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkEnv, ENV_SPECS, SUPABASE_ENV } from '../../netlify/functions/_lib/env.js'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'
const GOOD = {
  SUPABASE_URL: 'https://phgkjrvdtcdrdiuigici.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: JWT,
  SUPABASE_ANON_KEY: JWT,
}

describe('대상 변수 목록', () => {
  it('루트 Function 이 쓰는 세 가지다 — VACCINE_* 는 없다', () => {
    expect(SUPABASE_ENV).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'])
    expect(Object.keys(ENV_SPECS).some(k => k.startsWith('VACCINE_'))).toBe(false)
  })
})

describe('정상값은 전부 통과한다', () => {
  it('운영에서 쓰는 모양 그대로', () => {
    expect(checkEnv(GOOD, SUPABASE_ENV)).toEqual([])
  })
  it('URL 끝 슬래시가 있어도 통과', () => {
    expect(checkEnv({ ...GOOD, SUPABASE_URL: 'https://abc.supabase.co/' }, SUPABASE_ENV)).toEqual([])
  })
  it('새 키 형식(sb_secret_ · sb_publishable_)도 통과', () => {
    expect(checkEnv({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abcdef123456' }, SUPABASE_ENV)).toEqual([])
    expect(checkEnv({ ...GOOD, SUPABASE_ANON_KEY: 'sb_publishable_abcdef123456' }, SUPABASE_ENV)).toEqual([])
  })
})

describe('★ 2026-10-27 운영 장애를 일으킨 값을 거부한다', () => {
  it('한 글자 값 — 기존 !value 검사는 통과하던 값이다', () => {
    const bad = checkEnv({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'x' }, SUPABASE_ENV)
    expect(bad).toHaveLength(3)
    expect(Boolean('x')).toBe(true)        /* 예전 검사라면 통과했다는 뜻 */
  })
  it('세 변수에 같은 값이 들어가도 각각 걸린다', () => {
    expect(checkEnv({ SUPABASE_URL: 'same', SUPABASE_SERVICE_ROLE_KEY: 'same', SUPABASE_ANON_KEY: 'same' }, SUPABASE_ENV)).toHaveLength(3)
  })
})

describe('어긋난 모양을 거부한다', () => {
  const cases = [
    ['SUPABASE_URL', 'http://abc.supabase.co', 'http 는 거부'],
    ['SUPABASE_URL', 'https://abc.supabase.io', '.supabase.co 가 아니면 거부'],
    ['SUPABASE_URL', 'https://evil.com/abc.supabase.co', '경로에만 들어간 것은 거부(호스트를 본다)'],
    ['SUPABASE_URL', 'abc.supabase.co', 'https:// 없으면 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'a.b', '점 1개는 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'a.b.c.d', '점 3개는 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'a..c', '빈 조각은 거부'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'sb_publishable_abc', 'service_role 자리에 공개키는 거부'],
    ['SUPABASE_ANON_KEY', 'sb_secret_abc', 'anon 자리에 비밀키는 거부'],
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
  })
  it('검사표에 없는 이름을 물으면 조용히 통과시키지 않는다', () => {
    expect(checkEnv({ NOPE: 'x' }, ['NOPE'])[0]).toBe('NOPE: 검사표에 없는 변수')
  })
  it('env 자체가 없어도 던지지 않는다', () => {
    expect(checkEnv(undefined, SUPABASE_ENV)).toHaveLength(3)
  })
})

describe('★ 값이 절대 새지 않는다', () => {
  it('실패 설명에 값이 섞이지 않는다', () => {
    const secrets = {
      SUPABASE_URL: 'https://LEAKHOST.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'LEAKKEY',
      SUPABASE_ANON_KEY: 'LEAKANON',
    }
    const text = checkEnv(secrets, SUPABASE_ENV).join(' | ')
    expect(checkEnv(secrets, SUPABASE_ENV)).toHaveLength(3)
    for (const v of Object.values(secrets)) expect(text).not.toContain(v)
    for (const frag of ['LEAK', 'example']) expect(text).not.toContain(frag)
  })
  it('검사표의 why 에 값을 끼워넣는 틀이 없다', () => {
    for (const spec of Object.values(ENV_SPECS)) {
      expect(typeof spec.why).toBe('string')
      expect(spec.why).not.toMatch(/\$\{|%s/)
    }
  })
})

/* ── 쌍둥이 파일 대조 ──────────────────────────────────────────────────────
   공개 조회 사이트는 별도 Netlify 사이트라 이 _lib 를 import 할 수 없어 규칙을 복제한다.
   둘이 갈라지면 한쪽만 고치는 사고가 나므로 같은 입력에 같은 판정을 내는지 못으로 박는다. */
/* ★ 쌍둥이 파일은 PR-A(feat/vaccine-public-polish)에서 들어온다.
     아직 병합되지 않은 브랜치에서는 파일이 없으므로 이 묶음만 건너뛴다 —
     없다고 시험 전체를 실패시키지는 않는다. 둘 다 병합되면 자동으로 켜진다.
   ★ 경로를 런타임에 만들고 @vite-ignore 를 붙인다 — 그러지 않으면 Vite 가 import 를
     정적 분석해 **파일이 없을 때 transform 단계에서** 실패하고 try/catch 가 소용없다. */
const twinPath = resolve(process.cwd(), 'vaccine-app/netlify/functions/_lib/env.js')
let twin = null
if (existsSync(twinPath)) {
  try { twin = await import(/* @vite-ignore */ pathToFileURL(twinPath).href) } catch { twin = null }
}

;(twin ? describe : describe.skip)('vaccine-app 쌍둥이 파일과 판정이 같다', () => {
  const VALUES = [
    'https://abc.supabase.co', 'https://abc.supabase.co/', 'http://abc.supabase.co',
    'https://abc.supabase.io', 'https://evil.com/abc.supabase.co', 'abc.supabase.co',
    JWT, 'a.b', 'a.b.c.d', 'a..c', 'sb_secret_abc', 'sb_publishable_abc',
    'x', '', 'same',
  ]

  it('공통 변수 3종 × 값 15가지에서 통과/거부가 일치한다', () => {
    let compared = 0
    for (const name of SUPABASE_ENV) {
      expect(twin.ENV_SPECS[name]).toBeTruthy()
      for (const v of VALUES) {
        const mine = checkEnv({ [name]: v }, [name]).length === 0
        const theirs = twin.checkEnv({ [name]: v }, [name]).length === 0
        expect(mine, `${name} ← ${JSON.stringify(v)}`).toBe(theirs)
        compared++
      }
    }
    expect(compared).toBe(SUPABASE_ENV.length * VALUES.length)
  })

  it('실패 설명 문구도 같다 — 한쪽만 바꾸면 여기서 걸린다', () => {
    for (const name of SUPABASE_ENV) {
      expect(ENV_SPECS[name].why).toBe(twin.ENV_SPECS[name].why)
    }
  })

  it('쌍둥이 쪽에는 VACCINE_* 두 가지가 더 있다', () => {
    expect(Object.keys(twin.ENV_SPECS)).toContain('VACCINE_TOKEN_SECRET')
    expect(Object.keys(twin.ENV_SPECS)).toContain('VACCINE_TENANT_ID')
    expect(Object.keys(ENV_SPECS)).not.toContain('VACCINE_TOKEN_SECRET')
  })
})
