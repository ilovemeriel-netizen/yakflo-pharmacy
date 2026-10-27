/* ════════════════════════════════════════════════════════════════
   백신 잔량 — 조회·판정 공용 모듈 (vaccine-stock · vaccine-verify 양쪽이 쓴다)

   ★ 이 디렉터리(`_lib`)는 Function 이 아니다 — 밑줄로 시작하고 `index.js` 도
     디렉터리명과 같은 파일도 두지 않으므로 Netlify 가 엔드포인트로 올리지 않는다.
     새 파일을 넣을 때 `_lib.js` 나 `index.js` 라는 이름은 쓰지 말 것.

   ★ 잔량 수식을 새로 만들지 않는다 — v_vaccine_balance 의 balance_qty · received_qty 를
     그대로 쓴다. (뷰 정의: 입고 − 접종 − 반납 − 폐기. 0089 에서 한 번만 정의한다)

   ★ service_role 은 RLS 를 우회한다 — 모든 조회에 tenant_id 조건을 **직접** 건다.

   ★ 반환 필드 최소화 — { season, updated_at, items:[{label, qty, status}] } 가 전부다.
     drug_code · 약품명 · 입고량 · 배정량 · LOT · 유효기간은 **일절 싣지 않는다**.

   ★ Supabase 클라이언트를 여기서 만들지 않는다 — 호출부가 넘긴다.
     그래서 이 파일은 DB 없이 단위 시험할 수 있다(가짜 client 주입).
   ════════════════════════════════════════════════════════════════ */

/* ── 상태 임계값 — ★ 이 파일 한 곳에만 둔다 ──────────────────────────────
   소진: 남은 게 없다 / 부족: 열 개 이하 / 주의: 입고분의 1/4 아래로 떨어졌다 / 그 외 충분.
   received 가 0 이면 비율을 낼 수 없으므로 '주의' 판정을 건너뛴다(0 으로 나누지 않는다). */
export const LOW_QTY = 10
export const WARN_RATIO = 0.25
export function stockStatus(balance, received) {
  const b = Number(balance || 0), r = Number(received || 0)
  if (b <= 0) return '소진'
  if (b <= LOW_QTY) return '부족'
  if (r > 0 && b < r * WARN_RATIO) return '주의'
  return '충분'
}

/* ── 잔량 목록 한 번 읽기 ─────────────────────────────────────────────────
   admin    : service_role 로 만든 Supabase 클라이언트
   tenantId : VACCINE_TENANT_ID
   today    : 'YYYY-MM-DD' (KST) — 호출부가 kstToday() 로 넘긴다

   반환 { ok: true, data: { season, updated_at, items } }
      또는 { ok: false, step, message }   step 은 로그용 이름이고 응답에 싣지 않는다.

   ★ 순서 — 계정을 먼저 읽고(뒤 두 조회가 그 id 목록을 쓴다),
     서로 독립인 잔량·마지막시각은 Promise.all 로 동시에 보낸다.
     오류 우선순위는 잔량 → 시각 순으로 그대로 둔다(직렬이던 때와 같은 메시지). */
export async function loadStock(admin, tenantId, today) {
  /* 1) 대상 계정 — tenant · 활성 · 오늘(KST)이 절기 안 · 공개 표시명 있음 */
  const { data: accs, error: aErr } = await admin
    .from('vaccine_accounts')
    .select('id, season, public_label')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('season_start', today)
    .gte('season_end', today)
    .not('public_label', 'is', null)
  if (aErr) return { ok: false, step: '계정', message: aErr.message }

  const list = accs || []
  if (!list.length) return { ok: true, data: { season: null, updated_at: null, items: [] } }

  const ids = list.map(a => a.id)

  /* 2) 잔량 + 마지막 입력 시각 — 서로를 기다릴 이유가 없으므로 동시에 보낸다.
     마지막 시각은 집계 함수를 PostgREST 로 바로 쓰기 어려워 내림차순 1행만 받는다. */
  const [balRes, lastRes] = await Promise.all([
    admin
      .from('v_vaccine_balance')
      .select('account_id, balance_qty, received_qty')
      .eq('tenant_id', tenantId)
      .in('account_id', ids),
    admin
      .from('vaccine_events')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .in('account_id', ids)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (balRes.error) return { ok: false, step: '잔량', message: balRes.error.message }
  if (lastRes.error) return { ok: false, step: '시각', message: lastRes.error.message }

  const balOf = {}
  for (const b of (balRes.data || [])) balOf[b.account_id] = b

  const items = list.map(a => {
    const b = balOf[a.id] || {}
    const qty = Number(b.balance_qty || 0)
    return { label: String(a.public_label), qty, status: stockStatus(qty, b.received_qty) }
  }).sort((x, y) => x.label.localeCompare(y.label, 'ko'))

  /* ★ season 은 대상 계정의 값. 여럿이면 첫 번째를 쓴다(현재 운영은 한 절기만 열린다). */
  return {
    ok: true,
    data: {
      season: list[0].season || null,
      updated_at: (lastRes.data || [])[0]?.created_at || null,
      items,
    },
  }
}
