/* ════════════════════════════════════════════════════════════════
   백신 잔량 공개 조회 — 비밀번호 확인 (비회원 API)
   POST /api/vaccine/verify  { pw }
     → { ok:true, token, initial? }   initial 은 stock 과 같은 { season, updated_at, items }
   ─────────────────────────────────────────────────────────────────
   ★ service_role 은 RLS 를 우회한다 — 모든 조회에 tenant_id 조건을 **직접** 건다.
     VACCINE_TENANT_ID 를 쓰고, 환경변수 값은 코드에 적지 않는다.

   ★ IP 원문을 저장하지도 로그하지도 않는다. HMAC-SHA256 으로 ip_hash 만 만든다.
     같은 IP 라도 VACCINE_TOKEN_SECRET 을 바꾸면 해시가 달라진다(의도된 성질).

   ★ 타이밍 균일화 — 설정 행이 없거나 pw_hash 가 null 이어도 **더미 해시를 한 번 돌린다**.
     그러지 않으면 「아직 설정 안 됨」이 눈에 띄게 빨리 돌아와 상태가 샌다(ward-verify 와 같은 방침).

   ★ 레이트 리미팅 — 연속 PW_MAX_FAIL(20)회 실패 시 PW_LOCK_MIN(10)분 잠금.
     비회원이라 세션이 없고 Function 인스턴스가 요청마다 갈려 메모리 카운터를 쓸 수 없어
     vaccine_public_attempts 행에 상태를 둔다(0091).

   ★ 응답에 키·스택트레이스·DB 오류 원문을 싣지 않는다(서버 콘솔에만 기록).
   ★ CORS 헤더를 내리지 않는다 — ward-drugs.js corsHeaders() 와 같은 방침.
     이 Function 은 공개 화면과 **같은 사이트**라 동일 출처이고, 헤더를 주지 않음으로써
     다른 도메인에서의 브라우저 호출은 기본 차단된다(가장 좁은 노출면).

   환경변수: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · VACCINE_TOKEN_SECRET · VACCINE_TENANT_ID
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHmac } from 'node:crypto'
import { loadStock } from './_lib/stock.js'

/* ★ scrypt 규격 **네 번째 복제본** — 아래 세 파일과 규격을 함께 바꿔야 한다.
   ★ 한 곳만 고치면 해시가 어긋나 검증이 **조용히 실패**한다(저장은 되는데 조회만 안 된다).
     형제 1: ward-app/netlify/functions/ward-submit.js         (병동 신청 · 저장 시 해시)
     형제 2: netlify/functions/ward-pw-reset.js                (관리 화면 · 병동 비밀번호 재설정)
     형제 3: netlify/functions/vaccine-public-admin.js         (관리 화면 · 공개 비밀번호 설정)
     검사:   node scripts/check_pw_spec.mjs  — ★ 이 검사는 형제 1·2 만 비교한다(이 파일은 대상 밖). */
// PW_SPEC:BEGIN ── 이 블록은 반대편 파일과 문자 단위로 동일해야 한다
export const PW_LEN    = 4    // 비밀번호 자릿수(숫자만)
export const PW_SALT_B = 16   // 행별 salt 바이트 수 — hex 32자로 저장
export const PW_KEYLEN = 64   // scrypt 파생키 바이트 수 — hex 128자로 저장
export const PW_MSG    = `비밀번호는 숫자 ${PW_LEN}자리로 입력해 주세요`
// PW_SPEC:END
export const validPw = v => typeof v === 'string' && new RegExp(`^\\d{${PW_LEN}}$`).test(v)
export const makeSalt = () => randomBytes(PW_SALT_B).toString('hex')
export const hashPw = (pw, salt) => new Promise((res, rej) =>
  _scrypt(pw, salt, PW_KEYLEN, (e, dk) => (e ? rej(e) : res(dk.toString('hex')))))
export async function verifyPw(pw, salt, expectHex) {
  const got = await hashPw(pw, salt)
  const a = Buffer.from(got, 'hex'), b = Buffer.from(String(expectHex || ''), 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const PW_MAX_FAIL = 20
export const PW_LOCK_MIN = 10
const NOT_SET_MSG = '비밀번호가 아직 설정되지 않았습니다 · 문의 약제과 내선 217'
const FAIL_MSG = '비밀번호가 올바르지 않습니다'
const NO_IP_MSG = '접속 정보를 확인할 수 없습니다 · 문의 약제과 내선 217'
/* 실패 기록 보관 기간 — 잠금이 풀린 지 오래된 행은 남겨 둘 이유가 없다 */
export const ATTEMPT_TTL_H = 24

/* ── KST(+09:00) 기준 날짜 유틸 ───────────────────────────────────────────
   서버 시간대에 기대지 않는다. UTC epoch 에 9시간을 더해 날짜 부분을 읽고,
   되돌릴 때 다시 9시간을 뺀다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000
export function kstParts(now = Date.now()) {
  const d = new Date(now + KST_OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}
/* 오늘(KST) 날짜 — 'YYYY-MM-DD' */
export function kstToday(now = Date.now()) {
  const { y, m, d } = kstParts(now)
  const p = n => String(n).padStart(2, '0')
  return y + '-' + p(m) + '-' + p(d)
}
/* 오늘(KST) 23:59:59 의 epoch 초 — 토큰 만료 */
export function kstEndOfDayEpoch(now = Date.now()) {
  const { y, m, d } = kstParts(now)
  return Math.floor((Date.UTC(y, m - 1, d, 23, 59, 59) - KST_OFFSET_MS) / 1000)
}

/* ── 토큰 ─────────────────────────────────────────────────────────────────
   base64url(JSON {t, exp, v}) + '.' + base64url(HMAC-SHA256(secret, 앞부분))
   v = settings.updated_at 의 epoch 밀리초 — 비밀번호를 바꾸면 기존 토큰이 즉시 무효가 된다. */
const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uDecode = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const sign = (secret, data) => b64u(createHmac('sha256', secret).update(data).digest())

export function makeToken(secret, { t, exp, v }) {
  const head = b64u(JSON.stringify({ t, exp, v }))
  return head + '.' + sign(secret, head)
}
/* 반환: { ok:true, payload } 또는 { ok:false, reason } — 호출부는 reason 을 응답에 싣지 않는다 */
export function readToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'empty' }
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'shape' }
  const head = token.slice(0, dot), tail = token.slice(dot + 1)
  const want = Buffer.from(sign(secret, head))
  const got = Buffer.from(tail)
  if (want.length !== got.length) return { ok: false, reason: 'sig' }
  if (!timingSafeEqual(want, got)) return { ok: false, reason: 'sig' }
  let payload
  try { payload = JSON.parse(b64uDecode(head).toString('utf8')) } catch { return { ok: false, reason: 'json' } }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'json' }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return { ok: false, reason: 'exp' }
  return { ok: true, payload }
}

/* ── ip_hash — IP 원문은 저장하지도 로그하지도 않는다 ── */
export const ipHash = (secret, ip) => createHmac('sha256', secret).update(String(ip || '')).digest('hex')

export function json(obj, status) {
  /* ★ CORS 헤더 없음(같은 사이트 전용) · no-store */
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, message: 'POST 만 받습니다' }, 405)

  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const secret = process.env.VACCINE_TOKEN_SECRET
  const tenantId = process.env.VACCINE_TENANT_ID
  if (!supaUrl || !supaSrv || !secret || !tenantId) return json({ ok: false, message: '서버 설정 오류' }, 500)

  let body = {}
  try { body = await req.json() } catch { return json({ ok: false, message: '잘못된 요청 본문' }, 400) }
  const pw = String(body.pw ?? '')
  if (!validPw(pw)) return json({ ok: false, message: PW_MSG }, 400)

  /* ★ IP 헤더가 없으면 **scrypt 전에** 끊는다.
     헤더가 비면 ip_hash 가 모든 호출에서 같아져 한 사람의 실패로 전체가 잠긴다(공용 잠금 사고).
     해시 비용을 치르기 전에 막아 두드리기 통로로도 쓰이지 않게 한다. */
  const rawIp = (req.headers.get('x-nf-client-connection-ip') || '').trim()
  if (!rawIp) return json({ ok: false, code: 'NO_IP', message: NO_IP_MSG }, 400)

  /* ★ IP 는 해시만 쓴다 — 원문을 변수에 오래 들고 있지 않고 로그에도 남기지 않는다 */
  const ih = ipHash(secret, rawIp)

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 1) 잠금 확인 — 비밀번호를 보기 전에 끊는다 */
  const { data: atts, error: aErr } = await admin
    .from('vaccine_public_attempts')
    .select('fail_count, locked_until')
    .eq('tenant_id', tenantId).eq('ip_hash', ih).limit(1)
  if (aErr) { console.error('[vaccine-verify] 잠금 조회 실패:', aErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }
  const att = (atts || [])[0] || null

  if (att?.locked_until && Date.parse(att.locked_until) > Date.now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(att.locked_until) - Date.now()) / 60000))
    return json({ ok: false, code: 'LOCKED', message: `잠시 후 다시 시도해 주세요 (약 ${mins}분)` }, 429)
  }

  /* 1-b) 묵은 실패 기록 정리 — 잠금이 없거나 이미 풀렸고 24시간 넘게 손대지 않은 행만 지운다.
     ★ tenant_id 조건은 필수다 — service_role 은 RLS 를 우회하므로 빼면 남의 테넌트 행까지 지운다.
     ★ 지금 잠겨 있는 행은 locked_until 조건에 걸려 살아남는다(잠금을 앞당겨 풀지 않는다).
     실패해도 인증을 막지 않는다 — 청소는 부가 작업이라 로그만 남긴다. */
  {
    const nowIso = new Date().toISOString()
    const cutoff = new Date(Date.now() - ATTEMPT_TTL_H * 60 * 60 * 1000).toISOString()
    const { error: cErr } = await admin
      .from('vaccine_public_attempts')
      .delete()
      .eq('tenant_id', tenantId)
      .lt('updated_at', cutoff)
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    if (cErr) console.error('[vaccine-verify] 묵은 실패 기록 정리 실패:', cErr.message)
  }

  /* 2) 설정 조회 */
  const { data: sets, error: sErr } = await admin
    .from('vaccine_public_settings')
    .select('pw_hash, pw_salt, updated_at')
    .eq('tenant_id', tenantId).limit(1)
  if (sErr) { console.error('[vaccine-verify] 설정 조회 실패:', sErr.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }
  const st = (sets || [])[0] || null

  /* 미설정 — 더미 해시로 시간을 맞춘 뒤 안내한다. 실패 카운트는 올리지 않는다(맞출 값이 없다). */
  if (!st || !st.pw_hash || !st.pw_salt) {
    try { await hashPw(pw, makeSalt()) } catch { /* 타이밍 보정용이라 실패해도 무시 */ }
    return json({ ok: false, code: 'NOT_SET', message: NOT_SET_MSG }, 403)
  }

  let okPw = false
  try { okPw = await verifyPw(pw, st.pw_salt, st.pw_hash) }
  catch (e) { console.error('[vaccine-verify] 해시 검증 실패:', e.message); return json({ ok: false, message: '일시적인 오류입니다' }, 500) }

  /* 3) 실패 — 누적하고 임계치에서 잠근다 */
  if (!okPw) {
    const next = Number(att?.fail_count || 0) + 1
    const locked = next >= PW_MAX_FAIL
    const patch = {
      tenant_id: tenantId, ip_hash: ih,
      fail_count: locked ? 0 : next,
      locked_until: locked ? new Date(Date.now() + PW_LOCK_MIN * 60_000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    const { error: uErr } = await admin.from('vaccine_public_attempts').upsert(patch, { onConflict: 'tenant_id,ip_hash' })
    if (uErr) console.error('[vaccine-verify] 실패 카운트 갱신 실패:', uErr.message)
    if (locked) return json({ ok: false, code: 'LOCKED', message: `잠시 후 다시 시도해 주세요 (약 ${PW_LOCK_MIN}분)` }, 429)
    return json({ ok: false, message: FAIL_MSG }, 401)
  }

  /* 4) 성공 — 그 ip_hash 행을 지우고, 첫 데이터까지 함께 읽어 토큰과 같이 보낸다.
     ★ 두 작업은 서로 무관하므로 동시에 보낸다(로그인 체감 시간을 늘리지 않기 위해서다).
     ★ `initial` 은 /api/vaccine/stock 과 **같은 코드**(_lib/stock.js)의 결과다.
       덕분에 화면이 로그인 직후 stock 을 한 번 더 부르지 않아도 되고(왕복 1회 절약),
       판정 기준이 두 곳으로 갈라지지도 않는다.
     ★ 첫 데이터 조회가 실패해도 로그인은 성공시킨다 — initial 을 빼고 보내면
       화면이 예전처럼 stock 을 불러 채운다(기능 손실 없음). */
  const [del, got] = await Promise.all([
    admin.from('vaccine_public_attempts').delete().eq('tenant_id', tenantId).eq('ip_hash', ih),
    loadStock(admin, tenantId, kstToday()).catch(e => ({ ok: false, step: '예외', message: e.message })),
  ])
  if (del.error) console.error('[vaccine-verify] 잠금 행 삭제 실패:', del.error.message)
  if (!got.ok) console.error('[vaccine-verify] 첫 데이터 ' + got.step + ' 조회 실패:', got.message)

  const token = makeToken(secret, {
    t: tenantId,
    exp: kstEndOfDayEpoch(),
    v: Date.parse(st.updated_at) || 0,
  })
  return json(got.ok ? { ok: true, token, initial: got.data } : { ok: true, token }, 200)
}

export const config = { path: '/api/vaccine/verify' }
