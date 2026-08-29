import { useState, useRef } from 'react'

/* ════════════════════════════════════════════════════════════════
   병동 약품 신청 — 단일 화면
   ─────────────────────────────────────────────────────────────────
   ★ Supabase 클라이언트·키를 일절 포함하지 않는다. 데이터 접근은 같은 사이트의
     Netlify Function(/api/ward/*) 상대 경로 호출뿐이며, service_role 키는 서버에만 있다.
   ★ 외부 도메인·브랜드명을 노출하지 않는다.
   ★ 색상은 브랜드 4색만 사용 — 그 외는 white 키워드와 그 4색의 rgba 파생.
   ════════════════════════════════════════════════════════════════ */

const PURPLE = '#804A87'   // 보라
const GREEN = '#019748'    // 녹색
const LAVENDER = '#BFA6D9' // 라벤더
const NAVY = '#2E4A62'     // 네이비

const WARDS = ['3', '4', '5', '6']
const MIN_Q = 2            // 검색 최소 글자수(서버는 1자부터 허용하나 화면에서 2자로 좁힘)

export default function App() {
  const [ward, setWard] = useState('')
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [searching, setSearching] = useState(false)
  const [cart, setCart] = useState([])
  const [msg, setMsg] = useState(null)          // { kind:'err'|'info', text }
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [doneId, setDoneId] = useState(null)
  const [closed, setClosed] = useState(false)   // 접수 기간 밖
  const timer = useRef(null)

  /* ── 약품 검색 (디바운스 300ms) ── */
  function onQuery(v) {
    setQ(v)
    clearTimeout(timer.current)
    if (v.trim().length < MIN_Q) { setFound([]); return }
    timer.current = setTimeout(() => search(v.trim()), 300)
  }
  async function search(term) {
    setSearching(true); setMsg(null)
    try {
      const r = await fetch(`/api/ward/drugs?q=${encodeURIComponent(term)}`)
      const d = await r.json().catch(() => ({}))
      if (r.status === 403) { setClosed(true); setMsg({ kind: 'err', text: d.msg || '접수 기간이 아닙니다' }); setFound([]); return }
      if (!r.ok || !d.ok) { setMsg({ kind: 'err', text: d.msg || '검색에 실패했습니다' }); setFound([]); return }
      setFound(d.items || [])
      if (!(d.items || []).length) setMsg({ kind: 'info', text: '검색 결과가 없습니다' })
      else if (d.capped) setMsg({ kind: 'info', text: '결과가 많습니다. 검색어를 더 입력해 주세요' })
    } catch { setMsg({ kind: 'err', text: '연결에 실패했습니다. 잠시 후 다시 시도해 주세요' }) }
    finally { setSearching(false) }
  }

  /* ── 담기 / 편집 / 삭제 ── */
  function add(d) {
    if (cart.some(c => c.key === (d.drug_code || d.drug_name))) { setMsg({ kind: 'info', text: '이미 담긴 약품입니다' }); return }
    setCart(c => [...c, { key: d.drug_code || d.drug_name, drug_code: d.drug_code || '', drug_name: d.drug_name, qty: '', unit: '', memo: '' }])
    setQ(''); setFound([]); setMsg(null)
  }
  const edit = (i, k, v) => setCart(c => c.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const remove = i => setCart(c => c.filter((_, j) => j !== i))

  /* ── 저장 ── */
  const problem = () => {
    if (!ward) return '병동을 선택해 주세요'
    if (!name.trim()) return '작성자 이름을 입력해 주세요'
    if (name.trim().length > 20) return '작성자 이름은 20자까지 입력할 수 있습니다'
    if (!cart.length) return '신청할 약품을 1개 이상 담아 주세요'
    for (let i = 0; i < cart.length; i++) {
      const n = Number(cart[i].qty)
      if (!cart[i].qty || !Number.isFinite(n) || n <= 0) return `${i + 1}번 「${cart[i].drug_name}」의 수량을 입력해 주세요`
    }
    return null
  }
  function tryOpen() {
    const p = problem()
    if (p) { setMsg({ kind: 'err', text: p }); return }
    setMsg(null); setConfirmOpen(true)
  }
  async function submit() {
    setSaving(true); setMsg(null)
    try {
      const r = await fetch('/api/ward/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ward, requester_name: name.trim(),
          items: cart.map(c => ({ drug_code: c.drug_code || undefined, drug_name: c.drug_name, qty: Number(c.qty), unit: c.unit || undefined, memo: c.memo || undefined })),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 403) { setConfirmOpen(false); setClosed(true); setMsg({ kind: 'err', text: d.msg || '접수 기간이 아닙니다' }); return }
      if (!r.ok || !d.ok) { setConfirmOpen(false); setMsg({ kind: 'err', text: d.msg || '저장에 실패했습니다' }); return }
      setConfirmOpen(false); setDoneId(d.id)
    } catch { setConfirmOpen(false); setMsg({ kind: 'err', text: '연결에 실패했습니다. 잠시 후 다시 시도해 주세요' }) }
    finally { setSaving(false) }
  }

  /* ── 스타일 ── */
  const wrap = { maxWidth: 720, margin: '0 auto', padding: '16px 14px 48px' }
  const card = { background: 'white', border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 14, padding: '16px 16px', marginBottom: 12 }
  const label = { fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 8, display: 'block' }
  const input = { width: '100%', padding: '11px 12px', border: '1px solid ' + rgba(NAVY, 0.2), borderRadius: 10, outline: 'none', background: 'white', color: NAVY }
  const step = n => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 11, fontWeight: 800, marginRight: 8 })

  /* ── 완료 화면 ── */
  if (doneId) return (
    <div style={wrap}>
      <div style={{ ...card, textAlign: 'center', paddingTop: 32, paddingBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: rgba(GREEN, 0.12), color: GREEN, fontSize: 28, lineHeight: '56px', margin: '0 auto 14px' }}>✓</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 6 }}>신청이 접수되었습니다</div>
        <div style={{ fontSize: 13, color: rgba(NAVY, 0.7), marginBottom: 18 }}>{ward}병동 · {name}</div>
        <div style={{ fontSize: 11, color: rgba(NAVY, 0.6), marginBottom: 4 }}>신청 번호</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: PURPLE, wordBreak: 'break-all', padding: '0 8px' }}>{doneId}</div>
        <div style={{ fontSize: 12, color: rgba(NAVY, 0.7), marginTop: 20, lineHeight: 1.6 }}>
          저장된 신청은 수정할 수 없습니다.<br />변경이 필요하면 약제과 담당자에게 연락해 주세요.
        </div>
      </div>
    </div>
  )

  return (
    <div style={wrap}>
      <div style={{ padding: '10px 2px 14px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: PURPLE }}>병동 약품 신청</div>
        <div style={{ fontSize: 12, color: rgba(NAVY, 0.7), marginTop: 4 }}>명절 대비 약품을 신청합니다 · 문의 약제과 내선 217</div>
      </div>

      {msg && (
        <div style={{
          background: msg.kind === 'err' ? rgba(PURPLE, 0.08) : rgba(LAVENDER, 0.22),
          border: '1px solid ' + rgba(msg.kind === 'err' ? PURPLE : LAVENDER, 0.5),
          color: msg.kind === 'err' ? PURPLE : NAVY,
          borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, marginBottom: 12,
        }}>{msg.text}</div>
      )}

      {closed ? null : (
        <>
          {/* 1) 병동 */}
          <div style={card}>
            <label style={label}><span style={step()}>1</span>병동 선택</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {WARDS.map(w => (
                <button key={w} onClick={() => setWard(w)} style={{
                  padding: '13px 0', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 15,
                  border: '1px solid ' + (ward === w ? PURPLE : rgba(NAVY, 0.2)),
                  background: ward === w ? PURPLE : 'white',
                  color: ward === w ? 'white' : NAVY,
                }}>{w}병동</button>
              ))}
            </div>
          </div>

          {/* 2) 작성자 */}
          <div style={card}>
            <label style={label}><span style={step()}>2</span>작성자 이름</label>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="이름을 입력해 주세요" style={input} />
          </div>

          {/* 3) 검색 */}
          <div style={card}>
            <label style={label}><span style={step()}>3</span>약품 검색</label>
            <input value={q} onChange={e => onQuery(e.target.value)} placeholder={`약품명 ${MIN_Q}자 이상 입력`} style={input} />
            {searching && <div style={{ fontSize: 12, color: rgba(NAVY, 0.6), marginTop: 8 }}>찾는 중…</div>}
            {found.length > 0 && (
              <div style={{ marginTop: 10, border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 10, overflow: 'hidden' }}>
                {found.map(d => (
                  <button key={d.drug_code || d.drug_name} onClick={() => add(d)} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 12px', cursor: 'pointer',
                    border: 'none', borderBottom: '1px solid ' + rgba(NAVY, 0.08), background: 'white', color: NAVY, fontSize: 14,
                  }}>
                    <span style={{ fontWeight: 700 }}>{d.drug_name}</span>
                    <span style={{ float: 'right', color: GREEN, fontWeight: 800, fontSize: 13 }}>담기 +</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4) 담은 목록 */}
          <div style={card}>
            <label style={label}><span style={step()}>4</span>신청 목록 {cart.length > 0 && <span style={{ color: PURPLE }}>({cart.length})</span>}</label>
            {!cart.length ? (
              <div style={{ fontSize: 13, color: rgba(NAVY, 0.55), padding: '14px 0', textAlign: 'center' }}>위에서 약품을 검색해 담아 주세요</div>
            ) : cart.map((c, i) => (
              <div key={c.key} style={{ border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: NAVY, lineHeight: 1.4 }}>{c.drug_name}</div>
                  <button onClick={() => remove(i)} style={{ border: 'none', background: 'transparent', color: rgba(NAVY, 0.55), cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>삭제</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: rgba(NAVY, 0.6), marginBottom: 4 }}>수량 *</div>
                    <input value={c.qty} onChange={e => edit(i, 'qty', e.target.value)} inputMode="decimal" placeholder="0" style={input} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: rgba(NAVY, 0.6), marginBottom: 4 }}>단위</div>
                    <input value={c.unit} onChange={e => edit(i, 'unit', e.target.value)} maxLength={20} placeholder="병 · 포 · 개" style={input} />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: rgba(NAVY, 0.6), marginBottom: 4 }}>비고</div>
                  <input value={c.memo} onChange={e => edit(i, 'memo', e.target.value)} maxLength={200} placeholder="선택 입력" style={input} />
                </div>
              </div>
            ))}
          </div>

          {/* 5) 저장 */}
          <button onClick={tryOpen} style={{
            width: '100%', padding: '15px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: PURPLE, color: 'white', fontSize: 16, fontWeight: 800,
          }}>저장</button>
          <div style={{ fontSize: 12, color: rgba(NAVY, 0.65), textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
            저장하면 내용을 수정할 수 없습니다.
          </div>
        </>
      )}

      {/* 확인 모달 */}
      {confirmOpen && (
        <div onClick={() => !saving && setConfirmOpen(false)} style={{
          position: 'fixed', inset: 0, background: rgba(NAVY, 0.45), zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 380, padding: '22px 20px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 12 }}>이대로 저장할까요?</div>
            <div style={{ fontSize: 13, color: rgba(NAVY, 0.8), lineHeight: 1.7, marginBottom: 8 }}>
              저장 후에는 수정할 수 없습니다.<br />
              변경이 필요하면 약제과 담당자에게 연락해 주세요.
            </div>
            <div style={{ fontSize: 12, color: rgba(NAVY, 0.65), background: rgba(LAVENDER, 0.18), borderRadius: 8, padding: '9px 10px', marginBottom: 16 }}>
              {ward}병동 · {name} · 약품 {cart.length}종
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmOpen(false)} disabled={saving} style={{
                flex: 1, padding: 13, borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer',
                border: '1px solid ' + rgba(NAVY, 0.25), background: 'white', color: NAVY, fontSize: 14, fontWeight: 700,
              }}>취소</button>
              <button onClick={submit} disabled={saving} style={{
                flex: 2, padding: 13, borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? rgba(PURPLE, 0.5) : PURPLE, color: 'white', fontSize: 14, fontWeight: 800,
              }}>{saving ? '저장 중…' : '확인하고 저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* 브랜드 4색에서 투명도만 파생 — 신규 색상값을 만들지 않는다 */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
