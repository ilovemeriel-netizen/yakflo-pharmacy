// =============================================================================
// supabase/functions/_shared/audit.ts
//
// 계정 관련 감사 기록 한 줄. (2026-11-12 — 「성공했는데 실패」 고침)
//
// ★ 왜 따로 뺐나 — 2026-11-12 사고
//   감사 insert 에 `.catch(() => {})` 를 붙였는데, Supabase 질의 객체에는
//   **`catch` 가 없다**(`then` 만 있다). 그래서 오류를 삼키려던 그 줄이
//   오히려 함수를 죽였고, **계정은 만들어졌는데 화면에는 「실패」**가 떴다.
//
// ★ 그래서 이 조각이 지키는 것
//   ① `.catch` 를 쓰지 않는다 — `await` 로 받아 **결과만 본다**.
//   ② 무슨 일이 있어도 **던지지 않는다**(try 로 감싼다).
//   ③ 성공·실패를 **글자로 돌려준다** — 부르는 쪽이 답에 담아 알릴 수 있게.
//      감사가 실패해도 **본래 일(계정·역할)은 성공으로 끝낸다.**
// =============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type AuditResult = "ok" | "skipped";

export interface AuditRow {
  tenantId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
}

/**
 * 감사 한 줄을 남긴다. **절대 던지지 않는다.**
 * 돌려주는 값: 'ok' 남김 · 'skipped' 못 남김(권한·연결 등)
 */
export async function writeAccountAudit(
  admin: SupabaseClient,
  row: AuditRow,
): Promise<AuditResult> {
  try {
    const { error } = await admin.from("drug_usage_audit").insert({
      tenant_id: row.tenantId,
      drug_code: "(계정)",
      field: row.field,
      old_value: row.oldValue,
      new_value: row.newValue,
      changed_by: row.changedBy,
    });
    return error ? "skipped" : "ok";
  } catch {
    /* 연결이 끊기든 무엇이든 — 본래 일을 망치지 않는다 */
    return "skipped";
  }
}
