/* 가입자 관리 — 약국 역할·사용 바꾸기 화면 (2026-11-12 이정화 님 승인)
 *
 * 못 박는 것 (소스 검사 — App.jsx 는 통째로 그려 보기 어렵다)
 *   ① 화면이 tenant_members 를 **직접 고치지 않는다** — Edge Function 으로만
 *   ② ★ 본인 것은 단추가 **꺼져 있다**(서버도 막지만 화면에서도 누를 수 없게)
 *   ③ 바뀐 것이 없으면 저장이 꺼져 있다
 *   ④ 전역 권한(profiles.role)과 약국 역할은 **따로** 저장한다 — 하나가 실패해도 뒤섞이지 않게
 *   ⑤ 실패하면 그 자리에서 멈추고 안내한다
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const APP = fs.readFileSync('src/App.jsx', 'utf8')

describe('★ ① tenant_members 를 화면에서 직접 고치지 않는다', () => {
  it("from('tenant_members') 로 쓰는 곳이 없다 — 읽기만 한다", () => {
    const writes = APP.match(/from\('tenant_members'\)[\s\S]{0,80}?\.(insert|update|upsert|delete)\(/g) || []
    expect(writes).toEqual([])
  })
  it('읽기는 한다 — 표에 역할·사용을 보이려고', () => {
    expect(APP).toContain("from('tenant_members').select('user_id,role,is_active')")
  })
  it('바꾸기는 admin-set-role 로만', () => {
    expect(APP).toContain("functions.invoke('admin-set-role'")
    expect(APP).toContain('body: { target: row.id, role: tRole, is_active: tActive }')
  })
})

describe('★ ② 본인 것은 못 바꾼다', () => {
  it('약국 역할·사용 단추가 본인이면 꺼진다', () => {
    expect(APP).toContain('pill(tRole === val, label, color, colorL, () => setTRole(val), isSelf)')
    expect(APP).toContain('pill(tActive === val, label, color, colorL, () => setTActive(val), isSelf)')
  })
  it('꺼진 단추는 눌러도 안 바뀐다', () => {
    expect(APP).toContain('onClick={() => !disabled && onClick()} disabled={disabled}')
  })
  it('본인이면 안내가 나온다', () => {
    expect(APP).toContain('본인 계정은 바꿀 수 없습니다')
  })
})

describe('③ 바뀐 것이 없으면 저장이 꺼진다', () => {
  it('약국 역할·사용이 바뀌었는지 함께 본다', () => {
    expect(APP).toContain('const tChanged = !!member && (tRole !== tRoleWas || tActive !== tActiveWas)')
    expect(APP).toContain("const isUnchanged = role === (row.role || 'user') && !tChanged")
  })
})

describe('★ ④ 두 가지를 따로 저장한다', () => {
  it('전역 권한은 바뀐 때만 쓴다', () => {
    expect(APP).toContain("if (role !== (row.role || 'user')) {")
  })
  it('약국 역할은 바뀐 때만 부른다', () => {
    expect(APP).toContain('if (tChanged) {')
  })
  it('★ 전역 권한이 실패하면 거기서 멈춘다 — 약국 역할을 부르지 않는다', () => {
    const i = APP.indexOf("if (role !== (row.role || 'user')) {")
    const j = APP.indexOf('if (tChanged) {', i)
    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
    expect(APP.slice(i, j)).toContain('return')
  })
})

describe('⑤ 실패하면 안내한다', () => {
  it('Edge Function 이 실패하면 그 말을 보여 준다', () => {
    expect(APP).toContain("setErrMsg((d && d.message) || '약국 역할을 바꾸지 못했습니다. 잠시 뒤 다시 해 주세요.')")
  })
  it('서버가 돌려주는 까닭(마지막 대표·본인)이 그대로 보인다', () => {
    /* message 를 그대로 쓰므로 「마지막 대표입니다 …」가 화면에 나온다 */
    const set = fs.readFileSync('supabase/functions/_shared/roleRules.ts', 'utf8')
    expect(set).toContain('마지막 대표입니다')
    expect(set).toContain('본인 역할·사용 상태는 바꿀 수 없습니다')
  })
})

describe('안내 글 — 뜻이 드러나게', () => {
  it('읽기 전용·중지가 무슨 뜻인지 적는다', () => {
    expect(APP).toContain('읽기 전용은 단가·금액까지 모두 볼 수 있고 저장·수정·삭제만 되지 않습니다')
    expect(APP).toContain('중지하면 로그인은 되지만 약국 자료가 하나도 보이지 않습니다')
  })
  it('새 색을 만들지 않았다 — 기존 토큰만', () => {
    const i = APP.indexOf('const tRoleBtn =')
    const seg = APP.slice(Math.max(0, i - 1400), i)
    expect(/#[0-9a-fA-F]{6}/.test(seg), '단추 조각에 색 글자가 박혀 있다').toBe(false)
  })
})
