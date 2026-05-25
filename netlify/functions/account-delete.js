/* ════════════════════════════════════════════════════════════════
   회원 탈퇴 — POST /api/account/delete
   ────────────────────────────────────────────────────────────────
   Headers: Authorization: Bearer <user access_token>
   Body: { confirmText: "탈퇴", password?: "..." }

   1) JWT 검증 (Supabase Auth)
   2) 이메일 가입자: 비밀번호 재확인 필수 / 소셜 가입자: 'confirmText' 검증
   3) admin.deleteUser(userId) → profiles는 CASCADE 자동 삭제
   환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'

const CONFIRM_WORD = '탈퇴'

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
  if (req.method === 'OPTIONS') return new Response('', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, msg: 'POST only' }, 405, cors)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supaAnon = process.env.SUPABASE_ANON_KEY
  if (!supaUrl || !supaSrv || !supaAnon) return json({ ok: false, msg: '서버 환경변수 누락' }, 500, cors)

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json({ ok: false, msg: '인증 헤더 누락' }, 401, cors)

  /* 본문 파싱 */
  let body = {}
  try { body = await req.json() } catch { return json({ ok: false, msg: '잘못된 요청 본문' }, 400, cors) }
  if (body.confirmText !== CONFIRM_WORD) {
    return json({ ok: false, msg: `확인 문구가 일치하지 않습니다 ("${CONFIRM_WORD}" 입력 필요)` }, 400, cors)
  }

  /* 1) JWT 검증 — anon 키 클라이언트로 getUser 호출 */
  const userClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ ok: false, msg: '인증 실패 (만료된 세션)' }, 401, cors)
  const user = userData.user

  /* 2) 이메일 가입자는 비밀번호 재확인 필수 */
  const isEmailUser = (user.app_metadata?.provider || 'email') === 'email'
  if (isEmailUser) {
    if (!body.password) return json({ ok: false, msg: '비밀번호를 입력해 주세요' }, 400, cors)
    const { error: pwErr } = await userClient.auth.signInWithPassword({ email: user.email, password: body.password })
    if (pwErr) return json({ ok: false, msg: '비밀번호가 일치하지 않습니다' }, 401, cors)
  }

  /* 3) 본인 계정 삭제 — admin 권한 (service_role) */
  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
  if (delErr) return json({ ok: false, msg: '삭제 실패: ' + delErr.message }, 500, cors)

  return json({ ok: true, msg: '탈퇴가 완료되었습니다' }, 200, cors)
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/account/delete' }
