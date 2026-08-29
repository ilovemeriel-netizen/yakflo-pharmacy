import { useState, useRef, useEffect } from 'react'

/* ════════════════════════════════════════════════════════════════
   병동 약품 신청 — 단일 화면
   ─────────────────────────────────────────────────────────────────
   ★ Supabase 클라이언트·키를 일절 포함하지 않는다. 데이터 접근은 같은 사이트의
     Netlify Function(/api/ward/*) 상대 경로 호출뿐이며, service_role 키는 서버에만 있다.
   ★ 외부 도메인·브랜드명을 노출하지 않는다.
   ★ 색상은 브랜드 4색 + DONE_BG(관리 화면 「엑셀」 버튼에서 재사용) — 그 외는 white/black 키워드와 rgba 파생.
   ★ 입력은 약품과 수량뿐 — 단위·비고는 약제과가 관리 화면에서 채운다(DB 컬럼은 유지).
   ★ 신청번호(uuid)는 쓰지 않는다 — 병동당 1회라 병동·작성자·명절로 식별된다.
   ★ 병동·작성자를 먼저 입력해야 검색·담기·저장이 열린다(오조작 방지).
   ★ 수량은 **검색 결과 행에서** 입력해 담는다 — 담은 뒤 목록으로 눈이 왕복하지 않게.
   ★ 저장은 useRef로 잠근다 — disabled는 리렌더 이후에나 걸려 더블탭 사이를 막지 못한다.
   ★ 라우터·해시 라우팅을 쓰지 않는다. 완료 시 pushState 1회로 뒤로 가기를 **한 번만** 흡수하고,
     두 번째 뒤로 가기는 막지 않는다. beforeunload는 쓰지 않는다(bfcache 무효화 방지).
   ════════════════════════════════════════════════════════════════ */

const PURPLE = '#804A87'   // 보라 — 강조·경고
const GREEN = '#019748'    // 녹색 — 완료·담기
const LAVENDER = '#BFA6D9' // 라벤더 — 보조 배경·은은한 강조
const NAVY = '#2E4A62'     // 네이비 — 본문
/* 신청완료 병동 표시 — 연녹색 틴트.
   ★ 연녹색 틴트는 관리 화면 재고현황 「엑셀」 버튼과 동일 값 재사용.
     브랜드 녹색 파생. 2026-08-30 이정화 님 지시.
   (본체 themes.light.greenL = '#E6F7EE' · green = '#019748' — 글자·테두리는 GREEN 그대로 쓴다) */
const DONE_BG = '#E6F7EE'

const WARDS = ['3', '4', '5', '6']
const MIN_Q = 2            // 검색 최소 글자수

export default function App() {
  const [ward, setWard] = useState('')
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [qtyMap, setQtyMap] = useState({})      // 검색 결과 행별 수량 입력값
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [cart, setCart] = useState([])
  const [msg, setMsg] = useState(null)          // { kind:'err'|'info', text }
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)        // { ward, name, period, items:[{drug_name, qty}] }
  const [closed, setClosed] = useState(false)   // 접수 기간 밖
  const [backNotice, setBackNotice] = useState(false)   // 뒤로 가기를 한 번 흡수했을 때의 안내
  const [wardConfirm, setWardConfirm] = useState(null)  // 바꾸려는 병동(확인 대기)
  const [dupWards, setDupWards] = useState([])          // 신청완료 병동 — ward-status 조회 또는 409로 채워진다
  const [dupMsg, setDupMsg] = useState('')              // 서버(DUP_MSG)에서 받은 안내 — 409 문구와 글자 단위 동일
  const timer = useRef(null)
  const qRef = useRef(null)                     // 검색 입력 — 담기 후 포커스를 되돌린다
  const firstQtyRef = useRef(null)              // 결과 1건일 때 Enter로 옮겨 갈 수량 칸
  const lastTerm = useRef('')                   // 마지막으로 실제 조회한 검색어(결과가 최신인지 판정)
  const submitting = useRef(false)              // ★ 이중 제출 잠금(리렌더와 무관하게 즉시 걸림)
  const pushed = useRef(false)                  // 완료 이력 push를 1회로 제한

  /* ★ 필수 입력 — 병동과 작성자 이름이 채워지기 전에는 검색·담기·저장을 모두 막는다 */
  const ready = !!ward && !!name.trim()
  /* ★ 신청완료 병동이면 검색·저장을 잠근다. 서버가 409로 막아 주지만 그때까지 헛수고를 하게 된다.
     ※ 목록은 /api/ward/status(병동명만 반환)에서 받고, 409를 받으면 그 병동도 더한다.
     ※ 잠가도 병동 **버튼은 그대로 눌린다** — 고른 뒤 이유를 알려야 하고,
       잘못 고른 경우 다른 병동으로 옮겨 계속 진행할 수 있어야 한다. */
  const locked = dupWards.includes(ward)
  const canEdit = ready && !locked
  const keyOf = d => d.drug_code || d.drug_name

  /* ── 신청완료 병동 조회 ──────────────────────────────────────
     ★ fail-open. 이 조회는 **표시용 편의**일 뿐이고, 진짜 방어선은 ward-submit의 409다.
       실패하면 표시만 생략하고 신청은 그대로 허용한다 — 조회가 죽었다고 신청을 막지 않는다.
     ★ 안내 문구는 서버가 준 msg(=DUP_MSG)를 그대로 쓴다 → 409 문구와 글자 단위로 같아진다. */
  useEffect(() => {
    let on = true
    fetch('/api/ward/status')
      .then(r => r.json())
      .then(d => { if (on && d && d.ok) { setDupWards(Array.isArray(d.wards) ? d.wards.map(String) : []); if (d.msg) setDupMsg(d.msg) } })
      .catch(() => { /* fail-open — 아무것도 하지 않는다 */ })
    return () => { on = false }
  }, [])

  /* ── 완료 시 뒤로 가기 1회 흡수 ──────────────────────────────
     앱은 이력에 항목을 쌓지 않는 상태 기반 단일 화면이라, 완료 화면에서 뒤로 가기를 누르면
     곧바로 앱 바깥(직전 방문 페이지)으로 나간다. 완료 시 같은 URL로 항목을 1개 밀어 넣어
     첫 번째 뒤로 가기를 여기서 받아내고, 화면은 완료 그대로 유지하며 안내만 띄운다.
     두 번째 뒤로 가기는 그대로 흘려보낸다(이탈을 막지 않는다).
     ★ beforeunload를 쓰지 않으므로 bfcache는 살아 있다 — forward 복귀 시 완료 화면이 그대로 돌아온다. */
  useEffect(() => {
    if (!done) return
    if (!pushed.current) { pushed.current = true; window.history.pushState({ wa: 'done' }, '') }
    const onPop = () => setBackNotice(true)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [done])

  /* ── 약품 검색 (디바운스 300ms) ── */
  function onQuery(v) {
    setQ(v)
    clearTimeout(timer.current)
    if (!canEdit) { setFound([]); setSearched(false); return }
    if (v.trim().length < MIN_Q) { setFound([]); setSearched(false); return }
    timer.current = setTimeout(() => search(v.trim()), 300)
  }
  async function search(term) {
    setSearching(true); setMsg(null)
    try {
      const r = await fetch(`/api/ward/drugs?q=${encodeURIComponent(term)}`)
      const d = await r.json().catch(() => ({}))
      if (r.status === 403) { setClosed(true); setMsg({ kind: 'err', text: d.msg || '접수 기간이 아닙니다' }); setFound([]); return }
      if (!r.ok || !d.ok) { setMsg({ kind: 'err', text: d.msg || '검색에 실패했습니다' }); setFound([]); return }
      setFound(d.items || []); setSearched(true); setQtyMap({}); lastTerm.current = term
      if (d.capped) setMsg({ kind: 'info', text: '결과가 많습니다. 검색어를 더 입력해 주세요' })
    } catch { setMsg({ kind: 'err', text: '연결에 실패했습니다. 잠시 후 다시 시도해 주세요' }) }
    finally { setSearching(false) }
  }

  /* ── 검색창 Enter ────────────────────────────────────────────
     ★ 한글 IME 조합 중의 Enter는 **조합 확정**에 쓰인다. 그때 다음 단계로 넘기면
       엉뚱한 약이 담기는 오작동이 된다 → isComposing(구형 브라우저는 keyCode 229)이면 무시하고
       조합이 끝난 뒤의 Enter만 처리한다. 검색 자체(onChange·디바운스)는 건드리지 않는다.
     ★ 결과가 **정확히 1건일 때만** 수량 칸으로 넘어간다 — 여러 건에서 첫 번째를 자동으로 고르면
       무엇이 담겼는지 모른 채 넘어가고, 병동 신청은 되돌릴 수 없다. */
  function onSearchKeyDown(e) {
    if (e.key !== 'Enter') return
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    e.preventDefault()
    const term = q.trim()
    if (term.length < MIN_Q) return
    /* 디바운스가 아직 안 돈 상태(결과가 옛 검색어의 것)면 우선 즉시 조회한다 */
    if (searching || term !== lastTerm.current) { clearTimeout(timer.current); search(term); return }
    if (found.length === 1) { firstQtyRef.current?.focus(); return }
    if (found.length > 1) setMsg({ kind: 'info', text: `검색 결과가 ${found.length}건입니다 — 수량을 넣고 담아 주세요` })
  }
  /* 수량 칸 Enter → 담기 (IME 가드 동일 적용 — 숫자 입력이라도 규칙을 통일한다) */
  function onQtyKeyDown(e, d) {
    if (e.key !== 'Enter') return
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    e.preventDefault()
    addWithQty(d)
  }

  /* ── 병동 전환 ────────────────────────────────────────────────
     ★ 병동을 바꾸면 담긴 목록과 작성자 이름을 **모두** 비운다.
       병동별로 근무자가 다르므로 이름은 병동에 딸린 값이고, 목록이 남으면
       3병동이 담은 약이 4병동 이름으로 저장되는 데이터 오류가 난다.
     · 담긴 약품이 있을 때만 확인을 받는다(잃을 것이 큰 경우).
     · 이름만 있고 목록이 비었으면 모달 없이 전환하고, 이름을 비웠다는 사실만 알린다. */
  function pickWard(w) {
    if (w === ward) return
    if (cart.length) { setWardConfirm(w); return }
    applyWard(w)
  }
  /* ── 제목 클릭 → 처음으로 ──────────────────────────────────────
     ★ 확인 모달은 병동 변경용을 그대로 재사용한다 — wardConfirm에 병동명 대신 HOME 표식을 넣고
       모달 안에서 문구·확인 동작만 갈라 쓴다(새 모달 컴포넌트를 만들지 않는다).
     ※ 완료 화면(done)은 아래에서 먼저 return되어 이 제목 자체가 렌더되지 않으므로,
       저장이 끝난 뒤에는 이 동작이 닿지 않는다. */
  const HOME = '__home'
  function goHome() {
    if (cart.length) { setWardConfirm(HOME); return }
    applyHome()
  }
  function applyHome() {
    setWard(''); setName(''); setCart([]); setQ(''); setFound([]); setSearched(false); setQtyMap({})
    setWardConfirm(null); setMsg(null)
    lastTerm.current = ''
  }
  function applyWard(w) {
    const hadName = !!name.trim()
    setWard(w); setCart([]); setName(''); setQ(''); setFound([]); setSearched(false); setQtyMap({}); setWardConfirm(null)
    lastTerm.current = ''
    setMsg(hadName ? { kind: 'info', text: '병동을 바꿔 작성자 이름을 비웠습니다 — 다시 입력해 주세요' } : null)
  }

  /* ── 담기 / 편집 / 삭제 ── */
  function addWithQty(d) {
    if (!canEdit) { setMsg({ kind: 'err', text: locked ? `${ward}병동 신청완료 — ${dupMsg}` : '병동과 작성자 이름을 먼저 입력해 주세요' }); return }
    const raw = qtyMap[keyOf(d)]
    const n = Number(raw)
    if (!raw || !Number.isFinite(n) || n <= 0) { setMsg({ kind: 'err', text: `「${d.drug_name}」의 수량을 1 이상으로 입력해 주세요` }); return }
    if (cart.some(c => c.key === keyOf(d))) { setMsg({ kind: 'info', text: '이미 담긴 약품입니다' }); return }
    setCart(c => [...c, { key: keyOf(d), drug_code: d.drug_code || '', drug_name: d.drug_name, qty: String(n) }])
    /* 담으면 검색어를 비우고 검색창에 포커스를 되돌린다 — 연속으로 담기 쉽게 */
    setQ(''); setFound([]); setSearched(false); setQtyMap({}); setMsg(null); lastTerm.current = ''
    clearTimeout(timer.current)
    qRef.current?.focus()
  }
  const edit = (i, v) => setCart(c => c.map((x, j) => j === i ? { ...x, qty: v } : x))
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
    /* ★ 이중 제출 잠금 — disabled는 리렌더 이후에나 반영되어 더블탭 사이(수백 ms)를 막지 못한다.
       ref는 클릭 핸들러가 도는 즉시 걸리므로 두 번째 탭은 여기서 곧바로 빠져나간다.
       서버(ward-submit)의 중복 검사(409)는 두 요청이 거의 동시에 오면 둘 다 통과할 수 있고,
       0083 설계상 DB UNIQUE가 없어 최후 방어선이 없다 — 그래서 클라이언트 잠금이 필요하다. */
    if (submitting.current) return
    submitting.current = true
    setSaving(true); setMsg(null)
    /* 완료 화면에 남길 품목 요약 — 저장 성공 후 cart를 참조하지 않도록 미리 굳혀 둔다 */
    const snapshot = cart.map(c => ({ drug_name: c.drug_name, qty: Number(c.qty) }))
    try {
      const r = await fetch('/api/ward/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* unit·memo는 보내지 않는다 — 약제과가 관리 화면에서 채운다(Function이 null 저장) */
        body: JSON.stringify({
          ward, requester_name: name.trim(),
          items: cart.map(c => ({ drug_code: c.drug_code || undefined, drug_name: c.drug_name, qty: Number(c.qty) })),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 403) { setConfirmOpen(false); setClosed(true); setMsg({ kind: 'err', text: d.msg || '접수 기간이 아닙니다' }); return }
      /* ★ 409 = 이 병동은 이미 신청완료. 그 병동을 잠가 더 이상 헛수고하지 않게 한다.
         다른 병동으로 바꾸면 잠금이 풀린다(dupWards에 없는 병동이므로). */
      if (r.status === 409) { setConfirmOpen(false); setDupWards(w => w.includes(ward) ? w : [...w, ward]); if (d.msg) setDupMsg(d.msg); setMsg({ kind: 'err', text: d.msg || '이미 신청이 완료된 병동입니다' }); return }
      if (!r.ok || !d.ok) { setConfirmOpen(false); setMsg({ kind: 'err', text: d.msg || '저장에 실패했습니다' }); return }
      /* d.period = 「2026 추석」 — 접수 기간(window) 스냅샷. 신청번호(uuid)는 응답에 없다. */
      setConfirmOpen(false); setDone({ ward, name: name.trim(), period: d.period || '', items: snapshot })
    } catch { setConfirmOpen(false); setMsg({ kind: 'err', text: '연결에 실패했습니다. 잠시 후 다시 시도해 주세요' }) }
    finally {
      /* ★ 실패 시에도 반드시 풀어 재시도가 가능하게 한다 */
      submitting.current = false
      setSaving(false)
    }
  }

  /* ── 스타일 ── */
  const card = { background: 'white', border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 14, padding: '16px 16px', marginBottom: 12 }
  const label = { fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 8, display: 'block' }
  const tag = { fontSize: 11, fontWeight: 800, color: 'white', background: PURPLE, borderRadius: 8, padding: '5px 9px', whiteSpace: 'nowrap' }
  const input = { width: '100%', padding: '11px 12px', border: '1px solid ' + rgba(NAVY, 0.2), borderRadius: 10, outline: 'none', background: 'white', color: NAVY }
  const qtyBox = { width: 74, padding: '8px 9px', border: '1px solid ' + rgba(NAVY, 0.25), borderRadius: 8, outline: 'none', background: 'white', color: NAVY, fontSize: 14, textAlign: 'right' }
  /* 경고 강조 — 브랜드 보라를 경고색으로 사용(신규 색상값 없음) */
  const warn = { background: rgba(PURPLE, 0.09), border: '2px solid ' + rgba(PURPLE, 0.45), borderRadius: 12, padding: '14px 16px', textAlign: 'center' }

  /* ── 완료 화면 — ★ 카드 형식 · 품목 요약 포함 · 신청번호 없음 ── */
  if (done) return (
    <div className="wa-wrap">
      {/* 뒤로 가기를 한 번 흡수했을 때만 표시 */}
      {backNotice && (
        <div style={{
          background: rgba(LAVENDER, 0.28), border: '1px solid ' + rgba(LAVENDER, 0.7), borderRadius: 12,
          padding: '12px 14px', fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 12, textAlign: 'center', lineHeight: 1.6,
        }}>
          신청이 완료되었습니다. 창을 닫으셔도 됩니다.
        </div>
      )}

      {/* 카드 1 — 신청완료 */}
      <div style={{ ...card, textAlign: 'center', paddingTop: 30, paddingBottom: 26 }}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: rgba(GREEN, 0.12), color: GREEN, fontSize: 28, lineHeight: '56px', margin: '0 auto 14px' }}>✓</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: NAVY, marginBottom: 12 }}>신청완료</div>
        <div style={{
          display: 'inline-block', fontSize: 15, fontWeight: 800, color: PURPLE,
          background: rgba(LAVENDER, 0.22), borderRadius: 10, padding: '9px 16px', lineHeight: 1.6,
        }}>
          {done.ward}병동 · {done.name}{done.period ? ' · ' + done.period : ''} · 총 {done.items.length}개 품목
        </div>
      </div>

      {/* 카드 2 — ★ 신청 품목 요약(「뭘 신청했더라」를 여기서 해소) */}
      <div style={card}>
        <label style={label}>신청한 품목 {done.items.length}건</label>
        <div style={{ border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 10, overflow: 'hidden' }}>
          {done.items.map((it, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', fontSize: 13, color: NAVY,
              borderTop: i === 0 ? 'none' : '1px solid ' + rgba(NAVY, 0.08),
            }}>
              <span style={{ color: rgba(NAVY, 0.5), fontSize: 11, minWidth: 14 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 700, lineHeight: 1.4 }}>{it.drug_name}</span>
              <span style={{ fontWeight: 800, color: PURPLE, whiteSpace: 'nowrap' }}>{it.qty}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 카드 3 — ★ 경고 강조. 두 줄을 한 줄로 합쳤다(구분자 `·` + 「내선 217」 표기 통일) */}
      <div style={{ ...card, ...warn }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: PURPLE, lineHeight: 1.5 }}>
          저장된 신청은 수정할 수 없습니다 · 변경은 약제과 내선 217
        </div>
      </div>

      {/* 카드 4 — ★ 이탈 안내(뒤로 가기를 누를 이유 자체를 줄인다) */}
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, lineHeight: 1.6 }}>
          신청이 끝났습니다. 이 창을 닫으셔도 됩니다.
        </div>
        <div style={{ fontSize: 12, color: rgba(NAVY, 0.7), marginTop: 8, lineHeight: 1.7 }}>
          신청 내용은 약제과에서 확인합니다.<br />병동당 1회만 신청할 수 있습니다.
        </div>
      </div>

      <Ft />
    </div>
  )

  return (
    <div className="wa-wrap">
      <div style={{ padding: '10px 2px 12px' }}>
        {/* ★ 클릭하면 처음 상태로 — cursor만 더한다. 색·크기·굵기는 그대로. */}
        <div onClick={goHome} title="처음으로" style={{ fontSize: 20, fontWeight: 800, color: PURPLE, cursor: 'pointer' }}>병동 약품 신청</div>
        <div style={{ fontSize: 12, color: rgba(NAVY, 0.7), marginTop: 4 }}>명절 대비 약품을 신청합니다</div>
      </div>

      {msg && (
        <div style={{
          background: msg.kind === 'err' ? rgba(PURPLE, 0.08) : rgba(LAVENDER, 0.22),
          border: '1px solid ' + rgba(msg.kind === 'err' ? PURPLE : LAVENDER, 0.5),
          color: msg.kind === 'err' ? PURPLE : NAVY,
          borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, marginBottom: 12, lineHeight: 1.6,
          textAlign: 'center',   /* ★ 안내 배너는 모두 가운데 정렬 — 배너 폭·색은 현행 유지 */
        }}>{msg.text}</div>
      )}

      {/* ★ 신청완료 배너 — 3분기. 배너 스타일(배경·테두리·색·padding)은 그대로 두고 문구만 갈린다.
             (a) 완료 병동을 **선택**한 상태 → 제목 「N병동 신청완료」 + 본문 「변경은 약제과 내선 217」
                 (막힌 상황이므로 여기에만 217을 둔다)
             (b) 완료 병동이 있으나 **미선택** → 「신청완료 · 3병동 5병동」 한 줄. 정보 안내라 217 없음
             (c) 완료 병동 0개 → 렌더하지 않음
             ※ 본문은 서버 상수 DUP_MSG를 쓰지 않는다 — 409 응답은 단독으로 읽히므로
               완료 사실을 포함한 채여야 하고, 여기선 제목이 그 역할을 한다(표시만 분리). */}
      {dupWards.length > 0 && (
        <div style={{
          background: rgba(PURPLE, 0.09), border: '2px solid ' + rgba(PURPLE, 0.45), borderRadius: 12,
          padding: '13px 14px', marginBottom: 12, textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: PURPLE, lineHeight: 1.5 }}>
            {locked ? `${ward}병동 신청완료` : `신청완료 · ${dupWards.map(w => w + '병동').join(' ')}`}
          </div>
          {locked && (
            <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 8, lineHeight: 1.6 }}>
              변경은 약제과 내선 217
            </div>
          )}
        </div>
      )}

      {closed ? null : (
        <>
          {/* ── ★ 상단 한 줄: [병동] 3 4 5 6 | [작성자] ____ ── */}
          <div style={card}>
            <div className="wa-top">
              <div className="wa-top-ward">
                <span style={tag}><span style={{ fontSize: 16, fontWeight: 900, lineHeight: '13px' }}>①</span> 병동</span>
                <div className="wa-grow" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                  {WARDS.map(w => (
                    /* ★ 버튼 안에는 라벨 한 줄만 둔다 — 보조줄을 넣지 않으므로 신청완료 유무로
                          높이가 갈리지 않고 4개가 같은 크기다. 상태는 배지 행 아래 한 줄이 담당한다.
                          크기는 padding:'10px 0' 기반으로 원복(N-1의 height:52·flex 중앙 정렬 철회).
                       ★ 색 우선순위 — **선택이 신청완료보다 우선**. ward === w 이면 신청완료 여부와
                          무관하게 보라 채움(지금 무엇을 보고 있는지가 색으로 남아야 한다).
                          비선택 + 신청완료면 회색 채움, 미신청은 흰 배경 그대로. */
                    <button key={w} onClick={() => pickWard(w)} style={{
                      padding: '10px 0', borderRadius: 9, cursor: 'pointer', fontWeight: 800, fontSize: 14,
                      border: '1px solid ' + (ward === w ? PURPLE : (dupWards.includes(w) ? GREEN : rgba(NAVY, 0.2))),
                      background: ward === w ? PURPLE : (dupWards.includes(w) ? DONE_BG : 'white'),
                      color: ward === w ? 'white' : (dupWards.includes(w) ? GREEN : NAVY),
                    }}>
                      {w}병동{dupWards.includes(w) && (
                        /* ★ 배경 위에서 읽히는 색 — 연녹색 틴트 위는 GREEN, 보라 채움 위는 흰색.
                              lineHeight를 라벨 줄 상자(fontSize 14 · normal ≈ 16.8px) 이하로 묶어
                              15px로 키워도 버튼 높이가 변하지 않게 한다. */
                        <span style={{
                          color: ward === w ? 'white' : GREEN,
                          fontSize: 15, fontWeight: 900, lineHeight: '16px', marginLeft: 3,
                        }}>✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="wa-top-name">
                <span style={tag}><span style={{ fontSize: 16, fontWeight: 900, lineHeight: '13px' }}>②</span> 작성자</span>
                <input className="wa-grow" value={name} onChange={e => setName(e.target.value)} maxLength={20}
                  placeholder="이름을 입력해 주세요" style={{ ...input, padding: '10px 12px' }} />
              </div>
            </div>
            {/* ★ 상단이 작아진 만큼 미입력 안내를 눈에 띄게 남긴다 — 진행 차단은 그대로 */}
            {!ready && !locked && (
              <div style={{
                marginTop: 12, background: rgba(LAVENDER, 0.24), border: '1px solid ' + rgba(LAVENDER, 0.7), borderRadius: 10,
                padding: '11px 12px', fontSize: 14, fontWeight: 800, color: PURPLE, textAlign: 'center', lineHeight: 1.6,
              }}>
                병동과 작성자 이름을 먼저 입력해 주세요
              </div>
            )}
          </div>

          <div className="wa-cols">
            {/* ── 왼쪽: 약품 검색 · 결과에서 수량까지 입력 ── */}
            <div>
              <div style={card}>
                <label style={label}><span style={{ fontSize: 16, fontWeight: 900, lineHeight: '14px', color: PURPLE }}>③</span> 약품 검색</label>
                <input
                  ref={qRef}
                  value={q}
                  onChange={e => onQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  disabled={!canEdit}
                  placeholder={canEdit ? `약품명 ${MIN_Q}자 이상 입력 · Enter` : (locked ? '신청이 완료된 병동입니다' : '위에서 병동·작성자를 먼저 입력해 주세요')}
                  style={{ ...input, background: canEdit ? 'white' : rgba(NAVY, 0.05), color: canEdit ? NAVY : rgba(NAVY, 0.45), cursor: canEdit ? 'text' : 'not-allowed' }}
                />
                {searching && <div style={{ fontSize: 12, color: rgba(NAVY, 0.6), marginTop: 8 }}>찾는 중…</div>}
                {searched && !searching && (
                  <div style={{ marginTop: 12, border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: rgba(LAVENDER, 0.18), fontSize: 11, fontWeight: 700, color: NAVY }}>
                      검색 결과 {found.length}건 · 수량을 넣고 담아 주세요
                    </div>
                    {!found.length
                      ? <div style={{ padding: '16px 12px', fontSize: 12, color: rgba(NAVY, 0.55), textAlign: 'center' }}>검색 결과가 없습니다</div>
                      : <div style={{ maxHeight: 360, overflowY: 'auto' }}>{found.map((d, i) => (
                          <div key={keyOf(d)} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                            borderTop: '1px solid ' + rgba(NAVY, 0.08), background: 'white',
                          }}>
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, color: NAVY, lineHeight: 1.4 }}>{d.drug_name}</span>
                            <input
                              ref={i === 0 ? firstQtyRef : null}
                              value={qtyMap[keyOf(d)] ?? ''}
                              onChange={e => setQtyMap(m => ({ ...m, [keyOf(d)]: e.target.value }))}
                              onKeyDown={e => onQtyKeyDown(e, d)}
                              inputMode="decimal" placeholder="수량" style={qtyBox}
                            />
                            {/* 담기는 이 화면의 반복 동작이라 은은한 녹색 외곽선으로 둔다(최종 동작 아님) */}
                            <button onClick={() => addWithQty(d)} style={{
                              padding: '8px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
                              border: '1px solid ' + GREEN, background: rgba(GREEN, 0.1), color: GREEN, fontSize: 13, fontWeight: 800,
                            }}>담기 +</button>
                          </div>))}</div>}
                  </div>
                )}
              </div>
            </div>

            {/* ── 오른쪽: 신청 목록 (한 줄 압축 · 넓은 화면에서 고정) ── */}
            <div>
              <div className="wa-sticky">
                <div style={card}>
                  <label style={label}>
                    신청 목록
                    {cart.length > 0 && <span style={{
                      marginLeft: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 22, height: 20, padding: '0 7px', borderRadius: 10,
                      background: PURPLE, color: 'white', fontSize: 11, fontWeight: 800,
                    }}>{cart.length}</span>}
                  </label>
                  {!cart.length ? (
                    <div style={{ fontSize: 13, color: rgba(NAVY, 0.55), padding: '20px 0', textAlign: 'center' }}>왼쪽에서 약품을 검색해 담아 주세요</div>
                  ) : (
                    <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 10 }}>
                      {/* ★ 한 줄 압축 — 약품명 · 수량 · 삭제 */}
                      {cart.map((c, i) => (
                        <div key={c.key} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                          borderTop: i === 0 ? 'none' : '1px solid ' + rgba(NAVY, 0.08),
                        }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: NAVY, lineHeight: 1.35 }}>{c.drug_name}</span>
                          <input value={c.qty} onChange={e => edit(i, e.target.value)} inputMode="decimal" placeholder="0"
                            style={{ ...qtyBox, width: 64, padding: '6px 8px', fontSize: 13 }} />
                          <button onClick={() => remove(i)} title="빼기" style={{
                            border: 'none', background: 'transparent', color: rgba(NAVY, 0.5),
                            cursor: 'pointer', fontSize: 15, padding: '2px 4px', lineHeight: 1,
                          }}>✕</button>
                        </div>))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── ★ 저장 — 2단 아래 가운데 ── */}
          <div className="wa-save">
            {/* 안내는 담긴 것이 있을 때만 — 0건에서 「모두 담으셨나요?」는 물음이 성립하지 않는다 */}
            {cart.length > 0 && (
              <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, textAlign: 'center', marginBottom: 8 }}>
                신청 전 목록을 확인해 주세요
              </div>
            )}
            {/* ★ 톤 낮춤 — 여기서는 최종 동작이 아니라 확인 모달로 넘어가는 단계다. */}
            <button onClick={tryOpen} disabled={!cart.length || !canEdit} style={{
              width: '100%', padding: '15px 0', borderRadius: 12,
              cursor: (!cart.length || !canEdit) ? 'not-allowed' : 'pointer',
              border: '1px solid ' + ((!cart.length || !canEdit) ? rgba(NAVY, 0.15) : LAVENDER),
              background: (!cart.length || !canEdit) ? rgba(NAVY, 0.05) : rgba(LAVENDER, 0.14),
              color: (!cart.length || !canEdit) ? rgba(NAVY, 0.45) : PURPLE,
              fontSize: 15, fontWeight: 800,
            }}>{locked ? '신청할 수 없습니다' : (cart.length ? `${cart.length}개 품목 신청하기` : '담은 약품이 없습니다')}</button>
            <div style={{ fontSize: 12, color: rgba(NAVY, 0.65), textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
              저장하면 내용을 수정할 수 없습니다.<br />병동당 1회만 신청할 수 있습니다 · 문의 약제과 내선 217
            </div>
          </div>
        </>
      )}

      {/* ── ★ 병동 변경 확인 — 담긴 약품이 있을 때만 ── */}
      {wardConfirm && (
        <div onClick={() => setWardConfirm(null)} style={{
          position: 'fixed', inset: 0, background: rgba(NAVY, 0.45), zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 380, padding: '22px 20px' }}>
            {/* ★ 병동 변경 확인 모달을 제목 클릭(처음으로)에도 그대로 재사용한다 — 문구만 갈린다 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 12 }}>
              {wardConfirm === HOME ? '처음부터 다시 시작할까요?' : `${wardConfirm}병동으로 바꿀까요?`}
            </div>
            <div style={{ ...warn, marginBottom: 14, padding: '13px 14px' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: PURPLE, lineHeight: 1.6 }}>
                담긴 약품 {cart.length}개가 있습니다.
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 8, lineHeight: 1.6 }}>
                {wardConfirm === HOME
                  ? '처음으로 돌아가면 목록과 작성자 이름이 비워집니다.'
                  : '병동을 바꾸면 목록과 작성자 이름이 비워집니다.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setWardConfirm(null)} style={{
                flex: 1, padding: 13, borderRadius: 10, cursor: 'pointer',
                border: '1px solid ' + rgba(NAVY, 0.25), background: 'white', color: NAVY, fontSize: 14, fontWeight: 700,
              }}>취소</button>
              <button onClick={() => (wardConfirm === HOME ? applyHome() : applyWard(wardConfirm))} style={{
                flex: 2, padding: 13, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: PURPLE, color: 'white', fontSize: 14, fontWeight: 800,
              }}>{wardConfirm === HOME ? '비우고 처음으로' : '바꾸고 비우기'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 확인 모달 — ★ 품목 요약을 보여주고, 더 담을 수 있음을 안내 ── */}
      {confirmOpen && (
        <div onClick={() => !saving && setConfirmOpen(false)} style={{
          position: 'fixed', inset: 0, background: rgba(NAVY, 0.45), zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 420, padding: '22px 20px', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 12 }}>이대로 신청할까요?</div>

            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, background: rgba(LAVENDER, 0.22), borderRadius: 10, padding: '11px 12px', marginBottom: 10, lineHeight: 1.6 }}>
              {ward}병동 · {name.trim()} · 아래 {cart.length}개 품목을 신청합니다
            </div>

            {/* 품목 요약 — 이름과 수량을 그대로 나열 */}
            <div style={{ border: '1px solid ' + rgba(NAVY, 0.12), borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
              {cart.map((c, i) => (
                <div key={c.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', fontSize: 13, color: NAVY,
                  borderTop: i === 0 ? 'none' : '1px solid ' + rgba(NAVY, 0.08),
                }}>
                  <span style={{ color: rgba(NAVY, 0.5), fontSize: 11, minWidth: 14 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 700, lineHeight: 1.4 }}>{c.drug_name}</span>
                  <span style={{ fontWeight: 800, color: PURPLE, whiteSpace: 'nowrap' }}>{c.qty}</span>
                </div>
              ))}
            </div>

            {/* ★ 경고 강조 */}
            <div style={{ ...warn, marginBottom: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: PURPLE, lineHeight: 1.5 }}>저장 후에는 수정할 수 없습니다</div>
            </div>

            <div style={{ fontSize: 12, color: rgba(NAVY, 0.7), textAlign: 'center', marginBottom: 16, lineHeight: 1.6 }}>
              담을 약품이 더 있으면 <b>취소</b>하고 계속 담아 주세요.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmOpen(false)} disabled={saving} style={{
                flex: 1, padding: 13, borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer',
                border: '1px solid ' + rgba(NAVY, 0.25), background: 'white', color: NAVY, fontSize: 14, fontWeight: 700,
              }}>취소</button>
              {/* 최종 동작 — 여기서는 보라 채움으로 강조를 유지한다 */}
              <button onClick={submit} disabled={saving} style={{
                flex: 2, padding: 13, borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? rgba(PURPLE, 0.5) : PURPLE, color: 'white', fontSize: 14, fontWeight: 800,
              }}>{saving ? '저장 중…' : `${cart.length}개 품목 신청하기`}</button>
            </div>
          </div>
        </div>
      )}

      <Ft />
    </div>
  )
}

/* 저작권 — 본체와 동일한 자간 넓은 대문자 형식 */
function Ft() {
  return (
    <div style={{
      textAlign: 'center', padding: '20px 0 12px', fontSize: 11, color: rgba(NAVY, 0.5),
      borderTop: '1px solid ' + rgba(NAVY, 0.12), marginTop: 24, lineHeight: 1.6,
    }}>
      C O P Y R I G H T&nbsp; ⓒ&nbsp; 2 0 2 6&nbsp; J E O N G H W A&nbsp;&nbsp; L E E<br />
      All rights reserved. 무단 전재 및 재배포 금지.
    </div>
  )
}

/* 브랜드 4색에서 투명도만 파생 — 신규 색상값을 만들지 않는다 */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
