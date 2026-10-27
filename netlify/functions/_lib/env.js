/* ════════════════════════════════════════════════════════════════
   환경변수 형식 검사 — DB 에 닿기 전에 끊는다 (약플로 관리 화면 Function 공용)

   ★ 왜 필요한가 — 2026-10-27 운영 장애: SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 의
     production 값이 **둘 다 한 글자**였다. 기존 검사는 `if (!supaUrl || ...)` 뿐이라
     1자도 「있음」으로 통과해, 뒤의 createClient 가
     "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL." 로 터졌다.
     관리 화면에는 「상태를 불러오지 못했습니다」로만 보여 원인을 찾는 데 오래 걸렸다.
     모양까지 보면 같은 사고가 **분명한 「서버 설정 오류」로 즉시 드러난다**.

   ★ 값은 어디에도 남기지 않는다 — 반환하는 실패 설명에는 **변수 이름과 기대 모양만** 담는다.
     로그에도 그것만 찍는다(호출부가 그대로 console.error 해도 안전하다).

   ★ 쌍둥이 파일 — vaccine-app/netlify/functions/_lib/env.js
     공개 조회 사이트는 **별도 Netlify 사이트**(base = vaccine-app)라 이 파일을 import 할 수 없어
     규칙을 복제한다. 한쪽 규칙을 바꾸면 반대쪽도 같이 바꿀 것.
     저쪽에는 VACCINE_TOKEN_SECRET · VACCINE_TENANT_ID 가 더 있다(이 파일에는 없다).
     두 복사본이 같은 판정을 내는지는 netlify/functions/_lib/env.test.js 가 대조한다.

   ★ 이 디렉터리(`_lib`)는 Function 이 아니다 — 밑줄로 시작하고 `index.js` 도
     디렉터리명과 같은 파일도 두지 않으므로 Netlify 가 엔드포인트로 올리지 않는다.
   ════════════════════════════════════════════════════════════════ */

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
}

/* 이 저장소의 Function 이 쓰는 세 가지 — 호출부가 이 상수를 그대로 넘긴다 */
export const SUPABASE_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']

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
