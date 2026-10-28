/* ═══════════════════════════════════════════════════════════════════════════
   4칸 숫자 입력 — 로그인과 수요조사 확인번호가 **같은 것**을 쓴다.

   ★ 2026-10-28 에 로그인 화면(App.jsx Login)의 인라인 구현을 그대로 떼어 왔다.
     스타일·구조·동작은 한 줄도 바꾸지 않았다 — 로그인 화면의 모습은 전과 같다.

   ★ 네 상자는 **장식**이다. 실제 입력은 상자 격자 위에 투명하게 덮인 input 하나뿐이고,
     그래서 상자 아무 곳을 눌러도 바로 입력이 시작된다(포커스 옮기는 코드가 없다).
   ★ 투명한 input 은 자기 포커스 테두리를 보여 줄 수 없다(opacity:0 이 outline 까지 가린다)
     — 그래서 포커스 중에는 다음 빈 칸을 보라 테두리로 짚어 준다.
   ★ 입력 규칙(숫자만·자릿수·붙여넣기)은 lib/pwInput.js 에 있다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react'
import { sanitizePw, boxFill } from './lib/pwInput'

/* focusKey — 값이 바뀌면 입력칸으로 포커스를 가져온다(실패 뒤 재입력 유도).
   입력칸이 이 컴포넌트 안에 있어 호출부가 ref 로 직접 부를 수 없기 때문이다. */
export default function PinBoxes({ id, value, onChange, len = 4, label, autoFocus = false, focusKey = 0 }) {
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)
  useEffect(() => { if (autoFocus || focusKey > 0) ref.current?.focus() }, [autoFocus, focusKey])

  const fill = boxFill(value, len)

  return <div style={{ position: 'relative' }}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${len}, minmax(0, 1fr))`, gap: 10 }}>
      {fill.map((on, i) => <div key={i} style={{
        height: 60, borderRadius: 12,
        /* 입력된 칸은 보라, 빈 칸은 라벤더. 포커스 중이면 다음 칸을 보라로 짚어 준다 */
        border: '2px solid ' + (on || (focused && i === value.length) ? 'var(--v-purple)' : 'var(--v-lav)'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <span style={{
          width: 12, height: 12, borderRadius: '50%', background: 'var(--v-navy)',
        }} /> : null}
      </div>)}
    </div>
    <input
      id={id} ref={ref}
      type="password" inputMode="numeric" autoComplete="off"
      aria-label={label}
      maxLength={len}
      value={value}
      onChange={e => onChange(sanitizePw(e.target.value, len))}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        /* 상자 위에 투명하게 덮는다 — 보이지 않지만 누를 수 있고 입력도 받는다 */
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        opacity: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', font: 'inherit',
      }} />
  </div>
}
