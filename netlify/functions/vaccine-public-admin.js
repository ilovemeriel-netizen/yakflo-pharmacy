/* ════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 공용 비밀번호 설정 (관리 화면 전용)
   GET  /api/vaccine/public-admin  → { is_set, updated_at, locked_count }
   POST /api/vaccine/public-admin  → { pw, pw2 } → { ok, updated_at }
   ────────────────────────────────────────────────────────────────
   Headers: Authorization: Bearer <user access_token>

   ★ 왜 Function인가 — ward-pw-reset.js 와 같은 이유다. 해시가 Node crypto.scrypt 이고
     브라우저에는 scrypt 가 없다. 관리 화면에서 직접 해시하면 다른 알고리즘을 쓰게 되고,
     나중에 공개 화면 검증 쪽과 어긋난다. **해시 방식을 한 가지로 유지**하기 위해 서버에서 한다.

   ★ vaccine_public_settings · vaccine_public_attempts 는 RLS enable + 정책 0개다(0091).
     즉 service_role 로만 닿는다 — 이 Function 이 유일한 경로다.

   1) JWT 검증 (ward-pw-reset.js · account-delete.js 와 같은 패턴 — anon 클라이언트로 getUser)
   2) ★ 권한 확인 — tenant_members.role 이 owner 또는 admin 이어야 한다. 아니면 403.
   3) GET  = 설정 여부·마지막 변경·잠긴 접속 수만 돌려준다
      POST = scrypt 해시 저장 + 그 tenant 의 실패 잠금 전부 삭제

   ★ 비밀번호 원문·해시·salt 를 로그에도 응답에도 싣지 않는다.
   ★ Cache-Control: no-store — 중간 캐시에 상태가 남지 않게 한다.
   ★ 응답에 키·스택트레이스·DB 오류 원문을 싣지 않는다.
   환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (기존과 동일 · 신규 없음)
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { checkEnv, SUPABASE_ENV } from './_lib/env.js'
import { randomBytes, scrypt as _scrypt } from 'node:crypto'

/* ★ scrypt 규격 **세 번째 복제본** — ward-submit.js · ward-pw-reset.js 와 규격을 함께 바꿔야 한다.
   ★ 한 곳만 고치면 해시가 어긋나 검증이 **조용히 실패**한다(저장은 되는데 조회만 안 된다).
   ★ 아래 PW_SPEC 블록을 고치면 나머지 두 파일의 같은 블록도 **함께** 고쳐야 한다.
     형제 1: ward-app/netlify/functions/ward-submit.js  (신청 앱 · 저장 시 해시)
     형제 2: netlify/functions/ward-pw-reset.js         (관리 화면 · 병동 비밀번호 재설정)
     검사:   node scripts/check_pw_spec.mjs  — ★ 이 검사는 형제 1·2 만 비교한다(이 파일은 대상 밖). */
// PW_SPEC:BEGIN ── 이 블록은 반대편 파일과 문자 단위로 동일해야 한다
export const PW_LEN    = 4    // 비밀번호 자릿수(숫자만)
export const PW_SALT_B = 16   // 행별 salt 바이트 수 — hex 32자로 저장
export const PW_KEYLEN = 64   // scrypt 파생키 바이트 수 — hex 128자로 저장
export const PW_MSG    = `비밀번호는 숫자 ${PW_LEN}자리로 입력해 주세요`
// PW_SPEC:END
export const validPw = v => typeof v === 'string' && new RegExp(`^\\d{${PW_LEN}}$`).test(v)
const makeSalt = () => randomBytes(PW_SALT_B).toString('hex')
const hashPw = (pw, salt) => new Promise((res, rej) =>
  _scrypt(pw, salt, PW_KEYLEN, (e, dk) => (e ? rej(e) : res(dk.toString('hex')))))

/* 권한 어휘 — 관리 화면의 memberRole 판정과 같은 집합 */
const ADMIN_ROLES = ['owner', 'admin']
const MISMATCH_MSG = '두 번 입력한 비밀번호가 다릅니다'

export default async (req) => {
  /* ★ CORS 헤더를 내리지 않는다 — 관리 화면이 **같은 사이트**에서 부르므로 동일 출처이고,
     헤더를 주지 않음으로써 다른 도메인에서의 브라우저 호출은 기본 차단된다(가장 좁은 노출면).
     vaccine-app 의 두 Function 과 같은 방침이다. 동일 출처 요청은 preflight 를 보내지 않으므로
     OPTIONS 처리도 함께 뺐다(오면 아래 메서드 검사에서 405). */
  if (req.method !== 'GET' && req.method !== 'POST') return json({ ok: false, msg: 'GET 또는 POST 만 받습니다' }, 405)

  /* ★ 환경변수 **형식**까지 본다 — 「있음」만 보면 한 글자짜리 값도 통과해
     createClient 에서 터진다(2026-10-27 운영 장애. 이 함수가 바로 그때 깨진 함수다).
     자세한 내용은 _lib/env.js 머리말. 응답 문구는 기존 그대로 두고,
     로그에 어느 변수가 어떤 검사에 걸렸는지만 남긴다. */
  const badEnv = checkEnv(process.env, SUPABASE_ENV)
  if (badEnv.length) {
    console.error('[vaccine-public-admin] 환경변수 형식 오류 — ' + badEnv.join(' / '))
    return json({ ok: false, msg: '서버 설정 오류' }, 500)
  }
  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supaAnon = process.env.SUPABASE_ANON_KEY

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json({ ok: false, msg: '인증 헤더 누락' }, 401)

  /* 1) JWT 검증 */
  const userClient = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ ok: false, msg: '인증 실패 (만료된 세션)' }, 401)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 2) ★ 권한 확인 — owner·admin 만. 그 외는 403 */
  const { data: mem, error: mErr } = await admin
    .from('tenant_members').select('tenant_id, role').eq('user_id', userData.user.id)
  if (mErr) { console.error('[vaccine-public-admin] 소속 조회 실패:', mErr.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500) }
  const allowed = (mem || []).filter(m => ADMIN_ROLES.includes(String(m.role || '')))
  if (!allowed.length) return json({ ok: false, msg: '권한이 없습니다' }, 403)
  /* 소속이 여럿이어도 첫 tenant 하나만 다룬다 — 관리 화면이 단일 tenant 기준으로 동작한다 */
  const tenantId = allowed[0].tenant_id

  /* ── GET — 상태만 ── */
  if (req.method === 'GET') {
    const { data: st, error: sErr } = await admin
      .from('vaccine_public_settings').select('pw_hash, updated_at').eq('tenant_id', tenantId).maybeSingle()
    if (sErr) { console.error('[vaccine-public-admin] 설정 조회 실패:', sErr.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500) }

    const { count, error: lErr } = await admin
      .from('vaccine_public_attempts').select('ip_hash', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).gt('locked_until', new Date().toISOString())
    if (lErr) { console.error('[vaccine-public-admin] 잠금 조회 실패:', lErr.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500) }

    /* ★ pw_hash 자체는 내보내지 않는다 — 설정 여부만 boolean 으로 바꿔 보낸다 */
    return json({
      ok: true,
      is_set: !!(st && st.pw_hash),
      updated_at: st ? st.updated_at : null,
      locked_count: count || 0,
    }, 200)
  }

  /* ── POST — 비밀번호 설정 ── */
  let body = {}
  try { body = await req.json() } catch { return json({ ok: false, msg: '잘못된 요청 본문' }, 400) }

  const pw = String(body.pw ?? '')
  const pw2 = String(body.pw2 ?? '')
  if (!validPw(pw)) return json({ ok: false, msg: PW_MSG }, 400)
  if (pw !== pw2) return json({ ok: false, msg: MISMATCH_MSG }, 400)

  let pw_salt, pw_hash
  try { pw_salt = makeSalt(); pw_hash = await hashPw(pw, pw_salt) }
  catch (e) { console.error('[vaccine-public-admin] 해시 실패:', e.message); return json({ ok: false, msg: '일시적인 오류입니다' }, 500) }

  const updated_at = new Date().toISOString()
  const { data: up, error: uErr } = await admin
    .from('vaccine_public_settings')
    .upsert({ tenant_id: tenantId, pw_hash, pw_salt, updated_at }, { onConflict: 'tenant_id' })
    .select('tenant_id')
  if (uErr) { console.error('[vaccine-public-admin] 저장 실패:', uErr.message); return json({ ok: false, msg: '저장에 실패했습니다' }, 500) }
  /* RLS·조건에 막히면 오류 없이 0행이 돌아온다 — 행 수로 성공을 판정한다(ward-pw-reset 과 같은 규약) */
  if (!up || !up.length) return json({ ok: false, msg: '저장에 실패했습니다' }, 500)

  /* 비밀번호를 바꿨으니 그 tenant 의 실패 잠금을 모두 푼다 */
  const { error: dErr } = await admin.from('vaccine_public_attempts').delete().eq('tenant_id', tenantId)
  if (dErr) { console.error('[vaccine-public-admin] 잠금 해제 실패:', dErr.message); return json({ ok: false, msg: '저장에 실패했습니다' }, 500) }

  return json({ ok: true, updated_at }, 200)
}

/* ★ CORS 헤더 없음(같은 사이트 전용) · no-store */
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export const config = { path: '/api/vaccine/public-admin' }
