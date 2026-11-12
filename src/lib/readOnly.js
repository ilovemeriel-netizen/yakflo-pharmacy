/* 읽기 전용(뷰어) 계정 — **화면 쪽 안내**. (2026-11-12 이정화 님 승인)
 *
 * ★ 진짜 자물쇠는 **DB** 다.
 *   0123 이 쓰기 정책이 있는 표 33개에 `trg_viewer_readonly` 를 달았고,
 *   TRUNCATE 권한도 회수했다. 이 파일을 통째로 지워도 **뷰어는 아무것도 못 쓴다.**
 *   이 서버에는 미들웨어가 없다 — 브라우저가 Supabase 에 바로 붙는다.
 *
 * ★ 이 파일이 하는 일은 **헛수고를 줄이는 것**뿐이다.
 *   뷰어가 저장을 누르면 네트워크로 나가기 **전에** 멈추고 같은 말로 알려 준다.
 *   그러지 않으면 DB 가 돌려보내는 `42501` 영문 메시지가 그대로 보인다.
 *
 * ★ 읽기(select)는 절대 막지 않는다. 뷰어는 단가·금액까지 **모두 볼 수 있다.**
 */

/* 지금 사람이 뷰어인가 — App.jsx 가 로그인 뒤 한 번 알려 준다 */
let readOnly = false

export const VIEWER_ROLE = 'viewer'
export const READ_ONLY_MSG = '읽기 전용 계정입니다 — 저장·수정·삭제는 되지 않습니다'

/** 역할을 받아 둔다. `tenant_members.role` 값을 그대로 넘긴다. */
export function setReadOnlyRole(role) {
  readOnly = role === VIEWER_ROLE
}

/** 지금 읽기 전용인가 */
export function isReadOnly() {
  return readOnly
}

/** 읽기 전용일 때 쓰기 호출이 돌려줄 값 — supabase 와 **같은 꼴**이라 화면 코드를 안 고쳐도 된다 */
export function readOnlyError() {
  return {
    data: null,
    error: { message: READ_ONLY_MSG, code: '42501', details: null, hint: null },
    count: null,
    status: 403,
    statusText: 'Forbidden',
  }
}

/* 막을 메서드 — 읽기(select·order·eq·range…)는 건드리지 않는다 */
const BLOCKED = ['insert', 'update', 'upsert', 'delete']

/**
 * supabase 클라이언트를 감싼다. **한 곳**에서 모든 쓰기를 멈춘다.
 * 쓰기 메서드는 await 하면 `{ data:null, error }` 를 주는 객체를 돌려준다
 * (supabase 의 PostgrestBuilder 와 같은 꼴 — `.eq(...)` 를 이어 붙여도 된다).
 */
export function guardWrites(client) {
  const stub = () => {
    let p
    const self = {
      then: (res) => Promise.resolve(readOnlyError()).then(res),
      catch: () => p,
      finally: (f) => { if (f) f(); return p },
    }
    /* ★ `.eq().select()` 처럼 뒤에 무엇이 붙어도 **자기(프록시)** 를 돌려준다.
         평범한 객체를 돌려주면 그다음 `.select()` 에서 터진다. */
    p = new Proxy(self, {
      get: (o, k) => (k in o ? o[k] : () => p),
    })
    return p
  }

  return new Proxy(client, {
    get(target, prop, recv) {
      if (prop === 'from') {
        return (...args) => {
          const q = target.from(...args)
          return new Proxy(q, {
            get(qt, qp, qr) {
              if (readOnly && BLOCKED.includes(qp)) return stub
              const v = Reflect.get(qt, qp, qr)
              return typeof v === 'function' ? v.bind(qt) : v
            },
          })
        }
      }
      if (prop === 'rpc') {
        return (...args) => (readOnly
          ? stub()
          : target.rpc(...args))
      }
      const v = Reflect.get(target, prop, recv)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}
