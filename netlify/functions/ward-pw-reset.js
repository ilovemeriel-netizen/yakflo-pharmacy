/* ════════════════════════════════════════════════════════════════
   병동 신청 — 재조회 비밀번호 재설정 (관리 화면 전용) POST /api/ward/pw-reset
   ────────────────────────────────────────────────────────────────
   Headers: Authorization: Bearer <user access_token>
   Body: { requestId, pw }   pw = 숫자 4자리

   ★ 왜 Function인가 — 해시가 Node crypto.scrypt이고 브라우저에는 scrypt가 없다.
     관리 화면에서 직접 해시하려면 다른 알고리즘(PBKDF2)을 써야 하는데,
     그러면 ward-verify(scrypt)가 검증하지 못한다. **해시 방식을 한 가지로 유지**하기 위해
     서버에서 처리한다. ward-app의 Function은 다른 사이트(다른 오리진)라 호출할 수 없고,
     그쪽은 CORS 헤더를 의도적으로 비워 둔 상태다(같은 사이트 전용).

   1) JWT 검증 (account-delete.js와 같은 패턴 — anon 클라이언트로 getUser)
   2) ★ tenant 확인 — 그 신청이 호출자의 tenant에 속하는지 본다. 남의 tenant는 404로 끊는다.
   3) scrypt 해시 갱신 + pw_fail 0 · pw_locked_until null 초기화

   ★ 응답에 키·스택트레이스·DB 오류 원문을 싣지 않는다.
   ★ 신청 내용(품목·작성자)은 반환하지 않는다 — 재설정 결과만 알린다.
   환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (기존과 동일 · 신규 없음)
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { randomBytes, scrypt as _scrypt } from 'node:crypto'

/* ★ ward-app/netlify/functions/ward-submit.js의 해시 규격과 **동일해야 한다**
   (PW_LEN 4 · salt 16바이트 hex · scrypt keylen 64 · hex 출력).
   두 사이트가 별개 npm 프로젝트라 import할 수 없어 복제한다. 고칠 때는 두 곳을 함께 고칠 것. */
const PW_LEN = 4
const PW_KEYLEN = 64
const PW_MSG = '비밀번호는 숫자 4자리로 입력해 주세요'
const validPw = v => typeof v === 'string' && new RegExp(`^\\d{${PW_LEN}}$`).test(v)
const makeSalt = () => randomBytes(16).toString('hex')
const hashPw = (pw, salt) => new Promise((res, rej) =>
  _scrypt(pw, salt, PW_KEYLEN, (e, dk) => (e ? rej(e) : res(dk.toString('hex')))))

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
  if (!supaUrl || !supaSrv || !supaAnon) return json({ ok: false, msg: '서버 설정 오류' }, 500, cors)

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json({ ok: false, msg: '인증 헤더 누락' }, 401, cors)

  let body = {}
  try { body = await req.json() } catch { return json({ ok: false, msg: '잘못된 요청 본문' }, 400, cors) }

  const requestId = String(body.requestId ?? '').trim()
  const pw = String(body.pw ?? '')
  if (!requestId) return json({ ok: false, msg: '신청을 찾을 수 없습니다' }, 400, cors)
  if (!validPw(pw)) return json({ ok: false, msg: PW_MSG }, 400, cors)

  /* 1) JWT 검증 */
  const userClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ ok: false, msg: '인증 실패 (만료된 세션)' }, 401, cors)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 2) ★ tenant 확인 — 호출자가 속한 tenant의 신청만 손댈 수 있다 */
  const { data: mem, error: mErr } = await admin
    .from('tenant_members').select('tenant_id').eq('user_id', userData.user.id)
  if (mErr) { console.error('[ward-pw-reset] 소속 조회 실패:', mErr.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500, cors) }
  const tenantIds = (mem || []).map(m => m.tenant_id)
  if (!tenantIds.length) return json({ ok: false, msg: '권한이 없습니다' }, 403, cors)

  const { data: rows, error: rErr } = await admin
    .from('ward_requests').select('id, ward').eq('id', requestId).in('tenant_id', tenantIds).limit(1)
  if (rErr) { console.error('[ward-pw-reset] 신청 조회 실패:', rErr.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500, cors) }
  const row = (rows || [])[0]
  if (!row) return json({ ok: false, msg: '신청을 찾을 수 없습니다' }, 404, cors)

  /* 3) 해시 갱신 + 잠금·실패 카운터 초기화 */
  let pw_salt, pw_hash
  try { pw_salt = makeSalt(); pw_hash = await hashPw(pw, pw_salt) }
  catch (e) { console.error('[ward-pw-reset] 해시 실패:', e.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500, cors) }

  const { data: upd, error: uErr } = await admin
    .from('ward_requests')
    .update({ pw_hash, pw_salt, pw_fail: 0, pw_locked_until: null })
    .eq('id', row.id).in('tenant_id', tenantIds)
    .select('id')
  if (uErr) { console.error('[ward-pw-reset] 갱신 실패:', uErr.message); return json({ ok: false, msg: '재설정에 실패했습니다' }, 500, cors) }
  /* RLS·조건에 막히면 오류 없이 0행이 돌아온다 — 행 수로 성공을 판정한다 */
  if (!upd || !upd.length) return json({ ok: false, msg: '재설정에 실패했습니다' }, 500, cors)

  return json({ ok: true, ward: row.ward }, 200, cors)
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export const config = { path: '/api/ward/pw-reset' }
