// =============================================================================
// supabase/functions/close-monitor/index.ts
//
// 월마감 모니터링 실행 + 관리자 통지
//
// 보안 설계
//   * SERVICE_ROLE_KEY 는 이 함수의 환경변수에서만 읽는다. 프론트엔드 번들에
//     절대 포함되지 않는다 (Edge Function 은 서버 사이드 실행).
//   * 호출자는 CRON_SECRET 헤더로 인증한다. 이 값도 서버 환경변수다.
//   * 프론트엔드는 이 함수를 직접 호출하지 않는다. 알림 결과는
//     close_monitor_alerts 를 RLS 를 통해 SELECT 해서 읽는다 (anon key 로 충분).
//
// ★ 통지 등급 — NOTIFY_LEVELS = CRITICAL·HIGH 만.
//   MEDIUM 이하(LOW·INFO 포함)는 적재만 하고 알리지 않는다(알림 피로 방지).
//   특히 INFO 인 QTY_CHANGE_DIRECT(실사 조정 정상 경로)와
//   LEDGER_DIVERGENCE(결재/약플로 2계통 격차 추적)는 **설계상 통지 대상이 아니다**.
//   이 둘이 알림으로 나가면 설계 오류다.
//
// 환경변수 (supabase secrets set 으로 등록, 코드/저장소에 값 금지)
//   SUPABASE_URL              자동 주입
//   SUPABASE_SERVICE_ROLE_KEY 자동 주입
//   CRON_SECRET               호출자 인증용 임의 문자열
//   ALERT_WEBHOOK_URL         (선택) Slack/Teams 등 수신 URL
//   ALERT_EMAIL_TO            (선택) 관리자 이메일
//   RESEND_API_KEY            (선택) 이메일 발송용
//   TENANT_ID                 대상 테넌트 UUID
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

interface Alert {
  id: string;
  period: string;
  check_code: string;
  severity: Severity;
  category: string;
  drug_code: string | null;
  drug_name: string | null;
  title: string;
  detail: Record<string, unknown>;
  metric_value: number | null;
  detected_at: string;
}

// ★ 통지 대상 등급. MEDIUM 이하는 적재만 하고 알리지 않는다.
const NOTIFY_LEVELS: Severity[] = ["CRITICAL", "HIGH"];

const SEVERITY_ICON: Record<Severity, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🔵",
  INFO: "⚪",
};

function env(key: string, required = true): string {
  const v = Deno.env.get(key);
  if (required && !v) throw new Error(`환경변수 ${key} 가 설정되지 않았습니다.`);
  return v ?? "";
}

// ── 타이밍 공격에 안전한 비교 ────────────────────────────────────────────────
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function buildMessage(period: string, alerts: Alert[]): string {
  const byLevel = NOTIFY_LEVELS.map((lv) => ({
    lv,
    items: alerts.filter((a) => a.severity === lv),
  })).filter((g) => g.items.length > 0);

  const lines: string[] = [
    `*[약플로] ${period} 마감 모니터링 경고*`,
    `총 ${alerts.length}건 검출`,
    "",
  ];

  for (const { lv, items } of byLevel) {
    lines.push(`${SEVERITY_ICON[lv]} *${lv}* — ${items.length}건`);
    // 등급별 최대 10건까지만 본문에 싣는다. 나머지는 화면에서 확인.
    for (const a of items.slice(0, 10)) {
      const who = a.drug_name ? ` (${a.drug_name})` : "";
      lines.push(`  • [${a.check_code}] ${a.title}${who}`);
    }
    if (items.length > 10) lines.push(`  … 외 ${items.length - 10}건`);
    lines.push("");
  }

  lines.push("확인: https://yakflo.ehwaa.com → 재고관리 → 마감 모니터링");
  return lines.join("\n");
}

async function sendWebhook(text: string): Promise<boolean> {
  const url = env("ALERT_WEBHOOK_URL", false);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`webhook 실패: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("webhook 예외:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function sendEmail(subject: string, text: string): Promise<boolean> {
  const key = env("RESEND_API_KEY", false);
  const to = env("ALERT_EMAIL_TO", false);
  if (!key || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "yakflo-monitor@ehwaa.com",
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`email 실패: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("email 예외:", e instanceof Error ? e.message : e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  // ── 1. 호출자 인증 ──────────────────────────────────────────────────────
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!safeEqual(provided, env("CRON_SECRET"))) {
    // 무엇이 틀렸는지 알려주지 않는다.
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 2. 파라미터 ─────────────────────────────────────────────────────────
  let period: string | null = null;
  let persist = true;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (typeof body.period === "string" && /^\d{4}-\d{2}$/.test(body.period)) {
        period = body.period;
      }
      if (typeof body.persist === "boolean") persist = body.persist;
    } catch {
      // 본문 없음 = 기본값(직전월, 적재함) 사용
    }
  }

  const tenantId = env("TENANT_ID");
  const supabase = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  try {
    // ── 3. 검증 실행 ──────────────────────────────────────────────────────
    const { data: summary, error: rpcError } = await supabase.rpc(
      "run_close_monitor",
      { p_tenant_id: tenantId, p_period: period, p_persist: persist },
    );

    if (rpcError) {
      console.error("run_close_monitor 실패:", rpcError.message);
      // 검증 자체의 실패는 관리자에게 알려야 한다. 조용히 죽으면 안 된다.
      await sendWebhook(
        `🔴 *[약플로] 마감 모니터링 실행 실패*\n${rpcError.message}`,
      );
      return new Response(
        JSON.stringify({ ok: false, stage: "rpc", error: rpcError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // dryrun 이면 적재도 통지도 하지 않는다.
    if (!persist) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "dryrun",
          summary,
          elapsed_ms: Date.now() - startedAt,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── 4. 미통지 CRITICAL/HIGH 수집 ──────────────────────────────────────
    //    ★ .in("severity", NOTIFY_LEVELS) 가 INFO 를 배제한다.
    //      QTY_CHANGE_DIRECT · LEDGER_DIVERGENCE 는 여기서 조회되지 않으므로
    //      notified_at 도 찍히지 않고 통지도 나가지 않는다.
    const { data: pending, error: selError } = await supabase
      .from("close_monitor_alerts")
      .select(
        "id, period, check_code, severity, category, drug_code, drug_name, " +
          "title, detail, metric_value, detected_at",
      )
      .eq("tenant_id", tenantId)
      .in("severity", NOTIFY_LEVELS)
      .is("notified_at", null)
      .is("acknowledged_at", null)
      .order("detected_at", { ascending: false })
      .limit(200);

    if (selError) throw new Error(`알림 조회 실패: ${selError.message}`);

    const alerts = (pending ?? []) as Alert[];

    if (alerts.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          notified: 0,
          message: "통지 대상 없음",
          summary,
          elapsed_ms: Date.now() - startedAt,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── 5. 통지 ───────────────────────────────────────────────────────────
    const targetPeriod = alerts[0].period;
    const message = buildMessage(targetPeriod, alerts);
    const criticalCount = alerts.filter((a) => a.severity === "CRITICAL").length;
    const subject =
      `[약플로] ${targetPeriod} 마감 경고 ${alerts.length}건` +
      (criticalCount > 0 ? ` (CRITICAL ${criticalCount})` : "");

    const [webhookOk, emailOk] = await Promise.all([
      sendWebhook(message),
      sendEmail(subject, message),
    ]);

    // ── 6. 통지 성공한 것만 notified_at 표시 ──────────────────────────────
    //    실패했으면 표시하지 않는다. 다음 실행에서 재시도된다.
    let marked = 0;
    if (webhookOk || emailOk) {
      const { error: updError, count } = await supabase
        .from("close_monitor_alerts")
        .update({ notified_at: new Date().toISOString() }, { count: "exact" })
        .in("id", alerts.map((a) => a.id));
      if (updError) {
        console.error("notified_at 갱신 실패:", updError.message);
      } else {
        marked = count ?? alerts.length;
      }
    } else {
      console.error(
        "통지 채널이 모두 실패했습니다. notified_at 미표시 → 다음 실행에서 재시도합니다.",
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        period: targetPeriod,
        detected: alerts.length,
        critical: criticalCount,
        channels: { webhook: webhookOk, email: emailOk },
        marked_notified: marked,
        summary,
        elapsed_ms: Date.now() - startedAt,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("close-monitor 예외:", msg);
    await sendWebhook(`🔴 *[약플로] 마감 모니터링 예외*\n${msg}`);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
