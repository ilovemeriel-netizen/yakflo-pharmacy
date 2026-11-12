/* ═══════════════════════════════════════════════════════════════
   회원 탈퇴를 막아야 하는가 — **판단만** 한다. (2026-11-12 이정화 님 승인)

   ★ 왜 따로 뺐나
     탈퇴는 **되돌릴 수 없다**. auth 계정을 지우면 profiles·tenant_members 가
     CASCADE 로 함께 사라진다(외래키 실측). 그래서 막는 조건을 **순수 함수**로 빼서
     vitest 로 전수 시험한다 — 실제 계정을 하나도 건드리지 않고 확인할 수 있다.

   ★ 막는 세 가지
     ① 발급 계정 — 아이디 계정(@id.yakflo.invalid)
     ② 발급 계정 — user_metadata.created_by 가 있는 계정(관리자가 만든 것)
     ③ 마지막 대표 — 켜진 대표(owner)가 1명뿐인데 그 대표가 탈퇴하려는 경우

   ★ 화면도 같은 글자를 쓴다(src/lib/leaveNotice.js 가 이 글자를 가져간다) —
     서버가 막는 까닭과 화면 안내가 어긋나지 않게.
   ═══════════════════════════════════════════════════════════════ */

/** 아이디 계정의 내부 주소 꼬리 — src/lib/loginId.js 의 ID_DOMAIN 과 **같은 값** */
export const ID_DOMAIN = 'id.yakflo.invalid'

export const LEAVE_MSG = {
  issued: '발급 계정은 탈퇴할 수 없습니다',
  lastOwner: '대표 계정은 탈퇴할 수 없습니다 · 다른 분을 대표로 지정한 뒤 가능합니다',
}

/** 관리자가 만든 계정인가 — ① 아이디 계정이거나 ② created_by 가 있으면 참 */
export function isIssuedAccount({ email, createdBy } = {}) {
  const e = String(email || '').trim().toLowerCase()
  if (e.endsWith('@' + ID_DOMAIN)) return true
  return !!(createdBy && String(createdBy).trim())
}

/**
 * 탈퇴해도 되는가.
 *   email            : 그 사람의 로그인 주소
 *   createdBy        : user_metadata.created_by (없으면 null)
 *   role             : tenant_members.role (약국에 안 속하면 null)
 *   isActive         : tenant_members.is_active
 *   activeOwnerCount : 지금 **켜진 대표** 수
 * 돌려주는 값: { ok: true } 또는 { ok: false, code, msg }
 */
export function canDeleteAccount({ email, createdBy, role, isActive, activeOwnerCount } = {}) {
  if (isIssuedAccount({ email, createdBy })) {
    return { ok: false, code: 'issued_account', msg: LEAVE_MSG.issued }
  }
  /* 켜진 대표만 센다 — 꺼진 대표는 약국을 돌볼 수 없다 */
  const amActiveOwner = role === 'owner' && isActive !== false
  if (amActiveOwner && Number(activeOwnerCount) <= 1) {
    return { ok: false, code: 'last_owner', msg: LEAVE_MSG.lastOwner }
  }
  return { ok: true }
}
