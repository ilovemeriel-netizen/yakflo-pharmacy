import { useState, useEffect, useRef } from 'react'

/* 중앙 정렬(transform translate 오프셋) 모달용 드래그 훅.
   - pos/setPos는 부모가 보유 → 모달을 닫았다 다시 열어도 위치 유지, 새로고침 시 초기화(부모 remount).
   - 헤더에서 mousedown → window의 mousemove/mouseup로 위치 갱신(커서가 모달 밖으로 나가도 끊기지 않음).
   - 헤더가 항상 최소 EDGE(px) 화면 안에 남도록 좌표 클램프. 창 resize 시 밖으로 나간 모달을 안으로 되돌림.
   - 크기/여백/그림자 등 모달 스타일은 변경하지 않음(오프셋 translate만 적용). */
const EDGE = 40 // 헤더가 화면 안에 최소 남을 px

export function useDraggableModal(boxRef, pos, setPos) {
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)

  // 헤더 mousedown: 버튼(✕)에서는 드래그 시작 안 함. 시작 시점의 기준 좌표·너비 캡처.
  function onHeaderMouseDown(e) {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return
    const el = boxRef.current
    const r = el ? el.getBoundingClientRect() : null
    start.current = {
      sx: e.clientX - pos.x, sy: e.clientY - pos.y,
      baseLeft: r ? r.left - pos.x : 0, // pos=0(중앙)일 때의 left
      baseTop: r ? r.top - pos.y : 0,
      w: r ? r.width : 0,
    }
    setDragging(true)
  }

  // 드래그 중: window에 move/up 바인딩 + body user-select 차단.
  useEffect(() => {
    if (!dragging) return
    function onMove(e) {
      const s = start.current
      if (!s) return
      const x = e.clientX - s.sx, y = e.clientY - s.sy
      const minLeft = EDGE - s.w                    // 오른쪽 끝으로 밀어도 헤더 좌측 EDGE는 남음
      const maxLeft = window.innerWidth - EDGE      // 왼쪽 끝으로 밀어도 헤더 우측 EDGE는 남음
      const projLeft = Math.min(Math.max(s.baseLeft + x, minLeft), maxLeft)
      const projTop = Math.min(Math.max(s.baseTop + y, 0), window.innerHeight - EDGE)
      setPos({ x: projLeft - s.baseLeft, y: projTop - s.baseTop })
    }
    function onUp() { setDragging(false) }
    const prevSel = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = prevSel
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, setPos])

  // 창 resize: 현재 위치가 화면 밖이면 안으로 되돌림(측정된 rect 기준 보정치만 가감).
  useEffect(() => {
    function onResize() {
      const el = boxRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      let dx = 0, dy = 0
      if (r.left > window.innerWidth - EDGE) dx = (window.innerWidth - EDGE) - r.left
      else if (r.right < EDGE) dx = EDGE - r.right
      if (r.top > window.innerHeight - EDGE) dy = (window.innerHeight - EDGE) - r.top
      else if (r.top < 0) dy = -r.top
      if (dx || dy) setPos((p) => ({ x: p.x + dx, y: p.y + dy }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [boxRef, setPos])

  return { dragging, onHeaderMouseDown }
}