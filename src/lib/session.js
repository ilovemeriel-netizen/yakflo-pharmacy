/* 쓰기 전에 로그인을 되살린다 — ★ 만료된 로그인표로 보내 문 앞에서 거절되는 일을 막는다.

   ★ 왜 — 로그인표(access token)는 1시간이면 만료된다. 탭을 오래 열어 두거나 컴퓨터가
     잠들면 갱신 시계가 멈춘다. 돌아와서 **바로** 저장을 누르면 만료된 표가 그대로 나가
     서버가 401 로 거절한다. 이때는 DB 에 요청이 **닿지도 않아** 기록이 전혀 남지 않는다.
     2026-11-05: 마약·향정 「적용」이 이렇게 한 번 사라졌다
     (로그인 19:15 → 표 만료 20:15 → 갱신은 새로고침한 22:32 에야 일어났다).

   ★ 어떻게 — Supabase 로 나가는 **모든 쓰기 요청** 바로 앞에서 남은 시간을 보고,
     1분 미만이면 먼저 표를 갱신한 뒤 **새 표를 머리글에 끼워** 보낸다.
     한 곳에서 하므로 저장·적용·마감 단추를 따로 고치지 않아도 전부 덮인다.

   ★ 건드리지 않는 것
     · 읽기(GET·HEAD)는 그대로 보낸다 — 읽기는 실패해도 값이 사라지지 않고, 느려지면 안 된다.
     · 로그인 자체(`/auth/v1/…`)는 그대로 보낸다 — 갱신 요청이 자기 자신을 다시 부르면 안 된다.
     · 로그인하지 않은 사람(공개 화면)은 그대로 보낸다 — 갱신할 표가 없다. */

/* 남은 시간이 이보다 적으면 미리 갱신한다 */
export const FRESH_MARGIN_SEC = 60

export function isWriteRequest(url, init) {
  const m = String((init && init.method) || 'GET').toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}

export function isAuthPath(url) {
  return /\/auth\/v\d+\//.test(String(url || ''))
}

/* 머리글의 Bearer 표를 새 표로 바꿔 끼운다. Headers 든 보통 객체든 받는다. */
export function withToken(init, token) {
  const next = Object.assign({}, init || {})
  const h = (init && init.headers) || {}
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    const copy = new Headers(h)
    copy.set('Authorization', 'Bearer ' + token)
    next.headers = copy
    return next
  }
  if (Array.isArray(h)) {
    next.headers = h.filter(p => String(p[0]).toLowerCase() !== 'authorization')
      .concat([['Authorization', 'Bearer ' + token]])
    return next
  }
  const copy = {}
  for (const k of Object.keys(h)) { if (k.toLowerCase() !== 'authorization') copy[k] = h[k] }
  copy.Authorization = 'Bearer ' + token
  next.headers = copy
  return next
}

/* 쓰기 요청을 감싸는 fetch 를 만든다. 시험에서 모든 조각을 넣어 줄 수 있게 열어 둔다. */
export function makeGuardedFetch(opts) {
  const o = opts || {}
  const getAuth = o.getAuth || (() => null)
  const baseFetch = o.baseFetch || ((...a) => fetch(...a))
  const marginMs = (o.marginSec == null ? FRESH_MARGIN_SEC : o.marginSec) * 1000
  const now = o.now || (() => Date.now())
  let inflight = null          /* 갱신은 한 번만 — 동시에 여러 번 저장해도 한 번만 갱신한다 */

  async function freshToken() {
    const auth = getAuth()
    if (!auth || typeof auth.getSession !== 'function') return null
    let session = null
    try {
      const r = await auth.getSession()
      session = (r && r.data && r.data.session) || null
    } catch { return null }
    if (!session) return null                       /* 로그인 안 한 사람 — 건드리지 않는다 */
    const leftMs = (Number(session.expires_at) || 0) * 1000 - now()
    if (leftMs > marginMs) return null              /* 아직 넉넉하다 — 그대로 보낸다 */
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => auth.refreshSession())
        .then(r => ((r && r.data && r.data.session && r.data.session.access_token) || null))
        .catch(() => null)
        .then(tok => { inflight = null; return tok })
    }
    return inflight
  }

  return async function guardedFetch(url, init) {
    if (!isWriteRequest(url, init) || isAuthPath(url)) return baseFetch(url, init)
    const token = await freshToken()
    return baseFetch(url, token ? withToken(init, token) : init)
  }
}
