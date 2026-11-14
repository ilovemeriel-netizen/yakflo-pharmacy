/* 읽기 전용(viewer) — **숨겨져 있던 단추를 전부 보여 주되 못 누르게** 한다.
 * (2026-11-14 이정화 님 업무 규칙 변경 · 승인)
 *
 * 규칙
 *   · 뷰어 — 전에 안 보이던 단추 20곳이 **보인다.** 다만 흐림(0.45) · 못 누름.
 *   · 관리자(owner·admin) — **한 글자도 안 바뀐다.**
 *   · 일반(member) — **전과 같이 안 보인다.**
 *
 * ★ 함께 막은 구멍 — 병동 「비밀번호 재설정」(/api/ward/pw-reset)
 *   그 Function 은 역할을 보지 않고 service_role 로 썼다. service_role 은 DB 의
 *   뷰어 트리거를 **지나간다.** 그래서 로그인만 되면 뷰어도 병동 조회 비밀번호를
 *   바꿀 수 있었다. 서버에 owner·admin 검사를 넣고, 화면도 같은 잣대로 막는다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RO, RO_OPACITY } from './lib/readOnlyUi.jsx'
import { READ_ONLY_MSG } from './lib/readOnly.js'

const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const PWFN = readFileSync(root('netlify/functions/ward-pw-reset.js'), 'utf8')

afterEach(() => cleanup())

/* ══ ① 부품 RO — 「보이되 못 누름」이 어떻게 생겼나 ═══════════════════════ */
describe('★★ ① RO — 뷰어에게 보이되 못 누르는 모양', () => {
  it('★ 꺼져 있으면 **아무것도 안 바뀐다**(관리자 화면 보호)', () => {
    render(<RO on={false}><button style={{ color: 'red' }}>삭제</button></RO>)
    const b = screen.getByRole('button', { name: '삭제' })
    expect(b.disabled).toBe(false)
    expect(b.style.opacity).toBe('')
    expect(b.getAttribute('title')).toBeNull()
  })

  it('★ 켜지면 단추가 **사라지지 않고** 흐려지고 못 눌린다', () => {
    render(<RO on><button style={{ color: 'red' }}>삭제</button></RO>)
    const b = screen.getByRole('button', { name: '삭제' })
    expect(b).toBeTruthy()
    expect(b.disabled).toBe(true)
    expect(b.style.opacity).toBe(String(RO_OPACITY))
    expect(b.style.cursor).toBe('default')
    expect(b.getAttribute('title')).toBe(READ_ONLY_MSG)
  })

  it('★ 원래 모양(색)을 지우지 않는다 — 자리도 안 흔들린다', () => {
    render(<RO on><button style={{ color: 'red', padding: '5px 12px' }}>삭제</button></RO>)
    const b = screen.getByRole('button', { name: '삭제' })
    expect(b.style.color).toBe('red')
    expect(b.style.padding).toBe('5px 12px')
  })

  it('★ 단추가 아닌 묶음(div)은 **속까지** 막는다 — disabled 를 붙이지 않는다', () => {
    const { container } = render(<RO on><div data-x="g"><input type="checkbox" /></div></RO>)
    const d = container.querySelector('[data-x="g"]')
    expect(d.style.pointerEvents).toBe('none')
    expect(d.hasAttribute('disabled'), 'div 에 disabled 를 붙이면 React 가 경고한다').toBe(false)
    expect(d.getAttribute('aria-disabled')).toBe('true')
  })

  it('입력칸·고르기칸은 disabled 로 막는다', () => {
    const { container } = render(<RO on><input type="text" defaultValue="가" /></RO>)
    expect(container.querySelector('input').disabled).toBe(true)
  })
})

/* ══ ② 숨겨져 있던 20곳이 뷰어에게 보인다 ══════════════════════════════ */
describe('★★ ② 숨겨져 있던 단추 20곳', () => {
  /* 소스에서 「(게이트 || _ro) && <RO on={_ro}>」 꼴을 센다 */
  const sites = APP.match(/\|\| _ro\) &&/g) || []

  it('★ 스무 곳 모두 뷰어 갈래가 붙었다', () => {
    expect(sites.length, '자리를 더하거나 뺐으면 이 숫자도 함께 고칠 것').toBe(20)
  })

  /* ★ 2026-11-14 — 보고서의 월마감/연마감은 **갈래마다 따로** 감싸므로 <RO> 가 하나 더 많다.
       개수만 세던 옛 꼴(`|| _ro) && <RO on={_ro}>`)은 **고장난 모양도 통과시켰다** —
       <RO> 안에 괄호식이 통째로 들어가 화면에 코드가 찍혔는데도 개수는 20 이었다.
       모양 검사는 ViewerNoCodeLeak.test.jsx 가 한다. */
  it('감싼 자리(<RO>)는 스물한 곳이다 — 갈래 하나가 둘로 나뉜다', () => {
    expect((APP.match(/<RO on=\{_ro\}>/g) || []).length).toBe(21)
  })

  it('★★ 뷰어가 아니면 조건이 **전과 같다** — 관리자·일반의 보임/숨김 무변경', () => {
    /* `(G || _ro)` 에서 _ro 가 거짓이면 남는 것은 G 뿐이다. G 를 고치지 않았는지 본다. */
    const GATES = [
      `const canDelete = memberRole !== VIEWER_ROLE && (profile?.role === 'admin' || memberRole === 'owner' || memberRole === 'admin')`,
      `const isAdmin = profile?.role === 'admin'`,
      `const isAdmin = memberRole === 'owner' || memberRole === 'admin' || profile?.role === 'admin'`,
      `const isOwner=memberRole==='owner';`,
      `const canEdit = memberRole === 'owner' || memberRole === 'admin' || profile?.role === 'admin';`,
      `const canEdit = memberRole === 'owner' || memberRole === 'admin' || (profile && profile.role === 'admin');`,
      `const isTenantManager = memberRole !== VIEWER_ROLE && (memberRole === 'owner' || memberRole === 'admin')`,
    ]
    for (const g of GATES) expect(APP, '게이트의 뜻을 바꾸면 안 된다: ' + g.slice(0, 40)).toContain(g)
  })

  it('★ _ro 는 **오직 뷰어일 때만** 참이다', () => {
    const decls = APP.match(/const _ro\s*=\s*[^\n;]+/g) || []
    expect(decls.length, '_ro 선언을 못 찾았다').toBeGreaterThanOrEqual(11)
    for (const d of decls) {
      expect(d, '뷰어 말고 다른 조건이 섞이면 안 된다: ' + d)
        .toMatch(/const _ro\s*=\s*(memberRole\s*===\s*VIEWER_ROLE|_menuRO)/)
    }
  })

  it('★ 사라진 단추가 없다 — 글자가 그대로 남아 있다', () => {
    const LABELS = ['사용량 양식', '사용량 업로드', '폐기/반품', '마스터도 변경', '신청 삭제',
      '스냅샷 업로드', '사이드카 재기록', '+ 일정 추가', '+ 약품 추가', '수기 조제 관리', '비밀번호 재설정']
    for (const l of LABELS) expect(APP, '단추 글자가 사라졌다: ' + l).toContain(l)
  })

  it('부품을 들여왔다', () => {
    expect(APP).toContain(`import { RO } from './lib/readOnlyUi.jsx'`)
  })
})

/* ══ ③ 병동 비밀번호 재설정 — 서버 구멍을 막았다 ═══════════════════════ */
describe('★★ ③ /api/ward/pw-reset 에 관리자 검사가 생겼다', () => {
  it('★★ owner·admin 만 통과한다', () => {
    expect(PWFN).toContain(`const ADMIN_ROLES = ['owner', 'admin']`)
    expect(PWFN).toContain(`ADMIN_ROLES.includes(String(m.role || ''))`)
    expect(PWFN).toContain(`if (!allowed.length) return json({ ok: false, msg: '권한이 없습니다' }, 403)`)
  })

  it('★ 중지된 계정은 관리자여도 막는다', () => {
    expect(PWFN).toContain('m.is_active !== false')
  })

  it('★★ 역할을 **읽어 와야** 거를 수 있다 — select 에 role 이 들어 있다', () => {
    expect(PWFN).toContain(`.select('tenant_id, role, is_active')`)
    expect(PWFN.includes(`.from('tenant_members').select('tenant_id').eq('user_id'`),
      '옛 조회(역할 없음)가 남아 있으면 거르지 못한다').toBe(false)
  })

  it('★ 거르고 **난 뒤의** tenant 만 쓴다 — 통과한 소속으로만 신청을 찾는다', () => {
    const iAllow = PWFN.indexOf('const allowed =')
    const iTids = PWFN.indexOf('const tenantIds = allowed.map')
    expect(iAllow, '권한 거르기를 못 찾았다').toBeGreaterThan(0)
    expect(iTids, 'tenantIds 가 allowed 에서 나와야 한다').toBeGreaterThan(iAllow)
  })

  it('★ 화면 단추도 같은 잣대로 막는다 — 숨기지는 않는다', () => {
    expect(APP).toContain(`<RO on={!isAdmin}><button onClick={() => { setPwTarget(r); setPwNew('') }}`)
    expect(APP).toContain('>비밀번호 재설정</button></RO>')
  })

  it('비밀번호 규격(PW_SPEC) 블록은 손대지 않았다 — 반대편 파일과 글자가 같아야 한다', () => {
    expect(PWFN).toContain('// PW_SPEC:BEGIN')
    expect(PWFN).toContain('export const PW_LEN    = 4')
    expect(PWFN).toContain('export const PW_KEYLEN = 64')
  })
})

/* ══ ④ 새 색을 만들지 않았다 ═══════════════════════════════════════════ */
describe('★ ④ 새 색 없음', () => {
  it('흐림은 투명도뿐 — RO 안에 hex 색이 없다', () => {
    const UI = readFileSync(root('src/lib/readOnlyUi.jsx'), 'utf8')
    expect(UI).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(RO_OPACITY).toBe(0.45)
  })
})
