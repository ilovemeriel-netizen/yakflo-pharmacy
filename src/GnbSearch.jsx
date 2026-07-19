import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

/* ═══ GNB 전역 검색 필(pill) ═══
 * 우측 돋보기 아이콘을 대체하는 좌측 인라인 검색창. GlobalSearch 진입점 교체용.
 * - 검색 쿼리·결과행·선택(open360)·Esc 처리는 GlobalSearch 방식을 그대로 미러링(내부 로직 재작성 아님).
 * - 결과는 포털 드롭다운(필 하단 앵커) + 바깥클릭/Esc/스크롤 재배치.
 * - 반응형: 가용폭 < COLLAPSE_W → 돋보기 아이콘으로 축소, 클릭 시 기존 GlobalSearch 오버레이(openSearch).
 * - 컨텍스트는 props 주입(t·open360·openSearch·atcColor) → App.jsx와 순환 import 회피.
 * - 신규 색상 미도입: 흰 배경 + 기존 팔레트(#804A87 포커스 링, #2E4A62 글자) + 테마 토큰(드롭다운).
 */
const COLLAPSE_W = 250 // 이 폭 미만이면 아이콘 모드(필 최소 240px + 여백 확보 불가)

export default function GnbSearch({ t, open360, openSearch, atcColor }) {
  const rootRef = useRef(null)
  const inpRef = useRef(null)
  const menuRef = useRef(null)
  const [collapsed, setCollapsed] = useState(false)
  const [focus, setFocus] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 360 })

  // 반응형: 슬롯 폭 실측 → 아이콘/필 전환
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const check = () => setCollapsed(el.clientWidth < COLLAPSE_W)
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    window.addEventListener('resize', check)
    return () => { ro?.disconnect(); window.removeEventListener('resize', check) }
  }, [])

  // 검색(디바운스 300ms) — GlobalSearch와 동일 쿼리. 즉시 상태변경은 onChange에서 처리(effect 본문 setState 회피)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 1) return
    let on = true
    const h = setTimeout(async () => {
      const esc = term.replace(/[%,()]/g, ' ')
      const { data, count } = await supabase.from('drugs').select('*', { count: 'exact' }).or('drug_code.ilike.%' + esc + '%,drug_name.ilike.%' + esc + '%,ingredient_kr.ilike.%' + esc + '%,ingredient_en.ilike.%' + esc + '%,manufacturer.ilike.%' + esc + '%').limit(20)
      if (!on) return
      const rows = (data || []).sort((a, b) => { const sa = a.status === '중지' ? 1 : 0, sb = b.status === '중지' ? 1 : 0; return sa - sb || String(a.drug_name || '').localeCompare(String(b.drug_name || '')) })
      setRes(rows); setIdx(0); setTotal(count || rows.length); setLoading(false)
    }, 300)
    return () => { on = false; clearTimeout(h) }
  }, [q])

  function place() {
    const el = inpRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.bottom + 8, left: r.left, width: Math.max(r.width, 320) })
  }
  useEffect(() => {
    if (!open) return
    place()
    function onDoc(e) {
      if ((menuRef.current && menuRef.current.contains(e.target)) || (rootRef.current && rootRef.current.contains(e.target))) return
      setOpen(false)
    }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  function pick(d) { if (!d) return; setOpen(false); setQ(''); setRes([]); if (open360) open360(d) }
  function onKey(e) {
    if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, res.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(res[idx]) }
  }

  const slot = { flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }

  // 축소 모드: 돋보기 아이콘 → 기존 GlobalSearch 오버레이
  if (collapsed) {
    return <div ref={rootRef} style={slot}>
      <button onClick={() => openSearch && openSearch()} title="통합 검색 (Ctrl+K)"
        style={{ marginLeft: 12, width: 34, height: 34, borderRadius: 17, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>🔍</button>
    </div>
  }

  return <div ref={rootRef} style={slot}>
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 420, minWidth: 240, marginLeft: 12, height: 36, borderRadius: 18, background: '#ffffff', border: '1px solid ' + (focus ? '#804A87' : 'rgba(255,255,255,0.55)'), boxShadow: focus ? '0 0 0 3px rgba(128,74,135,0.35)' : '0 1px 4px rgba(0,0,0,0.15)', padding: '0 14px', boxSizing: 'border-box', transition: 'box-shadow .15s, border-color .15s' }}>
      <span style={{ fontSize: 14, opacity: 0.65, flexShrink: 0 }}>🔍</span>
      <input ref={inpRef} value={q} onChange={e => { const v = e.target.value; setQ(v); const has = v.trim().length >= 1; setOpen(has); if (has) setLoading(true); else { setRes([]); setTotal(0); setLoading(false) } }} onKeyDown={onKey}
        onFocus={() => { setFocus(true); if (q.trim()) setOpen(true) }} onBlur={() => setFocus(false)}
        placeholder="약품명, 코드, 성분명 검색"
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#2E4A62' }} />
      {q && <span onClick={() => { setQ(''); setRes([]); setOpen(false) }} title="지우기" style={{ cursor: 'pointer', color: '#A3A39E', fontSize: 14, flexShrink: 0, fontWeight: 700 }}>✕</span>}
    </div>
    {open && createPortal(
      <div ref={menuRef} onMouseDown={e => e.stopPropagation()}
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999, background: t.cardSolid, border: '1px solid ' + t.borderH, borderRadius: 12, boxShadow: '0 12px 40px rgba(46,74,98,0.20)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '60vh' }}>
        <div style={{ overflowY: 'auto' }}>
          {loading && !res.length
            ? <div style={{ padding: 20, textAlign: 'center', color: t.textL, fontSize: 12 }}>검색 중…</div>
            : !res.length
              ? <div style={{ padding: 20, textAlign: 'center', color: t.textL, fontSize: 12 }}>결과 없음</div>
              : res.map((d, i) => <div key={d.drug_code} onClick={() => pick(d)} onMouseEnter={() => setIdx(i)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', background: i === idx ? t.accentL : '', borderBottom: '1px solid ' + t.border }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.drug_name}{d.status === '중지' ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: t.textL, background: t.bg, border: '1px solid ' + t.border, borderRadius: 6, padding: '1px 6px' }}>🗄 아카이브</span> : null}{d.status === '휴면' ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: t.amber, background: t.amberL, borderRadius: 6, padding: '1px 6px' }}>휴면</span> : null}</div>
                  <div style={{ fontSize: 10, color: t.textL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.drug_code} · {d.category || '-'}{d.ingredient_kr ? ' · ' + d.ingredient_kr : ''}</div>
                </div>
                {d.atc_l1 && String(d.atc_l1).trim() ? <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 10, fontWeight: 600, color: atcColor(d.atc_l1), background: atcColor(d.atc_l1) + '1A', border: '1px solid ' + atcColor(d.atc_l1) + '33', borderRadius: 10, padding: '2px 8px' }}>{d.atc_l1}</span> : null}
              </div>)}
        </div>
        {res.length > 0 && total > res.length ? <div style={{ padding: '6px 16px', background: t.amberL, color: t.amber, fontSize: 11, fontWeight: 600, textAlign: 'center' }}>총 {total}건 중 상위 {res.length}건 · 검색어를 더 좁혀보세요</div> : null}
        {res.length > 0 ? <div style={{ padding: '7px 16px', borderTop: '1px solid ' + t.border, fontSize: 10, color: t.textL, display: 'flex', gap: 14 }}><span>↑↓ 이동</span><span>Enter 360°</span><span>Esc 닫기</span></div> : null}
      </div>,
      document.body
    )}
  </div>
}