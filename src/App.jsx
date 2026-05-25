import { useEffect, useState, useRef, createContext, useContext } from 'react'
import { supabase } from './lib/supabase'
import * as XLSX from 'xlsx'

/* ═══════════════════════════════════════════════════
   Yakflo · Soft UI + Eco-Minimalism
   세이지 그린 + 오프 화이트 · 다크 헤더
   ═══════════════════════════════════════════════════ */
const themes = {
  light: {
    bg:'#F7F6F3', card:'#FFFFFF', cardSolid:'#FFFFFF', glass:'rgba(255,255,255,0.9)',
    border:'#E8E6E1', borderH:'#D7D7D7',
    text:'#2E4A62', textM:'#52524E', textL:'#A3A39E',
    accent:'#804A87', accentL:'#F5EDF6',
    green:'#019748', greenL:'#E6F7EE', red:'#C62828', redL:'#FFEBEE',
    amber:'#E65100', amberL:'#FFF3E0', blue:'#2E4A62', blueL:'#EAF0F5',
    purple:'#804A87', purpleL:'#F5EDF6',
    mint:'#7FD9A8', coral:'#F39E94', lavender:'#BFA6D9', pink:'#E2A6D4',
    nav:'#2E4A62', navText:'#F7F6F3', navHi:'#BFA6D9',
    shadow:'0 2px 8px rgba(46,74,98,0.06)', shadowH:'0 8px 24px rgba(46,74,98,0.10)',
  },
  dark: {
    bg:'#121820', card:'#1A2332', cardSolid:'#1E2A3A', glass:'rgba(26,35,50,0.9)',
    border:'#2A3A4A', borderH:'#3A4A5A',
    text:'#E8E6E1', textM:'#A3A39E', textL:'#6B7B8B',
    accent:'#BFA6D9', accentL:'rgba(191,166,217,0.12)',
    green:'#7FD9A8', greenL:'rgba(127,217,168,0.12)', red:'#F39E94', redL:'rgba(243,158,148,0.12)',
    amber:'#FFB74D', amberL:'rgba(255,183,77,0.12)', blue:'#92C8E0', blueL:'rgba(146,200,224,0.12)',
    purple:'#BFA6D9', purpleL:'rgba(191,166,217,0.12)',
    mint:'#7FD9A8', coral:'#F39E94', lavender:'#BFA6D9', pink:'#E2A6D4',
    nav:'#1A2332', navText:'#E8E6E1', navHi:'#BFA6D9',
    shadow:'0 2px 8px rgba(0,0,0,0.3)', shadowH:'0 8px 24px rgba(0,0,0,0.4)',
  }
}
const ThemeCtx = createContext()
function useTheme() { return useContext(ThemeCtx) }
const CATS = ['경구제','주사제','외용제','수액제','영양제','의약외품']
const STATS = ['사용','중지','휴면']
const PP = 20
const TYPES = ['입고','출고','반품','폐기']
const STORAGE_OPTS = ['실온','실온/차광','냉장','냉장/차광']
const REC_ACTIONS = ['','우선사용','재고이관','반품검토','폐기예정','약품변경','업체교환','사용중지','확인필요','긴급처리']
const IN_SUBS = ['정기입고','긴급입고','반품입고','이관입고','무상입고','기타']
const OUT_SUBS = ['처방출고','외래출고','이관출고','폐기출고','기타']
const RET_REASONS = ['유효기한만료','유효기한임박','약품변경','파손','품질불량','과잉재고','처방변경','기타']
const DSP_REASONS = ['유효기한만료','유효기한임박','변질/변색','약품변경','파손','품질불량','리콜','기타']
const TX_STATUS = ['처리완료','처리중','반려']
/* API 보관방법 텍스트 → 표준 드롭다운 값 변환 */
function stdStorage(raw) { if (!raw) return '실온'; const s = raw.toLowerCase(); if (s.includes('냉장') && s.includes('차광')) return '냉장/차광'; if (s.includes('냉장') || s.includes('냉동') || s.includes('2') || s.includes('8')) return '냉장'; if (s.includes('차광') || s.includes('빛') || s.includes('광선')) return '실온/차광'; return '실온' }

/* ── Backward-compat colors for DrugRegister ── */
const C = {
  purple:'#804A87', purpleL:'#F5EDF6', purpleB:'#D4A8DA', purpleD:'#5A2F63',
  green:'#019748', greenL:'#E6F7EE', greenB:'#7FD9A8', greenD:'#016033',
  coral:'#C05040', coralL:'#FEF1EE', coralB:'#F39E94',
  blue:'#2E4A62', blueL:'#EAF0F5', blueB:'#92C8E0',
  lavender:'#6A3A7A', lavL:'#F3EBF7',
  grayL:'#F5F5F5', grayB:'#D7D7D7',
}

/* ── Helpers ── */
function exS(d, t) { if (!d) return {}; const x = Math.floor((new Date(d) - new Date()) / 864e5); if (x <= 0) return { color: t.red, fontWeight: 700 }; if (x <= 30) return { color: t.red, fontWeight: 600 }; if (x <= 90) return { color: t.amber, fontWeight: 600 }; return { color: t.textM } }
function exD(d) { if (!d) return null; return Math.floor((new Date(d) - new Date()) / 864e5) }
function getNT(d) { if (d.narcotic_type === '향정' || d.narcotic_type === '마약') return d.narcotic_type; if (d.is_narcotic === true || d.is_narcotic === 'true') return '향정'; return '일반' }
function isN(d) { return getNT(d) !== '일반' }
function NT({ d }) { const { t } = useTheme(); const n = getNT(d); if (n === '일반') return null; const c = n === '마약' ? t.red : t.purple; return <span style={{ marginLeft: 4, background: n === '마약' ? t.redL : t.purpleL, color: c, fontSize: 9, padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>{n}</span> }
async function fetchAll() { let a = [], f = 0; while (true) { const { data, error } = await supabase.from('drugs').select('*').order('drug_name').range(f, f + 999); if (error || !data || !data.length) break; a = [...a, ...data]; if (data.length < 1000) break; f += 1000 }; return a }
async function searchDrugAPI(keyword, apiType = 'easy') {
  const maps = {
    easy: i => ({ name: i.itemName||'', efficacy: i.efcyQesitm||'', manufacturer: i.entpName||'', storage: i.depositMethodQesitm||'', usage: i.useMethodQesitm||'', warning: i.atpnWarnQesitm||'', sideEffect: i.seQesitm||'', image: i.itemImage||'', itemSeq: i.itemSeq||'' }),
    permit: i => { const raw=i.MAIN_ITEM_INGR||i.PRDUCT_NM||''; const isE=s=>s&&/^[a-zA-Z\s()\[\]\-,.:;0-9]+$/.test(s); const parts=raw.split(/[;；,，\/]/).map(s=>s.trim()).filter(Boolean); const en=parts.find(p=>isE(p))||''; const kr=parts.find(p=>!isE(p))||''; return { name:i.ITEM_NAME||'', manufacturer:i.ENTP_NAME||'', ingredient:raw, ingredientEn:en, ingredientKr:kr, storage:i.STORAGE_METHOD||'', unit:i.PACK_UNIT||'', insuranceCode:i.EDI_CODE||'', image:i.ITEM_IMAGE||'', packUnit:i.PACK_UNIT||'', route:i.INJC_PTH_NM||i.EE_DOC_DATA&&'', storageMethod:i.STORAGE_METHOD||'' } },
    ati: i => ({ name: i.ITEM_NAME||'', manufacturer: i.ENTP_NAME||'', ingredient: i.MAIN_ITEM_INGR||i.PRDUCT_NM||'', shape: i.DRUG_SHAPE||'', image: i.ITEM_IMAGE||'' }),
    identify: i => ({ name: i.ITEM_NAME||'', shape: i.DRUG_SHAPE||'', color: i.COLOR_CLASS1||'', mark: i.MARK_CODE_FRONT||'', image: i.ITEM_IMAGE||'', line: i.LINE_FRONT||'' }),
    dur: i => ({ name: i.ITEM_NAME||'', durType: i.DUR_SEQ||'', ingredient: i.INGR_NAME||'', manufacturer: i.ENTP_NAME||'', prohibit: i.PROHBT_CONTENT||'' }),
    maxDose: i => ({ name: i.ITEM_NAME||'', ingredient: i.INGR_NAME||'', maxDailyDose: i.DAILY_MAX_DOSG_QY||i.MAX_DAY_QTY||'', unit: i.DAILY_MAX_DOSG_QY_UNIT||i.MAX_DAY_QTY_UNIT||'' }),
    hira: i => ({ name: i.GNLNM_CD_NM||i.gnlnmCdNm||'', ingredient: i.CPNT_NM||i.cpntNm||'', manufacturer: '', permitNo: i.MEFT_DIV_NO||'', category: i.MEFT_DIV_NM||'' }),
  }
  const mapFn = maps[apiType] || maps.easy
  /* 통합 서버 프록시 호출 — /api/datago/{path}?{params} (serviceKey는 서버가 자동 첨부)
     로컬 dev: vite.config.js의 datagoDevProxy / 배포: netlify/functions/datago.js */
  const endpoints = {
    easy:     { path: '1471000/DrbEasyDrugInfoService/getDrbEasyDrugList',                 param: 'itemName'  },
    permit:   { path: '1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07',          param: 'item_name' },
    ati:      { path: '1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03',   param: 'item_name' },
    identify: { path: '1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03',   param: 'item_name' },
    dur:      { path: '1471000/DURPrdlstInfoService03/getDurPrdlstInfoList03',             param: 'itemName'  },
    maxDose:  { path: '1471000/DailyMaxDosgQyInfoService/getDailyMaxDosgQyList',           param: 'itemName'  },
    hira:     { path: 'B551182/msupCmpnMeftInfoService/getMajorCmpnNmCdList',              param: 'cmpnNm'    },
  }
  const ep = endpoints[apiType] || endpoints.easy
  try {
    const url = `/api/datago/${ep.path}?${ep.param}=${encodeURIComponent(keyword)}&type=json&numOfRows=15`
    const res = await fetch(url); const text = await res.text()
    try {
      const json = JSON.parse(text)
      if (json?.response?.header?.resultCode && json.response.header.resultCode !== '00') {
        return { ok: false, msg: `API 오류: ${json.response.header.resultMsg || json.response.header.resultCode}`, data: [] }
      }
      if (json?.ok === false) return { ok: false, msg: json.msg || 'API 오류', data: [] }
      const body = json?.body || json?.response?.body
      const items = body?.items?.item || body?.items || []
      return { ok: true, data: (Array.isArray(items) ? items : [items]).filter(i => i).map(mapFn) }
    } catch {
      if (text.includes('<returnAuthMsg>')) {
        const msgMatch = text.match(/<returnAuthMsg>([^<]*)</)
        return { ok: false, msg: `인증 오류: ${msgMatch?.[1] || 'API 키를 확인해 주세요'}`, data: [] }
      }
      if (text.includes('<errMsg>')) {
        const msgMatch = text.match(/<errMsg>([^<]*)</)
        return { ok: false, msg: `API 오류: ${msgMatch?.[1] || '알 수 없는 오류'}`, data: [] }
      }
      return { ok: false, msg: '응답 형식 오류 — 서버 환경변수(DATA_API_KEY) 또는 서비스 신청 상태를 확인해 주세요', data: [] }
    }
  } catch (e) { return { ok: false, msg: e.message === 'Failed to fetch' ? '서버 호출 실패 — dev 서버 재시작 필요 (Ctrl+C → npm run dev)' : e.message, data: [] } }
}

/* ── Sort Hook ── */
function useSort(ik = '', id = 'asc') {
  const [sk, s1] = useState(ik); const [sd, s2] = useState(id)
  return { sk, sd,
    hs(k) { if (sk === k) { if (sd === 'asc') s2('desc'); else { s1(''); s2('asc') } } else { s1(k); s2('asc') } },
    so(a) { if (!sk) return a; return [...a].sort((x, y) => { let va = x[sk] ?? '', vb = y[sk] ?? ''; if (typeof va === 'number' && typeof vb === 'number') return sd === 'asc' ? va - vb : vb - va; return sd === 'asc' ? String(va).localeCompare(String(vb), 'ko') : String(vb).localeCompare(String(va), 'ko') }) },
    SI({ col: c }) { const { t } = useTheme(); if (sk !== c) return <span style={{ color: t.textL, fontSize: 9, marginLeft: 3 }}>⇅</span>; return <span style={{ color: t.accent, fontSize: 9, marginLeft: 3 }}>{sd === 'asc' ? '▲' : '▼'}</span> },
    TS(c) { const { t } = useTheme(); return { padding: '10px 12px', textAlign: 'left', color: sk === c ? t.accent : t.textM, fontWeight: 600, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', background: sk === c ? t.accentL : 'transparent', fontSize: 11 } }
  }
}

/* ── UI Atoms ── */
function Bd({ children, bg, color }) { return <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>{children}</span> }
function SB({ s }) { const { t } = useTheme(); const m = { '사용': [t.greenL, t.green], '중지': ['#F0F0EB', t.textL], '휴면': [t.amberL, t.amber] }; const [b, c] = m[s] || ['#F0F0EB', t.textL]; return <Bd bg={b} color={c}>{s}</Bd> }
function Ft() { const { t } = useTheme(); return <div style={{ textAlign: 'center', padding: '20px 0 12px', fontSize: 11, color: t.textL, borderTop: `1px solid ${t.border}`, marginTop: 24, lineHeight: 1.6 }}>C O P Y R I G H T  ⓒ  2 0 2 6  J E O N G H W A   L E E<br />All rights reserved. 무단 전재 및 재배포 금지.</div> }
function Pg({ page: p, setPage: sp, tp, fl, pp }) { const { t } = useTheme(); if (tp <= 1) return null; const btn = dis => ({ padding: '5px 12px', borderRadius: 8, border: `1px solid ${t.border}`, cursor: dis ? 'not-allowed' : 'pointer', background: t.card, color: dis ? t.textL : t.text, fontWeight: 600, fontSize: 11, opacity: dis ? .4 : 1 }); return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: `1px solid ${t.border}` }}><span style={{ fontSize: 11, color: t.textM }}>{fl.length}개 중 {Math.min((p - 1) * pp + 1, fl.length)}–{Math.min(p * pp, fl.length)}</span><div style={{ display: 'flex', gap: 3 }}><button onClick={() => sp(x => x - 1)} disabled={p === 1} style={btn(p === 1)}>◀</button>{Array.from({ length: Math.min(5, tp) }, (_, i) => { const pg = Math.max(1, Math.min(p - 2, tp - 4)) + i; return <button key={pg} onClick={() => sp(pg)} style={{ ...btn(false), background: p === pg ? t.accent : t.card, color: p === pg ? '#fff' : t.text, border: `1px solid ${p === pg ? t.accent : t.border}` }}>{pg}</button> })}<button onClick={() => sp(x => x + 1)} disabled={p === tp} style={btn(p === tp)}>▶</button></div></div> }
function CN({ drug: d, onEdit }) { const { t } = useTheme(); return <td style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'left', color: t.accent, cursor: 'pointer' }} onClick={() => onEdit(d)} onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = t.purple }} onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = t.accent }}>{d.drug_name}</td> }

/* ★ MultiPill — 최종 */
function MP({ items, selected, onChange, color, label }) {
  const { t } = useTheme(); const allSel = selected.length === items.length
  function tog(item) { const n = selected.includes(item) ? selected.filter(x => x !== item) : [...selected, item]; onChange(n.length ? n : [...items]) }
  const on = { padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: color, color: '#fff', border: `1.5px solid ${color}`, transition: 'all .15s' }
  const off = { padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 500, background: 'transparent', color: t.textM, border: `1.5px solid ${t.border}`, transition: 'all .15s' }
  return <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
    {label && <span style={{ fontSize: 10, color: t.textL, fontWeight: 600, marginRight: 3 }}>{label}</span>}
    <button onClick={() => onChange(allSel ? [items[0]] : [...items])} style={allSel ? { ...on, background: t.text, borderColor: t.text } : off}>전체</button>
    {items.map(i => <button key={i} onClick={() => tog(i)} style={selected.includes(i) ? on : off}>{i}</button>)}
  </div>
}

/* ★ ColToggle — position:fixed로 부모 overflow 무시 */
function ColToggle({ cols, visible, setVisible }) {
  const { t } = useTheme(); const [open, setOpen] = useState(false); const btnRef = useRef(); const [pos, setPos] = useState({ top: 0, right: 0 })
  function toggle() { if (!open && btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 6, right: window.innerWidth - r.right }) }; setOpen(!open) }
  return <div style={{ position: 'relative' }}>
    <button ref={btnRef} onClick={toggle} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${open ? t.accent : t.border}`, background: open ? t.accentL : t.card, color: open ? t.accent : t.textM, cursor: 'pointer', fontSize: 11, fontWeight: 600, boxShadow: t.shadow }}>컬럼 ⚙</button>
    {open && <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
      <div style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999, background: t.cardSolid, border: `1px solid ${t.borderH}`, borderRadius: 12, padding: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', minWidth: 220, maxHeight: 350, overflowY: 'auto' }}>
        <div style={{ fontSize: 12, color: t.text, marginBottom: 10, fontWeight: 700 }}>표시할 컬럼 선택</div>
        {cols.map(c => <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', cursor: 'pointer', fontSize: 12, color: t.text }}>
          <input type="checkbox" checked={visible.includes(c.key)} onChange={() => { const n = visible.includes(c.key) ? visible.filter(x => x !== c.key) : [...visible, c.key]; setVisible(n.length ? n : cols.map(x => x.key)) }} style={{ accentColor: t.accent }} />{c.label}
        </label>)}
        <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 8, paddingTop: 8, display: 'flex', gap: 4 }}>
          <button onClick={() => setVisible(cols.map(x => x.key))} style={{ flex: 1, padding: '5px', borderRadius: 6, border: `1px solid ${t.border}`, background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>전체</button>
          <button onClick={() => setVisible(cols.filter(x => x.default).map(x => x.key))} style={{ flex: 1, padding: '5px', borderRadius: 6, border: `1px solid ${t.accent}`, background: t.accentL, color: t.accent, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>기본</button>
        </div>
      </div>
    </>}
  </div>
}

/* ═══ 약품 수정 모달 (드래그 가능) ═══ */
function DrugEditModal({ drug: dr, onClose, onSaved, onLotManage }) {
  const { t } = useTheme(); const oc = dr.drug_code || ''
  const [f, sF] = useState({ drug_code: oc, drug_name: dr.drug_name || '', category: dr.category || '', ingredient_en: dr.ingredient_en || '', ingredient_kr: dr.ingredient_kr || '', efficacy_class: dr.efficacy_class || '', efficacy: dr.efficacy || '', manufacturer: dr.manufacturer || '', specification: dr.specification || '', unit: dr.unit || '', price_unit: dr.price_unit || 0, insurance_price: dr.insurance_price || 0, insurance_code: dr.insurance_code || '', current_qty: dr.current_qty || 0, expiry_date: dr.expiry_date || '', status: dr.status || '사용', narcotic_type: getNT(dr), safety_stock: dr.safety_stock || 0, max_stock: dr.max_stock || 0, lot_no: dr.lot_no || '', insurance_type: dr.insurance_type || '급여', storage_method: dr.storage_method || '실온', storage_location: dr.storage_location || '', notes: dr.notes || '' })
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState(null); const [tab, setTab] = useState('basic'); const [apiLd, setApiLd] = useState(false)
  const [apiResults, setApiResults] = useState([])
  const [lookupInfo, setLookupInfo] = useState(null)
  const [pos, setPos] = useState({ x: 0, y: 0 }); const [dragging, setDragging] = useState(false); const dragRef = useRef(null)
  function set(k, v) { sF(p => ({ ...p, [k]: v })) }

  /* 드래그 핸들러 */
  function onDragStart(e) { if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return; setDragging(true); dragRef.current = { sx: e.clientX - pos.x, sy: e.clientY - pos.y } }
  useEffect(() => {
    if (!dragging) return
    function onMove(e) { setPos({ x: e.clientX - dragRef.current.sx, y: e.clientY - dragRef.current.sy }) }
    function onUp() { setDragging(false) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging])

  /* API 5종 조회 — 1차:허가정보 → 보조:e약은요+낱알식별+약가+성분약효 (신규등록과 동일 순서) */
  async function lookupApi(overrideName) {
    const searchName = overrideName || f.drug_name.trim()
    if (!searchName) { setMsg('약품명이 필요합니다'); return }
    setApiLd(true); setMsg(null); setApiResults([]); setLookupInfo(null)
    const px = new DOMParser()
    const nm = searchName
    const isEng = s => s && /^[a-zA-Z\s()\[\]\-,.:;0-9]+$/.test(s)
    const cleaned = nm.replace(/[\d]+[\s]*(mg|ml|g|mcg|밀리그램|밀리리터|그램|정|캡슐|주|병|앰플|밀리)/gi, '').trim()
    const short = nm.replace(/(정|캡슐|주사|시럽|현탁|산|과립|주|액|크림|연고|겔|패치|좌제).*$/,'').trim()
    const names = [...new Set([nm, cleaned, short].filter(s => s.length > 1))].slice(0, 3)
    console.log('수정모달 API 검색명:', names)
    /* ── 리스트 수집: 허가정보 1차 → e약은요 2차 ── */
    try {
      const listRes = await searchDrugAPI(nm, 'permit')
      if (listRes.ok && listRes.data?.length) {
        setApiResults(listRes.data.slice(0, 8))
      } else {
        const listRes2 = await searchDrugAPI(nm, 'easy')
        if (listRes2.ok && listRes2.data?.length) setApiResults(listRes2.data.slice(0, 8))
      }
    } catch {}
    let found = { permit: false, easy: false, identify: false, price: false, efficacy: false }
    let info = {}
    const tf = (url, ms=8000) => { const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),ms); return fetch(url,{signal:ctrl.signal}).finally(()=>clearTimeout(tid)) }
    try {
      /* ── 1차 소스: 허가정보 → 성분, 보관, 단위, 보험코드, 규격 ── */
      for (const n of names) {
        if (found.permit) break
        try {
          const r = await tf(`/api/datago/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07?item_name=${encodeURIComponent(n)}&type=json&numOfRows=3&pageNo=1`)
          const txt = await r.text()
          try { const j = JSON.parse(txt); const b = j?.body||j?.response?.body; const its = b?.items?.item||b?.items||[]; const arr = Array.isArray(its)?its:[its].filter(Boolean)
            console.log(`[1차] 허가정보 검색 [${n}]:`, arr.length, '건')
            if (arr.length > 0) { const h = arr[0]
              const mainIngr = h.MAIN_ITEM_INGR||''
              const ingrParts = mainIngr.split(/[;；,，\/]/).map(s=>s.trim()).filter(Boolean)
              const ingrEn = ingrParts.find(p=>isEng(p))||''
              const ingrKr = ingrParts.find(p=>!isEng(p))||''
              const parenKr = nm.match(/[(\（]([가-힣\s]+)[)\）]/)?.[1]||''
              info.storageMethod = h.STORAGE_METHOD||''
              info.packUnit = h.PACK_UNIT||''
              info.insuranceCode = h.EDI_CODE||''
              info.manufacturer = h.ENTP_NAME||''
              info.ingredientEn = ingrEn||(isEng(mainIngr)?mainIngr:'')
              info.ingredientKr = ingrKr||parenKr||(!isEng(mainIngr)&&mainIngr?mainIngr:'')
              sF(p => ({...p,
                storage_method: p.storage_method||(h.STORAGE_METHOD?stdStorage(h.STORAGE_METHOD):''),
                unit: h.PACK_UNIT||p.unit,
                specification: h.PACK_UNIT||p.specification,
                insurance_code: h.EDI_CODE||p.insurance_code,
                ingredient_kr: info.ingredientKr||p.ingredient_kr,
                ingredient_en: info.ingredientEn||p.ingredient_en,
              }))
              found.permit = true
            }
          } catch {}
        } catch {}
      }
      /* ── 보조①: e약은요 → 효능, 보관방법 ── */
      for (const n of names) {
        if (found.easy) break
        try {
          const r = await tf(`/api/datago/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?itemName=${encodeURIComponent(n)}&type=json&numOfRows=3&pageNo=1`)
          const txt = await r.text()
          try { const j = JSON.parse(txt); const b = j?.body||j?.response?.body; const its = b?.items?.item||b?.items||[]; const arr = Array.isArray(its)?its:[its].filter(Boolean)
            console.log(`[보조] e약은요 검색 [${n}]:`, arr.length, '건')
            if (arr.length > 0) { const e = arr[0]
              if(e.efcyQesitm) info.efficacy = e.efcyQesitm
              if(e.depositMethodQesitm&&!info.storageMethod) info.storageMethod = e.depositMethodQesitm
              sF(p => ({...p, efficacy: e.efcyQesitm||p.efficacy, storage_method: e.depositMethodQesitm?stdStorage(e.depositMethodQesitm):p.storage_method }))
              found.easy = true
            }
          } catch {}
        } catch {}
      }
      /* ── 보조②: 낱알식별 → 성상 ── */
      for (const n of names) {
        if (found.identify) break
        try {
          const r = await tf(`/api/datago/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03?item_name=${encodeURIComponent(n)}&type=json&numOfRows=3&pageNo=1`)
          const txt = await r.text()
          try { const j = JSON.parse(txt); const b = j?.body||j?.response?.body; const its = b?.items?.item||b?.items||[]; const arr = Array.isArray(its)?its:[its].filter(Boolean)
            console.log(`[보조] 낱알식별 검색 [${n}]:`, arr.length, '건')
            if (arr.length > 0) { const d = arr[0]
              info.drugAppearance = [d.DRUG_SHAPE,d.COLOR_CLASS1,d.MARK_CODE_FRONT].filter(Boolean).join(' / ')
              found.identify = true
            }
          } catch {}
        } catch {}
      }
      /* ── 보조③: 약가기준 → 단가, 급여구분, 성분명 ── */
      let gnlCd = ''
      for (const n of names) {
        if (found.price) break
        try {
          const r1 = await tf(`/api/datago/B551182/dgamtCrtrInfoService1.2/getDgamtList?numOfRows=5&pageNo=1&itmNm=${encodeURIComponent(n)}`)
          const t1 = await r1.text(); const x1 = px.parseFromString(t1, 'text/xml'); const i1 = x1.querySelectorAll('item')
          console.log(`[보조] 약가 검색 [${n}]:`, i1.length, '건')
          if (i1.length > 0) {
            const a = {}; i1[0].childNodes.forEach(nd => { if (nd.nodeName !== '#text') a[nd.nodeName] = nd.textContent })
            gnlCd = a.gnlNmCd || ''
            const price = Number(a.uplmtAmt||0) || Number(a.amt||0) || Number(a.drugPrc||0) || 0
            const rawKr=a.gnlNmCdNm||a.cpntNm||'', rawEn=a.gnlNmCdEngNm||''
            info.upperPrice = a.uplmtAmt||a.amt||''
            info.insuranceType = a.payTpNm||''
            info.productCode = info.insuranceCode||a.mdsCd||''
            if(!info.ingredientKr&&rawKr&&!isEng(rawKr)) info.ingredientKr=rawKr
            if(!info.ingredientEn&&rawEn) info.ingredientEn=rawEn
            if(!info.manufacturer&&(a.mnfEntpNm||a.entpNm)) info.manufacturer=a.mnfEntpNm||a.entpNm
            sF(p => ({ ...p,
              ingredient_kr: isEng(rawKr)?(rawEn||p.ingredient_kr):(rawKr||p.ingredient_kr),
              ingredient_en: isEng(rawKr)?(rawKr||p.ingredient_en):(rawEn||p.ingredient_en),
              insurance_price: price || p.insurance_price,
              price_unit: price || p.price_unit,
              insurance_type: (a.payTpNm||'').includes('급여')?'급여':(a.payTpNm||'').includes('비급여')?'비급여':p.insurance_type,
              insurance_code: p.insurance_code||a.mdsCd||'',
            }))
            found.price = true
          }
        } catch {}
      }
      /* ── 보조④: 성분약효 → 약효분류 ── */
      if (gnlCd) {
        try {
          const r2 = await tf(`/api/datago/B551182/msupCmpnMeftInfoService/getMajorCmpnNmCdList?numOfRows=5&pageNo=1&gnlNmCd=${encodeURIComponent(gnlCd)}`)
          const t2 = await r2.text(); const x2 = px.parseFromString(t2, 'text/xml'); const i2 = x2.querySelectorAll('item')
          console.log(`[보조] 성분약효 검색 [${gnlCd}]:`, i2.length, '건')
          if (i2.length > 0) { const it = i2[0]; const g = tag => it.querySelector(tag)?.textContent || ''
            info.efficacyClass = g('divNm')
            info.efficacyCode = g('meftDivNo')
            info.dosage = g('iqtyTxt')
            info.dosageUnit = g('unit')
            info.efficacyRoute = g('injcPthCdNm')
            info.gnlNmCode = g('gnlNmCd')
            sF(p => ({ ...p, efficacy_class: g('divNm') || p.efficacy_class, unit: p.unit||g('unit')||'' }))
            found.efficacy = true
          }
        } catch {}
      }
      const cnt = Object.values(found).filter(Boolean).length
      setMsg(cnt === 5 ? 'OK' : `${cnt}/5 API 조회 완료`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setMsg('API 오류: ' + e.message) }
    setLookupInfo(Object.keys(info).length>0?info:null)
    /* 최종 성분명 언어 검증: 영어/한글 뒤바뀜 자동 교정 */
    sF(p => {
      let en = info.ingredientEn||p.ingredient_en, kr = info.ingredientKr||p.ingredient_kr
      const chk = s => s && /^[a-zA-Z\s()\[\]\-,.:;0-9]+$/.test(s)
      if (en && !chk(en) && kr && chk(kr)) { const tmp=en; en=kr; kr=tmp }
      else if (en && !chk(en) && !kr) { kr=en; en='' }
      else if (kr && chk(kr) && !en) { en=kr; kr='' }
      return {...p, ingredient_en:en, ingredient_kr:kr}
    })
    setApiLd(false)
  }

  /* 리스트에서 다른 약품 선택 → 약품명 교체 후 재조회 */
  function selectApiResult(item) {
    const parenKr2=(item.name||'').match(/[(\（]([가-힣\s]+)[)\）]/)?.[1]||''
    if (item.name) sF(p => ({ ...p, drug_name: item.name, manufacturer: item.manufacturer || p.manufacturer, efficacy: item.efficacy || p.efficacy, storage_method: item.storage ? stdStorage(item.storage) : p.storage_method, unit: item.unit || p.unit, insurance_code: item.insuranceCode || p.insurance_code, ingredient_en: item.ingredientEn || p.ingredient_en, ingredient_kr: item.ingredientKr || parenKr2 || p.ingredient_kr }))
    setApiResults([])
    lookupApi(item.name)
  }

  async function save() {
    if (!f.drug_name.trim()) { setMsg('약품명 필수'); return }
    setSaving(true); setMsg(null)
    const ud = { drug_name: f.drug_name, category: f.category, ingredient_kr: f.ingredient_kr, manufacturer: f.manufacturer, price_unit: Number(f.price_unit) || 0, current_qty: Number(f.current_qty) || 0, expiry_date: f.expiry_date || null, status: f.status, is_narcotic: f.narcotic_type !== '일반' }
    if (f.drug_code.trim() !== oc) ud.drug_code = f.drug_code.trim()
    const ts = (k, v) => { ud[k] = v }
    ;['narcotic_type', 'lot_no', 'insurance_type', 'insurance_code', 'ingredient_en', 'efficacy', 'efficacy_class', 'specification', 'unit', 'storage_method', 'storage_location', 'notes'].forEach(k => ts(k, f[k]))
    ;['safety_stock', 'max_stock', 'insurance_price'].forEach(k => ts(k, Number(f[k]) || 0))
    let res = dr.id ? await supabase.from('drugs').update(ud).eq('id', dr.id) : await supabase.from('drugs').update(ud).eq('drug_code', oc)
    /* 누락 컬럼 자동 제거 후 재시도 (최대 3회) */
    for(let retry=0;retry<3&&res.error&&res.error.message.includes('column');retry++){
      const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete ud[m[1]];console.log('누락 컬럼 제거:',m[1])
      res=dr.id?await supabase.from('drugs').update(ud).eq('id',dr.id):await supabase.from('drugs').update(ud).eq('drug_code',oc)
    }
    setSaving(false)
    if (res.error) { setMsg(res.error.message); return }
    setMsg('OK'); setTimeout(() => { onSaved?.(); onClose() }, 500)
  }

  const ip = { width: '100%', padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }
  const lb = { fontSize: 10, color: t.textM, marginBottom: 4, display: 'block', fontWeight: 600 }; const cc = f.drug_code.trim() !== oc
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
    <div style={{ background: t.cardSolid, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${t.border}`, boxShadow: t.shadowH, transform: `translate(${pos.x}px, ${pos.y}px)` }} onClick={e => e.stopPropagation()}>
      <div onMouseDown={onDragStart} style={{ padding: '18px 24px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}>
        <div><div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>약품 정보 수정</div><div style={{ fontSize: 11, color: t.textM, marginTop: 2 }}>코드: {oc} · 드래그하여 이동</div></div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><button onClick={lookupApi} disabled={apiLd} style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${t.green}`, background: t.greenL, color: t.green, cursor: apiLd ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>{apiLd ? '조회중...' : '🔍 API 조회'}</button><button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', cursor: 'pointer', fontSize: 16, color: t.textM }}>✕</button></div>
      </div>
      <div style={{ padding: '16px 24px 20px' }}>
        {msg && <div style={{ background: msg === 'OK' ? t.greenL : t.redL, borderRadius: 8, padding: '10px', marginBottom: 12, color: msg === 'OK' ? t.green : t.red, fontSize: 13, fontWeight: 600 }}>{msg === 'OK' ? '✅ API 조회 완료!' : msg}</div>}
        {apiResults.length>0&&<div style={{background:t.bg,borderRadius:10,border:`1px solid ${t.green}40`,marginBottom:12,overflow:'hidden'}}>
          <div style={{padding:'8px 14px',borderBottom:`1px solid ${t.border}`,fontSize:11,color:t.green,fontWeight:600}}>{apiResults.length}개 결과 · 다른 약품을 선택하려면 클릭하세요</div>
          <div style={{maxHeight:140,overflowY:'auto'}}>{apiResults.map((item,i)=><div key={i} onClick={()=>selectApiResult(item)} style={{padding:'8px 14px',borderBottom:`1px solid ${t.border}`,cursor:'pointer',fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background=t.greenL} onMouseLeave={e=>e.currentTarget.style.background=''}><div style={{fontWeight:600,color:t.text}}>{item.name||'-'}</div><div style={{fontSize:10,color:t.textL,marginTop:1}}>{item.manufacturer||''}{item.ingredient?` · ${item.ingredient}`:''}</div></div>)}</div>
        </div>}
        {/* API 조회 결과 카드 (신규등록 priceInfo와 동일) */}
        {apiLd&&<div style={{padding:'10px 14px',background:t.purpleL,borderRadius:8,marginBottom:12,fontSize:12,color:t.purple}}>💊 약가·약효 정보 조회 중...</div>}
        {lookupInfo&&<div style={{marginBottom:12,background:t.bg,borderRadius:10,border:`1px solid ${t.purple}40`,padding:'14px 18px'}}>
          <div style={{fontSize:13,fontWeight:700,color:t.purple,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${t.border}`}}>💊 약가기준정보 + 성분약효정보 (심평원)</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:12}}>
            {lookupInfo.insuranceType&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>급여구분</span><div style={{fontWeight:600,color:lookupInfo.insuranceType.includes('삭제')?t.red:lookupInfo.insuranceType.includes('급여')?t.green:t.red,cursor:'text',userSelect:'text'}}>{lookupInfo.insuranceType}</div></div>}
            {lookupInfo.ingredientEn&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>성분명(영문)</span><div style={{fontWeight:500,fontStyle:'italic',fontSize:11,cursor:'text',userSelect:'text'}}>{lookupInfo.ingredientEn}</div></div>}
            {lookupInfo.ingredientKr&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>성분명(한글)</span><div style={{fontWeight:500,cursor:'text',userSelect:'text'}}>{lookupInfo.ingredientKr}</div></div>}
            {lookupInfo.drugAppearance&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>성상</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.drugAppearance}</div></div>}
            {lookupInfo.dosage&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>함량</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.dosage}{lookupInfo.dosageUnit?' '+lookupInfo.dosageUnit:''}</div></div>}
            {lookupInfo.manufacturer&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>제조사</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.manufacturer}</div></div>}
            {lookupInfo.upperPrice&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>상한가</span><div style={{fontWeight:700,color:t.green,fontSize:14,cursor:'text',userSelect:'text'}}>₩{Number(lookupInfo.upperPrice).toLocaleString()}</div></div>}
            {lookupInfo.efficacyRoute&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>투여경로</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.efficacyRoute}</div></div>}
            {lookupInfo.productCode&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>제품코드</span><div style={{fontFamily:'monospace',fontSize:11,cursor:'text',userSelect:'text'}}>{lookupInfo.productCode}</div></div>}
            {lookupInfo.storageMethod&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>보관방법</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.storageMethod}</div></div>}
            {lookupInfo.packUnit&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>포장단위</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.packUnit}</div></div>}
            {lookupInfo.dosageUnit&&<div style={{padding:'4px 0'}}><span style={{color:t.textL,fontSize:10}}>단위</span><div style={{cursor:'text',userSelect:'text'}}>{lookupInfo.dosageUnit}</div></div>}
          </div>
          {lookupInfo.efficacyClass?<div style={{marginTop:10,padding:'10px 14px',background:t.purpleL,borderRadius:8,border:`1px solid ${t.purple}30`}}>
            <div style={{fontSize:11,color:t.textL,marginBottom:4}}>약효분류</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{background:t.purple,color:'#fff',padding:'2px 10px',borderRadius:12,fontSize:12,fontWeight:700,cursor:'text',userSelect:'text'}}>{lookupInfo.efficacyClass}</span>
              {lookupInfo.efficacyCode&&<span style={{fontSize:11,color:t.textL}}>분류번호: {lookupInfo.efficacyCode}</span>}
            </div>
            {lookupInfo.gnlNmCode&&<div style={{marginTop:6,fontSize:11,color:t.textL,cursor:'text',userSelect:'text'}}>일반명코드: {lookupInfo.gnlNmCode}</div>}
          </div>:lookupInfo.ingredientEn?<div style={{marginTop:10,padding:'8px 14px',background:t.amberL,borderRadius:8,fontSize:11,color:t.amber}}>약효분류: 해당 성분의 약효분류 데이터를 찾을 수 없습니다</div>:null}
          <div style={{marginTop:8,fontSize:9,color:t.textL,textAlign:'right'}}>각 항목을 드래그하여 복사할 수 있습니다</div>
        </div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>약품코드</label><input value={f.drug_code} onChange={e => set('drug_code', e.target.value)} style={{ ...ip, borderColor: cc ? t.amber : t.border }} />{cc && <div style={{ fontSize: 10, color: t.amber, marginTop: 2 }}>⚠ {oc} → {f.drug_code.trim()}</div>}</div><div><label style={lb}>약품명 *</label><input value={f.drug_name} onChange={e => set('drug_name', e.target.value)} onKeyDown={e=>e.key==='Enter'&&lookupApi()} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>구분</label><select value={f.category} onChange={e => set('category', e.target.value)} style={ip}>{CATS.map(c => <option key={c}>{c}</option>)}</select></div><div><label style={lb}>상태</label><select value={f.status} onChange={e => set('status', e.target.value)} style={ip}>{STATS.map(s => <option key={s}>{s}</option>)}</select></div><div><label style={lb}>급여구분</label><div style={{ display: 'flex', gap: 4 }}>{['급여', '비급여'].map(x => <button key={x} onClick={() => set('insurance_type', x)} style={{ flex: 1, padding: '8px', borderRadius: 6, border: `1px solid ${f.insurance_type === x ? t.blue : t.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: f.insurance_type === x ? t.blueL : 'transparent', color: f.insurance_type === x ? t.blue : t.textL }}>{x}</button>)}</div></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>성분명(영어)</label><input value={f.ingredient_en} onChange={e => set('ingredient_en', e.target.value)} style={ip} /></div><div><label style={lb}>성분명(한글)</label><input value={f.ingredient_kr} onChange={e => set('ingredient_kr', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>약효분류명</label><input value={f.efficacy_class} onChange={e => set('efficacy_class', e.target.value)} style={ip} /></div><div><label style={lb}>제조사</label><input value={f.manufacturer} onChange={e => set('manufacturer', e.target.value)} style={ip} /></div></div>
          <div style={{ marginBottom: 10 }}><label style={lb}>효능</label><input value={f.efficacy} onChange={e => set('efficacy', e.target.value)} placeholder="API 조회 시 자동입력" style={ip} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>규격</label><input value={f.specification} onChange={e => set('specification', e.target.value)} placeholder="포장단위 (API 자동입력)" style={ip} /></div><div><label style={lb}>단위</label><input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder={f.unit||'API 조회 시 자동입력'} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>EDI단가</label><input type="number" value={f.insurance_price} onChange={e => set('insurance_price', e.target.value)} style={ip} /></div><div><label style={lb}>보험코드</label><input value={f.insurance_code} onChange={e => set('insurance_code', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>현재고</label><input type="number" value={f.current_qty} onChange={e => set('current_qty', e.target.value)} style={ip} /></div><div><label style={lb}>안전재고</label><input type="number" value={f.safety_stock} onChange={e => set('safety_stock', e.target.value)} style={ip} /></div><div><label style={lb}>최대재고</label><input type="number" value={f.max_stock} onChange={e => set('max_stock', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>유효기한 (대표)</label><input type="date" value={f.expiry_date} onChange={e => set('expiry_date', e.target.value)} style={ip} /></div><div><label style={lb}>LOT번호 · 다중 유효기한</label><div style={{ display: 'flex', gap: 4 }}><input value={f.lot_no} onChange={e => set('lot_no', e.target.value)} placeholder="대표 LOT" style={{ ...ip, flex: 1 }} /><button onClick={() => onLotManage?.(dr)} style={{ padding: '0 14px', borderRadius: 6, border: `1px solid ${t.purple}`, background: t.purpleL, color: t.purple, cursor: 'pointer', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>LOT관리 →</button></div></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>보관방법</label><select value={f.storage_method} onChange={e => set('storage_method', e.target.value)} style={ip}>{STORAGE_OPTS.map(s=><option key={s}>{s}</option>)}</select></div><div><label style={lb}>보관위치</label><input value={f.storage_location} onChange={e => set('storage_location', e.target.value)} style={ip} /></div></div>
          <div style={{ marginBottom: 10 }}><label style={lb}>비고</label><textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...ip, resize: 'vertical' }} /></div>
          <div><label style={lb}>향정·마약</label><div style={{ display: 'flex', gap: 4 }}>{['일반', '향정', '마약'].map(x => { const a = f.narcotic_type === x, cl = x === '일반' ? t.green : x === '향정' ? t.purple : t.red; return <button key={x} onClick={() => set('narcotic_type', x)} style={{ flex: 1, padding: '8px', borderRadius: 6, border: `1px solid ${a ? cl : t.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: a ? cl + '18' : 'transparent', color: a ? cl : t.textL }}>{x}</button> })}</div></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 8, border: `1px solid ${t.border}`, cursor: 'pointer', background: 'transparent', color: t.textM, fontSize: 13, fontWeight: 600 }}>취소</button><button onClick={save} disabled={saving} style={{ flex: 2, padding: 11, borderRadius: 8, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: saving ? t.textL : t.accent, color: '#fff', fontSize: 13, fontWeight: 700 }}>{saving ? '저장 중...' : '저장'}</button></div>
      </div>
    </div>
  </div>
}

/* ═══ 재고 보정 모달 — 거래기록 없이 수량만 보정, 보정이력은 drugs 테이블에 기록 ═══ */
function AdjustModal({ drug: dr, onClose, onSaved }) {
  const { t } = useTheme(); const [qty, setQty] = useState(dr.current_qty || 0); const [reason, setReason] = useState('실사 결과 반영'); const [saving, setSaving] = useState(false); const [msg, setMsg] = useState(null); const diff = qty - (dr.current_qty || 0)
  async function save() { if (!reason.trim()) { setMsg('사유 필수'); return }; setSaving(true)
    const ud = { current_qty: Number(qty), last_adjusted_date: new Date().toISOString().split('T')[0], last_adjusted_qty: diff, last_adjusted_reason: `${reason} (${diff > 0 ? '+' : ''}${diff})` }
    let res = await supabase.from('drugs').update(ud).eq('drug_code', dr.drug_code)
    for(let r=0;r<3&&res.error&&res.error.message?.includes('column');r++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete ud[m[1]];res=await supabase.from('drugs').update(ud).eq('drug_code',dr.drug_code)}
    setSaving(false)
    if(res.error){setMsg(res.error.message);return}
    setMsg('OK'); setTimeout(() => { onSaved?.(); onClose() }, 500) }
  const ip = { width: '100%', padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
    <div style={{ background: t.cardSolid, borderRadius: 16, width: '100%', maxWidth: 420, border: `1px solid ${t.border}`, boxShadow: t.shadowH }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}` }}><div style={{ fontSize: 15, fontWeight: 700, color: t.amber }}>재고 보정</div><div style={{ fontSize: 12, color: t.textM, marginTop: 2 }}>{dr.drug_name}</div></div>
      <div style={{ padding: '16px 20px' }}>
        {msg && <div style={{ background: msg === 'OK' ? t.greenL : t.redL, borderRadius: 8, padding: '8px 12px', marginBottom: 10, color: msg === 'OK' ? t.green : t.red, fontSize: 12, fontWeight: 600 }}>{msg === 'OK' ? '보정 완료' : msg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div style={{ background: t.bg, borderRadius: 10, padding: '12px', textAlign: 'center', border: `1px solid ${t.border}` }}><div style={{ fontSize: 10, color: t.textM }}>서류재고</div><div style={{ fontSize: 22, fontWeight: 700, color: t.text, marginTop: 4 }}>{(dr.current_qty || 0).toLocaleString()}</div></div>
          <div style={{ background: t.bg, borderRadius: 10, padding: '12px', textAlign: 'center', border: `1px solid ${diff !== 0 ? t.amber : t.border}` }}><div style={{ fontSize: 10, color: t.textM }}>실재고</div><input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} style={{ width: '100%', textAlign: 'center', fontSize: 22, fontWeight: 700, border: 'none', background: 'transparent', color: t.text, outline: 'none', marginTop: 4 }} /></div>
        </div>
        {diff !== 0 && <div style={{ background: diff > 0 ? t.greenL : t.redL, borderRadius: 8, padding: '10px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600 }}><span style={{ color: diff > 0 ? t.green : t.red }}>차이: {diff > 0 ? '+' : ''}{diff}</span><span style={{ color: t.textM }}>수량 보정</span></div>}
        <div style={{ marginBottom: 14 }}><label style={{ fontSize: 10, color: t.textM, display: 'block', marginBottom: 4 }}>보정 사유 *</label><select value={reason} onChange={e => setReason(e.target.value)} style={ip}><option>실사 결과 반영</option><option>전산 오류 수정</option><option>파손/분실 확인</option><option>이관 수량 반영</option><option>기타</option></select></div>
        <div style={{ background: t.blueL, borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 11, color: t.blue }}>ℹ 보정은 입출고 거래 기록 없이 수량만 조정합니다. 이전 달 마감 데이터에 영향을 주지 않습니다.</div>
        {dr.last_adjusted_date && <div style={{ fontSize: 10, color: t.textL, marginBottom: 10 }}>최근 보정: {dr.last_adjusted_date} · {dr.last_adjusted_reason}</div>}
        <div style={{ display: 'flex', gap: 8 }}><button onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, cursor: 'pointer', background: 'transparent', color: t.textM, fontSize: 13 }}>취소</button><button onClick={save} disabled={saving || diff === 0} style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', cursor: saving || diff === 0 ? 'not-allowed' : 'pointer', background: saving || diff === 0 ? t.textL : t.amber, color: '#fff', fontSize: 13, fontWeight: 700 }}>{saving ? '...' : '보정 적용'}</button></div>
      </div>
    </div>
  </div>
}

/* ═══ LOT 관리 모달 ═══ */
function LotModal({ drug: dr, onClose, onSaved }) {
  const { t } = useTheme(); const [lots, setLots] = useState([]); const [ld, setLd] = useState(true); const [msg, setMsg] = useState(null)
  const [nf, setNf] = useState({ lot_no: '', expiry_date: '', quantity: '', supplier: '', memo: '' })
  useEffect(() => { loadLots() }, [])
  async function loadLots() { setLd(true); const { data } = await supabase.from('drug_lots').select('*').eq('drug_code', dr.drug_code).order('expiry_date'); setLots(data || []); setLd(false) }
  async function addLot() { if (!nf.lot_no.trim() || !nf.expiry_date) { setMsg('LOT번호와 유효기한 필수'); return }; const { error } = await supabase.from('drug_lots').insert([{ drug_code: dr.drug_code, lot_no: nf.lot_no.trim(), expiry_date: nf.expiry_date, quantity: Number(nf.quantity) || 0, supplier: nf.supplier, memo: nf.memo, received_date: new Date().toISOString().split('T')[0] }]); if (error) { setMsg(error.message); return }; setMsg('추가 완료'); setNf({ lot_no: '', expiry_date: '', quantity: '', supplier: '', memo: '' }); loadLots(); onSaved?.(); setTimeout(() => setMsg(null), 2000) }
  async function delLot(id) { await supabase.from('drug_lots').delete().eq('id', id); loadLots(); onSaved?.() }
  async function toggleActive(lot) { await supabase.from('drug_lots').update({ is_active: !lot.is_active }).eq('id', lot.id); loadLots() }
  const totalQty = lots.filter(l => l.is_active).reduce((a, l) => a + (l.quantity || 0), 0)
  const ip = { width: '100%', padding: '8px 10px', border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
    <div style={{ background: t.cardSolid, borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${t.border}`, boxShadow: t.shadowH }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><div style={{ fontSize: 15, fontWeight: 700, color: t.blue }}>LOT 관리</div><div style={{ fontSize: 11, color: t.textM, marginTop: 2 }}>{dr.drug_name} ({dr.drug_code})</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 12, color: t.green, fontWeight: 600 }}>활성합계: {totalQty}개</span><button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', cursor: 'pointer', fontSize: 14, color: t.textM }}>✕</button></div>
      </div>
      <div style={{ padding: '16px 20px' }}>
        {msg && <div style={{ background: msg.includes('완료') ? t.greenL : t.redL, borderRadius: 6, padding: '8px 12px', marginBottom: 10, color: msg.includes('완료') ? t.green : t.red, fontSize: 12, fontWeight: 600 }}>{msg}</div>}
        <div style={{ background: t.bg, borderRadius: 10, padding: '14px', marginBottom: 14, border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>새 LOT 추가</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={{ fontSize: 10, color: t.textM, display: 'block', marginBottom: 3 }}>LOT번호 *</label><input value={nf.lot_no} onChange={e => setNf(p => ({ ...p, lot_no: e.target.value }))} style={ip} /></div>
            <div><label style={{ fontSize: 10, color: t.textM, display: 'block', marginBottom: 3 }}>유효기한 *</label><input type="date" value={nf.expiry_date} onChange={e => setNf(p => ({ ...p, expiry_date: e.target.value }))} style={ip} /></div>
            <div><label style={{ fontSize: 10, color: t.textM, display: 'block', marginBottom: 3 }}>수량</label><input type="number" value={nf.quantity} onChange={e => setNf(p => ({ ...p, quantity: e.target.value }))} style={ip} /></div>
          </div>
          <button onClick={addLot} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: t.blue, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>LOT 추가</button>
        </div>
        {ld ? <div style={{ textAlign: 'center', padding: 20, color: t.textL }}>로딩...</div> : !lots.length ? <div style={{ textAlign: 'center', padding: 20, color: t.textL, fontSize: 12 }}>등록된 LOT 없음</div> : <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: t.bg }}>{['LOT번호', '유효기한', '수량', 'D-day', '상태', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: t.textM, fontWeight: 600, fontSize: 11 }}>{h}</th>)}</tr></thead><tbody>{lots.map(l => { const days = exD(l.expiry_date); return <tr key={l.id} style={{ borderTop: `1px solid ${t.border}`, opacity: l.is_active ? 1 : .5 }}><td style={{ padding: '8px 10px', fontWeight: 600 }}>{l.lot_no}</td><td style={{ padding: '8px 10px', ...exS(l.expiry_date, t) }}>{l.expiry_date}</td><td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{l.quantity?.toLocaleString()}</td><td style={{ padding: '8px 10px' }}>{days !== null ? <span style={{ fontSize: 10, color: days <= 30 ? t.red : days <= 90 ? t.amber : t.green, fontWeight: 600 }}>D{days <= 0 ? days : '-' + days}</span> : '-'}</td><td style={{ padding: '8px 10px' }}><button onClick={() => toggleActive(l)} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${l.is_active ? t.green : t.textL}`, background: l.is_active ? t.greenL : 'transparent', color: l.is_active ? t.green : t.textL, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>{l.is_active ? '활성' : '비활성'}</button></td><td style={{ padding: '8px 10px' }}><button onClick={() => delLot(l.id)} style={{ padding: '2px 6px', borderRadius: 4, border: `1px solid ${t.red}`, background: 'transparent', color: t.red, cursor: 'pointer', fontSize: 9 }}>삭제</button></td></tr> })}</tbody></table></div>}
      </div>
    </div>
  </div>
}

/* ═══ 헤더 — 반응형 (모바일 햄버거) ═══ */
function Header({ menu: m, setMenu: sm }) {
  const { t, dark, toggle, user, profile, logout } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const ms = [{ id: 'dashboard', l: '대시보드' }, { id: 'druglist', l: '약품목록' }, { id: 'expiry', l: '유효기한' }, { id: 'stock', l: '재고현황' }, { id: 'narcotic', l: '향정마약' }, { id: 'nonins', l: '비보험' }, { id: 'transaction', l: '입출고' }, { id: 'report', l: '보고서' }]
  function nav(id) { sm(id); setMobileOpen(false) }
  const displayName = profile?.full_name || user?.email?.split('@')[0] || ''
  const isAdmin = profile?.role === 'admin'
  return <>
    <div className="no-print cnc-header" style={{ background: t.nav, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, position: 'sticky', top: 0, zIndex: 900 }}>
      <div className="brand-area" style={{ cursor: 'pointer', flex: '0 0 auto' }} onClick={() => nav('dashboard')}>
        <div onClick={e => { e.stopPropagation(); nav('register') }} className="cnc-plus" style={{ width: 34, height: 34, borderRadius: 9, background: m === 'register' ? 'rgba(128, 74, 135, 0.85)' : 'rgba(128, 74, 135, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, cursor: 'pointer', color: '#BFA6D9', border: '1px solid rgba(128, 74, 135, 0.7)', flexShrink: 0, transition: 'background 0.15s', boxShadow: '0 2px 6px rgba(0,0,0,0.18)' }} title="신규 약품 등록">+</div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="brand-title cnc-title" style={{ fontSize: 17, color: '#ffffff', letterSpacing: 0.3, lineHeight: 1.15, fontWeight: 700 }}>약플로 · <span style={{ color: '#BFA6D9' }}>Yakflo</span></div>
          <div className="brand-sub" style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: 0.2, lineHeight: 1.2 }}>약품 통합 관리 솔루션</div>
        </div>
      </div>
      <div className="cnc-nav-desktop" style={{ display: 'flex', gap: 2, flex: '1 1 auto', justifyContent: 'center' }}>{ms.map(x => <button key={x.id} onClick={() => nav(x.id)} style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: m === x.id ? 700 : 400, background: m === x.id ? t.navHi + '22' : 'transparent', color: m === x.id ? t.navHi : 'rgba(255,255,255,0.55)', border: m === x.id ? `1px solid ${t.navHi}40` : '1px solid transparent', transition: 'all .15s' }}>{x.l}</button>)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
        <button onClick={() => nav('mypage')} title="마이페이지" className="cnc-date" style={{ padding: '4px 10px', borderRadius: 6, border: m === 'mypage' ? `1px solid ${t.navHi}60` : '1px solid rgba(255,255,255,0.10)', background: m === 'mypage' ? t.navHi + '22' : 'rgba(255,255,255,0.04)', color: m === 'mypage' ? t.navHi : 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 11, fontWeight: 500, transition: 'all .15s' }}>{displayName}</button>
        {isAdmin && <button onClick={() => nav('admin')} title="가입자 관리" style={{ padding: '4px 10px', borderRadius: 6, border: m === 'admin' ? `1px solid ${t.navHi}60` : '1px solid rgba(255,255,255,0.15)', background: m === 'admin' ? t.navHi + '22' : 'rgba(255,255,255,0.04)', color: m === 'admin' ? t.navHi : 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>관리</button>}
        <button onClick={logout} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 10, fontWeight: 500 }}>로그아웃</button>
        <button onClick={toggle} style={{ width: 38, height: 20, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: dark ? t.navHi + '30' : 'rgba(255,255,255,0.08)', cursor: 'pointer', position: 'relative', padding: 0 }}><div style={{ width: 16, height: 16, borderRadius: 8, background: dark ? t.navHi : 'rgba(255,255,255,0.4)', position: 'absolute', top: 1, left: dark ? 19 : 1, transition: 'all .2s' }} /></button>
        <button className="cnc-hamburger" onClick={() => setMobileOpen(!mobileOpen)} style={{ display: 'none', width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: mobileOpen ? t.navHi + '20' : 'transparent', cursor: 'pointer', color: t.navText, fontSize: 18, alignItems: 'center', justifyContent: 'center' }}>{mobileOpen ? '✕' : '☰'}</button>
      </div>
    </div>
    {mobileOpen && <div className="cnc-nav-mobile no-print" style={{ position: 'fixed', top: 56, left: 0, right: 0, bottom: 0, zIndex: 899 }} onClick={() => setMobileOpen(false)}>
      <div style={{ background: t.nav, borderBottom: `2px solid ${t.navHi}40`, padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 2 }} onClick={e => e.stopPropagation()}>
        {ms.map(x => <button key={x.id} onClick={() => nav(x.id)} style={{ padding: '12px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: m === x.id ? 700 : 400, background: m === x.id ? t.navHi + '22' : 'transparent', color: m === x.id ? t.navHi : 'rgba(255,255,255,0.65)', border: 'none', textAlign: 'left' }}>{x.l}</button>)}
        <button onClick={() => nav('register')} style={{ padding: '12px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: m === 'register' ? 700 : 400, background: m === 'register' ? t.navHi + '22' : 'transparent', color: t.navHi, border: `1px solid ${t.navHi}40`, textAlign: 'left', marginTop: 4 }}>+ 신규 등록</button>
      </div>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} />
    </div>}
  </>
}

/* ═══ 대시보드 — Bento Grid ═══ */
function Dashboard({ drugs, inv, txns, onNav, onEdit }) {
  const { t } = useTheme(); const { hs, so, SI, TS } = useSort('drug_name')
  const today = new Date(), fmt = d => d.toISOString().split('T')[0], ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`, d30 = new Date(today), d90 = new Date(today); d30.setDate(d30.getDate() + 30); d90.setDate(d90.getDate() + 90)
  const active = drugs.filter(d => d.status === '사용')
  const s = { total: drugs.length, active: active.length, stopped: drugs.filter(d => d.status === '중지').length, dormant: drugs.filter(d => d.status === '휴면').length, narc: drugs.filter(d => isN(d)).length, nonIns: drugs.filter(d => d.insurance_type === '비보험' && d.status === '사용').length, shortage: inv.filter(d => d.stock_status === '부족').length, e30: drugs.filter(d => d.expiry_date && d.expiry_date <= fmt(d30) && d.status === '사용').length, e90: drugs.filter(d => d.expiry_date && d.expiry_date > fmt(d30) && d.expiry_date <= fmt(d90) && d.status === '사용').length }
  const totalAmt = active.reduce((a, d) => a + (d.current_qty || 0) * (d.price_unit || 0), 0)
  const mTx = txns.filter(tx => tx.transaction_date?.startsWith(ym))
  const txS = { inC: mTx.filter(x => x.type === '입고').length, inA: mTx.filter(x => x.type === '입고').reduce((a, x) => a + (x.total_amount || 0), 0), outC: mTx.filter(x => x.type === '출고').length, outA: mTx.filter(x => x.type === '출고').reduce((a, x) => a + (x.total_amount || 0), 0), retC: mTx.filter(x => x.type === '반품').length, retA: mTx.filter(x => x.type === '반품').reduce((a, x) => a + (x.total_amount || 0), 0), dspC: mTx.filter(x => x.type === '폐기').length, dspA: mTx.filter(x => x.type === '폐기').reduce((a, x) => a + (x.total_amount || 0), 0), dspQ: mTx.filter(x => x.type === '폐기').reduce((a, x) => a + (x.quantity || 0), 0) }
  txS.lossT = txS.retC + txS.dspC; txS.lossA = txS.retA + txS.dspA
  const catData = CATS.map(cat => { const items = active.filter(d => d.category === cat); return { cat, total: items.length, qty: items.reduce((a, d) => a + (d.current_qty || 0), 0), expSoon: items.filter(d => { const x = exD(d.expiry_date); return x !== null && x <= 90 }).length } }).filter(c => c.total > 0)
  const catC = { '경구제': t.accent, '주사제': t.green, '외용제': t.blue, '수액제': t.mint || '#92C8E0', '영양제': '#A8CF5C', '의약외품': t.coral || t.amber }
  const sorted = so(active.slice(0, 15))
  const tc = bc => ({ background: t.card, borderRadius: 14, padding: '20px', border: `1px solid ${t.border}`, borderTop: `3px solid ${bc}`, cursor: 'pointer', transition: 'all .2s', boxShadow: t.shadow })
  const hv = e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = t.shadowH }
  const hx = e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = t.shadow }
  const sT = (icon, title) => <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${t.accent}`, display: 'flex', alignItems: 'center', gap: 6 }}><span>{icon}</span>{title}</div>
  const sR = (label, value, color, unit) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${t.border}` }}><span style={{ fontSize: 12, color: t.textM }}>{label}</span><span style={{ fontSize: 13, fontWeight: 700, color: color || t.text }}>{typeof value === 'number' ? value.toLocaleString() : value}{unit || ''}</span></div>
  return <div style={{ padding: '20px 24px' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
      {[{ l: '전체 약품', v: s.total, c: t.accent, nav: { menu: 'druglist', status: STATS } }, { l: '사용', v: s.active, c: t.green, nav: { menu: 'druglist', status: ['사용'] } }, { l: '중지', v: s.stopped, c: t.textL, nav: { menu: 'druglist', status: ['중지'] } }, { l: '향정마약', v: s.narc, c: t.purple, nav: { menu: 'narcotic' } }].map((c, i) => <div key={i} onClick={() => onNav(c.nav)} style={tc(c.c)} onMouseEnter={hv} onMouseLeave={hx}><div style={{ fontSize: 12, color: t.textM, fontWeight: 500, marginBottom: 8 }}>{c.l}</div><div style={{ fontSize: 34, fontWeight: 800, color: c.c, letterSpacing: -1 }}>{c.v}</div></div>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
      {[{ l: '비보험', v: s.nonIns, c: t.blue, nav: { menu: 'nonins' } }, { l: '재고부족', v: s.shortage, c: t.red, nav: { menu: 'stock', filter: '부족' } }, { l: '유효기한 ≤30일', v: s.e30, c: t.red, nav: { menu: 'expiry', focus: 'urgent' } }, { l: '유효기한 ≤90일', v: s.e90, c: t.amber, nav: { menu: 'expiry', focus: 'warning' } }].map((c, i) => <div key={i} onClick={() => c.nav && onNav(c.nav)} style={{ background: t.card, borderRadius: 12, padding: '14px 18px', border: `1px solid ${t.border}`, cursor: c.nav ? 'pointer' : 'default', transition: 'all .15s', boxShadow: t.shadow }} onMouseEnter={hv} onMouseLeave={hx}><div style={{ fontSize: 11, color: t.textM }}>{c.l}</div><div style={{ fontSize: 26, fontWeight: 700, color: c.c, marginTop: 4 }}>{c.v}</div></div>)}
    </div>
    {s.e30 > 0 && <div onClick={() => onNav({ menu: 'expiry', focus: 'urgent' })} style={{ background: t.redL, border: `1px solid ${t.red}30`, borderRadius: 12, padding: '12px 18px', marginBottom: 14, color: t.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: t.shadow }}>⚠ 유효기한 30일 이내 약품 <strong>{s.e30}개</strong> — 즉시 확인 필요</div>}
    {/* ★ 3-Column: 입출고 + 반품/폐기 + 재고총괄 — 클릭 → 해당 페이지 이동 */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
      <div onClick={() => onNav({ menu: 'transaction' })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, boxShadow: t.shadow, cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={hv} onMouseLeave={hx}>
        {sT('▶◀', '당월 입출고')}
        {sR('입고 건수', txS.inC, t.green, '건')}{sR('입고 금액', txS.inA, t.green, '원')}{sR('출고 건수', txS.outC, t.blue, '건')}{sR('출고 금액', txS.outA, t.blue, '원')}{sR('순 입출고', txS.inA - txS.outA, txS.inA >= txS.outA ? t.green : t.red, '원')}
      </div>
      <div onClick={() => onNav({ menu: 'report' })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, boxShadow: t.shadow, cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={hv} onMouseLeave={hx}>
        {sT('▲', '반품/폐기 현황')}
        {sR('반품 건수', txS.retC, t.amber, '건')}{sR('반품 금액', txS.retA, t.amber, '원')}{sR('폐기 건수', txS.dspC, t.red, '건')}{sR('폐기 금액', txS.dspA, t.red, '원')}{sR('폐기 수량', txS.dspQ, t.red, '개')}
        <div style={{ marginTop: 8, padding: '8px 12px', background: t.redL, borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 12, fontWeight: 700, color: t.red }}>손실 합계</span><span style={{ fontSize: 14, fontWeight: 800, color: t.red }}>{txS.lossT}건 / ₩{txS.lossA.toLocaleString()}</span></div>
      </div>
      <div onClick={() => onNav({ menu: 'stock' })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, boxShadow: t.shadow, cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={hv} onMouseLeave={hx}>
        {sT('■', '재고 총괄')}
        {sR('관리 품목수', s.total, t.accent, '개')}{sR('현재고 총금액', totalAmt, t.accent, '원')}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.border}` }}><div style={{ fontSize: 11, color: t.textM, marginBottom: 6 }}>📋 사용상태</div><div style={{ display: 'flex', gap: 8 }}>{[{ l: '사용', v: s.active, c: t.green, nav: { menu: 'druglist', status: ['사용'] } }, { l: '휴면', v: s.dormant, c: t.amber, nav: { menu: 'druglist', status: ['휴면'] } }, { l: '중지', v: s.stopped, c: t.textL, nav: { menu: 'druglist', status: ['중지'] } }].map((x, i) => <div key={i} onClick={e => { e.stopPropagation(); onNav(x.nav) }} style={{ flex: 1, textAlign: 'center', padding: '6px', background: t.bg, borderRadius: 8, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = t.border} onMouseLeave={e => e.currentTarget.style.background = t.bg}><div style={{ fontSize: 9, color: t.textL }}>{x.l}</div><div style={{ fontSize: 16, fontWeight: 700, color: x.c }}>{x.v}</div></div>)}</div></div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }}><div style={{ fontSize: 11, color: t.textM, marginBottom: 6 }}>📦 재고현황</div><div style={{ display: 'flex', gap: 8 }}>{[{ l: '부족', v: s.shortage, c: t.red, nav: { menu: 'stock', filter: '부족' } }, { l: '정상', v: s.active - s.shortage, c: t.green, nav: { menu: 'stock', filter: '정상' } }].map((x, i) => <div key={i} onClick={e => { e.stopPropagation(); onNav(x.nav) }} style={{ flex: 1, textAlign: 'center', padding: '6px', background: t.bg, borderRadius: 8, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = t.border} onMouseLeave={e => e.currentTarget.style.background = t.bg}><div style={{ fontSize: 9, color: t.textL }}>{x.l}</div><div style={{ fontSize: 16, fontWeight: 700, color: x.c }}>{x.v}</div></div>)}</div></div>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
      {catData.map(c => { const cc = catC[c.cat] || t.accent; return <div key={c.cat} onClick={() => onNav({ menu: 'druglist', status: ['사용'] })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, borderLeft: `4px solid ${cc}`, cursor: 'pointer', transition: 'all .15s', boxShadow: t.shadow }} onMouseEnter={hv} onMouseLeave={hx}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}><span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{c.cat}</span><span style={{ fontSize: 14, fontWeight: 700, color: cc }}>{c.total}개</span></div><div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}><div><div style={{ fontSize: 10, color: t.textL, marginBottom: 2 }}>갯수</div><div style={{ fontSize: 22, fontWeight: 800, color: cc }}>{c.qty.toLocaleString()}</div></div>{c.expSoon > 0 && <div><div style={{ fontSize: 10, color: t.textL, marginBottom: 2 }}>유효기한 주의</div><div style={{ fontSize: 22, fontWeight: 800, color: t.amber }}>{c.expSoon}</div></div>}</div><div style={{ height: 4, background: t.border, borderRadius: 2, marginTop: 12 }}><div style={{ height: '100%', background: cc, borderRadius: 2, width: `${Math.min(c.total / Math.max(s.active, 1) * 100, 100)}%`, opacity: 0.5 }} /></div></div> })}
    </div>
    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, overflow: 'hidden', boxShadow: t.shadow }}>
      <div style={{ padding: '14px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: t.accentL }}><span style={{ fontWeight: 700, fontSize: 14, color: t.accent }}>사용 중인 약품</span><span style={{ fontSize: 13, fontWeight: 700, color: t.accent }}>{s.active}개</span></div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{[['drug_code', '약품코드'], ['drug_name', '약품명'], ['category', '구분'], ['current_qty', '현재고'], ['expiry_date', '유효기한'], ['status', '상태']].map(([k, h]) => <th key={k} style={TS(k)} onClick={() => hs(k)}>{h}<SI col={k} /></th>)}</tr></thead>
        <tbody>{sorted.map((d, i) => <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }} onMouseEnter={e => e.currentTarget.style.background = t.glass} onMouseLeave={e => e.currentTarget.style.background = ''}><td style={{ padding: '9px 12px', fontSize: 10, color: t.textM, textAlign: 'left' }}>{d.drug_code}<NT d={d} /></td><CN drug={d} onEdit={onEdit} /><td style={{ padding: '9px 12px', color: t.textM, fontSize: 11 }}>{d.category}</td><td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: d.current_qty === 0 ? t.red : t.text }}>{d.current_qty?.toLocaleString()}</td><td style={{ padding: '9px 12px', fontSize: 11, ...exS(d.expiry_date, t) }}>{d.expiry_date || '-'}</td><td style={{ padding: '9px 12px' }}><SB s={d.status} /></td></tr>)}</tbody>
      </table></div>
    </div><Ft />
  </div>
}

/* ═══ 약품목록 — 컬럼 가시성 토글 ═══ */
const DRUG_COLS = [
  { key: 'drug_code', label: '약품코드', default: true, align: 'left' }, { key: 'drug_name', label: '약품명', default: true, align: 'left' },
  { key: 'category', label: '구분', default: true, align: 'left' },
  { key: 'ingredient_en', label: '성분명(영문)', default: true, align: 'left' },
  { key: 'ingredient_kr', label: '성분명(한글)', default: true, align: 'left' },
  { key: 'efficacy_class', label: '약효분류', default: false, align: 'left' },
  { key: 'efficacy', label: '효능', default: false, align: 'left' },
  { key: 'manufacturer', label: '제조사', default: true, align: 'left' },
  { key: 'unit', label: '단위', default: false, align: 'center' },
  { key: 'specification', label: '규격', default: false, align: 'center' },
  { key: 'price_unit', label: '단가', default: true, align: 'right' },
  { key: 'insurance_price', label: 'EDI단가', default: false, align: 'right' },
  { key: 'current_qty', label: '현재고', default: true, align: 'right' },
  { key: 'insurance_type', label: '급여구분', default: true, align: 'center' },
  { key: 'insurance_code', label: '보험코드', default: false, align: 'left' },
  { key: 'expiry_date', label: '유효기한', default: true, align: 'left' },
  { key: 'lot_no', label: 'LOT번호', default: false, align: 'left' },
  { key: 'storage_method', label: '보관', default: false, align: 'center' },
  { key: 'status', label: '상태', default: true, align: 'center' },
  { key: 'narcotic_type', label: '향정', default: false, align: 'center' },
]

function DrugList({ drugs, navFilter: nf, onEdit }) {
  const { t } = useTheme(); const [search, setSearch] = useState(''); const [cats, setCats] = useState(CATS); const [stats, setStats] = useState(nf?.status || ['사용']); const [narcOnly, setNarcOnly] = useState(false); const [insF, setInsF] = useState(nf?.insType || '전체'); const [page, setPage] = useState(1); const [visCols, setVisCols] = useState(DRUG_COLS.filter(c => c.default).map(c => c.key))
  const { hs, so, SI, TS } = useSort('drug_name')
  useEffect(() => { if (nf?.status) setStats(Array.isArray(nf.status) ? nf.status : [nf.status]); if (nf?.narcotic) setNarcOnly(true); else setNarcOnly(false); if (nf?.insType) setInsF(nf.insType); else setInsF('전체'); setPage(1) }, [nf])
  const filtered = so(drugs.filter(d => { if (narcOnly && !isN(d)) return false; if (!stats.includes(d.status)) return false; if (!cats.includes(d.category)) return false; if (insF !== '전체' && (d.insurance_type || '보험') !== insF) return false; if (search.trim()) { const q = search.trim().toLowerCase(); return d.drug_name?.toLowerCase().includes(q) || d.drug_code?.toLowerCase().includes(q) || d.ingredient_kr?.toLowerCase().includes(q) || d.manufacturer?.toLowerCase().includes(q) }; return true }))
  const tp = Math.ceil(filtered.length / PP), paged = filtered.slice((page - 1) * PP, page * PP); const activeCols = DRUG_COLS.filter(c => visCols.includes(c.key))
  function dl() { const ws = XLSX.utils.json_to_sheet(filtered.map(d => { const o = {}; DRUG_COLS.forEach(c => { o[c.label] = d[c.key] || '' }); return o })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '약품'); XLSX.writeFile(wb, `약품목록_${new Date().toISOString().split('T')[0]}.xlsx`) }
  function cellVal(d, col) {
    if (col.key === 'drug_code') return <><span style={{ fontSize: 10, color: t.textM }}>{d.drug_code}</span><NT d={d} /></>
    if (col.key === 'drug_name') return <CN drug={d} onEdit={onEdit} />
    if (col.key === 'ingredient_kr') return <span title={d.ingredient_kr || ''} style={{ color: t.textM, fontSize: 11, maxWidth: 140, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{d.ingredient_kr || '-'}</span>
    if (col.key === 'ingredient_en') return <span title={d.ingredient_en || ''} style={{ color: t.textL, fontSize: 10, maxWidth: 140, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle', fontStyle: 'italic' }}>{d.ingredient_en || '-'}</span>
    if (col.key === 'current_qty') return <span style={{ fontWeight: 600, color: d.current_qty === 0 ? t.red : t.text }}>{d.current_qty?.toLocaleString()}</span>
    if (col.key === 'price_unit') return d.price_unit ? d.price_unit.toLocaleString() + '원' : '-'
    if (col.key === 'insurance_type') return (d.insurance_type || '보험') === '비보험' ? <Bd bg={t.blueL} color={t.blue}>비보험</Bd> : <span style={{ fontSize: 10, color: t.textL }}>보험</span>
    if (col.key === 'expiry_date') return <span style={exS(d.expiry_date, t)}>{d.expiry_date || '-'}</span>
    if (col.key === 'status') return <SB s={d.status} />
    return <span title={d[col.key] || ''} style={{ color: t.textM, fontSize: 11, maxWidth: 120, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{d[col.key] || '-'}</span>
  }
  return <div style={{ padding: '20px 24px' }}>
    <div className="no-print" style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, padding: '16px 18px', marginBottom: 12, boxShadow: t.shadow }}>
      <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="약품명, 코드, 성분명, 제조사 검색..." style={{ width: '100%', padding: '10px 14px', border: `1px solid ${t.border}`, borderRadius: 10, fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MP items={CATS} selected={cats} onChange={v => { setCats(v); setPage(1) }} color={t.accent} label="구분" />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}><MP items={STATS} selected={stats} onChange={v => { setStats(v); setPage(1) }} color={t.green} label="상태" /><div style={{ width: 1, height: 16, background: t.border }} /><button onClick={() => { setNarcOnly(!narcOnly); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${narcOnly ? t.purple : t.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: narcOnly ? t.purpleL : 'transparent', color: narcOnly ? t.purple : t.textM }}>향정마약</button></div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ fontSize: 10, color: t.textL, fontWeight: 600 }}>보험</span>{['전체', '보험', '비보험'].map(x => <button key={x} onClick={() => { setInsF(x); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${insF === x ? t.blue : t.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: insF === x ? t.blueL : 'transparent', color: insF === x ? t.blue : t.textM }}>{x}</button>)}<div style={{ flex: 1 }} /><ColToggle cols={DRUG_COLS} visible={visCols} setVisible={setVisCols} /><button onClick={dl} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${t.green}`, background: t.greenL, color: t.green, cursor: 'pointer', fontSize: 11, fontWeight: 600, marginLeft: 4 }}>엑셀 다운로드</button></div>
      </div>
    </div>
    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, overflow: 'hidden', boxShadow: t.shadow }}>
      <div style={{ padding: '10px 18px', borderBottom: `1px solid ${t.border}`, fontSize: 12, color: t.textM, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>전체 {drugs.length}개 · 결과 <strong style={{ color: t.accent }}>{filtered.length}개</strong></span><span style={{ fontSize: 10, color: t.textL }}>약품명 클릭 → 수정</span></div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{activeCols.map(c => <th key={c.key} style={{ ...TS(c.key), textAlign: c.align }} onClick={() => hs(c.key)}>{c.label}<SI col={c.key} /></th>)}</tr></thead>
        <tbody>{!paged.length ? <tr><td colSpan={activeCols.length} style={{ padding: 40, textAlign: 'center', color: t.textL }}>검색 결과 없음</td></tr>
          : paged.map((d, i) => <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }} onMouseEnter={e => e.currentTarget.style.background = t.glass} onMouseLeave={e => e.currentTarget.style.background = ''}>
            {activeCols.map(c => c.key === 'drug_name' ? <CN key={c.key} drug={d} onEdit={onEdit} /> : <td key={c.key} style={{ padding: '8px 12px', textAlign: c.align, color: t.textM, fontSize: c.key === 'drug_code' ? 10 : 11 }}>{cellVal(d, c)}</td>)}
          </tr>)}</tbody>
      </table></div>
      <Pg page={page} setPage={setPage} tp={tp} fl={filtered} pp={PP} />
    </div><Ft />
  </div>
}
/* ═══ 유효기한 — 칩 클릭 라우팅 ═══ */
function ExpiryAlert({drugs,onEdit,focusLevel,onReload}){
  const{t}=useTheme();const[cats,setCats]=useState(CATS);const[stats,setStats]=useState(['사용']);const[aLv,setALv]=useState(focusLevel||null)
  const[editRow,setEditRow]=useState(null);const[editVal,setEditVal]=useState({})
  const fd=drugs.filter(d=>cats.includes(d.category)&&stats.includes(d.status))
  const unusedDays=d=>{if(!d.last_used_date)return null;return Math.floor((new Date()-new Date(d.last_used_date))/864e5)}
  const isUnused=d=>{const days=unusedDays(d);return days!==null&&days>=365}
  /* 알림상태 수식: <=0 만료, <=30 긴급, <=60 주의, <=90 확인, 그외 정상 */
  const alertSt=days=>{if(days===null)return{text:'',c:t.textL,bg:''};if(days<=0)return{text:'★만료★',c:'#fff',bg:t.red};if(days<=30)return{text:'▲긴급▲',c:'#fff',bg:'#E65100'};if(days<=60)return{text:'◆주의◆',c:'#333',bg:'#FFD600'};if(days<=90)return{text:'●확인●',c:'#fff',bg:t.blue};return{text:'정상',c:t.green,bg:''}}
  const g={urgent:fd.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x<=30}),warning:fd.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x>30&&x<=90}),notice:fd.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x>90&&x<=180}),narcotic:drugs.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x<=180&&isN(d)&&cats.includes(d.category)}),unused:fd.filter(d=>isUnused(d))}
  useEffect(()=>{if(focusLevel)setALv(focusLevel)},[focusLevel])
  async function saveRow(d){
    const ud={}
    if(editVal.last_used_dept!==undefined)ud.last_used_dept=editVal.last_used_dept
    if(editVal.last_used_date!==undefined)ud.last_used_date=editVal.last_used_date||null
    if(editVal.recommended_action!==undefined)ud.recommended_action=editVal.recommended_action||null
    if(editVal.expiry_notes!==undefined)ud.expiry_notes=editVal.expiry_notes||null
    if(Object.keys(ud).length){
      let res=await supabase.from('drugs').update(ud).eq('drug_code',d.drug_code)
      for(let retry=0;retry<3&&res.error&&res.error.message?.includes('column');retry++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete ud[m[1]];res=await supabase.from('drugs').update(ud).eq('drug_code',d.drug_code)}
      onReload?.()
    }
    setEditRow(null);setEditVal({})
  }
  function startEdit(d){setEditRow(d.drug_code);setEditVal({last_used_dept:d.last_used_dept||'',last_used_date:d.last_used_date||'',recommended_action:d.recommended_action||'',expiry_notes:d.expiry_notes||''})}
  async function saveNote(d,val){if(val===(d.expiry_notes||''))return;let res=await supabase.from('drugs').update({expiry_notes:val||null}).eq('drug_code',d.drug_code);for(let r=0;r<2&&res.error&&res.error.message?.includes('column');r++){res=await supabase.from('drugs').update({}).eq('drug_code',d.drug_code)};onReload?.()}  function dlE(){const all=[...g.urgent,...g.warning,...g.notice,...g.narcotic,...g.unused];const ws=XLSX.utils.json_to_sheet(all.map(d=>{const days=exD(d.expiry_date);const a=alertSt(days);const uD=unusedDays(d);return{약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,현재고:d.current_qty||0,유효기한:d.expiry_date||'',남은일수:days,알림상태:a.text,최종사용과:d.last_used_dept||'',최종사용일:d.last_used_date||'','미사용기간(일)':uD||'',미사용알림:uD!==null&&uD>365?'■미사용■':'',권장조치:d.recommended_action||'',비고:d.expiry_notes||'',사용상태:d.status,향정:getNT(d)}}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'유효기한');XLSX.writeFile(wb,`유효기한_${new Date().toISOString().split('T')[0]}.xlsx`)}
  const lvs=[{k:'urgent',l:'긴급',sub:'≤30일',c:t.red},{k:'warning',l:'주의',sub:'31~90일',c:t.amber},{k:'notice',l:'확인',sub:'91~180일',c:t.blue},{k:'narcotic',l:'향정마약',sub:'≤180일',c:t.purple},{k:'unused',l:'미사용',sub:'1년 이상',c:'#B71C1C'}]
  const ip2={padding:'4px 6px',border:`1px solid ${t.border}`,borderRadius:4,fontSize:10,outline:'none',background:t.bg,color:t.text}
  function ET({items,color}){const{hs,so,SI,TS}=useSort('expiry_date')
    /* 남은일수·미사용기간 사전 계산 → 정렬 가능 */
    const withCalc=items.map(d=>{const rd=exD(d.expiry_date);const ud=unusedDays(d);return{...d,_remainDays:rd,_unusedDays:ud}})
    const sorted=so(withCalc);if(!sorted.length)return<div style={{padding:16,textAlign:'center',color:t.textL,fontSize:12}}>해당 없음</div>
    const cols=[['drug_code','코드'],['drug_name','약품명'],['category','구분'],['current_qty','현재고'],['expiry_date','유효기한'],['_remainDays','남은일수'],['_remainDays','알림상태'],['last_used_dept','최종사용과'],['last_used_date','최종사용일'],['_unusedDays','미사용기간(일)'],['_unusedDays','미사용알림'],['recommended_action','권장조치'],['expiry_notes','비고'],['status','사용상태']]
    return<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr>{cols.map(([k,h])=><th key={h} style={k?{...TS(k),fontSize:10,whiteSpace:'nowrap'}:{padding:'8px 6px',textAlign:'center',color:t.textM,fontWeight:600,borderBottom:`1px solid ${t.border}`,fontSize:10,whiteSpace:'nowrap'}} onClick={()=>k&&hs(k)}>{h}{k&&<SI col={k}/>}</th>)}</tr></thead>
    <tbody>{sorted.map((d,i)=>{const days=exD(d.expiry_date);const a=alertSt(days);const uDays=unusedDays(d);const isEd=editRow===d.drug_code;const uu=isUnused(d)
      return<tr key={i} style={{borderBottom:`1px solid ${t.border}`,background:uu?t.redL+'60':''}} onMouseEnter={e=>{if(!uu)e.currentTarget.style.background=t.glass}} onMouseLeave={e=>{if(!uu)e.currentTarget.style.background=''}}>
        <td style={{padding:'5px 8px',fontSize:10,color:t.textM}}>{d.drug_code}<NT d={d}/></td>
        <CN drug={d} onEdit={onEdit}/>
        <td style={{padding:'5px 8px',color:t.textM,fontSize:10}}>{d.category}</td>
        <td style={{padding:'5px 8px',textAlign:'right',fontWeight:600,fontSize:11}}>{d.current_qty?.toLocaleString()}</td>
        <td style={{padding:'5px 8px',color,fontWeight:600,fontSize:10}}>{d.expiry_date}</td>
        <td style={{padding:'5px 8px',textAlign:'right',fontWeight:700,fontSize:11,color}}>{days}</td>
        <td style={{padding:'5px 4px',textAlign:'center'}}>{a.text&&<span style={{background:a.bg||'transparent',color:a.c,fontWeight:700,padding:'2px 6px',borderRadius:4,fontSize:9,whiteSpace:'nowrap'}}>{a.text}</span>}</td>
        <td style={{padding:'5px 6px',fontSize:10}}>{isEd?<select value={editVal.last_used_dept??''} onChange={e=>setEditVal(p=>({...p,last_used_dept:e.target.value}))} style={{...ip2,width:85}}><option value="">선택</option><option>가정의학과</option><option>재활의학과1</option><option>신경과</option><option>기타</option></select>:<span style={{color:t.textM,cursor:'pointer'}} onClick={()=>startEdit(d)}>{d.last_used_dept?<span style={{background:t.accentL,color:t.accent,padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:600}}>{d.last_used_dept}</span>:<span style={{color:t.textL,fontSize:9}}>클릭</span>}</span>}</td>
        <td style={{padding:'5px 6px',fontSize:10}}>{isEd?<input type="date" value={editVal.last_used_date??''} onChange={e=>setEditVal(p=>({...p,last_used_date:e.target.value}))} style={{...ip2,width:105}}/>:<span style={{color:t.textM,cursor:'pointer',fontSize:10}} onClick={()=>startEdit(d)}>{d.last_used_date||<span style={{color:t.textL,fontSize:9}}>클릭</span>}</span>}</td>
        <td style={{padding:'5px 8px',textAlign:'right',fontSize:10,color:t.textM}}>{uDays!==null?uDays:''}</td>
        <td style={{padding:'5px 4px',textAlign:'center'}}>{uDays!==null&&uDays>365?<span style={{background:t.red,color:'#fff',padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:700,whiteSpace:'nowrap'}}>■미사용■</span>:''}</td>
        <td style={{padding:'5px 6px',fontSize:10}}>{isEd?<select value={editVal.recommended_action??''} onChange={e=>setEditVal(p=>({...p,recommended_action:e.target.value}))} style={{...ip2,width:80}}>{REC_ACTIONS.map(a=><option key={a} value={a}>{a||'선택'}</option>)}</select>:<span style={{cursor:'pointer',fontSize:10}} onClick={()=>startEdit(d)}>{d.recommended_action?<span style={{background:t.amberL,color:t.amber,padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:600}}>{d.recommended_action}</span>:<span style={{color:t.textL,fontSize:9}}>클릭</span>}</span>}</td>
        <td style={{padding:'5px 6px'}}><input defaultValue={d.expiry_notes||''} onBlur={e=>saveNote(d,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}} placeholder="입력" style={{...ip2,width:80,fontSize:9}}/></td>
        <td style={{padding:'5px 6px'}}><SB s={d.status}/></td>
        {isEd&&<td style={{padding:'5px 4px'}}><button onClick={()=>saveRow(d)} style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:9,fontWeight:600}}>저장</button></td>}
      </tr>})}</tbody></table></div>}
  const show=aLv?lvs.filter(l=>l.k===aLv):lvs.filter(l=>l.k!=='unused'||g.unused.length>0)
  return<div style={{padding:'20px 24px'}}>
    <div className="no-print" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',flexWrap:'wrap',gap:6}}>
      <MP items={CATS} selected={cats} onChange={setCats} color={t.accent} label="구분"/><div style={{width:1,height:16,background:t.border}}/><MP items={STATS} selected={stats} onChange={setStats} color={t.green} label="상태"/>
      <div style={{flex:1}}/><button onClick={dlE} style={{padding:'6px 14px',borderRadius:6,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:11,fontWeight:600}}>엑셀 다운로드</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:`repeat(${g.unused.length>0?5:4},1fr)`,gap:8,marginBottom:14}}>{(g.unused.length>0?lvs:lvs.slice(0,4)).map(l=><div key={l.k} onClick={()=>setALv(aLv===l.k?null:l.k)} style={{background:t.card,border:`1px solid ${aLv===l.k?l.c:t.border}`,borderRadius:12,padding:'14px 16px',cursor:'pointer',transition:'all .15s',boxShadow:aLv===l.k?`0 0 12px ${l.c}15`:'none'}} onMouseEnter={e=>e.currentTarget.style.borderColor=l.c} onMouseLeave={e=>{if(aLv!==l.k)e.currentTarget.style.borderColor=t.border}}><div style={{fontSize:12,color:l.c,fontWeight:700}}>{l.l}</div><div style={{fontSize:28,fontWeight:700,color:l.c,marginTop:4}}>{g[l.k].length}</div><div style={{fontSize:10,color:t.textM,marginTop:2}}>{l.sub}</div></div>)}</div>
    {aLv&&<button className="no-print" onClick={()=>setALv(null)} style={{padding:'5px 14px',borderRadius:6,border:`1px solid ${t.border}`,background:t.card,color:t.textM,cursor:'pointer',fontSize:11,marginBottom:8}}>← 전체 보기</button>}
    {show.map(l=><div key={l.k} style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',marginBottom:12}}><div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,display:'flex',alignItems:'center',gap:8,background:l.c+'08'}}><span style={{fontWeight:700,fontSize:13,color:l.c}}>{l.l}</span><span style={{fontSize:11,color:t.textM}}>{l.sub}</span><span style={{marginLeft:'auto',background:l.c,color:'#fff',borderRadius:8,padding:'2px 12px',fontSize:11,fontWeight:700}}>{g[l.k].length}</span></div><ET items={g[l.k]} color={l.c}/></div>)}
    <Ft/>
  </div>
}

/* ═══ 재고현황 — ★ 사용량 엑셀 업로드 추가 ═══ */
function StockStatus({drugs,inv,navFilter:nf,onEdit,onAdjust,onReload}){
  const{t}=useTheme();
  const [filter,setFilter]=useState(nf?.filter||'전체');const [cats,setCats]=useState(CATS);const [stats,setStats]=useState(['사용']);const [search,setSearch]=useState('');const [page,setPage]=useState(1);const{hs,so,SI,TS}=useSort('drug_name');
  const[uMsg,setUMsg]=useState(null);const uRef=useRef()
  useEffect(()=>{if(nf?.filter){setFilter(nf.filter);setPage(1)}},[nf])
  const im={};inv.forEach(i=>{im[i.drug_code]=i});const merged=drugs.filter(d=>stats.includes(d.status)).map(d=>{const iv=im[d.drug_code]||{};const q=d.current_qty||0,sf=iv.safety_stock||d.safety_stock||0,mx=iv.max_stock||d.max_stock||0;let st='정상';if(q===0)st='재고없음';else if(sf>0&&q<sf)st='부족';else if(mx>0&&q>mx)st='과잉';return{...d,safety_stock:sf,max_stock:mx,monthly_avg:iv.monthly_avg||d.monthly_avg||0,stockStatus:st}})
  const sg={전체:merged.length,부족:merged.filter(d=>d.stockStatus==='부족').length,재고없음:merged.filter(d=>d.stockStatus==='재고없음').length,정상:merged.filter(d=>d.stockStatus==='정상').length,과잉:merged.filter(d=>d.stockStatus==='과잉').length}
  const filtered=so(merged.filter(d=>{if(filter!=='전체'&&d.stockStatus!==filter)return false;if(!cats.includes(d.category))return false;if(search.trim()){const q=search.trim().toLowerCase();return d.drug_name?.toLowerCase().includes(q)||d.drug_code?.toLowerCase().includes(q)};return true}));const tp=Math.ceil(filtered.length/PP),paged=filtered.slice((page-1)*PP,page*PP)
  const sc=s=>s==='부족'||s==='재고없음'?t.red:s==='과잉'?t.amber:t.green
  function dl(){const ws=XLSX.utils.json_to_sheet(filtered.map(d=>({약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,현재고:d.current_qty,안전재고:d.safety_stock,최대재고:d.max_stock,월평균:d.monthly_avg,사용상태:d.status,재고상태:d.stockStatus})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'재고');XLSX.writeFile(wb,`재고_${new Date().toISOString().split('T')[0]}.xlsx`)}
  async function uploadUsage(e){
    const file=e.target.files[0];if(!file)return;setUMsg('업로드 중...')
    const reader=new FileReader();reader.onload=async ev=>{
      try{const wb=XLSX.read(ev.target.result,{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})
      let ok=0,fail=0
      for(const r of rows){
        const code=String(r['약품코드']||r['drug_code']||'').trim();if(!code)continue
        const ud={};const py=Number(r['전년사용량']||r['전년도사용량']||r['prev_year_usage']||0);const r3=Number(r['최근3개월사용량']||r['최근3개월']||r['recent_3m_usage']||0);const sf=Number(r['안전재고']||r['safety_stock']||0);const mx=Number(r['최대재고']||r['max_stock']||0)
        if(py)ud.prev_year_usage=py;if(r3)ud.recent_3m_usage=r3;if(sf)ud.safety_stock=sf;if(mx)ud.max_stock=mx
        if(py||r3)ud.monthly_avg=Math.round((r3||py/4)/3)
        if(Object.keys(ud).length){const{error}=await supabase.from('drugs').update(ud).eq('drug_code',code);if(error)fail++;else ok++}
      }
      setUMsg(`완료! ${ok}건 업데이트, ${fail}건 실패`);onReload?.();setTimeout(()=>setUMsg(null),4000)
      }catch(err){setUMsg('오류: '+err.message)}
    };reader.readAsArrayBuffer(file);e.target.value=''
  }
  function dlUsageTemplate(){const ws=XLSX.utils.aoa_to_sheet([['약품코드','약품명(참고용)','전년사용량','최근3개월사용량','안전재고','최대재고'],['SGBRONNC10','가바로닌캡슐100mg',1592,974,488,975],['GRD2','게리드정2밀리그램',330,105,71,141]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'사용량');XLSX.writeFile(wb,'사용량_업로드_양식.xlsx')}
  return<div style={{padding:'20px 24px'}}>
    <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:14}}>{[{k:'전체',c:t.text},{k:'부족',c:t.red},{k:'재고없음',c:t.red},{k:'정상',c:t.green},{k:'과잉',c:t.amber}].map(f2=><div key={f2.k} onClick={()=>{setFilter(f2.k);setPage(1)}} style={{background:filter===f2.k?f2.c+'15':t.card,borderRadius:12,padding:'12px 16px',border:`1px solid ${filter===f2.k?f2.c:t.border}`,cursor:'pointer',backdropFilter:'blur(12px)'}}><div style={{fontSize:10,color:t.textM}}>{f2.k}</div><div style={{fontSize:24,fontWeight:700,color:f2.c}}>{sg[f2.k]}</div></div>)}</div>
    {uMsg&&<div style={{background:uMsg.includes('완료')?t.greenL:uMsg.includes('오류')?t.redL:t.blueL,border:`1px solid ${uMsg.includes('완료')?t.green:uMsg.includes('오류')?t.red:t.blue}`,borderRadius:8,padding:'10px 14px',marginBottom:10,color:uMsg.includes('완료')?t.green:uMsg.includes('오류')?t.red:t.blue,fontSize:12,fontWeight:600}}>{uMsg}</div>}
    <div className="no-print" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'12px 16px',marginBottom:12,display:'flex',flexDirection:'column',gap:8,backdropFilter:'blur(12px)'}}>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="검색..." style={{flex:1,minWidth:120,padding:'8px 12px',border:`1px solid ${t.border}`,borderRadius:8,fontSize:12,outline:'none',background:t.bg,color:t.text}}/>
        <button onClick={dl} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:11,fontWeight:600}}>엑셀</button>
        <button onClick={dlUsageTemplate} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.blue}`,background:t.blueL,color:t.blue,cursor:'pointer',fontSize:11,fontWeight:600}}>사용량 양식</button>
        <button onClick={()=>uRef.current.click()} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.amber}`,background:t.amberL,color:t.amber,cursor:'pointer',fontSize:11,fontWeight:600}}>사용량 업로드</button>
        <input ref={uRef} type="file" accept=".xlsx,.xls" onChange={uploadUsage} style={{display:'none'}}/>
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <MP items={CATS} selected={cats} onChange={v=>{setCats(v);setPage(1)}} color={t.purple} label="구분"/>
        <div style={{width:1,height:16,background:t.border}}/>
        <MP items={STATS} selected={stats} onChange={v=>{setStats(v);setPage(1)}} color={t.green} label="상태"/>
      </div>
    </div>
    <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',backdropFilter:'blur(12px)'}}>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr>{[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['current_qty','현재고'],['safety_stock','안전재고'],['max_stock','최대재고'],['monthly_avg','월평균'],['status','사용상태'],['stockStatus','재고상태'],['expiry_date','유효기한'],['','보정']].map(([k,h])=><th key={h} style={k?TS(k):{padding:'8px 10px',textAlign:'center',color:t.textM,fontWeight:600,borderBottom:`1px solid ${t.border}`,fontSize:11}} onClick={()=>k&&hs(k)}>{h}{k&&<SI col={k}/>}</th>)}</tr></thead>
        <tbody>{!paged.length?<tr><td colSpan={10} style={{padding:40,textAlign:'center',color:t.textL}}>없음</td></tr>:paged.map((d,i)=><tr key={i} style={{borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>
          <td style={{padding:'8px 12px',fontSize:10,color:t.textM,textAlign:'left'}}>{d.drug_code}<NT d={d}/></td><CN drug={d} onEdit={onEdit}/><td style={{padding:'8px 10px',color:t.textM,fontSize:11}}>{d.category}</td>
          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:d.stockStatus==='부족'||d.stockStatus==='재고없음'?t.red:t.text}}>{d.current_qty?.toLocaleString()}</td>
          <td style={{padding:'8px 10px',textAlign:'right',color:t.textM}}>{d.safety_stock||'-'}</td><td style={{padding:'8px 10px',textAlign:'right',color:t.textM}}>{d.max_stock||'-'}</td><td style={{padding:'8px 10px',textAlign:'right',color:t.textM}}>{d.monthly_avg||'-'}</td>
          <td style={{padding:'8px 10px'}}><SB s={d.status}/></td>
          <td style={{padding:'8px 10px'}}><Bd bg={sc(d.stockStatus)+'18'} color={sc(d.stockStatus)}>{d.stockStatus}</Bd></td>
          <td style={{padding:'8px 10',fontSize:11,...exS(d.expiry_date,t)}}>{d.expiry_date||'-'}</td>
          <td style={{padding:'8px 6px',textAlign:'center'}}>{d.last_adjusted_date&&<div style={{fontSize:8,color:t.amber,fontWeight:600,marginBottom:2}}>{d.last_adjusted_date}</div>}<button onClick={()=>onAdjust(d)} style={{padding:'3px 8px',borderRadius:4,border:`1px solid ${t.amber}`,background:d.last_adjusted_date?t.amberL:'transparent',color:t.amber,cursor:'pointer',fontSize:9,fontWeight:600}}>보정</button></td>
        </tr>)}</tbody>
      </table></div>
      <Pg page={page} setPage={setPage} tp={tp} fl={filtered} pp={PP}/>
    </div><Ft/>
  </div>
}

/* ═══ 향정마약 전용 — ★ 카드 클릭 필터링 ═══ */
function NarcoticMgmt({drugs,onEdit,onAdjust}){
  const{t}=useTheme();const[stats,setStats]=useState(['사용']);const narcs=drugs.filter(d=>isN(d)&&stats.includes(d.status));const{hs,so,SI,TS}=useSort('drug_name')
  const[filter,setFilter]=useState('전체')
  const byType={향정:narcs.filter(d=>getNT(d)==='향정'),마약:narcs.filter(d=>getNT(d)==='마약')};const expiring=narcs.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x<=180})
  const display=filter==='전체'?narcs:filter==='향정'?byType['향정']:filter==='마약'?byType['마약']:expiring
  const sorted=so(display)
  const cards=[{k:'전체',v:narcs.length,c:t.purple},{k:'향정',v:byType['향정'].length,c:t.purple},{k:'마약',v:byType['마약'].length,c:t.red},{k:'유효기한 주의',v:expiring.length,c:t.amber}]
  function dl(){const ws=XLSX.utils.json_to_sheet(sorted.map(d=>({약품코드:d.drug_code,약품명:d.drug_name,분류:d.category,구분:getNT(d),현재고:d.current_qty||0,유효기한:d.expiry_date||'',남은일수:exD(d.expiry_date),보관:d.storage_method||'',상태:d.status})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'향정마약');XLSX.writeFile(wb,`향정마약_${new Date().toISOString().split('T')[0]}.xlsx`)}
  return<div style={{padding:'20px 24px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><div style={{fontSize:16,fontWeight:700,color:t.purple}}>향정·마약류 관리</div><button onClick={dl} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:11,fontWeight:600}}>엑셀</button></div>
    <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'10px 16px',marginBottom:12,backdropFilter:'blur(12px)'}}>
      <MP items={STATS} selected={stats} onChange={setStats} color={t.green} label="상태"/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
      {cards.map((c,i)=><div key={i} onClick={()=>setFilter(c.k)} style={{background:filter===c.k?c.c+'15':t.card,border:`1px solid ${filter===c.k?c.c:t.border}`,borderRadius:12,padding:'14px 16px',cursor:'pointer',backdropFilter:'blur(12px)',transition:'all .15s'}} onMouseEnter={e=>{if(filter!==c.k)e.currentTarget.style.borderColor=c.c}} onMouseLeave={e=>{if(filter!==c.k)e.currentTarget.style.borderColor=t.border}}><div style={{fontSize:11,color:filter===c.k?c.c:t.textM,fontWeight:filter===c.k?700:500}}>{c.k}</div><div style={{fontSize:26,fontWeight:700,color:c.c,marginTop:4}}>{c.v}</div></div>)}
    </div>
    <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',backdropFilter:'blur(12px)'}}>
      <div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:13,color:t.purple,display:'flex',justifyContent:'space-between'}}><span>{filter==='전체'?'향정·마약 전체':filter} 목록</span><span style={{color:t.textM,fontWeight:500}}>{sorted.length}개</span></div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr>{[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['narcotic_type','분류'],['current_qty','현재고'],['expiry_date','유효기한'],['','D-day'],['storage_method','보관'],['status','상태'],['','보정']].map(([k,h])=><th key={h} style={k?TS(k):{padding:'8px 10px',textAlign:'center',color:t.textM,fontWeight:600,borderBottom:`1px solid ${t.border}`,fontSize:11}} onClick={()=>k&&hs(k)}>{h}{k&&<SI col={k}/>}</th>)}</tr></thead>
        <tbody>{sorted.map((d,i)=>{const days=exD(d.expiry_date);const nt=getNT(d);return<tr key={i} style={{borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>
          <td style={{padding:'8px 12px',fontSize:10,color:t.textM,textAlign:'left'}}>{d.drug_code}</td><CN drug={d} onEdit={onEdit}/><td style={{padding:'8px 10px',color:t.textM,fontSize:11}}>{d.category}</td>
          <td style={{padding:'8px 10px'}}><Bd bg={nt==='마약'?t.redL:t.purpleL} color={nt==='마약'?t.red:t.purple}>{nt}</Bd></td>
          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:d.current_qty===0?t.red:t.text}}>{d.current_qty?.toLocaleString()}</td>
          <td style={{padding:'8px 10px',fontSize:11,...exS(d.expiry_date,t)}}>{d.expiry_date||'-'}</td>
          <td style={{padding:'8px 10px'}}>{days!==null?<span style={{fontSize:10,color:days<=30?t.red:days<=90?t.amber:t.textM,fontWeight:600}}>D{days<=0?days:'-'+days}</span>:'-'}</td>
          <td style={{padding:'8px 10px',fontSize:10,color:t.textM}}>{d.storage_method||'-'}</td><td style={{padding:'8px 10px'}}><SB s={d.status}/></td>
          <td style={{padding:'8px 6px',textAlign:'center'}}><button onClick={()=>onAdjust(d)} style={{padding:'3px 8px',borderRadius:4,border:`1px solid ${t.amber}`,background:'transparent',color:t.amber,cursor:'pointer',fontSize:9,fontWeight:600}}>보정</button></td>
        </tr>})}</tbody>
      </table></div>
    </div><Ft/>
  </div>
}

/* ═══ 기초정보 등록 ═══ */
function DrugRegister({onRefresh}) {
  const initForm={drug_code:'',drug_name:'',category:'경구제',manufacturer:'',ingredient_kr:'',ingredient_en:'',efficacy_class:'',efficacy:'',specification:'',unit:'',price_unit:'',insurance_price:'',insurance_type:'급여',insurance_code:'',current_qty:0,expiry_date:'',lot_no:'',storage_method:'실온',status:'사용',narcotic_type:'해당없음'}
  const[form,setForm]=useState(initForm)
  const[msg,setMsg]=useState(null)
  const[saving,setSaving]=useState(false)
  const[mode,setMode]=useState('single')
  const[bulk,setBulk]=useState([])
  const[bulkMsg,setBulkMsg]=useState(null)
  const[bulkLoading,setBulkLoading]=useState(false)
  const fileRef=useRef()
  const[apiQuery,setApiQuery]=useState('')
  const[apiResults,setApiResults]=useState([])
  const[apiLoading,setApiLoading]=useState(false)
  const[apiMsg,setApiMsg]=useState(null)
  const[priceInfo,setPriceInfo]=useState(null)
  const[priceLoading,setPriceLoading]=useState(false)

  /* API 5종 조회 — 1차:e약은요 → 2차:허가정보+낱알식별 → 보조:약가+성분약효 */
  async function fetchDrugPrice(drugName, ingredientFromSearch){
    if(!drugName)return;setPriceLoading(true);setPriceInfo(null)
    let info={};const px=new DOMParser()
    const isEng=s=>s&&/^[a-zA-Z\s()\[\]\-,.:;0-9]+$/.test(s)
    /* 이름 정제 */
    const cleaned=drugName.replace(/[\d]+[\s]*(mg|ml|g|mcg|밀리그램|밀리리터|그램)/gi,'').trim()
    const short=drugName.replace(/(정|캡슐|주사|시럽|현탁|산|과립|주|액|크림|연고|겔|패치|좌제).*$/,'').trim()
    const paren=drugName.match(/[(\（]([^)\）]+)[)\）]/)?.[1]||''
    const names=[...new Set([drugName,cleaned,short,paren,ingredientFromSearch].filter(s=>s&&s.length>1))]
    console.log('신규등록 API 검색명:', names)
    /* ── 1차 소스: e약은요 → 효능, 보관방법 ── */
    const easyNames=[...names,ingredientFromSearch].filter(s=>s&&s.length>1)
    for(const nm of easyNames){
      if(info.efficacy)break
      try{
        const url=`/api/datago/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?itemName=${encodeURIComponent(nm)}&type=json&numOfRows=3&pageNo=1`
        const res=await fetch(url);const text=await res.text()
        try{
          const j=JSON.parse(text);const b=j?.body||j?.response?.body
          const its=b?.items?.item||b?.items||[]
          const a=Array.isArray(its)?its:[its].filter(Boolean)
          console.log(`[1차] e약은요 검색 [${nm}]:`,a.length,'건')
          if(a.length>0){
            if(a[0].efcyQesitm)info.efficacy=a[0].efcyQesitm
            if(a[0].depositMethodQesitm)info.storageMethod=a[0].depositMethodQesitm
          }
        }catch{}
      }catch(e){console.log('e약은요:',e)}
    }
    /* ── 2차 소스①: 허가정보 → 보관방법보완, 성분, 단위, 보험코드 ── */
    for(const nm of names){
      if(info.permitFound)break
      try{
        const url=`/api/datago/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07?item_name=${encodeURIComponent(nm)}&type=json&numOfRows=3&pageNo=1`
        const res=await fetch(url);const text=await res.text()
        try{
          const json=JSON.parse(text);const body=json?.body||json?.response?.body
          const items=body?.items?.item||body?.items||[]
          const arr=Array.isArray(items)?items:[items].filter(Boolean)
          console.log(`[2차] 허가정보 검색 [${nm}]:`,arr.length,'건')
          if(arr.length>0){
            const h=arr[0]
            if(!info.storageMethod&&h.STORAGE_METHOD)info.storageMethod=h.STORAGE_METHOD
            if(h.EDI_CODE)info.insuranceCode=h.EDI_CODE
            if(h.PACK_UNIT)info.packUnit=h.PACK_UNIT
            const mainIngr=h.MAIN_ITEM_INGR||''
            const ingrParts=mainIngr.split(/[;；,，\/]/).map(s=>s.trim()).filter(Boolean)
            const ingrEn=ingrParts.find(p=>isEng(p))||''
            const ingrKr=ingrParts.find(p=>!isEng(p))||''
            if(!info.ingredientKr&&ingrKr)info.ingredientKr=ingrKr
            if(!info.ingredientEn&&ingrEn)info.ingredientEn=ingrEn
            if(!info.ingredientEn&&isEng(mainIngr))info.ingredientEn=mainIngr
            if(!info.ingredientKr&&!isEng(mainIngr)&&mainIngr)info.ingredientKr=mainIngr
            if(h.STORAGE_METHOD)info.storageMethodRaw=h.STORAGE_METHOD
            if(h.PACK_UNIT)info.packUnitRaw=h.PACK_UNIT
            if(h.INJC_PTH_NM)info.route=h.INJC_PTH_NM
            info.permitFound=true
          }
        }catch{}
      }catch(e){console.log('허가정보:',e)}
    }
    /* ── 2차 소스②: 낱알식별 → 모양, 색상 → 성상 정보 ── */
    for(const nm of names){
      if(info.identifyFound)break
      try{
        const url=`/api/datago/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03?item_name=${encodeURIComponent(nm)}&type=json&numOfRows=3&pageNo=1`
        const res=await fetch(url);const text=await res.text()
        try{
          const json=JSON.parse(text);const body=json?.body||json?.response?.body
          const items=body?.items?.item||body?.items||[]
          const arr=Array.isArray(items)?items:[items].filter(Boolean)
          console.log(`[2차] 낱알식별 검색 [${nm}]:`,arr.length,'건')
          if(arr.length>0){
            const d=arr[0]
            info.drugShape=d.DRUG_SHAPE||''
            info.drugAppearance=[d.DRUG_SHAPE,d.COLOR_CLASS1,d.MARK_CODE_FRONT].filter(Boolean).join(' / ')||''
            info.identifyFound=true
          }
        }catch{}
      }catch(e){console.log('낱알식별:',e)}
    }
    /* ── 보조: 약가기준정보 → EDI단가, 보험코드, 급여구분, 성분명 ── */
    for(const nm of names){
      if(info.upperPrice)break
      try{
        const url=`/api/datago/B551182/dgamtCrtrInfoService1.2/getDgamtList?numOfRows=5&pageNo=1&itmNm=${encodeURIComponent(nm)}`
        const res=await fetch(url);const text=await res.text()
        const xml=px.parseFromString(text,'text/xml');const items=xml.querySelectorAll('item')
        console.log(`[보조] 약가 검색 [${nm}]:`,items.length,'건')
        if(items.length>0){
          const allFields={};items[0].childNodes.forEach(n=>{if(n.nodeName!=='#text')allFields[n.nodeName]=n.textContent})
          console.log('약가 API 전체 필드:', allFields)
          const rawKr=allFields.gnlNmCdNm||allFields.cpntNm||allFields.gnlNm||''
          const rawEn=allFields.gnlNmCdEngNm||allFields.engNm||allFields.gnlNmEngNm||''
          const finalKr=isEng(rawKr)?rawEn:rawKr
          const finalEn=isEng(rawKr)?rawKr:(rawEn||'')
          info.upperPrice=allFields.uplmtAmt||allFields.amt||allFields.drugPrc||allFields.uprc||''
          info.insuranceType=allFields.payTpNm||allFields.gnbDivNm||info.insuranceType||''
          if(!info.ingredientKr&&finalKr)info.ingredientKr=finalKr
          if(!info.ingredientEn&&finalEn)info.ingredientEn=finalEn
          info.productCode=info.insuranceCode||allFields.mdsCd||allFields.drugCd||''
          if(!info.manufacturer){info.manufacturer=allFields.mnfEntpNm||allFields.entpNm||''}
          info.gnlNmCode=allFields.gnlNmCd||''
        }
      }catch(e){console.log('약가조회:',e)}
    }
    /* ── 보조: 성분약효정보 → 약효분류명 ── */
    const gnlNmCd=info.gnlNmCode||''
    const parenMatch=drugName.match(/[(\（]([^)\）]+)[)\）]/)
    const ingredientInParen=parenMatch?parenMatch[1]:''
    let foundEff=false
    if(gnlNmCd&&!foundEff){
      try{
        const url2=`/api/datago/B551182/msupCmpnMeftInfoService/getMajorCmpnNmCdList?numOfRows=10&pageNo=1&gnlNmCd=${encodeURIComponent(gnlNmCd)}`
        const res2=await fetch(url2);const text2=await res2.text()
        const xml2=px.parseFromString(text2,'text/xml');const items2=xml2.querySelectorAll('item')
        console.log(`[보조] 성분약효 코드검색 [${gnlNmCd}]:`, items2.length, '건')
        if(items2.length>0){
          const it=items2[0];const g2=tag=>it.querySelector(tag)?.textContent||''
          info.efficacyClass=g2('divNm');info.efficacyCode=g2('meftDivNo');info.gnlNmCodeResult=g2('gnlNmCd')
          info.dosage=g2('iqtyTxt');info.dosageUnit=g2('unit')
          info.efficacyRoute=g2('injcPthCdNm')||info.route
          if(!info.ingredientKr){const gn=g2('gnlNm');if(gn&&isEng(gn)){if(!info.ingredientEn)info.ingredientEn=gn}else if(gn){info.ingredientKr=gn}}
          foundEff=true
        }
      }catch(e){console.log('성분약효 코드검색:',e)}
    }
    if(!foundEff){
      const searchTerms=[info.ingredientKr,ingredientInParen,ingredientFromSearch&&!ingredientFromSearch.startsWith('이 약은')?ingredientFromSearch:''].filter(s=>s&&s.length>1)
      for(const term of searchTerms){
        try{
          const url2=`/api/datago/B551182/msupCmpnMeftInfoService/getMajorCmpnNmCdList?numOfRows=10&pageNo=1&gnlNm=${encodeURIComponent(term)}`
          const res2=await fetch(url2);const text2=await res2.text()
          const xml2=px.parseFromString(text2,'text/xml');const items2=xml2.querySelectorAll('item')
          console.log(`[보조] 성분약효 이름검색 [${term}]:`,items2.length,'건')
          if(items2.length>0){
            const it=items2[0];const g2=tag=>it.querySelector(tag)?.textContent||''
            info.efficacyClass=g2('divNm');info.efficacyCode=g2('meftDivNo');info.gnlNmCodeResult=g2('gnlNmCd')
            info.dosage=g2('iqtyTxt');info.dosageUnit=g2('unit')
            info.efficacyRoute=g2('injcPthCdNm')||info.route
            if(!info.ingredientKr){const gn=g2('gnlNm');if(gn&&isEng(gn)){if(!info.ingredientEn)info.ingredientEn=gn}else if(gn){info.ingredientKr=gn}}
            foundEff=true;break
          }
        }catch(e){console.log('성분약효 이름검색:',e)}
      }
    }
    setPriceInfo(Object.keys(info).length>0?info:{notFound:true})
    setPriceLoading(false)
  }

  async function searchApi() {
    if(!apiQuery.trim()){setApiMsg('검색어를 입력해 주세요');return}
    setApiLoading(true);setApiResults([]);setApiMsg(null)
    try{
      /* 1차: 허가정보(전체 허가품목 — 전문+일반+주사제) 검색 */
      let result=await searchDrugAPI(apiQuery,'permit')
      /* 2차: 결과 없으면 e약은요(일반의약품) 검색 */
      if(result.ok&&(!result.data||result.data.length===0)){
        result=await searchDrugAPI(apiQuery,'easy')
      }
      if(!result.ok){setApiMsg(result.msg||'검색 실패');setApiLoading(false);return}
      if(!result.data||result.data.length===0){setApiMsg('검색 결과가 없습니다');setApiLoading(false);return}
      setApiResults(result.data)
    }catch(err){setApiMsg('네트워크 오류: '+err.message)}
    setApiLoading(false)
  }

  function applyResult(item) {
    const ing=item.ingredient||''
    const isEng=s=>s&&/^[a-zA-Z\s()\[\]\-,.:;0-9]+$/.test(s)
    const enVal=item.ingredientEn||(isEng(ing)?ing:'')
    const krVal=item.ingredientKr||(!isEng(ing)&&ing?ing:'')
    const parenKr=(item.name||'').match(/[(\（]([가-힣\s]+)[)\）]/)?.[1]||''
    setForm(f=>({...f,
      drug_name:item.name||f.drug_name,
      manufacturer:item.manufacturer||f.manufacturer,
      ingredient_en:enVal||f.ingredient_en,
      ingredient_kr:krVal||parenKr||f.ingredient_kr,
      efficacy:item.efficacy||f.efficacy,
      storage_method:item.storage?stdStorage(item.storage):f.storage_method,
      unit:item.unit||f.unit,
      specification:item.packUnit||f.specification,
      insurance_code:item.insuranceCode||f.insurance_code,
    }))
    setApiResults([]);setApiQuery('');setApiMsg(null)
    fetchDrugPrice(item.name||'', item.ingredient||'')
  }

  /* priceInfo 변경 시 폼 자동 채움 — API 2(수정모달) 패턴 적용 */
  useEffect(()=>{
    if(!priceInfo||priceInfo.notFound)return
    const v=(apiVal,formVal)=>apiVal!==undefined&&apiVal!==null&&apiVal!==''?apiVal:formVal
    setForm(f=>({...f,
      ingredient_en:v(priceInfo.ingredientEn,f.ingredient_en),
      ingredient_kr:v(priceInfo.ingredientKr,f.ingredient_kr),
      efficacy_class:v(priceInfo.efficacyClass,f.efficacy_class),
      efficacy:v(priceInfo.efficacy,f.efficacy),
      unit:v(priceInfo.dosageUnit,v(priceInfo.packUnit,f.unit)),
      specification:v(priceInfo.packUnitRaw,v(priceInfo.dosage,f.specification)),
      insurance_price:priceInfo.upperPrice?Math.round(Number(priceInfo.upperPrice)):f.insurance_price,
      price_unit:priceInfo.upperPrice?Math.round(Number(priceInfo.upperPrice)):f.price_unit,
      insurance_type:priceInfo.insuranceType?.includes('급여')?'급여':priceInfo.insuranceType?.includes('비급여')?'비급여':f.insurance_type,
      insurance_code:v(priceInfo.insuranceCode,v(priceInfo.productCode,f.insurance_code)),
      storage_method:priceInfo.storageMethod?stdStorage(priceInfo.storageMethod):f.storage_method,
      manufacturer:v(priceInfo.manufacturer,f.manufacturer),
    }))
  },[priceInfo])

  function set(k,v){setForm(f=>({...f,[k]:v}))}

  async function submit(){
    if(!form.drug_code.trim()){setMsg({type:'error',text:'약품코드를 입력해 주세요'});return}
    if(!form.drug_name.trim()){setMsg({type:'error',text:'약품명을 입력해 주세요'});return}
    setSaving(true)
    const row={
      drug_code:form.drug_code.trim().toUpperCase(),
      drug_name:form.drug_name.trim(),
      category:form.category,
      manufacturer:form.manufacturer,
      ingredient_kr:form.ingredient_kr,
      ingredient_en:form.ingredient_en,
      efficacy_class:form.efficacy_class||null,
      efficacy:form.efficacy||null,
      specification:form.specification||null,
      unit:form.unit||null,
      price_unit:Number(form.insurance_price)||Number(form.price_unit)||0,
      insurance_price:Number(form.insurance_price)||0,
      insurance_type:form.insurance_type,
      insurance_code:form.insurance_code||null,
      current_qty:Number(form.current_qty)||0,
      expiry_date:form.expiry_date||null,
      lot_no:form.lot_no||null,
      storage_method:form.storage_method||null,
      status:form.status,
      is_narcotic:form.narcotic_type!=='해당없음',
      narcotic_type:form.narcotic_type==='해당없음'?null:form.narcotic_type,
    }
    /* 누락 컬럼 자동 제거 후 재시도 (최대 3회) */
    let res=await supabase.from('drugs').insert([row])
    for(let retry=0;retry<3&&res.error&&res.error.message.includes('column');retry++){
      const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete row[m[1]];console.log('누락 컬럼 제거:',m[1])
      res=await supabase.from('drugs').insert([row])
    }
    const error=res.error
    setSaving(false)
    if(error){
      const msg2=error.message.includes('duplicate')||error.message.includes('unique')
        ?'이미 존재하는 약품코드입니다.':'등록 실패: '+error.message
      setMsg({type:'error',text:msg2});return
    }
    setMsg({type:'success',text:`${form.drug_name} 등록 완료!`})
    setForm(initForm);onRefresh()
    setTimeout(()=>setMsg(null),3000)
  }

  function edts(v){if(!v) return '';if(typeof v==='string'&&v.includes('-')) return v;if(typeof v==='number'){const d=new Date(Math.round((v-25569)*86400*1000));return d.toISOString().split('T')[0]}return String(v)}

  function xlUpload(e){
    const file=e.target.files[0];if(!file) return;setBulkMsg(null)
    const reader=new FileReader()
    reader.onload=ev=>{
      try{
        const wb2=XLSX.read(ev.target.result,{type:'array'})
        const rows=XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]],{defval:''})
        if(rows.length===0){setBulkMsg({type:'error',text:'데이터가 없습니다.'});return}
        const parsed=rows.map((r,i)=>{
          const code=String(r['약품코드']||r['약품코드(필수)']||r['drug_code']||'').trim().toUpperCase()
          const nt=String(r['향정']||r['향정마약']||r['narcotic_type']||'').trim()
          return{
            idx:i+1,drug_code:code,
            drug_name:String(r['약품명']||r['약품명(필수)']||r['drug_name']||'').trim(),
            category:String(r['구분']||r['category']||'경구제').trim(),
            ingredient_en:String(r['성분명(영문)']||r['성분명(영어)']||r['ingredient_en']||'').trim(),
            ingredient_kr:String(r['성분명(한글)']||r['성분명']||r['ingredient_kr']||'').trim(),
            efficacy_class:String(r['약효분류']||r['약효분류명']||r['efficacy_class']||'').trim(),
            efficacy:String(r['효능']||r['efficacy']||'').trim(),
            manufacturer:String(r['제조사']||r['manufacturer']||'').trim(),
            unit:String(r['단위']||r['unit']||'').trim(),
            specification:String(r['규격']||r['specification']||'').trim(),
            price_unit:Number(r['단가']||r['price_unit']||0),
            insurance_price:Number(r['EDI단가']||r['보험가']||r['insurance_price']||0),
            current_qty:Number(r['현재고']||r['current_qty']||0),
            insurance_type:String(r['급여구분']||r['insurance_type']||'급여').trim(),
            insurance_code:String(r['보험코드']||r['insurance_code']||'').trim(),
            expiry_date:edts(r['유효기한']||r['expiry_date']||''),
            lot_no:String(r['LOT번호']||r['lot_no']||'').trim(),
            storage_method:String(r['보관']||r['보관방법']||r['storage_method']||'').trim(),
            status:String(r['상태']||r['status']||'사용').trim(),
            is_narcotic:nt==='향정신성'||nt==='향정'||nt==='마약'||nt==='Y',
            narcotic_type:nt==='Y'?'향정':(nt==='마약'?'마약':(nt==='향정'?'향정':null)),
            valid:!!code&&!!(String(r['약품명']||r['약품명(필수)']||r['drug_name']||'').trim())
          }
        })
        setBulk(parsed)
        setBulkMsg({type:'info',text:`${parsed.length}행 읽음 · 유효: ${parsed.filter(r=>r.valid).length}행 · 오류: ${parsed.filter(r=>!r.valid).length}행`})
      }catch(err){setBulkMsg({type:'error',text:'파일 읽기 오류: '+err.message})}
    }
    reader.readAsArrayBuffer(file);e.target.value=''
  }

  async function bulkSubmit(){
    const valid=bulk.filter(r=>r.valid)
    if(valid.length===0){setBulkMsg({type:'error',text:'등록 가능한 데이터가 없습니다.'});return}
    setBulkLoading(true)
    const{error}=await supabase.from('drugs').insert(valid.map(r=>({
      drug_code:r.drug_code,drug_name:r.drug_name,category:r.category||'경구제',
      manufacturer:r.manufacturer||null,ingredient_kr:r.ingredient_kr||null,ingredient_en:r.ingredient_en||null,
      efficacy_class:r.efficacy_class||null,efficacy:r.efficacy||null,specification:r.specification||null,unit:r.unit||null,
      price_unit:r.price_unit||0,insurance_price:r.insurance_price||0,insurance_type:r.insurance_type||'급여',
      insurance_code:r.insurance_code||null,storage_method:r.storage_method?stdStorage(r.storage_method):'실온',
      status:r.status||'사용',is_narcotic:r.is_narcotic,narcotic_type:r.narcotic_type||null,
      current_qty:r.current_qty||0,expiry_date:r.expiry_date||null,lot_no:r.lot_no||null,
    })))
    setBulkLoading(false)
    if(error){setBulkMsg({type:'error',text:'등록 실패: '+error.message});return}
    setBulkMsg({type:'success',text:`${valid.length}건 일괄 등록 완료!`})
    setBulk([]);onRefresh();setTimeout(()=>setBulkMsg(null),4000)
  }

  function dlTemplate(){
    const ws=XLSX.utils.aoa_to_sheet([
      ['약품코드','약품명','구분','성분명(영문)','성분명(한글)','약효분류','효능','제조사','단위','규격','단가','EDI단가','현재고','급여구분','보험코드','유효기한','LOT번호','보관','상태','향정'],
      ['NEWDRUG001','신규약품정1mg','경구제','ingredient','성분명','소화기계질환','해열 진통 효능','제조사명','정','100',1000,1000,100,'급여','64XXXXXX','2028-12-31','LOT001','실온','사용','일반'],
      ['','','','','','','','','','','','','','','','','','','','← 필수: 약품코드, 약품명만 입력하면 등록 가능'],
    ])
    ws['!cols']=DRUG_COLS.map(()=>({wch:16}))
    const wb2=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb2,ws,'기초정보등록')
    XLSX.writeFile(wb2,'기초정보_업로드_양식.xlsx')
  }

  const inp={width:'100%',padding:'9px 12px',border:`1.5px solid ${C.grayB}`,borderRadius:8,fontSize:13,outline:'none',boxSizing:'border-box'}
  const lbl={fontSize:12,color:'#666',marginBottom:4,display:'block',fontWeight:500}
  const tabBtn=active=>({padding:'8px 20px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:active?C.purple:C.grayL,color:active?'#fff':'#888'})

  return(
    <div style={{padding:'20px 28px'}}>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <button style={tabBtn(mode==='single')} onClick={()=>setMode('single')}>개별 등록</button>
        <button style={tabBtn(mode==='bulk')} onClick={()=>setMode('bulk')}>엑셀 대량 등록</button>
      </div>

      {mode==='single'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <div style={{background:'#fff',borderRadius:12,border:`0.5px solid ${C.grayB}`,padding:'22px 24px'}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:16,paddingBottom:12,borderBottom:`0.5px solid ${C.grayB}`}}>
              신규 약품 기초정보 등록
            </div>

            {/* 공공API 검색 */}
            <div style={{background:C.purpleL,borderRadius:10,padding:'14px 16px',marginBottom:16,border:`0.5px solid ${C.purpleB}`}}>
              <div style={{fontSize:12,color:C.purple,fontWeight:600,marginBottom:8}}>🔍 공공데이터 API 검색 (허가정보)</div>
              <div style={{display:'flex',gap:8}}>
                <input value={apiQuery} onChange={e=>setApiQuery(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&searchApi()}
                  placeholder="약품명으로 검색 후 클릭하면 자동입력"
                  style={{flex:1,padding:'8px 12px',border:`1.5px solid ${C.purpleB}`,borderRadius:8,fontSize:13,outline:'none'}}
                  onFocus={e=>e.target.style.borderColor=C.purple}
                  onBlur={e=>e.target.style.borderColor=C.purpleB}/>
                <button onClick={searchApi} disabled={apiLoading}
                  style={{padding:'8px 16px',borderRadius:8,border:'none',background:apiLoading?C.grayB:C.purple,color:'#fff',cursor:apiLoading?'not-allowed':'pointer',fontSize:13,fontWeight:600,whiteSpace:'nowrap'}}>
                  {apiLoading?'검색중...':'검색'}
                </button>
              </div>
              {apiMsg&&<div style={{fontSize:12,color:C.coral,marginTop:6}}>{apiMsg}</div>}
              {apiResults.length>0&&(
                <div style={{marginTop:8,background:'#fff',borderRadius:8,border:`0.5px solid ${C.purpleB}`,maxHeight:180,overflowY:'auto'}}>
                  <div style={{fontSize:11,color:'#888',padding:'6px 12px',borderBottom:`0.5px solid ${C.grayB}`}}>
                    {apiResults.length}개 결과 · 클릭하면 자동 입력
                  </div>
                  {apiResults.map((item,i)=>(
                    <div key={i} onClick={()=>applyResult(item)}
                      style={{padding:'9px 12px',borderBottom:`0.5px solid #f5f5f5`,cursor:'pointer',fontSize:13}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.purpleL}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <div style={{fontWeight:600,color:'#333',textAlign:'left'}}>{item.name||'-'}</div>
                      <div style={{fontSize:11,color:'#888',marginTop:2}}>{item.manufacturer||''} {item.ingredient?`· ${item.ingredient}`:''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 약가기준정보 카드 */}
            {priceLoading&&<div style={{padding:'10px 14px',background:C.purpleL,borderRadius:8,marginTop:8,fontSize:12,color:C.purple}}>💊 약가·약효 정보 조회 중...</div>}
            {priceInfo&&!priceInfo.notFound&&<div style={{marginTop:8,background:'#fff',borderRadius:10,border:`1px solid ${C.purpleB}`,padding:'14px 18px'}}>
              <div style={{fontSize:13,fontWeight:700,color:C.purple,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.grayB}`}}>💊 약가기준정보 + 성분약효정보 (심평원)</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:12}}>
                {priceInfo.insuranceType&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>급여구분</span><div style={{fontWeight:600,color:priceInfo.insuranceType.includes('삭제')?C.coral:priceInfo.insuranceType.includes('급여')?C.green:C.coral,cursor:'text',userSelect:'text'}}>{priceInfo.insuranceType}</div></div>}
                {priceInfo.ingredientEn&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>성분명(영문)</span><div style={{fontWeight:500,fontStyle:'italic',fontSize:11,cursor:'text',userSelect:'text'}}>{priceInfo.ingredientEn}</div></div>}
                {priceInfo.ingredientKr&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>성분명(한글)</span><div style={{fontWeight:500,cursor:'text',userSelect:'text'}}>{priceInfo.ingredientKr}</div></div>}
                {priceInfo.drugAppearance&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>성상</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.drugAppearance}</div></div>}
                {priceInfo.dosage&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>함량</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.dosage}{priceInfo.dosageUnit?' '+priceInfo.dosageUnit:''}</div></div>}
                {priceInfo.manufacturer&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>제조사</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.manufacturer}</div></div>}
                {priceInfo.upperPrice&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>상한가</span><div style={{fontWeight:700,color:C.green,fontSize:14,cursor:'text',userSelect:'text'}}>₩{Number(priceInfo.upperPrice).toLocaleString()}</div></div>}
                {(priceInfo.efficacyRoute||priceInfo.route)&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>투여경로</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.efficacyRoute||priceInfo.route}</div></div>}
                {priceInfo.productCode&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>제품코드</span><div style={{fontFamily:'monospace',fontSize:11,cursor:'text',userSelect:'text'}}>{priceInfo.productCode}</div></div>}
                {priceInfo.storageMethod&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>보관방법</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.storageMethod}</div></div>}
                {(priceInfo.packUnit||priceInfo.packUnitRaw)&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>포장단위</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.packUnitRaw||priceInfo.packUnit}</div></div>}
                {priceInfo.dosageUnit&&<div style={{padding:'4px 0'}}><span style={{color:'#888',fontSize:10}}>단위</span><div style={{cursor:'text',userSelect:'text'}}>{priceInfo.dosageUnit}</div></div>}
              </div>
              {/* 약효분류 정보 */}
              {priceInfo.efficacyClass?<div style={{marginTop:10,padding:'10px 14px',background:'#F5EDF6',borderRadius:8,border:`1px solid ${C.purpleB}`}}>
                <div style={{fontSize:11,color:'#888',marginBottom:4}}>약효분류</div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{background:C.purple,color:'#fff',padding:'2px 10px',borderRadius:12,fontSize:12,fontWeight:700,cursor:'text',userSelect:'text'}}>{priceInfo.efficacyClass}</span>
                  {priceInfo.efficacyCode&&<span style={{fontSize:11,color:'#888'}}>분류번호: {priceInfo.efficacyCode}</span>}
                </div>
                {priceInfo.dosage&&<div style={{marginTop:6,fontSize:11,color:'#666',cursor:'text',userSelect:'text'}}>
                  {priceInfo.dosage&&<span>함량: {priceInfo.dosage}{priceInfo.dosageUnit?' '+priceInfo.dosageUnit:''}</span>}
                  {priceInfo.gnlNmCode&&<span style={{marginLeft:8}}>일반명코드: {priceInfo.gnlNmCode}</span>}
                </div>}
              </div>:<div style={{marginTop:10,padding:'8px 14px',background:'#FFF8F0',borderRadius:8,border:'1px solid #FFE0B2',fontSize:11,color:'#E65100'}}>약효분류: 해당 성분의 약효분류 데이터를 찾을 수 없습니다 (F12 → Console에서 검색 로그 확인)</div>}
              <div style={{marginTop:8,fontSize:9,color:'#bbb',textAlign:'right'}}>각 항목을 드래그하여 복사할 수 있습니다</div>
            </div>}
            {priceInfo?.notFound&&<div style={{marginTop:8,padding:'8px 14px',background:C.grayL,borderRadius:8,fontSize:11,color:'#888'}}>약가기준정보: 해당 약품의 약가 데이터를 찾을 수 없습니다</div>}

            {msg&&<div style={{background:msg.type==='success'?C.greenL:C.coralL,border:`1px solid ${msg.type==='success'?C.greenB:C.coralB}`,borderRadius:8,padding:'10px 14px',marginBottom:14,color:msg.type==='success'?C.greenD:C.coral,fontSize:13}}>{msg.text}</div>}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>약품코드 <span style={{color:C.coral}}>*</span></label><input value={form.drug_code} onChange={e=>set('drug_code',e.target.value.toUpperCase())} placeholder="원내코드 입력" style={inp}/></div>
              <div><label style={lbl}>구분</label><select value={form.category} onChange={e=>set('category',e.target.value)} style={{...inp,background:'#fff'}}>{['경구제','주사제','외용제','수액제','영양제','의약외품'].map(c=><option key={c}>{c}</option>)}</select></div>
            </div>
            <div style={{marginBottom:12}}><label style={lbl}>약품명 <span style={{color:C.coral}}>*</span></label><input value={form.drug_name} onChange={e=>set('drug_name',e.target.value)} placeholder="약품명 (API 자동입력)" style={inp}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>성분명(영어)</label><input value={form.ingredient_en} onChange={e=>set('ingredient_en',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
              <div><label style={lbl}>성분명(한글)</label><input value={form.ingredient_kr} onChange={e=>set('ingredient_kr',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>약효분류명</label><input value={form.efficacy_class} onChange={e=>set('efficacy_class',e.target.value)} placeholder="API 자동입력 (예:소화기계질환)" style={inp}/></div>
              <div><label style={lbl}>효능</label><input value={form.efficacy} onChange={e=>set('efficacy',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={lbl}>제조/수입사</label><input value={form.manufacturer} onChange={e=>set('manufacturer',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>규격</label><input value={form.specification} onChange={e=>set('specification',e.target.value)} placeholder="포장단위 (API 자동입력)" style={inp}/></div>
              <div><label style={lbl}>단위</label><input value={form.unit} onChange={e=>set('unit',e.target.value)} placeholder={form.unit||'API 조회 시 자동입력'} style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>EDI단가</label><input type="number" value={form.insurance_price} onChange={e=>set('insurance_price',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
              <div><label style={lbl}>현재고</label><input type="number" value={form.current_qty} onChange={e=>set('current_qty',e.target.value)} placeholder="0" style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>급여구분</label><div style={{display:'flex',gap:4}}>{['급여','비급여'].map(x=><button key={x} onClick={()=>set('insurance_type',x)} style={{flex:1,padding:'8px',borderRadius:6,border:`2px solid ${form.insurance_type===x?C.green:'transparent'}`,cursor:'pointer',background:form.insurance_type===x?C.greenL:C.grayL,color:form.insurance_type===x?C.green:'#999',fontWeight:600,fontSize:12}}>{x}</button>)}</div></div>
              <div><label style={lbl}>보험코드</label><input value={form.insurance_code} onChange={e=>set('insurance_code',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>유효기한</label><input type="date" value={form.expiry_date} onChange={e=>set('expiry_date',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>LOT번호</label><input value={form.lot_no} onChange={e=>set('lot_no',e.target.value)} placeholder="LOT번호 입력" style={inp}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={lbl}>보관방법</label><select value={form.storage_method} onChange={e=>set('storage_method',e.target.value)} style={{...inp,background:'#fff'}}>{STORAGE_OPTS.map(s=><option key={s}>{s}</option>)}</select></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
              <div><label style={lbl}>상태</label><select value={form.status} onChange={e=>set('status',e.target.value)} style={{...inp,background:'#fff'}}>{['사용','휴면','중지'].map(s=><option key={s}>{s}</option>)}</select></div>
              <div><label style={lbl}>향정마약</label><select value={form.narcotic_type} onChange={e=>set('narcotic_type',e.target.value)} style={{...inp,background:'#fff'}}>{['해당없음','향정','마약'].map(s=><option key={s}>{s}</option>)}</select></div>
            </div>
            <button onClick={submit} disabled={saving} style={{width:'100%',padding:12,borderRadius:10,border:'none',cursor:saving?'not-allowed':'pointer',background:saving?C.grayB:C.purple,color:'#fff',fontSize:14,fontWeight:700}}>
              {saving?'등록 중...':'약품 등록'}
            </button>
          </div>

          <div style={{background:C.purpleL,borderRadius:12,padding:'18px 20px',border:`0.5px solid ${C.purpleB}`,alignSelf:'start'}}>
            <div style={{fontSize:14,fontWeight:600,color:C.purple,marginBottom:10}}>등록 안내</div>
            <div style={{fontSize:12,color:C.purpleD,lineHeight:1.9}}>
              • <strong>공공데이터 검색</strong>으로 약품명 자동 입력<br/>
              • <strong>약품코드</strong>: 고유한 코드 (중복 불가)<br/>
              • 등록 후 <strong>약품목록</strong>에서 수정 가능<br/>
              • 여러 약품은 <strong>엑셀 대량 등록</strong> 탭 활용
            </div>
          </div>
        </div>
      )}

      {mode==='bulk'&&(
        <div style={{background:'#fff',borderRadius:12,border:`0.5px solid ${C.grayB}`,padding:'22px 24px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18,paddingBottom:12,borderBottom:`0.5px solid ${C.grayB}`}}>
            <div style={{fontSize:15,fontWeight:700}}>기초정보 엑셀 대량 등록</div>
            <button onClick={dlTemplate} style={{padding:'8px 16px',borderRadius:8,border:`1px solid ${C.purple}`,background:C.purpleL,color:C.purple,cursor:'pointer',fontSize:12,fontWeight:500}}>양식 다운로드</button>
          </div>
          <div style={{background:C.grayL,border:`2px dashed ${C.grayB}`,borderRadius:10,padding:'36px',textAlign:'center',marginBottom:16,cursor:'pointer'}}
            onClick={()=>fileRef.current.click()}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.purple}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.grayB}>
            <div style={{fontSize:40,marginBottom:10}}>📋</div>
            <div style={{fontSize:14,fontWeight:500,color:'#555',marginBottom:4}}>엑셀 파일을 클릭하여 선택하세요</div>
            <div style={{fontSize:12,color:'#aaa'}}>.xlsx / .xls 파일 지원</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={xlUpload} style={{display:'none'}}/>
          </div>
          {bulkMsg&&<div style={{background:bulkMsg.type==='success'?C.greenL:bulkMsg.type==='error'?C.coralL:C.blueL,border:`1px solid ${bulkMsg.type==='success'?C.greenB:bulkMsg.type==='error'?C.coralB:C.blueB}`,borderRadius:8,padding:'10px 14px',marginBottom:14,color:bulkMsg.type==='success'?C.greenD:bulkMsg.type==='error'?C.coral:C.blue,fontSize:13}}>{bulkMsg.text}</div>}
          {bulk.length>0&&(
            <>
              <div style={{overflowX:'auto',marginBottom:14,maxHeight:380,overflowY:'auto',border:`0.5px solid ${C.grayB}`,borderRadius:8}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0}}><tr style={{background:'#fafafa'}}>
                    {['#','상태','약품코드','약품명','구분','제조사','단가','현재고','유효기한','상태','향정'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:'#666',fontWeight:500,borderBottom:`0.5px solid ${C.grayB}`,whiteSpace:'nowrap'}}>{h}</th>)}
                  </tr></thead>
                  <tbody>{bulk.map((r,i)=>(
                    <tr key={i} style={{borderBottom:`0.5px solid #f5f5f5`,background:r.valid?'':C.coralL+'50'}}>
                      <td style={{padding:'7px 10px',color:'#bbb'}}>{r.idx}</td>
                      <td style={{padding:'7px 10px'}}>{r.valid?<span style={{background:C.greenL,color:C.greenD,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:600}}>정상</span>:<span style={{background:C.coralL,color:C.coral,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:600}}>오류</span>}</td>
                      <td style={{padding:'7px 10px',fontFamily:'monospace',fontSize:10,color:'#888'}}>{r.drug_code||'없음'}</td>
                      <td style={{padding:'7px 10px',fontWeight:500,textAlign:'left'}}>{r.drug_name||'-'}</td>
                      <td style={{padding:'7px 10px',color:'#666'}}>{r.category}</td>
                      <td style={{padding:'7px 10px',color:'#888'}}>{r.manufacturer||'-'}</td>
                      <td style={{padding:'7px 10px',textAlign:'right'}}>{r.price_unit?.toLocaleString()}</td>
                      <td style={{padding:'7px 10px',textAlign:'right'}}>{r.current_qty?.toLocaleString()}</td>
                      <td style={{padding:'7px 10px',color:'#888'}}>{r.expiry_date||'-'}</td>
                      <td style={{padding:'7px 10px'}}><SB s={r.status}/></td>
                      <td style={{padding:'7px 10px'}}>{r.is_narcotic?<span style={{background:C.lavL,color:C.lavender,padding:'1px 6px',borderRadius:4,fontSize:10}}>향정</span>:'-'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setBulk([]);setBulkMsg(null)}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.grayB}`,cursor:'pointer',background:'#fff',color:'#888',fontSize:13}}>취소</button>
                <button onClick={bulkSubmit} disabled={bulkLoading||bulk.filter(r=>r.valid).length===0}
                  style={{flex:2,padding:11,borderRadius:10,border:'none',cursor:bulkLoading?'not-allowed':'pointer',background:bulkLoading?C.grayB:C.purple,color:'#fff',fontSize:14,fontWeight:700}}>
                  {bulkLoading?'등록 중...':`정상 ${bulk.filter(r=>r.valid).length}건 일괄 등록`}
                </button>
              </div>
            </>
          )}
          <div style={{marginTop:18,background:C.purpleL,borderRadius:10,padding:'14px 16px',fontSize:12,color:C.purpleD,lineHeight:1.9,border:`0.5px solid ${C.purpleB}`}}>
            <strong>엑셀 양식 안내</strong><br/>
            필수 필드: <strong>약품코드, 약품명</strong> (2개만 채워도 등록 가능)<br/>
            컬럼 순서: 의약품 목록과 동일 (20컬럼)<br/>
            향정: 일반/향정/마약 · 보관: 실온/실온·차광/냉장/냉장·차광<br/>
            구분: 경구제/주사제/외용제/수액제/영양제/의약외품
          </div>
        </div>
      )}
      <Ft/>
    </div>
  )
}
/* ═══ 입출고 관리 — 4탭 구조 (입고/출고/반품/폐기) ═══ */
function TransactionForm({drugs,onReload}){
  const{t}=useTheme();
  const[tab,setTab]=useState('입고')
  const[search,setSearch]=useState('');const[selDrug,setSelDrug]=useState(null)
  const[form,setForm]=useState({qty:'',sub_type:'',note:'',supplier:'',lot_no:'',expiry_date:'',reason:'',handler:'이정화',approver:'',process_status:'처리완료'})
  const[saving,setSaving]=useState(false);const[msg,setMsg]=useState(null)
  const[txns,setTxns]=useState([]);const[txPage,setTxPage]=useState(1)
  const[bulkData,setBulkData]=useState([]);const[bulkMsg,setBulkMsg]=useState(null);const[bulkLd,setBulkLd]=useState(false)
  const fileRef=useRef()
  const{hs,so,SI,TS}=useSort('transaction_date','desc')
  useEffect(()=>{loadTxns()},[tab])
  async function loadTxns(){const{data}=await supabase.from('transactions').select('*').eq('type',tab).order('transaction_date',{ascending:false}).limit(200);setTxns(data||[]);setTxPage(1)}
  const filtered=drugs.filter(d=>d.status==='사용'&&search.trim()&&(d.drug_name?.toLowerCase().includes(search.toLowerCase())||d.drug_code?.toLowerCase().includes(search.toLowerCase())))
  function sf(k,v){setForm(p=>({...p,[k]:v}))}
  const subs=tab==='입고'?IN_SUBS:tab==='출고'?OUT_SUBS:[]
  const reasons=tab==='반품'?RET_REASONS:tab==='폐기'?DSP_REASONS:[]
  const tc={'입고':{bg:t.greenL,c:t.green},'출고':{bg:t.blueL,c:t.blue},'반품':{bg:t.amberL,c:t.amber},'폐기':{bg:t.redL,c:t.red}}
  const ip={width:'100%',padding:'8px 10px',border:`1px solid ${t.border}`,borderRadius:6,fontSize:12,outline:'none',background:t.bg,color:t.text,boxSizing:'border-box'}

  async function submit(){
    if(!selDrug||!form.qty){setMsg('약품과 수량을 입력해주세요');return}
    if((tab==='반품'||tab==='폐기')&&!form.reason){setMsg('사유를 선택해주세요');return}
    setSaving(true);setMsg(null)
    const q=parseInt(form.qty);const amt=q*(selDrug.price_unit||0)
    const tx={drug_code:selDrug.drug_code,drug_name:selDrug.drug_name,type:tab,sub_type:form.sub_type||null,quantity:q,unit_price:selDrug.price_unit||0,total_amount:amt,note:form.note||null,transaction_date:new Date().toISOString().split('T')[0],reason:form.reason||null,handler:form.handler||null,approver:form.approver||null,process_status:form.process_status||null,supplier:form.supplier||null,lot_no:form.lot_no||null,expiry_date:form.expiry_date||null}
    let res=await supabase.from('transactions').insert([tx])
    for(let r=0;r<3&&res.error&&res.error.message?.includes('column');r++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete tx[m[1]];res=await supabase.from('transactions').insert([tx])}
    if(res.error){setMsg('오류: '+res.error.message);setSaving(false);return}
    const newQty=tab==='입고'?((selDrug.current_qty||0)+q):Math.max(0,(selDrug.current_qty||0)-q)
    await supabase.from('drugs').update({current_qty:newQty}).eq('drug_code',selDrug.drug_code)
    setMsg(`${tab} 완료! ${selDrug.drug_name} ${q}개`);setSelDrug(null);setSearch('');setForm(p=>({...p,qty:'',note:'',lot_no:'',expiry_date:'',reason:'',supplier:''}));setSaving(false);onReload?.();loadTxns()
    setTimeout(()=>setMsg(null),3000)
  }
  async function delTx(tx){
    if(!confirm(`${tx.drug_name} ${tx.type} ${tx.quantity}개를 삭제하시겠습니까?`))return
    await supabase.from('transactions').delete().eq('id',tx.id)
    const d=drugs.find(x=>x.drug_code===tx.drug_code)
    if(d){const revert=tx.type==='입고'?Math.max(0,(d.current_qty||0)-tx.quantity):(d.current_qty||0)+tx.quantity;await supabase.from('drugs').update({current_qty:revert}).eq('drug_code',tx.drug_code)}
    onReload?.();loadTxns()
  }
  /* 엑셀 대량 업로드 */
  function xlUpload(e){
    const file=e.target.files[0];if(!file)return;setBulkMsg(null)
    const reader=new FileReader();reader.onload=ev=>{
      try{const wb=XLSX.read(ev.target.result,{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})
      if(!rows.length){setBulkMsg('데이터 없음');return}
      const parsed=rows.map((r,i)=>{
        const code=String(r['약품코드']||r['drug_code']||'').trim().toUpperCase()
        const drug=drugs.find(d=>d.drug_code===code)
        const qtyVal=Number(r[tab==='입고'?'입고수량':tab==='출고'?'출고수량':tab==='반품'?'반품수량':'폐기수량']||r['수량']||r['quantity']||0)
        const price=Number(r['단가']||r['unit_price']||drug?.price_unit||0)
        return{idx:i+1,drug_code:code,drug_name:drug?.drug_name||r['약품명']||'',found:!!drug,quantity:qtyVal,unit_price:price,total_amount:qtyVal*price,
          sub_type:String(r['구분']||r['sub_type']||'').trim(),note:String(r['비고']||'').trim(),supplier:String(r['공급업체']||'').trim(),
          lot_no:String(r['로트번호']||r['LOT번호']||'').trim(),expiry_date:String(r['유효기한']||'').trim(),
          reason:String(r[tab==='반품'?'반품사유':'폐기사유']||r['사유']||'').trim(),handler:String(r['처리자']||'이정화').trim(),approver:String(r['승인자']||'').trim(),
          process_status:String(r['처리상태']||'처리완료').trim(),transaction_date:String(r[tab+'일자']||r['일자']||new Date().toISOString().split('T')[0]).trim()}
      })
      setBulkData(parsed);setBulkMsg(`${parsed.length}행 · 매칭: ${parsed.filter(r=>r.found).length} · 미매칭: ${parsed.filter(r=>!r.found).length}`)
      }catch(err){setBulkMsg('오류: '+err.message)}
    };reader.readAsArrayBuffer(file);e.target.value=''
  }
  async function bulkSubmit(){
    const valid=bulkData.filter(r=>r.found&&r.quantity>0)
    if(!valid.length){setBulkMsg('등록 가능한 데이터 없음');return}
    setBulkLd(true)
    let ok=0,fail=0
    for(const r of valid){
      const tx={drug_code:r.drug_code,drug_name:r.drug_name,type:tab,sub_type:r.sub_type||null,quantity:r.quantity,unit_price:r.unit_price,total_amount:r.total_amount,note:r.note||null,transaction_date:r.transaction_date,reason:r.reason||null,handler:r.handler||null,approver:r.approver||null,process_status:r.process_status||null,supplier:r.supplier||null,lot_no:r.lot_no||null,expiry_date:r.expiry_date||null}
      let res=await supabase.from('transactions').insert([tx])
      for(let rt=0;rt<3&&res.error&&res.error.message?.includes('column');rt++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete tx[m[1]];res=await supabase.from('transactions').insert([tx])}
      if(!res.error){
        const d=drugs.find(x=>x.drug_code===r.drug_code)
        if(d){const nq=tab==='입고'?((d.current_qty||0)+r.quantity):Math.max(0,(d.current_qty||0)-r.quantity);await supabase.from('drugs').update({current_qty:nq}).eq('drug_code',r.drug_code)}
        ok++
      }else fail++
    }
    setBulkLd(false);setBulkMsg(`완료! ${ok}건 등록, ${fail}건 실패`);setBulkData([]);onReload?.();loadTxns()
    setTimeout(()=>setBulkMsg(null),4000)
  }
  function dlTemplate(){
    const hdrs=tab==='입고'?['일자','약품코드','약품명','구분','입고수량','단가','공급업체','비고']:tab==='출고'?['일자','약품코드','약품명','구분','출고수량','단가','비고']:tab==='반품'?['일자','약품코드','약품명','구분','반품수량','단가','로트번호','유효기한','반품사유','처리상태','비고']:['약품코드','약품명','구분','폐기수량','단가','로트번호','유효기한','폐기사유','처리자','승인자','비고']
    const ws=XLSX.utils.aoa_to_sheet([hdrs]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,tab);XLSX.writeFile(wb,`${tab}_양식.xlsx`)
  }
  /* 테이블 컬럼 정의 */
  const cols=tab==='입고'?[['transaction_date','일자'],['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','단가'],['total_amount','금액'],['supplier','공급업체'],['note','비고']]:tab==='출고'?[['transaction_date','일자'],['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','단가'],['total_amount','금액'],['note','비고']]:tab==='반품'?[['transaction_date','일자'],['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','단가'],['total_amount','금액'],['lot_no','LOT'],['expiry_date','유효기한'],['reason','사유'],['process_status','처리상태'],['note','비고']]:[['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','단가'],['total_amount','금액'],['lot_no','LOT'],['expiry_date','유효기한'],['reason','사유'],['handler','처리자'],['approver','승인자'],['note','비고']]
  const sorted=so(txns);const tp2=Math.ceil(sorted.length/PP),pagedTx=sorted.slice((txPage-1)*PP,txPage*PP)

  return<div style={{padding:'20px 24px'}}>
    {/* 탭 */}
    <div style={{display:'flex',gap:6,marginBottom:16}}>{TYPES.map(tp=><button key={tp} onClick={()=>{setTab(tp);setSelDrug(null);setSearch('');setBulkData([]);setBulkMsg(null);setMsg(null)}} style={{flex:1,padding:'10px',borderRadius:10,border:`1.5px solid ${tab===tp?(tc[tp]?.c||t.accent):t.border}`,background:tab===tp?(tc[tp]?.bg||t.accentL):t.card,color:tab===tp?(tc[tp]?.c||t.accent):t.textM,cursor:'pointer',fontSize:13,fontWeight:tab===tp?700:400,transition:'all .15s'}}>{tp}관리</button>)}</div>
    <div style={{display:'grid',gridTemplateColumns:'340px 1fr',gap:16,marginBottom:16}}>
      {/* 좌: 개별 등록 */}
      <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'18px 20px'}}>
        <div style={{fontSize:14,fontWeight:700,color:tc[tab]?.c,marginBottom:12}}>{tab} 등록</div>
        <input value={search} onChange={e=>{setSearch(e.target.value);setSelDrug(null)}} placeholder="약품 검색 (코드/이름)..." style={{...ip,marginBottom:6}}/>
        {search.trim()&&!selDrug&&filtered.length>0&&<div style={{border:`1px solid ${t.border}`,borderRadius:6,maxHeight:120,overflowY:'auto',marginBottom:6}}>{filtered.slice(0,8).map(d=><div key={d.drug_code} onClick={()=>{setSelDrug(d);setSearch(d.drug_name)}} style={{padding:'6px 10px',cursor:'pointer',fontSize:11,borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>{d.drug_name} <span style={{color:t.textL,fontSize:9}}>({d.drug_code})</span></div>)}</div>}
        {selDrug&&<div style={{background:tc[tab]?.bg,borderRadius:6,padding:'6px 10px',marginBottom:6,fontSize:11,color:tc[tab]?.c}}><strong>{selDrug.drug_name}</strong> · 재고:{selDrug.current_qty} · ₩{selDrug.price_unit?.toLocaleString()}</div>}
        {subs.length>0&&<select value={form.sub_type} onChange={e=>sf('sub_type',e.target.value)} style={{...ip,marginBottom:6}}><option value="">구분 선택</option>{subs.map(s=><option key={s}>{s}</option>)}</select>}
        <input type="number" value={form.qty} onChange={e=>sf('qty',e.target.value)} placeholder="수량" style={{...ip,marginBottom:6}}/>
        {(tab==='입고')&&<input value={form.supplier} onChange={e=>sf('supplier',e.target.value)} placeholder="공급업체" style={{...ip,marginBottom:6}}/>}
        {(tab==='반품'||tab==='폐기')&&<>
          <select value={form.reason} onChange={e=>sf('reason',e.target.value)} style={{...ip,marginBottom:6}}><option value="">사유 선택 *</option>{reasons.map(r=><option key={r}>{r}</option>)}</select>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:6}}>
            <input value={form.lot_no} onChange={e=>sf('lot_no',e.target.value)} placeholder="LOT번호" style={ip}/>
            <input type="date" value={form.expiry_date} onChange={e=>sf('expiry_date',e.target.value)} style={ip}/>
          </div>
          {tab==='폐기'&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:6}}>
            <input value={form.handler} onChange={e=>sf('handler',e.target.value)} placeholder="처리자" style={ip}/>
            <input value={form.approver} onChange={e=>sf('approver',e.target.value)} placeholder="승인자" style={ip}/>
          </div>}
          <select value={form.process_status} onChange={e=>sf('process_status',e.target.value)} style={{...ip,marginBottom:6}}>{TX_STATUS.map(s=><option key={s}>{s}</option>)}</select>
        </>}
        <input value={form.note} onChange={e=>sf('note',e.target.value)} placeholder="비고" style={{...ip,marginBottom:10}}/>
        {msg&&<div style={{background:msg.includes('완료')?t.greenL:t.redL,borderRadius:6,padding:'6px 10px',marginBottom:6,color:msg.includes('완료')?t.green:t.red,fontSize:11}}>{msg}</div>}
        <button onClick={submit} disabled={saving} style={{width:'100%',padding:10,borderRadius:8,border:'none',background:saving?t.textL:tc[tab]?.c,color:'#fff',cursor:saving?'not-allowed':'pointer',fontSize:13,fontWeight:700}}>{saving?'처리 중...':tab+' 등록'}</button>
        {/* 대량등록 */}
        <div style={{borderTop:`1px solid ${t.border}`,marginTop:14,paddingTop:12}}>
          <div style={{fontSize:12,fontWeight:600,color:t.textM,marginBottom:8}}>엑셀 대량 등록</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={dlTemplate} style={{flex:1,padding:'6px',borderRadius:6,border:`1px solid ${t.blue}`,background:t.blueL,color:t.blue,cursor:'pointer',fontSize:10,fontWeight:600}}>양식</button>
            <button onClick={()=>fileRef.current.click()} style={{flex:1,padding:'6px',borderRadius:6,border:`1px solid ${tc[tab]?.c}`,background:tc[tab]?.bg,color:tc[tab]?.c,cursor:'pointer',fontSize:10,fontWeight:600}}>업로드</button>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={xlUpload} style={{display:'none'}}/>
          {bulkMsg&&<div style={{marginTop:6,fontSize:10,color:bulkMsg.includes('완료')?t.green:bulkMsg.includes('오류')?t.red:t.blue,fontWeight:600}}>{bulkMsg}</div>}
          {bulkData.length>0&&<button onClick={bulkSubmit} disabled={bulkLd} style={{width:'100%',marginTop:6,padding:'8px',borderRadius:6,border:'none',background:bulkLd?t.textL:tc[tab]?.c,color:'#fff',cursor:bulkLd?'not-allowed':'pointer',fontSize:11,fontWeight:700}}>{bulkLd?'등록 중...':bulkData.filter(r=>r.found).length+'건 일괄 등록'}</button>}
        </div>
      </div>
      {/* 우: 이력 테이블 */}
      <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden'}}>
        <div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',background:tc[tab]?.bg}}>
          <span style={{fontWeight:700,fontSize:13,color:tc[tab]?.c}}>{tab} 이력</span>
          <span style={{fontSize:12,fontWeight:600,color:tc[tab]?.c}}>{txns.length}건</span>
        </div>
        <div style={{overflowX:'auto',maxHeight:500}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead><tr>{cols.map(([k,h])=><th key={h} style={{...TS(k),fontSize:10,whiteSpace:'nowrap'}} onClick={()=>hs(k)}>{h}<SI col={k}/></th>)}</tr></thead>
          <tbody>{!pagedTx.length?<tr><td colSpan={cols.length} style={{padding:30,textAlign:'center',color:t.textL}}>이력 없음</td></tr>:pagedTx.map((tx,i)=><tr key={i} style={{borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>
            {cols.map(([k])=><td key={k} style={{padding:'5px 8px',fontSize:10,color:k==='drug_name'?t.text:k==='total_amount'?tc[tab]?.c:t.textM,fontWeight:k==='drug_name'||k==='total_amount'?600:400,textAlign:k==='quantity'||k==='unit_price'||k==='total_amount'?'right':'left',whiteSpace:'nowrap'}}>{k==='total_amount'?'₩'+(tx[k]||0).toLocaleString():k==='unit_price'?(tx[k]||0).toLocaleString():k==='quantity'?(tx[k]||0).toLocaleString():k==='sub_type'&&tx[k]?<Bd bg={tc[tab]?.bg} color={tc[tab]?.c}>{tx[k]}</Bd>:tx[k]||'-'}</td>)}
          </tr>)}</tbody>
        </table></div>
        <Pg page={txPage} setPage={setTxPage} tp={tp2} fl={sorted} pp={PP}/>
      </div>
    </div><Ft/>
  </div>
}

/* ═══ 보고서 — 월마감 스냅샷 + 인쇄 ═══ */
function Report({drugs,txns,onNav}){
  const{t}=useTheme();
  const cy=new Date().getFullYear(),cm=new Date().getMonth()+1;
  const[rtype,setRtype]=useState('monthly');
  const[year,setYear]=useState(cy);const[month,setMonth]=useState(cm);
  const[snaps,setSnaps]=useState([]);const[ld,setLd]=useState(false);
  const[search,setSearch]=useState('');const[cats,setCats]=useState(CATS);const[stats,setStats]=useState(STATS);
  const[closing,setClosing]=useState(false);const[closeMsg,setCloseMsg]=useState(null);
  const{hs,so,SI,TS}=useSort('drug_code');

  useEffect(()=>{loadS()},[year,month,rtype]);
  async function loadS(){
    setLd(true);
    let q=supabase.from('monthly_snapshots').select('*').eq('snap_year',year);
    if(rtype==='monthly')q=q.eq('snap_month',month);
    const{data}=await q;setSnaps(data||[]);setLd(false)
  }

  /* 월마감 실행 */
  async function doClose(){
    if(!confirm(`${cy}년 ${cm}월 월마감을 실행하시겠습니까?\n기존 ${cm}월 스냅샷은 덮어씁니다.`))return;
    setClosing(true);setCloseMsg(null);
    try{
      const ym=`${cy}-${String(cm).padStart(2,'0')}`;
      const mTx=txns.filter(tx=>tx.transaction_date?.startsWith(ym));
      const{data:prevData}=await supabase.from('monthly_snapshots').select('*').eq('snap_year',cm===1?cy-1:cy).eq('snap_month',cm===1?12:cm-1);
      const prevMap={};(prevData||[]).forEach(s=>{prevMap[s.drug_code]=s});
      const rows=drugs.map(d=>{
        const prev=prevMap[d.drug_code]||{};
        const dTx=mTx.filter(tx=>tx.drug_code===d.drug_code);
        const inQ=dTx.filter(x=>x.type==='입고').reduce((a,x)=>a+(x.quantity||0),0);
        const inA=dTx.filter(x=>x.type==='입고').reduce((a,x)=>a+(x.total_amount||0),0);
        const outQ=dTx.filter(x=>x.type==='출고').reduce((a,x)=>a+(x.quantity||0),0);
        const outA=dTx.filter(x=>x.type==='출고').reduce((a,x)=>a+(x.total_amount||0),0);
        const dispQ=dTx.filter(x=>x.type==='폐기').reduce((a,x)=>a+(x.quantity||0),0);
        const retQ=dTx.filter(x=>x.type==='반품').reduce((a,x)=>a+(x.quantity||0),0);
        return{drug_code:d.drug_code,snap_year:cy,snap_month:cm,
          opening_qty:prev.closing_qty||d.current_qty||0,opening_amount:prev.closing_amount||(d.current_qty||0)*(d.price_unit||0),
          total_in_qty:inQ,total_in_amount:inA,total_out_qty:outQ,total_out_amount:outA,
          total_disp_qty:dispQ,total_ret_qty:retQ,
          closing_qty:d.current_qty||0,closing_amount:(d.current_qty||0)*(d.price_unit||0)}
      });
      await supabase.from('monthly_snapshots').delete().eq('snap_year',cy).eq('snap_month',cm);
      const batch=[];for(let i=0;i<rows.length;i+=500)batch.push(rows.slice(i,i+500));
      for(const b of batch){const{error}=await supabase.from('monthly_snapshots').insert(b);if(error)throw error}
      setCloseMsg(`✅ ${cy}년 ${cm}월 마감 완료! (${rows.length}건)`);loadS()
    }catch(err){setCloseMsg('❌ 오류: '+err.message)}
    setClosing(false)
  }

  /* 데이터 가공 */
  const drugMap={};drugs.forEach(d=>{drugMap[d.drug_code]=d});
  let tableData=[];
  if(rtype==='monthly'){
    tableData=snaps.map(s=>({...s,drug_name:drugMap[s.drug_code]?.drug_name||s.drug_code,category:drugMap[s.drug_code]?.category||'-'}))
  }else{
    const map={};
    snaps.forEach(s=>{
      if(!map[s.drug_code])map[s.drug_code]={drug_code:s.drug_code,drug_name:drugMap[s.drug_code]?.drug_name||s.drug_code,category:drugMap[s.drug_code]?.category||'-',opening_qty:0,opening_amount:0,total_in_qty:0,total_in_amount:0,total_out_qty:0,total_out_amount:0,total_disp_qty:0,total_ret_qty:0,closing_qty:0,closing_amount:0};
      const m=map[s.drug_code];
      if(s.snap_month===1){m.opening_qty=s.opening_qty;m.opening_amount=s.opening_amount}
      m.total_in_qty+=s.total_in_qty||0;m.total_in_amount+=s.total_in_amount||0;
      m.total_out_qty+=s.total_out_qty||0;m.total_out_amount+=s.total_out_amount||0;
      m.total_disp_qty+=s.total_disp_qty||0;m.total_ret_qty+=s.total_ret_qty||0;
      m.closing_qty=s.closing_qty;m.closing_amount=s.closing_amount;
    });
    tableData=Object.values(map)
  }
  const filtered=so(tableData.filter(d=>{
    if(!cats.includes(d.category))return false;
    const drugStatus=drugMap[d.drug_code]?.status||'사용';
    if(!stats.includes(drugStatus))return false;
    if(search.trim()){const q=search.trim().toLowerCase();return d.drug_name?.toLowerCase().includes(q)||d.drug_code?.toLowerCase().includes(q)}
    return true
  }));
  const tot=filtered.reduce((a,d)=>({oa:a.oa+(d.opening_amount||0),ia:a.ia+(d.total_in_amount||0),oua:a.oua+(d.total_out_amount||0),ca:a.ca+(d.closing_amount||0),dq:a.dq+(d.total_disp_qty||0),rq:a.rq+(d.total_ret_qty||0),oq:a.oq+(d.opening_qty||0),iq:a.iq+(d.total_in_qty||0),ouq:a.ouq+(d.total_out_qty||0),cq:a.cq+(d.closing_qty||0),da:a.da+((d.total_disp_qty||0)*(drugMap[d.drug_code]?.price_unit||0)),ra:a.ra+((d.total_ret_qty||0)*(drugMap[d.drug_code]?.price_unit||0))}),{oa:0,ia:0,oua:0,ca:0,dq:0,rq:0,oq:0,iq:0,ouq:0,cq:0,da:0,ra:0});
  /* 구분별 */
  const catSum=CATS.map(cat=>{const items=filtered.filter(d=>d.category===cat);if(!items.length)return null;return{cat,count:items.length,inA:items.reduce((a,d)=>a+(d.total_in_amount||0),0),outA:items.reduce((a,d)=>a+(d.total_out_amount||0),0),closeA:items.reduce((a,d)=>a+(d.closing_amount||0),0)}}).filter(Boolean);

  function dl(){
    const ws=XLSX.utils.json_to_sheet(filtered.map(d=>({약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,전월재고수:d.opening_qty,전월재고금액:d.opening_amount,입고수량:d.total_in_qty,입고금액:d.total_in_amount,출고수량:d.total_out_qty,출고금액:d.total_out_amount,폐기수량:d.total_disp_qty,반품수량:d.total_ret_qty,기말재고수:d.closing_qty,기말재고금액:d.closing_amount})));
    const wb=XLSX.utils.book_new();const sn=rtype==='monthly'?`${year}년${month}월보고서`:`${year}년연간보고서`;
    XLSX.utils.book_append_sheet(wb,ws,sn);XLSX.writeFile(wb,`${sn}.xlsx`)
  }

  const tab=active=>({padding:'8px 20px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:active?t.accent:t.bg,color:active?'#fff':t.textM});

  return<div style={{padding:'20px 24px'}}>
    <div className="no-print" style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
      <button onClick={()=>{setRtype('monthly');loadS()}} style={tab(rtype==='monthly')}>월간</button>
      <button onClick={()=>{setRtype('annual');loadS()}} style={tab(rtype==='annual')}>연간</button>
      <div style={{width:1,height:20,background:t.border,margin:'0 4px'}}/>
      <select value={year} onChange={e=>{setYear(Number(e.target.value))}} style={{padding:'6px 10px',borderRadius:6,border:`1px solid ${t.border}`,fontSize:12,background:t.bg,color:t.text}}>
        {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}년</option>)}
      </select>
      {rtype==='monthly'&&<select value={month} onChange={e=>{setMonth(Number(e.target.value))}} style={{padding:'6px 10px',borderRadius:6,border:`1px solid ${t.border}`,fontSize:12,background:t.bg,color:t.text}}>
        {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}월</option>)}
      </select>}
      <div style={{flex:1}}/>
      <button onClick={dl} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:11,fontWeight:600}}>엑셀</button>
      <button onClick={()=>window.print()} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.blue}`,background:t.blueL,color:t.blue,cursor:'pointer',fontSize:11,fontWeight:600}}>인쇄</button>
      <button onClick={doClose} disabled={closing} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.amber}`,background:t.amberL,color:t.amber,cursor:'pointer',fontSize:11,fontWeight:700}}>{closing?'마감 중...':'📋 월마감'}</button>
    </div>
    {closeMsg&&<div style={{background:closeMsg.includes('✅')?t.greenL:t.redL,border:`1px solid ${closeMsg.includes('✅')?t.green:t.red}`,borderRadius:8,padding:'10px 14px',marginBottom:10,color:closeMsg.includes('✅')?t.green:t.red,fontSize:12,fontWeight:600}}>{closeMsg}</div>}

    {/* 요약 카드 */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
      {[{l:'전월재고',v:tot.oa,c:t.purple,nav:'stock'},{l:'입고 금액',v:tot.ia,c:t.green,nav:'transaction'},{l:'출고 금액',v:tot.oua,c:t.blue,nav:'transaction'},{l:'폐기',v:tot.dq,sub:tot.da,c:t.red,nav:'transaction'},{l:'반품',v:tot.rq,sub:tot.ra,c:t.amber,nav:'transaction'},{l:'기말재고',v:tot.ca,c:t.accent,nav:'stock'}].map((x,i)=><div key={i} onClick={()=>onNav?.({menu:x.nav})} style={{background:t.card,borderRadius:12,padding:'14px 18px',border:`1px solid ${t.border}`,cursor:'pointer',transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=x.c;e.currentTarget.style.transform='translateY(-1px)'}} onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;e.currentTarget.style.transform=''}}>
        <div style={{fontSize:10,color:t.textM}}>{x.l}</div>
        {x.sub!==undefined?<>
          <div style={{fontSize:20,fontWeight:700,color:x.c,marginTop:4}}>{x.v}개</div>
          <div style={{fontSize:12,color:x.c,marginTop:2}}>₩{x.sub.toLocaleString()}</div>
        </>:<div style={{fontSize:20,fontWeight:700,color:x.c,marginTop:4}}>{typeof x.v==='number'?'₩'+x.v.toLocaleString():x.v}</div>}
      </div>)}
    </div>

    {/* 구분별 현황 */}
    {catSum.length>0&&<div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',marginBottom:12}}>
      <div style={{padding:'14px 20px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:14,color:t.accent,background:t.accentL}}>구분별 현황</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:0}}>
        {catSum.map(c=>{const cc={'경구제':'#804A87','주사제':'#019748','외용제':'#2E4A62','수액제':'#92C8E0','영양제':'#A8CF5C','의약외품':'#F39E94'}[c.cat]||t.accent;return<div key={c.cat} onClick={()=>onNav?.({menu:'druglist',status:['사용']})} style={{padding:'16px 20px',borderBottom:`1px solid ${t.border}`,borderRight:`1px solid ${t.border}`,cursor:'pointer',transition:'all .15s',borderLeft:`4px solid ${cc}`}} onMouseEnter={e=>{e.currentTarget.style.background=cc+'10'}} onMouseLeave={e=>{e.currentTarget.style.background=''}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:700,color:cc}}>{c.cat}</span>
            <span style={{background:cc+'15',color:cc,padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:700}}>{c.count}개</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}>
            <div><div style={{color:t.textL,fontSize:9,marginBottom:2}}>입고</div><div style={{color:'#019748',fontWeight:600}}>₩{c.inA.toLocaleString()}</div></div>
            <div><div style={{color:t.textL,fontSize:9,marginBottom:2}}>출고</div><div style={{color:'#2E4A62',fontWeight:600}}>₩{c.outA.toLocaleString()}</div></div>
            <div><div style={{color:t.textL,fontSize:9,marginBottom:2}}>기말재고</div><div style={{color:'#804A87',fontWeight:700}}>₩{c.closeA.toLocaleString()}</div></div>
          </div>
        </div>})}
      </div>
    </div>}

    {/* 검색/필터 */}
    <div className="no-print" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'10px 16px',marginBottom:10,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="검색..." style={{flex:1,minWidth:120,padding:'8px 12px',border:`1px solid ${t.border}`,borderRadius:8,fontSize:12,outline:'none',background:t.bg,color:t.text}}/>
      <MP items={CATS} selected={cats} onChange={setCats} color={t.accent} label="구분"/>
      <div style={{width:1,height:16,background:t.border}}/>
      <MP items={STATS} selected={stats} onChange={setStats} color={t.green} label="상태"/>
    </div>

    {/* 상세 테이블 */}
    <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden'}}>
      <div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:13,color:t.accent}}>{rtype==='monthly'?`${year}년 ${month}월`:`${year}년 연간`} 보고서 ({filtered.length}건) {ld&&<span style={{fontSize:11,color:t.textL}}>로딩...</span>}</div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead><tr>{[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['opening_qty','전월재고'],['total_in_qty','입고'],['total_out_qty','출고'],['total_disp_qty','폐기'],['total_ret_qty','반품'],['closing_qty','기말재고'],['closing_amount','기말금액']].map(([k,h])=><th key={k} style={TS(k)} onClick={()=>hs(k)}>{h}<SI col={k}/></th>)}</tr></thead>
        <tbody>{filtered.length===0?<tr><td colSpan={10} style={{padding:40,textAlign:'center',color:t.textL}}>{ld?'로딩 중...':'데이터 없음 — 월마감을 실행해주세요'}</td></tr>:filtered.slice(0,100).map((d,i)=><tr key={i} style={{borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>
          <td style={{padding:'6px 10px',fontSize:10,color:t.textL}}>{d.drug_code}</td>
          <td style={{padding:'6px 10px',fontWeight:500,textAlign:'left'}}>{d.drug_name}</td>
          <td style={{padding:'6px 10px',color:t.textM}}>{d.category}</td>
          <td style={{padding:'6px 10px',textAlign:'right'}}>{d.opening_qty?.toLocaleString()}</td>
          <td style={{padding:'6px 10px',textAlign:'right',color:t.green}}>{d.total_in_qty?.toLocaleString()}</td>
          <td style={{padding:'6px 10px',textAlign:'right',color:t.blue}}>{d.total_out_qty?.toLocaleString()}</td>
          <td style={{padding:'6px 10px',textAlign:'right',color:t.red}}>{d.total_disp_qty||0}</td>
          <td style={{padding:'6px 10px',textAlign:'right',color:t.amber}}>{d.total_ret_qty||0}</td>
          <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{d.closing_qty?.toLocaleString()}</td>
          <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>₩{d.closing_amount?.toLocaleString()}</td>
        </tr>)}</tbody>
        {filtered.length>0&&<tfoot><tr style={{background:t.accentL,fontWeight:700}}>
          <td colSpan={3} style={{padding:'8px 12px',fontSize:12}}>합계</td>
          <td style={{padding:'8px 10px',textAlign:'right'}}>{tot.oq.toLocaleString()}</td>
          <td style={{padding:'8px 10px',textAlign:'right',color:t.green}}>{tot.iq.toLocaleString()}</td>
          <td style={{padding:'8px 10px',textAlign:'right',color:t.blue}}>{tot.ouq.toLocaleString()}</td>
          <td style={{padding:'8px 10px',textAlign:'right',color:t.red}}>{tot.dq}</td>
          <td style={{padding:'8px 10px',textAlign:'right',color:t.amber}}>{tot.rq}</td>
          <td style={{padding:'8px 10px',textAlign:'right'}}>{tot.cq.toLocaleString()}</td>
          <td style={{padding:'8px 10px',textAlign:'right'}}>₩{tot.ca.toLocaleString()}</td>
        </tr></tfoot>}
      </table></div>
    </div><Ft/>
  </div>
}

/* ═══ 성공 토스트 (공용) ═══ */
function Toast({ msg, kind = 'ok', onClose }) {
  const { t } = useTheme()
  useEffect(() => { if (!msg) return; const id = setTimeout(onClose, 3000); return () => clearTimeout(id) }, [msg, onClose])
  if (!msg) return null
  const isOk = kind === 'ok'
  return <div style={{ position: 'fixed', top: 72, right: 20, zIndex: 9999, background: isOk ? t.green : t.red, color: '#fff', padding: '12px 20px', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, animation: 'toastIn .25s ease-out' }}>
    <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    <span>{isOk ? '✓' : '!'}</span>{msg}
  </div>
}

/* ═══ 마이페이지 — 내 정보 조회 및 수정 + 탈퇴 ═══ */
function MyPage({ profile, onProfileUpdated }) {
  const { t, user, logout } = useTheme()
  const [form, setForm] = useState({ full_name: '', phone: '', dept: '', position: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [errMsg, setErrMsg] = useState(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const isEmailUser = (user?.app_metadata?.provider || 'email') === 'email'

  useEffect(() => {
    if (profile) setForm({ full_name: profile.full_name || '', phone: profile.phone || '', dept: profile.dept || '', position: profile.position || '' })
  }, [profile])

  async function handleSave() {
    setSaving(true); setErrMsg(null)
    const payload = { full_name: form.full_name.trim() || null, phone: form.phone.trim() || null, dept: form.dept.trim() || null, position: form.position.trim() || null }
    const { error } = await supabase.from('profiles').update(payload).eq('id', user.id)
    setSaving(false)
    if (error) { setErrMsg(error.message.includes('profiles') ? '프로필 테이블이 아직 준비되지 않았습니다. DB 스키마(profiles_schema.sql)를 먼저 실행해 주세요.' : error.message); return }
    setToast({ msg: '저장되었습니다', kind: 'ok' })
    onProfileUpdated?.()
  }

  const ip = { width: '100%', padding: '11px 14px', border: `1.5px solid ${t.border}`, borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.card, color: t.text, transition: 'border-color .15s' }
  const ipRO = { ...ip, background: t.bg, color: t.textM, cursor: 'not-allowed' }
  const lb = { fontSize: 11, color: t.textM, display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: 0.2 }
  const fmtDate = s => { if (!s) return '-'; const d = new Date(s); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const roleBadge = profile?.role === 'admin'
    ? { bg: t.purpleL, color: t.purple, text: '관리자' }
    : { bg: t.greenL, color: t.green, text: '일반' }

  return <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 80px' }}>
    <Toast msg={toast?.msg} kind={toast?.kind} onClose={() => setToast(null)} />
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: t.text, margin: 0, letterSpacing: -0.3 }}>마이페이지</h2>
      <div style={{ fontSize: 12, color: t.textL, marginTop: 6 }}>내 프로필 정보를 확인하고 수정할 수 있습니다.</div>
    </div>

    {errMsg && <div style={{ background: t.redL, color: t.red, borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 12.5, fontWeight: 500, border: `1px solid ${t.red}30` }}>{errMsg}</div>}

    {/* 기본 정보 카드 */}
    <div style={{ background: t.card, borderRadius: 16, border: `1px solid ${t.border}`, boxShadow: t.shadow, padding: '24px 28px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${t.border}` }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: `linear-gradient(135deg, ${t.accent}, ${t.green})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 700 }}>{(form.full_name || user?.email || '?').charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{form.full_name || '이름 미설정'}</div>
          <div style={{ fontSize: 11, color: t.textL, marginTop: 2 }}>{user?.email}</div>
        </div>
        <span style={{ background: roleBadge.bg, color: roleBadge.color, padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{roleBadge.text}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lb}>이메일 (변경 불가)</label>
          <input type="email" value={user?.email || ''} readOnly style={ipRO} />
        </div>
        <div>
          <label style={lb}>이름</label>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="홍길동" style={ip} maxLength={40} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
        </div>
        <div>
          <label style={lb}>전화번호</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" style={ip} maxLength={20} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
        </div>
        <div>
          <label style={lb}>부서</label>
          <input value={form.dept} onChange={e => setForm(f => ({ ...f, dept: e.target.value }))} placeholder="약제과" style={ip} maxLength={30} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
        </div>
        <div>
          <label style={lb}>직책</label>
          <input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder="약사" style={ip} maxLength={30} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: `1px solid ${t.border}` }}>
        <div style={{ fontSize: 11, color: t.textL }}>
          가입일 <span style={{ color: t.textM, fontWeight: 500, marginLeft: 4 }}>{fmtDate(profile?.created_at)}</span>
          {profile?.updated_at && <><span style={{ margin: '0 10px', color: t.border }}>·</span>최근 수정 <span style={{ color: t.textM, fontWeight: 500, marginLeft: 4 }}>{fmtDate(profile.updated_at)}</span></>}
        </div>
        <button onClick={handleSave} disabled={saving} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: saving ? t.textL : `linear-gradient(135deg, ${t.accent}, ${t.green})`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 12px rgba(128,74,135,0.25)', transition: 'all .15s' }}>{saving ? '저장 중...' : '저장'}</button>
      </div>
    </div>

    {/* 비밀번호 안내 */}
    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, padding: '16px 20px', fontSize: 12, color: t.textM, lineHeight: 1.6, marginBottom: 16 }}>
      비밀번호를 변경하려면 로그아웃 후 로그인 화면의 <span style={{ color: t.accent, fontWeight: 600 }}>비밀번호 찾기</span>를 이용해 주세요.
    </div>

    {/* 회원 탈퇴 섹션 */}
    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.red}30`, padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.red, marginBottom: 4 }}>회원 탈퇴</div>
          <div style={{ fontSize: 11, color: t.textM, lineHeight: 1.5 }}>탈퇴 시 계정과 프로필이 즉시 영구 삭제되며, 복구할 수 없습니다. (등록한 약품 데이터는 조직 공용이므로 유지)</div>
        </div>
        <button onClick={() => setShowDeleteModal(true)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${t.red}`, background: 'transparent', color: t.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }} onMouseEnter={e => { e.currentTarget.style.background = t.redL }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>탈퇴하기</button>
      </div>
    </div>

    {showDeleteModal && <DeleteAccountModal isEmailUser={isEmailUser} onClose={() => setShowDeleteModal(false)} onDeleted={async () => { setShowDeleteModal(false); await logout() }} />}
    <Ft />
  </div>
}

/* ═══ 탈퇴 확인 모달 ═══ */
function DeleteAccountModal({ isEmailUser, onClose, onDeleted }) {
  const { t, user } = useTheme()
  const [confirmText, setConfirmText] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const canSubmit = confirmText === '탈퇴' && (!isEmailUser || password.length > 0) && !busy

  async function handleDelete() {
    setBusy(true); setErr(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) { setErr('세션이 만료되었습니다. 다시 로그인해 주세요.'); setBusy(false); return }
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmText, ...(isEmailUser ? { password } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { setErr(json.msg || '탈퇴 처리 실패'); setBusy(false); return }
      await onDeleted()
    } catch (e) { setErr('네트워크 오류: ' + e.message); setBusy(false) }
  }

  const ip = { width: '100%', padding: '11px 14px', border: `1.5px solid ${t.border}`, borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.card, color: t.text }

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 16, padding: '24px 26px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: t.red, marginBottom: 6 }}>정말 탈퇴하시겠습니까?</div>
      <div style={{ fontSize: 12, color: t.textM, marginBottom: 18, lineHeight: 1.6 }}>
        탈퇴하면 <strong style={{ color: t.text }}>{user?.email}</strong> 계정과 프로필이 즉시 영구 삭제됩니다.<br />이 작업은 <strong style={{ color: t.red }}>되돌릴 수 없습니다.</strong>
      </div>

      {err && <div style={{ background: t.redL, color: t.red, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, fontWeight: 500 }}>{err}</div>}

      {isEmailUser && <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 6, fontWeight: 600 }}>현재 비밀번호</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" style={ip} autoComplete="current-password" />
      </div>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 6, fontWeight: 600 }}>확인을 위해 <span style={{ color: t.red, fontWeight: 700 }}>탈퇴</span>를 입력해 주세요</label>
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="탈퇴" style={ip} />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy} style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${t.border}`, background: 'transparent', color: t.textM, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>취소</button>
        <button onClick={handleDelete} disabled={!canSubmit} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: canSubmit ? t.red : t.textL, color: '#fff', fontSize: 13, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>{busy ? '처리 중...' : '영구 탈퇴'}</button>
      </div>
    </div>
  </div>
}

/* ═══ 관리자 — 가입자 조회 ═══ */
function AdminUsers() {
  const { t } = useTheme()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [errMsg, setErrMsg] = useState(null)
  const { hs, so, SI, TS } = useSort('created_at', 'desc')

  async function load() {
    setLoading(true); setErrMsg(null)
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setLoading(false)
    if (error) { setErrMsg(error.message); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const ql = q.trim().toLowerCase()
  const filtered = rows.filter(r => !ql || [r.email, r.full_name, r.dept, r.position].some(v => (v || '').toLowerCase().includes(ql)))
  const sorted = so(filtered)
  const fmtDate = s => { if (!s) return '-'; const d = new Date(s); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

  return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px 80px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: t.text, margin: 0, letterSpacing: -0.3 }}>가입자 관리</h2>
        <div style={{ fontSize: 12, color: t.textL, marginTop: 6 }}>가입된 사용자 {rows.length}명 · 검색 결과 {filtered.length}명</div>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="이메일·이름·부서·직책 검색" style={{ minWidth: 260, padding: '10px 14px', border: `1.5px solid ${t.border}`, borderRadius: 10, fontSize: 13, outline: 'none', background: t.card, color: t.text }} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
    </div>

    {errMsg && <div style={{ background: t.redL, color: t.red, borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 12.5, fontWeight: 500, border: `1px solid ${t.red}30` }}>{errMsg.includes('profiles') ? '프로필 테이블이 아직 준비되지 않았습니다. DB 스키마(profiles_schema.sql)를 먼저 실행해 주세요.' : errMsg}</div>}

    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, boxShadow: t.shadow, overflow: 'hidden' }}>
      {loading ? <div style={{ padding: '40px 20px', textAlign: 'center', color: t.textL, fontSize: 13 }}>불러오는 중...</div>
        : sorted.length === 0 ? <div style={{ padding: '40px 20px', textAlign: 'center', color: t.textL, fontSize: 13 }}>표시할 사용자가 없습니다.</div>
        : <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: t.bg }}>
              <th onClick={() => hs('email')} style={TS('email')}>이메일<SI col="email" /></th>
              <th onClick={() => hs('full_name')} style={TS('full_name')}>이름<SI col="full_name" /></th>
              <th onClick={() => hs('phone')} style={TS('phone')}>전화번호<SI col="phone" /></th>
              <th onClick={() => hs('dept')} style={TS('dept')}>부서<SI col="dept" /></th>
              <th onClick={() => hs('position')} style={TS('position')}>직책<SI col="position" /></th>
              <th onClick={() => hs('role')} style={TS('role')}>권한<SI col="role" /></th>
              <th onClick={() => hs('created_at')} style={TS('created_at')}>가입일<SI col="created_at" /></th>
            </tr></thead>
            <tbody>{sorted.map(r => <tr key={r.id} style={{ borderTop: `1px solid ${t.border}` }}>
              <td style={{ padding: '10px 12px', color: t.text, fontWeight: 500 }}>{r.email || '-'}</td>
              <td style={{ padding: '10px 12px', color: t.text }}>{r.full_name || <span style={{ color: t.textL }}>-</span>}</td>
              <td style={{ padding: '10px 12px', color: t.textM, fontFamily: 'monospace', fontSize: 11 }}>{r.phone || <span style={{ color: t.textL }}>-</span>}</td>
              <td style={{ padding: '10px 12px', color: t.textM }}>{r.dept || <span style={{ color: t.textL }}>-</span>}</td>
              <td style={{ padding: '10px 12px', color: t.textM }}>{r.position || <span style={{ color: t.textL }}>-</span>}</td>
              <td style={{ padding: '10px 12px' }}>
                {r.role === 'admin'
                  ? <span style={{ background: t.purpleL, color: t.purple, padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>관리자</span>
                  : <span style={{ background: t.greenL, color: t.green, padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>일반</span>}
              </td>
              <td style={{ padding: '10px 12px', color: t.textM, fontSize: 11 }}>{fmtDate(r.created_at)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
    <Ft />
  </div>
}

/* ═══ 로그인 페이지 ═══ */
function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login') // login | signup | reset
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const t = themes.light
  async function handleLogin() {
    if (!email || !pw) { setMsg('이메일과 비밀번호를 입력해주세요'); return }
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    setLoading(false)
    if (error) setMsg(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다' : error.message)
  }
  async function handleSignup() {
    if (!email || !pw) { setMsg('이메일과 비밀번호를 입력해주세요'); return }
    if (pw.length < 6) { setMsg('비밀번호는 6자 이상이어야 합니다'); return }
    if (pw !== pw2) { setMsg('비밀번호가 일치하지 않습니다'); return }
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signUp({ email, password: pw })
    setLoading(false)
    if (error) { setMsg(error.message); return }
    setMsg('✅ 가입 완료! 로그인해 주세요'); setMode('login'); setPw(''); setPw2('')
  }
  async function handleReset() {
    if (!email) { setMsg('이메일을 입력해주세요'); return }
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    setLoading(false)
    if (error) { setMsg(error.message); return }
    setMsg('✅ 비밀번호 재설정 링크를 이메일로 보냈습니다')
  }
  async function handleKakao() {
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: window.location.origin },
    })
    if (error) { setLoading(false); setMsg('카카오 로그인 실패: ' + error.message) }
    /* 성공 시 카카오 페이지로 자동 리다이렉트됨 */
  }
  function handleNaver() {
    setLoading(true); setMsg(null)
    window.location.href = '/api/auth/naver/login'
  }
  const ip = { width: '100%', padding: '12px 16px', border: `1.5px solid ${t.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff', color: t.text }
  return <div style={{ minHeight: '100vh', background: `linear-gradient(135deg, ${t.nav} 0%, #804A87 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');*{font-family:'Roboto','Apple SD Gothic Neo',sans-serif;}`}</style>
    <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 400, padding: '40px 36px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg, #804A87, #019748)`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24, fontWeight: 700, color: '#fff' }}>+</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.nav }}>약플로 · Yakflo</div>
        <div style={{ fontSize: 12, color: t.textL, marginTop: 4 }}>약품 통합 관리 솔루션</div>
      </div>
      {msg && <div style={{ background: msg.startsWith('✅') ? t.greenL : t.redL, borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: msg.startsWith('✅') ? t.green : t.red, fontSize: 13, fontWeight: 500 }}>{msg}</div>}
      <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 4, fontWeight: 500 }}>이메일</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" style={ip} onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? handleLogin() : mode === 'signup' ? handleSignup() : handleReset())} /></div>
      {mode !== 'reset' && <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 4, fontWeight: 500 }}>비밀번호</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••" style={ip} onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? handleLogin() : handleSignup())} /></div>}
      {mode === 'signup' && <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 4, fontWeight: 500 }}>비밀번호 확인</label><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="••••••" style={ip} onKeyDown={e => e.key === 'Enter' && handleSignup()} /></div>}
      <button onClick={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleReset} disabled={loading} style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: loading ? t.textL : `linear-gradient(135deg, #804A87, #019748)`, color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 16 }}>{loading ? '처리 중...' : mode === 'login' ? '로그인' : mode === 'signup' ? '회원가입' : '재설정 링크 보내기'}</button>

      {/* ── 소셜 로그인 (login/signup 모드에서만 노출, reset 모드 제외) ── */}
      {mode !== 'reset' && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
          <div style={{ flex: 1, height: 1, background: t.border }} />
          <span style={{ fontSize: 11, color: t.textL, fontWeight: 500 }}>또는 간편 로그인</span>
          <div style={{ flex: 1, height: 1, background: t.border }} />
        </div>
        <button onClick={handleKakao} disabled={loading} aria-label="카카오로 시작하기" style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: loading ? '#F5E16A' : '#FEE500', color: '#191919', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#191919" d="M9 1.5C4.86 1.5 1.5 4.18 1.5 7.5c0 2.16 1.43 4.05 3.58 5.11l-.74 2.71c-.07.24.2.43.41.3l3.25-2.15c.33.04.66.03.99 0 4.14 0 7.5-2.68 7.5-6S13.14 1.5 9 1.5z"/></svg>
          카카오로 시작하기
        </button>
        <button onClick={handleNaver} disabled={loading} aria-label="네이버로 시작하기" style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: loading ? '#5FCD86' : '#03C75A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="#fff" d="M9.96 8.56L5.95 2.5H2.5v11h3.59V7.44l4.01 6.06h3.4v-11h-3.54v6.06z"/></svg>
          네이버로 시작하기
        </button>
      </>}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 12 }}>
        {mode !== 'login' && <button onClick={() => { setMode('login'); setMsg(null) }} style={{ background: 'none', border: 'none', color: '#804A87', cursor: 'pointer', fontWeight: 500 }}>로그인</button>}
        {mode !== 'signup' && <button onClick={() => { setMode('signup'); setMsg(null) }} style={{ background: 'none', border: 'none', color: '#019748', cursor: 'pointer', fontWeight: 500 }}>회원가입</button>}
        {mode !== 'reset' && <button onClick={() => { setMode('reset'); setMsg(null) }} style={{ background: 'none', border: 'none', color: t.textL, cursor: 'pointer' }}>비밀번호 찾기</button>}
      </div>
    </div>
  </div>
}

/* ═══ 메인 App ═══ */
export default function App() {
  const [dark, setDark] = useState(false)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [menu, setMenu] = useState('dashboard')
  const [drugs, setDrugs] = useState([])
  const [inv, setInv] = useState([])
  const [txns, setTxns] = useState([])
  const [nf, setNf] = useState(null)
  const [editDrug, setEditDrug] = useState(null)
  const [adjustDrug, setAdjustDrug] = useState(null)
  const [lotDrug, setLotDrug] = useState(null)
  const [loading, setLoading] = useState(true)

  const t = dark ? themes.dark : themes.light
  const themeVal = { t, dark, toggle: () => setDark(d => !d), user, profile, logout: async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); setMenu('dashboard') } }

  /* 인증 상태 확인 */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user || null); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user || null) })
    return () => subscription.unsubscribe()
  }, [])

  /* 비보험 메뉴 진입 시 navFilter 자동 적용 (헤더 클릭/대시보드 카드 클릭 모두 처리) */
  useEffect(() => { if (menu === 'nonins') setNf({ insType: '비보험' }) }, [menu])

  /* 프로필 로드 (profiles 테이블이 아직 없을 수도 있으므로 silent fail) */
  async function loadProfile() {
    if (!user) { setProfile(null); return }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (error) { setProfile(null); return }
    setProfile(data)
  }
  useEffect(() => { loadProfile() }, [user])

  async function load() {
    const d = await fetchAll()
    setDrugs(d)
    const { data: invData } = await supabase.from('inventory_stock').select('*')
    setInv(invData || [])
    const { data: txData } = await supabase.from('transactions').select('*').order('transaction_date', { ascending: false }).limit(500)
    setTxns(txData || [])
    setLoading(false)
  }

  useEffect(() => { if (user) load() }, [user])

  function handleNav(nav) {
    if (nav.menu) setMenu(nav.menu)
    setNf(nav)
  }

  /* 인증 로딩 중 */
  if (authLoading) return (
    <ThemeCtx.Provider value={themeVal}>
      <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: t.textL }}>인증 확인 중...</div>
      </div>
    </ThemeCtx.Provider>
  )

  /* 미로그인 → 로그인 페이지 */
  if (!user) return <LoginPage />

  /* 데이터 로딩 중 */
  if (loading) return (
    <ThemeCtx.Provider value={themeVal}>
      <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 15, color: t.accent, fontWeight: 500 }}>약플로 · Yakflo</div>
        <div style={{ fontSize: 13, color: t.textL }}>데이터 불러오는 중...</div>
        <div style={{ width: 200, height: 3, background: t.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: t.accent, borderRadius: 2, animation: 'ld 1.5s ease-in-out infinite', width: '60%' }} />
        </div>
        <style>{`@keyframes ld{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
      </div>
    </ThemeCtx.Provider>
  )

  return (
    <ThemeCtx.Provider value={themeVal}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');
        * { font-family: 'Roboto', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
        body { margin: 0; -webkit-tap-highlight-color: transparent; }
        input, select, textarea, button { font-family: inherit; }
        /* ═══ 브랜드 영역 (로고 + 타이틀 + 부제) — 글씨 깨짐 방지 ═══ */
        .brand-area { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .brand-logo { flex-shrink: 0; }
        .brand-title { font-weight: 700; white-space: nowrap; color: #804A87; }
        .brand-sub   { font-size: 12px; color: #5b6776; }
        @media (max-width: 640px) {
          .brand-sub { display: none; }
        }
        @media print {
          @page { size: landscape; margin: 8mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          table { font-size: 9px !important; }
          th, td { padding: 4px 6px !important; }
        }
        /* ═══ 반응형: 태블릿 (≤1024px) ═══ */
        @media (max-width: 1024px) {
          .cnc-nav-desktop { gap: 1px !important; }
          .cnc-nav-desktop button { padding: 6px 8px !important; font-size: 11px !important; }
          .cnc-date { display: none !important; }
        }
        /* ═══ 반응형: 모바일 (≤768px) ═══ */
        @media (max-width: 768px) {
          .cnc-nav-desktop { display: none !important; }
          .cnc-hamburger { display: flex !important; }
          .cnc-header { padding: 0 12px !important; }
          .cnc-title { font-size: 13px !important; }
          .cnc-plus { width: 28px !important; height: 28px !important; font-size: 16px !important; }
          div[style*="padding: 20px 24px"], div[style*="padding:'20px 24px'"] { padding: 10px 12px !important; }
          div[style*="gridTemplateColumns: 'repeat(4"] { grid-template-columns: repeat(2, 1fr) !important; }
          div[style*="gridTemplateColumns: 'repeat(5"] { grid-template-columns: repeat(2, 1fr) !important; }
          div[style*="gridTemplateColumns: '1fr 1fr 1fr'"] { grid-template-columns: 1fr !important; }
          div[style*="gridTemplateColumns: '340px 1fr'"] { grid-template-columns: 1fr !important; }
          table { font-size: 10px !important; }
          th, td { padding: 4px 6px !important; }
          .cnc-date { display: none !important; }
        }
      `}</style>
      <div style={{ minHeight: '100vh', background: t.bg }}>
        <Header menu={menu} setMenu={setMenu} />
        {menu === 'dashboard' && <Dashboard drugs={drugs} inv={inv} txns={txns} onNav={handleNav} onEdit={setEditDrug} />}
        {menu === 'druglist' && <DrugList drugs={drugs} navFilter={nf} onEdit={setEditDrug} />}
        {menu === 'nonins' && <DrugList drugs={drugs} navFilter={nf} onEdit={setEditDrug} />}
        {menu === 'expiry' && <ExpiryAlert drugs={drugs} onEdit={setEditDrug} focusLevel={nf?.focus} onReload={load} />}
        {menu === 'stock' && <StockStatus drugs={drugs} inv={inv} navFilter={nf} onEdit={setEditDrug} onAdjust={setAdjustDrug} onReload={load} />}
        {menu === 'narcotic' && <NarcoticMgmt drugs={drugs} onEdit={setEditDrug} onAdjust={setAdjustDrug} />}
        {menu === 'transaction' && <TransactionForm drugs={drugs} onReload={load} />}
        {menu === 'report' && <Report drugs={drugs} txns={txns} onNav={handleNav} />}
        {menu === 'register' && <DrugRegister onRefresh={load} />}
        {menu === 'mypage' && <MyPage profile={profile} onProfileUpdated={loadProfile} />}
        {menu === 'admin' && (profile?.role === 'admin' ? <AdminUsers /> : <div style={{ maxWidth: 640, margin: '60px auto', padding: '40px 20px', textAlign: 'center', color: t.textL, fontSize: 14 }}>관리자 권한이 필요한 페이지입니다.</div>)}

        {editDrug && <DrugEditModal drug={editDrug} onClose={() => setEditDrug(null)} onSaved={() => { setEditDrug(null); load() }} onLotManage={d => { setEditDrug(null); setLotDrug(d) }} />}
        {adjustDrug && <AdjustModal drug={adjustDrug} onClose={() => setAdjustDrug(null)} onSaved={() => { setAdjustDrug(null); load() }} />}
        {lotDrug && <LotModal drug={lotDrug} onClose={() => setLotDrug(null)} onSaved={() => { setLotDrug(null); load() }} />}
      </div>
    </ThemeCtx.Provider>
  )
}
