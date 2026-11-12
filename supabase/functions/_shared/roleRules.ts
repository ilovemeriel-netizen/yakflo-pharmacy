// =============================================================================
// supabase/functions/_shared/roleRules.ts
//
// 약국 역할·사용 상태를 바꿀 수 있는지 **판단만** 한다. (2026-11-12 이정화 님 승인)
//
// ★ 왜 따로 뺐나
//   이 함수에서는 「관리자 확인」이 **유일한 자물쇠**다(tenant_members 에는 뷰어 트리거가 없다).
//   그래서 판단을 **순수 함수**로 빼서 vitest 로 전수 시험한다 — Deno 없이도 돈다.
//   Edge Function 과 시험이 **같은 코드**를 보므로 둘이 어긋날 수 없다.
//
// ★ Deno·Supabase 를 쓰지 않는다. 바깥 세상과 닿는 것이 없다.
// =============================================================================

export const ROLES = ["owner", "admin", "member", "viewer"];

export interface Member {
  tenant_id: string;
  role: string;
  is_active?: boolean | null;
}

export interface Verdict {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  nextRole?: string;
  nextActive?: boolean;
  /** 대표가 줄어드는 변경인가 — 참이면 부르는 쪽이 대표 수를 세어 다시 묻는다 */
  losingOwner?: boolean;
}

/**
 * 부른 사람이 역할을 바꿀 수 있나.
 *   m = tenant_members 에서 읽은 **자기 줄** (없으면 null)
 * ★ 끈 계정(is_active=false)은 관리자여도 못 바꾼다.
 */
export function callerAllowed(m: Member | null | undefined): Verdict {
  if (!m) return { ok: false, status: 403, code: "forbidden", message: "관리자만 바꿀 수 있습니다" };
  if (m.is_active === false) {
    return { ok: false, status: 403, code: "forbidden", message: "중지된 계정입니다" };
  }
  if (m.role !== "owner" && m.role !== "admin") {
    return { ok: false, status: 403, code: "forbidden", message: "관리자만 바꿀 수 있습니다" };
  }
  return { ok: true };
}

export interface SetRoleInput {
  callerId: string;
  callerTenant: string;
  target: string;
  /** 바꿀 값 — 안 바꾸면 null */
  role: string | null;
  isActive: boolean | null;
  /** 대상의 지금 줄 (없으면 null = 이 약국 사람이 아님) */
  current: Member | null;
  /** 지금 **켜져 있는 대표** 수. 모르면 null 로 주고, losingOwner 가 참이면 다시 묻는다. */
  activeOwnerCount: number | null;
}

/**
 * 바꿔도 되는지 판단한다. 바뀌는 값까지 함께 돌려준다.
 *
 * 막는 차례 — 하나라도 걸리면 거기서 끝낸다.
 *   ① 대상이 없음 ② 바꿀 값이 없음 ③ 역할 값이 이상함
 *   ④ ★ 자기 자신 ⑤ 남의 약국 ⑥ ★ 마지막 대표
 */
export function validateSetRole(i: SetRoleInput): Verdict {
  if (!i.target) return { ok: false, status: 400, code: "bad_target", message: "대상이 없습니다" };
  if (i.role === null && i.isActive === null) {
    return { ok: false, status: 400, code: "nothing", message: "바꿀 값이 없습니다" };
  }
  if (i.role !== null && !ROLES.includes(i.role)) {
    return { ok: false, status: 400, code: "bad_role", message: "약국 역할이 올바르지 않습니다" };
  }
  if (i.target === i.callerId) {
    return {
      ok: false, status: 400, code: "self",
      message: "본인 역할·사용 상태는 바꿀 수 없습니다 — 다른 관리자가 바꿔야 합니다",
    };
  }
  if (!i.current || i.current.tenant_id !== i.callerTenant) {
    return { ok: false, status: 404, code: "not_found", message: "이 약국의 계정이 아닙니다" };
  }

  const nextRole = i.role === null ? i.current.role : i.role;
  const nextActive = i.isActive === null ? i.current.is_active !== false : i.isActive;

  /* ★ 마지막 대표 보호 — 지금 대표인데, 대표에서 내려오거나 꺼지는 경우 */
  const losingOwner = i.current.role === "owner" && (nextRole !== "owner" || nextActive === false);
  if (losingOwner) {
    if (i.activeOwnerCount === null) return { ok: false, losingOwner: true };
    if (i.activeOwnerCount <= 1) {
      return {
        ok: false, status: 400, code: "last_owner",
        message: "마지막 대표입니다 — 다른 사람을 먼저 대표로 올려 주세요",
      };
    }
  }
  return { ok: true, nextRole, nextActive, losingOwner };
}

/** 감사에 적을 글자 — 「owner · 사용 중」 꼴 */
export function roleLabel(role: string, active: boolean): string {
  return role + " · " + (active ? "사용 중" : "중지");
}
