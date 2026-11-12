// =============================================================================
// supabase/functions/admin-set-role/index.ts
//
// 관리자가 **약국 역할을 바꾸거나 계정을 끈다**. (2026-11-12 이정화 님 승인)
//
// 왜 Edge Function 인가
//   tenant_members 는 **쓰기 정책이 없다**(SELECT 하나뿐). 화면에서는 못 고친다.
//   정책을 열면 「약국 사람이면 누구나 자기 역할을 바꾸는」 구멍이 생긴다.
//   그래서 서비스 키를 쥔 서버만 고치게 하고, 조건은 **여기서** 지킨다.
//
// ★ 이 함수에서는 「관리자 확인」이 **유일한 자물쇠**다
//   (tenant_members 에는 뷰어 트리거가 없다 — 쓰기 정책이 없어 대상이 아니다).
//   그래서 ① 확인을 통과하기 **전에는 서비스 키를 손에 쥐지 않고**
//          ② 판단을 _shared/roleRules.ts 의 **순수 함수**로 빼서 전수 시험한다.
//
// 지키는 것 — roleRules.ts 가 차례대로 본다
//   ① 부른 사람이 owner·admin 이고 **사용 중**인가 (중지된 관리자도 막힌다)
//   ② ★ 자기 자신은 못 바꾼다   ③ 남의 약국 계정은 못 건드린다
//   ④ ★ 마지막 대표를 지킨다    ⑤ 역할 값이 올바른가
//   ⑥ 감사 기록(전 → 후 · 누가)
//
// 몸체: { target, role?, is_active? }   role ∈ owner|admin|member|viewer
// 답:   { ok, role, is_active } 또는 { ok:false, code, message }
// =============================================================================

import { requireTenantAdmin, adminClient, json, corsHeaders, safeLog } from "../_shared/adminAuth.ts";
import { validateSetRole, roleLabel } from "../_shared/roleRules.ts";
import { writeAccountAudit } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, code: "method", message: "POST 로 불러 주세요" }, 405);

  /* ★ ① 먼저 확인한다 — 여기서는 **anon 키 + 부른 사람의 토큰**만 쓴다 */
  const caller = await requireTenantAdmin(req);
  if (!caller) {
    safeLog({ fn: "admin-set-role", step: "auth", ok: false, code: "forbidden" });
    return json({ ok: false, code: "forbidden", message: "관리자만 바꿀 수 있습니다" }, 403);
  }

  let body: { target?: string; role?: string; is_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: "bad_json", message: "보낸 값을 읽지 못했습니다" }, 400);
  }
  const target = String(body.target ?? "").trim();
  const role = body.role === undefined ? null : String(body.role);
  const isActive = body.is_active === undefined ? null : !!body.is_active;

  /* ★ 확인을 통과한 뒤에야 서비스 키를 쓴다 */
  const admin = adminClient();

  const { data: current } = await admin
    .from("tenant_members").select("tenant_id, role, is_active").eq("user_id", target).maybeSingle();

  /* 1차 판단 — 대표가 줄어드는 변경이면 대표 수를 세어 다시 묻는다 */
  let v = validateSetRole({
    callerId: caller.userId, callerTenant: caller.tenantId,
    target, role, isActive, current: current ?? null, activeOwnerCount: null,
  });
  if (!v.ok && v.losingOwner) {
    const { count } = await admin
      .from("tenant_members")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", caller.tenantId).eq("role", "owner").eq("is_active", true);
    v = validateSetRole({
      callerId: caller.userId, callerTenant: caller.tenantId,
      target, role, isActive, current: current ?? null, activeOwnerCount: count ?? 0,
    });
  }
  if (!v.ok) {
    safeLog({ fn: "admin-set-role", step: "reject", ok: false, code: v.code, target });
    return json({ ok: false, code: v.code, message: v.message }, v.status ?? 400);
  }

  /* 바꾸기 */
  const patch: Record<string, unknown> = {};
  if (role !== null) patch.role = role;
  if (isActive !== null) patch.is_active = isActive;
  const { error } = await admin.from("tenant_members").update(patch).eq("user_id", target);
  if (error) {
    safeLog({ fn: "admin-set-role", step: "update", ok: false, code: error.code, target });
    return json({ ok: false, code: "update_failed", message: "바꾸지 못했습니다" }, 500);
  }

  /* 감사 — 전 → 후 */
  /* ★ 감사가 실패해도 **역할은 이미 바뀌었다.** 성공으로 끝내고 답에만 적는다.
     (2026-11-12 사고: 여기서 터져 「바꿨는데 실패」로 보였다) */
  const audit = await writeAccountAudit(admin, {
    tenantId: caller.tenantId,
    field: "tenant_role",
    oldValue: roleLabel(current!.role, current!.is_active !== false),
    newValue: roleLabel(v.nextRole!, v.nextActive!),
    changedBy: caller.userId,
  });

  safeLog({ fn: "admin-set-role", step: "done", ok: true, target, role: v.nextRole, reason: audit });
  return json({ ok: true, role: v.nextRole, is_active: v.nextActive, audit });
});
