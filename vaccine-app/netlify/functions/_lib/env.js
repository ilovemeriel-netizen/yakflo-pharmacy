/* ════════════════════════════════════════════════════════════════
   환경변수 형식 검사 — DB 에 닿기 전에 끊는다

   ★ 왜 필요한가 — 2026-10-27 운영 장애: SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 의
     production 값이 **둘 다 한 글자**였다. 기존 검사는 `if (!supaUrl || ...)` 뿐이라
     1자도 「있음」으로 통과해, 뒤의 createClient 가
     "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL." 로 터졌다.
     화면에는 「상태를 불러오지 못했습니다」로만 보여 원인을 찾는 데 오래 걸렸다.
     모양까지 보면 같은 사고가 **분명한 「서버 설정 오류」로 즉시 드러난다**.

   ★ 값은 어디에도 남기지 않는다 — 반환하는 실패 설명에는 **변수 이름과 기대 모양만** 담는다.
     로그에도 그것만 찍는다(호출부가 그대로 console.error 해도 안전하다).

   ★ 이 디렉터리(`_lib`)는 Function 이 아니다 — _lib/stock.js 머리말 참고.
   ════════════════════════════════════════════════════════════════ */

/* 화면에 보여 줄 문구 — 원인을 알려 주지 않는다(설정 실수는 이용자가 고칠 수 없다) */
export const CONFIG_CODE = 'SERVER_CONFIG'
export const CONFIG_MSG = '서버 설정 오류입니다 · 문의 약제과 내선 217'

/* UUID — 버전 자리를 묶지 않는다(Supabase 가 v4 를 쓰지만 거기에 기대지 않는다) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* JWT — 점 2개로 나뉜 세 부분이 모두 비어 있지 않아야 한다 */
function isJwt(v) {
  const p = v.split('.')
  return p.length === 3 && p.every(x => x.length > 0)
}

/* 검사표 — why 는 **기대하는 모양**만 적는다. 실제 값은 절대 넣지 않는다. */
export const ENV_SPECS = {
  SUPABASE_URL: {
    why: 'https:// 로 시작하고 호스트가 .supabase.co 로 끝나야 함',
    test: v => {
      if (!/^https:\/\//.test(v)) return false
      let host
      try { host = new URL(v).hostname } catch { return false }
      return host.endsWith('.supabase.co')
    },
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    why: 'JWT(점 2개로 나뉜 세 부분) 또는 sb_secret_ 로 시작하는 키여야 함',
    test: v => isJwt(v) || v.startsWith('sb_secret_'),
  },
  SUPABASE_ANON_KEY: {
    why: 'JWT(점 2개로 나뉜 세 부분) 또는 sb_publishable_ 로 시작하는 키여야 함',
    test: v => isJwt(v) || v.startsWith('sb_publishable_'),
  },
  VACCINE_TOKEN_SECRET: {
    why: '32자 이상이어야 함',
    test: v => v.length >= 32,
  },
  VACCINE_TENANT_ID: {
    why: 'UUID 형식이어야 함',
    test: v => UUID_RE.test(v),
  },
}

/* 검사 실행 — 실패한 항목의 설명 배열을 돌려준다. 전부 통과하면 빈 배열.
   ★ 반환값에 값이 섞이지 않는 것이 이 함수의 계약이다. */
export function checkEnv(env, names) {
  const bad = []
  for (const name of names) {
    const spec = ENV_SPECS[name]
    if (!spec) { bad.push(name + ': 검사표에 없는 변수'); continue }
    const raw = env?.[name]
    if (raw == null || String(raw) === '') { bad.push(name + ': 비어 있음'); continue }
    if (!spec.test(String(raw))) bad.push(name + ': ' + spec.why)
  }
  return bad
}
