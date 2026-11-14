/* 읽기 전용(viewer) 계정에게 **보여 주되 못 누르게** 하는 한 곳.
 * (2026-11-14 이정화 님 업무 규칙 변경 · 승인)
 *
 * 왜 한 곳에 모으나
 *   숨겨져 있던 단추가 스무 곳이 넘는다. 자리마다 흐림값·커서·안내 글을 따로 적으면
 *   **모양이 조금씩 달라지고**, 나중에 고칠 때 한 곳을 빠뜨린다.
 *   여기 한 곳만 보면 「읽기 전용일 때 어떻게 보이는가」가 전부 적혀 있다.
 *
 * 쓰는 법
 *   전: {canDel && <button …>삭제</button>}
 *   후: {(canDel || _ro) && <RO on={_ro}><button …>삭제</button></RO>}
 *
 *   · 관리자면 `on` 이 거짓이라 **아무것도 안 바뀐다**(같은 원소를 그대로 돌려준다).
 *   · 일반(member)은 `canDel` 도 `_ro` 도 거짓이라 **전과 같이 안 보인다**.
 *   · 뷰어일 때만 흐림 + 못 누름이 된다.
 *
 * ★ 이것은 **안내**일 뿐이다. 진짜 자물쇠는 DB 다 —
 *   `trg_viewer_readonly` 가 쓰기 정책이 있는 표 33개에 걸려 있고,
 *   `lib/readOnly.js` 가 쓰기 호출을 네트워크로 나가기 전에 멈춘다.
 *   이 파일을 통째로 지워도 뷰어는 아무것도 못 쓴다.
 */
import { Children, cloneElement, isValidElement } from 'react'
import { READ_ONLY_MSG } from './readOnly'

/* 뷰어에게 보일 때의 흐림값 — 기존 「못 누르는 단추」와 같은 느낌으로 맞춘다.
   ★ 색을 새로 만들지 않는다. 투명도만 쓴다. */
export const RO_OPACITY = 0.45

/* `disabled` 를 알아듣는 꼴 — 그 밖(div·label·span)에는 붙이면 React 가 경고한다 */
const FORM = new Set(['button', 'input', 'select', 'textarea', 'fieldset'])

/**
 * 읽기 전용이면 자식을 **흐리게 + 못 누르게** 바꿔서 돌려준다.
 * 감싸개를 덧대지 않고 **자식 자신의 속성만** 바꾸므로 **자리(레이아웃)가 안 흔들린다.**
 */
export function RO({ on, children }) {
  if (!on) return children
  /* ★ 2026-11-14 고침 — 자식이 **하나가 아닐 때** 그냥 돌려주면 아무것도 안 막힌 채
       조용히 지나간다. 실제로 보고서 화면에서 그렇게 새어 나갔다(괄호식을 통째로 감쌌다).
       이제 여럿이면 **하나씩** 막는다. 원소가 아닌 것(글자·숫자)은 그대로 둔다. */
  if (!isValidElement(children)) {
    return Children.map(children, ch => (isValidElement(ch) ? <RO on={on}>{ch}</RO> : ch))
  }
  const base = children.props.style || {}
  const next = {
    'aria-disabled': true,
    title: READ_ONLY_MSG,
    style: { ...base, opacity: RO_OPACITY, cursor: 'default' },
  }
  if (FORM.has(children.type)) {
    /* 단추·입력칸은 `disabled` 가 가장 확실하다 — 눌리지도, 글쇠로 닿지도 않는다 */
    next.disabled = true
  } else {
    /* div·label 묶음은 속까지 한 번에 막는다 */
    next.style.pointerEvents = 'none'
  }
  return cloneElement(children, next)
}

export default RO
