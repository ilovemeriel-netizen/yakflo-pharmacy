/* 「회원 탈퇴」를 보일까 말까 — 화면 쪽 판단. (2026-11-12 이정화 님 승인)
 *
 * ★ 진짜 자물쇠는 **서버**다 — netlify/functions/account-delete.js 가 403 으로 막는다.
 *   이 파일은 **누를 수 없는 단추를 아예 안 보이게** 해서 헛걸음을 줄인다.
 *
 * ★ 막는 글자는 서버와 **같은 말**을 쓴다
 *   (netlify/functions/_lib/accountDeleteRules.js 의 LEAVE_MSG 와 맞춘다 — 시험이 지킨다).
 */

export const ID_DOMAIN = 'id.yakflo.invalid'

export const LEAVE_BLOCK = {
  issued: {
    code: 'issued_account',
    title: '발급 계정은 탈퇴할 수 없습니다',
    help: '그만 쓰시려면 약제과 관리자에게 말씀해 주세요',
  },
  lastOwner: {
    code: 'last_owner',
    title: '대표 계정은 탈퇴할 수 없습니다',
    help: '다른 분을 대표로 지정한 뒤 가능합니다',
  },
}

/** 관리자가 만든 계정인가 — 아이디 계정이거나 created_by 가 있으면 참 */
export function isIssuedAccount(email, createdBy) {
  const e = String(email || '').trim().toLowerCase()
  if (e.endsWith('@' + ID_DOMAIN)) return true
  return !!(createdBy && String(createdBy).trim())
}

/**
 * 탈퇴를 막아야 하나.
 *   돌려주는 값: null(막지 않음) 또는 LEAVE_BLOCK 의 한 덩이
 */
export function leaveBlockReason({ email, createdBy, role, isActive, activeOwnerCount } = {}) {
  if (isIssuedAccount(email, createdBy)) return LEAVE_BLOCK.issued
  const amActiveOwner = role === 'owner' && isActive !== false
  if (amActiveOwner && Number(activeOwnerCount) <= 1) return LEAVE_BLOCK.lastOwner
  return null
}
