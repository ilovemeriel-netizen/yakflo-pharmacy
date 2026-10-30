/* ════════════════════════════════════════════════════════════════
   백신 잔량 — 조회·판정 공용 모듈 (vaccine-stock · vaccine-verify 양쪽이 쓴다)

   ★ 이 디렉터리(`_lib`)는 Function 이 아니다 — 밑줄로 시작하고 `index.js` 도
     디렉터리명과 같은 파일도 두지 않으므로 Netlify 가 엔드포인트로 올리지 않는다.
     새 파일을 넣을 때 `_lib.js` 나 `index.js` 라는 이름은 쓰지 말 것.

   ★ 잔량 수식을 새로 만들지 않는다 — v_vaccine_balance 의 balance_qty · received_qty 를
     그대로 쓴다. (뷰 정의: 입고 − 접종 − 반납 − 폐기. 0089 에서 한 번만 정의한다)

   ★ service_role 은 RLS 를 우회한다 — 모든 조회에 tenant_id 조건을 **직접** 건다.

   ★ 반환 필드 최소화 — { season, updated_at, items:[{label, qty, status}] } 가 전부다.
     ★ 2026-10-28 — items 에 drug_name·maker 를 더했다(어느 제품인지 묻는 문의가 잦았다).
       drugs 에서 읽는 열은 **drug_name·manufacturer 두 개뿐**이다.
     입고량 · 배정량 · LOT · 유효기간 · 단가는 여전히 **일절 싣지 않는다**.

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

/* ── 공개 화면에 보일 약품명 ──────────────────────────────────────────────
   drugs 의 약품명에는 약제과 내부 구분용 앞머리가 붙어 있다
   (「독감-6 (…)」·「독감-5 지자체 (…)」). 공개 화면에서는 그 앞머리가 뜻이 없고
   오히려 제품명을 가린다. **보여 줄 때만** 다듬는다 —
   drugs 원본 값도, 약플로 다른 화면·엑셀도 그대로 둔다.

   규칙 ① 이름이 **괄호로 끝나면** 그 짝 안을 제품명으로 본다
           — 괄호 앞 공백이 있든 없든, 앞에 무슨 구분 문구가 붙어 있든 상관없다.
        ② 괄호로 끝나지 않으면 맨 앞의 「독감-숫자」와 뒤따르는 「지자체」만 없앤다
        ③ 그 결과가 비거나 괄호·공백뿐이면 원래 이름을 그대로 쓴다(이름을 잃지 않는다)

   ★ ①이 ②보다 앞이다. 앞머리 형식이 또 달라져도 괄호만 맞으면 제품명이 나온다 —
     「독감-5 지자체 (…)」도 「65세 이상 어르신(…)」도 같은 길로 간다.
     (2026-10-30: 후자가 규칙 밖이라 구분 문구가 공개 화면에 그대로 나갔다)
   ★ 괄호로 **끝날 때만** 벗긴다. 「(가나다) 0.5ml」처럼 뒤에 글자가 남아 있으면
     건드리지 않는다 — 벗기면 용량이 조용히 사라진다.
   ★ 괄호가 없는 이름(지씨플루…·스파이크박스…·코미나티…)은 한 글자도 바뀌지 않는다.
   ⚠ 이것은 **규칙으로 하는 추측**이다. 괄호 안이 제품명이 아니라 성분·부가설명인
     이름이 들어오면 엉뚱하게 잘린다. 형식이 또 달라지면 공개용 제품명 칸(방안 B)을 둘 것. */
export function publicDrugName(raw) {
  const src = String(raw ?? '').trim()
  if (!src) return ''
  /* ① 끝 괄호 안 — 뒤에서부터 짝을 찾는다(안쪽에 괄호가 또 있어도 바깥 짝을 집는다) */
  const inner = lastParenContent(src)
  if (inner) return inner
  /* ② 약제과 앞머리만 떼어 본다 */
  const s = src.replace(/^독감-\d+\s*(?:지자체\s*)?/, '').trim()
  /* ③ 괄호·공백만 남았으면 이름이 아니다 — 원래 값을 쓴다 */
  return s.replace(/[()\s]/g, '') ? s : src
}

/* 「…(제품명)」의 괄호 안. 괄호로 끝나지 않거나 짝이 없으면 빈 글자. */
function lastParenContent(s) {
  if (!s.endsWith(')')) return ''
  let depth = 0
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ')') depth++
    else if (s[i] === '(') {
      depth--
      if (depth === 0) return s.slice(i + 1, -1).trim()
    }
  }
  return ''   /* 여는 괄호가 모자라다 — 손대지 않는다 */
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
    .select('id, season, public_label, drug_code')
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
  /* ★ 약품명·제약사 — 「독감(유료)」 같은 표시명만으로는 어느 제품인지 알 수 없어
     문의가 들어왔다. drugs 에서 **두 열만** 읽는다. 단가·재고 등은 읽지 않는다.
     drugs 에 FK 가 없어 drug_code 문자열로 맞춘다(0089 설계).
     service_role 은 drugs SELECT 권한이 있고 rolbypassrls 라 RLS 도 통과한다(실측).
     ★ 이 조회는 잔량·시각과 서로 독립이므로 같은 Promise.all 에 넣는다 — 왕복이 늘지 않는다.
     ★ 실패해도 잔량 조회는 살린다 — 약품명은 덧붙이는 정보지 본문이 아니다. */
  const codes = [...new Set(list.map(a => (a.drug_code || '').trim()).filter(Boolean))]
  const [balRes, lastRes, drugRes] = await Promise.all([
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
    codes.length
      ? admin.from('drugs').select('drug_code, drug_name, manufacturer').in('drug_code', codes)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (balRes.error) return { ok: false, step: '잔량', message: balRes.error.message }
  if (lastRes.error) return { ok: false, step: '시각', message: lastRes.error.message }

  const balOf = {}
  for (const b of (balRes.data || [])) balOf[b.account_id] = b
  /* 약품 조회만 실패하면 이름 없이 간다 — 잔량 화면은 그대로 떠야 한다 */
  const drugOf = {}
  if (!drugRes.error) for (const d of (drugRes.data || [])) drugOf[d.drug_code] = d

  const items = list.map(a => {
    const b = balOf[a.id] || {}
    const d = drugOf[(a.drug_code || '').trim()] || {}
    const qty = Number(b.balance_qty || 0)
    /* 값이 없으면 빈 문자열 — 화면이 그 줄을 그리지 않는다 */
    return {
      label: String(a.public_label), qty, status: stockStatus(qty, b.received_qty),
      drug_name: publicDrugName(d.drug_name), maker: String(d.manufacturer || ''),
    }
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
