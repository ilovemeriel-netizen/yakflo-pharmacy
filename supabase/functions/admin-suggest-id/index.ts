// =============================================================================
// supabase/functions/admin-suggest-id/index.ts
//
// 역할을 받아 **비어 있는 가장 작은 아이디**를 돌려준다. (2026-11-12 이정화 님 승인)
//
// 왜 서버인가
//   화면이 보는 profiles 목록에는 빠진 줄이 있을 수 있다(정책·쪽 나누기).
//   서비스 키로 **모든 계정**을 보고 정하는 쪽이 어긋나지 않는다.
//
// 보안 설계
//   * 부른 사람이 이 약국의 owner·admin 인지 **서버에서 다시 본다.**
//   * 계정을 만들지 않는다 — **읽기만** 하고 글자 하나를 돌려준다.
//   * 비밀번호는 받지도 돌려주지도 않는다.
//
// 몸체: { role }   role ∈ admin|member|viewer   (owner 는 자동 없음)
// 답:   { ok, id } · 자동이 안 되면 { ok:true, id:null, reason:'full'|'no_prefix' }
// =============================================================================

import {
  adminClient, requireTenantAdmin, json, corsHeaders, safeLog, emailToId,
} from "../_shared/adminAuth.ts";

/** 역할 → 접두어. 화면(src/lib/loginId.js)의 ROLE_PREFIX 와 **같은 값**이어야 한다. */
const ROLE_PREFIX: Record<string, string> = { admin: "admin", member: "user", viewer: "viewer" };
const MAX_NO = 99;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ ok: false, code: "method", message: "POST 로 불러 주세요" }, 405);

  const caller = await requireTenantAdmin(req);
  if (!caller) {
    safeLog({ fn: "admin-suggest-id", step: "auth", ok: false, code: "forbidden" });
    return json({ ok: false, code: "forbidden", message: "관리자만 쓸 수 있습니다" }, 403);
  }

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: "bad_json", message: "보낸 값을 읽지 못했습니다" }, 400);
  }
  const role = String(body.role ?? "");
  const prefix = ROLE_PREFIX[role];
  if (!prefix) {
    // 대표(owner)는 자동으로 넣지 않는다 — 오류가 아니라 "자동 없음"이다.
    safeLog({ fn: "admin-suggest-id", step: "no_prefix", ok: true, role });
    return json({ ok: true, id: null, reason: "no_prefix" });
  }

  // ── 이미 쓰는 아이디 모으기 ──
  const admin = adminClient();
  const { data: rows, error } = await admin.from("profiles").select("email");
  if (error) {
    safeLog({ fn: "admin-suggest-id", step: "list", ok: false, code: error.code });
    return json({ ok: false, code: "list_failed", message: "계정을 읽지 못했습니다" }, 500);
  }
  const used = new Set<string>();
  for (const r of rows ?? []) {
    const id = r?.email ? emailToId(String(r.email)) : null;
    if (id) used.add(id);
  }

  // ── 비어 있는 가장 작은 번호 ──
  for (let n = 1; n <= MAX_NO; n++) {
    const cand = prefix + String(n).padStart(2, "0");
    if (!used.has(cand)) {
      safeLog({ fn: "admin-suggest-id", step: "done", ok: true, role, id: cand });
      return json({ ok: true, id: cand });
    }
  }
  safeLog({ fn: "admin-suggest-id", step: "full", ok: true, role });
  return json({ ok: true, id: null, reason: "full" });
});
