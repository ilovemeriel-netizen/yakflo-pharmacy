// =============================================================================
// supabase/functions/_shared/adminAuth.ts
//
// 관리자 전용 Edge Function 이 함께 쓰는 조각.
//
// 보안 설계
//   * SERVICE_ROLE_KEY 는 **이 함수 안에서만** 읽는다. 화면 번들에 절대 안 들어간다.
//   * 부른 사람의 토큰으로 "누구인지"를 확인하고, tenant_members 로 **역할**을 본다.
//     화면이 보낸 역할 값을 믿지 않는다 — 서버가 직접 다시 본다.
//   * ★ 비밀번호는 **로그에 찍지 않는다.** 아래 safeLog() 만 쓴다.
// =============================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** 아이디 → 내부 주소. 메일이 오갈 수 없는 이름(.invalid, RFC 2606)을 쓴다. */
export const ID_DOMAIN = Deno.env.get("ID_DOMAIN") ?? "id.yakflo.invalid";

/** 아이디 규칙 — 영문 소문자·숫자 4~20자, 첫 글자는 영문 */
export const ID_RE = /^[a-z][a-z0-9]{3,19}$/;

export function idToEmail(id: string): string {
  return `${id}@${ID_DOMAIN}`;
}

/** 내부 주소면 아이디만 돌려준다(화면 표시용) */
export function emailToId(email: string): string | null {
  const suffix = `@${ID_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : null;
}

/** ★ 로그 — 비밀번호가 섞여 들어오지 못하게 **허용한 열쇠만** 남긴다. */
const LOG_KEYS = ["fn", "step", "ok", "code", "id", "role", "target", "reason", "ms"];
export function safeLog(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of LOG_KEYS) if (k in obj) out[k] = obj[k];
  console.log(JSON.stringify(out));
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export interface Caller {
  userId: string;
  tenantId: string;
  role: string;
}

/** 서비스 키로 도는 클라이언트 — RLS 를 거치지 않는다. 함수 안에서만 쓴다. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * 부른 사람이 **이 약국의 관리자(owner·admin)이고 사용 중**인지 서버에서 확인한다.
 * 아니면 null 을 돌려준다(부르는 쪽은 403 으로 끝낸다).
 */
export async function requireTenantAdmin(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const admin = adminClient();
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return null;

  const { data: m, error: mErr } = await admin
    .from("tenant_members")
    .select("tenant_id, role, is_active")
    .eq("user_id", who.user.id)
    .maybeSingle();
  if (mErr || !m) return null;
  if (m.is_active === false) return null;
  if (m.role !== "owner" && m.role !== "admin") return null;

  return { userId: who.user.id, tenantId: m.tenant_id, role: m.role };
}
