/* ════════════════════════════════════════════════════════════════
   백신 수요조사 — 공개 API (비회원)
   POST /api/vaccine/survey   Authorization: Bearer <토큰>
     { action: 'info' }                                        → 열린 회차 1건
     { action: 'submit', ... }                                 → 신청
     { action: 'lookup', key, pin }                            → 조회(신청번호 또는 사번)
     { action: 'update', key, pin, ... }                       → 수정
     { action: 'cancel', key, pin }                            → 취소
   ─────────────────────────────────────────────────────────────────
   ★ vaccine-stock 과 같은 방식 — 오늘자 HMAC 토큰 검증 필수 · service_role ·
     모든 조회에 tenant_id 명시 · CORS 헤더 없음 · _lib/env.js 환경변수 검사.

   ★ service_role 은 RLS 를 우회한다 — tenant_id 조건을 **직접** 건다.

   ★ 함수 로그에 성명·사번·확인번호를 남기지 않는다. 응답 id 와 사유 이름만 남긴다.

   ★ 존재 여부를 흘리지 않는다 — 조회·수정·취소 실패는 **항상 같은 문구** 하나로 돌려준다.
     「신청번호 또는 확인번호가 일치하지 않습니다.」

   ★ 반환 필드 최소화 — 다른 사람의 성명·사번은 **어떤 응답에도 싣지 않는다**.
     name_dup 경고는 「있다/없다」 boolean 뿐이다.

   환경변수: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · VACCINE_TOKEN_SECRET · VACCINE_TENANT_ID
   ════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual, createHmac } from 'node:crypto'
import { readToken, json, ENV_NAMES } from './vaccine-verify.js'
import { checkEnv, CONFIG_CODE, CONFIG_MSG } from './_lib/env.js'
import {
  makeReceiptCode, nameKey, doseOf, validateSubmit, validWishDate, validFamily, familyOf,
  rateCheck, pinLockState, pinFailNext, publicView, CODE_RE,
  validDept, claimLockState, claimFailNext,
  CLAIM_MAX_FAIL, CLAIM_IP_MAX_FAIL,
} from './_lib/survey.js'

/* ★ scrypt 규격 **다섯 번째 복제본** — 아래 네 파일과 규격을 함께 바꿔야 한다.
   ★ 한 곳만 고치면 해시가 어긋나 검증이 **조용히 실패**한다(저장은 되는데 조회만 안 된다).
     형제 1: ward-app/netlify/functions/ward-submit.js         (병동 신청 · 저장 시 해시)
     형제 2: netlify/functions/ward-pw-reset.js                (관리 화면 · 병동 비밀번호 재설정)
     형제 3: netlify/functions/vaccine-public-admin.js         (관리 화면 · 공개 비밀번호 설정)
     형제 4: vaccine-app/netlify/functions/vaccine-verify.js   (공개 조회 · 비밀번호 확인)
     검사:   node scripts/check_pw_spec.mjs  — 이 파일이 다섯 번째 대상이다. */
// PW_SPEC:BEGIN ── 이 블록은 반대편 파일과 문자 단위로 동일해야 한다
export const PW_LEN    = 4    // 비밀번호 자릿수(숫자만)
export const PW_SALT_B = 16   // 행별 salt 바이트 수 — hex 32자로 저장
export const PW_KEYLEN = 64   // scrypt 파생키 바이트 수 — hex 128자로 저장
export const PW_MSG    = `비밀번호는 숫자 ${PW_LEN}자리로 입력해 주세요`
// PW_SPEC:END

export const validPin = v => typeof v === 'string' && new RegExp(`^\\d{${PW_LEN}}$`).test(v)
const makeSalt = () => randomBytes(PW_SALT_B).toString('hex')
const hashPin = (pw, salt) => new Promise((res, rej) =>
  _scrypt(pw, salt, PW_KEYLEN, (e, dk) => (e ? rej(e) : res(dk.toString('hex')))))
async function verifyPin(pw, salt, expectHex) {
  const got = await hashPin(pw, salt)
  const a = Buffer.from(got, 'hex'), b = Buffer.from(String(expectHex || ''), 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/* 실패 문구는 하나로 통일한다 — 신청번호가 있는지 없는지를 알려 주지 않는다 */
const NOT_FOUND_MSG = '신청번호 또는 확인번호가 일치하지 않습니다.'
const NO_IP_MSG = '접속 정보를 확인할 수 없습니다. 문의: 약제과(내선 217)'
const PIN_MSG = `확인번호는 숫자 ${PW_LEN}자리로 입력해 주세요`
const EMP_DUP_MSG = '동일한 사번으로 중복 신청할 수 없습니다. 사번과 확인번호로 기존 신청 내역을 조회할 수 있습니다.'
const TEMP_MSG = '일시적인 오류입니다'
const RATE_MSG = '잠시 후 다시 시도해 주세요'
/* ★ 「없음」과 「틀림」을 구별해 주지 않는다 — 남은 횟수만 덧붙인다. */
const CLAIM_BAD_MSG = left => '확인번호가 일치하지 않습니다. 확인번호를 확인한 후 다시 입력해 주시기 바랍니다.'
  + (left > 0 ? ` 남은 시도 횟수: ${left}회` : '')
const CLAIM_LOCK_MSG = mins => `확인번호 입력 오류가 반복되어 약 ${mins}분간 확인이 제한됩니다. `
  + '제한 시간이 지난 후 다시 시도해 주시기 바랍니다. 문의: 약제과(내선 217)'
const DEPT_MSG = '소속을 선택해 주시기 바랍니다.'

/* 신청번호 충돌 재시도 횟수 — 31^6 ≈ 8.9억이라 현실적으로 1회에 끝난다 */
const CODE_TRIES = 8

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, message: 'POST 만 받습니다' }, 405)

  const badEnv = checkEnv(process.env, ENV_NAMES)
  if (badEnv.length) {
    console.error('[vaccine-survey] 환경변수 형식 오류 — ' + badEnv.join(' / '))
    return json({ ok: false, code: CONFIG_CODE, message: CONFIG_MSG }, 500)
  }
  const supaUrl = process.env.SUPABASE_URL
  const supaSrv = process.env.SUPABASE_SERVICE_ROLE_KEY
  const secret = process.env.VACCINE_TOKEN_SECRET
  const tenantId = process.env.VACCINE_TENANT_ID

  /* 1) 토큰 — 공개 조회와 같은 오늘자 토큰. 서명·만료·tenant 를 본다 */
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const read = readToken(secret, token)
  if (!read.ok || read.payload.t !== tenantId) {
    return json({ ok: false, message: '다시 로그인해 주세요' }, 401)
  }

  let body = {}
  try { body = await req.json() } catch { return json({ ok: false, message: '잘못된 요청 본문' }, 400) }
  const action = String(body.action || '')

  const admin = createClient(supaUrl, supaSrv, { auth: { persistSession: false, autoRefreshToken: false } })

  /* 2) v 확인 — 비밀번호를 바꾸면 기존 토큰이 전부 무효가 된다(stock 과 같은 규칙) */
  {
    const { data: sets, error } = await admin
      .from('vaccine_public_settings').select('updated_at').eq('tenant_id', tenantId).limit(1)
    if (error) { console.error('[vaccine-survey] 설정 조회 실패:', error.message); return json({ ok: false, message: TEMP_MSG }, 500) }
    const curV = Date.parse((sets || [])[0]?.updated_at || '') || 0
    if (!curV || read.payload.v !== curV) return json({ ok: false, message: '다시 로그인해 주세요' }, 401)
  }

  /* ── 열린 회차 1건 ── */
  const openSurvey = async () => {
    const { data, error } = await admin
      .from('vaccine_surveys')
      .select('id, title, season, account_id, vax_start, vax_end, close_at, status')
      .eq('tenant_id', tenantId).eq('status', 'open').limit(1)
    if (error) throw new Error('survey:' + error.message)
    return (data || [])[0] || null
  }

  try {
    /* ══════════ info — 탭 표시용 ══════════ */
    if (action === 'info') {
      const s = await openSurvey()
      if (!s) return json({ ok: true, survey: null }, 200)
      return json({ ok: true, survey: await decorate(admin, tenantId, s) }, 200)
    }

    /* ══════════ submit ══════════ */
    if (action === 'submit') {
      const s = await openSurvey()
      const why = validateSubmit(body, s, Date.now())
      if (why) return json({ ok: false, message: why }, 400)
      if (!validPin(String(body.pin ?? ''))) return json({ ok: false, message: PIN_MSG }, 400)

      /* ★ IP 헤더가 없으면 **해시 전에** 끊는다 — 비면 모든 호출의 ip_hash 가 같아져
         한 사람의 제출로 전체가 막힌다(vaccine-verify 와 같은 방침) */
      const rawIp = (req.headers.get('x-nf-client-connection-ip') || '').trim()
      if (!rawIp) return json({ ok: false, code: 'NO_IP', message: NO_IP_MSG }, 400)
      const ih = createHmac('sha256', secret).update(rawIp).digest('hex')

      /* 제출 횟수 제한 — 1시간 30건 */
      const { data: att, error: aErr } = await admin
        .from('vaccine_survey_attempts').select('window_start, submit_count')
        .eq('tenant_id', tenantId).eq('ip_hash', ih).limit(1)
      if (aErr) { console.error('[vaccine-survey] 제출 횟수 조회 실패:', aErr.message); return json({ ok: false, message: TEMP_MSG }, 500) }
      const rc = rateCheck((att || [])[0] || null, Date.now())
      if (!rc.allowed) return json({ ok: false, code: 'RATE', message: RATE_MSG }, 429)

      const name = String(body.name).trim()
      const nk = nameKey(name)
      let bypass = false   /* 입력 제한 중에 들어온 신규 접수인가(0102) */
      const emp = body.emp_no != null && String(body.emp_no).trim() !== '' ? String(body.emp_no).trim() : null

      /* 사번 중복 → 409. 사번 없는 동명이인 → 경고만(결정 2·3) */
      if (emp) {
        /* ★ 취소한 신청은 중복으로 보지 않는다(사용자 확정 2026-10-30).
           DB 쪽 부분 UNIQUE 도 0100 에서 같은 조건으로 바꿨다 — 한쪽만 고치면 어긋난다. */
        const { data: dup, error } = await admin
          .from('vaccine_survey_responses').select('id')
          .eq('tenant_id', tenantId).eq('survey_id', s.id).eq('emp_no', emp)
          .eq('status', 'applied').limit(1)
        if (error) { console.error('[vaccine-survey] 사번 중복 조회 실패:', error.message); return json({ ok: false, message: TEMP_MSG }, 500) }
        if ((dup || []).length) return json({ ok: false, code: 'EMP_DUP', message: EMP_DUP_MSG }, 409)
      } else if (body.confirmDup) {
        /* 「본인의 신청 내역이 아닙니다」 — 소속이 있어야 접수한다(사용자 확정 2026-10-30) */
        if (!validDept(body.dept)) return json({ ok: false, code: 'DEPT', message: DEPT_MSG }, 400)
        /* ★ 확인번호 입력이 제한된 상태에서 들어온 신규 접수는 **막지 않고 표시만** 남긴다.
           막으면 진짜 다른 사람이 신청을 못 한다. 표시가 없으면 우회 시도와
           정상 동명이인이 구별되지 않는다(0102 locked_bypass). */
        const nameHashB = createHmac('sha256', secret).update(s.id + '|' + nk).digest('hex')
        const { data: lockRows } = await admin.from('vaccine_survey_claim_attempts')
          .select('scope, locked_until')
          .eq('tenant_id', tenantId)
          .in('scope', ['ip', 'name'])
          .in('key_hash', [ih, nameHashB])
        bypass = (lockRows || []).some(x => claimLockState(x, Date.now()).locked)
      } else {
        const { data: dup, error } = await admin
          .from('vaccine_survey_responses').select('id')
          .eq('tenant_id', tenantId).eq('survey_id', s.id).eq('name_key', nk)
          .eq('status', 'applied').is('emp_no', null).limit(1)
        if (error) { console.error('[vaccine-survey] 이름 중복 조회 실패:', error.message); return json({ ok: false, message: TEMP_MSG }, 500) }
        if ((dup || []).length) return json({ ok: true, warning: 'name_dup' }, 200)
      }

      const salt = makeSalt()
      const pinHash = await hashPin(String(body.pin), salt)

      /* 신청번호 충돌 재시도 — UNIQUE(survey_id, receipt_code) 위반이면 다시 뽑는다 */
      let saved = null, lastErr = null
      for (let i = 0; i < CODE_TRIES; i++) {
        const code = makeReceiptCode(randomInt)
        const { data, error } = await admin.from('vaccine_survey_responses').insert({
          tenant_id: tenantId,
          survey_id: s.id,
          receipt_code: code,
          emp_no: emp,
          name,
          name_key: nk,
          self_dose: !!body.self_dose,
          family_count: familyOf(body.family_count),
          account_id: s.account_id,
          wish_date: body.wish_date,
          pin_hash: pinHash,
          pin_salt: salt,
          consent_at: new Date().toISOString(),
          /* 동명이인이라고 **스스로 밝힌** 건만 참이다 — 소속 유무로 추정하지 않는다 */
          dept: (!emp && body.confirmDup && validDept(body.dept)) ? body.dept : null,
          dup_declared: !!(!emp && body.confirmDup),
          locked_bypass: bypass,
        }).select('id, receipt_code, wish_date, self_dose, family_count').limit(1)
        if (!error) { saved = (data || [])[0]; break }
        lastErr = error
        if (!/duplicate key|23505/i.test(error.message)) break
        if (/emp_applied_uniq|emp_uniq/.test(error.message)) return json({ ok: false, code: 'EMP_DUP', message: EMP_DUP_MSG }, 409)
      }
      if (!saved) {
        console.error('[vaccine-survey] 저장 실패:', lastErr?.message)
        return json({ ok: false, message: '신청을 저장하지 못했습니다' }, 500)
      }

      /* 제출 횟수 갱신 — 실패해도 신청은 성공시킨다(부가 작업) */
      const { error: uErr } = await admin.from('vaccine_survey_attempts')
        .upsert({ tenant_id: tenantId, ip_hash: ih, ...rc.next }, { onConflict: 'tenant_id,ip_hash' })
      if (uErr) console.error('[vaccine-survey] 제출 횟수 갱신 실패:', uErr.message)

      /* 오래된 확인번호 시도 기록 청소 — pg_cron 이 없어 여기서 가끔 부른다(1/100).
         실패해도 신청에는 영향이 없다. */
      if (randomInt(100) === 0) {
        const { error: pErr } = await admin.rpc('purge_vaccine_survey_claim_attempts')
        if (pErr) console.error('[vaccine-survey] 시도 기록 청소 실패:', pErr.message)
      }

      console.log('[vaccine-survey] 신청 저장 id=' + saved.id)   /* ★ 성명·사번·확인번호는 남기지 않는다 */
      return json({
        ok: true,
        receipt_code: saved.receipt_code,
        wish_date: saved.wish_date,
        dose: doseOf(saved.self_dose, saved.family_count),
      }, 200)
    }

    /* ══════════ claim — 「본인이 신청한 내역입니다」 ══════════
       이름 + 확인번호로 **내 신청 1건**을 찾아 신청번호만 돌려준다.
       그 뒤 화면은 기존 lookup/update 경로를 그대로 쓴다(새 수정 경로를 만들지 않는다).

       ★ 존재 여부를 흘리지 않는다 — 후보가 없을 때도 해시 비용을 치르고,
         「없음」과 「틀림」에 **같은 문구·같은 상태코드**를 돌려준다.
       ★ 잠금은 두 축이다: 같은 이름 기준 ${CLAIM_MAX_FAIL}회, IP 기준 ${CLAIM_IP_MAX_FAIL}회.
         이름만 세면 한 사람이 이름을 바꿔 가며 찔러 볼 수 있다. */
    if (action === 'claim') {
      const s = await openSurvey()
      if (!s) return json({ ok: false, message: '진행 중인 수요조사가 없습니다' }, 400)
      const nm = String(body.name ?? '').trim()
      const pin = String(body.pin ?? '')
      if (!nm) return json({ ok: false, message: '이름을 입력해 주세요' }, 400)
      if (!validPin(pin)) return json({ ok: false, message: PIN_MSG }, 400)

      const rawIp = (req.headers.get('x-nf-client-connection-ip') || '').trim()
      if (!rawIp) return json({ ok: false, code: 'NO_IP', message: NO_IP_MSG }, 400)
      const ipKey = createHmac('sha256', secret).update(rawIp).digest('hex')
      const nk = nameKey(nm)
      const nameHash = createHmac('sha256', secret).update(s.id + '|' + nk).digest('hex')

      const getAtt = async (scope, keyHash) => {
        const { data } = await admin.from('vaccine_survey_claim_attempts')
          .select('window_start, fail_count, locked_until')
          .eq('tenant_id', tenantId).eq('scope', scope).eq('key_hash', keyHash).limit(1)
        return (data || [])[0] || null
      }
      const putAtt = async (scope, keyHash, next) => {
        const { error } = await admin.from('vaccine_survey_claim_attempts')
          .upsert({ tenant_id: tenantId, scope, key_hash: keyHash, ...next },
            { onConflict: 'tenant_id,scope,key_hash' })
        if (error) console.error('[vaccine-survey] claim 시도 기록 실패:', error.message)
      }

      const now = Date.now()
      const ipRow = await getAtt('ip', ipKey)
      const nameRow = await getAtt('name', nameHash)
      const ipLock = claimLockState(ipRow, now)
      const nameLock = claimLockState(nameRow, now)
      if (ipLock.locked || nameLock.locked) {
        const mins = Math.max(ipLock.mins, nameLock.mins)
        return json({ ok: false, code: 'LOCKED', message: CLAIM_LOCK_MSG(mins) }, 429)
      }

      /* 후보 — 같은 이름·사번 없음·신청 중인 건만 */
      const { data: cand, error: cErr } = await admin
        .from('vaccine_survey_responses')
        .select('id, receipt_code, pin_hash, pin_salt')
        .eq('tenant_id', tenantId).eq('survey_id', s.id)
        .eq('name_key', nk).eq('status', 'applied').is('emp_no', null)
      if (cErr) { console.error('[vaccine-survey] claim 후보 조회 실패:', cErr.message); return json({ ok: false, message: TEMP_MSG }, 500) }

      let hit = null
      for (const row of (cand || [])) {
        if (!row.pin_hash || !row.pin_salt) continue
        try { if (await verifyPin(pin, row.pin_salt, row.pin_hash)) { hit = row; break } }
        catch (e) { console.error('[vaccine-survey] claim 해시 검증 실패:', e.message) }
      }
      /* ★ 후보가 하나도 없어도 해시 비용을 치른다 — 응답 시간으로 존재 여부가 새지 않게 */
      if (!(cand || []).length) { try { await hashPin(pin, makeSalt()) } catch { /* 타이밍 보정용 */ } }

      if (!hit) {
        const nf = claimFailNext(nameRow, now, CLAIM_MAX_FAIL)
        const ipf = claimFailNext(ipRow, now, CLAIM_IP_MAX_FAIL)
        await putAtt('name', nameHash, nf.next)
        await putAtt('ip', ipKey, ipf.next)
        if (nf.locked || ipf.locked) {
          return json({ ok: false, code: 'LOCKED', message: CLAIM_LOCK_MSG(Math.max(nf.mins, ipf.mins)) }, 429)
        }
        return json({ ok: false, code: 'CLAIM_BAD', left: nf.left, message: CLAIM_BAD_MSG(nf.left) }, 401)
      }

      /* 성공 — 두 축의 실패 기록을 지운다 */
      await putAtt('name', nameHash, { window_start: new Date(now).toISOString(), fail_count: 0, locked_until: null, last_seen: new Date(now).toISOString() })
      await putAtt('ip', ipKey, { window_start: new Date(now).toISOString(), fail_count: 0, locked_until: null, last_seen: new Date(now).toISOString() })
      console.log('[vaccine-survey] claim 성공 id=' + hit.id)   /* ★ 성명·확인번호는 남기지 않는다 */
      return json({ ok: true, receipt_code: hit.receipt_code }, 200)
    }

    /* ══════════ lookup · update · cancel — 전부 「key + pin」 ══════════ */
    if (action === 'lookup' || action === 'update' || action === 'cancel') {
      const key = String(body.key ?? '').trim()
      const pin = String(body.pin ?? '')
      if (!key || !validPin(pin)) return json({ ok: false, message: NOT_FOUND_MSG }, 401)

      const s = await openSurvey()
      if (!s) return json({ ok: false, message: '진행 중인 수요조사가 없습니다' }, 400)

      /* 신청번호 모양이면 신청번호로, 아니면 사번으로 찾는다(결정 2) */
      const byCode = CODE_RE.test(key.toUpperCase())
      let qb = admin.from('vaccine_survey_responses')
        .select('id, receipt_code, emp_no, name, self_dose, family_count, wish_date, status, pin_hash, pin_salt, pin_fail, pin_locked_until')
        .eq('tenant_id', tenantId).eq('survey_id', s.id)
      qb = byCode ? qb.eq('receipt_code', key.toUpperCase()) : qb.eq('emp_no', key)
      const { data: found, error: fErr } = await qb.limit(1)
      if (fErr) { console.error('[vaccine-survey] 조회 실패:', fErr.message); return json({ ok: false, message: TEMP_MSG }, 500) }
      const row = (found || [])[0] || null

      /* ★ 없을 때도 해시 비용을 치른다 — 응답 시간으로 존재 여부가 새지 않게 */
      if (!row || !row.pin_hash || !row.pin_salt) {
        try { await hashPin(pin, makeSalt()) } catch { /* 타이밍 보정용 */ }
        return json({ ok: false, message: NOT_FOUND_MSG }, 401)
      }

      const lock = pinLockState(row, Date.now())
      if (lock.locked) return json({ ok: false, code: 'LOCKED', message: `잠시 후 다시 시도해 주세요 (약 ${lock.mins}분)` }, 429)

      let okPin = false
      try { okPin = await verifyPin(pin, row.pin_salt, row.pin_hash) }
      catch (e) { console.error('[vaccine-survey] 해시 검증 실패:', e.message); return json({ ok: false, message: TEMP_MSG }, 500) }

      if (!okPin) {
        const f = pinFailNext(row, Date.now())
        const { error } = await admin.from('vaccine_survey_responses').update(f.patch).eq('id', row.id)
        if (error) console.error('[vaccine-survey] 실패 카운트 갱신 실패:', error.message)
        if (f.locked) return json({ ok: false, code: 'LOCKED', message: '잠시 후 다시 시도해 주세요 (약 10분)' }, 429)
        return json({ ok: false, message: NOT_FOUND_MSG }, 401)
      }

      /* 성공 — 실패 카운터를 되돌린다 */
      if (row.pin_fail > 0 || row.pin_locked_until) {
        await admin.from('vaccine_survey_responses')
          .update({ pin_fail: 0, pin_locked_until: null, updated_at: new Date().toISOString() })
          .eq('id', row.id)
      }

      if (action === 'lookup') {
        return json({ ok: true, survey: await decorate(admin, tenantId, s), response: publicView(row) }, 200)
      }

      if (action === 'cancel') {
        const { error } = await admin.from('vaccine_survey_responses')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', row.id)
        if (error) { console.error('[vaccine-survey] 취소 실패:', error.message); return json({ ok: false, message: '취소하지 못했습니다' }, 500) }
        console.log('[vaccine-survey] 취소 id=' + row.id)
        return json({ ok: true, response: publicView({ ...row, status: 'cancelled' }) }, 200)
      }

      /* update — 취소된 신청도 여기서 「다시 신청」으로 되살린다(결정: 취소 후 재신청 가능) */
      if (s.close_at && Date.parse(s.close_at) <= Date.now()) {
        return json({ ok: false, message: '수요조사가 마감되었습니다' }, 400)
      }
      const fam = familyOf(body.family_count)
      if (!validFamily(fam)) return json({ ok: false, message: '가족 수는 0~20명 사이로 입력해 주세요' }, 400)
      if (doseOf(!!body.self_dose, fam) < 1) return json({ ok: false, message: '본인 접종 또는 가족을 1명 이상 선택해 주세요' }, 400)
      if (!validWishDate(body.wish_date, s.vax_start, s.vax_end, Date.now())) {
        return json({ ok: false, message: '접종 희망일을 접종 기간 안에서 골라 주세요' }, 400)
      }
      const patch = {
        self_dose: !!body.self_dose,
        family_count: fam,
        wish_date: body.wish_date,
        status: 'applied',
        updated_at: new Date().toISOString(),
      }
      /* 가족 수를 줄이면 명단 체크값이 CHECK(done_family <= family_count)에 걸린다 — 함께 맞춘다 */
      const { error } = await admin.from('vaccine_survey_responses')
        .update({ ...patch, done_family: 0, done_self: false }).eq('id', row.id)
      if (error) { console.error('[vaccine-survey] 수정 실패:', error.message); return json({ ok: false, message: '수정하지 못했습니다' }, 500) }
      console.log('[vaccine-survey] 수정 id=' + row.id)
      return json({ ok: true, response: publicView({ ...row, ...patch }) }, 200)
    }

    return json({ ok: false, message: '알 수 없는 요청입니다' }, 400)
  } catch (e) {
    console.error('[vaccine-survey] 처리 실패:', e.message)
    return json({ ok: false, message: TEMP_MSG }, 500)
  }
}

/* 회차에 표시명(public_label)을 붙인다 — 공개 화면의 「백신 종류」가 이 값이다 */
async function decorate(admin, tenantId, s) {
  const { data, error } = await admin
    .from('vaccine_accounts').select('public_label')
    .eq('tenant_id', tenantId).eq('id', s.account_id).limit(1)
  if (error) throw new Error('account:' + error.message)
  return {
    title: s.title,
    season: s.season,
    public_label: (data || [])[0]?.public_label || null,
    vax_start: s.vax_start,
    vax_end: s.vax_end,
    close_at: s.close_at,
  }
}

export const config = { path: '/api/vaccine/survey' }
