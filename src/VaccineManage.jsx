/* 백신 관리 — 시즌·재원별 계정 / append-only 원장 (0089)
 *
 * ★ 이 화면은 vaccine_* 전용이다. transactions·drugs·inventory_stock·monthly_snapshots 를
 *   쓰지 않는다. drugs 는 [계정 +] 의 약품 선택에서 **SELECT 만** 한다.
 *
 * ★ 공용 컴포넌트를 수정하지 않는다 — ColMenu·useSort·ymd·todayYmd 를 props 로 주입받아
 *   **호출만** 한다. 표 헤더(필터 드롭다운·정렬 삼각형)를 자체 구현하지 않는다.
 *   ※ StandardTable 을 쓰지 않은 이유: 그 안의 HScroll 이 ‹› 버튼을 항상 그리는데,
 *      이 화면은 「가로스크롤 ‹› 제외」가 승인된 예외다. table 마크업만 직접 쓰고
 *      헤더 셀은 ColMenu 를 그대로 재사용한다.
 *
 * ★ 잔량 수식은 뷰(v_vaccine_balance)가 이미 분리해 준다. 여기서 다시 만들지 않는다.
 *     balance_qty = 입고 − 접종 − 반납 − 폐기   ← 배정을 더하지 않는다
 *     pending_qty = 배정 − 입고
 *
 * ★ 정정은 append-only — 수정·삭제 UI 를 두지 않는다. 음수 이벤트를 새로 만든다.
 *   DB 가드(trg_vaccine_events_append_only)가 UPDATE·DELETE 를 막는다.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useTheme } from './lib/theme'
import { dbErrorMsg } from './lib/dbError'

/* ── 상수 ─────────────────────────────────────────────────────────────────── */
const FUNDINGS = ['일반', '보건소', '지자체']
/* ★ 유료/무상 판정은 이 한 줄이 정본이다. 화면 곳곳에 fs==='일반' 을 흩뿌리지 않는다. */
const isPaid = fs => fs === '일반'

const EVT = ['접종', '입고', '배정', '반납', '폐기']
/* ★ 유료 계정에는 배정이 없다 — 지자체·보건소가 할당해 주는 개념이라 성립하지 않는다.
   저장되면 pending_qty 를 null 로 고정한 표시 규칙 때문에 **화면 어디에도 안 나온다**.
   저장은 되는데 보이지 않는 「조용한 누락」이 되므로 UI 와 저장 양쪽에서 막는다. */
const PAID_ALLOC_MSG = '유료 계정은 배정이 없습니다 — 입고로 등록하세요'
/* ★ drug_code 는 NOT NULL 이지만 **빈 문자열은 막지 못한다**(운영에 len=0 계정 1건 생겼다).
   NOT NULL 을 검증으로 믿으면 안 된다 — 공백만 넣은 값도 통과한다. trim 후 판정한다. */
const DRUG_REQ_MSG = '약품을 선택해 주세요'
/* ★ 계정 FK 는 전부 ON DELETE RESTRICT(0089) — 이벤트가 하나라도 있으면 23503 이다. */
const ACC_DEL_RESTRICT = '이 계정에는 기록이 있어 삭제할 수 없습니다. 비활성화하시겠습니까?'
/* ★ UNIQUE(tenant_id, season, drug_code, funding_source) 구성 요소는 수정에서 뺀다.
   바뀌면 이미 쌓인 이벤트가 어느 계정 소속이었는지 흔들린다. */
const ACC_LOCKED_MSG = '변경하려면 새 계정을 만드세요'
/* 이력 모달 상단 안내 — append-only 규약을 조작 직전에 알린다. */
const LEDGER_FIX_MSG = '기록은 수정·삭제할 수 없습니다. 잘못 입력한 경우 [정정]으로 반대 수량을 추가해 상계하세요.'
/* 카테고리 프리셋 — ★ funding_source 로 자동 결정하지 않는다.
   같은 '보건소'에 독감 어르신과 코로나가 함께 들어가는데 카테고리가 서로 다르다. */
const PRESETS = [
  { id: 'staff', label: '직원 · 일반 · 간병사', items: ['직원', '일반', '간병사'], hint: '유료 독감용' },
  { id: 'elder', label: '75세이상 · 70~74세 · 65~69세', items: ['75세이상', '70~74세', '65~69세'], hint: '보건소 어르신용' },
  { id: 'none', label: '없음 — 나중에 직접 추가', items: [], hint: '지자체 · 코로나용' },
]
const DEF = { season: '2026-2027', start: '2026-09-01', end: '2027-06-30' }
const N = v => Number(v ?? 0)
const fmt = v => N(v).toLocaleString()

/* eslint-disable-next-line no-unused-vars -- ColMenu 는 JSX 안에서만 쓰인다.
   이 저장소에는 eslint-plugin-react 가 없어 JSX 사용을 추적하지 못한다(오탐). */
export default function VaccineManage({ ColMenu, useSort, ymd, todayYmd }) {
  const { t } = useTheme()
  const { sk, sd, setSort, so, TS } = useSort('drug_code')

  const [accs, setAccs] = useState([])      // vaccine_accounts
  const [bal, setBal] = useState([])        // v_vaccine_balance
  const [cats, setCats] = useState([])      // vaccine_categories
  const [evts, setEvts] = useState([])      // vaccine_events
  const [ld, setLd] = useState(true)
  const [msg, setMsg] = useState(null)
  const [season, setSeason] = useState(DEF.season)
  const [asOf, setAsOf] = useState('')      // 「기준」 시각 — 화면 캡쳐로 공유하므로 필수
  const [hfV, setHfV] = useState({})        // 표 헤더 필터
  const [modal, setModal] = useState(null)  // { kind:'acct'|'evt'|'cats'|'fix', ... }

  const flash = (text, kind) => { setMsg({ text, kind }); setTimeout(() => setMsg(null), kind === 'err' ? 3600 : 2000) }

  /* ★ setLd(true) 를 여기 두지 않는다 — useEffect 안에서 동기 setState 가 되어
     react-hooks/set-state-in-effect 에 걸린다. ld 초기값이 true 이고,
     새로고침 버튼은 호출부에서 setLd(true) 를 먼저 부른다. */
  async function loadAll() {
    const [a, b, c, e] = await Promise.all([
      supabase.from('vaccine_accounts').select('*').order('season', { ascending: false }).order('drug_code'),
      supabase.from('v_vaccine_balance').select('*'),
      supabase.from('vaccine_categories').select('*').order('sort_order').order('label'),
      supabase.from('vaccine_events').select('*').order('event_date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    const err = a.error || b.error || c.error || e.error
    if (err) flash('불러오기 실패: ' + dbErrorMsg(err), 'err')
    setAccs(a.data || []); setBal(b.data || []); setCats(c.data || []); setEvts(e.data || [])
    /* ★ 「기준 시각」 — 화면을 캡쳐해 타 부서에 넘기므로 언제 값인지 남아야 한다 */
    const n = new Date()
    setAsOf(ymd(n.getFullYear(), n.getMonth() + 1, n.getDate()) + ' ' +
      String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'))
    setLd(false)
  }
  /* ★ set-state-in-effect 는 오탐이다 — loadAll 의 첫 문장이 `await Promise.all` 이라
     setState 가 동기로 실행되지 않는데, 규칙의 정적 분석이 await 경계를 보지 못한다.
     App.jsx 의 기존 화면 19곳이 같은 패턴이다. 사유를 남기고 이 줄만 억제한다. */
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { loadAll() }, [])

  /* ── 시즌 목록 — 계정에서 자동 수집. 없으면 기본값 하나 ── */
  const seasons = useMemo(() => {
    const s = [...new Set(accs.map(x => x.season).filter(Boolean))].sort().reverse()
    return s.length ? s : [DEF.season]
  }, [accs])
  /* ★ 시즌 동기화를 useEffect 로 하면 setState in effect 가 된다.
     고른 시즌이 목록에 없으면 첫 항목으로 **파생**해서 쓴다(상태를 건드리지 않는다). */
  const sel = seasons.includes(season) ? season : seasons[0]

  const balOf = useMemo(() => { const m = {}; bal.forEach(b => { m[b.account_id] = b }); return m }, [bal])
  const catsOf = useMemo(() => { const m = {}; cats.forEach(c => { (m[c.account_id] = m[c.account_id] || []).push(c) }); return m }, [cats])
  const evtsOf = useMemo(() => { const m = {}; evts.forEach(v => { (m[v.account_id] = m[v.account_id] || []).push(v) }); return m }, [evts])

  /* ── 계정별 파생값 ─────────────────────────────────────────────────────── */
  const rows = useMemo(() => accs.filter(a => a.season === sel).map(a => {
    const b = balOf[a.id] || {}
    const ev = evtsOf[a.id] || []
    const paid = isPaid(a.funding_source)
    const rec = N(b.received_qty), adm = N(b.administered_qty), balq = N(b.balance_qty)

    /* 소진율 = 접종 ÷ 입고. 입고 0 이면 계산 불가 */
    const useRate = rec > 0 ? adm / rec : null

    /* 경과일수 = 오늘 − 최초 접종일 + 1 */
    const admDates = ev.filter(x => x.event_type === '접종' && N(x.qty) > 0).map(x => x.event_date).sort()
    const first = admDates[0] || null
    let days = null
    if (first) {
      const d0 = new Date(first + 'T00:00:00'), d1 = new Date(todayYmd() + 'T00:00:00')
      days = Math.floor((d1 - d0) / 86400000) + 1
    }
    const perDay = days && days > 0 ? adm / days : 0

    /* 소진예상일 — 일평균 0 이거나 관측 7일 미만이면 내지 않는다(표본 부족) */
    let outDate = null, outWarn = false
    if (perDay > 0 && days >= 7 && balq > 0) {
      const add = Math.ceil(balq / perDay)
      const d = new Date(todayYmd() + 'T00:00:00'); d.setDate(d.getDate() + add)
      outDate = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
      if (a.return_due && outDate > a.return_due) outWarn = true
    }

    /* 카테고리별 접종 구성비 */
    const byCat = {}
    ev.filter(x => x.event_type === '접종').forEach(x => { byCat[x.category_id || '_'] = (byCat[x.category_id || '_'] || 0) + N(x.qty) })
    const catRows = (catsOf[a.id] || []).map(c => ({ id: c.id, label: c.label, qty: byCat[c.id] || 0, active: c.is_active }))
      .filter(c => c.qty !== 0 || c.active)

    return {
      ...a, paid,
      allocated_qty: N(b.allocated_qty), received_qty: rec, administered_qty: adm,
      returned_qty: N(b.returned_qty), discarded_qty: N(b.discarded_qty),
      /* ★ 유료 계정은 배정 이벤트가 없어 pending 이 항상 음수다(0−120). 표시하지 않는다.
         뷰는 고치지 않고 표시 계층에서만 막는다. */
      pending_qty: paid ? null : N(b.pending_qty),
      balance_qty: balq,
      useRate, days, perDay, outDate, outWarn, catRows,
      /* ★ 기록 유무를 **미리** 알아 버튼을 갈라 놓는다 — 눌러 보고 23503 을 받게 하지 않는다.
         이미 받아 둔 evts 로 세므로 추가 조회가 없다(삭제 직전에 다시 한 번 실측한다). */
      evCount: ev.length, catCount: (catsOf[a.id] || []).length,
      /* 경고 — 표시 전용. 저장을 막지 않는다 */
      warnNeg: balq < 0,
      warnOver: !paid && N(b.received_qty) > N(b.allocated_qty),
    }
  }), [accs, balOf, catsOf, evtsOf, sel, todayYmd, ymd])

  /* ── 표 — 필터 → 정렬 순서 ─────────────────────────────────────────────── */
  const uniq = k => [...new Set(rows.map(r => String(r[k] ?? '')).filter(Boolean))].sort()
  const hf = {
    drug_code: { items: uniq('drug_code'), value: hfV.drug_code || null, on: v => setHfV(p => ({ ...p, drug_code: v })) },
    funding_source: { items: uniq('funding_source'), value: hfV.funding_source || null, on: v => setHfV(p => ({ ...p, funding_source: v })) },
  }
  const dfCount = Object.values(hfV).filter(Boolean).length
  const filtered = rows.filter(r => Object.entries(hfV).every(([k, v]) => !v || String(r[k] ?? '') === v))
  const sorted = so(filtered)

  /* ── 저장 ─────────────────────────────────────────────────────────────── */
  async function addAccount(f, presetId) {
    /* ★ 약품 필수 — 버튼 disabled 만으로는 새지 않는다는 보장이 없다. 저장 직전이 마지막 방어선이다.
       drug_code 가 '' 이면 화면에 이름 없는 계정이 생기고, UNIQUE 키의 일부라 지우기도 번거롭다. */
    const dc = (f.drug_code || '').trim()
    if (!dc) { flash(DRUG_REQ_MSG, 'err'); return false }
    const { data: tm } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle()
    if (!tm?.tenant_id) { flash('소속 정보를 찾을 수 없습니다 — 관리자에게 문의해 주세요', 'err'); return false }
    const { data, error } = await supabase.from('vaccine_accounts').insert([{
      tenant_id: tm.tenant_id, season: f.season, season_start: f.season_start, season_end: f.season_end,
      drug_code: dc, funding_source: f.funding_source,
      settlement_body: f.settlement_body || null, storage_location: f.storage_location || null,
      admin_end: f.admin_end || null, return_due: f.return_due || null,
    }]).select('id').maybeSingle()
    if (error) {
      /* ★ UNIQUE(tenant_id, season, drug_code, funding_source) */
      if (error.code === '23505') { flash('이미 같은 시즌·약품·재원의 계정이 있습니다', 'err'); return false }
      flash('계정 생성 실패: ' + dbErrorMsg(error), 'err'); return false
    }
    const preset = PRESETS.find(p => p.id === presetId)
    if (preset && preset.items.length && data?.id) {
      const rowsC = preset.items.map((label, i) => ({ tenant_id: tm.tenant_id, account_id: data.id, label, sort_order: i }))
      const { error: ce } = await supabase.from('vaccine_categories').insert(rowsC)
      if (ce) flash('계정은 만들었으나 카테고리 생성 실패: ' + dbErrorMsg(ce), 'err')
    }
    flash('계정을 만들었습니다'); loadAll(); return true
  }

  /* ── 계정 수정 ──────────────────────────────────────────────────────────
     ★ season · drug_code · funding_source 를 **여기서 받지 않는다**.
       UNIQUE(tenant_id, season, drug_code, funding_source) 구성 요소이고,
       바꾸면 이미 쌓인 이벤트의 소속이 흔들린다. 모달에서도 읽기 전용이지만
       payload 자체에 넣지 않는 것이 마지막 방어선이다. */
  async function updAccount(id, f) {
    if (f.season_end && f.season_start && f.season_end < f.season_start) {
      /* DB CHECK(season_end >= season_start)가 23514 를 내기 전에 여기서 막는다 */
      flash('시즌 종료일이 시작일보다 빠릅니다', 'err'); return false
    }
    const { error } = await supabase.from('vaccine_accounts').update({
      season_start: f.season_start, season_end: f.season_end,
      settlement_body: (f.settlement_body || '').trim() || null,
      storage_location: (f.storage_location || '').trim() || null,
      admin_end: f.admin_end || null, return_due: f.return_due || null,
    }).eq('id', id)
    if (error) { flash('수정 실패: ' + dbErrorMsg(error), 'err'); return false }
    flash('계정을 수정했습니다'); loadAll(); return true
  }

  /* ── 계정 삭제 ──────────────────────────────────────────────────────────
     ★ 카테고리도 account_id FK RESTRICT 다. 프리셋으로 3개가 자동 생성되므로
       계정만 지우려 하면 이벤트가 0건이어도 23503 이 난다.
       그래서 **이벤트 0건을 먼저 실측**한 뒤에야 카테고리를 지운다.
       순서를 바꾸면 계정 삭제가 실패했을 때 카테고리만 사라진다. */
  async function delAccount(id) {
    const { count, error: qe } = await supabase.from('vaccine_events')
      .select('id', { count: 'exact', head: true }).eq('account_id', id)
    if (qe) { flash('확인 실패: ' + dbErrorMsg(qe), 'err'); return { ok: false } }
    if (count) return { ok: false, restrict: true }   // ★ 기록 있음 — 아무것도 지우지 않는다

    const { error: ce } = await supabase.from('vaccine_categories').delete().eq('account_id', id)
    if (ce) {
      if (ce.code === '23503') return { ok: false, restrict: true }
      flash('삭제 실패: ' + dbErrorMsg(ce), 'err'); return { ok: false }
    }
    const { error } = await supabase.from('vaccine_accounts').delete().eq('id', id)
    if (error) {
      if (error.code === '23503') return { ok: false, restrict: true }
      flash('삭제 실패: ' + dbErrorMsg(error), 'err'); return { ok: false }
    }
    flash('계정을 삭제했습니다'); loadAll(); return { ok: true }
  }

  /* 비활성화 — 기록이 있는 계정을 정리하는 유일한 길(0089 규약: 삭제 대신 비활성화) */
  async function setAccActive(id, v) {
    const { error } = await supabase.from('vaccine_accounts').update({ is_active: v }).eq('id', id)
    if (error) { flash('변경 실패: ' + dbErrorMsg(error), 'err'); return false }
    flash(v ? '계정을 다시 사용합니다' : '계정을 비활성화했습니다'); loadAll(); return true
  }

  async function addEvent(f) {
    const n = Math.round(Number(f.qty) * 100) / 100
    if (!Number.isFinite(n) || n === 0) { flash('수량은 0이 아닌 숫자여야 합니다', 'err'); return false }
    /* ★ 접종은 카테고리 필수 — DB CHECK 가 거부하기 전에 여기서 막는다 */
    if (f.event_type === '접종' && !f.category_id) { flash('접종은 대상 구분을 선택해 주세요', 'err'); return false }
    /* ★ 유료 계정 배정 차단 — 버튼·드롭다운만 막으면 다른 경로가 남는다. 저장 직전에 한 번 더 본다.
       DB 에는 이 제약이 없다(스키마상 유효한 조합) — 화면 규칙이므로 여기가 마지막 방어선이다. */
    if (f.event_type === '배정') {
      const acc0 = rows.find(r => r.id === f.account_id)
      if (acc0 && acc0.paid) { flash(PAID_ALLOC_MSG, 'err'); return false }
    }
    const { data: tm } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle()
    const { error } = await supabase.from('vaccine_events').insert([{
      tenant_id: tm?.tenant_id, account_id: f.account_id, event_type: f.event_type, qty: n,
      event_date: f.event_date || todayYmd(), category_id: f.category_id || null,
      lot_no: (f.lot_no || '').trim() || null, expiry_date: f.expiry_date || null,
      container: f.container || null, memo: (f.memo || '').trim() || null,
    }])
    if (error) { flash('저장 실패: ' + dbErrorMsg(error), 'err'); return false }
    flash(f.event_type + ' ' + n + ' 저장했습니다'); loadAll(); return true
  }

  /* 정정 — 원본을 고치지 않고 반대 부호 이벤트를 새로 만든다 */
  async function fixEvent(ev, reason) {
    const { data: tm } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle()
    const { error } = await supabase.from('vaccine_events').insert([{
      tenant_id: tm?.tenant_id, account_id: ev.account_id, event_type: ev.event_type, qty: -N(ev.qty),
      event_date: todayYmd(), category_id: ev.category_id || null,
      memo: '정정: ' + (reason || '') + ' (원본 ' + String(ev.id).slice(0, 8) + ')',
    }])
    if (error) { flash('정정 실패: ' + dbErrorMsg(error), 'err'); return false }
    flash('정정 이벤트를 추가했습니다'); loadAll(); return true
  }

  async function saveCat(op, payload) {
    let error = null
    if (op === 'add') {
      const { data: tm } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle()
      error = (await supabase.from('vaccine_categories').insert([{ tenant_id: tm?.tenant_id, account_id: payload.account_id, label: payload.label, sort_order: payload.sort_order }])).error
    } else if (op === 'rename') {
      error = (await supabase.from('vaccine_categories').update({ label: payload.label }).eq('id', payload.id)).error
    } else if (op === 'move') {
      error = (await supabase.from('vaccine_categories').update({ sort_order: payload.sort_order }).eq('id', payload.id)).error
    } else if (op === 'toggle') {
      error = (await supabase.from('vaccine_categories').update({ is_active: payload.is_active }).eq('id', payload.id)).error
    } else if (op === 'del') {
      error = (await supabase.from('vaccine_categories').delete().eq('id', payload.id)).error
      /* ★ 이벤트가 참조하면 FK RESTRICT 로 23503 — 지우지 말고 비활성화를 권한다 */
      if (error && error.code === '23503') return { ok: false, restrict: true }
    }
    if (error) { flash(dbErrorMsg(error), 'err'); return { ok: false } }
    loadAll(); return { ok: true }
  }

  /* ── 스타일 조각 ──────────────────────────────────────────────────────── */
  const ip = { padding: '7px 10px', border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, outline: 'none', background: t.bg, color: t.text, boxSizing: 'border-box' }
  const btn = (bg, fg, bd) => ({ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + (bd || bg), background: bg, color: fg, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' })
  const badge = (txt, col) => <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700, border: '1px solid ' + col, color: col, whiteSpace: 'nowrap' }}>{txt}</span>
  const td = { padding: '9px 10px', fontSize: 12, color: t.text, borderBottom: '1px solid ' + t.border, borderRight: '1px solid ' + t.border }
  /* ★ 숫자 열 우측 정렬선 — 헤더와 본문이 서로 다른 토큰을 쓰고 있었다.
       헤더 TS() = '10px 12px' (우측 12) · 본문 td = '9px 10px' (우측 10) → 2px 어긋남.
     숫자는 오른쪽 끝을 눈으로 훑는 열이라 이 차이가 열마다 기준선을 흔든다.
     잔여는 마지막 열이라 우측 경계가 카드 테두리와 겹쳐 특히 붙어 보인다.
     한 값으로 묶어 헤더·본문이 같은 세로선에 서게 한다. */
  const NUM_PR = 12
  const num = { ...td, textAlign: 'right', paddingRight: NUM_PR, fontVariantNumeric: 'tabular-nums' }

  /* ★ n:1 은 숫자 열 표시 — 순서·너비·헤더 구성은 그대로 두고 우측 패딩만 묶는 데 쓴다 */
  const COLS = [
    { k: 'drug_code', h: '약품코드', w: 128, sticky: 0 },
    { k: 'funding_source', h: '재원', w: 96, sticky: 128 },
    { k: 'allocated_qty', h: '배정', w: 92, n: 1 },
    { k: 'received_qty', h: '입고', w: 92, n: 1 },
    { k: 'administered_qty', h: '접종', w: 92, n: 1 },
    { k: 'returned_qty', h: '반납', w: 92, n: 1 },
    { k: 'balance_qty', h: '잔여', w: 96, n: 1 },
  ]

  return <div style={{ padding: '20px 24px' }}>
    {/* ═══ 1. 헤더 ═══ */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: t.text }}>백신 관리</h2>
      <select value={sel} onChange={e => setSeason(e.target.value)} style={{ ...ip, width: 138, fontWeight: 600 }}>
        {seasons.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div style={{ flex: 1 }} />
      {/* ★ 화면 캡쳐로 타 부서에 공유하므로 언제 기준인지 반드시 보인다 */}
      <span style={{ fontSize: 11, color: t.textM, fontVariantNumeric: 'tabular-nums' }}>{asOf} 기준</span>
      <button className="no-print" onClick={() => { setLd(true); loadAll() }} style={btn(t.bg, t.textM, t.border)}>새로고침</button>
    </div>

    {msg && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: msg.kind === 'err' ? t.bg : t.greenL, color: msg.kind === 'err' ? t.text : t.green, borderLeft: '3px solid ' + (msg.kind === 'err' ? t.text : t.green) }}>{msg.text}</div>}

    {/* ═══ 3. 액션 ═══ */}
    <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      <button onClick={() => setModal({ kind: 'acct' })} style={btn(t.accent, '#fff')}>계정 +</button>
      <div style={{ width: 8 }} />
      {EVT.map(k => {
        /* ★ 배정은 무상 계정에만 있다. 이 시즌에 무상 계정이 하나도 없으면 눌러도 갈 곳이 없다.
           (계정별 차단은 모달 안에서 다시 한다 — 여기서는 계정이 아직 안 골라졌다.) */
        const noFree = k === '배정' && !rows.some(r => !r.paid)
        const dis = !rows.length || noFree
        return <button key={k} onClick={() => setModal({ kind: 'evt', event_type: k })}
          disabled={dis} title={!rows.length ? '계정을 먼저 만들어 주세요' : noFree ? PAID_ALLOC_MSG : ''}
          style={{ ...btn(k === '접종' ? t.green : t.bg, k === '접종' ? '#fff' : t.text, k === '접종' ? t.green : t.border),
            ...(dis ? { cursor: 'not-allowed', opacity: 0.55 } : {}) }}>{k} +</button>
      })}
    </div>

    {ld ? <div style={{ padding: 40, textAlign: 'center', color: t.textL, fontSize: 12 }}>불러오는 중...</div>
      : !rows.length ? <div style={{ padding: 44, textAlign: 'center', color: t.textL, fontSize: 12, border: '1px dashed ' + t.border, borderRadius: 12 }}>
        {sel} 시즌 계정이 없습니다 — 「계정 +」로 먼저 만들어 주세요
      </div> : <>

        {/* ═══ 2. 계정 카드 — 전량 표시 ═══ */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          {rows.map(r => {
            const hc = r.paid ? t.purple : t.green
            return <div key={r.id} style={{ flex: '1 1 320px', minWidth: 300, maxWidth: 420, background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden', boxShadow: t.shadow, opacity: r.is_active === false ? 0.6 : 1 }}>
              <div style={{ background: hc, color: '#fff', padding: '9px 13px', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{r.drug_code}</span>
                <span style={{ fontSize: 11, opacity: 0.9 }}>{r.funding_source}</span>
                <span style={{ fontSize: 10, opacity: 0.8 }}>{r.paid ? '유료' : '무상'}</span>
                {/* ★ 비활성 계정도 목록에서 지우지 않는다 — 사라지면 「어디 갔지」가 된다 */}
                {r.is_active === false && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.7)' }}>비활성</span>}
                <div style={{ flex: 1 }} />
                {r.storage_location && <span style={{ fontSize: 10, opacity: 0.85 }}>{r.storage_location}</span>}
              </div>
              <div style={{ padding: '11px 13px' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {r.warnNeg && badge('입력 누락 의심', t.lavender)}
                  {r.warnOver && badge('배정 초과 입고', t.lavender)}
                  {r.outWarn && badge('시즌 내 소진 불가', t.lavender)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4, fontSize: 11, textAlign: 'right', marginBottom: 9 }}>
                  {[['배정', r.paid ? '—' : fmt(r.allocated_qty)], ['입고', fmt(r.received_qty)], ['접종', fmt(r.administered_qty)],
                    ['반납', fmt(r.returned_qty)], ['잔여', fmt(r.balance_qty)]].map(([l, v], i) =>
                    <div key={l}><div style={{ color: t.textM, fontSize: 9 }}>{l}</div><div style={{ fontWeight: i === 4 ? 700 : 600, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{v}</div></div>)}
                </div>
                {/* 소진율 바 — 배경 라벤더, 채움은 유료 보라 / 무상 녹색 */}
                <div style={{ marginBottom: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: t.textM, marginBottom: 3 }}>
                    <span>소진율</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.useRate == null ? '—' : (r.useRate * 100).toFixed(1) + '%'}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: t.lavender + '55', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.min(100, Math.max(0, (r.useRate || 0) * 100)) + '%', background: hc, borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ fontSize: 10, color: t.textM, lineHeight: 1.7, marginBottom: 8 }}>
                  <div>미입고 <b style={{ color: t.text }}>{r.pending_qty == null ? '—' : fmt(r.pending_qty)}</b>
                    {' · '}일평균 <b style={{ color: t.text }}>{r.perDay ? r.perDay.toFixed(1) : '—'}</b>
                    {' · '}경과 <b style={{ color: t.text }}>{r.days == null ? '—' : r.days + '일'}</b></div>
                  <div>소진예상 <b style={{ color: r.outWarn ? t.lavender : t.text }}>{r.outDate || '—'}</b>
                    {r.return_due && <span style={{ color: t.textL }}>{' · 반납기한 ' + r.return_due}</span>}</div>
                </div>
                {/* 카테고리별 접종 요약 */}
                {r.catRows.length > 0 && <div style={{ borderTop: '1px solid ' + t.border, paddingTop: 7 }}>
                  {r.catRows.map(c => {
                    const pct = r.administered_qty > 0 ? (c.qty / r.administered_qty) * 100 : 0
                    return <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginBottom: 2, opacity: c.active ? 1 : 0.55 }}>
                      <span style={{ flex: 1, color: t.textM }}>{c.label}{!c.active && ' (사용 안 함)'}</span>
                      <span style={{ color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.qty)}</span>
                      <span style={{ color: t.textL, width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct ? pct.toFixed(1) + '%' : '—'}</span>
                    </div>
                  })}
                </div>}
                <div className="no-print" style={{ display: 'flex', gap: 5, marginTop: 9 }}>
                  <button onClick={() => setModal({ kind: 'evt', event_type: '접종', account_id: r.id })} style={{ ...btn(t.green, '#fff'), flex: 1, padding: '6px 10px', fontSize: 11 }}>접종 +</button>
                  <button onClick={() => setModal({ kind: 'cats', account_id: r.id })} style={{ ...btn(t.bg, t.textM, t.border), padding: '6px 10px', fontSize: 11 }}>대상 구분</button>
                  <button onClick={() => setModal({ kind: 'fix', account_id: r.id })} style={{ ...btn(t.bg, t.textM, t.border), padding: '6px 10px', fontSize: 11 }}>이력</button>
                </div>
                {/* ★ 관리 줄 — 기록이 있으면 [삭제] 자체를 내지 않는다.
                    눌러 보고 23503 을 받는 대신, 가능한 동작만 보인다. */}
                <div className="no-print" style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                  <button onClick={() => setModal({ kind: 'edit', account_id: r.id })} style={{ ...btn(t.bg, t.textM, t.border), flex: 1, padding: '6px 10px', fontSize: 11 }}>수정</button>
                  {r.evCount === 0
                    ? <button onClick={() => setModal({ kind: 'del', account_id: r.id })} style={{ ...btn(t.bg, t.purple, t.purple), flex: 1, padding: '6px 10px', fontSize: 11 }}>삭제</button>
                    : r.is_active === false
                      ? <button onClick={() => setAccActive(r.id, true)} style={{ ...btn(t.bg, t.green, t.green), flex: 1, padding: '6px 10px', fontSize: 11 }}>다시 사용</button>
                      : <button onClick={() => setModal({ kind: 'del', account_id: r.id })} title={'기록 ' + r.evCount + '건 — 삭제할 수 없습니다'}
                        style={{ ...btn(t.bg, t.purple, t.purple), flex: 1, padding: '6px 10px', fontSize: 11 }}>비활성화</button>}
                </div>
              </div>
            </div>
          })}
        </div>

        {/* ═══ 4. 표준 표 ═══ */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid ' + t.border }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>약품별 집계</span>
            <span style={{ fontSize: 11, color: t.textM }}>{sorted.length}건</span>
            <div style={{ flex: 1 }} />
            {dfCount > 0 && <button className="no-print" onClick={() => { setHfV({}); setSort('drug_code', 'asc') }}
              style={btn(t.accent + '12', t.accent, t.accent)}>필터 초기화 ({dfCount})</button>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 760, fontSize: 12 }}>
              <colgroup>{COLS.map(c => <col key={c.k} style={{ width: c.w }} />)}</colgroup>
              <thead><tr>{COLS.map(c => {
                /* ★ 숫자 열은 헤더도 같은 우측 패딩을 쓴다 — 본문 숫자와 한 세로선에 선다.
                   헤더 정렬(좌측)은 기존 표들과 같게 유지한다(월마감 표도 좌측이다). */
                const st = { ...TS(c.k), background: t.bg, borderRight: '1px solid ' + t.border,
                  ...(c.n ? { paddingRight: NUM_PR } : {}),
                  ...(c.sticky != null ? { position: 'sticky', left: c.sticky, zIndex: 6, minWidth: c.w, maxWidth: c.w, width: c.w } : {}),
                  ...(hf[c.k] && hf[c.k].value ? { background: t.lavender + '33' } : {}) }
                /* ★ 표 헤더는 ColMenu 를 그대로 재사용한다(자체 구현 금지) */
                return <th key={c.k} style={st}>
                  <ColMenu colKey={c.k} label={c.h} sk={sk} sd={sd} setSort={setSort} filter={hf[c.k] || null} />
                </th>
              })}</tr></thead>
              <tbody>{!sorted.length
                ? <tr><td colSpan={COLS.length} style={{ ...td, textAlign: 'center', color: t.textL, padding: 26 }}>표시할 계정이 없습니다</td></tr>
                : sorted.map((r, i) => {
                  const bgc = i % 2 ? t.bg : t.card
                  return <tr key={r.id}>
                    <td style={{ ...td, position: 'sticky', left: 0, zIndex: 2, background: bgc, fontWeight: 600 }}>{r.drug_code}</td>
                    <td style={{ ...td, position: 'sticky', left: 128, zIndex: 2, background: bgc }}>
                      {badge(r.funding_source, r.paid ? t.purple : t.green)}
                    </td>
                    <td style={num}>{r.paid ? '—' : fmt(r.allocated_qty)}</td>
                    <td style={num}>{fmt(r.received_qty)}</td>
                    <td style={num}>{fmt(r.administered_qty)}</td>
                    <td style={num}>{fmt(r.returned_qty)}</td>
                    <td style={{ ...num, fontWeight: 700, color: r.warnNeg ? t.lavender : t.text }}>{fmt(r.balance_qty)}</td>
                  </tr>
                })}</tbody>
            </table>
          </div>
        </div>
      </>}

    {modal && <VaccineModal t={t} ip={ip} btn={btn} badge={badge} modal={modal} rows={rows} cats={cats} evts={evts}
      onClose={() => setModal(null)} onAccount={addAccount} onEvent={addEvent} onFix={fixEvent} onCat={saveCat}
      onUpdAccount={updAccount} onDelAccount={delAccount} onAccActive={setAccActive}
      todayYmd={todayYmd} />}
  </div>
}

/* ═══ 모달 — 계정 + / 이벤트 + / 대상 구분 / 이력·정정 ═══════════════════════ */
function VaccineModal({ t, ip, btn, badge, modal, rows, cats, evts, onClose, onAccount, onEvent, onFix, onCat, onUpdAccount, onDelAccount, onAccActive, todayYmd }) {
  const [busy, setBusy] = useState(false)
  /* ★ 수정·삭제 모달은 대상 계정을 먼저 집는다. 초기화 함수 안에서만 쓰므로 상태가 아니다. */
  const tgt = (modal.kind === 'edit' || modal.kind === 'del') ? rows.find(r => r.id === modal.account_id) || null : null
  const [f, setF] = useState(() => modal.kind === 'acct'
    ? { season: DEF.season, season_start: DEF.start, season_end: DEF.end, drug_code: '', funding_source: '일반', settlement_body: '', storage_location: '', admin_end: DEF.end, return_due: DEF.end }
    : modal.kind === 'edit'
      ? {
        /* ★ date 입력은 'YYYY-MM-DD' 만 받는다. DB 가 timestamptz 로 돌려주는 경우가 있어 앞 10자만 쓴다. */
        season_start: d10(tgt && tgt.season_start), season_end: d10(tgt && tgt.season_end),
        settlement_body: (tgt && tgt.settlement_body) || '', storage_location: (tgt && tgt.storage_location) || '',
        admin_end: d10(tgt && tgt.admin_end), return_due: d10(tgt && tgt.return_due),
      }
      : { account_id: modal.account_id || (rows[0] && rows[0].id) || '', event_type: modal.event_type || '접종', qty: '', event_date: todayYmd(), category_id: '', lot_no: '', expiry_date: '', container: '', memo: '' })
  const [delRestrict, setDelRestrict] = useState(false)
  const [preset, setPreset] = useState('staff')
  const [drugs, setDrugs] = useState(null)
  const [dq, setDq] = useState('')
  const [newCat, setNewCat] = useState('')
  const [restrictAsk, setRestrictAsk] = useState(null)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  /* 약품 목록 — ★ drugs 는 SELECT 만. 모달을 열 때만 읽는다(초기 로딩 부담 회피) */
  useEffect(() => {
    if (modal.kind !== 'acct') return
    let on = true
    supabase.from('drugs').select('drug_code,drug_name,category').eq('status', '사용').order('drug_name')
      .then(({ data }) => { if (on) setDrugs(data || []) })
    return () => { on = false }
  }, [modal.kind])

  const acc = rows.find(r => r.id === f.account_id) || null
  const accCats = cats.filter(c => c.account_id === f.account_id)
  /* ★ 공백만 넣은 값도 미선택으로 본다 — addAccount 의 trim 판정과 같은 식이다 */
  const noDrug = modal.kind === 'acct' && !(f.drug_code || '').trim()
  const wrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 16px', overflowY: 'auto' }
  const box = { background: t.cardSolid, borderRadius: 14, width: '100%', maxWidth: modal.kind === 'fix' ? 640 : 520, border: '1px solid ' + t.border, boxShadow: t.shadowH, overflow: 'hidden' }
  const lb = { fontSize: 11, color: t.textM, marginBottom: 3, fontWeight: 600 }
  const row2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 10 }
  const title = modal.kind === 'acct' ? '계정 만들기' : modal.kind === 'cats' ? '대상 구분 관리'
    : modal.kind === 'fix' ? '이벤트 이력 · 정정' : modal.kind === 'edit' ? '계정 수정'
      : modal.kind === 'del' ? '계정 삭제' : (f.event_type + ' 등록')
  /* 읽기 전용 칸 — 입력처럼 보이되 고칠 수 없음이 드러나야 한다 */
  const ro = { ...ip, width: '100%', background: t.bg, color: t.textM, cursor: 'not-allowed' }

  return <div style={wrap} onClick={onClose}>
    <div style={box} onClick={e => e.stopPropagation()}>
      <div style={{ background: t.nav, color: '#fff', padding: '13px 18px', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 26, height: 26, borderRadius: 7, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ padding: '16px 18px', maxHeight: '66vh', overflowY: 'auto' }}>

        {/* ── 계정 만들기 ── */}
        {modal.kind === 'acct' && <>
          <div style={row2}>
            <div><div style={lb}>시즌</div><input value={f.season} onChange={e => set('season', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>재원</div><select value={f.funding_source} onChange={e => set('funding_source', e.target.value)} style={{ ...ip, width: '100%' }}>{FUNDINGS.map(v => <option key={v}>{v}</option>)}</select></div>
          </div>
          <div style={row2}>
            <div><div style={lb}>시즌 시작</div><input type="date" value={f.season_start} onChange={e => set('season_start', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>시즌 종료</div><input type="date" value={f.season_end} onChange={e => set('season_end', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={lb}>약품 <span style={{ color: t.purple }}>*</span></div>
            <input value={dq} onChange={e => setDq(e.target.value)} placeholder="약품명·코드 검색" style={{ ...ip, width: '100%', marginBottom: 5 }} />
            <select value={f.drug_code} onChange={e => set('drug_code', e.target.value)} size={5}
              style={{ ...ip, width: '100%', height: 118, ...(noDrug ? { borderColor: t.purple } : {}) }}>
              {drugs === null ? <option>불러오는 중...</option>
                : drugs.filter(d => !dq.trim() || (d.drug_name + d.drug_code).toLowerCase().includes(dq.trim().toLowerCase())).slice(0, 300)
                  .map(d => <option key={d.drug_code} value={d.drug_code}>{d.drug_name} · {d.drug_code}</option>)}
            </select>
            {/* ★ 약품이 없으면 이름 없는 계정이 생긴다 — 저장 버튼도 함께 막힌다 */}
            {noDrug && <div style={{ marginTop: 5, fontSize: 11, color: t.text, borderLeft: '3px solid ' + t.purple, paddingLeft: 8, lineHeight: 1.6 }}>{DRUG_REQ_MSG}</div>}
          </div>
          <div style={row2}>
            <div><div style={lb}>정산 주체</div><input value={f.settlement_body} onChange={e => set('settlement_body', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>보관 위치</div><input value={f.storage_location} onChange={e => set('storage_location', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          <div style={row2}>
            <div><div style={lb}>접종 종료</div><input type="date" value={f.admin_end} onChange={e => set('admin_end', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>반납 기한</div><input type="date" value={f.return_due} onChange={e => set('return_due', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div style={lb}>대상 구분 프리셋</div>
            {PRESETS.map(p => <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 2px', fontSize: 12, color: t.text, cursor: 'pointer' }}>
              <input type="radio" name="preset" checked={preset === p.id} onChange={() => setPreset(p.id)} />
              <span style={{ flex: 1 }}>{p.label}</span>
              <span style={{ fontSize: 10, color: t.textL }}>{p.hint}</span>
            </label>)}
          </div>
        </>}

        {/* ── 계정 수정 ──
            ★ 시즌·약품·재원은 UNIQUE 키다. 읽기 전용으로 보여 주되 payload 에 넣지 않는다. */}
        {modal.kind === 'edit' && (!tgt ? <div style={{ padding: 20, fontSize: 12, color: t.textL, textAlign: 'center' }}>계정을 찾을 수 없습니다</div> : <>
          <div style={{ marginBottom: 12, padding: '8px 11px', borderLeft: '3px solid ' + t.lavender, background: t.bg, borderRadius: 6, fontSize: 11, color: t.text, lineHeight: 1.6 }}>
            시즌 · 약품 · 재원은 계정을 가르는 키라 바꿀 수 없습니다 — {ACC_LOCKED_MSG}.
          </div>
          <div style={row2}>
            <div><div style={lb}>시즌 <span style={{ color: t.textL }}>(고정)</span></div><input value={tgt.season} readOnly disabled style={ro} /></div>
            <div><div style={lb}>재원 <span style={{ color: t.textL }}>(고정)</span></div><input value={tgt.funding_source} readOnly disabled style={ro} /></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={lb}>약품 <span style={{ color: t.textL }}>(고정)</span></div>
            <input value={tgt.drug_code} readOnly disabled style={ro} />
          </div>
          <div style={row2}>
            <div><div style={lb}>시즌 시작</div><input type="date" value={f.season_start} onChange={e => set('season_start', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>시즌 종료</div><input type="date" value={f.season_end} onChange={e => set('season_end', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          <div style={row2}>
            <div><div style={lb}>정산 주체</div><input value={f.settlement_body} onChange={e => set('settlement_body', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>보관 위치</div><input value={f.storage_location} onChange={e => set('storage_location', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          <div style={row2}>
            <div><div style={lb}>접종 종료</div><input type="date" value={f.admin_end} onChange={e => set('admin_end', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>반납 기한</div><input type="date" value={f.return_due} onChange={e => set('return_due', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
        </>)}

        {/* ── 계정 삭제 · 비활성화 ── */}
        {modal.kind === 'del' && (!tgt ? <div style={{ padding: 20, fontSize: 12, color: t.textL, textAlign: 'center' }}>계정을 찾을 수 없습니다</div> : <>
          <div style={{ fontSize: 12, color: t.text, lineHeight: 1.7, marginBottom: 10 }}>
            <b>{tgt.drug_code}</b> · {tgt.funding_source} · {tgt.season}
          </div>
          {(tgt.evCount > 0 || delRestrict)
            /* 기록이 있는 계정 — 삭제 자체가 막힌다(FK RESTRICT). 비활성화만 제안한다. */
            ? <div style={{ padding: '10px 12px', borderLeft: '3px solid ' + t.lavender, background: t.bg, borderRadius: 8, fontSize: 12, color: t.text, lineHeight: 1.7 }}>
              {ACC_DEL_RESTRICT}
              <div style={{ fontSize: 11, color: t.textM, marginTop: 5 }}>
                기록 {tgt.evCount}건이 남아 있습니다. 비활성화하면 목록에 「비활성」으로 표시되고 기록은 그대로 보존됩니다.
              </div>
            </div>
            : <div style={{ padding: '10px 12px', borderLeft: '3px solid ' + t.purple, background: t.bg, borderRadius: 8, fontSize: 12, color: t.text, lineHeight: 1.7 }}>
              계정을 삭제합니다. 되돌릴 수 없습니다.
              {tgt.catCount > 0 && <div style={{ fontSize: 11, color: t.textM, marginTop: 5 }}>
                이 계정의 대상 구분 {tgt.catCount}개도 함께 삭제됩니다.
              </div>}
            </div>}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 14 }}>
            <button onClick={onClose} style={btn(t.bg, t.textM, t.border)}>취소</button>
            {(tgt.evCount > 0 || delRestrict)
              ? <button disabled={busy} onClick={async () => { setBusy(true); const ok = await onAccActive(tgt.id, false); setBusy(false); if (ok) onClose() }}
                style={btn(busy ? t.textL : t.accent, '#fff')}>{busy ? '처리 중...' : '비활성화'}</button>
              : <button disabled={busy} onClick={async () => {
                setBusy(true); const r = await onDelAccount(tgt.id); setBusy(false)
                /* ★ 다른 창에서 방금 기록이 생겼을 수 있다 — 23503 이면 화면을 비활성화 안내로 바꾼다 */
                if (r && r.ok) onClose(); else if (r && r.restrict) setDelRestrict(true)
              }} style={btn(busy ? t.textL : t.purple, '#fff')}>{busy ? '삭제 중...' : '삭제'}</button>}
          </div>
        </>)}

        {/* ── 이벤트 등록 ── */}
        {modal.kind === 'evt' && <>
          <div style={{ marginBottom: 10 }}>
            <div style={lb}>계정</div>
            <select value={f.account_id} onChange={e => { set('account_id', e.target.value); set('category_id', '') }} style={{ ...ip, width: '100%' }}>
              {rows.map(r => <option key={r.id} value={r.id}>{r.drug_code} · {r.funding_source} · 잔여 {fmt(r.balance_qty)}</option>)}
            </select>
          </div>
          <div style={row2}>
            {/* ★ 유료 계정은 '배정' 을 고를 수 없다. 계정을 바꾸면 즉시 반영된다. */}
            <div><div style={lb}>유형</div><select value={f.event_type} onChange={e => set('event_type', e.target.value)} style={{ ...ip, width: '100%' }}>
              {EVT.map(v => <option key={v} value={v} disabled={v === '배정' && !!(acc && acc.paid)}>{v}</option>)}
            </select></div>
            <div><div style={lb}>일자</div><input type="date" value={f.event_date} onChange={e => set('event_date', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          {/* ★ 유료 계정을 고른 상태로 '배정' 이 남아 있으면 알린다.
                (상단 [배정 +] 로 들어와 계정을 유료로 바꾼 경우) 저장은 addEvent 가 막는다. */}
          {f.event_type === '배정' && acc && acc.paid && <div style={{ marginBottom: 10, padding: '7px 10px', fontSize: 11, color: t.text, borderLeft: '3px solid ' + t.lavender, background: t.bg, borderRadius: 6, lineHeight: 1.6 }}>
            {PAID_ALLOC_MSG}
          </div>}
          {/* ★ 접종은 대상 구분 필수 — DB CHECK 전에 여기서 막는다 */}
          {f.event_type === '접종' && <div style={{ marginBottom: 10 }}>
            <div style={lb}>대상 구분 <span style={{ color: t.purple }}>*</span></div>
            {!accCats.filter(c => c.is_active).length
              ? <div style={{ fontSize: 11, color: t.text, borderLeft: '3px solid ' + t.lavender, paddingLeft: 8, lineHeight: 1.6 }}>
                이 계정에 대상 구분이 없습니다 — 카드의 「대상 구분」에서 먼저 추가해 주세요.</div>
              : <select value={f.category_id} onChange={e => set('category_id', e.target.value)} style={{ ...ip, width: '100%' }}>
                <option value="">선택해 주세요</option>
                {accCats.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>}
          </div>}
          <div style={row2}>
            <div><div style={lb}>수량 <span style={{ color: t.purple }}>*</span></div>
              <input value={f.qty} onChange={e => set('qty', e.target.value.replace(/[^0-9.-]/g, ''))} inputMode="decimal" placeholder="0 은 저장되지 않습니다" style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>용기</div><select value={f.container} onChange={e => set('container', e.target.value)} style={{ ...ip, width: '100%' }}>
              <option value="">(선택 안 함)</option><option>바이알</option><option>PFS</option></select></div>
          </div>
          <div style={row2}>
            <div><div style={lb}>LOT</div><input value={f.lot_no} onChange={e => set('lot_no', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
            <div><div style={lb}>유효기한</div><input type="date" value={f.expiry_date} onChange={e => set('expiry_date', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          </div>
          <div><div style={lb}>메모</div><input value={f.memo} onChange={e => set('memo', e.target.value)} style={{ ...ip, width: '100%' }} /></div>
          {acc && <div style={{ marginTop: 9, fontSize: 11, color: t.textM }}>현재 잔여 <b style={{ color: t.text }}>{fmt(acc.balance_qty)}</b></div>}
        </>}

        {/* ── 대상 구분 관리 ── */}
        {modal.kind === 'cats' && <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="새 대상 구분" style={{ ...ip, flex: 1 }} />
            <button disabled={busy || !newCat.trim()} onClick={async () => {
              setBusy(true); await onCat('add', { account_id: modal.account_id, label: newCat.trim(), sort_order: accCatsOf(cats, modal.account_id).length }); setBusy(false); setNewCat('')
            }} style={btn(t.accent, '#fff')}>추가</button>
          </div>
          {!accCatsOf(cats, modal.account_id).length ? <div style={{ fontSize: 12, color: t.textL, textAlign: 'center', padding: 20 }}>등록된 대상 구분이 없습니다</div>
            : accCatsOf(cats, modal.account_id).map((c, i, arr) => <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid ' + t.border, opacity: c.is_active ? 1 : 0.55 }}>
              <input defaultValue={c.label} onBlur={async e => { const v = e.target.value.trim(); if (v && v !== c.label) { setBusy(true); await onCat('rename', { id: c.id, label: v }); setBusy(false) } }}
                style={{ ...ip, flex: 1, fontSize: 12 }} />
              <button disabled={i === 0 || busy} onClick={async () => { setBusy(true); await onCat('move', { id: c.id, sort_order: (arr[i - 1].sort_order ?? 0) - 1 }); setBusy(false) }} style={{ ...btn(t.bg, t.textM, t.border), padding: '5px 8px', fontSize: 11 }}>↑</button>
              <button disabled={i === arr.length - 1 || busy} onClick={async () => { setBusy(true); await onCat('move', { id: c.id, sort_order: (arr[i + 1].sort_order ?? 0) + 1 }); setBusy(false) }} style={{ ...btn(t.bg, t.textM, t.border), padding: '5px 8px', fontSize: 11 }}>↓</button>
              <button disabled={busy} onClick={async () => { setBusy(true); await onCat('toggle', { id: c.id, is_active: !c.is_active }); setBusy(false) }} style={{ ...btn(t.bg, c.is_active ? t.green : t.textL, t.border), padding: '5px 9px', fontSize: 11 }}>{c.is_active ? '사용' : '중지'}</button>
              <button disabled={busy} onClick={async () => {
                setBusy(true); const r = await onCat('del', { id: c.id }); setBusy(false)
                if (r && r.restrict) setRestrictAsk(c)
              }} style={{ ...btn(t.bg, t.textM, t.border), padding: '5px 9px', fontSize: 11 }}>삭제</button>
            </div>)}
          {/* ★ FK RESTRICT(23503) — 지우지 말고 비활성화를 권한다 */}
          {restrictAsk && <div style={{ marginTop: 12, padding: '10px 12px', borderLeft: '3px solid ' + t.lavender, background: t.bg, borderRadius: 8, fontSize: 12, color: t.text, lineHeight: 1.6 }}>
            「{restrictAsk.label}」에 기록이 있어 삭제할 수 없습니다. 비활성화하시겠습니까?
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={async () => { setBusy(true); await onCat('toggle', { id: restrictAsk.id, is_active: false }); setBusy(false); setRestrictAsk(null) }} style={btn(t.accent, '#fff')}>비활성화</button>
              <button onClick={() => setRestrictAsk(null)} style={btn(t.bg, t.textM, t.border)}>취소</button>
            </div>
          </div>}
        </>}

        {/* ── 이력 · 정정 ── */}
        {modal.kind === 'fix' && <FixList t={t} btn={btn} ip={ip} badge={badge} evts={evts.filter(e => e.account_id === modal.account_id)} cats={cats} onFix={onFix} />}
      </div>

      {(modal.kind === 'acct' || modal.kind === 'evt' || (modal.kind === 'edit' && tgt)) && <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid ' + t.border }}>
        <button onClick={onClose} style={btn(t.bg, t.textM, t.border)}>취소</button>
        {/* ★ 약품 미선택이면 저장 버튼부터 막는다(저장 직전 방어는 addAccount 안에 따로 있다) */}
        <button disabled={busy || noDrug} onClick={async () => {
          setBusy(true)
          const ok = modal.kind === 'acct' ? await onAccount(f, preset)
            : modal.kind === 'edit' ? await onUpdAccount(modal.account_id, f)
              : await onEvent(f)
          setBusy(false); if (ok) onClose()
        }} title={noDrug ? DRUG_REQ_MSG : ''}
          style={{ ...btn(busy || noDrug ? t.textL : t.accent, '#fff'), ...(noDrug ? { cursor: 'not-allowed', opacity: 0.6 } : {}) }}>{busy ? '저장 중...' : '저장'}</button>
      </div>}
    </div>
  </div>
}

/* ★ <input type="date"> 는 'YYYY-MM-DD' 만 받는다.
   DB 가 date 를 '2027-06-29T15:00:00.000Z' 형태로 돌려주는 경우가 있어 앞 10자만 쓴다.
   그대로 넣으면 값이 빈 칸으로 보이고, 저장 시 기존 날짜가 지워진다. */
function d10(v) { return v ? String(v).slice(0, 10) : '' }

function accCatsOf(cats, accId) {
  return cats.filter(c => c.account_id === accId).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.label).localeCompare(String(b.label), 'ko'))
}

/* 이벤트 이력 — ★ 수정·삭제 버튼을 두지 않는다. 정정은 반대 부호 이벤트를 새로 만든다. */
function FixList({ t, btn, ip, badge, evts, cats, onFix }) {
  const [target, setTarget] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const catName = id => (cats.find(c => c.id === id) || {}).label || ''
  const td = { padding: '7px 8px', fontSize: 11, borderBottom: '1px solid ' + t.border, color: t.text }
  return <>
    {/* ★ 상단 안내 — 「고칠 수 없다」를 먼저 알리고 [정정] 이 그 대안임을 붙인다.
        이전에는 회색 잔글씨라 못 보고 수정 버튼을 찾는 일이 있었다. */}
    <div style={{ marginBottom: 10, padding: '9px 11px', borderLeft: '3px solid ' + t.purple, background: t.bg, borderRadius: 8, fontSize: 12, color: t.text, lineHeight: 1.7 }}>
      {LEDGER_FIX_MSG}
    </div>
    {!evts.length ? <div style={{ padding: 24, textAlign: 'center', color: t.textL, fontSize: 12 }}>이벤트가 없습니다</div>
      : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['일자', '유형', '대상', '수량', ''].map(h => <th key={h} style={{ ...td, color: t.textM, fontWeight: 700, textAlign: h === '수량' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
        {/* ★ 정정 이벤트를 따로 떼지 않는다 — 시간순 흐름 안에서 배지로만 가른다.
            탭으로 나누면 「무엇을 언제 되돌렸는지」가 끊긴다. */}
        <tbody>{evts.map(e => {
          const neg = Number(e.qty) < 0
          return <Fragment key={e.id}>
            <tr>
              <td style={{ ...td, ...(neg ? { borderBottom: 'none' } : {}) }}>{e.event_date}</td>
              <td style={{ ...td, ...(neg ? { borderBottom: 'none' } : {}) }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {e.event_type}
                  {/* ★ 라벤더 테두리 배지 — 기존 badge() 토큰 그대로. 신색 없음 */}
                  {neg && badge('정정', t.lavender)}
                </span>
              </td>
              <td style={{ ...td, color: t.textM, ...(neg ? { borderBottom: 'none' } : {}) }}>{catName(e.category_id) || '—'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: neg ? t.textM : t.text, fontVariantNumeric: 'tabular-nums', ...(neg ? { borderBottom: 'none' } : {}) }}>{Number(e.qty).toLocaleString()}</td>
              <td style={{ ...td, textAlign: 'right', ...(neg ? { borderBottom: 'none' } : {}) }}>
                {/* ★ 회색 잔글씨였던 것을 보라 테두리 + 굵기로 올린다(신색 없이 대비만 높인다).
                    음수 행은 이미 정정분이므로 버튼을 내지 않는다 — 정정의 정정이 쌓인다. */}
                {Number(e.qty) > 0 && <button onClick={() => { setTarget(e); setReason('') }}
                  style={{ ...btn(t.bg, t.purple, t.purple), padding: '4px 12px', fontSize: 11, fontWeight: 700 }}>정정</button>}
              </td>
            </tr>
            {/* 사유 — 무엇을 왜 되돌렸는지가 행에서 바로 읽혀야 한다 */}
            {neg && e.memo && <tr>
              <td colSpan={5} style={{ padding: '0 8px 7px 8px', borderBottom: '1px solid ' + t.border }}>
                <span style={{ display: 'block', borderLeft: '3px solid ' + t.lavender, paddingLeft: 7, fontSize: 10, color: t.textM, lineHeight: 1.6 }}>{e.memo}</span>
              </td>
            </tr>}
          </Fragment>
        })}</tbody>
      </table>}
    {target && <div style={{ marginTop: 12, padding: '11px 12px', borderLeft: '3px solid ' + t.purple, background: t.bg, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: t.text, marginBottom: 7 }}>
        {target.event_date} · {target.event_type} · {Number(target.qty).toLocaleString()} 을(를) 상쇄하는
        <b style={{ color: t.purple }}> {(-Number(target.qty)).toLocaleString()}</b> 이벤트를 새로 만듭니다.
      </div>
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="정정 사유(선택)" style={{ ...ip, width: '100%', marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button disabled={busy} onClick={async () => { setBusy(true); const ok = await onFix(target, reason); setBusy(false); if (ok) setTarget(null) }} style={btn(t.purple, '#fff')}>정정 등록</button>
        <button onClick={() => setTarget(null)} style={btn(t.bg, t.textM, t.border)}>취소</button>
      </div>
    </div>}
  </>
}
