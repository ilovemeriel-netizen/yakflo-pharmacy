// =============================================================================
// supabase/functions/admin-create-user/index.ts
//
// 관리자가 **아이디 + 비밀번호**로 계정을 만든다. (2026-11-12 이정화 님 승인)
//
// 왜 Edge Function 인가
//   * 화면에서 supabase.auth.signUp 을 쓰면 **관리자가 새 계정으로 로그인**된다(튕겨 나감).
//   * 계정 생성은 서비스 키가 필요하고, 그 키는 **서버에만** 있어야 한다.
//
// 보안 설계
//   * 부른 사람이 이 약국의 owner·admin 인지 **서버에서 다시 본다**(화면 말을 안 믿는다).
//   * ★ 비밀번호는 **어디에도 남기지 않는다** — 변수에 담아 Supabase 로 바로 넘기고 끝.
//     로그에는 safeLog() 가 허용한 열쇠(fn·step·ok·code·id·role…)만 찍힌다.
//   * 메일은 **보내지 않는다**. email_confirm: true 로 만들어 확인 절차를 건너뛴다
//     (대시보드의 Confirm email 설정은 건드리지 않는다 — 2026-11-12 이정화 님 정정).
//   * 내부 주소는 id.yakflo.invalid — 국제 규약(RFC 2606)이 "없는 이름"으로 못 박아
//     메일이 **갈 곳이 없다**.
//
// 몸체: { id, password, role }  role ∈ owner|admin|member|viewer
// 답:   { ok, id, email, role } 또는 { ok:false, code, message }
// =============================================================================

import {
  ID_RE, idToEmail, adminClient, requireTenantAdmin, json, corsHeaders, safeLog,
} from "../_shared/adminAuth.ts";
import { writeAccountAudit } from "../_shared/audit.ts";

const ROLES = ["owner", "admin", "member", "viewer"];
const PW_MIN = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, code: "method", message: "POST 로 불러 주세요" }, 405);

  const caller = await requireTenantAdmin(req);
  if (!caller) {
    safeLog({ fn: "admin-create-user", step: "auth", ok: false, code: "forbidden" });
    return json({ ok: false, code: "forbidden", message: "관리자만 계정을 만들 수 있습니다" }, 403);
  }

  // ── 입력 — password 는 여기서만 쓰고 절대 로그에 넣지 않는다 ──
  let body: { id?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: "bad_json", message: "보낸 값을 읽지 못했습니다" }, 400);
  }
  const id = String(body.id ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "member");

  if (!ID_RE.test(id)) {
    return json({
      ok: false, code: "bad_id",
      message: "아이디는 영문 소문자·숫자 4~20자이고 첫 글자는 영문이어야 합니다",
    }, 400);
  }
  if (password.length < PW_MIN) {
    return json({ ok: false, code: "bad_password", message: `비밀번호는 ${PW_MIN}자 이상이어야 합니다` }, 400);
  }
  if (!ROLES.includes(role)) {
    return json({ ok: false, code: "bad_role", message: "약국 역할이 올바르지 않습니다" }, 400);
  }

  const admin = adminClient();
  const email = idToEmail(id);

  // ── 중복 확인 — profiles 에 같은 주소가 있나 ──
  const { data: dup } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (dup) {
    safeLog({ fn: "admin-create-user", step: "dup", ok: false, id });
    return json({ ok: false, code: "duplicate", message: "이미 쓰는 아이디입니다" }, 409);
  }

  // ── 계정 생성 — 메일 확인 완료 상태로, 메일 발송 없음 ──
  const { data: made, error: mkErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { login_id: id, created_by: caller.userId },
  });
  if (mkErr || !made?.user) {
    safeLog({ fn: "admin-create-user", step: "create", ok: false, code: mkErr?.code ?? "unknown", id });
    const dupLike = /already|exists|registered/i.test(mkErr?.message ?? "");
    return json({
      ok: false,
      code: dupLike ? "duplicate" : "create_failed",
      message: dupLike ? "이미 쓰는 아이디입니다" : "계정을 만들지 못했습니다",
    }, dupLike ? 409 : 500);
  }
  const newId = made.user.id;

  // ── 약국 역할 넣기 — 실패하면 만든 계정을 지운다(중간에 끊긴 계정이 안 남게) ──
  const { error: memErr } = await admin.from("tenant_members").insert({
    user_id: newId, tenant_id: caller.tenantId, role, is_active: true,
  });
  if (memErr) {
    await admin.auth.admin.deleteUser(newId).catch(() => {});
    safeLog({ fn: "admin-create-user", step: "member", ok: false, code: memErr.code, id });
    return json({ ok: false, code: "role_failed", message: "역할을 넣지 못해 계정을 되돌렸습니다" }, 500);
  }

  // ── profiles 보강 (트리거가 이미 만들었다면 덮어쓰기만) ──
  await admin.from("profiles").upsert({ id: newId, email }, { onConflict: "id" });

  // ── 감사 — ★ 실패해도 **계정은 이미 만들어졌다.** 성공으로 끝내고 답에만 적는다.
  //    (2026-11-12 사고: 여기서 터져 「만들었는데 실패」로 보였다) ──
  const audit = await writeAccountAudit(admin, {
    tenantId: caller.tenantId,
    field: "account_create",
    oldValue: null,
    newValue: `${id} · ${role}`,
    changedBy: caller.userId,
  });

  safeLog({ fn: "admin-create-user", step: "done", ok: true, id, role, target: newId, reason: audit });
  return json({ ok: true, id, email, role, audit });
});
