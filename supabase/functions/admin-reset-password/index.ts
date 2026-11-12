// =============================================================================
// supabase/functions/admin-reset-password/index.ts
//
// 관리자가 **아이디 계정의 비밀번호를 다시 정한다**. (2026-11-12 이정화 님 승인)
//
// 왜 필요한가
//   아이디 계정은 내부 주소(id.yakflo.invalid)라 **메일을 못 받는다.**
//   「비밀번호 찾기」 메일이 갈 곳이 없으므로 관리자가 새 비밀번호를 정해 준다.
//
// 보안 설계
//   * 부른 사람이 이 약국의 owner·admin 인지 **서버에서 다시 본다.**
//   * 대상이 **같은 약국 사람**인지 확인한다(남의 약국 계정은 못 건드린다).
//   * ★ 자기 자신은 바꿀 수 없다 — 본인 비밀번호는 로그인 화면에서 바꾼다.
//   * ★ 비밀번호는 **어디에도 남기지 않는다.** 로그에는 safeLog() 가 허용한 열쇠만.
//   * ★ 이메일 계정은 대상이 아니다 — 메일로 재설정하는 길이 있다.
//
// 몸체: { target, password }   target = 바꿀 사람의 user id
// 답:   { ok } 또는 { ok:false, code, message }
// =============================================================================

import {
  emailToId, adminClient, requireTenantAdmin, json, corsHeaders, safeLog,
} from "../_shared/adminAuth.ts";

const PW_MIN = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, code: "method", message: "POST 로 불러 주세요" }, 405);

  const caller = await requireTenantAdmin(req);
  if (!caller) {
    safeLog({ fn: "admin-reset-password", step: "auth", ok: false, code: "forbidden" });
    return json({ ok: false, code: "forbidden", message: "관리자만 할 수 있습니다" }, 403);
  }

  let body: { target?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: "bad_json", message: "보낸 값을 읽지 못했습니다" }, 400);
  }
  const target = String(body.target ?? "").trim();
  const password = String(body.password ?? "");

  if (!target) return json({ ok: false, code: "bad_target", message: "대상이 없습니다" }, 400);
  if (target === caller.userId) {
    return json({
      ok: false, code: "self",
      message: "본인 비밀번호는 여기서 바꿀 수 없습니다 — 로그인 화면에서 바꿔 주세요",
    }, 400);
  }
  if (password.length < PW_MIN) {
    return json({ ok: false, code: "bad_password", message: `비밀번호는 ${PW_MIN}자 이상이어야 합니다` }, 400);
  }

  const admin = adminClient();

  // ── 같은 약국 사람인가 ──
  const { data: mem } = await admin
    .from("tenant_members").select("tenant_id").eq("user_id", target).maybeSingle();
  if (!mem || mem.tenant_id !== caller.tenantId) {
    safeLog({ fn: "admin-reset-password", step: "tenant", ok: false, target });
    return json({ ok: false, code: "not_found", message: "이 약국의 계정이 아닙니다" }, 404);
  }

  // ── 아이디 계정만 ──
  const { data: prof } = await admin.from("profiles").select("email").eq("id", target).maybeSingle();
  const loginId = prof?.email ? emailToId(prof.email) : null;
  if (!loginId) {
    return json({
      ok: false, code: "email_account",
      message: "이메일 계정입니다 — 로그인 화면의 「비밀번호 찾기」를 쓰세요",
    }, 400);
  }

  // ── 바꾸기 — password 는 여기서만 쓰고 로그에 넣지 않는다 ──
  const { error } = await admin.auth.admin.updateUserById(target, { password });
  if (error) {
    safeLog({ fn: "admin-reset-password", step: "update", ok: false, code: error.code ?? "unknown", target });
    return json({ ok: false, code: "update_failed", message: "비밀번호를 바꾸지 못했습니다" }, 500);
  }

  await admin.from("drug_usage_audit").insert({
    tenant_id: caller.tenantId,
    drug_code: "(계정)",
    field: "account_password_reset",
    old_value: null,
    new_value: loginId,
    changed_by: caller.userId,
  }).catch(() => {});

  safeLog({ fn: "admin-reset-password", step: "done", ok: true, id: loginId, target });
  return json({ ok: true });
});
