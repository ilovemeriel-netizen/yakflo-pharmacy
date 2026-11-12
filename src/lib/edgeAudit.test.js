/* ★ 「성공했는데 실패라고 말하는 경우」를 못 박는다 — 2026-11-12 사고 재발 방지
 *
 * 무슨 일이 있었나
 *   감사 insert 에 `.catch(() => {})` 를 붙였는데, Supabase 질의 객체에는
 *   **`catch` 가 없다**(`then` 만 있다). 오류를 삼키려던 그 줄이 함수를 죽여
 *   **계정은 만들어졌는데 화면에는 「만들지 못했습니다」**가 떴다.
 *
 * 못 박는 것
 *   ① 질의 객체에 `.catch(` 를 **다시 붙이지 않는다** (세 함수 전부)
 *   ② 감사는 `writeAccountAudit` 한 길로만 남긴다 — 그 함수는 **던지지 않는다**
 *   ③ ★ 본래 일이 끝난 **뒤의 오류로 실패를 돌려주지 않는다**
 *       — 성공 응답(`ok: true`)이 감사보다 **뒤**에 있고, 그 사이에 return 400/500 이 없다
 *   ④ 되돌림(deleteUser)은 **계정 생성 직후 한 곳**에만 있다
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const read = p => fs.readFileSync(p, 'utf8')
const FNS = {
  create: read('supabase/functions/admin-create-user/index.ts'),
  reset: read('supabase/functions/admin-reset-password/index.ts'),
  role: read('supabase/functions/admin-set-role/index.ts'),
}
const AUDIT = read('supabase/functions/_shared/audit.ts')

describe('★ ① 질의 객체에 .catch 를 붙이지 않는다', () => {
  for (const [name, src] of Object.entries(FNS)) {
    it(name + ' — from(...).…catch( 가 없다', () => {
      /* `admin.from(...)` 사슬 뒤에 .catch 가 붙으면 그 자리에서 터진다 */
      expect(/from\([^)]*\)[\s\S]{0,400}?\}\)\.catch\(/.test(src), name).toBe(false)
    })
  }
  it('deleteUser 의 .catch 만 남아 있다 — 그것은 진짜 Promise 라 괜찮다', () => {
    const all = []
    for (const src of Object.values(FNS)) all.push(...(src.match(/\.catch\(/g) || []))
    expect(all.length).toBe(1)
    expect(FNS.create).toContain('deleteUser(newId).catch(')
  })
})

describe('★ ② 감사는 한 길로만 — 던지지 않는다', () => {
  for (const [name, src] of Object.entries(FNS)) {
    it(name + ' — writeAccountAudit 을 쓴다', () => {
      expect(src).toContain('writeAccountAudit(admin, {')
      expect(src).toContain('../_shared/audit.ts')
    })
    it(name + ' — drug_usage_audit 에 직접 insert 하지 않는다', () => {
      expect(src.includes('from("drug_usage_audit")'), name).toBe(false)
    })
  }
  it('writeAccountAudit 은 try 로 감싸고 ok/skipped 만 돌려준다', () => {
    expect(AUDIT).toContain('try {')
    expect(AUDIT).toContain('return error ? "skipped" : "ok"')
    expect(AUDIT).toContain('return "skipped"')
    /* 던지는 길이 없다 */
    expect(/\bthrow\b/.test(AUDIT)).toBe(false)
    /* 여기서도 .catch 를 쓰지 않는다 — 주석은 빼고 본다 */
    const code = AUDIT.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    expect(/\.catch\(/.test(code)).toBe(false)
  })
})

describe('★ ③ 성공했는데 실패라고 말하지 않는다', () => {
  for (const [name, src] of Object.entries(FNS)) {
    it(name + ' — 감사 **뒤**에 성공 응답이 있고 그 사이에 실패 응답이 없다', () => {
      const a = src.indexOf('writeAccountAudit(admin, {')
      const ok = src.indexOf('json({ ok: true', a)
      expect(a, name + ': 감사 호출을 못 찾음').toBeGreaterThan(0)
      expect(ok, name + ': 성공 응답이 감사 뒤에 없음').toBeGreaterThan(a)
      const between = src.slice(a, ok)
      expect(/json\(\{\s*ok:\s*false/.test(between), name + ': 감사와 성공 사이에 실패 응답이 있다').toBe(false)
      expect(/deleteUser/.test(between), name + ': 감사 뒤에 되돌림이 있다').toBe(false)
    })
    it(name + ' — 성공 응답에 감사 결과를 함께 적는다', () => {
      expect(src).toMatch(/json\(\{ ok: true[^)]*audit/)
    })
  }
})

describe('★ ④ 되돌림은 계정 생성 직후 한 곳에만', () => {
  it('create — deleteUser 는 역할 넣기 실패 때만', () => {
    const src = FNS.create
    expect((src.match(/deleteUser\(/g) || []).length).toBe(1)
    const d = src.indexOf('deleteUser(')
    const memErr = src.indexOf('if (memErr)')
    expect(memErr).toBeGreaterThan(0)
    expect(d).toBeGreaterThan(memErr)
  })
  it('reset · set-role 에는 되돌림이 없다 — 되돌릴 것이 없다', () => {
    expect(FNS.reset.includes('deleteUser')).toBe(false)
    expect(FNS.role.includes('deleteUser')).toBe(false)
  })
})

describe('중복 아이디는 409 하나로 끝낸다', () => {
  it('미리 보기와 만들다 걸린 것 모두 duplicate · 409', () => {
    const src = FNS.create
    /* ① 미리 보기 — 같은 주소가 profiles 에 있으면 409
       ② 만들다 걸린 것 — Supabase 가 「이미 있다」고 하면 같은 code·409 로 맞춘다 */
    expect(src).toContain('code: "duplicate", message: "이미 쓰는 아이디입니다" }, 409')
    expect(src).toContain('dupLike ? "duplicate" : "create_failed"')
    expect(src).toContain('dupLike ? 409 : 500')
  })
  it('중복일 때는 계정을 만들지 않는다 — 먼저 보고 끝낸다', () => {
    const src = FNS.create
    const dup = src.indexOf('if (dup)')
    const make = src.indexOf('createUser({')
    expect(dup).toBeGreaterThan(0)
    expect(make).toBeGreaterThan(dup)
  })
})
