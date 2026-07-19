import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'

/* ═══ 약품목록 표시 컬럼 선택기 ═══
 * 필터바의 '컬럼' 버튼 → 포털 드롭다운(프리셋 4종 + 그룹별 체크박스).
 * - 클릭으로 열기(hover 아님), 포털 렌더 + menuRef/btnRef 바깥클릭 보정(mousedown 오판 방지).
 * - 신규 색상 미도입: 전달받은 팔레트(t) + 고위험(#D9342B)만 사용.
 * - 상태/저장은 부모(DrugList)가 관리. 이 컴포넌트는 순수 UI(선택값 value·onChange만).
 * - 표시 순서는 부모의 마스터 순서가 결정하므로 value 배열 순서는 무의미(집합 취급).
 * - 하단 공간 부족 시 위로 펼침(flip-up). 아래 공간 충분하면 기존과 동일하게 아래로.
 * - ref로 toggle 노출 → 툴바 프리셋 배지가 같은 드롭다운을 열 수 있음(선택적, 미전달 시 무시).
 */
const ColumnSelector = forwardRef(function ColumnSelector({ t, groups, value, onChange, presets, limit = 12 }, ref) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, up: false })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  function place() {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return }
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 372))
    const menuH = menuRef.current ? menuRef.current.offsetHeight : Math.min(window.innerHeight * 0.7, 420)
    const spaceBelow = window.innerHeight - r.bottom
    const up = spaceBelow < menuH + 12 && r.top > spaceBelow
    if (up) setPos({ up: true, bottom: window.innerHeight - r.top + 6, left })
    else setPos({ up: false, top: r.bottom + 6, left })
  }
  function toggle() { if (!open) place(); setOpen(o => !o) }
  useImperativeHandle(ref, () => ({ toggle }), [toggle])

  useEffect(() => {
    if (!open) return
    place() // 메뉴 마운트 후 실제 높이로 재배치(flip-up 판정 정확화)
    function onDoc(e) {
      if ((btnRef.current && btnRef.current.contains(e.target)) || (menuRef.current && menuRef.current.contains(e.target))) return
      setOpen(false)
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const valueSet = new Set(value)
  function tog(key) {
    const next = valueSet.has(key) ? value.filter(x => x !== key) : [...value, key]
    onChange(next)
  }
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))

  const over = value.length > limit

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button ref={btnRef} onClick={toggle} title="표시할 컬럼 선택"
        style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + t.accent, background: open ? t.accentL : 'transparent', color: t.accent, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
        컬럼
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={() => setOpen(false)} />
          <div ref={menuRef} onClick={e => e.stopPropagation()}
            style={{ position: 'fixed', ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }), left: pos.left, zIndex: 9999, width: 356, maxHeight: '70vh', overflowY: 'auto', background: t.cardSolid, border: '1px solid ' + t.borderH, borderRadius: 12, boxShadow: '0 12px 40px rgba(46,74,98,0.20)', padding: 12, textAlign: 'left' }}>
            {/* 프리셋 */}
            <div style={{ fontSize: 10, color: t.textL, fontWeight: 700, marginBottom: 6 }}>프리셋</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid ' + t.border }}>
              {presets.map(p => {
                const on = sameSet(value, p.keys)
                return (
                  <button key={p.name} onClick={() => onChange([...p.keys])}
                    style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid ' + (on ? t.accent : t.border), background: on ? t.accent : 'transparent', color: on ? '#fff' : t.textM, cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {p.name}
                  </button>
                )
              })}
            </div>
            {/* 그룹별 체크박스 */}
            {groups.map(g => (
              <div key={g.title} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: t.textL, fontWeight: 700, marginBottom: 5 }}>{g.title}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px' }}>
                  {g.items.map(c => {
                    const checked = valueSet.has(c.key)
                    return (
                      <label key={c.key} title={c.key}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', cursor: 'pointer', fontSize: 11.5, color: t.text, borderRadius: 6 }}
                        onMouseEnter={e => e.currentTarget.style.background = t.bg}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <input type="checkbox" checked={checked} onChange={() => tog(c.key)} style={{ accentColor: t.accent, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
            {/* 12열 초과 안내(차단 아님) */}
            {over && (
              <div style={{ marginTop: 4, padding: '7px 10px', borderRadius: 8, background: t.amberL || (t.amber + '1A'), color: t.amber, fontSize: 10.5, fontWeight: 600, lineHeight: 1.5 }}>
                동시 표시 {value.length}열 — {limit}열을 초과했습니다. 가로 스크롤로 모두 표시됩니다.
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
})

export default ColumnSelector