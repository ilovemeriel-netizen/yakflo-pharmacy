import { useEffect, useState, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import { passesDrugFilters } from './lib/drugFilter'
import { RX_TOGGLE, RX_MORE, autoMap } from './lib/drugRules'
import { classifyDrugRows, applyDrugRows } from './lib/drugBulk'
import { decomposeAtc } from './lib/atcMap'
import { ThemeCtx, useTheme } from './lib/theme'
import EmergencyDispense from './EmergencyDispense'
import BulkUploadModal from './BulkUploadModal'
import ColumnSelector from './ColumnSelector'
import GnbSearch from './GnbSearch'
import { useDraggableModal } from './useDraggableModal'
import SnapshotUploadModal from './SnapshotUploadModal'
/* XLSX는 동적 import로 별도 청크 분리(초기 번들 축소). 모든 사용은 사용자 액션 핸들러 내부뿐 → 로드 시점 안전 */
let XLSX; import('xlsx').then(m => { XLSX = m })

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
const CATS = ['경구제','주사제','외용제','수액제','영양제','의약외품']
const STATS = ['사용','중지','휴면']
const MAIN_STATS = ['사용','휴면']
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
function getNT(d) { if (d.narcotic_type === '한외마약') return '일반'; if (d.narcotic_type === '향정' || d.narcotic_type === '마약') return d.narcotic_type; if (d.is_narcotic === true || d.is_narcotic === 'true') return '향정'; return '일반' }
function isN(d) { return getNT(d) !== '일반' }
/* 보험구분 정규화: 입력폼은 '급여'/'비급여', 일부 데이터는 '보험'/'비보험', 또는 NULL.
   모두 일관되게 '비보험' 그룹 여부로 판정. */
function isNonIns(d) { const v = (d?.insurance_type || '').toString(); return v === '비보험' || v === '비급여' }
function NT({ d }) { const { t } = useTheme(); const n = getNT(d); if (n === '일반') return null; const c = n === '마약' ? t.red : t.purple; return <span style={{ marginLeft: 4, background: n === '마약' ? t.redL : t.purpleL, color: c, fontSize: 9, padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>{n}</span> }
async function fetchAll() { let a = [], f = 0; while (true) { const { data, error } = await supabase.from('drugs').select('*').order('drug_name').range(f, f + 999); if (error || !data || !data.length) break; a = [...a, ...data]; if (data.length < 1000) break; f += 1000 }; return a }
async function searchDrugAPI(keyword, apiType = 'easy') {
  const maps = {
    easy: i => ({ name: i.itemName||'', efficacy: i.efcyQesitm||'', manufacturer: i.entpName||'', storage: i.depositMethodQesitm||'', usage: i.useMethodQesitm||'', warning: i.atpnWarnQesitm||'', sideEffect: i.seQesitm||'', image: i.itemImage||'', itemSeq: i.itemSeq||'' }),
    permit: i => { const raw=i.MAIN_ITEM_INGR||i.PRDUCT_NM||''; const isE=s=>s&&/^[a-zA-Z\s()[\]\-,.:;0-9]+$/.test(s); const parts=raw.split(/[;；,，/]/).map(s=>s.trim()).filter(Boolean); const en=parts.find(p=>isE(p))||''; const kr=parts.find(p=>!isE(p))||''; return { name:i.ITEM_NAME||'', manufacturer:i.ENTP_NAME||'', ingredient:raw, ingredientEn:en, ingredientKr:kr, storage:i.STORAGE_METHOD||'', unit:i.PACK_UNIT||'', insuranceCode:i.EDI_CODE||'', image:i.ITEM_IMAGE||'', packUnit:i.PACK_UNIT||'', route:i.INJC_PTH_NM||i.EE_DOC_DATA&&'', storageMethod:i.STORAGE_METHOD||'' } },
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
    /* 12초 timeout 보호 — Netlify Function 콜드 스타트 + 공공API 응답 지연 대비 */
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid))
    const text = await res.text()
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
  return { sk, sd, setSort(k, d) { s1(k); s2(d) },
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
function Pg({ page: p, setPage: sp, tp, fl, pp, ends }) { const { t } = useTheme(); if (tp <= 1) return null; const btn = dis => ({ padding: '5px 12px', borderRadius: 8, border: `1px solid ${t.border}`, cursor: dis ? 'not-allowed' : 'pointer', background: t.card, color: dis ? t.textL : t.text, fontWeight: 600, fontSize: 11, opacity: dis ? .4 : 1 }); return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: `1px solid ${t.border}` }}><span style={{ fontSize: 11, color: t.textM }}>{fl.length}개 중 {Math.min((p - 1) * pp + 1, fl.length)}–{Math.min(p * pp, fl.length)}</span><div style={{ display: 'flex', gap: 3 }}>{ends && <button onClick={() => sp(1)} disabled={p === 1} style={btn(p === 1)}>◀◀</button>}<button onClick={() => sp(x => x - 1)} disabled={p === 1} style={btn(p === 1)}>◀</button>{Array.from({ length: Math.min(5, tp) }, (_, i) => { const pg = Math.max(1, Math.min(p - 2, tp - 4)) + i; return <button key={pg} onClick={() => sp(pg)} style={{ ...btn(false), background: p === pg ? t.accent : t.card, color: p === pg ? '#fff' : t.text, border: `1px solid ${p === pg ? t.accent : t.border}` }}>{pg}</button> })}<button onClick={() => sp(x => x + 1)} disabled={p === tp} style={btn(p === tp)}>▶</button>{ends && <button onClick={() => sp(tp)} disabled={p === tp} style={btn(p === tp)}>▶▶</button>}</div></div> }
function CN({ drug: d, onEdit }) { const { t } = useTheme(); return <td style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'left', color: t.accent, cursor: 'pointer' }} onClick={() => onEdit(d)} onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = t.purple }} onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = t.accent }}>{d.drug_name}</td> }

/* ★ MultiPill — 최종 */
function MP({ items, selected, onChange, color, label }) {
  const { t, dark } = useTheme(); const allSel = selected.length === items.length
  function tog(item) { const n = selected.includes(item) ? selected.filter(x => x !== item) : [...selected, item]; onChange(n.length ? n : [...items]) }
  const grey = t.textM // 무채색 배경(라이트 #52524E / 다크 #A3A39E) — 배경 현행 유지
  // [3] 참조비교(items===STATS/CATS) 대신 항목 값으로 판별 → 호출부 배열 복사/가공에도 안전
  const CHIP = { '사용': '#019748', '중지': grey, '휴면': '#BFA6D9', '경구제': '#019748', '주사제': '#2B7BB9', '외용제': '#BFA6D9', '수액제': grey, '영양제': '#804A87', '의약외품': '#804A87' }
  const mk = (c, txt) => ({ padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: c, color: txt || '#fff', border: `1.5px solid ${c}`, transition: 'all .15s' })
  const on = mk(color)
  const off = { padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 500, background: 'transparent', color: t.textM, border: `1.5px solid ${t.border}`, transition: 'all .15s' }
  return <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
    {label && <span style={{ fontSize: 10, color: t.textL, fontWeight: 600, marginRight: 3 }}>{label}</span>}
    <button onClick={() => onChange(allSel ? [items[0]] : [...items])} style={allSel ? { ...on, background: t.text, borderColor: t.text } : off}>전체</button>
    {items.map(i => { const c = CHIP[i]; const ao = c ? mk(c, c === grey && dark ? t.bg : undefined) : on; return <button key={i} onClick={() => tog(i)} style={selected.includes(i) ? ao : off}>{i}</button> })}
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

/* ═══ 전역 통합 검색 오버레이 (Ctrl/⌘+K · GNB 버튼) ═══ */
function GlobalSearch({ onClose }) {
  const { t, open360 } = useTheme();
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const inpRef = useRef(null);
  useEffect(() => { const id = setTimeout(() => { if (inpRef.current) inpRef.current.focus() }, 40); return () => clearTimeout(id) }, []);
  useEffect(() => {
    let on = true;
    const h = setTimeout(async () => {
      const term = q.trim();
      if (term.length < 1) { if (on) { setRes([]); setTotal(0); setLoading(false) } return }
      if (on) setLoading(true);
      const esc = term.replace(/[%,()]/g, ' ');
      const { data, count } = await supabase.from('drugs').select('*', { count: 'exact' }).or('drug_code.ilike.%' + esc + '%,drug_name.ilike.%' + esc + '%,ingredient_kr.ilike.%' + esc + '%,ingredient_en.ilike.%' + esc + '%,manufacturer.ilike.%' + esc + '%').limit(20);
      if (!on) return;
      const rows = (data || []).sort((a, b) => { const sa = a.status === '중지' ? 1 : 0, sb = b.status === '중지' ? 1 : 0; return sa - sb || String(a.drug_name || '').localeCompare(String(b.drug_name || '')) });
      setRes(rows); setIdx(0); setTotal(count || rows.length); setLoading(false);
    }, 250);
    return () => { on = false; clearTimeout(h) };
  }, [q]);
  function pick(d) { if (!d) return; onClose(); if (open360) open360(d) }
  function onKey(e) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, res.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(res[idx]) }
  }
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '76px 16px' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: t.card, borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: t.shadowH, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid ' + t.border }}>
        <span style={{ fontSize: 16 }}>🔍</span>
        <input ref={inpRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="약품코드·약품명·성분(한/영) 검색…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: t.text }} />
        <span onClick={onClose} style={{ fontSize: 10, color: t.textL, border: '1px solid ' + t.border, borderRadius: 5, padding: '2px 6px', cursor: 'pointer' }}>Esc</span>
      </div>
      <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
        {q.trim().length < 1 ? <div style={{ padding: 24, textAlign: 'center', color: t.textL, fontSize: 12 }}>약품코드·약품명·성분으로 검색 (사용·휴면 + 아카이브)</div> : loading && !res.length ? <div style={{ padding: 24, textAlign: 'center', color: t.textL, fontSize: 12 }}>검색 중…</div> : !res.length ? <div style={{ padding: 24, textAlign: 'center', color: t.textL, fontSize: 12 }}>결과 없음</div> : res.map((d, i) => <div key={d.drug_code} onClick={() => pick(d)} onMouseEnter={() => setIdx(i)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', cursor: 'pointer', background: i === idx ? t.accentL : '', borderBottom: '1px solid ' + t.border }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.drug_name}{d.status === '중지' ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: t.textL, background: t.bg, border: '1px solid ' + t.border, borderRadius: 6, padding: '1px 6px' }}>🗄 아카이브</span> : null}{d.status === '휴면' ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: t.amber, background: t.amberL, borderRadius: 6, padding: '1px 6px' }}>휴면</span> : null}</div><div style={{ fontSize: 10, color: t.textL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.drug_code} · {d.category || '-'}{d.ingredient_kr ? ' · ' + d.ingredient_kr : ''}</div></div>{d.atc_l1 && String(d.atc_l1).trim() ? <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 10, fontWeight: 600, color: atcColor(d.atc_l1), background: atcColor(d.atc_l1) + '1A', border: '1px solid ' + atcColor(d.atc_l1) + '33', borderRadius: 10, padding: '2px 8px' }}>{d.atc_l1}</span> : null}</div>)}
      </div>
      {res.length > 0 && total > res.length ? <div style={{ padding: '6px 18px', background: t.amberL, color: t.amber, fontSize: 11, fontWeight: 600, textAlign: 'center' }}>총 {total}건 중 상위 {res.length}건 표시 · 검색어를 더 좁혀보세요</div> : null}<div style={{ padding: '8px 18px', borderTop: '1px solid ' + t.border, fontSize: 10, color: t.textL, display: 'flex', gap: 14 }}><span>↑↓ 이동</span><span>Enter 360°</span><span>Esc 닫기</span></div>
    </div>
  </div>;
}

/* ═══ 트리형 필터(아코디언) — 부모 클릭→하위 수직 펼침·선택 (UI 표현만, 필터 로직 무변경) ═══ */
function TreeFilter({ groups }) {
  const { t } = useTheme();
  const [open, setOpen] = useState({});
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {groups.map(g => {
      const isOpen = !!open[g.key];
      const selCnt = g.mode === 'single' ? (g.selected && g.selected !== '전체' ? 1 : 0) : g.items.filter(it => g.selected.includes(it)).length;
      return <div key={g.key} style={{ border: '1px solid ' + t.border, borderRadius: 8, overflow: 'hidden' }}>
        <div onClick={() => setOpen(o => ({ ...o, [g.key]: !o[g.key] }))} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', background: isOpen ? g.color + '0D' : t.bg }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{g.icon} {g.label}{selCnt > 0 ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: g.color, background: g.color + '1A', borderRadius: 8, padding: '1px 7px' }}>{g.mode === 'single' ? g.selected : selCnt}</span> : null}</span>
          <span style={{ fontSize: 10, color: t.textL }}>{isOpen ? '▲' : '▼'}</span>
        </div>
        {isOpen ? <div style={{ padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid ' + t.border }}>
          {g.items.length === 0 ? <span style={{ fontSize: 11, color: t.textL }}>항목 없음</span> : g.items.map(it => { const on = g.mode === 'single' ? g.selected === it : g.selected.includes(it); return <button key={it} onClick={() => g.onSelect(it)} style={{ padding: '4px 12px', borderRadius: 14, border: '1px solid ' + (on ? g.color : t.border), background: on ? g.color + '1A' : 'transparent', color: on ? g.color : t.textM, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>{it}</button> })}
        </div> : null}
      </div>; })}
  </div>;
}

/* ═══ GNB 드롭다운 내비 (hover/click→수직 펼침·스크롤·Esc·외부클릭 닫힘) ═══ */
function GnbNav({ ms, m, onFlat, navTo }) {
  const { t } = useTheme();
  const [dd, setDd] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setDd(null) }
    function onEsc(e) { if (e.key === 'Escape') setDd(null) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) };
  }, []);
  const btnBase = (active) => ({ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400, background: active ? t.navHi + '22' : 'transparent', color: active ? t.navHi : 'rgba(255,255,255,0.55)', border: '1px solid ' + (active ? t.navHi + '40' : 'transparent'), transition: 'all .15s', whiteSpace: 'nowrap' });
  return <div ref={ref} className="cnc-nav-desktop" style={{ display: 'flex', gap: 2, flex: '1 1 auto', justifyContent: 'center' }}>
    {ms.map((x, i) => x.children ? <div key={i} style={{ position: 'relative' }} onMouseEnter={() => setDd(i)} onMouseLeave={() => setDd(null)}>
        <button onClick={() => setDd(dd === i ? null : i)} style={btnBase(dd === i)}>{x.l} <span style={{ fontSize: 9 }}>▾</span></button>
        {dd === i ? <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, minWidth: 170, maxHeight: 320, overflowY: 'auto', background: t.nav, border: '1px solid ' + t.navHi + '40', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.32)', zIndex: 950, padding: 4 }}>
          {x.children.map((c, j) => <button key={j} onClick={() => { setDd(null); navTo(c.nav) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.78)', cursor: 'pointer', fontSize: 12, borderRadius: 6, whiteSpace: 'nowrap' }} onMouseEnter={e => e.currentTarget.style.background = t.navHi + '22'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{c.l}</button>)}
        </div> : null}
      </div>
      : <button key={i} onClick={() => onFlat(x.id)} style={btnBase(m === x.id)}>{x.l}</button>)}
  </div>;
}

function Drug360Modal({ drug: dr, onClose, pos, setPos }) {
  const { t } = useTheme();
  const [tab, setTab] = useState('개요');
  const boxRef = useRef(null);
  const { dragging, onHeaderMouseDown } = useDraggableModal(boxRef, pos, setPos);
  // Esc 닫기 — 모달이 열려 있을 때(마운트 동안)만 바인딩, 닫히면 해제. 입력 포커스 무관(window 레벨).
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose]);
  const [txs, setTxs] = useState(null);
  const [lots, setLots] = useState(null);
  useEffect(() => { let on = true;
    supabase.from('transactions').select('*').eq('drug_code', dr.drug_code).order('transaction_date', { ascending: false }).limit(100).then(({ data }) => { if (on) setTxs(data || []) });
    supabase.from('drug_lots').select('*').eq('drug_code', dr.drug_code).order('expiry_date').then(({ data }) => { if (on) setLots(data || []) });
    return () => { on = false }; }, [dr.drug_code]);
  const q = dr.current_qty || 0, sf = dr.safety_stock || 0, mx = dr.max_stock || 0;
  let st = '정상'; if (q === 0) st = '재고없음'; else if (sf > 0 && q < sf) st = '부족'; else if (mx > 0 && q > mx) st = '과잉';
  const stc = st === '재고없음' ? t.red : st === '부족' ? t.amber : st === '과잉' ? t.blue : t.green;
  const dday = exD(dr.expiry_date); const acc = atcColor(dr.atc_l1);
  const TABS = ['개요', '입출고', '재고', '유효기한', '향정'];
  const chip = (v) => (v && String(v).trim()) ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: acc + '1A', color: acc, border: '1px solid ' + acc + '33', marginRight: 6, marginBottom: 4 }}>{v}</span> : null;
  const row = (label, val) => <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid ' + t.border, fontSize: 13 }}><span style={{ color: t.textM }}>{label}</span><span style={{ fontWeight: 600, color: t.text, textAlign: 'right' }}>{val}</span></div>;
  const dstr = (x) => x !== null ? 'D' + (x <= 0 ? x : '-' + x) : '-';
  return <div style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto', pointerEvents: 'none' }}>
    <div ref={boxRef} style={{ background: t.card, borderRadius: 16, width: '100%', maxWidth: 640, boxShadow: t.shadowH, overflow: 'hidden', transform: `translate(${pos.x}px, ${pos.y}px)`, pointerEvents: 'auto' }}>
      <div onMouseDown={onHeaderMouseDown} style={{ background: t.nav, padding: '16px 20px', color: '#fff', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><div><div style={{ fontSize: 17, fontWeight: 700 }}>{dr.drug_name}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{dr.drug_code} · {dr.category || '-'}</div></div><button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 8, cursor: 'pointer', fontSize: 15 }}>✕</button></div></div>
      <div style={{ display: 'flex', gap: 2, padding: '8px 12px 0', borderBottom: '1px solid ' + t.border, background: t.bg }}>{TABS.map(x => <button key={x} onClick={() => setTab(x)} style={{ padding: '8px 14px', border: 'none', borderBottom: tab === x ? '2px solid ' + t.accent : '2px solid transparent', background: 'transparent', color: tab === x ? t.accent : t.textM, fontWeight: tab === x ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>{x}</button>)}</div>
      <div style={{ padding: '16px 20px', maxHeight: '60vh', overflowY: 'auto' }}>
        {tab === '개요' && <div><div style={{ marginBottom: 10 }}>{chip(dr.atc_l1)}{chip(dr.atc_l2)}{chip(dr.atc_l3)}{!dr.atc_l1 && <span style={{ color: t.textL, fontSize: 12 }}>ATC 미분류</span>}</div>{row('상태', <SB s={dr.status} />)}{row('구분', dr.category || '-')}{row('구입단가', dr.purchase_price ? Number(dr.purchase_price).toLocaleString() + '원' : '-')}{row('성분명', dr.ingredient_kr || '-')}{row('제조사', dr.manufacturer || '-')}{row('제형 / 단위', (dr.specification || '-') + ' / ' + (dr.unit || '-'))}{row('현재고', q.toLocaleString() + '  (' + st + ')')}</div>}
        {tab === '입출고' && <div>{txs === null ? <div style={{ color: t.textL, textAlign: 'center', padding: 20 }}>불러오는 중...</div> : !txs.length ? <div style={{ color: t.textL, textAlign: 'center', padding: 20, fontSize: 12 }}>거래 내역 없음</div> : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['일자', '유형', '수량', '금액'].map((h, hi) => <th key={h} style={{ textAlign: hi < 2 ? 'left' : 'right', padding: '6px 8px', color: t.textM, borderBottom: '1px solid ' + t.border }}>{h}</th>)}</tr></thead><tbody>{txs.map((x, i) => { const tcl = x.type === '입고' ? t.green : x.type === '출고' ? t.blue : x.type === '폐기' ? t.red : t.amber; return <tr key={i} style={{ borderBottom: '1px solid ' + t.border }}><td style={{ padding: '6px 8px', color: t.textM }}>{x.transaction_date}</td><td style={{ padding: '6px 8px' }}><Bd bg={tcl + '18'} color={tcl}>{x.type}</Bd></td><td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{x.quantity?.toLocaleString()}</td><td style={{ padding: '6px 8px', textAlign: 'right', color: t.textM }}>{x.total_amount ? '₩' + x.total_amount.toLocaleString() : '-'}</td></tr> })}</tbody></table>}</div>}
        {tab === '재고' && <div>{row('현재고', <span style={{ color: stc, fontWeight: 700 }}>{q.toLocaleString()}</span>)}{row('재고상태', <Bd bg={stc + '18'} color={stc}>{st}</Bd>)}{row('안전재고', sf || '-')}{row('최대재고', mx || '-')}{row('월평균 사용', dr.monthly_avg || '-')}{row('재고금액', dr.purchase_price ? '₩' + (q * Number(dr.purchase_price)).toLocaleString() : '-')}</div>}
        {tab === '유효기한' && <div>{row('대표 유효기한', <span style={exS(dr.expiry_date, t)}>{(dr.expiry_date || '-') + (dday !== null ? '  (' + dstr(dday) + ')' : '')}</span>)}<div style={{ marginTop: 12, marginBottom: 6, fontSize: 11, color: t.textM, fontWeight: 700 }}>LOT 목록</div>{lots === null ? <div style={{ color: t.textL, padding: 12 }}>불러오는 중...</div> : !lots.length ? <div style={{ color: t.textL, padding: 12, fontSize: 12 }}>등록된 LOT 없음</div> : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['LOT', '유효기한', '수량', 'D-day'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: t.textM, borderBottom: '1px solid ' + t.border }}>{h}</th>)}</tr></thead><tbody>{lots.map((l, i) => { const dd = exD(l.expiry_date); return <tr key={i} style={{ borderBottom: '1px solid ' + t.border, opacity: l.is_active ? 1 : 0.5 }}><td style={{ padding: '6px 8px', fontWeight: 600 }}>{l.lot_no}</td><td style={{ padding: '6px 8px', ...exS(l.expiry_date, t) }}>{l.expiry_date}</td><td style={{ padding: '6px 8px' }}>{l.quantity?.toLocaleString()}</td><td style={{ padding: '6px 8px' }}>{dstr(dd)}</td></tr> })}</tbody></table>}</div>}
        {tab === '향정' && <div>{row('규제 구분', getNT(dr) === '일반' ? <span style={{ color: t.textL }}>일반 (비규제)</span> : <Bd bg={getNT(dr) === '마약' ? t.redL : t.purpleL} color={getNT(dr) === '마약' ? t.red : t.purple}>{getNT(dr)}</Bd>)}{row('마약류 여부', isN(dr) ? '해당' : '비해당')}{row('유효기한 D-day', dstr(dday))}{row('보관 방법', dr.storage_method || '-')}{getNT(dr) === '일반' && <div style={{ marginTop: 12, fontSize: 12, color: t.textL }}>향정·마약류가 아닌 일반 약품입니다.</div>}</div>}
      </div>
    </div>
  </div>;
}

/* ═══ 약품 수정 모달 (드래그 가능) ═══ */
function DrugEditModal({ drug: dr, onClose, onSaved, onLotManage }) {
  const { t, profile, memberRole } = useTheme(); const oc = dr.drug_code || ''
  const canDelete = profile?.role === 'admin' || memberRole === 'owner' || memberRole === 'admin'
  const isNew = !!dr.__register
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [f, sF] = useState({ drug_code: oc, drug_name: dr.drug_name || '', category: dr.category || '', ingredient_en: dr.ingredient_en || '', ingredient_kr: dr.ingredient_kr || '', efficacy_class: dr.efficacy_class || '', efficacy: dr.efficacy || '', manufacturer: dr.manufacturer || '', specification: dr.specification || '', unit: dr.unit || '', packaging: dr.packaging || dr.unit || '', total_qty: dr.total_qty ?? '', price_unit: dr.price_unit || 0, insurance_price: dr.insurance_price || 0, purchase_price: dr.purchase_price ?? '', edi_price: dr.edi_price ?? '', insurance_code: dr.insurance_code || '', current_qty: dr.current_qty || 0, expiry_date: dr.expiry_date || '', status: dr.status || '사용', narcotic_type: (dr.narcotic_type === '한외마약' ? '한외마약' : getNT(dr)), safety_stock: dr.safety_stock || 0, max_stock: dr.max_stock || 0, lot_no: dr.lot_no || '', insurance_type: dr.insurance_type || '급여', prescription_type: dr.prescription_type || '', atc_code: dr.atc_code || '', storage_method: dr.storage_method || '실온', storage_location: dr.storage_location || '', notes: dr.notes || '', standard_code: dr.standard_code || '' })
  const [saving, setSaving] = useState(false); const [msg, setMsg] = useState(null); const [apiLd, setApiLd] = useState(false)
  const [apiResults, setApiResults] = useState([])
  const [lookupInfo, setLookupInfo] = useState(null)
  const [pos, setPos] = useState({ x: 0, y: 0 }); const [dragging, setDragging] = useState(false); const dragRef = useRef(null)
  function set(k, v) { sF(p => ({ ...p, [k]: v })) }
  const [detailOpen, setDetailOpen] = useState(false)
  const [dupCode, setDupCode] = useState(false); const [chkCode, setChkCode] = useState(false)
  /* 등록 모드 전용: 약품코드 중복 실시간 확인(디바운스 400ms) */
  useEffect(() => {
    if (!isNew) return
    const code = f.drug_code.trim(); if (!code) { setDupCode(false); setChkCode(false); return }
    let on = true; setChkCode(true)
    const id = setTimeout(async () => {
      const { count } = await supabase.from('drugs').select('drug_code', { count: 'exact', head: true }).eq('drug_code', code)
      if (on) { setDupCode((count || 0) > 0); setChkCode(false) }
    }, 400)
    return () => { on = false; clearTimeout(id) }
  }, [f.drug_code, isNew])

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
    /* try/finally — 어떤 예외/타임아웃이 발생해도 setApiLd(false) 반드시 호출되어
       "조회중..." 영구 상태 방지 */
    try {
    const px = new DOMParser()
    const nm = searchName
    const isEng = s => s && /^[a-zA-Z\s()[\]\-,.:;0-9]+$/.test(s)
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
    } catch { /* 오류 무시 */ }
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
              const ingrParts = mainIngr.split(/[;；,，/]/).map(s=>s.trim()).filter(Boolean)
              const ingrEn = ingrParts.find(p=>isEng(p))||''
              const ingrKr = ingrParts.find(p=>!isEng(p))||''
              const parenKr = nm.match(/[(（]([가-힣\s]+)[)）]/)?.[1]||''
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
          } catch { /* 오류 무시 */ }
        } catch { /* 오류 무시 */ }
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
          } catch { /* 오류 무시 */ }
        } catch { /* 오류 무시 */ }
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
          } catch { /* 오류 무시 */ }
        } catch { /* 오류 무시 */ }
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
        } catch { /* 오류 무시 */ }
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
        } catch { /* 오류 무시 */ }
      }
      const cnt = Object.values(found).filter(Boolean).length
      setMsg(cnt === 5 ? 'OK' : `${cnt}/5 API 조회 완료`)
      setTimeout(() => setMsg(null), 3000)
    } catch (e) { setMsg('API 오류: ' + e.message) }
    setLookupInfo(Object.keys(info).length>0?info:null)
    /* 최종 성분명 언어 검증: 영어/한글 뒤바뀜 자동 교정 */
    sF(p => {
      let en = info.ingredientEn||p.ingredient_en, kr = info.ingredientKr||p.ingredient_kr
      const chk = s => s && /^[a-zA-Z\s()[\]\-,.:;0-9]+$/.test(s)
      if (en && !chk(en) && kr && chk(kr)) { const tmp=en; en=kr; kr=tmp }
      else if (en && !chk(en) && !kr) { kr=en; en='' }
      else if (kr && chk(kr) && !en) { en=kr; kr='' }
      return {...p, ingredient_en:en, ingredient_kr:kr}
    })
    } finally {
      /* 어떤 경우에도 로딩 상태 해제 — "조회중..." 영구 상태 방지 */
      setApiLd(false)
    }
  }

  /* 리스트에서 다른 약품 선택 → 약품명 교체 후 재조회 */
  function selectApiResult(item) {
    const parenKr2=(item.name||'').match(/[(（]([가-힣\s]+)[)）]/)?.[1]||''
    if (item.name) sF(p => ({ ...p, drug_name: item.name, manufacturer: item.manufacturer || p.manufacturer, efficacy: item.efficacy || p.efficacy, storage_method: item.storage ? stdStorage(item.storage) : p.storage_method, unit: item.unit || p.unit, insurance_code: item.insuranceCode || p.insurance_code, ingredient_en: item.ingredientEn || p.ingredient_en, ingredient_kr: item.ingredientKr || parenKr2 || p.ingredient_kr }))
    setApiResults([])
    lookupApi(item.name)
  }

  /* 등록 모드 저장 — INSERT. 기존 단일/대량 등록과 동일 패턴(tenant_id 미세팅=DB기본값, 누락컬럼 재시도).
     구입단가·보험약가는 서로 덮어쓰지 않으며, 금액 파생값은 저장하지 않는다. */
  async function saveNew() {
    const code = f.drug_code.trim()
    if (!code) { setMsg('약품코드 필수'); return }
    if (!f.drug_name.trim()) { setMsg('약품명 필수'); return }
    if (!CATS.includes(f.category)) { setMsg('구분을 선택하세요'); return }
    if (dupCode) { setMsg('이미 존재하는 약품코드입니다.'); return }
    setSaving(true); setMsg(null)
    const _atc = decomposeAtc(f.atc_code); const row = { drug_code: code, drug_name: f.drug_name.trim(), category: f.category, ingredient_en: f.ingredient_en || null, ingredient_kr: f.ingredient_kr || null, efficacy_class: f.efficacy_class || null, efficacy: f.efficacy || null, manufacturer: f.manufacturer || null, specification: f.specification || null, unit: f.packaging || null, packaging: f.packaging || null, total_qty: (f.total_qty === '' || f.total_qty == null) ? null : Number(f.total_qty), purchase_price: (f.purchase_price === '' || f.purchase_price == null) ? null : Number(f.purchase_price), edi_price: Number(f.insurance_price) || 0, insurance_type: f.insurance_type, insurance_code: f.insurance_code || null, standard_code: f.standard_code || null, compound_type: f.compound_type || '단일제', current_qty: Number(f.current_qty) || 0, safety_stock: Number(f.safety_stock) || 0, max_stock: Number(f.max_stock) || 0, expiry_date: f.expiry_date || null, lot_no: f.lot_no || null, storage_method: f.storage_method || null, storage_location: f.storage_location || null, status: f.status, notes: f.notes || null, is_narcotic: f.narcotic_type === '향정' || f.narcotic_type === '마약', narcotic_type: f.narcotic_type === '일반' ? null : f.narcotic_type, prescription_type: f.prescription_type || null, atc_code: f.atc_code ? f.atc_code.trim().toUpperCase() : null, atc_l1: _atc.atc_l1 || null, atc_l2: _atc.atc_l2 || null, atc_l3: _atc.atc_l3 || null }
    if (memberRole === 'owner') row.is_high_alert = !!f.is_high_alert
    let res = await supabase.from('drugs').insert([row])
    for (let retry = 0; retry < 3 && res.error && res.error.message.includes('column'); retry++) {
      const m = res.error.message.match(/'([^']+)' column/); if (!m) break; console.warn('[drugs INSERT] 미존재 컬럼 자동 제거:', m[1], '/ 원인:', res.error.message); delete row[m[1]]
      res = await supabase.from('drugs').insert([row])
    }
    setSaving(false)
    if (res.error) { setMsg(res.error.message.includes('duplicate') || res.error.message.includes('unique') ? '이미 존재하는 약품코드입니다.' : res.error.message); return }
    setMsg('OK'); setTimeout(() => { onSaved?.(); onClose() }, 500)
  }
  async function save() {
    if (isNew) return saveNew()
    if (!f.drug_name.trim()) { setMsg('약품명 필수'); return }
    setSaving(true); setMsg(null)
    /* [빈칸=기존값 유지] A(saveNew)·D(BulkUpload)와 동일하게, 비운 칸은 UPDATE에서 제외해 기존 DB 값을 덮어쓰지 않는다.
       의도적 값 삭제는 별도 UI로 처리 예정 - 현재는 '기존값 유지'로 통일. price_unit(표시용 파생)·insurance_price(미존재 컬럼)는 기입하지 않는다.
       편집 모드엔 보험약가 입력칸이 없어 edi_price도 기입하지 않는다(빈 유령값으로 실제 edi_price를 0으로 덮어쓰는 것 방지). */
    const _has = v => (v != null && String(v).trim() !== '')
    const _num = v => (v !== '' && v != null && Number.isFinite(Number(v)))
    const ud = { status: f.status, is_narcotic: f.narcotic_type === '향정' || f.narcotic_type === '마약' }
    if (_has(f.drug_name)) ud.drug_name = f.drug_name
    if (f.drug_code.trim() && f.drug_code.trim() !== oc) ud.drug_code = f.drug_code.trim()
    ;['category', 'narcotic_type', 'insurance_type', 'storage_method', 'ingredient_kr', 'ingredient_en', 'manufacturer', 'lot_no', 'insurance_code', 'efficacy', 'efficacy_class', 'specification', 'storage_location', 'notes', 'prescription_type'].forEach(k => { if (_has(f[k])) ud[k] = f[k] }); ud.packaging = f.packaging || null; ud.unit = f.packaging || null; ud.total_qty = (f.total_qty === '' || f.total_qty == null) ? null : Number(f.total_qty); ud.standard_code = f.standard_code || null
    if (_has(f.expiry_date)) ud.expiry_date = f.expiry_date
    ;['safety_stock', 'max_stock', 'purchase_price', 'edi_price'].forEach(k => { if (_num(f[k])) ud[k] = Number(f[k]) })
    if (_has(f.atc_code)) { const _atc = decomposeAtc(f.atc_code); ud.atc_code = f.atc_code.trim().toUpperCase(); ud.atc_l1 = _atc.atc_l1 || null; ud.atc_l2 = _atc.atc_l2 || null; ud.atc_l3 = _atc.atc_l3 || null }
    let res = dr.id ? await supabase.from('drugs').update(ud).eq('id', dr.id) : await supabase.from('drugs').update(ud).eq('drug_code', oc)
    /* 누락 컬럼 자동 제거 후 재시도 (최대 3회) */
    for(let retry=0;retry<3&&res.error&&res.error.message.includes('column');retry++){
      const m=res.error.message.match(/'([^']+)' column/);if(!m)break;console.warn('[drugs UPDATE] 미존재 컬럼 자동 제거:', m[1], '/ 원인:', res.error.message);delete ud[m[1]]
      res=dr.id?await supabase.from('drugs').update(ud).eq('id',dr.id):await supabase.from('drugs').update(ud).eq('drug_code',oc)
    }
    setSaving(false)
    if (res.error) { setMsg(res.error.message); return }
    setMsg('OK'); setTimeout(() => { onSaved?.(); onClose() }, 500)
  }

  const ip = { width: '100%', padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }
  const lb = { fontSize: 10, color: t.textM, marginBottom: 4, display: 'block', fontWeight: 600 }; const cc = f.drug_code.trim() !== oc
  const regInvalid = isNew && (!f.drug_code.trim() || !f.drug_name.trim() || !CATS.includes(f.category) || dupCode || chkCode)
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
    <div style={{ background: t.cardSolid, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${t.border}`, boxShadow: t.shadowH, transform: `translate(${pos.x}px, ${pos.y}px)` }} onClick={e => e.stopPropagation()}>
      <div onMouseDown={onDragStart} style={{ padding: '18px 24px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}>
        <div><div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{isNew ? '약품 등록' : '약품 정보 수정'}</div><div style={{ fontSize: 11, color: t.textM, marginTop: 2 }}>{isNew ? '신규 약품을 등록합니다' : `코드: ${oc}`} · 드래그하여 이동</div></div>
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
          {isNew ? (<>
            {/* 등록 모드: 필수 3개 상단 고정 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={lb}>약품코드 *</label><input value={f.drug_code} onChange={e => set('drug_code', e.target.value)} placeholder="영문·숫자 코드(문자열)" style={{ ...ip, borderColor: dupCode ? t.red : t.border }} />{chkCode ? <div style={{ fontSize: 10, color: t.textL, marginTop: 2 }}>중복 확인 중…</div> : dupCode ? <div style={{ fontSize: 10, color: t.red, marginTop: 2 }}>⚠ 이미 존재하는 약품코드</div> : (f.drug_code.trim() ? <div style={{ fontSize: 10, color: t.green, marginTop: 2 }}>사용 가능한 코드</div> : null)}</div>
              <div><label style={lb}>약품명 *</label><input value={f.drug_name} onChange={e => set('drug_name', e.target.value)} onKeyDown={e => e.key === 'Enter' && lookupApi()} style={ip} /></div>
            </div>
            <div style={{ marginBottom: 10 }}><label style={lb}>구분 *</label><select value={f.category} onChange={e => set('category', e.target.value)} style={ip}><option value="">— 선택 —</option>{CATS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div style={{ marginBottom: 10 }}><label style={lb}>보험약가</label><input type="number" value={f.insurance_price} onChange={e => set('insurance_price', e.target.value)} placeholder="API 조회 시 자동입력" style={ip} /></div>
            {/* 상세 입력 (접이식·기본 접힘) */}
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, marginBottom: 10 }}>
              <button type="button" onClick={() => setDetailOpen(o => !o)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: t.textM, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>상세 입력<span style={{ fontSize: 10, color: t.textL }}>{detailOpen ? '▲ 접기' : '▼ 펼치기'}</span></button>
              {detailOpen && <div style={{ padding: '0 12px 12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>상태</label><select value={f.status} onChange={e => set('status', e.target.value)} style={ip}>{STATS.map(s => <option key={s}>{s}</option>)}</select></div><div><label style={lb}>급여구분</label><select value={f.insurance_type} onChange={e => set('insurance_type', e.target.value)} style={ip}>{['급여', '비급여'].map(s => <option key={s}>{s}</option>)}</select></div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>마약구분</label><select value={f.narcotic_type} onChange={e => set('narcotic_type', e.target.value)} style={ip}>{['일반', '향정', '마약', '한외마약'].map(s => <option key={s}>{s}</option>)}</select></div><div><label style={lb}>복합/단일</label><select value={f.compound_type || '단일제'} onChange={e => set('compound_type', e.target.value)} style={ip}>{['단일제', '복합제'].map(s => <option key={s}>{s}</option>)}</select></div></div>
                <div style={{ marginBottom: 10 }}><label style={lb}>분류</label><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{RX_TOGGLE.map(x => <button key={x} type="button" onClick={() => set('prescription_type', f.prescription_type === x ? '' : x)} style={{ flex: 1, padding: '8px', borderRadius: 6, border: '1px solid ' + (f.prescription_type === x ? t.accent : t.border), cursor: 'pointer', fontSize: 12, fontWeight: 600, background: f.prescription_type === x ? t.accent : 'transparent', color: f.prescription_type === x ? '#fff' : t.textL }}>{x}</button>)}<select value={RX_MORE.includes(f.prescription_type) ? f.prescription_type : ''} onChange={e => set('prescription_type', e.target.value)} style={{ ...ip, flex: 1 }}><option value="">기타…</option>{RX_MORE.map(x => <option key={x} value={x}>{x}</option>)}</select></div></div>
                <div style={{ marginBottom: 10 }}><label style={lb}>ATC코드</label><input value={f.atc_code} onChange={e => set('atc_code', e.target.value.toUpperCase())} placeholder="예: N02BE01" style={ip} />{(() => { const _a = decomposeAtc(f.atc_code); return (f.atc_code && (_a.atc_l1 || _a.atc_l2 || _a.atc_l3)) ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{[_a.atc_l1, _a.atc_l2, _a.atc_l3].filter(Boolean).map((v, i) => <span key={i} style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: t.purpleL, color: t.purple, border: '1px solid ' + t.purple + '33' }}>{v}</span>)}</div> : f.atc_code ? <div style={{ marginTop: 6, fontSize: 10, color: t.textL }}>매핑 없음 — 코드만 저장(분류 비움)</div> : null })()}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>성분명(영문)</label><input value={f.ingredient_en} onChange={e => set('ingredient_en', e.target.value)} style={ip} /></div><div><label style={lb}>성분명(한글)</label><input value={f.ingredient_kr} onChange={e => set('ingredient_kr', e.target.value)} style={ip} /></div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>약효분류명</label><input value={f.efficacy_class} onChange={e => set('efficacy_class', e.target.value)} style={ip} /></div><div><label style={lb}>제조사</label><input value={f.manufacturer} onChange={e => set('manufacturer', e.target.value)} style={ip} /></div></div>
                <div style={{ marginBottom: 10 }}><label style={lb}>효능</label><input value={f.efficacy} onChange={e => set('efficacy', e.target.value)} placeholder="API 조회 시 자동입력" style={ip} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>규격</label><input type="number" value={f.total_qty} onChange={e => set('total_qty', e.target.value)} style={ip} /></div><div><label style={lb}>제형</label><input value={f.specification} onChange={e => set('specification', e.target.value)} style={ip} /></div><div><label style={lb}>포장</label><input value={f.packaging} onChange={e => set('packaging', e.target.value)} style={ip} /></div></div>
                <div style={{ marginBottom: 10 }}><label style={lb}>구입단가</label><input type="number" value={f.purchase_price} onChange={e => set('purchase_price', e.target.value)} style={ip} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>현재고</label><input type="number" value={f.current_qty} onChange={e => set('current_qty', e.target.value)} style={ip} /></div><div><label style={lb}>안전재고</label><input type="number" value={f.safety_stock} onChange={e => set('safety_stock', e.target.value)} style={ip} /></div><div><label style={lb}>최대재고</label><input type="number" value={f.max_stock} onChange={e => set('max_stock', e.target.value)} style={ip} /></div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>보험코드</label><input value={f.insurance_code} onChange={e => set('insurance_code', e.target.value)} style={ip} /></div><div><label style={lb}>유효기한(대표)</label><input type="date" value={f.expiry_date} onChange={e => set('expiry_date', e.target.value)} style={ip} /></div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>품목기준코드</label><input value={f.standard_code} onChange={e => set('standard_code', e.target.value)} style={ip} /></div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>보관방법</label><select value={f.storage_method} onChange={e => set('storage_method', e.target.value)} style={ip}>{STORAGE_OPTS.map(s => <option key={s}>{s}</option>)}</select></div><div><label style={lb}>보관위치</label><input value={f.storage_location} onChange={e => set('storage_location', e.target.value)} style={ip} /></div></div>
                <div style={{ marginBottom: 10 }}><label style={lb}>비고</label><textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...ip, resize: 'vertical' }} /></div>
                {memberRole === 'owner' && <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 0' }}><input type="checkbox" checked={!!f.is_high_alert} onChange={e => set('is_high_alert', e.target.checked)} style={{ width: 16, height: 16, accentColor: '#D9342B' }} /><span style={{ fontSize: 12, fontWeight: 700, color: '#D9342B' }}>⚠ 고위험 의약품으로 지정</span></label>}
              </div>}
            </div>
          </>) : (<>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>약품코드</label><input value={f.drug_code} onChange={e => set('drug_code', e.target.value)} style={{ ...ip, borderColor: cc ? t.amber : t.border }} />{cc && <div style={{ fontSize: 10, color: t.amber, marginTop: 2 }}>⚠ {oc} → {f.drug_code.trim()}</div>}</div><div><label style={lb}>약품명 *</label><input value={f.drug_name} onChange={e => set('drug_name', e.target.value)} onKeyDown={e=>e.key==='Enter'&&lookupApi()} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>구분</label><select value={f.category} onChange={e => set('category', e.target.value)} style={ip}>{CATS.map(c => <option key={c}>{c}</option>)}</select></div><div><label style={lb}>상태</label><select value={f.status} onChange={e => set('status', e.target.value)} style={ip}>{STATS.map(s => <option key={s}>{s}</option>)}</select></div><div><label style={lb}>급여구분</label><div style={{ display: 'flex', gap: 4 }}>{['급여', '비급여'].map(x => <button key={x} onClick={() => set('insurance_type', x)} style={{ flex: 1, padding: '8px', borderRadius: 6, border: `1px solid ${f.insurance_type === x ? t.blue : t.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: f.insurance_type === x ? t.blueL : 'transparent', color: f.insurance_type === x ? t.blue : t.textL }}>{x}</button>)}</div></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>성분명(영문)</label><input value={f.ingredient_en} onChange={e => set('ingredient_en', e.target.value)} style={ip} /></div><div><label style={lb}>성분명(한글)</label><input value={f.ingredient_kr} onChange={e => set('ingredient_kr', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>약효분류명</label><input value={f.efficacy_class} onChange={e => set('efficacy_class', e.target.value)} style={ip} /></div><div><label style={lb}>제조사</label><input value={f.manufacturer} onChange={e => set('manufacturer', e.target.value)} style={ip} /></div></div>
          <div style={{ marginBottom: 10 }}><label style={lb}>효능</label><input value={f.efficacy} onChange={e => set('efficacy', e.target.value)} placeholder="API 조회 시 자동입력" style={ip} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>규격</label><input type="number" value={f.total_qty} onChange={e => set('total_qty', e.target.value)} style={ip} /></div><div><label style={lb}>제형</label><input value={f.specification} onChange={e => set('specification', e.target.value)} placeholder="포장단위 (API 자동입력)" style={ip} /></div><div><label style={lb}>포장</label><input value={f.packaging} onChange={e => set('packaging', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>구입단가</label><input type="number" value={f.purchase_price} onChange={e => set('purchase_price', e.target.value)} style={ip} /></div><div><label style={lb}>보험약가</label><input type="number" value={f.edi_price} onChange={e => set('edi_price', e.target.value)} style={ip} /></div><div><label style={lb}>보험코드</label><input value={f.insurance_code} onChange={e => set('insurance_code', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>품목기준코드</label><input value={f.standard_code} onChange={e => set('standard_code', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>현재고</label><input type="number" value={f.current_qty} onChange={e => set('current_qty', e.target.value)} style={ip} /></div><div><label style={lb}>안전재고</label><input type="number" value={f.safety_stock} onChange={e => set('safety_stock', e.target.value)} style={ip} /></div><div><label style={lb}>최대재고</label><input type="number" value={f.max_stock} onChange={e => set('max_stock', e.target.value)} style={ip} /></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>유효기한 (대표)</label><input type="date" value={f.expiry_date} onChange={e => set('expiry_date', e.target.value)} style={ip} /></div><div><label style={lb}>LOT번호 · 다중 유효기한</label><div style={{ display: 'flex', gap: 4 }}><input value={f.lot_no} onChange={e => set('lot_no', e.target.value)} placeholder="대표 LOT" style={{ ...ip, flex: 1 }} /><button onClick={() => onLotManage?.(dr)} style={{ padding: '0 14px', borderRadius: 6, border: `1px solid ${t.purple}`, background: t.purpleL, color: t.purple, cursor: 'pointer', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>LOT관리 →</button></div></div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}><div><label style={lb}>보관방법</label><select value={f.storage_method} onChange={e => set('storage_method', e.target.value)} style={ip}>{STORAGE_OPTS.map(s=><option key={s}>{s}</option>)}</select></div><div><label style={lb}>보관위치</label><input value={f.storage_location} onChange={e => set('storage_location', e.target.value)} style={ip} /></div></div>
          <div style={{ marginBottom: 10 }}><label style={lb}>비고</label><textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...ip, resize: 'vertical' }} /></div>
          <div><label style={lb}>마약구분</label><div style={{ display: 'flex', gap: 4 }}>{['일반', '향정', '마약', '한외마약'].map(x => { const a = f.narcotic_type === x, cl = x === '일반' ? t.green : x === '향정' ? t.purple : x === '마약' ? t.red : t.blue; return <button key={x} onClick={() => set('narcotic_type', x)} style={{ flex: 1, padding: '8px', borderRadius: 6, border: `1px solid ${a ? cl : t.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: a ? cl + '18' : 'transparent', color: a ? cl : t.textL }}>{x}</button> })}</div></div>
          <div style={{ marginBottom: 10 }}><label style={lb}>분류</label><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{RX_TOGGLE.map(x => <button key={x} type="button" onClick={() => set('prescription_type', f.prescription_type === x ? '' : x)} style={{ flex: 1, padding: '8px', borderRadius: 6, border: '1px solid ' + (f.prescription_type === x ? t.accent : t.border), cursor: 'pointer', fontSize: 12, fontWeight: 600, background: f.prescription_type === x ? t.accent : 'transparent', color: f.prescription_type === x ? '#fff' : t.textL }}>{x}</button>)}<select value={RX_MORE.includes(f.prescription_type) ? f.prescription_type : ''} onChange={e => set('prescription_type', e.target.value)} style={{ ...ip, flex: 1 }}><option value="">기타…</option>{RX_MORE.map(x => <option key={x} value={x}>{x}</option>)}</select></div></div>
          <div style={{ marginBottom: 10 }}><label style={lb}>ATC코드</label><input value={f.atc_code} onChange={e => set('atc_code', e.target.value.toUpperCase())} placeholder="예: N02BE01" style={ip} />{(() => { const _a = decomposeAtc(f.atc_code); return (f.atc_code && (_a.atc_l1 || _a.atc_l2 || _a.atc_l3)) ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{[_a.atc_l1, _a.atc_l2, _a.atc_l3].filter(Boolean).map((v, i) => <span key={i} style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: t.purpleL, color: t.purple, border: '1px solid ' + t.purple + '33' }}>{v}</span>)}</div> : f.atc_code ? <div style={{ marginTop: 6, fontSize: 10, color: t.textL }}>매핑 없음 — 코드만 저장(분류 비움)</div> : null })()}</div>
          </>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 8, border: `1px solid ${t.border}`, cursor: 'pointer', background: 'transparent', color: t.textM, fontSize: 13, fontWeight: 600 }}>취소</button><button onClick={save} disabled={saving || regInvalid} style={{ flex: 2, padding: 11, borderRadius: 8, border: 'none', cursor: (saving || regInvalid) ? 'not-allowed' : 'pointer', background: (saving || regInvalid) ? t.textL : t.accent, color: '#fff', fontSize: 13, fontWeight: 700 }}>{saving ? '저장 중...' : (isNew ? '등록' : '저장')}</button></div>
        {/* 관리자(profiles.role=admin) 또는 테넌트 owner/admin 전용 — 절제된 텍스트 버튼 */}
        {!isNew && canDelete && <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px dashed ${t.border}`, textAlign: 'right' }}>
          <button
            onClick={() => setShowDeleteModal(true)}
            onMouseEnter={e => { e.currentTarget.style.color = t.textM }}
            onMouseLeave={e => { e.currentTarget.style.color = t.textL }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, color: t.textL, padding: '4px 6px', textDecoration: 'underline', fontWeight: 500, transition: 'color .15s' }}
          >약품 영구 삭제</button>
        </div>}
      </div>
    </div>
    {showDeleteModal && <DrugDeleteConfirm drug={dr} onClose={() => setShowDeleteModal(false)} onDeleted={() => { setShowDeleteModal(false); onSaved?.(); onClose() }} />}
  </div>
}

/* ═══ 약품 영구 삭제 확인 모달 — 거래/재고 이력 카운트 → 0건일 때만 약품명 입력 후 hard delete ═══ */
function DrugDeleteConfirm({ drug: dr, onClose, onDeleted }) {
  const { t } = useTheme()
  const [phase, setPhase] = useState('checking') /* 'checking' | 'blocked' | 'confirm' | 'deleting' */
  /* 카운트 분리: tx(차단 기준) / inv·snap(안내/경고용, 차단 X) */
  const [counts, setCounts] = useState({ tx: 0, inv: 0, snap: 0 })
  const [confirmName, setConfirmName] = useState('')
  const [errMsg, setErrMsg] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const code = dr.drug_code
        /* 3개 테이블 카운트를 분리해서 보관:
           · tx (transactions)   = 실제 입출고 거래 → 차단 기준
           · inv (inventory_stock)·snap (monthly_snapshots) = 시스템 자동생성 → 안내/경고용 */
        const txRes   = await supabase.from('transactions')     .select('*', { count: 'exact', head: true }).eq('drug_code', code)
        const invRes  = await supabase.from('inventory_stock')  .select('*', { count: 'exact', head: true }).eq('drug_code', code)
        const snapRes = await supabase.from('monthly_snapshots').select('*', { count: 'exact', head: true }).eq('drug_code', code)
        const tx   = txRes.error   ? 0 : (txRes.count   || 0)
        const inv  = invRes.error  ? 0 : (invRes.count  || 0)
        const snap = snapRes.error ? 0 : (snapRes.count || 0)
        setCounts({ tx, inv, snap })
        /* 차단은 오직 tx 기준 — inv/snap은 차단하지 않음 (snap > 0이면 confirm에서 경고 표시) */
        setPhase(tx > 0 ? 'blocked' : 'confirm')
      } catch (e) {
        setErrMsg('이력 확인 중 오류: ' + e.message)
        setPhase('confirm') /* 확인 단계로라도 진입해 사용자가 결정할 수 있게 */
      }
    })()
  }, [dr])

  async function handleDelete() {
    if (confirmName !== dr.drug_name) return
    setPhase('deleting'); setErrMsg(null)
    const res = dr.id
      ? await supabase.from('drugs').delete().eq('id', dr.id)
      : await supabase.from('drugs').delete().eq('drug_code', dr.drug_code)
    if (res.error) {
      setErrMsg(res.error.message)
      setPhase('confirm')
      return
    }
    onDeleted?.()
  }

  const canSubmit = confirmName === dr.drug_name && phase === 'confirm'

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 14, padding: '22px 26px', maxWidth: 420, width: '100%', border: `1px solid ${t.border}`, boxShadow: t.shadowH }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 4 }}>약품 영구 삭제</div>
      <div style={{ fontSize: 11, color: t.textM, marginBottom: 16, lineHeight: 1.5 }}>
        <span style={{ fontFamily: 'monospace' }}>{dr.drug_code}</span> · <strong style={{ color: t.text }}>{dr.drug_name}</strong>
      </div>

      {phase === 'checking' && <div style={{ fontSize: 12, color: t.textM, padding: '14px 0', textAlign: 'center' }}>입출고 거래 이력 확인 중...</div>}

      {phase === 'blocked' && <>
        <div style={{ background: t.amberL, border: `1px solid ${t.amber}40`, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: t.text, lineHeight: 1.6, marginBottom: 14 }}>
          이 약품에는 입출고 거래 <strong style={{ color: t.amber }}>{counts.tx}건</strong>이 있어 영구 삭제할 수 없습니다.<br />
          상태를 <strong>'중지'</strong>로 변경해 목록에서 감출 수 있습니다.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.textM, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>확인</button>
        </div>
      </>}

      {(phase === 'confirm' || phase === 'deleting') && <>
        {errMsg && <div style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.textM, borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 11.5 }}>{errMsg}</div>}
        {counts.snap > 0 && <div style={{ background: t.amberL, border: `1px solid ${t.amber}40`, borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 11.5, color: t.text, lineHeight: 1.55 }}>
          ⚠️ 이 약품은 과거 월마감 기록 <strong style={{ color: t.amber }}>{counts.snap}건</strong>에 약품코드로 남아 있습니다.<br />
          삭제 후 과거 월마감 보고서에서 약품명이 표시되지 않을 수 있습니다.
        </div>}
        <div style={{ fontSize: 12, color: t.textM, marginBottom: 8, lineHeight: 1.55 }}>
          입출고 거래 없음. 영구 삭제하려면 아래 약품명을 정확히 입력해 주세요.
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10, padding: '9px 12px', background: t.bg, borderRadius: 6, border: `1px solid ${t.border}`, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>{dr.drug_name}</div>
        <input
          value={confirmName}
          onChange={e => setConfirmName(e.target.value)}
          placeholder="약품명을 그대로 입력"
          disabled={phase === 'deleting'}
          style={{ width: '100%', padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text, marginBottom: 14 }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={phase === 'deleting'} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.textM, fontSize: 12, fontWeight: 600, cursor: phase === 'deleting' ? 'not-allowed' : 'pointer' }}>취소</button>
          <button onClick={handleDelete} disabled={!canSubmit} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: canSubmit ? t.textM : t.textL, color: '#fff', fontSize: 12, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'background .15s' }}>{phase === 'deleting' ? '삭제 중...' : '영구 삭제'}</button>
        </div>
      </>}
    </div>
  </div>
}

/* ═══ 재고 보정 모달 — 거래기록 없이 수량만 보정, 보정이력은 drugs 테이블에 기록 ═══ */
function AdjustModal({ drug: dr, onClose, onSaved }) {
  const { t } = useTheme(); const [qty, setQty] = useState(dr.current_qty || 0); const [reason, setReason] = useState('실사 결과 반영'); const [saving, setSaving] = useState(false); const [msg, setMsg] = useState(null); const diff = qty - (dr.current_qty || 0)
  async function save() { if (!reason.trim()) { setMsg('사유 필수'); return }; setSaving(true)
    const d = Number(qty) - (dr.current_qty || 0)
    if (d === 0) { setSaving(false); setMsg('변동 없음'); setTimeout(() => { onSaved?.(); onClose() }, 500); return }
    /* 실사 조정도 거래로 일원화: transactions type='조정'(quantity=목표−현재) → 0009 트리거가 drugs+inventory 동기. 직접 update 제거. */
    const tx = { drug_code: dr.drug_code, drug_name: dr.drug_name, type: '조정', quantity: d, reason: `${reason} (${d > 0 ? '+' : ''}${d})`, transaction_date: new Date().toISOString().split('T')[0] }
    let res = await supabase.from('transactions').insert([tx])
    for(let r=0;r<3&&res.error&&res.error.message?.includes('column');r++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete tx[m[1]];res=await supabase.from('transactions').insert([tx])}
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
  const { t, dark, toggle, user, profile, logout, openSearch, open360 } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [tenant, setTenant] = useState('')
  useEffect(() => { let on = true; (async () => { const { data } = await supabase.from('tenants').select('name').limit(1).maybeSingle(); if (on && data && data.name) setTenant(data.name) })(); return () => { on = false } }, [])
  const ms = [{ id: 'dashboard', l: '대시보드' }, { id: 'alerts', l: '🔔 알림' }, { id: 'druglist', l: '약품목록' }, { id: 'expiry', l: '유효기한' }, { id: 'stock', l: '재고현황' }, { id: 'narcotic', l: '향정마약' }, { id: 'nonins', l: '비보험' }, { id: 'ordering', l: '발주' }, { id: 'transaction', l: '입출고' }, { id: 'report', l: '보고서' }, { id: 'emergency', l: '비상조제' }]
  function nav(id) { sm(id); setMobileOpen(false) }
  const displayName = profile?.full_name || user?.email?.split('@')[0] || ''
  const isAdmin = profile?.role === 'admin'
  return <>
    <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 900 }}>
      <div className="cnc-header" style={{ background: t.nav, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 54 }}>
      <div className="brand-area" style={{ cursor: 'pointer', flex: '0 0 auto' }} onClick={() => nav('dashboard')}>
        <div onClick={e => { e.stopPropagation(); nav('register') }} className="cnc-plus" style={{ width: 34, height: 34, borderRadius: 9, background: m === 'register' ? 'rgba(128, 74, 135, 0.85)' : 'rgba(128, 74, 135, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, cursor: 'pointer', color: '#BFA6D9', border: '1px solid rgba(128, 74, 135, 0.7)', flexShrink: 0, transition: 'background 0.15s', boxShadow: '0 2px 6px rgba(0,0,0,0.18)' }} title="신규 약품 등록">+</div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="brand-title cnc-title" style={{ fontSize: 17, color: '#ffffff', letterSpacing: 0.3, lineHeight: 1.15, fontWeight: 700 }}>약플로 · <span style={{ color: '#BFA6D9' }}>Yakflo</span></div>
          <div className="brand-sub" style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: 0.2, lineHeight: 1.2 }}>약품 통합 관리 솔루션</div>
        </div>
      </div>
      <GnbSearch t={t} open360={open360} openSearch={openSearch} atcColor={atcColor} /><div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}><div className="cnc-date" style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 2 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: t.green, boxShadow: '0 0 6px ' + t.green, flexShrink: 0 }} /><span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff' }}>ONLINE</span>{tenant && <span style={{ fontSize: 11, fontWeight: 600, color: t.navHi, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tenant}>· {tenant}</span>}</div><div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.16)', margin: '0 2px', flexShrink: 0 }} />
        <button onClick={() => nav('mypage')} title="마이페이지" className="cnc-date" style={{ padding: '4px 10px', borderRadius: 6, border: m === 'mypage' ? `1px solid ${t.navHi}60` : '1px solid rgba(255,255,255,0.10)', background: m === 'mypage' ? t.navHi + '22' : 'rgba(255,255,255,0.04)', color: m === 'mypage' ? t.navHi : 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 11, fontWeight: 500, transition: 'all .15s' }}>{displayName}</button>
        {isAdmin && <button onClick={() => nav('admin')} title="가입자 관리" style={{ padding: '4px 10px', borderRadius: 6, border: m === 'admin' ? `1px solid ${t.navHi}60` : '1px solid rgba(255,255,255,0.15)', background: m === 'admin' ? t.navHi + '22' : 'rgba(255,255,255,0.04)', color: m === 'admin' ? t.navHi : 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>관리</button>}
        <button onClick={logout} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 10, fontWeight: 500 }}>로그아웃</button>
        <button onClick={toggle} style={{ width: 38, height: 20, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: dark ? t.navHi + '30' : 'rgba(255,255,255,0.08)', cursor: 'pointer', position: 'relative', padding: 0 }}><div style={{ width: 16, height: 16, borderRadius: 8, background: dark ? t.navHi : 'rgba(255,255,255,0.4)', position: 'absolute', top: 1, left: dark ? 19 : 1, transition: 'all .2s' }} /></button>
        <button className="cnc-hamburger" onClick={() => setMobileOpen(!mobileOpen)} style={{ display: 'none', width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: mobileOpen ? t.navHi + '20' : 'transparent', cursor: 'pointer', color: t.navText, fontSize: 18, alignItems: 'center', justifyContent: 'center' }}>{mobileOpen ? '✕' : '☰'}</button>
      </div>
      </div>
      <div className="cnc-row2" style={{ background: t.nav, borderTop: '1px solid rgba(255,255,255,0.10)', padding: '0 20px' }}>
        <div className="cnc-nav-desktop" style={{ display: 'flex', gap: 3, justifyContent: 'center', alignItems: 'center', height: 44 }}>{ms.map(x => { const on = m === x.id; return <button key={x.id} onClick={() => nav(x.id)} style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500, background: on ? t.navHi + '38' : 'transparent', color: on ? '#ffffff' : 'rgba(255,255,255,0.6)', border: '1px solid ' + (on ? t.navHi + '7A' : 'transparent'), transition: 'all .15s', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1.1 }} onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>{x.l}</button> })}</div>
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

const ATC_PAL = ['#804A87','#019748','#2E4A62','#BFA6D9','#A8CF5C','#92C8E0','#E2A6D4','#F39E94','#E65100','#7FD9A8','#5A2F63','#016033','#C62828','#9C7BB5','#6BA3C0'];
function atcColor(name){ if(!name) return '#9C7BB5'; let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0; return ATC_PAL[h%ATC_PAL.length]; }
function AtcDonut({ data, total, colorFn, onSlice, t }){ const R=58, CIRC=2*Math.PI*R; const tot=total||1; return <svg viewBox="0 0 160 160" style={{ width:150, height:150, flexShrink:0 }}><g transform="rotate(-90 80 80)">{data.map((d,i)=>{ const dash=(d.count/tot)*CIRC; const off=data.slice(0,i).reduce((a,x)=>a+(x.count/tot)*CIRC,0); const el=<circle key={i} cx="80" cy="80" r={R} fill="none" stroke={colorFn(d.name)} strokeWidth="20" strokeDasharray={dash+' '+(CIRC-dash)} strokeDashoffset={-off} style={{ cursor:'pointer' }} onClick={()=>onSlice(d.name)}><title>{d.name+': '+d.count}</title></circle>; return el; })}</g><text x="80" y="76" textAnchor="middle" style={{ fontSize:15, fontWeight:800, fill:t.accent }}>{total}</text><text x="80" y="93" textAnchor="middle" style={{ fontSize:9, fill:t.textL }}>효능군</text></svg>; }
/* ═══ 통합 알림센터 (3종 경고 집약·데이터 비의존) ═══ */
function AlertCenter({ drugs, onNav }) {
  const { t, open360 } = useTheme();
  const md = drugs.filter(d => MAIN_STATS.includes(d.status));
  const eD = d => exD(d.expiry_date);
  const exp = md.filter(d => { const x = eD(d); return x !== null && x <= 60 }).sort((a, b) => eD(a) - eD(b));
  const expired = exp.filter(d => eD(d) <= 0), urgent = exp.filter(d => eD(d) > 0 && eD(d) <= 30), caution = exp.filter(d => eD(d) > 30 && eD(d) <= 60);
  const low = md.filter(d => (d.safety_stock || 0) > 0 && (d.current_qty || 0) < d.safety_stock).sort((a, b) => (a.current_qty - a.safety_stock) - (b.current_qty - b.safety_stock));
  const narc = md.filter(d => isN(d) && eD(d) !== null && eD(d) <= 90).sort((a, b) => eD(a) - eD(b));
  const ddl = d => { const x = eD(d); return x === null ? '-' : 'D' + (x <= 0 ? x : '-' + x) };
  const sec = (o) => <div style={{ background: t.card, borderRadius: 14, border: '1px solid ' + t.border, boxShadow: t.shadow, overflow: 'hidden', marginBottom: 14 }}>
    <div onClick={o.deeplink} style={{ padding: '14px 18px', borderBottom: '1px solid ' + t.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: o.items.length ? o.color + '0D' : t.bg }}>
      <span style={{ fontWeight: 700, fontSize: 14, color: t.text, display: 'flex', alignItems: 'center', gap: 8 }}>{o.icon} {o.title}{o.sub}</span>
      <span style={{ fontWeight: 800, fontSize: 16, color: o.items.length ? o.color : t.textL }}>{o.items.length}건 ›</span>
    </div>
    {o.items.length ? <div style={{ maxHeight: 300, overflowY: 'auto' }}>{o.items.slice(0, 60).map((d, i) => <div key={i} onClick={() => open360 && open360(d)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid ' + t.border, cursor: 'pointer', fontSize: 12 }} onMouseEnter={e => e.currentTarget.style.background = t.glass} onMouseLeave={e => e.currentTarget.style.background = ''}><span><span style={{ color: t.accent, fontWeight: 600 }}>{d.drug_name}</span> <span style={{ color: t.textL, fontSize: 10 }}>{d.drug_code} · {d.category}</span></span>{o.render(d)}</div>)}</div> : <div style={{ padding: 18, textAlign: 'center', color: t.textL, fontSize: 12 }}>0건</div>}
  </div>;
  return <div style={{ padding: '20px 24px' }}>
    <div style={{ fontSize: 18, fontWeight: 800, color: t.text, marginBottom: 4 }}>🔔 통합 알림센터</div>
    <div style={{ fontSize: 11, color: t.textL, marginBottom: 16 }}>사용·휴면 약품 기준 · 중지(아카이브) 제외</div>
    {sec({ icon: '📅', title: '유효기간 임박', color: t.red, items: exp, sub: <span style={{ fontSize: 11, fontWeight: 500, color: t.textM, marginLeft: 6 }}>(만료 {expired.length} · 긴급 {urgent.length} · 주의 {caution.length})</span>, deeplink: () => onNav({ menu: 'expiry', focus: 'urgent' }), render: d => <span style={{ fontSize: 11 }}><span style={exS(d.expiry_date, t)}>{d.expiry_date}</span> <b style={{ color: eD(d) <= 0 ? t.red : eD(d) <= 30 ? t.amber : t.blue }}>{ddl(d)}</b></span> })}
    {sec({ icon: '📦', title: '재고 부족', color: t.amber, items: low, sub: null, deeplink: () => onNav({ menu: 'stock', filter: '부족' }), render: d => <span style={{ fontSize: 11, color: t.textM }}>현 <b style={{ color: t.red }}>{(d.current_qty || 0).toLocaleString()}</b> / 안전 {(d.safety_stock || 0).toLocaleString()}</span> })}
    {sec({ icon: '💊', title: '향정·마약 유효기간 임박', color: t.purple, items: narc, sub: <span style={{ fontSize: 11, fontWeight: 500, color: t.textM, marginLeft: 6 }}>(≤90일)</span>, deeplink: () => onNav({ menu: 'narcotic' }), render: d => <span style={{ fontSize: 11 }}><Bd bg={getNT(d) === '마약' ? t.redL : t.purpleL} color={getNT(d) === '마약' ? t.red : t.purple}>{getNT(d)}</Bd> <b style={{ color: t.purple, marginLeft: 4 }}>{ddl(d)}</b></span> })}
  </div>;
}

/* ═══ 발주 관리 (현재고+safety 기반·사용량 비의존) ═══ */
function Ordering({ drugs }) {
  const { t, open360 } = useTheme();
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tid, setTid] = useState(null);
  const [msg, setMsg] = useState(null);
  const [newSup, setNewSup] = useState('');
  const [busy, setBusy] = useState(false); const [fc, setFc] = useState([]); const [ut, setUt] = useState([]);
  async function refresh() {
    const { data: tm } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle();
    setTid(tm?.tenant_id || null);
    const { data: sup } = await supabase.from('suppliers').select('*').order('name'); setSuppliers(sup || []);
    const { data: po } = await supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(20); setOrders(po || []);
  }
  useEffect(() => { let on = true; (async () => { const { data: tm } = await supabase.from('tenant_members').select('tenant_id').limit(1).maybeSingle(); if (!on) return; setTid(tm?.tenant_id || null); const { data: sup } = await supabase.from('suppliers').select('*').order('name'); if (on) setSuppliers(sup || []); const { data: po } = await supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(20); if (on) setOrders(po || []); const { data: fcd } = await supabase.rpc('drug_change_forecast', { p_weeks: 12 }); if (on) setFc(fcd || []); const { data: utd } = await supabase.rpc('usage_monthly_trend', { p_months: 6 }); if (on) setUt(utd || []) })(); return () => { on = false } }, []);
  const cand = drugs.filter(d => MAIN_STATS.includes(d.status) && (d.safety_stock || 0) > 0 && (d.current_qty || 0) <= d.safety_stock);
  const supName = id => (suppliers.find(s => s.id === id) || {}).name || '미지정 도매사';
  const groups = {}; cand.forEach(d => { const k = d.supplier_id || '__none'; (groups[k] = groups[k] || []).push(d) });
  async function addSupplier() { if (!newSup.trim() || !tid) return; const { error } = await supabase.from('suppliers').insert({ tenant_id: tid, name: newSup.trim() }); if (!error) { setNewSup(''); refresh() } else setMsg('도매사 추가 실패: ' + error.message) }
  async function createPO(key, items) {
    if (!tid) { setMsg('테넌트 확인 실패'); return } setBusy(true);
    const supplier_id = key === '__none' ? null : key;
    const { data: po, error } = await supabase.from('purchase_orders').insert({ tenant_id: tid, supplier_id, status: '작성중' }).select().single();
    if (error || !po) { setMsg('발주서 생성 실패: ' + (error ? error.message : '')); setBusy(false); return }
    const rows = items.map(d => ({ tenant_id: tid, order_id: po.id, drug_code: d.drug_code, drug_name: d.drug_name, order_qty: Math.max(0, (d.safety_stock || 0) - (d.current_qty || 0)), current_qty: d.current_qty || 0, safety_stock: d.safety_stock || 0 }));
    const { error: e2 } = await supabase.from('order_items').insert(rows);
    setBusy(false);
    if (e2) { setMsg('발주항목 저장 실패: ' + e2.message); return }
    setMsg('발주서 생성 완료 (' + rows.length + '품목)'); refresh(); setTimeout(() => setMsg(null), 3000);
  }
  return <div style={{ padding: '20px 24px' }}>
    <div style={{ fontSize: 18, fontWeight: 800, color: t.text, marginBottom: 4 }}>🧾 발주 관리</div>
    <div style={{ fontSize: 11, color: t.textL, marginBottom: 14 }}>현재고 ≤ 안전재고 후보 · 사용·휴면 기준 · 사용량 비의존(발주제안 = 안전 − 현재고)</div>
    {msg && <div style={{ background: t.accentL, color: t.accent, padding: '8px 14px', borderRadius: 8, marginBottom: 12, fontSize: 12, fontWeight: 600 }}>{msg}</div>}
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={newSup} onChange={e => setNewSup(e.target.value)} placeholder='도매사 이름' style={{ padding: '7px 12px', border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, background: t.bg, color: t.text }} />
      <button onClick={addSupplier} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid ' + t.accent, background: t.accentL, color: t.accent, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ 도매사 추가</button>
      <span style={{ fontSize: 11, color: t.textL }}>등록 도매사 {suppliers.length}곳</span>
    </div>
    <div style={{ fontWeight: 700, fontSize: 14, color: t.text, marginBottom: 8 }}>발주점 미달 후보 {cand.length}품목 · 도매사별</div>
    {!cand.length ? <div style={{ background: t.card, borderRadius: 12, border: '1px solid ' + t.border, padding: 24, textAlign: 'center', color: t.textL }}>발주점 미달 약품 없음 (0건)</div> :
      Object.keys(groups).map(key => { const items = groups[key]; return <div key={key} style={{ background: t.card, borderRadius: 12, border: '1px solid ' + t.border, marginBottom: 12, overflow: 'hidden', boxShadow: t.shadow }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + t.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: t.accentL }}>
          <span style={{ fontWeight: 700, color: t.accent }}>{key === '__none' ? '미지정 도매사' : supName(key)} <span style={{ fontWeight: 500, color: t.textM, fontSize: 12 }}>· {items.length}품목</span></span>
          <button disabled={busy} onClick={() => createPO(key, items)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid ' + t.green, background: t.greenL, color: t.green, cursor: busy ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>발주서 생성</button>
        </div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['약품', '현재고', '안전재고', '발주제안'].map((h, hi) => <th key={h} style={{ textAlign: hi ? 'right' : 'left', padding: '8px 14px', color: t.textM, borderBottom: '1px solid ' + t.border, fontSize: 11 }}>{h}</th>)}</tr></thead>
        <tbody>{items.map((d, i) => <tr key={i} style={{ borderBottom: '1px solid ' + t.border }}><td style={{ padding: '7px 14px' }}><span onClick={() => open360 && open360(d)} style={{ color: t.accent, fontWeight: 600, cursor: 'pointer' }}>{d.drug_name}</span> <span style={{ color: t.textL, fontSize: 10 }}>{d.drug_code}</span></td><td style={{ padding: '7px 14px', textAlign: 'right', color: t.red, fontWeight: 600 }}>{(d.current_qty || 0).toLocaleString()}</td><td style={{ padding: '7px 14px', textAlign: 'right', color: t.textM }}>{(d.safety_stock || 0).toLocaleString()}</td><td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 700, color: t.green }}>{Math.max(0, (d.safety_stock || 0) - (d.current_qty || 0)).toLocaleString()}</td></tr>)}</tbody></table></div>
      </div> })}
    <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: '20px 0 8px' }}>최근 발주서 {orders.length}건</div>
    {!orders.length ? <div style={{ color: t.textL, fontSize: 12, padding: 12 }}>발주서 없음</div> :
      <div style={{ background: t.card, borderRadius: 12, border: '1px solid ' + t.border, overflow: 'hidden' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['발주일', '도매사', '상태'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 14px', color: t.textM, borderBottom: '1px solid ' + t.border, fontSize: 11 }}>{h}</th>)}</tr></thead><tbody>{orders.map((o, i) => <tr key={i} style={{ borderBottom: '1px solid ' + t.border }}><td style={{ padding: '7px 14px', color: t.textM }}>{o.order_date}</td><td style={{ padding: '7px 14px' }}>{(o.suppliers || {}).name || '미지정'}</td><td style={{ padding: '7px 14px' }}><Bd bg={t.amberL} color={t.amber}>{o.status}</Bd></td></tr>)}</tbody></table></div>}
    <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: '20px 0 8px' }}>📈 사용량 분석 <span style={{ fontSize: 11, fontWeight: 500, color: t.textL }}>· 최근 6개월 월별 출고(스냅샷)</span></div>
    <div style={{ background: t.card, borderRadius: 12, border: '1px solid ' + t.border, padding: '14px 18px', marginBottom: 14 }}>{!ut.length ? <div style={{ color: t.textL, fontSize: 12 }}>데이터 없음</div> : (() => { const mx = Math.max.apply(null, ut.map(u => Number(u.out_qty) || 0).concat([1])); return <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 110 }}>{ut.map((u, i) => <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}><div style={{ fontSize: 9, color: t.textM }}>{Math.round(Number(u.out_qty) || 0).toLocaleString()}</div><div style={{ width: '66%', background: t.accent, borderRadius: '4px 4px 0 0', height: ((Number(u.out_qty) || 0) / mx * 72 + 2) + 'px', opacity: 0.75 }} /><div style={{ fontSize: 9, color: t.textL }}>{(u.ym || '').slice(2)}</div></div>)}</div> })()}</div>
    <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: '8px 0 8px' }}>🔮 변경 예측 <span style={{ fontSize: 11, fontWeight: 500, color: t.textL }}>· 현재고 ÷ 주간 사용량(거래 기반)</span></div>
    {(() => { const live = fc.filter(r => Number(r.weekly_usage) > 0); if (!live.length) return <div style={{ background: t.card, borderRadius: 12, border: '1px dashed ' + t.border, padding: 20, textAlign: 'center', color: t.textL, fontSize: 12 }}>거래(출고) 데이터 누적 시 자동 표시됩니다 · 수식·구조 선반영 완료(서버 RPC)</div>; const urgent = live.filter(r => r.status === '긴급(2주내)'); const rows = (urgent.length ? urgent : live).sort((a, b) => (Number(a.remaining_weeks) || 1e9) - (Number(b.remaining_weeks) || 1e9)).slice(0, 30); return <div style={{ background: t.card, borderRadius: 12, border: '1px solid ' + t.border, overflow: 'hidden' }}><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{['약품', '주간사용', '남은주', '변경예상', '상태'].map((h, hi) => <th key={h} style={{ textAlign: hi ? 'right' : 'left', padding: '8px 14px', color: t.textM, borderBottom: '1px solid ' + t.border, fontSize: 11 }}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => { const sc = r.status === '긴급(2주내)' ? t.red : r.status === '변경완료' ? t.textL : t.green; return <tr key={i} style={{ borderBottom: '1px solid ' + t.border }}><td style={{ padding: '7px 14px' }}><span onClick={() => open360 && open360((drugs.find(x => x.drug_code === r.drug_code)) || r)} style={{ color: t.accent, fontWeight: 600, cursor: 'pointer' }}>{r.drug_name}</span></td><td style={{ padding: '7px 14px', textAlign: 'right' }}>{Number(r.weekly_usage).toLocaleString()}</td><td style={{ padding: '7px 14px', textAlign: 'right' }}>{r.remaining_weeks == null ? '-' : r.remaining_weeks}</td><td style={{ padding: '7px 14px', textAlign: 'right', color: t.textM }}>{r.expected_change_date || '-'}</td><td style={{ padding: '7px 14px', textAlign: 'right' }}><Bd bg={sc + '18'} color={sc}>{r.status}</Bd></td></tr> })}</tbody></table></div></div> })()}
  </div>;
}

/* ═══ 대시보드 '사용 중인 약품' 표 전용 컬럼헤더 필터(엑셀식 ▾·position:fixed로 표 overflow 회피·외부클릭/Esc) ═══ */
function HeaderFilter({ items, value, onChange, color }) {
  const { t } = useTheme();
  const c = color || t.accent;
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, []);
  function toggle(e) { e.stopPropagation(); if (!open && btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 4, left: Math.max(8, r.left - 6) }) } setOpen(o => !o) }
  const active = !!value;
  return <span style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle', fontWeight: 400 }}>
    <span ref={btnRef} onClick={toggle} title="필터" style={{ cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '2px 5px', borderRadius: 5, color: active ? '#fff' : c, background: active ? c : c + '14', border: '1px solid ' + (active || open ? c : c + '40'), fontWeight: 800 }}>▾</span>
    {open && <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={e => { e.stopPropagation(); setOpen(false) }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 140, maxHeight: 280, overflowY: 'auto', background: t.cardSolid, border: '1px solid ' + t.borderH, borderRadius: 10, boxShadow: '0 12px 32px rgba(46,74,98,0.18)', padding: 6, textAlign: 'left' }}>
        {['전체', ...items].map(it => { const on = (it === '전체' && !value) || it === value; return <button key={it} onClick={e => { e.stopPropagation(); onChange(it === '전체' ? null : it); setOpen(false) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '6px 9px', border: 'none', background: on ? c + '14' : 'transparent', color: on ? c : t.text, cursor: 'pointer', fontSize: 11, fontWeight: on ? 700 : 500, borderRadius: 6, whiteSpace: 'nowrap' }} onMouseEnter={e => { if (!on) e.currentTarget.style.background = t.bg }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>{it}{on ? <span style={{ fontSize: 9 }}>✓</span> : null}</button> })}
      </div>
    </>}
  </span>;
}

/* ═══ 대시보드 — Bento Grid ═══ */
function HScroll({ children, noLabel, ends, bottom }) {
  const { t } = useTheme();
  const ref = useRef(null);
  const by = (dir) => { const el = ref.current; if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.85), behavior: 'smooth' }) };
  const toEnd = (dir) => { const el = ref.current; if (el) el.scrollTo({ left: dir < 0 ? 0 : el.scrollWidth, behavior: 'smooth' }) };
  const bst = { width: 26, height: 24, borderRadius: 6, border: '1px solid ' + t.border, background: t.card, color: t.accent, cursor: 'pointer', fontSize: 14, fontWeight: 800, lineHeight: 1, padding: 0, flexShrink: 0 };
  const bar = <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '4px 10px' }}>
      {!noLabel && <span style={{ fontSize: 10, color: t.textL }}>좌우 스크롤</span>}
      <div style={{ display: 'inline-flex', gap: 4 }}>
        {ends && <button onClick={() => toEnd(-1)} title="맨 처음으로" style={bst}>«</button>}
        <button onClick={() => by(-1)} title="왼쪽으로 스크롤" style={bst}>‹</button>
        <button onClick={() => by(1)} title="오른쪽으로 스크롤" style={bst}>›</button>
        {ends && <button onClick={() => toEnd(1)} title="맨 끝으로" style={bst}>»</button>}
      </div>
    </div>;
    return <div>{bar}<div ref={ref} style={{ overflowX: 'auto' }}>{children}</div>{bottom && bar}</div>;
}
function Dashboard({ drugs, inv, txns, onNav, onEdit }) {
  const { t, open360 } = useTheme(); const { so, TS, sk, sd, setSort } = useSort('drug_name')
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [catF, setCatF] = useState(null); const [cmpF, setCmpF] = useState(null); const [stoF, setStoF] = useState(null); const [locF, setLocF] = useState(null); const [insF2, setInsF2] = useState(null); const [locOpts, setLocOpts] = useState([]); const [atcSel, setAtcSel] = useState(null)
  useEffect(() => { const h = setTimeout(() => setDq(q), 250); return () => clearTimeout(h) }, [q])
  useEffect(() => { let on = true; supabase.from('location_vocab').select('label,sort_order,is_active').order('sort_order').then(({ data }) => { if (on) setLocOpts((data || []).filter(x => x.is_active !== false).map(x => x.label)) }); return () => { on = false } }, [])
  const today = new Date(), fmt = d => d.toISOString().split('T')[0], ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`, d30 = new Date(today), d90 = new Date(today); d30.setDate(d30.getDate() + 30); d90.setDate(d90.getDate() + 90)
  const active = drugs.filter(d => d.status === '사용'); const main = drugs.filter(d => MAIN_STATS.includes(d.status))
  const s = { total: main.length, active: active.length, stopped: drugs.filter(d => d.status === '중지').length, dormant: drugs.filter(d => d.status === '휴면').length, narc: drugs.filter(d => isN(d) && d.status === '사용').length, nonIns: drugs.filter(d => isNonIns(d) && MAIN_STATS.includes(d.status)).length, shortage: inv.filter(d => d.stock_status === '부족').length, e30: drugs.filter(d => d.expiry_date && d.expiry_date <= fmt(d30) && MAIN_STATS.includes(d.status)).length, e90: drugs.filter(d => d.expiry_date && d.expiry_date > fmt(d30) && d.expiry_date <= fmt(d90) && MAIN_STATS.includes(d.status)).length }
  const totalAmt = main.reduce((a, d) => a + (d.current_qty || 0) * (d.purchase_price || 0), 0)
  const mTx = txns.filter(tx => tx.transaction_date?.startsWith(ym))
  const txS = { inC: mTx.filter(x => x.type === '입고').length, inA: mTx.filter(x => x.type === '입고').reduce((a, x) => a + (x.total_amount || 0), 0), outC: mTx.filter(x => x.type === '출고').length, outA: mTx.filter(x => x.type === '출고').reduce((a, x) => a + (x.total_amount || 0), 0), retC: mTx.filter(x => x.type === '반품').length, retA: mTx.filter(x => x.type === '반품').reduce((a, x) => a + (x.total_amount || 0), 0), dspC: mTx.filter(x => x.type === '폐기').length, dspA: mTx.filter(x => x.type === '폐기').reduce((a, x) => a + (x.total_amount || 0), 0), dspQ: mTx.filter(x => x.type === '폐기').reduce((a, x) => a + (x.quantity || 0), 0) }
  txS.lossT = txS.retC + txS.dspC; txS.lossA = txS.retA + txS.dspA
  const catData = CATS.map(cat => { const items = main.filter(d => d.category === cat); return { cat, total: items.length, qty: items.reduce((a, d) => a + (d.current_qty || 0), 0), expSoon: items.filter(d => { const x = exD(d.expiry_date); return x !== null && x <= 90 }).length } }).filter(c => c.total > 0)
  const atcMap = {}; main.forEach(d => { const k = (d.atc_l1 && d.atc_l1.trim()) || '미분류'; atcMap[k] = (atcMap[k] || 0) + 1 }); const atcData = Object.entries(atcMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count); const atcClassified = main.filter(d => d.atc_l1 && d.atc_l1.trim() && d.atc_l1 !== '확인필요').length;
  const catC = { '경구제': t.accent, '주사제': t.green, '외용제': t.blue, '수액제': t.mint || '#92C8E0', '영양제': '#A8CF5C', '의약외품': t.coral || t.amber }
  const luq = dq.trim().toLowerCase(); const luActive = !!(luq || catF || cmpF || stoF || locF || insF2 || atcSel)
  const luMatch = d => (catF ? d.category === catF : true) && (cmpF ? d.compound_type === cmpF : true) && (stoF ? d.storage_method === stoF : true) && (locF ? d.storage_location === locF : true) && (insF2 ? (insF2 === '비보험' ? isNonIns(d) : !isNonIns(d)) : true) && (atcSel ? (d[atcSel.level] || '') === atcSel.value : true) && (!luq || (d.drug_name || '').toLowerCase().includes(luq) || (d.drug_code || '').toLowerCase().includes(luq) || (d.ingredient_kr || '').toLowerCase().includes(luq) || (d.ingredient_en || '').toLowerCase().includes(luq) || (d.manufacturer || '').toLowerCase().includes(luq) || (d.atc_l1 || '').toLowerCase().includes(luq) || (d.atc_l2 || '').toLowerCase().includes(luq) || (d.atc_l3 || '').toLowerCase().includes(luq) || (d.atc_code || '').toLowerCase().includes(luq))
  const luFiltered = active.filter(luMatch)
  const sorted = so(luActive ? luFiltered : active.slice(0, 15)).slice(0, 15)
  const atcL1Opts = [...new Set(active.map(d => (d.atc_l1 || '').trim()).filter(Boolean))].sort()
  const hf = { category: { items: CATS, value: catF, on: setCatF, color: t.accent }, atc_l1: { items: atcL1Opts, value: (atcSel && atcSel.level === 'atc_l1') ? atcSel.value : null, on: v => setAtcSel(v ? { level: 'atc_l1', value: v } : null), color: t.accent }, compound_type: { items: ['단일제', '복합제'], value: cmpF, on: setCmpF, color: t.purple }, storage_method: { items: STORAGE_OPTS, value: stoF, on: setStoF, color: t.blue }, storage_location: { items: locOpts, value: locF, on: setLocF, color: t.accent }, insurance_type: { items: ['보험', '비보험'], value: insF2, on: setInsF2, color: t.green } }
  const _af = (q.trim() ? 1 : 0) + (catF ? 1 : 0) + (cmpF ? 1 : 0) + (stoF ? 1 : 0) + (locF ? 1 : 0) + (insF2 ? 1 : 0) + (atcSel ? 1 : 0); const _dSort = !(sk === 'drug_name' && sd === 'asc'); const _showReset = _af > 0 || _dSort;
  function _resetF() { setQ(''); setCatF(null); setCmpF(null); setStoF(null); setLocF(null); setInsF2(null); setAtcSel(null); setSort('drug_name', 'asc') }
  const tc = bc => ({ background: t.card, borderRadius: 14, padding: '20px', border: `1px solid ${t.border}`, borderTop: `3px solid ${bc}`, cursor: 'pointer', transition: 'all .2s', boxShadow: t.shadow })
  const hv = e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = t.shadowH }
  const hx = e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = t.shadow }
  const sT = (icon, title) => <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${t.accent}`, display: 'flex', alignItems: 'center', gap: 6 }}><span>{icon}</span>{title}</div>
  const sR = (label, value, color, unit) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${t.border}` }}><span style={{ fontSize: 12, color: t.textM }}>{label}</span><span style={{ fontSize: 13, fontWeight: 700, color: color || t.text }}>{typeof value === 'number' ? Math.round(value).toLocaleString() : value}{unit || ''}</span></div>
  return <div style={{ padding: '20px 24px' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
      {[{ l: '전체 약품', v: s.total, c: t.accent, nav: { menu: 'druglist', status: MAIN_STATS } }, { l: '사용', v: s.active, c: t.green, nav: { menu: 'druglist', status: ['사용'] } }, { l: '중지', v: s.stopped, c: t.textL, nav: { menu: 'archive' } }, { l: '향정마약', v: s.narc, c: t.purple, nav: { menu: 'narcotic', narcStatus: ['사용'] } }].map((c, i) => <div key={i} onClick={() => onNav(c.nav)} style={tc(c.c)} onMouseEnter={hv} onMouseLeave={hx}><div style={{ fontSize: 12, color: t.textM, fontWeight: 500, marginBottom: 8 }}>{c.l}</div><div style={{ fontSize: 34, fontWeight: 800, color: c.c, letterSpacing: -1 }}>{c.v}</div></div>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
      {[{ l: '비보험', v: s.nonIns, c: t.blue, nav: { menu: 'nonins' } }, { l: '재고부족', v: s.shortage, c: t.red, nav: { menu: 'stock', filter: '부족' } }, { l: '유효기한 ≤30일', v: s.e30, c: t.red, nav: { menu: 'expiry', focus: 'urgent' } }, { l: '유효기한 ≤90일', v: s.e90, c: t.amber, nav: { menu: 'expiry', focus: 'warning' } }].map((c, i) => <div key={i} onClick={() => c.nav && onNav(c.nav)} style={{ background: t.card, borderRadius: 12, padding: '14px 18px', border: `1px solid ${t.border}`, cursor: c.nav ? 'pointer' : 'default', transition: 'all .15s', boxShadow: t.shadow }} onMouseEnter={hv} onMouseLeave={hx}><div style={{ fontSize: 11, color: t.textM }}>{c.l}</div><div style={{ fontSize: 26, fontWeight: 700, color: c.c, marginTop: 4 }}>{c.v}</div></div>)}
    </div>
    {(() => { const eN = main.filter(d => { const x = exD(d.expiry_date); return x !== null && x <= 60 }).length; const lN = main.filter(d => (d.safety_stock || 0) > 0 && (d.current_qty || 0) < d.safety_stock).length; const nN = main.filter(d => { if (!isN(d)) return false; const x = exD(d.expiry_date); return x !== null && x <= 90 }).length; if (eN + lN + nN === 0) return null; const seg = (label, n, navObj, color) => n > 0 ? <span onClick={ev => { ev.stopPropagation(); onNav(navObj) }} style={{ cursor: 'pointer', textDecoration: 'underline', color, fontWeight: 700 }}>{label} {n}</span> : null; const content = k => <span key={k} style={{ display: 'inline-flex', gap: 18, alignItems: 'center', paddingRight: 56 }}><span aria-hidden="true">⚠</span>{seg('유효기한 임박', eN, { menu: 'expiry', focus: 'urgent' }, t.red)}{seg('재고부족', lN, { menu: 'stock', filter: '부족' }, t.amber)}{seg('향정 임박', nN, { menu: 'alerts' }, t.purple)}<span style={{ fontSize: 11, color: t.textM, fontWeight: 500 }}>클릭 → 알림센터</span></span>; return <div onClick={() => onNav({ menu: 'alerts' })} className="cnc-alert-banner" role="status" style={{ background: t.redL, border: '1px solid ' + t.red + '30', borderRadius: 12, padding: '12px 0', marginBottom: 14, color: t.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: t.shadow, overflow: 'hidden', position: 'relative' }}><div className="cnc-marquee-track" style={{ display: 'inline-flex', whiteSpace: 'nowrap', willChange: 'transform' }}>{content('a')}{content('b')}</div></div>; })()}
    {/* ★ 3-Column: 입출고 + 반품/폐기 + 재고총괄 — 클릭 → 해당 페이지 이동 */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
      <div onClick={() => onNav({ menu: 'transaction' })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, boxShadow: t.shadow, cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={hv} onMouseLeave={hx}>
        {sT('▶◀', '당월 입출고')}
        {sR('입고 건수', txS.inC, t.green, '건')}{sR('입고 금액', txS.inA, t.green, '원')}{sR('출고 건수', txS.outC, t.blue, '건')}{sR('출고 금액', txS.outA, t.blue, '원')}{sR('순 입출고', txS.inA - txS.outA, txS.inA >= txS.outA ? t.green : t.red, '원')}
      </div>
      <div onClick={() => onNav({ menu: 'transaction', txTab: '반품' })} title="입출고관리(반품·폐기)로 이동" style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, boxShadow: t.shadow, cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={hv} onMouseLeave={hx}>
        {sT('▲', '반품/폐기 현황')}
        {sR('반품 건수', txS.retC, t.amber, '건')}{sR('반품 금액', txS.retA, t.amber, '원')}{sR('폐기 건수', txS.dspC, t.red, '건')}{sR('폐기 금액', txS.dspA, t.red, '원')}{sR('폐기 수량', txS.dspQ, t.red, '개')}
        <div style={{ marginTop: 8, padding: '8px 12px', background: t.redL, borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 12, fontWeight: 700, color: t.red }}>손실 합계</span><span style={{ fontSize: 14, fontWeight: 800, color: t.red }}>{txS.lossT}건 / ₩{Math.round(txS.lossA).toLocaleString()}</span></div>
      </div>
      <div onClick={() => onNav({ menu: 'stock' })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, boxShadow: t.shadow, cursor: 'pointer', transition: 'all .15s' }} onMouseEnter={hv} onMouseLeave={hx}>
        {sT('■', '재고 총괄')}
        {sR('관리 품목수', s.total, t.accent, '개')}{sR('현재고 총금액', totalAmt, t.accent, '원')}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.border}` }}><div style={{ fontSize: 11, color: t.textM, marginBottom: 6 }}>📋 상태</div><div style={{ display: 'flex', gap: 8 }}>{[{ l: '사용', v: s.active, c: t.green, nav: { menu: 'druglist', status: ['사용'] } }, { l: '휴면', v: s.dormant, c: t.amber, nav: { menu: 'druglist', status: ['휴면'] } }, { l: '중지', v: s.stopped, c: t.textL, nav: { menu: 'archive' } }].map((x, i) => <div key={i} onClick={e => { e.stopPropagation(); onNav(x.nav) }} style={{ flex: 1, textAlign: 'center', padding: '6px', background: t.bg, borderRadius: 8, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = t.border} onMouseLeave={e => e.currentTarget.style.background = t.bg}><div style={{ fontSize: 9, color: t.textL }}>{x.l}</div><div style={{ fontSize: 16, fontWeight: 700, color: x.c }}>{x.v}</div></div>)}</div></div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }}><div style={{ fontSize: 11, color: t.textM, marginBottom: 6 }}>📦 재고현황</div><div style={{ display: 'flex', gap: 8 }}>{[{ l: '부족', v: s.shortage, c: t.red, nav: { menu: 'stock', filter: '부족' } }, { l: '정상', v: s.active - s.shortage, c: t.green, nav: { menu: 'stock', filter: '정상' } }].map((x, i) => <div key={i} onClick={e => { e.stopPropagation(); onNav(x.nav) }} style={{ flex: 1, textAlign: 'center', padding: '6px', background: t.bg, borderRadius: 8, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = t.border} onMouseLeave={e => e.currentTarget.style.background = t.bg}><div style={{ fontSize: 9, color: t.textL }}>{x.l}</div><div style={{ fontSize: 16, fontWeight: 700, color: x.c }}>{x.v}</div></div>)}</div></div>
      </div>
    </div>
    <div style={{ fontSize: 14, fontWeight: 700, color: t.text, margin: '6px 0 10px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>📊 구분별 현황 <span style={{ fontSize: 11, fontWeight: 500, color: t.textL }}>· 사용·휴면 기준</span></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
      {catData.map(c => { const cc = catC[c.cat] || t.accent; return <div key={c.cat} onClick={() => onNav({ menu: 'druglist', cats: [c.cat], status: ['사용'] })} style={{ background: t.card, borderRadius: 14, padding: '18px 22px', border: `1px solid ${t.border}`, borderLeft: `4px solid ${cc}`, cursor: 'pointer', transition: 'all .15s', boxShadow: t.shadow }} onMouseEnter={hv} onMouseLeave={hx}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}><span style={{ fontSize: 15, fontWeight: 700, color: t.text }}>{c.cat}</span><span style={{ fontSize: 14, fontWeight: 700, color: cc }}>{c.total}개</span></div><div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>{c.expSoon > 0 && <div><div style={{ fontSize: 10, color: t.textL, marginBottom: 2 }}>유효기한 주의</div><div style={{ fontSize: 22, fontWeight: 800, color: t.amber }}>{c.expSoon}</div></div>}</div><div style={{ height: 4, background: t.border, borderRadius: 2, marginTop: 12 }}><div style={{ height: '100%', background: cc, borderRadius: 2, width: `${Math.min(c.total / Math.max(s.total, 1) * 100, 100)}%`, opacity: 0.5 }} /></div></div> })}
    </div>
    {drugs.filter(d => MAIN_STATS.includes(d.status)).length > 0 && (() => { const recentNew = drugs.filter(d => MAIN_STATS.includes(d.status)).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10); return <div style={{ background: t.card, borderRadius: 14, border: '1px solid ' + t.border, overflow: 'hidden', boxShadow: t.shadow, marginBottom: 18 }}><div style={{ padding: '14px 22px', borderBottom: '1px solid ' + t.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: t.accentL }}><span style={{ fontWeight: 700, fontSize: 14, color: t.accent }}>🆕 최근 신규 등록</span><span style={{ fontSize: 11, color: t.textM }}>최신 {recentNew.length}건 · 클릭 → 360°</span></div><div>{recentNew.map((d) => <div key={d.drug_code} onClick={() => open360 && open360(d)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 22px', borderBottom: '1px solid ' + t.border, cursor: 'pointer', fontSize: 12 }} onMouseEnter={e => e.currentTarget.style.background = t.glass} onMouseLeave={e => e.currentTarget.style.background = ''}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: t.accent, fontWeight: 600 }}>{d.drug_name}</span> <span style={{ color: t.textL, fontSize: 10 }}>{d.drug_code} · {d.category}{d.status === '휴면' ? ' · 휴면' : ''}</span></span><span style={{ fontSize: 10, color: t.textL, flexShrink: 0, marginLeft: 8 }}>{String(d.created_at || '').slice(0, 10)}</span></div>)}</div></div> })()}
    <div style={{ background: t.card, borderRadius: 14, border: '1px solid '+t.border, padding: '16px 20px', marginBottom: 18, boxShadow: t.shadow }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><span style={{ fontWeight: 700, fontSize: 14, color: t.text, display: 'flex', alignItems: 'center', gap: 6 }}>💊 ATC 효능군 분포 <span style={{ fontSize: 11, color: t.textL, fontWeight: 500 }}>· 사용·휴면 기준</span></span><span style={{ fontSize: 12, fontWeight: 700, color: t.green, background: t.greenL, padding: '3px 10px', borderRadius: 10 }}>분류율 {main.length ? Math.round(atcClassified / main.length * 100) : 0}%</span></div><div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}><AtcDonut data={atcData} total={main.length} colorFn={atcColor} onSlice={name => onNav({ menu: 'druglist', atc: name })} t={t} /><div style={{ flex: 1, minWidth: 240, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '3px 14px' }}>{atcData.map(d => <div key={d.name} onClick={() => onNav({ menu: 'druglist', atc: d.name })} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '3px 5px', borderRadius: 6 }} onMouseEnter={e => e.currentTarget.style.background = t.bg} onMouseLeave={e => e.currentTarget.style.background = ''}><span style={{ width: 10, height: 10, borderRadius: 3, background: atcColor(d.name), flexShrink: 0 }} /><span style={{ fontSize: 11, color: t.textM, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span><span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{d.count}</span></div>)}</div></div></div>
    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, overflow: 'hidden', boxShadow: t.shadow }}>
      <div onClick={() => onNav({ menu: 'druglist' })} title="약품목록으로 이동" style={{ padding: '14px 22px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: t.accentL, cursor: 'pointer', transition: 'background .15s' }} onMouseEnter={e => e.currentTarget.style.background = t.accent + '22'} onMouseLeave={e => e.currentTarget.style.background = t.accentL}><span style={{ fontWeight: 700, fontSize: 14, color: t.accent, display: 'flex', alignItems: 'center', gap: 6 }}>💊 사용 중인 약품 <span style={{ fontSize: 11, fontWeight: 500, color: t.textM }}>→ 약품목록</span></span><span style={{ fontSize: 13, fontWeight: 700, color: t.accent }}>{s.active}개</span></div>
      <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '12px 18px', borderBottom: '1px solid ' + t.border }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="약품명·코드·성분·제조사·ATC 검색…" style={{ flex: '1 1 240px', minWidth: 180, padding: '8px 12px', border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />
        
        {luActive ? <span style={{ fontSize: 11, color: t.textM, fontWeight: 600 }}>매칭 <strong style={{ color: t.accent }}>{luFiltered.length}</strong>건{luFiltered.length > 15 ? ' · 상위 15 표시' : ''}</span> : null}
        {atcSel ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 12, background: atcColor(atcSel.value) + '1A', color: atcColor(atcSel.value), fontSize: 11, fontWeight: 700, border: '1px solid ' + atcColor(atcSel.value) + '40' }}>ATC: {atcSel.value}<span onClick={() => setAtcSel(null)} title="ATC 필터 해제" style={{ cursor: 'pointer', fontWeight: 800 }}>✕</span></span> : null}
        {_showReset ? <button onClick={_resetF} title='필터 초기화' style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid ' + t.accent, background: t.accent + '12', color: t.accent, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>필터 초기화{_af > 0 ? ' (' + _af + ')' : ''}</button> : null}
      </div>
      <StandardTable t={t} TS={TS} sk={sk} sd={sd} setSort={setSort} hf={hf} hscroll={{noLabel:true,ends:true}} cols={[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['ingredient_en','성분(EN)'],['ingredient_kr','성분(KR)'],['atc_l1','ATC'],['compound_type','복합/단일'],['manufacturer','제조사'],['current_qty','현재고'],['edi_price','보험약가'],['insurance_type','급여'],['storage_method','보관'],['storage_location','위치'],['expiry_date','유효기한'],['status','상태']].map(([k,h])=>({k,h,th:{whiteSpace:'nowrap',textAlign:(k==='current_qty'||k==='edi_price')?'right':'left',...(k==='drug_name'?{minWidth:220}:{})},...(k==='drug_code'?{sticky:{left:0,w:128}}:k==='drug_name'?{sticky:{left:128}}:{})}))}>
        <tbody>{!sorted.length ? <tr><td colSpan={15} style={{ padding: 32, textAlign: 'center', color: t.textL, fontSize: 12 }}>검색 결과 없음</td></tr> : sorted.map((d, i) => { const sm = d.storage_method || ''; const cold = sm.includes('냉장'); const shade = sm.includes('차광'); const smBg = cold ? t.blueL : shade ? t.amberL : t.bg; const smFg = cold ? t.blue : shade ? t.amber : t.textM; const cmp = d.compound_type || ''; const acc = atcColor(d.atc_l1); const atcChips = [d.atc_l1, d.atc_l2, d.atc_l3].filter(v => v && String(v).trim()); return <tr key={i} style={{ borderBottom: '1px solid ' + t.border, background: i % 2 ? t.bg : '' }} onMouseEnter={e => { const r = e.currentTarget; r.style.background = 'rgba(128,74,135,0.08)'; const op = 'linear-gradient(rgba(128,74,135,0.08),rgba(128,74,135,0.08)), ' + t.card; const c = r.children; if (c[0]) { c[0].style.background = op; c[0].style.boxShadow = 'inset 3px 0 0 0 #804A87' } if (c[1]) c[1].style.background = op }} onMouseLeave={e => { const r = e.currentTarget; const z = i % 2 ? t.bg : ''; const sz = i % 2 ? t.bg : t.card; r.style.background = z; const c = r.children; if (c[0]) { c[0].style.background = sz; c[0].style.boxShadow = '' } if (c[1]) c[1].style.background = sz }}>
          <td style={{ padding: '13px 12px', fontSize: 10, color: t.textM, textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 2, minWidth: 128, maxWidth: 128, width: 128, overflow: 'hidden', background: i % 2 ? t.bg : t.card }}>{d.drug_code}<NT d={d} /></td>
          <td style={{ padding: '12px 12px', fontWeight: 500, textAlign: 'left', color: t.accent, cursor: 'pointer', minWidth: 220, maxWidth: 280, position: 'sticky', left: 128, zIndex: 2, background: i % 2 ? t.bg : t.card }} onClick={() => onEdit(d)} onMouseEnter={e => { e.currentTarget.style.color = t.purple }} onMouseLeave={e => { e.currentTarget.style.color = t.accent }} title={d.drug_name || ''}><span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>{d.drug_name}</span></td>
          <td style={{ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }}>{d.category || '-'}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left', color: t.textL, fontSize: 10, fontStyle: 'italic', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.ingredient_en || ''}>{d.ingredient_en || '-'}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.ingredient_kr || ''}>{d.ingredient_kr || '-'}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left' }}>{atcChips.length ? <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>{atcChips.map((v, j) => { const lvl = ['atc_l1', 'atc_l2', 'atc_l3'][j]; const selOn = !!atcSel && atcSel.level === lvl && atcSel.value === v; return <span key={j} onClick={() => setAtcSel(selOn ? null : { level: lvl, value: v })} title={'이 표를 ' + v + ' 로 필터'} style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 8, fontSize: 9, fontWeight: 700, background: selOn ? acc : acc + (j === 0 ? '22' : '12'), color: selOn ? '#fff' : acc, border: '1px solid ' + acc + (selOn ? '' : '33'), maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{v}</span> })}</span> : <span style={{ color: t.textL, fontSize: 10 }}>-</span>}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left' }}>{cmp ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: cmp === '복합제' ? t.purpleL : t.bg, color: cmp === '복합제' ? t.purple : t.textM, border: '1px solid ' + (cmp === '복합제' ? t.purple : t.textL) + '33', whiteSpace: 'nowrap' }}>{cmp}</span> : <span style={{ color: t.textL, fontSize: 10 }}>-</span>}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.manufacturer || ''}>{d.manufacturer || '-'}</td>
          <td style={{ padding: '13px 12px', textAlign: 'right', fontWeight: 600, color: d.current_qty === 0 ? t.red : t.text }}>{d.current_qty?.toLocaleString()}</td>
          <td style={{ padding: '13px 12px', textAlign: 'right', color: t.text, fontSize: 11 }}>{d.edi_price!=null&&d.edi_price!==''?Number(d.edi_price).toLocaleString():'-'}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left' }}>{isNonIns(d) ? <Bd bg={t.blueL} color={t.blue}>비보험</Bd> : <span style={{ fontSize: 10, color: t.textL }}>보험</span>}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>{sm ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: smBg, color: smFg, border: '1px solid ' + smFg + '33' }}>{sm}</span> : <span style={{ color: t.textL, fontSize: 10 }}>-</span>}</td>
          <td style={{ padding: '13px 12px', textAlign: 'left', fontSize: 11, color: d.storage_location ? t.text : t.textL }} title={d.storage_location ? '' : '보관위치 미입력'}>{d.storage_location || '—'}</td>
          <td style={{ padding: '13px 12px', fontSize: 11, ...exS(d.expiry_date, t) }}>{d.expiry_date || '-'}</td>
          <td style={{ padding: '13px 12px' }}><SB s={d.status} /></td>
        </tr> })}</tbody>
      </StandardTable>
    </div><Ft />
  </div>
}



/* ═══ 약품목록 전용 ATC 도넛(대시보드 AtcDonut 미수정·드릴다운 위해 중앙클릭 지원 추가) ═══ */
function LDonut({ data, total, onSlice, onCenter, centerTop, centerBot, t }) {
  const R = 58, CIRC = 2 * Math.PI * R; const tot = total || 1;
  return <svg viewBox="0 0 160 160" style={{ width: 140, height: 140, flexShrink: 0 }}>
    <g transform="rotate(-90 80 80)">{data.map((d, i) => { const dash = (d.count / tot) * CIRC; const off = data.slice(0, i).reduce((a, x) => a + (x.count / tot) * CIRC, 0); return <circle key={i} cx="80" cy="80" r={R} fill="none" stroke={atcColor(d.name)} strokeWidth="20" strokeDasharray={dash + ' ' + (CIRC - dash)} strokeDashoffset={-off} style={{ cursor: 'pointer' }} onClick={() => onSlice(d.name)}><title>{d.name + ': ' + d.count}</title></circle>; })}</g>
    <circle cx="80" cy="80" r="46" fill="transparent" style={{ cursor: onCenter ? 'pointer' : 'default' }} onClick={() => onCenter && onCenter()}><title>{onCenter ? '뒤로' : ''}</title></circle>
    <text x="80" y="76" textAnchor="middle" style={{ fontSize: (typeof centerTop === 'string' && centerTop.length > 3) ? 12 : 15, fontWeight: 800, fill: t.accent, pointerEvents: 'none' }}>{centerTop}</text>
    <text x="80" y="93" textAnchor="middle" style={{ fontSize: 9, fill: t.textL, pointerEvents: 'none' }}>{centerBot}</text>
  </svg>;
}
function AtcDonutsRow({ drugs, t, onPick, sel, onClear, nonins, onCenterReset }) {
  const [drill, setDrill] = useState(false);
  const used = drugs.filter(d => d.status === '사용' && (!nonins || isNonIns(d)));
  const agg = (key) => { const m = {}; used.forEach(d => { const v = (d[key] && String(d[key]).trim()) || '미분류'; m[v] = (m[v] || 0) + 1 }); return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
  const total = used.length;
  const d1 = agg('atc_l1'), d2 = agg('atc_l2'), d3full = agg('atc_l3');
  const d3top = d3full.slice(0, 12), d3rest = d3full.slice(12);
  const d3restSum = d3rest.reduce((a, x) => a + x.count, 0);
  const d3base = d3restSum > 0 ? [...d3top, { name: '기타', count: d3restSum }] : d3top;
  const d3data = drill ? d3rest : d3base;
  const legItem = (level, d) => <div key={d.name} onClick={() => onPick(level, d.name === '미분류' ? '' : d.name)} title={d.name + ': ' + d.count} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 5px', borderRadius: 6 }} onMouseEnter={e => e.currentTarget.style.background = t.bg} onMouseLeave={e => e.currentTarget.style.background = ''}><span style={{ width: 9, height: 9, borderRadius: 3, background: atcColor(d.name), flexShrink: 0 }} /><span style={{ fontSize: 10, color: t.textM, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span><span style={{ fontSize: 10, fontWeight: 700, color: t.text }}>{d.count}</span></div>;
  const col = (title, sub, donut, legend) => <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: t.card, borderRadius: 12, border: '1px solid ' + t.border, padding: '12px 14px', boxShadow: t.shadow }}><div style={{ fontSize: 12, fontWeight: 700, color: t.text, alignSelf: 'flex-start' }}>{title} <span style={{ fontSize: 10, fontWeight: 500, color: t.textL }}>{sub}</span></div>{donut}<div className="cnc-legend-scroll" style={{ width: '100%', maxHeight: 150, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>{legend}</div></div>;
  return <div className="no-print" style={{ background: t.card, borderRadius: 14, border: '1px solid ' + t.border, padding: '14px 18px', marginBottom: 12, boxShadow: t.shadow }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>💊 ATC 단계별 분포 <span style={{ fontSize: 11, fontWeight: 500, color: t.textL }}>· 사용 {total}개 기준</span>{sel ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, background: atcColor(sel.value) + '1A', color: atcColor(sel.value), fontSize: 10, fontWeight: 700, border: '1px solid ' + atcColor(sel.value) + '40' }}>선택: {sel.value || '미분류'}<span onClick={onClear} style={{ cursor: 'pointer', fontWeight: 800 }}>✕</span></span> : null}</div>
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', overflowX: 'auto' }}>
      {col('1단계', '대분류·해부학적', <LDonut data={d1} total={total} onSlice={n => onPick('atc_l1', n === '미분류' ? '' : n)} onCenter={onCenterReset} centerTop={total} centerBot="대분류" t={t} />, d1.map(d => legItem('atc_l1', d)))}
      {col('2단계', '중분류·치료학적', <LDonut data={d2} total={total} onSlice={n => onPick('atc_l2', n === '미분류' ? '' : n)} onCenter={onCenterReset} centerTop={total} centerBot="중분류" t={t} />, d2.map(d => legItem('atc_l2', d)))}
      {col('3단계', drill ? '소분류 · 기타 내부' : '소분류·약리학적', <LDonut data={d3data} total={drill ? (d3restSum || 1) : total} onSlice={n => { if (!drill && n === '기타') { setDrill(true) } else { onPick('atc_l3', n === '미분류' ? '' : n) } }} onCenter={drill ? () => setDrill(false) : onCenterReset} centerTop={drill ? '기타' : total} centerBot={drill ? '▸뒤로' : '소분류'} t={t} />, d3data.map(d => d.name === '기타' ? <div key="기타" onClick={() => setDrill(true)} title="기타 펼치기(드릴다운)" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 5px', borderRadius: 6 }} onMouseEnter={e => e.currentTarget.style.background = t.bg} onMouseLeave={e => e.currentTarget.style.background = ''}><span style={{ width: 9, height: 9, borderRadius: 3, background: atcColor('기타'), flexShrink: 0 }} /><span style={{ fontSize: 10, color: t.purple, flex: 1, textAlign: 'left', fontWeight: 700 }}>기타(상위12 외) ▸</span><span style={{ fontSize: 10, fontWeight: 700, color: t.text }}>{d.count}</span></div> : legItem('atc_l3', d)))}
    </div>
    {drill ? <div style={{ marginTop: 8 }}><button onClick={() => setDrill(false)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>◂ 기타 닫기</button></div> : null}
  </div>;
}
/* ═══ 약품목록 표시 컬럼 레지스트리 ═══
 * 배열 순서 = 화면 표시(마스터) 순서. 기본 세트(DRUG_DEFAULT_COLS)를 마스터에서 필터하면
 * 현행 15열 순서와 정확히 일치(요건 ③: 버튼 조작 전 화면 무변화).
 * ctx = { t, open360, onEdit, setDonutF, setPage }. td/render/tdProps 는 (d, ctx) 수신.
 */
const DRUG_COL_DEFS = [
  { key: 'drug_code', label: '약품코드', width: 128, sticky: true,
    td: (d, { t }) => ({ padding: '13px 12px', fontSize: 10, color: t.textM, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden' }),
    render: (d, { t, open360 }) => <><span onClick={() => open360 && open360(d)} title="360° 상세 보기" style={{ color: t.accent, cursor: 'pointer', borderBottom: '1px dotted ' + t.textL }}>{d.drug_code}</span><NT d={d} /></> },
  { key: 'drug_name', label: '약품명', width: 240, sticky: true,
    td: (d, { t }) => ({ padding: '12px 12px', fontWeight: 500, textAlign: 'left', color: t.accent, cursor: 'pointer', minWidth: 220, maxWidth: 280 }),
    tdProps: (d, { t, onEdit }) => ({ onClick: () => onEdit(d), title: d.drug_name || '', onMouseEnter: e => { e.currentTarget.style.color = t.purple }, onMouseLeave: e => { e.currentTarget.style.color = t.accent } }),
    render: (d) => <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>{d.is_high_alert ? <Bd bg="#D9342B1A" color="#D9342B">⚠ 고위험</Bd> : null}{d.is_high_alert ? ' ' : ''}{d.drug_name}</span> },
  { key: 'standard_code', label: '품목기준코드', width: 120,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace' }),
    render: (d) => d.standard_code || '-' },
  { key: 'insurance_code', label: '청구코드', width: 120,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace' }),
    render: (d) => d.insurance_code || '-' },
  { key: 'category', label: '구분', width: 80,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => d.category || '-' },
  { key: 'prescription_type', label: '전문/일반', width: 110,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => d.prescription_type || '-' },
  { key: 'ingredient_en', label: '성분명(영문)', width: 150,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textL, fontSize: 10, fontStyle: 'italic', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.ingredient_en || '' }),
    render: (d) => d.ingredient_en || '-' },
  { key: 'ingredient_kr', label: '성분명(한글)', width: 140,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.ingredient_kr || '' }),
    render: (d) => d.ingredient_kr || '-' },
  { key: 'efficacy', label: '효능', width: 160,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.efficacy || '' }),
    render: (d) => d.efficacy || '-' },
  { key: 'additive', label: '첨가제', width: 160,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.additive || '' }),
    render: (d) => d.additive || '-' },
  { key: 'atc_l1', label: 'ATC', width: 180,
    td: () => ({ padding: '13px 12px', textAlign: 'left' }),
    render: (d, { t, setDonutF, setPage }) => { const acc = atcColor(d.atc_l1); const atcChips = [['atc_l1', d.atc_l1], ['atc_l2', d.atc_l2], ['atc_l3', d.atc_l3]].filter(c => c[1] && String(c[1]).trim()); return atcChips.length ? <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>{atcChips.map((c, j) => { const v = c[1]; return <span key={j} onClick={() => { setDonutF({ level: c[0], value: v }); setPage(1) }} title={'이 목록을 ' + v + ' 로 필터'} style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 8, fontSize: 9, fontWeight: 700, background: acc + (j === 0 ? '22' : '12'), color: acc, border: '1px solid ' + acc + '33', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{v}</span> })}</span> : <span style={{ color: t.textL, fontSize: 10 }}>-</span> } },
  { key: 'atc_l2', label: 'ATC 중분류', width: 140,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.atc_l2 || '' }),
    render: (d) => d.atc_l2 || '-' },
  { key: 'atc_l3', label: 'ATC 소분류', width: 140,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.atc_l3 || '' }),
    render: (d) => d.atc_l3 || '-' },
  { key: 'atc_code', label: 'ATC코드', width: 100,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace' }),
    render: (d) => d.atc_code || '-' },
  { key: 'compound_type', label: '복합/단일', width: 90,
    td: () => ({ padding: '13px 12px', textAlign: 'left' }),
    render: (d, { t }) => { const cmp = d.compound_type || ''; return cmp ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: cmp === '복합제' ? t.purpleL : t.bg, color: cmp === '복합제' ? t.purple : t.textM, border: '1px solid ' + (cmp === '복합제' ? t.purple : t.textL) + '33', whiteSpace: 'nowrap' }}>{cmp}</span> : <span style={{ color: t.textL, fontSize: 10 }}>-</span> } },
  { key: 'manufacturer', label: '제조사', width: 130,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.manufacturer || '' }),
    render: (d) => d.manufacturer || '-' },
  { key: 'specification', label: '제형', width: 120,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.specification || '' }),
    render: (d) => d.specification || '-' },
  { key: 'packaging', label: '포장', width: 100,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => d.packaging || '-' },
  { key: 'total_qty', label: '포장단위', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', color: t.text, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => (d.total_qty != null && d.total_qty !== '') ? Number(d.total_qty).toLocaleString() : '-' },
  { key: 'edi_price', label: '보험약가', width: 100,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', color: t.text, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => (d.edi_price != null && d.edi_price !== '') ? Number(d.edi_price).toLocaleString() + '원' : '-' },
  { key: 'purchase_price', label: '구입단가', width: 100,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', color: t.text, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => (d.purchase_price != null && d.purchase_price !== '') ? Number(d.purchase_price).toLocaleString() + '원' : '-' },
  { key: 'current_qty', label: '현재고', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', fontWeight: 600, color: d.current_qty === 0 ? t.red : t.text }),
    render: (d) => d.current_qty?.toLocaleString() },
  { key: 'safety_stock', label: '안전재고', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => (d.safety_stock != null && d.safety_stock !== '') ? Number(d.safety_stock).toLocaleString() : '-' },
  { key: 'max_stock', label: '최대재고', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => (d.max_stock != null && d.max_stock !== '') ? Number(d.max_stock).toLocaleString() : '-' },
  { key: 'monthly_avg', label: '월평균', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'right', color: t.textM, fontSize: 11, whiteSpace: 'nowrap' }),
    render: (d) => (d.monthly_avg != null && d.monthly_avg !== '') ? Number(d.monthly_avg).toLocaleString() : '-' },
  { key: 'insurance_type', label: '급여', width: 70,
    td: () => ({ padding: '13px 12px', textAlign: 'left' }),
    render: (d, { t }) => isNonIns(d) ? <Bd bg={t.blueL} color={t.blue}>비보험</Bd> : <span style={{ fontSize: 10, color: t.textL }}>보험</span> },
  { key: 'storage_method', label: '보관', width: 100,
    td: () => ({ padding: '13px 12px', textAlign: 'left', whiteSpace: 'nowrap' }),
    render: (d, { t }) => { const sm = d.storage_method || ''; const cold = sm.includes('냉장'); const shade = sm.includes('차광'); const smBg = cold ? t.blueL : shade ? t.amberL : t.bg; const smFg = cold ? t.blue : shade ? t.amber : t.textM; return sm ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: smBg, color: smFg, border: '1px solid ' + smFg + '33' }}>{sm}</span> : <span style={{ color: t.textL, fontSize: 10 }}>-</span> } },
  { key: 'storage_location', label: '위치', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', fontSize: 11, color: d.storage_location ? t.text : t.textL }),
    tdProps: (d) => ({ title: d.storage_location ? '' : '보관위치 미입력' }),
    render: (d) => d.storage_location || '—' },
  { key: 'narcotic_type', label: '마약구분', width: 90,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', fontSize: 11, color: t.textM, whiteSpace: 'nowrap' }),
    render: (d) => d.narcotic_type || '-' },
  { key: 'expiry_date', label: '유효기한', width: 100,
    td: (d, { t }) => ({ padding: '13px 12px', fontSize: 11, ...exS(d.expiry_date, t) }),
    render: (d) => d.expiry_date || '-' },
  { key: 'status', label: '상태', width: 80,
    td: () => ({ padding: '13px 12px' }),
    render: (d) => <SB s={d.status} /> },
  { key: 'is_high_alert', label: '고위험', width: 90,
    td: () => ({ padding: '13px 12px', textAlign: 'left' }),
    render: (d, { t }) => d.is_high_alert ? <Bd bg="#D9342B1A" color="#D9342B">⚠ 고위험</Bd> : <span style={{ color: t.textL, fontSize: 10 }}>-</span> },
  { key: 'memo', label: '메모', width: 160,
    td: (d, { t }) => ({ padding: '13px 12px', textAlign: 'left', color: t.textM, fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    tdProps: (d) => ({ title: d.memo || '' }),
    render: (d) => d.memo || '-' },
]
const DRUG_COL_GROUPS = [
  { title: '식별', keys: ['drug_code', 'drug_name', 'standard_code', 'insurance_code'] },
  { title: '분류', keys: ['category', 'compound_type', 'prescription_type', 'atc_code', 'atc_l1', 'atc_l2', 'atc_l3'] },
  { title: '성분', keys: ['ingredient_kr', 'ingredient_en', 'efficacy', 'additive'] },
  { title: '상품', keys: ['manufacturer', 'specification', 'packaging', 'total_qty', 'edi_price', 'purchase_price', 'insurance_type'] },
  { title: '재고', keys: ['current_qty', 'safety_stock', 'max_stock', 'monthly_avg'] },
  { title: '운영', keys: ['expiry_date', 'storage_method', 'storage_location', 'status', 'narcotic_type', 'is_high_alert', 'memo'] },
]
const DRUG_DEFAULT_COLS = ['drug_code', 'drug_name', 'category', 'ingredient_en', 'ingredient_kr', 'atc_l1', 'compound_type', 'manufacturer', 'edi_price', 'current_qty', 'insurance_type', 'storage_method', 'storage_location', 'expiry_date', 'status']
const DRUG_COL_PRESETS = [
  { name: '기본', keys: DRUG_DEFAULT_COLS },
  { name: '약가·청구', keys: ['drug_code', 'drug_name', 'category', 'insurance_code', 'insurance_type', 'edi_price', 'purchase_price', 'total_qty', 'status'] },
  { name: '재고·발주', keys: ['drug_code', 'drug_name', 'category', 'current_qty', 'safety_stock', 'max_stock', 'monthly_avg', 'purchase_price', 'status'] },
  { name: '보관·안전', keys: ['drug_code', 'drug_name', 'category', 'storage_method', 'storage_location', 'expiry_date', 'narcotic_type', 'is_high_alert', 'status'] },
]
const DRUG_COL_LABEL = Object.fromEntries(DRUG_COL_DEFS.map(c => [c.key, c.label]))
function DrugList({ drugs, navFilter: nf, onEdit, onReload, nonins }) {
  const { t, open360 } = useTheme();
  /* 메뉴별 기본값 단일 출처 — 진입 초기값·필터 초기화 복원값·초기화 버튼 표시 판정이 모두 이 값을 기준으로 삼는다 (약품목록=전체/사용, 비보험=비보험/사용, 아카이브=전체/중지). */
  const _isArchive = !!nf?.archive; const DEF_INS = nonins ? '비보험' : '전체'; const DEF_STATS = _isArchive ? ['중지'] : ['사용'];
  const [search, setSearch] = useState(''); const [cats, setCats] = useState(nf?.cats || CATS); const [stats, setStats] = useState(nf?.status || DEF_STATS); const [narcOnly, setNarcOnly] = useState(false); const [hanoeOnly, setHanoeOnly] = useState(false); const [hiAlertOnly, setHiAlertOnly] = useState(false); const [insF, setInsF] = useState(nf?.insType || DEF_INS); const [page, setPage] = useState(1); const [atcF, setAtcF] = useState(nf?.atc || null); const [rxF, setRxF] = useState(null); const [donutF, setDonutF] = useState(null); const [cmpHF, setCmpHF] = useState(null); const [stoHF, setStoHF] = useState(null); const [locHF, setLocHF] = useState(null); const [locOpts, setLocOpts] = useState([])
  const { so, TS, sk, sd, setSort } = useSort('drug_name')
  const { memberRole, profile, user, setProfile } = useTheme(); const [bulkOpen, setBulkOpen] = useState(false)
  const [selCols, setSelCols] = useState(() => { const _s = profile?.settings?.drugCols; return Array.isArray(_s) && _s.length ? _s : DRUG_DEFAULT_COLS })
  const colBtnRef = useRef(null); const [gnbH, setGnbH] = useState(99)
  /* 툴바 sticky top 오프셋: GNB(sticky 헤더 래퍼) 실측. 반응형 높이 변화 대응(Header 미편집). */
  useEffect(() => {
    const wrap = document.querySelector('.cnc-header')?.parentElement
    if (!wrap) return
    const measure = () => setGnbH(Math.round(wrap.getBoundingClientRect().height))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(wrap)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useEffect(() => { if (nf?.cats) setCats(Array.isArray(nf.cats) ? nf.cats : [nf.cats]); else setCats(CATS); if (nf?.status) setStats(Array.isArray(nf.status) ? nf.status : [nf.status]); if (nf?.narcotic) setNarcOnly(true); else setNarcOnly(false); if (nf?.insType) setInsF(nf.insType); else setInsF(DEF_INS); setPage(1) }, [nf])
  useEffect(() => { let on = true; supabase.from('location_vocab').select('label,sort_order,is_active').order('sort_order').then(({ data }) => { if (on) setLocOpts((data || []).filter(x => x.is_active !== false).map(x => x.label)) }); return () => { on = false } }, [])
  const filtered = so(drugs.filter(d => passesDrugFilters(d, { cats, stats, narcOnly, insF, atcF, search }) && (!rxF || d.prescription_type === rxF) && (!hanoeOnly || d.narcotic_type === '한외마약') && (!donutF || (d[donutF.level] || '') === donutF.value) && (!cmpHF || d.compound_type === cmpHF) && (!stoHF || d.storage_method === stoHF) && (!locHF || (d.storage_location || '') === locHF) && (!hiAlertOnly || d.is_high_alert === true)))
  const tp = Math.ceil(filtered.length / PP), paged = filtered.slice((page - 1) * PP, page * PP)
  const _availSet = drugs.length ? new Set(Object.keys(drugs[0])) : null
  const _isAvail = k => !_availSet || _availSet.has(k)
  const visCols = DRUG_COL_DEFS.filter(c => selCols.includes(c.key) && _isAvail(c.key))
  const stickyOn = ['drug_code', 'drug_name'].filter(k => visCols.some(c => c.key === k))
  const _CODE_W = 128
  const stickyLeft = k => { const idx = stickyOn.indexOf(k); return idx === -1 ? null : (idx === 0 ? 0 : _CODE_W) }
  const colCtx = { t, open360, onEdit, setDonutF, setPage }
  const _rightCols = new Set(['current_qty', 'purchase_price', 'edi_price', 'total_qty', 'safety_stock', 'max_stock', 'monthly_avg'])
  const drugCols = visCols.map(c => { const left = stickyLeft(c.key); return { k: c.key, h: c.label, th: { whiteSpace: 'nowrap', textAlign: _rightCols.has(c.key) ? 'right' : 'left', ...(c.key === 'drug_name' ? { minWidth: 220 } : {}) }, ...(left !== null ? { sticky: { left, ...(c.key === 'drug_code' ? { w: _CODE_W } : {}) } } : {}) } })
  const drugColWidths = visCols.map(c => c.width)
  const selGroups = DRUG_COL_GROUPS.map(g => ({ title: g.title, items: g.keys.filter(_isAvail).map(k => ({ key: k, label: DRUG_COL_LABEL[k] })) })).filter(g => g.items.length)
  const selPresets = DRUG_COL_PRESETS.map(p => ({ name: p.name, keys: p.keys.filter(_isAvail) }))
  const _colsDirty = !(selCols.length === DRUG_DEFAULT_COLS.length && DRUG_DEFAULT_COLS.every(k => selCols.includes(k)))
  /* 프리셋 배지: 현재 selCols가 프리셋과 집합 일치면 그 이름, 아니면 '사용자 지정'. N열은 실제 표시열. */
  const _sameColSet = (x, y) => x.length === y.length && x.every(k => y.includes(k))
  const _curPreset = selPresets.find(p => _sameColSet(selCols, p.keys))
  const _presetLabel = (_curPreset ? _curPreset.name : '사용자 지정') + ' · ' + visCols.length + '열'
  function applyCols(keys) { setSelCols(keys); if (!user) return; const next = { ...(profile?.settings || {}), drugCols: keys }; supabase.from('profiles').update({ settings: next }).eq('id', user.id).then(({ error }) => { if (!error && setProfile) setProfile(p => p ? { ...p, settings: next } : p) }) }
  /* 엑셀 다운로드 — 표시 중 컬럼 + 필터·검색·정렬 적용 전체행(페이지네이션 무시). 원본값 사용, 코드열 텍스트 강제. */
  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const cols = visCols
    const codeSet = new Set(['drug_code', 'insurance_code', 'standard_code', 'edi_code', 'lot_no'])
    const cell = (d, key) => { const v = d[key]; return (v === null || v === undefined) ? '' : v }
    const aoa = [cols.map(c => c.label), ...filtered.map(d => cols.map(c => cell(d, c.key)))]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const range = XLSX.utils.decode_range(ws['!ref'])
    cols.forEach((c, ci) => { if (!codeSet.has(c.key)) return; for (let r = 1; r <= range.e.r; r++) { const ad = XLSX.utils.encode_cell({ r, c: ci }); const cl = ws[ad]; if (cl && cl.v !== '' && cl.v != null) { cl.t = 's'; cl.v = String(cl.v); cl.z = '@' } } })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '약품목록')
    const dt = new Date(); const ymd = '' + dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0')
    XLSX.writeFile(wb, '약품목록_' + ymd + '.xlsx')
  }
  const hf = { category: { items: CATS, value: cats.length === 1 ? cats[0] : null, on: v => { setCats(v ? [v] : CATS); setPage(1) }, color: t.accent }, atc_l1: { items: [...new Set(drugs.map(d => (d.atc_l1 || '').trim()).filter(Boolean))].sort(), value: (donutF && donutF.level === 'atc_l1') ? donutF.value : null, on: v => { setDonutF(v ? { level: 'atc_l1', value: v } : null); setPage(1) }, color: t.accent }, compound_type: { items: ['단일제', '복합제'], value: cmpHF, on: v => { setCmpHF(v); setPage(1) }, color: t.purple }, insurance_type: { items: ['보험', '비보험'], value: insF === '전체' ? null : insF, on: v => { setInsF(v || '전체'); setPage(1) }, color: t.blue }, storage_method: { items: STORAGE_OPTS, value: stoHF, on: v => { setStoHF(v); setPage(1) }, color: t.blue }, storage_location: { items: locOpts, value: locHF, on: v => { setLocHF(v); setPage(1) }, color: t.accent } }
  function _resetF(){applyCols(DRUG_DEFAULT_COLS);setSearch('');setCats(CATS);setStats(DEF_STATS);setNarcOnly(false);setHanoeOnly(false);setInsF(DEF_INS);setRxF(null);setDonutF(null);setCmpHF(null);setStoHF(null);setLocHF(null);setHiAlertOnly(false);setAtcF(null);setSort('drug_name','asc');setPage(1)}
  const _df=(search.trim()?1:0)+(cats.length!==CATS.length?1:0)+(_sameColSet(stats,DEF_STATS)?0:1)+(narcOnly?1:0)+(hanoeOnly?1:0)+(insF!==DEF_INS?1:0)+(rxF?1:0)+(donutF?1:0)+(cmpHF?1:0)+(stoHF?1:0)+(locHF?1:0)+(hiAlertOnly?1:0)+(atcF?1:0)+((sk!=='drug_name'||sd!=='asc')?1:0)+(_colsDirty?1:0);const _showReset=_df>0;
  return <div style={{ padding: '20px 24px' }}>
    <div className="no-print" style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, padding: '16px 18px', marginBottom: 12, boxShadow: t.shadow }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="약품명, 코드, 성분명, 제조사 검색..." style={{ flex: 1, minWidth: 0, padding: '10px 14px', border: `1px solid ${t.border}`, borderRadius: 10, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: t.bg, color: t.text }} onFocus={e => e.target.style.borderColor = t.accent} onBlur={e => e.target.style.borderColor = t.border} />{_showReset && <button onClick={_resetF} title="필터·정렬 전체 초기화" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid ' + t.accent, background: t.accent + '12', color: t.accent, cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>필터 초기화{_df > 0 ? ' (' + _df + ')' : ''}</button>}<ColumnSelector t={t} groups={selGroups} value={selCols} onChange={applyCols} presets={selPresets} /><button onClick={exportXlsx} title="현재 화면 컬럼·필터로 엑셀 다운로드" style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + t.green, background: 'transparent', color: t.green, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>엑셀 다운로드</button><button onClick={() => setBulkOpen(true)} title="엑셀·CSV 대량 업로드" style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + t.accent, background: 'transparent', color: t.accent, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>엑셀 업로드</button><button onClick={() => onEdit({ __register: true })} title="새 약품 등록" style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid ' + t.accent, background: t.accent, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>+ 약품 등록</button></div>
      {bulkOpen && <BulkUploadModal t={t} isOwner={memberRole === 'owner' || memberRole === 'admin' || profile?.role === 'admin'} drugs={drugs} onClose={() => setBulkOpen(false)} onReload={onReload} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MP items={CATS} selected={cats} onChange={v => { setCats(v); setPage(1) }} color={t.accent} label="구분" />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}><MP items={STATS} selected={stats} onChange={v => { setStats(v); setPage(1) }} color={t.accent} label="상태" /><div style={{ width: 1, height: 16, background: t.border }} /><button onClick={() => { setNarcOnly(!narcOnly); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${narcOnly ? t.accent : t.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: narcOnly ? t.accent : 'transparent', color: narcOnly ? '#fff' : t.textM }}>향정마약</button><button onClick={() => { setHanoeOnly(!hanoeOnly); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${hanoeOnly ? t.accent : t.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: hanoeOnly ? t.accent : 'transparent', color: hanoeOnly ? '#fff' : t.textM }}>한외마약</button><button onClick={() => { setHiAlertOnly(!hiAlertOnly); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${hiAlertOnly ? '#D9342B' : t.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: hiAlertOnly ? '#D9342B' : 'transparent', color: hiAlertOnly ? '#fff' : t.textM }}>고위험</button></div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontSize: 10, color: t.textL, fontWeight: 600 }}>보험</span>{['전체', '보험', '비보험'].map(x => <button key={x} onClick={() => { setInsF(x); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${insF === x ? t.accent : t.border}`, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: insF === x ? t.accent : 'transparent', color: insF === x ? '#fff' : t.textM }}>{x}</button>)}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontSize: 10, color: t.textL, fontWeight: 600 }}>분류</span>{['전체', '전문의약품', '일반의약품', '건강기능식품', '원료의약품', '전문의약품(희귀)'].map(x => { const on = (x === '전체' && !rxF) || x === rxF; return <button key={x} onClick={() => { setRxF(x === '전체' ? null : x); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid ' + (on ? t.accent : t.border), cursor: 'pointer', fontSize: 11, fontWeight: 600, background: on ? t.accent : 'transparent', color: on ? '#fff' : t.textM }}>{x}</button> })}<button onClick={() => { setRxF(rxF === '확인필요' ? null : '확인필요'); setPage(1) }} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid ' + (rxF === '확인필요' ? t.accent : t.border), cursor: 'pointer', fontSize: 11, fontWeight: 600, background: rxF === '확인필요' ? t.accent : 'transparent', color: rxF === '확인필요' ? '#fff' : t.textM }}>미분류</button></div>
        
        
      </div>
    </div>
    <AtcDonutsRow drugs={drugs} t={t} nonins={nonins} sel={donutF} onPick={(level, value) => { setDonutF({ level, value }); setPage(1) }} onClear={() => { setDonutF(null); setPage(1) }} onCenterReset={_resetF} />
    <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, overflow: 'visible', boxShadow: t.shadow }}>
      <div style={{ position: 'sticky', top: gnbH, zIndex: 20, padding: '10px 18px', borderBottom: `1px solid ${t.border}`, fontSize: 12, color: t.textM, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, background: t.card, borderTopLeftRadius: 14, borderTopRightRadius: 14 }}><span>전체 {drugs.length}개 · 결과 <strong style={{ color: t.accent }}>{filtered.length}개</strong><span onClick={() => colBtnRef.current && colBtnRef.current.toggle()} title="표시 컬럼 선택(클릭)" style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, background: t.purpleL, color: t.purple, fontSize: 10, fontWeight: 700, border: '1px solid ' + t.purple + '40', cursor: 'pointer', whiteSpace: 'nowrap' }}>{_presetLabel}</span>{atcF && <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, background: atcColor(atcF) + '1A', color: atcColor(atcF), fontSize: 10, fontWeight: 700, border: '1px solid '+atcColor(atcF)+'40' }}>효능군: {atcF}<span onClick={() => setAtcF(null)} style={{ cursor: 'pointer', fontWeight: 800 }}>✕</span></span>}{rxF && <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, background: t.purpleL, color: t.purple, fontSize: 10, fontWeight: 700, border: '1px solid ' + t.purple + '40' }}>분류: {rxF}<span onClick={() => setRxF(null)} style={{ cursor: 'pointer', fontWeight: 800 }}>✕</span></span>}</span><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><ColumnSelector ref={colBtnRef} t={t} groups={selGroups} value={selCols} onChange={applyCols} presets={selPresets} />{_showReset && <button onClick={_resetF} title="필터·정렬 전체 초기화" style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid ' + t.accent, background: t.accent + '12', color: t.accent, cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>필터 초기화{_df > 0 ? ' (' + _df + ')' : ''}</button>}<span style={{ fontSize: 10, color: t.textL }}>약품명 클릭 → 수정</span></span></div>
      <div style={{ overflow: 'hidden', borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}><StandardTable t={t} TS={TS} sk={sk} sd={sd} setSort={(k,sdv)=>{setSort(k,sdv);setPage(1)}} hf={hf} hscroll={{noLabel:true,ends:true}} cols={drugCols} colWidths={drugColWidths}>
        <tbody>{!paged.length ? <tr><td colSpan={visCols.length || 1} style={{ padding: 40, textAlign: 'center', color: t.textL }}>검색 결과 없음</td></tr> : paged.map((d, i) => { const nSticky = stickyOn.length; const rowBg = i % 2 ? t.bg : ''; const stickBg = i % 2 ? t.bg : t.card; return <tr key={i} style={{ borderBottom: '1px solid ' + t.border, background: rowBg }} onMouseEnter={e => { const r = e.currentTarget; r.style.background = 'rgba(128,74,135,0.08)'; const op = 'linear-gradient(rgba(128,74,135,0.08),rgba(128,74,135,0.08)), ' + t.card; const c = r.children; for (let j = 0; j < nSticky; j++) { if (c[j]) { c[j].style.background = op; if (j === 0) c[j].style.boxShadow = 'inset 3px 0 0 0 #804A87' } } }} onMouseLeave={e => { const r = e.currentTarget; r.style.background = rowBg; const c = r.children; for (let j = 0; j < nSticky; j++) { if (c[j]) { c[j].style.background = stickBg; if (j === 0) c[j].style.boxShadow = '' } } }}>{visCols.map(c => { const left = stickyLeft(c.key); const stick = left !== null ? { position: 'sticky', left, zIndex: 2, background: stickBg, ...(c.key === 'drug_code' ? { minWidth: 128, maxWidth: 128, width: 128 } : {}) } : {}; const base = c.td ? c.td(d, colCtx) : {}; const extra = c.tdProps ? c.tdProps(d, colCtx) : {}; return <td key={c.key} {...extra} style={{ ...base, ...stick }}>{c.render(d, colCtx)}</td> })}</tr> })}</tbody>
      </StandardTable>
      <Pg page={page} setPage={setPage} tp={tp} fl={filtered} pp={PP} ends/>
    </div></div><Ft />
  </div>
}
/* ═══ 유효기한 — 칩 클릭 라우팅 ═══ */
/* 날짜 파서/포맷 — 로컬 YYYY-MM-DD(타임존 하루 밀림 방지). 'YYYY-MM-DD' 또는 'YYYYMMDD' 허용 */
function _pad2(n) { return String(n).padStart(2, '0') }
function _ymdStr(y, m, d) { return y + '-' + _pad2(m) + '-' + _pad2(d) }
function _parseYMD(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (d > new Date(y, mo, 0).getDate()) return null;
  return { y, m: mo, d };
}
/* 날짜 입력 셀: 커스텀 달력(브랜드 토큰·인라인 스타일 전용, 외부 라이브러리·전역CSS 없음). 유효기한 최종사용일 전용. */
function DateCell({ value, onChange }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value || '');
  const _init = _parseYMD(value) || { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
  const [view, setView] = useState({ y: _init.y, m: _init.m });
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null), inpRef = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) };
  }, []);
  useEffect(() => {
    if (!open) return;
    function reposition() { const el = inpRef.current; if (!el) return; const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { setOpen(false); return } setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)) }) }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition) };
  }, [open]);
  function openCal() { if (inpRef.current) { const r = inpRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)) }) } const pp = _parseYMD(text); if (pp) setView({ y: pp.y, m: pp.m }); setOpen(true) }
  function commit() { const raw = text.trim(); if (raw === '') { onChange(''); return } const pp = _parseYMD(raw); if (pp) { const s2 = _ymdStr(pp.y, pp.m, pp.d); setText(s2); onChange(s2) } else { setText(value || '') } }
  function pick(d) { const s2 = _ymdStr(view.y, view.m, d); setText(s2); onChange(s2); setOpen(false) }
  function nav(dy, dm) { let y = view.y + dy, m = view.m + dm; if (m < 1) { m = 12; y-- } if (m > 12) { m = 1; y++ } setView({ y, m }) }
  const sel = _parseYMD(text);
  const today = new Date(), tY = today.getFullYear(), tM = today.getMonth() + 1, tD = today.getDate();
  const first = new Date(view.y, view.m - 1, 1).getDay();
  const dim = new Date(view.y, view.m, 0).getDate();
  const navBtn = { border: 'none', background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 13, fontWeight: 800, padding: '2px 5px', borderRadius: 4, lineHeight: 1 };
  const miniBtn = { border: '1px solid ' + t.border, background: 'transparent', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 6 };
  return <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
    <input ref={inpRef} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={text} onChange={e => setText(e.target.value)} onFocus={openCal} onClick={openCal} onKeyDown={e => { if (e.key === 'Enter') { commit(); setOpen(false) } }} onBlur={commit} style={{ padding: '4px 6px', border: '1px solid ' + t.border, borderRadius: 4, fontSize: 10, outline: 'none', background: t.bg, color: t.text, width: 96 }} />
    {open && <div onMouseDown={e => e.preventDefault()} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: 236, background: t.cardSolid, border: '1px solid ' + t.borderH, borderRadius: 10, boxShadow: '0 12px 32px rgba(46,74,98,0.18)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span><button onClick={() => nav(-1, 0)} title="이전 해" style={navBtn}>«</button><button onClick={() => nav(0, -1)} title="이전 달" style={navBtn}>‹</button></span>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.accent }}>{view.y}년 {view.m}월</span>
        <span><button onClick={() => nav(0, 1)} title="다음 달" style={navBtn}>›</button><button onClick={() => nav(1, 0)} title="다음 해" style={navBtn}>»</button></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 2 }}>{['일', '월', '화', '수', '목', '금', '토'].map((w, i) => <div key={w} style={{ textAlign: 'center', fontSize: 9, fontWeight: 600, color: i === 0 ? t.red : i === 6 ? t.blue : t.textL, padding: '2px 0' }}>{w}</div>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {Array.from({ length: first }).map((_, i) => <div key={'e' + i} />)}
        {Array.from({ length: dim }).map((_, i) => { const d = i + 1; const isSel = sel && sel.y === view.y && sel.m === view.m && sel.d === d; const isToday = tY === view.y && tM === view.m && tD === d; return <button key={d} onClick={() => pick(d)} style={{ padding: '5px 0', fontSize: 11, borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (isToday && !isSel ? t.accent + '66' : 'transparent'), background: isSel ? t.accent : 'transparent', color: isSel ? '#fff' : t.text, fontWeight: isSel ? 700 : 500 }} onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = t.bg }} onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>{d}</button> })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, borderTop: '1px solid ' + t.border, paddingTop: 8 }}>
        <button onClick={() => { setText(''); onChange(''); setOpen(false) }} style={{ ...miniBtn, color: t.textM }}>지우기</button>
        <button onClick={() => setOpen(false)} style={{ ...miniBtn, color: t.accent, borderColor: t.accent }}>닫기</button>
      </div>
    </div>}
  </span>;
}
/* 유효기한 표 — ExpiryAlert에서 모듈 추출(component-in-render 리마운트 제거 → 편집 시 가로 스크롤 보존). 렌더/동작 동일. */
function ET({ items, color, label, sub, editRow, editField, startEdit, saveField, closeEdit, saveNote, onEdit, unusedDays, isUnused, alertSt, ip2, fb }) { const { t } = useTheme(); const{so,TS,sk,sd,setSort}=useSort('expiry_date');const[hfV,setHfV]=useState({})
    /* 남은일수·미사용기간 사전 계산 → 정렬 가능 */
    const withCalc=items.map(d=>{const rd=exD(d.expiry_date);const ud=unusedDays(d);return{...d,_remainDays:rd,_unusedDays:ud,_alertStatus:alertSt(rd).text}})
    const sorted=so(withCalc)
    const cols=[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['current_qty','현재고'],['expiry_date','유효기한'],['_remainDays','남은일수'],['_alertStatus','알림상태'],['last_used_dept','최종사용과'],['last_used_date','최종사용일'],['_unusedDays','미사용기간(일)'],['_unusedDays','미사용알림'],['recommended_action','권장조치'],['expiry_notes','비고'],['status','상태']]
    const _uniq=a=>[...new Set(a.filter(v=>v!=null&&String(v).trim()!==''))].sort()
    const _hfopt={'구분':_uniq(items.map(d=>d.category)),'알림상태':_uniq(items.map(d=>alertSt(exD(d.expiry_date)).text)),'최종사용과':_uniq(items.map(d=>d.last_used_dept)),'권장조치':_uniq(items.map(d=>d.recommended_action)),'사용상태':_uniq(items.map(d=>d.status))}
    const _hfget=h=>h==='알림상태'?(d=>alertSt(exD(d.expiry_date)).text):h==='구분'?(d=>d.category):h==='최종사용과'?(d=>d.last_used_dept||''):h==='권장조치'?(d=>d.recommended_action||''):(d=>d.status)
    const rows=sorted.filter(d=>Object.keys(_hfopt).every(h=>!hfV[h]||_hfget(h)(d)===hfV[h]))
    const hf={category:{items:_hfopt['구분'],value:hfV['구분']||null,on:v=>setHfV(pp=>({...pp,'구분':v}))},_alertStatus:{items:_hfopt['알림상태'],value:hfV['알림상태']||null,on:v=>setHfV(pp=>({...pp,'알림상태':v}))},last_used_dept:{items:_hfopt['최종사용과'],value:hfV['최종사용과']||null,on:v=>setHfV(pp=>({...pp,'최종사용과':v}))},recommended_action:{items:_hfopt['권장조치'],value:hfV['권장조치']||null,on:v=>setHfV(pp=>({...pp,'권장조치':v}))},status:{items:_hfopt['사용상태'],value:hfV['사용상태']||null,on:v=>setHfV(pp=>({...pp,'사용상태':v}))}}
    /* 섹션별 필터 초기화: 자기 섹션 hfV·정렬만 초기화(다른 섹션 미영향). 편집 중(editRow)엔 숨김(미저장 데이터 보존). */
    const _fc=Object.values(hfV).filter(Boolean).length+((sk!=='expiry_date'||sd!=='asc')?1:0);const _showR=_fc>0&&editRow==null;const _resetSec=()=>{setHfV({});setSort('expiry_date','asc')}
    const _rbtn=()=><button className="no-print" onClick={_resetSec} title="이 섹션 필터·정렬 초기화" style={{padding:'3px 9px',borderRadius:7,border:`1px solid ${t.accent}`,background:t.accent+'12',color:t.accent,cursor:'pointer',fontSize:10,fontWeight:700,whiteSpace:'nowrap'}}>필터 초기화{_fc>0?' ('+_fc+')':''}</button>
    const _fbSt=k=>{const v=fb&&fb[k];return{transition:'background .45s',...(v?{background:v==='ok'?'#01974826':t.redL}:{})}}
    return<><div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,display:'flex',alignItems:'center',gap:8,background:color+'08'}}><span style={{fontWeight:700,fontSize:13,color}}>{label}</span><span style={{fontSize:11,color:t.textM}}>{sub}</span><span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>{_showR?_rbtn():null}<span style={{background:color,color:'#fff',borderRadius:8,padding:'2px 12px',fontSize:11,fontWeight:700}}>{items.length}</span></span></div>
    {!sorted.length?<div style={{padding:16,textAlign:'center',color:t.textL,fontSize:12}}>해당 없음</div>:
    <StandardTable t={t} TS={TS} sk={sk} sd={sd} setSort={setSort} hf={hf} hscroll={{noLabel:true,ends:true}} fontSize={11} layout="fixed" minWidth={1340} colWidths={[96,200,70,70,90,72,78,100,104,104,80,100,100,76]} cols={cols.map(([k,h])=>({k,h,th:{whiteSpace:'nowrap'}}))}>
    <tbody>{rows.length===0?<tr><td colSpan={14} style={{padding:18,textAlign:'center',color:t.textL,fontSize:11}}>필터 결과 없음</td></tr>:rows.map((d,i)=>{const days=exD(d.expiry_date);const a=alertSt(days);const uDays=unusedDays(d);const isEd=editRow===d.drug_code;const uu=isUnused(d)
      return<tr key={i} style={{borderBottom:`1px solid ${t.border}`,background:uu?t.redL+'60':''}} onMouseEnter={e=>{if(!uu)e.currentTarget.style.background=t.glass}} onMouseLeave={e=>{if(!uu)e.currentTarget.style.background=''}}>
        <td style={{padding:'5px 8px',fontSize:10,color:t.textM,textAlign:'left'}}>{d.drug_code}<NT d={d}/></td>
        <td style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'left', color: t.accent, cursor: 'pointer', minWidth: 200, maxWidth: 260 }} onClick={() => onEdit(d)} onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.color = t.purple }} onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; e.currentTarget.style.color = t.accent }} title={d.drug_name || ''}><span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>{d.drug_name}</span></td>
        <td style={{padding:'5px 8px',color:t.textM,fontSize:10}}>{d.category}</td>
        <td style={{padding:'5px 8px',textAlign:'right',fontWeight:600,fontSize:11}}>{d.current_qty?.toLocaleString()}</td>
        <td style={{padding:'5px 8px',color,fontWeight:600,fontSize:10}}>{d.expiry_date}</td>
        <td style={{padding:'5px 8px',textAlign:'right',fontWeight:700,fontSize:11,color}}>{days}</td>
        <td style={{padding:'5px 4px',textAlign:'center'}}>{a.text&&<span style={{background:a.bg||'transparent',color:a.c,fontWeight:700,padding:'2px 6px',borderRadius:4,fontSize:9,whiteSpace:'nowrap'}}>{a.text}</span>}</td>
        <td style={{padding:'5px 6px',fontSize:10,..._fbSt(d.drug_code+':last_used_dept')}}>{isEd&&editField==='last_used_dept'?<select defaultValue={d.last_used_dept||''} onChange={e=>saveField(d,'last_used_dept',e.target.value)} onBlur={closeEdit} style={{...ip2,width:85}}><option value="">선택</option><option>가정의학과</option><option>재활의학과1</option><option>신경과</option><option>기타</option></select>:<span style={{color:t.textM,cursor:'pointer'}} onClick={()=>startEdit(d,'last_used_dept')}>{d.last_used_dept?<span style={{background:t.accentL,color:t.accent,padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:600}}>{d.last_used_dept}</span>:<span style={{color:t.textL,fontSize:9}}>클릭</span>}</span>}</td>
        <td style={{padding:'5px 6px',fontSize:10,textAlign:'center',width:100,..._fbSt(d.drug_code+':last_used_date')}}>{isEd&&editField==='last_used_date'?<DateCell key={d.drug_code} value={d.last_used_date||''} onChange={v=>saveField(d,'last_used_date',v)}/>:<span style={{color:t.textM,cursor:'pointer',fontSize:10}} onClick={()=>startEdit(d,'last_used_date')}>{d.last_used_date||<span style={{color:t.textL,fontSize:9}}>클릭</span>}</span>}</td>
        <td style={{padding:'5px 8px',textAlign:'right',fontSize:10,color:t.textM}}>{uDays!==null?uDays:''}</td>
        <td style={{padding:'5px 4px',textAlign:'center'}}>{uDays!==null&&uDays>365?<span style={{background:t.red,color:'#fff',padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:700,whiteSpace:'nowrap'}}>■미사용■</span>:''}</td>
        <td style={{padding:'5px 6px',fontSize:10,..._fbSt(d.drug_code+':recommended_action')}}>{isEd&&editField==='recommended_action'?<select defaultValue={d.recommended_action||''} onChange={e=>saveField(d,'recommended_action',e.target.value)} onBlur={closeEdit} style={{...ip2,width:80}}>{REC_ACTIONS.map(a=><option key={a} value={a}>{a||'선택'}</option>)}</select>:<span style={{cursor:'pointer',fontSize:10}} onClick={()=>startEdit(d,'recommended_action')}>{d.recommended_action?<span style={{background:t.amberL,color:t.amber,padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:600}}>{d.recommended_action}</span>:<span style={{color:t.textL,fontSize:9}}>클릭</span>}</span>}</td>
        <td style={{padding:'5px 6px',..._fbSt(d.drug_code+':expiry_notes')}}><input defaultValue={d.expiry_notes||''} onBlur={e=>saveNote(d,e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}} placeholder="입력" style={{...ip2,width:80,fontSize:9}}/></td>
        <td style={{padding:'5px 6px'}}><SB s={d.status}/></td>
      </tr>})}</tbody></StandardTable>}</>}
function ExpiryAlert({drugs,onEdit,focusLevel,onReload}){
  const{t}=useTheme();const[cats,setCats]=useState(CATS);const[stats,setStats]=useState(MAIN_STATS);const[aLv,setALv]=useState(focusLevel||null)
  const[editRow,setEditRow]=useState(null);const[editField,setEditField]=useState(null);const[resetKey,setResetKey]=useState(0);const[fb,setFb]=useState({})
  const fd=drugs.filter(d=>cats.includes(d.category)&&stats.includes(d.status))
  const unusedDays=d=>{if(!d.last_used_date)return null;return Math.floor((new Date()-new Date(d.last_used_date))/864e5)}
  const isUnused=d=>{const days=unusedDays(d);return days!==null&&days>=365}
  /* 알림상태 수식: <=0 만료, <=30 긴급, <=60 주의, <=90 확인, 그외 정상 */
  const alertSt=days=>{if(days===null)return{text:'',c:t.textL,bg:''};if(days<=0)return{text:'★만료★',c:'#fff',bg:t.red};if(days<=30)return{text:'▲긴급▲',c:'#fff',bg:'#E65100'};if(days<=60)return{text:'◆주의◆',c:'#333',bg:'#FFD600'};if(days<=90)return{text:'●확인●',c:'#fff',bg:t.blue};return{text:'정상',c:t.green,bg:''}}
  const g={urgent:fd.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x<=30}),warning:fd.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x>30&&x<=90}),notice:fd.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x>90&&x<=180}),narcotic:drugs.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x<=180&&isN(d)&&cats.includes(d.category)}),unused:fd.filter(d=>isUnused(d))}
  useEffect(()=>{if(focusLevel)setALv(focusLevel)},[focusLevel])
  function flash(key,kind){setFb(p=>({...p,[key]:kind}));setTimeout(()=>setFb(p=>{const c={...p};delete c[key];return c}),kind==='ok'?1500:2500)}
  function closeEdit(){setEditRow(null);setEditField(null)}
  /* 즉시 자동저장: 드롭다운·달력 onChange에서 직접 호출. await 전 setState 없음 → 선택 순간 부모 리렌더 0(가로 스크롤 튐 차단). */
  async function saveField(d,field,value){
    const ud={}
    if(field==='last_used_dept')ud.last_used_dept=value||''
    else if(field==='last_used_date')ud.last_used_date=value||null
    else if(field==='recommended_action')ud.recommended_action=value||null
    let res=await supabase.from('drugs').update(ud).eq('drug_code',d.drug_code)
    for(let retry=0;retry<3&&res.error&&res.error.message?.includes('column');retry++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete ud[m[1]];res=await supabase.from('drugs').update(ud).eq('drug_code',d.drug_code)}
    setEditRow(null);setEditField(null)
    flash(d.drug_code+':'+field,res.error?'err':'ok')
    onReload?.()
  }
  function startEdit(d,field){setEditRow(d.drug_code);setEditField(field)}
  async function saveNote(d,val){if(val===(d.expiry_notes||''))return;let res=await supabase.from('drugs').update({expiry_notes:val||null}).eq('drug_code',d.drug_code);for(let r=0;r<2&&res.error&&res.error.message?.includes('column');r++){res=await supabase.from('drugs').update({}).eq('drug_code',d.drug_code)};flash(d.drug_code+':expiry_notes',res.error?'err':'ok');onReload?.()}  function dlE(){const all=[...g.urgent,...g.warning,...g.notice,...g.narcotic,...g.unused];const ws=XLSX.utils.json_to_sheet(all.map(d=>{const days=exD(d.expiry_date);const a=alertSt(days);const uD=unusedDays(d);return{약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,현재고:d.current_qty||0,유효기한:d.expiry_date||'',남은일수:days,알림상태:a.text,최종사용과:d.last_used_dept||'',최종사용일:d.last_used_date||'','미사용기간(일)':uD||'',미사용알림:uD!==null&&uD>365?'■미사용■':'',권장조치:d.recommended_action||'',비고:d.expiry_notes||'',상태:d.status,향정:getNT(d)}}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'유효기한');XLSX.writeFile(wb,`유효기한_${new Date().toISOString().split('T')[0]}.xlsx`)}
  const lvs=[{k:'urgent',l:'긴급',sub:'≤30일',c:t.red},{k:'warning',l:'주의',sub:'31~90일',c:t.amber},{k:'notice',l:'확인',sub:'91~180일',c:t.blue},{k:'narcotic',l:'향정마약',sub:'≤180일',c:t.purple},{k:'unused',l:'미사용',sub:'1년 이상',c:'#B71C1C'}]
  const ip2={padding:'4px 6px',border:`1px solid ${t.border}`,borderRadius:4,fontSize:10,outline:'none',background:t.bg,color:t.text}

  const _dCat=cats.length!==CATS.length,_dStat=!(stats.length===MAIN_STATS.length&&MAIN_STATS.every(x=>stats.includes(x))),_dLv=!!aLv;const _fcount=(_dCat?1:0)+(_dStat?1:0)+(_dLv?1:0);const _showReset=_fcount>0&&editRow==null;/* 편집 중엔 초기화 숨김 — ET 리마운트로 인한 표시·draft 불일치 차단 */
  function _resetF(){setCats(CATS);setStats(MAIN_STATS);setALv(null);setResetKey(k=>k+1)}
  const show=aLv?lvs.filter(l=>l.k===aLv):lvs.filter(l=>l.k!=='unused'||g.unused.length>0)
  return<div style={{padding:'20px 24px'}}>
    <div className="no-print" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',flexWrap:'wrap',gap:6}}>
      <MP items={CATS} selected={cats} onChange={setCats} color={t.accent} label="구분"/><div style={{width:1,height:16,background:t.border}}/><MP items={STATS} selected={stats} onChange={setStats} color={t.green} label="상태"/>
      <div style={{flex:1}}/>{_showReset?<button onClick={_resetF} title="처음 상태로 초기화" style={{padding:'6px 10px',borderRadius:8,border:`1px solid ${t.accent}`,background:t.accent+'12',color:t.accent,cursor:'pointer',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>필터 초기화{_fcount>0?' ('+_fcount+')':''}</button>:null}<button onClick={dlE} style={{padding:'6px 14px',borderRadius:6,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:11,fontWeight:600}}>엑셀 다운로드</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:`repeat(${g.unused.length>0?5:4},1fr)`,gap:8,marginBottom:14}}>{(g.unused.length>0?lvs:lvs.slice(0,4)).map(l=><div key={l.k} onClick={()=>setALv(aLv===l.k?null:l.k)} style={{background:t.card,border:`1px solid ${aLv===l.k?l.c:t.border}`,borderRadius:12,padding:'14px 16px',cursor:'pointer',transition:'all .15s',boxShadow:aLv===l.k?`0 0 12px ${l.c}15`:'none'}} onMouseEnter={e=>e.currentTarget.style.borderColor=l.c} onMouseLeave={e=>{if(aLv!==l.k)e.currentTarget.style.borderColor=t.border}}><div style={{fontSize:12,color:l.c,fontWeight:700}}>{l.l}</div><div style={{fontSize:28,fontWeight:700,color:l.c,marginTop:4}}>{g[l.k].length}</div><div style={{fontSize:10,color:t.textM,marginTop:2}}>{l.sub}</div></div>)}</div>
    {aLv&&<button className="no-print" onClick={()=>setALv(null)} style={{padding:'5px 14px',borderRadius:6,border:`1px solid ${t.border}`,background:t.card,color:t.textM,cursor:'pointer',fontSize:11,marginBottom:8}}>← 전체 보기</button>}
    {show.map(l=><div key={l.k} style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',marginBottom:12}}><ET key={l.k+'-'+resetKey} items={g[l.k]} color={l.c} label={l.l} sub={l.sub} editRow={editRow} editField={editField} startEdit={startEdit} saveField={saveField} closeEdit={closeEdit} saveNote={saveNote} onEdit={onEdit} unusedDays={unusedDays} isUnused={isUnused} alertSt={alertSt} ip2={ip2} fb={fb}/></div>)}
    <Ft/>
  </div>
}

/* ═══ 재고현황 — ★ 사용량 엑셀 업로드 추가 ═══ */
/* 사용량 수기입력 셀(전년/최근3개월). effect 없음 → lint 안전. 행 reorder는 key=drug_code로 대응. StockStatus 전용. */
function UsageCell({ value, dirty, onChange, onUndo }) {
  const { t } = useTheme();
  return <input value={value} inputMode="numeric" onChange={e => onChange(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); onUndo() } }} style={{ width: '100%', padding: '4px 6px', textAlign: 'right', border: '1px solid ' + (dirty ? t.accent : t.border), borderRadius: 4, fontSize: 11, background: dirty ? t.accent + '0D' : t.bg, color: t.text, fontWeight: dirty ? 700 : 400, outline: 'none', boxSizing: 'border-box' }} />;
}
/* 헤더 메뉴: 텍스트클릭=필터 드롭다운 / 아이콘클릭=정렬 즉시토글(오름→내림→해제, ▲ 1개 회전). StockStatus 전용. 공유 SI/HeaderFilter 미사용. */
function ColMenu({ colKey, label, sk, sd, setSort, filter }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null), txtRef = useRef(null), curRef = useRef(null), menuRef = useRef(null);
  function calc(el) { const r = el.getBoundingClientRect(); return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 190)) } }
  function openFilter(e) { e.stopPropagation(); const el = txtRef.current; if (!el) return; if (open) { setOpen(false); return } curRef.current = el; setPos(calc(el)); setOpen(true) }
  function cycleSort(e) { e.stopPropagation(); if (sk !== colKey) setSort(colKey, 'asc'); else if (sd === 'asc') setSort(colKey, 'desc'); else setSort('', 'asc') }
  useEffect(() => {
    if (!open) return;
    function place() { const el = curRef.current; if (!el) return; const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return } setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 190)) }) }
    function onDoc(e) { if ((ref.current && ref.current.contains(e.target)) || (menuRef.current && menuRef.current.contains(e.target))) return; setOpen(false) }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) };
  }, [open]);
  const active = sk === colKey;
  const fActive = !!(filter && filter.value);
  const item = (onClick, lbl, on) => <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '6px 9px', border: 'none', background: on ? t.accent + '14' : 'transparent', color: on ? t.accent : t.text, cursor: 'pointer', fontSize: 11, fontWeight: on ? 700 : 500, borderRadius: 6, whiteSpace: 'nowrap' }} onMouseEnter={e => { if (!on) e.currentTarget.style.background = t.bg }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>{lbl}{on ? <span style={{ fontSize: 9 }}>✓</span> : null}</button>;
  return <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 700, verticalAlign: 'middle' }}>
    <span ref={txtRef} onClick={filter ? openFilter : undefined} title={filter ? '필터' : undefined} style={{ cursor: filter ? 'pointer' : 'default', whiteSpace: 'nowrap', fontWeight: 700, color: fActive ? t.accent : 'inherit' }}>{label}</span>
    <span onClick={cycleSort} title="정렬(오름→내림→해제)" style={{ cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px', color: active ? t.accent : t.textL, display: 'inline-block', transform: active && sd === 'desc' ? 'rotate(180deg)' : 'none', transition: 'transform .12s' }}>▲</span>
    {open && createPortal(<>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={e => { e.stopPropagation(); setOpen(false) }} />
      <div ref={menuRef} onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 150, maxHeight: 300, overflowY: 'auto', background: t.cardSolid, border: '1px solid ' + t.borderH, borderRadius: 10, boxShadow: '0 12px 32px rgba(46,74,98,0.18)', padding: 6, textAlign: 'left' }}>
        {filter ? item(() => { filter.on(null); setOpen(false) }, '전체', !filter.value) : null}
        {filter ? filter.items.map(v => item(() => { filter.on(v); setOpen(false) }, v, filter.value === v)) : null}
      </div>
    </>, document.body)}
  </span>;
}
/* 표준 표 셸(공통 추출): HScroll+table+colgroup+thead(ColMenu). tbody는 children으로 받음(화면별 bespoke 무변경). 순수 추출·동작/외형 무변경. */
function StandardTable({ cols, TS, sk, sd, setSort, hf, t, grid, layout, colWidths, minWidth, headerBg, hscroll, fontSize, children }) {
  const bg = headerBg || t.bg;
  const br = grid ? { borderRight: '1px solid ' + t.border } : {};
  const tableStyle = layout === 'fixed'
    ? { borderCollapse: 'collapse', fontSize: fontSize || 12, tableLayout: 'fixed', width: '100%', minWidth: minWidth }
    : { width: '100%', borderCollapse: 'collapse', fontSize: fontSize || 12 };
  return <HScroll {...(hscroll || {})}><table style={tableStyle}>
    {colWidths ? <colgroup>{colWidths.map((w, ci) => <col key={ci} style={{ width: w }} />)}</colgroup> : null}
    <thead><tr>{cols.map(c => {
      const k = c.k;
      const th = c.plain
        ? { padding: '8px 10px', textAlign: 'center', color: t.textM, fontWeight: 600, borderBottom: '1px solid ' + t.border, fontSize: 11, background: bg, ...br, ...(c.th || {}) }
        : { ...TS(k), background: bg, ...br, ...(c.sticky ? { position: 'sticky', left: c.sticky.left, zIndex: 6, ...(c.sticky.w ? { minWidth: c.sticky.w, maxWidth: c.sticky.w, width: c.sticky.w } : {}), ...br } : {}), ...(c.th || {}) };
      return <th key={c.h} style={th}>{k ? <ColMenu colKey={k} label={c.h} sk={sk} sd={sd} setSort={setSort} filter={hf[k] || null} /> : <span style={{ cursor: 'default', whiteSpace: 'nowrap', fontWeight: 700 }}>{c.h}</span>}</th>;
    })}</tr></thead>
    {children}
  </table></HScroll>;
}
function StockStatus({drugs,inv,navFilter:nf,onEdit,onAdjust,onReload}){
  const{t}=useTheme();
  const [filter,setFilter]=useState(nf?.filter||'전체');const [cats,setCats]=useState(CATS);const [stats,setStats]=useState(MAIN_STATS);const [search,setSearch]=useState('');const [page,setPage]=useState(1);const{so,TS,sk,sd,setSort}=useSort('drug_name');
  const[uMsg,setUMsg]=useState(null);const uRef=useRef();const[uRep,setURep]=useState(null);const[drafts,setDrafts]=useState({})
  useEffect(()=>{if(nf?.filter){setFilter(nf.filter);setPage(1)}},[nf])
  const im={};inv.forEach(i=>{im[i.drug_code]=i});const merged=drugs.filter(d=>stats.includes(d.status)).map(d=>{const iv=im[d.drug_code]||{};const q=d.current_qty||0,sf=iv.safety_stock||d.safety_stock||0,mx=iv.max_stock||d.max_stock||0;let st='정상';if(q===0)st='재고없음';else if(sf>0&&q<sf)st='부족';else if(mx>0&&q>mx)st='과잉';return{...d,safety_stock:sf,max_stock:mx,monthly_avg:iv.monthly_avg||d.monthly_avg||0,stockStatus:st}})
  const sg={전체:merged.length,부족:merged.filter(d=>d.stockStatus==='부족').length,재고없음:merged.filter(d=>d.stockStatus==='재고없음').length,정상:merged.filter(d=>d.stockStatus==='정상').length,과잉:merged.filter(d=>d.stockStatus==='과잉').length}
  const filtered=so(merged.filter(d=>{if(filter!=='전체'&&d.stockStatus!==filter)return false;if(!cats.includes(d.category))return false;if(search.trim()){const q=search.trim().toLowerCase();return d.drug_name?.toLowerCase().includes(q)||d.drug_code?.toLowerCase().includes(q)};return true}));const tp=Math.ceil(filtered.length/PP),paged=filtered.slice((page-1)*PP,page*PP)
  const sc=s=>s==='재고없음'?t.red:s==='부족'?t.amber:s==='과잉'?t.blue:t.green
  const _dCard=filter!=='전체',_dCat=cats.length!==CATS.length,_dStat=!(stats.length===MAIN_STATS.length&&MAIN_STATS.every(s=>stats.includes(s))),_dSearch=search.trim()!=='',_dSort=!(sk==='drug_name'&&sd==='asc');
  const _fcount=(_dCard?1:0)+(_dCat?1:0)+(_dStat?1:0)+(_dSearch?1:0)+(_dSort?1:0);const _showReset=_fcount>0;
  function _resetF(){setFilter('전체');setCats(CATS);setStats(MAIN_STATS);setSearch('');setSort('drug_name','asc');setPage(1)}
  const origStr=v=>v==null?'':String(v)
  const pNum=v=>{const x=String(v).trim();if(x==='')return null;const n=Number(x.replace(/,/g,''));return(Number.isFinite(n)&&n>=0)?n:undefined}
  function editUsage(d,field,val){setDrafts(prev=>{const o0=origStr(d.prev_year_usage),o1=origStr(d.recent_3m_usage);const cur=prev[d.drug_code]||{py:o0,r3:o1};const next={...cur,[field]:val};if(next.py===o0&&next.r3===o1){const cp={...prev};delete cp[d.drug_code];return cp}return{...prev,[d.drug_code]:next}})}
  function cancelUsage(code){setDrafts(prev=>{if(!prev[code])return prev;const cp={...prev};delete cp[code];return cp})}
  async function saveRowUsage(d){const dr=drafts[d.drug_code];if(!dr)return;const pv=pNum(dr.py),rv=pNum(dr.r3);if(pv===undefined||rv===undefined){setUMsg('오류: 숫자(0 이상)만 입력하세요');setTimeout(()=>setUMsg(null),3000);return}const upd={prev_year_usage:pv,recent_3m_usage:rv};let m=null;if(rv!=null)m=Math.round(rv/3);else if(pv!=null)m=Math.round(pv/12);if(m!=null){upd.monthly_avg=m;upd.safety_stock=Math.round(m*1.5);upd.max_stock=Math.round(m*3)}const{error}=await supabase.from('drugs').update(upd).eq('drug_code',d.drug_code);if(error){setUMsg('저장 오류: '+error.message);return}cancelUsage(d.drug_code);onReload?.()}
  const _u=arr=>[...new Set(arr.filter(v=>v!=null&&String(v).trim()!==''))]
  const hf={category:{items:_u(merged.map(d=>d.category)).sort(),value:cats.length===1?cats[0]:null,on:v=>{setCats(v?[v]:CATS);setPage(1)}},status:{items:_u(drugs.map(d=>d.status)),value:stats.length===1?stats[0]:null,on:v=>{setStats(v?[v]:MAIN_STATS);setPage(1)}},stockStatus:{items:_u(merged.map(d=>d.stockStatus)),value:filter==='전체'?null:filter,on:v=>{setFilter(v||'전체');setPage(1)}}}
  function dl(){const ws=XLSX.utils.json_to_sheet(filtered.map(d=>({약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,현재고:d.current_qty,안전재고:d.safety_stock,최대재고:d.max_stock,월평균:d.monthly_avg,상태:d.status,재고상태:d.stockStatus})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'재고');XLSX.writeFile(wb,`재고_${new Date().toISOString().split('T')[0]}.xlsx`)}
  /* 대량등록: 파싱→검증(숫자·매칭)→검토(미반영)→확정 시 RLS 일괄 UPDATE. 연쇄계산은 saveUsage와 동일. */
  async function uploadUsage(e){
    const file=e.target.files[0];if(!file)return;setURep(null)
    const reader=new FileReader();reader.onload=ev=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false})
        const codes=new Set(drugs.map(d=>d.drug_code))
        const num=v=>{const x=String(v).trim();if(x==='')return undefined;const n=Number(x.replace(/,/g,''));return (Number.isFinite(n)&&n>=0)?n:NaN}
        const updates=[],unmatched=[],invalid=[]
        rows.forEach((r,i)=>{
          const ln=i+2
          const code=String(r['약품코드']??r['drug_code']??'').trim();if(!code)return
          const pyRaw=r['전년사용량']??r['전년도사용량']??r['prev_year_usage']??''
          const r3Raw=r['최근3개월사용량']??r['최근3개월']??r['recent_3m_usage']??''
          const py=num(pyRaw),r3=num(r3Raw)
          if(Number.isNaN(py)){invalid.push({ln,code,col:'전년사용량',val:String(pyRaw)});return}
          if(Number.isNaN(r3)){invalid.push({ln,code,col:'최근3개월사용량',val:String(r3Raw)});return}
          if(py===undefined&&r3===undefined)return
          if(!codes.has(code)){unmatched.push(code);return}
          const pv=py===undefined?null:py,rv=r3===undefined?null:r3
          let m=null;if(rv!=null)m=Math.round(rv/3);else if(pv!=null)m=Math.round(pv/12)
          updates.push({code,upd:{prev_year_usage:pv,recent_3m_usage:rv,monthly_avg:m,safety_stock:m!=null?Math.round(m*1.5):null,max_stock:m!=null?Math.round(m*3):null}})
        })
        setURep({phase:'review',updates,unmatched,invalid})
      }catch(err){setURep({phase:'error',msg:err.message,updates:[],unmatched:[],invalid:[]})}
    };reader.readAsArrayBuffer(file);e.target.value=''
  }
  async function applyUsage(){
    if(!uRep||!uRep.updates.length)return
    setURep({...uRep,phase:'applying'})
    let ok=0;const failed=[]
    for(const u of uRep.updates){const{error}=await supabase.from('drugs').update(u.upd).eq('drug_code',u.code);if(error)failed.push(u.code);else ok++}
    onReload?.()
    setURep({phase:'done',ok,failed,unmatched:uRep.unmatched,invalid:uRep.invalid,updates:uRep.updates})
  }
  function dlUsageTemplate(){const ws=XLSX.utils.aoa_to_sheet([['약품코드','약품명(참고용)','전년사용량','최근3개월사용량'],['SGBRONNC10','가바로닌캡슐100mg',1592,974],['GRD2','게리드정2밀리그램',330,105]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'사용량');XLSX.writeFile(wb,'사용량_업로드_양식.xlsx')}
  return<div style={{padding:'20px 24px'}}>
    <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:14}}>{[{k:'전체',c:t.text},{k:'부족',c:t.amber},{k:'재고없음',c:t.red},{k:'정상',c:t.green},{k:'과잉',c:t.blue}].map(f2=><div key={f2.k} onClick={()=>{setFilter(f2.k);setPage(1)}} style={{background:filter===f2.k?f2.c+'15':t.card,borderRadius:12,padding:'12px 16px',border:`1px solid ${filter===f2.k?f2.c:t.border}`,cursor:'pointer',backdropFilter:'blur(12px)'}}><div style={{fontSize:10,color:t.textM}}>{f2.k}</div><div style={{fontSize:24,fontWeight:700,color:f2.c}}>{sg[f2.k]}</div></div>)}</div>
    {uMsg&&<div style={{background:uMsg.includes('완료')?t.greenL:uMsg.includes('오류')?t.redL:t.blueL,border:`1px solid ${uMsg.includes('완료')?t.green:uMsg.includes('오류')?t.red:t.blue}`,borderRadius:8,padding:'10px 14px',marginBottom:10,color:uMsg.includes('완료')?t.green:uMsg.includes('오류')?t.red:t.blue,fontSize:12,fontWeight:600}}>{uMsg}</div>}
    {uRep&&<div className="no-print" style={{background:t.card,border:'1px solid '+t.border,borderRadius:12,padding:'12px 16px',marginBottom:12,fontSize:12,backdropFilter:'blur(12px)'}}>
      {uRep.phase==='error'?<div style={{color:t.red,fontWeight:600}}>업로드 오류: {uRep.msg}</div>
      :uRep.phase==='applying'?<div style={{color:t.blue,fontWeight:600}}>반영 중...</div>
      :uRep.phase==='done'?<div>
        <div style={{fontWeight:700,color:t.green,marginBottom:6}}>업로드 완료</div>
        <div style={{color:t.text}}>성공 {uRep.ok}건{uRep.failed.length?(' · 저장실패 '+uRep.failed.length+'건 ('+uRep.failed.join(', ')+')'):''}</div>
        {uRep.unmatched.length?<div style={{color:t.amber,marginTop:4}}>매칭실패 {uRep.unmatched.length}건(미반영): {uRep.unmatched.join(', ')}</div>:null}
        {uRep.invalid.length?<div style={{color:t.red,marginTop:4}}>형식오류 {uRep.invalid.length}건(미반영): {uRep.invalid.map(x=>'행'+x.ln+' '+x.col+':"'+x.val+'"').join(', ')}</div>:null}
        <button onClick={()=>setURep(null)} style={{marginTop:8,padding:'6px 14px',borderRadius:8,border:'1px solid '+t.border,background:t.bg,color:t.text,cursor:'pointer',fontSize:11,fontWeight:600}}>닫기</button>
      </div>
      :<div>
        <div style={{fontWeight:700,color:t.text,marginBottom:6}}>업로드 검토 — 확정 전 미반영</div>
        <div style={{color:t.text}}>반영 대상 <b style={{color:t.green}}>{uRep.updates.length}</b>건 · 매칭실패 <b style={{color:t.amber}}>{uRep.unmatched.length}</b>건 · 형식오류 <b style={{color:t.red}}>{uRep.invalid.length}</b>건</div>
        {uRep.unmatched.length?<div style={{color:t.amber,marginTop:4}}>매칭실패 코드: {uRep.unmatched.join(', ')}</div>:null}
        {uRep.invalid.length?<div style={{color:t.red,marginTop:4}}>형식오류: {uRep.invalid.map(x=>'행'+x.ln+' '+x.col+':"'+x.val+'"').join(', ')}</div>:null}
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <button onClick={applyUsage} disabled={!uRep.updates.length} style={{padding:'6px 14px',borderRadius:8,border:'1px solid '+(uRep.updates.length?t.green:t.border),background:uRep.updates.length?t.greenL:t.bg,color:uRep.updates.length?t.green:t.textL,cursor:uRep.updates.length?'pointer':'default',fontSize:11,fontWeight:600}}>반영 {uRep.updates.length}건</button>
          <button onClick={()=>setURep(null)} style={{padding:'6px 14px',borderRadius:8,border:'1px solid '+t.border,background:t.bg,color:t.textM,cursor:'pointer',fontSize:11,fontWeight:600}}>취소</button>
        </div>
      </div>}
    </div>}
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
<div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:13,color:t.purple,display:'flex',justifyContent:'space-between'}}><span>재고 현황 목록</span><span style={{display:'flex',alignItems:'center',gap:10}}><span style={{color:t.textM,fontWeight:500}}>{filtered.length}개</span>{_showReset?<button onClick={_resetF} title="처음 상태로 초기화" style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${t.accent}`,background:t.accent+'12',color:t.accent,cursor:'pointer',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>필터 초기화{_fcount>0?' ('+_fcount+')':''}</button>:null}</span></div>
      <StandardTable t={t} TS={TS} sk={sk} sd={sd} setSort={(k,sdv)=>{setSort(k,sdv);setPage(1)}} hf={hf} grid layout="fixed" minWidth={1306} colWidths={[100,200,90,80,80,80,92,120,104,90,90,100,80]} hscroll={{noLabel:true,ends:true}} cols={[{k:'drug_code',h:'약품코드',sticky:{left:0,w:100}},{k:'drug_name',h:'약품명',sticky:{left:100}},{k:'category',h:'구분'},{k:'current_qty',h:'현재고'},{k:'safety_stock',h:'안전재고'},{k:'max_stock',h:'최대재고'},{k:'prev_year_usage',h:'전년사용량'},{k:'recent_3m_usage',h:'최근3개월사용량'},{k:'monthly_avg',h:'월평균'},{k:'status',h:'상태'},{k:'stockStatus',h:'재고상태'},{k:'expiry_date',h:'유효기한'},{k:'',h:'보정',plain:true}]}>
        <tbody>{!paged.length?<tr><td colSpan={13} style={{padding:40,textAlign:'center',color:t.textL}}>없음</td></tr>:paged.map((d,i)=>{const dr=drafts[d.drug_code];const dirty=!!dr;const pyV=dirty?dr.py:origStr(d.prev_year_usage);const r3V=dirty?dr.r3:origStr(d.recent_3m_usage);let pM=d.monthly_avg,pSf=d.safety_stock,pMx=d.max_stock,pSt=d.stockStatus;if(dirty){const pv=pNum(dr.py),rv=pNum(dr.r3);const pvN=typeof pv==='number'?pv:null,rvN=typeof rv==='number'?rv:null;let m=null;if(rvN!=null)m=Math.round(rvN/3);else if(pvN!=null)m=Math.round(pvN/12);pM=m;pSf=m!=null?Math.round(m*1.5):null;pMx=m!=null?Math.round(m*3):null;const q=d.current_qty||0;pSt=q===0?'재고없음':(pSf>0&&q<pSf)?'부족':(pMx>0&&q>pMx)?'과잉':'정상'}const unused=!d.prev_year_usage&&!d.recent_3m_usage;return <tr key={i} style={{borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>
          <td style={{padding:'8px 12px',fontSize:10,color:t.textM,textAlign:'left',position:'sticky',left:0,zIndex:2,background:t.card,minWidth:100,maxWidth:100,width:100,overflow:'hidden',borderRight:'1px solid '+t.border}}>{d.drug_code}<NT d={d}/></td><td style={{padding:'8px 12px',fontWeight:600,textAlign:'left',color:t.accent,cursor:'pointer',position:'sticky',left:100,zIndex:2,background:t.card,borderRight:'1px solid '+t.border,minWidth:160,maxWidth:240}} onClick={()=>onEdit(d)} onMouseEnter={e=>{e.currentTarget.style.textDecoration='underline';e.currentTarget.style.color=t.purple}} onMouseLeave={e=>{e.currentTarget.style.textDecoration='none';e.currentTarget.style.color=t.accent}}>{d.drug_name}</td><td style={{padding:'8px 10px',color:t.textM,fontSize:11,borderRight:'1px solid '+t.border}}>{d.category}</td>
          <td style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:d.stockStatus==='재고없음'?t.red:d.stockStatus==='부족'?t.amber:t.text,borderRight:'1px solid '+t.border}}>{d.current_qty?.toLocaleString()}</td>
          <td style={{padding:'8px 10px',textAlign:'right',color:dirty?t.accent:t.textM,fontStyle:dirty?'italic':'normal',borderRight:'1px solid '+t.border}}>{dirty?(pSf==null?'-':pSf):(d.safety_stock||'-')}</td><td style={{padding:'8px 10px',textAlign:'right',color:dirty?t.accent:t.textM,fontStyle:dirty?'italic':'normal',borderRight:'1px solid '+t.border}}>{dirty?(pMx==null?'-':pMx):(d.max_stock||'-')}</td><td style={{padding:'5px 6px',borderRight:'1px solid '+t.border}}><UsageCell value={pyV} dirty={dirty} onChange={v=>editUsage(d,'py',v)} onUndo={()=>cancelUsage(d.drug_code)}/></td><td style={{padding:'5px 6px',borderRight:'1px solid '+t.border}}><UsageCell value={r3V} dirty={dirty} onChange={v=>editUsage(d,'r3',v)} onUndo={()=>cancelUsage(d.drug_code)}/></td><td style={{padding:'5px 6px',textAlign:'right',color:dirty?t.accent:t.textM,borderRight:'1px solid '+t.border}}>{dirty?<div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}><span style={{fontWeight:700,fontStyle:'italic'}}>{pM==null?'-':pM}</span><span style={{display:'flex',gap:3}}><button onClick={()=>saveRowUsage(d)} title="저장" style={{padding:'2px 6px',borderRadius:4,border:'1px solid '+t.green,background:t.greenL,color:t.green,cursor:'pointer',fontSize:9,fontWeight:700,whiteSpace:'nowrap'}}>저장</button><button onClick={()=>cancelUsage(d.drug_code)} title="취소(Ctrl+Z)" style={{padding:'2px 6px',borderRadius:4,border:'1px solid '+t.border,background:t.bg,color:t.textM,cursor:'pointer',fontSize:9,fontWeight:600,whiteSpace:'nowrap'}}>취소</button></span></div>:(d.monthly_avg||'-')}</td>
          <td style={{padding:'8px 10px',borderRight:'1px solid '+t.border}}><SB s={d.status}/></td>
          <td style={{padding:'8px 10px',borderRight:'1px solid '+t.border}}><div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'flex-start'}}><Bd bg={sc(dirty?pSt:d.stockStatus)+'18'} color={sc(dirty?pSt:d.stockStatus)}>{dirty?pSt:d.stockStatus}</Bd>{unused?<Bd bg={t.amber+'18'} color={t.amber}>미사용</Bd>:null}</div></td>
          <td style={{padding:'8px 10',fontSize:11,...exS(d.expiry_date,t),borderRight:'1px solid '+t.border}}>{d.expiry_date||'-'}</td>
          <td style={{padding:'8px 6px',textAlign:'center',borderRight:'1px solid '+t.border}}>{d.last_adjusted_date&&<div style={{fontSize:8,color:t.amber,fontWeight:600,marginBottom:2}}>{d.last_adjusted_date}</div>}<button onClick={()=>onAdjust(d)} style={{padding:'3px 8px',borderRadius:4,border:`1px solid ${t.amber}`,background:d.last_adjusted_date?t.amberL:'transparent',color:t.amber,cursor:'pointer',fontSize:9,fontWeight:600,whiteSpace:'nowrap'}}>보정</button></td>
        </tr>})}</tbody>
      </StandardTable>
      <Pg page={page} setPage={setPage} tp={tp} fl={filtered} pp={PP} ends/>
    </div><Ft/>
  </div>
}

/* ═══ 향정마약 전용 — ★ 카드 클릭 필터링 ═══ */
/* 향정마약 전용 도넛(LDonut 형식 재사용·색 주입형). 공유 LDonut 미수정. */
function NDonut({ data, total, onSlice, onCenter, centerTop, centerBot, t, colorOf, centerTitle }) {
  const R = 58, CIRC = 2 * Math.PI * R; const tot = total || 1;
  return <svg viewBox="0 0 160 160" style={{ width: 140, height: 140, flexShrink: 0 }}>
    <g transform="rotate(-90 80 80)">{data.map((d, i) => { const dash = (d.count / tot) * CIRC; const off = data.slice(0, i).reduce((a, x) => a + (x.count / tot) * CIRC, 0); return <circle key={i} cx="80" cy="80" r={R} fill="none" stroke={colorOf(d.name, i)} strokeWidth="20" strokeDasharray={dash + ' ' + (CIRC - dash)} strokeDashoffset={-off} style={{ cursor: 'pointer' }} onClick={() => onSlice(d.name)}><title>{d.name + ': ' + d.count}</title></circle>; })}</g>
    <circle cx="80" cy="80" r="46" fill="transparent" style={{ cursor: onCenter ? 'pointer' : 'default' }} onClick={() => onCenter && onCenter()}><title>{centerTitle || (onCenter ? '뒤로' : '')}</title></circle>
    <text x="80" y="76" textAnchor="middle" style={{ fontSize: (typeof centerTop === 'string' && centerTop.length > 3) ? 12 : 15, fontWeight: 800, fill: t.accent, pointerEvents: 'none' }}>{centerTop}</text>
    <text x="80" y="93" textAnchor="middle" style={{ fontSize: 9, fill: t.textL, pointerEvents: 'none' }}>{centerBot}</text>
  </svg>;
}
/* 향정마약 분포 도넛 3종: 구분 / ATC(2단계→3단계 드릴다운) / 성분. 모수=사용. 드릴다운·클릭필터 재사용. */
function NarcDonuts({ used, t, donutF, onPick, onClear }) {
  const [drill2, setDrill2] = useState(null);
  const PAL = [t.accent, t.blue, t.green, t.amber, t.purple, t.navHi, t.red, '#7E57C2', '#26A69A', '#EC407A', '#8D6E63', '#5C6BC0'];
  const palOf = (n, i) => n === '미분류' ? t.textL : PAL[i % PAL.length];
  const total = used.length;
  const agg = (key, src) => { const m = {}; (src || used).forEach(d => { const v = (d[key] && String(d[key]).trim()) || '미분류'; m[v] = (m[v] || 0) + 1 }); return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
  const dCat = agg('category'), dL2 = agg('atc_l2'), dIng = agg('ingredient_kr');
  const l3src = drill2 ? used.filter(d => ((d.atc_l2 && String(d.atc_l2).trim()) || '미분류') === drill2) : null;
  const dL3 = drill2 ? agg('atc_l3', l3src) : [];
  const legItem = (level, d, colorOf, i) => <div key={d.name} onClick={() => onPick(level, d.name === '미분류' ? '' : d.name)} title={d.name + ': ' + d.count} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 5px', borderRadius: 6 }} onMouseEnter={e => e.currentTarget.style.background = t.bg} onMouseLeave={e => e.currentTarget.style.background = ''}><span style={{ width: 9, height: 9, borderRadius: 3, background: colorOf(d.name, i), flexShrink: 0 }} /><span style={{ fontSize: 10, color: t.textM, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span><span style={{ fontSize: 10, fontWeight: 700, color: t.text }}>{d.count}</span></div>;
  const col = (title, sub, donut, legend) => <div style={{ flex: '1 1 0', minWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: t.card, borderRadius: 12, border: '1px solid ' + t.border, padding: '12px 14px', boxShadow: t.shadow, boxSizing: 'border-box' }}><div style={{ fontSize: 12, fontWeight: 700, color: t.text, alignSelf: 'flex-start', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{title} <span style={{ fontSize: 10, fontWeight: 500, color: t.textL }}>{sub}</span></div>{donut}<div className="cnc-legend-scroll" style={{ width: '100%', height: 150, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr', gap: 2, alignContent: 'start' }}>{legend}</div></div>;
  return <div className="no-print" style={{ background: t.card, borderRadius: 14, border: '1px solid ' + t.border, padding: '14px 18px', marginBottom: 12, boxShadow: t.shadow }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>💊 향정·마약 분포 <span style={{ fontSize: 11, fontWeight: 500, color: t.textL }}>· 사용 {total}개 기준</span>{donutF ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, background: t.accent + '1A', color: t.accent, fontSize: 10, fontWeight: 700, border: '1px solid ' + t.accent + '40' }}>선택: {donutF.value || '미분류'}<span onClick={onClear} style={{ cursor: 'pointer', fontWeight: 800 }}>✕</span></span> : null}</div>
    <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', overflowX: 'auto' }}>
      {col('구분', '제형별', <NDonut data={dCat} total={total} onSlice={n => onPick('category', n === '미분류' ? '' : n)} onCenter={onClear} centerTitle="필터 해제(전체)" centerTop={total} centerBot="구분" t={t} colorOf={palOf} />, dCat.map((d, i) => legItem('category', d, palOf, i)))}
      {col('ATC', drill2 ? '3단계 · ' + drill2 : '2단계(중분류) · 클릭=3단계', <NDonut data={drill2 ? dL3 : dL2} total={drill2 ? (l3src ? l3src.length : 1) : total} onSlice={n => { if (!drill2) { setDrill2(n) } else { onPick('atc_l3', n === '미분류' ? '' : n) } }} onCenter={drill2 ? () => setDrill2(null) : onClear} centerTitle={drill2 ? 'ATC 2단계로' : '필터 해제(전체)'} centerTop={drill2 ? (l3src ? l3src.length : 0) : total} centerBot={drill2 ? '▸뒤로' : '중분류'} t={t} colorOf={atcColor} />, (drill2 ? dL3 : dL2).map((d, i) => legItem(drill2 ? 'atc_l3' : 'atc_l2', d, atcColor, i)))}
      {col('성분', '성분명별', <NDonut data={dIng} total={total} onSlice={n => onPick('ingredient_kr', n === '미분류' ? '' : n)} onCenter={onClear} centerTitle="필터 해제(전체)" centerTop={total} centerBot="성분" t={t} colorOf={palOf} />, dIng.map((d, i) => legItem('ingredient_kr', d, palOf, i)))}
    </div>
    {drill2 ? <div style={{ marginTop: 8 }}><button onClick={() => setDrill2(null)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>◂ ATC 2단계로</button></div> : null}
  </div>;
}
function NarcoticMgmt({drugs,onEdit,onAdjust,navFilter}){
  const{t}=useTheme();
  const[stats,setStats]=useState(navFilter?.narcStatus||['사용']);
  const[cardF,setCardF]=useState('전체');
  const[search,setSearch]=useState('');
  const[page,setPage]=useState(1);
  const[hfV,setHfV]=useState({});
  const[donutF,setDonutF]=useState(null);const[resetN,setResetN]=useState(0);
  const{so,TS,sk,sd,setSort}=useSort('drug_name');
  const base=drugs.filter(d=>isN(d)); /* isN: 한외마약 제외(getNT→'일반') */
  const narcs=base.filter(d=>stats.includes(d.status));
  const used=base.filter(d=>d.status==='사용');
  const byType={향정:narcs.filter(d=>getNT(d)==='향정'),마약:narcs.filter(d=>getNT(d)==='마약')};
  const expiring=narcs.filter(d=>{const x=exD(d.expiry_date);return x!==null&&x<=180});
  const cards=[{k:'전체',v:narcs.length,c:t.purple},{k:'향정',v:byType['향정'].length,c:t.purple},{k:'마약',v:byType['마약'].length,c:t.red},{k:'유효기한 주의',v:expiring.length,c:t.amber}];
  const _u=arr=>[...new Set(arr.filter(v=>v!=null&&String(v).trim()!==''))].sort();
  const setHF=(k,v)=>{setHfV(p=>{const n={...p};if(v==null)delete n[k];else n[k]=v;return n});setPage(1)};
  const hf={
    category:{items:_u(base.map(d=>d.category)),value:hfV.category??null,on:v=>setHF('category',v)},
    narcotic_type:{items:['향정','마약'],value:hfV.narcotic_type??null,on:v=>setHF('narcotic_type',v)},
    atc_l1:{items:_u(base.map(d=>d.atc_l1)),value:hfV.atc_l1??null,on:v=>setHF('atc_l1',v)},
    atc_l2:{items:_u(base.map(d=>d.atc_l2)),value:hfV.atc_l2??null,on:v=>setHF('atc_l2',v)},
    atc_l3:{items:_u(base.map(d=>d.atc_l3)),value:hfV.atc_l3??null,on:v=>setHF('atc_l3',v)},
    manufacturer:{items:_u(base.map(d=>d.manufacturer)),value:hfV.manufacturer??null,on:v=>setHF('manufacturer',v)},
    packaging:{items:_u(base.map(d=>d.packaging)),value:hfV.packaging??null,on:v=>setHF('packaging',v)},
    insurance_type:{items:_u(base.map(d=>d.insurance_type)),value:hfV.insurance_type??null,on:v=>setHF('insurance_type',v)},
    storage_method:{items:_u(base.map(d=>d.storage_method)),value:hfV.storage_method??null,on:v=>setHF('storage_method',v)},
    status:{items:_u(base.map(d=>d.status)),value:hfV.status??null,on:v=>setHF('status',v)},
  };
  const pass=d=>{
    for(const k in hfV){const fv=hfV[k];if(fv==null)continue;const hv=k==='narcotic_type'?getNT(d):(d[k]==null?'':String(d[k]).trim());if(hv!==fv)return false}
    if(donutF){const dv=donutF.level==='narcotic_type'?getNT(d):(d[donutF.level]==null?'':String(d[donutF.level]).trim());if(dv!==donutF.value)return false}
    if(cardF==='향정'&&getNT(d)!=='향정')return false;
    if(cardF==='마약'&&getNT(d)!=='마약')return false;
    if(cardF==='유효기한 주의'){const x=exD(d.expiry_date);if(!(x!==null&&x<=180))return false}
    if(search.trim()){const q=search.trim().toLowerCase();if(!((d.drug_name||'').toLowerCase().includes(q)||(d.drug_code||'').toLowerCase().includes(q)||(d.ingredient_kr||'').toLowerCase().includes(q)||(d.manufacturer||'').toLowerCase().includes(q)))return false}
    return true
  };
  const filtered=so(narcs.filter(pass));const tp=Math.ceil(filtered.length/PP),paged=filtered.slice((page-1)*PP,page*PP);
  const cellL={padding:'8px 10px',color:t.textM,fontSize:11,borderRight:'1px solid '+t.border,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
  const cellC={padding:'8px 10px',textAlign:'center',color:t.textM,fontSize:11,borderRight:'1px solid '+t.border};
  const cellR={padding:'8px 10px',textAlign:'right',color:t.textM,fontSize:11,borderRight:'1px solid '+t.border};
  const COLS=[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['narcotic_type','분류'],['atc_l1','ATC1단계'],['atc_l2','ATC2단계'],['atc_l3','ATC3단계'],['additive','첨가제'],['manufacturer','제조사'],['total_qty','규격'],['packaging','포장'],['current_qty','현재고'],['edi_price','보험약가'],['insurance_type','급여'],['insurance_code','보험코드'],['expiry_date','유효기한'],['','D-day'],['storage_method','보관'],['status','상태'],['','보정']];
  const CW=[96,180,76,64,96,110,130,150,130,64,64,76,80,64,100,100,64,80,72,64];
  const dStats=!(stats.length===1&&stats[0]==='사용'),dCard=cardF!=='전체',dSearch=search.trim()!=='',dDonut=!!donutF,dHf=Object.keys(hfV).length,dSort=!(sk==='drug_name'&&sd==='asc');
  const fcount=(dStats?1:0)+(dCard?1:0)+(dSearch?1:0)+(dDonut?1:0)+dHf;const showReset=fcount>0||dSort;
  function resetFilters(){setStats(['사용']);setCardF('전체');setSearch('');setHfV({});setDonutF(null);setSort('drug_name','asc');setPage(1);setResetN(n=>n+1)}
  function dl(){const ws=XLSX.utils.json_to_sheet(filtered.map(d=>({약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,분류:getNT(d),ATC1단계:d.atc_l1||'',ATC2단계:d.atc_l2||'',ATC3단계:d.atc_l3||'',첨가제:d.additive||'',제조사:d.manufacturer||'',규격:d.total_qty??'',포장:d.packaging||'',현재고:d.current_qty||0,보험약가:d.edi_price??'',급여:d.insurance_type||'',보험코드:d.insurance_code||'',유효기한:d.expiry_date||'',남은일수:exD(d.expiry_date),보관:d.storage_method||'',상태:d.status})));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'향정마약');XLSX.writeFile(wb,`향정마약_${new Date().toISOString().split('T')[0]}.xlsx`)}
  return<div style={{padding:'20px 24px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><div style={{fontSize:16,fontWeight:700,color:t.purple}}>향정·마약류 관리</div><button onClick={dl} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.green}`,background:t.greenL,color:t.green,cursor:'pointer',fontSize:11,fontWeight:600}}>엑셀</button></div>
    <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'10px 16px',marginBottom:12,backdropFilter:'blur(12px)'}}>
      <MP items={STATS} selected={stats} onChange={v=>{setStats(v);setPage(1)}} color={t.green} label="상태"/>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
      {cards.map((c,i)=><div key={i} onClick={()=>{setCardF(c.k);setPage(1)}} style={{background:cardF===c.k?c.c+'15':t.card,border:`1px solid ${cardF===c.k?c.c:t.border}`,borderRadius:12,padding:'14px 16px',cursor:'pointer',backdropFilter:'blur(12px)',transition:'all .15s'}} onMouseEnter={e=>{if(cardF!==c.k)e.currentTarget.style.borderColor=c.c}} onMouseLeave={e=>{if(cardF!==c.k)e.currentTarget.style.borderColor=t.border}}><div style={{fontSize:11,color:cardF===c.k?c.c:t.textM,fontWeight:cardF===c.k?700:500}}>{c.k}</div><div style={{fontSize:26,fontWeight:700,color:c.c,marginTop:4}}>{c.v}</div></div>)}
    </div>
    <div className="no-print" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'12px 16px',marginBottom:12,backdropFilter:'blur(12px)',display:'flex',gap:8,alignItems:'center'}}>
      <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="약품명·코드·성분·제조사 검색..." style={{flex:1,minWidth:0,padding:'10px 14px',border:`1px solid ${t.border}`,borderRadius:10,fontSize:13,outline:'none',boxSizing:'border-box',background:t.bg,color:t.text}} onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.border}/>
      {showReset?<button onClick={resetFilters} title="처음 상태로 초기화" style={{flexShrink:0,padding:'10px 14px',borderRadius:10,border:`1px solid ${t.accent}`,background:t.accent+'12',color:t.accent,cursor:'pointer',fontSize:12,fontWeight:700,whiteSpace:'nowrap'}}>필터 초기화{fcount>0?' ('+fcount+')':''}</button>:null}
    </div>
    <NarcDonuts key={resetN} used={used} t={t} donutF={donutF} onPick={(level,value)=>{setDonutF({level,value});setPage(1)}} onClear={()=>{setDonutF(null);setPage(1)}}/>
    <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',backdropFilter:'blur(12px)'}}>
      <div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:13,color:t.purple,display:'flex',justifyContent:'space-between'}}><span>{cardF==='전체'?'향정·마약 전체':cardF} 목록</span><span style={{display:'flex',alignItems:'center',gap:10}}><span style={{color:t.textM,fontWeight:500}}>{filtered.length}개</span>{showReset?<button onClick={resetFilters} title="처음 상태로 초기화" style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${t.accent}`,background:t.accent+'12',color:t.accent,cursor:'pointer',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>필터 초기화{fcount>0?' ('+fcount+')':''}</button>:null}</span></div>
      <StandardTable t={t} TS={TS} sk={sk} sd={sd} setSort={(kk,dd)=>{setSort(kk,dd);setPage(1)}} hf={hf} grid layout="fixed" minWidth={1860} colWidths={CW} hscroll={{noLabel:true,ends:true}} cols={COLS.map(([k,h])=>({k,h,plain:!k,...(k==='drug_code'?{sticky:{left:0,w:96}}:k==='drug_name'?{sticky:{left:96}}:{})}))}>
        <tbody>{!paged.length?<tr><td colSpan={COLS.length} style={{padding:40,textAlign:'center',color:t.textL}}>없음</td></tr>:paged.map((d,i)=>{const days=exD(d.expiry_date);const nt=getNT(d);return<tr key={i} style={{borderBottom:`1px solid ${t.border}`}} onMouseEnter={e=>e.currentTarget.style.background=t.glass} onMouseLeave={e=>e.currentTarget.style.background=''}>
          <td style={{padding:'8px 12px',fontSize:10,color:t.textM,textAlign:'left',position:'sticky',left:0,zIndex:2,background:t.card,minWidth:96,maxWidth:96,width:96,overflow:'hidden',borderRight:'1px solid '+t.border}}>{d.drug_code}</td>
          <td style={{padding:'8px 12px',fontWeight:600,textAlign:'left',color:t.accent,cursor:'pointer',position:'sticky',left:96,zIndex:2,background:t.card,borderRight:'1px solid '+t.border,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} onClick={()=>onEdit(d)} onMouseEnter={e=>{e.currentTarget.style.textDecoration='underline';e.currentTarget.style.color=t.purple}} onMouseLeave={e=>{e.currentTarget.style.textDecoration='none';e.currentTarget.style.color=t.accent}}>{d.drug_name}</td>
          <td style={cellL}>{d.category||'-'}</td>
          <td style={cellC}><Bd bg={nt==='마약'?t.redL:t.purpleL} color={nt==='마약'?t.red:t.purple}>{nt}</Bd></td>
          <td style={cellL}>{d.atc_l1||'-'}</td>
          <td style={cellL}>{d.atc_l2||'-'}</td>
          <td style={cellL}>{d.atc_l3||'-'}</td>
          <td style={cellL}>{d.additive||'-'}</td>
          <td style={cellL}>{d.manufacturer||'-'}</td>
          <td style={cellR}>{d.total_qty!=null&&d.total_qty!==''?Number(d.total_qty).toLocaleString():'-'}</td>
          <td style={cellC}>{d.packaging||'-'}</td>
          <td style={{...cellR,fontWeight:600,color:d.current_qty===0?t.red:t.text}}>{(d.current_qty||0).toLocaleString()}</td>
          <td style={cellR}>{d.edi_price!=null&&d.edi_price!==''?Number(d.edi_price).toLocaleString():'-'}</td>
          <td style={cellC}>{d.insurance_type||'-'}</td>
          <td style={cellL}>{d.insurance_code||'-'}</td>
          <td style={{...cellL,...exS(d.expiry_date,t)}}>{d.expiry_date||'-'}</td>
          <td style={cellC}>{days!==null?<span style={{fontSize:10,color:days<=30?t.red:days<=90?t.amber:t.textM,fontWeight:600}}>D{days<=0?days:'-'+days}</span>:'-'}</td>
          <td style={cellL}>{d.storage_method||'-'}</td>
          <td style={cellC}><SB s={d.status}/></td>
          <td style={{padding:'8px 6px',textAlign:'center',borderRight:'1px solid '+t.border}}><button onClick={()=>onAdjust(d)} style={{padding:'3px 8px',borderRadius:4,border:`1px solid ${t.amber}`,background:'transparent',color:t.amber,cursor:'pointer',fontSize:9,fontWeight:600,whiteSpace:'nowrap'}}>보정</button></td>
        </tr>})}</tbody>
      </StandardTable>
      <Pg page={page} setPage={setPage} tp={tp} fl={filtered} pp={PP} ends/>
    </div><Ft/>
  </div>
}

/* ═══ 기초정보 등록 ═══ */
function DrugRegister({onRefresh, drugs}) {
  const { memberRole, profile } = useTheme(); const isOwner = memberRole === 'owner' || memberRole === 'admin' || profile?.role === 'admin'
  const initForm={drug_code:'',drug_name:'',category:'경구제',manufacturer:'',ingredient_kr:'',ingredient_en:'',efficacy_class:'',efficacy:'',specification:'',unit:'',price_unit:'',insurance_price:'',insurance_type:'급여',insurance_code:'',current_qty:0,expiry_date:'',lot_no:'',storage_method:'실온',status:'사용',narcotic_type:'해당없음',prescription_type:'',atc_code:''}
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
    const isEng=s=>s&&/^[a-zA-Z\s()[\]\-,.:;0-9]+$/.test(s)
    /* 이름 정제 */
    const cleaned=drugName.replace(/[\d]+[\s]*(mg|ml|g|mcg|밀리그램|밀리리터|그램)/gi,'').trim()
    const short=drugName.replace(/(정|캡슐|주사|시럽|현탁|산|과립|주|액|크림|연고|겔|패치|좌제).*$/,'').trim()
    const paren=drugName.match(/[(（]([^)）]+)[)）]/)?.[1]||''
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
        }catch{ /* 오류 무시 */ }
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
            const ingrParts=mainIngr.split(/[;；,，/]/).map(s=>s.trim()).filter(Boolean)
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
        }catch{ /* 오류 무시 */ }
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
        }catch{ /* 오류 무시 */ }
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
    const parenMatch=drugName.match(/[(（]([^)）]+)[)）]/)
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
    const isEng=s=>s&&/^[a-zA-Z\s()[\]\-,.:;0-9]+$/.test(s)
    const enVal=item.ingredientEn||(isEng(ing)?ing:'')
    const krVal=item.ingredientKr||(!isEng(ing)&&ing?ing:'')
    const parenKr=(item.name||'').match(/[(（]([가-힣\s]+)[)）]/)?.[1]||''
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
    const _atc=decomposeAtc(form.atc_code); const row={
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
      edi_price:Number(form.insurance_price)||0,
      insurance_type:form.insurance_type,
      insurance_code:form.insurance_code||null,
      current_qty:Number(form.current_qty)||0,
      expiry_date:form.expiry_date||null,
      lot_no:form.lot_no||null,
      storage_method:form.storage_method||null,
      status:form.status,
      is_narcotic:form.narcotic_type==='향정'||form.narcotic_type==='마약',
      narcotic_type:form.narcotic_type==='해당없음'?null:form.narcotic_type,
      prescription_type:form.prescription_type||null,
      atc_code:form.atc_code?form.atc_code.trim().toUpperCase():null,atc_l1:_atc.atc_l1||null,atc_l2:_atc.atc_l2||null,atc_l3:_atc.atc_l3||null,
    }
    /* 누락 컬럼 자동 제거 후 재시도 (최대 3회) */
    let res=await supabase.from('drugs').insert([row])
    for(let retry=0;retry<3&&res.error&&res.error.message.includes('column');retry++){
      const m=res.error.message.match(/'([^']+)' column/);if(!m)break;console.warn('[drugs INSERT] 미존재 컬럼 자동 제거:', m[1], '/ 원인:', res.error.message);delete row[m[1]]
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
        const ws=wb2.Sheets[wb2.SheetNames[0]]
        const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''})
        if(!aoa.length){setBulkMsg({type:'error',text:'데이터가 없습니다.'});return}
        const hdrs=(aoa[0]||[]).map(h=>String(h).trim()).filter(Boolean)
        if(!hdrs.length){setBulkMsg({type:'error',text:'헤더 행을 찾을 수 없습니다.'});return}
        const rawRows=aoa.slice(1).filter(r=>r.some(x=>String(x).trim()!=='')).map(r=>{const o={};hdrs.forEach((h,i)=>{o[h]=String(r[i]==null?'':r[i])});return o})
        if(!rawRows.length){setBulkMsg({type:'error',text:'데이터 행이 없습니다.'});return}
        const mapping=autoMap(hdrs)
        if(!mapping.drug_code||!mapping.drug_name){setBulkMsg({type:'error',text:'약품코드·약품명 컬럼을 인식하지 못했습니다. 양식을 확인하세요.'});return}
        const existingMap=new Map((drugs||[]).map(d=>[String(d.drug_code),d]))
        const parsed=classifyDrugRows(rawRows,mapping,existingMap,isOwner)
        setBulk(parsed)
        const nc=parsed.filter(r=>r.status==='new').length,uc=parsed.filter(r=>r.status==='update').length,ec=parsed.filter(r=>r.status==='error').length
        setBulkMsg({type:'info',text:`${parsed.length}행 · 신규 ${nc} · 갱신 ${uc} · 오류 ${ec}`})
      }catch(err){setBulkMsg({type:'error',text:'파일 읽기 오류: '+err.message})}
    }
    reader.readAsArrayBuffer(file);e.target.value=''
  }

  async function bulkSubmit(){
    const targets=bulk.filter(r=>r.status!=='error')
    if(targets.length===0){setBulkMsg({type:'error',text:'반영 가능한 데이터가 없습니다.'});return}
    setBulkLoading(true)
    const res=await applyDrugRows(bulk)
    setBulkLoading(false)
    if(res.fail.length){setBulkMsg({type:'error',text:`${res.success}건 반영 · 실패 ${res.fail.length}건 (${res.fail.slice(0,3).map(f=>f.code||'-').join(', ')}${res.fail.length>3?'…':''})`})}
    else setBulkMsg({type:'success',text:`${res.success}건 반영 완료! (신규 ${res.newCount} · 갱신 ${res.updateCount})`})
    setBulk([]);onRefresh();setTimeout(()=>setBulkMsg(null),5000)
  }

  function dlTemplate(){
    const ws=XLSX.utils.aoa_to_sheet([
      ['약품코드','약품명','구분','성분명(영문)','성분명(한글)','약효분류','효능','제조사','단위','제형','구입단가','보험약가','현재고','급여구분','보험코드','유효기한','LOT번호','보관','상태','향정'],
      ['NEWDRUG001','신규약품정1mg','경구제','ingredient','성분명','소화기계질환','해열 진통 효능','제조사명','정','100',1000,1000,100,'급여','64XXXXXX','2028-12-31','LOT001','실온','사용','일반'],
      ['','','','','','','','','','','','','','','','','','','','← 필수: 약품코드, 약품명만 입력하면 등록 가능'],
    ])
    ws['!cols']=Array(20).fill({wch:16})
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
              <div><label style={lbl}>성분명(영문)</label><input value={form.ingredient_en} onChange={e=>set('ingredient_en',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
              <div><label style={lbl}>성분명(한글)</label><input value={form.ingredient_kr} onChange={e=>set('ingredient_kr',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>약효분류명</label><input value={form.efficacy_class} onChange={e=>set('efficacy_class',e.target.value)} placeholder="API 자동입력 (예:소화기계질환)" style={inp}/></div>
              <div><label style={lbl}>효능</label><input value={form.efficacy} onChange={e=>set('efficacy',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={lbl}>제조사</label><input value={form.manufacturer} onChange={e=>set('manufacturer',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>제형</label><input value={form.specification} onChange={e=>set('specification',e.target.value)} placeholder="포장단위 (API 자동입력)" style={inp}/></div>
              <div><label style={lbl}>단위</label><input value={form.unit} onChange={e=>set('unit',e.target.value)} placeholder={form.unit||'API 조회 시 자동입력'} style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>보험약가</label><input type="number" value={form.insurance_price} onChange={e=>set('insurance_price',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
              <div><label style={lbl}>현재고</label><input type="number" value={form.current_qty} onChange={e=>set('current_qty',e.target.value)} placeholder="0" style={inp}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>급여구분</label><div style={{display:'flex',gap:4}}>{['급여','비급여'].map(x=><button key={x} onClick={()=>set('insurance_type',x)} style={{flex:1,padding:'8px',borderRadius:6,border:`2px solid ${form.insurance_type===x?C.green:'transparent'}`,cursor:'pointer',background:form.insurance_type===x?C.greenL:C.grayL,color:form.insurance_type===x?C.green:'#999',fontWeight:600,fontSize:12}}>{x}</button>)}</div></div>
              <div><label style={lbl}>보험코드</label><input value={form.insurance_code} onChange={e=>set('insurance_code',e.target.value)} placeholder="API 자동입력" style={inp}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={lbl}>분류</label><div style={{display:'flex',gap:4,alignItems:'center'}}>{RX_TOGGLE.map(x=><button key={x} type="button" onClick={()=>set('prescription_type',form.prescription_type===x?'':x)} style={{flex:1,padding:'8px',borderRadius:6,border:'2px solid '+(form.prescription_type===x?C.purple:'transparent'),cursor:'pointer',background:form.prescription_type===x?C.purpleL:C.grayL,color:form.prescription_type===x?C.purple:'#999',fontWeight:600,fontSize:12}}>{x}</button>)}<select value={RX_MORE.includes(form.prescription_type)?form.prescription_type:''} onChange={e=>set('prescription_type',e.target.value)} style={{...inp,flex:1,background:'#fff'}}><option value="">기타…</option>{RX_MORE.map(x=><option key={x} value={x}>{x}</option>)}</select></div></div>
            <div style={{marginBottom:12}}><label style={lbl}>ATC코드</label><input value={form.atc_code} onChange={e=>set('atc_code',e.target.value.toUpperCase())} placeholder="예: N02BE01" style={inp}/>{(()=>{const _a=decomposeAtc(form.atc_code);return (form.atc_code&&(_a.atc_l1||_a.atc_l2||_a.atc_l3))?<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>{[_a.atc_l1,_a.atc_l2,_a.atc_l3].filter(Boolean).map((v,i)=><span key={i} style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:C.purpleL,color:C.purple,border:'1px solid '+C.purpleB}}>{v}</span>)}</div>:form.atc_code?<div style={{marginTop:6,fontSize:10,color:'#999'}}>매핑 없음 — 코드만 저장(분류 비움)</div>:null})()}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
              <div><label style={lbl}>유효기한</label><input type="date" value={form.expiry_date} onChange={e=>set('expiry_date',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>LOT번호</label><input value={form.lot_no} onChange={e=>set('lot_no',e.target.value)} placeholder="LOT번호 입력" style={inp}/></div>
            </div>
            <div style={{marginBottom:12}}><label style={lbl}>보관방법</label><select value={form.storage_method} onChange={e=>set('storage_method',e.target.value)} style={{...inp,background:'#fff'}}>{STORAGE_OPTS.map(s=><option key={s}>{s}</option>)}</select></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
              <div><label style={lbl}>상태</label><select value={form.status} onChange={e=>set('status',e.target.value)} style={{...inp,background:'#fff'}}>{['사용','휴면','중지'].map(s=><option key={s}>{s}</option>)}</select></div>
              <div><label style={lbl}>마약구분</label><select value={form.narcotic_type} onChange={e=>set('narcotic_type',e.target.value)} style={{...inp,background:'#fff'}}>{['해당없음','향정','마약','한외마약'].map(s=><option key={s}>{s}</option>)}</select></div>
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
                    {['#','상태','약품코드','약품명','구분','제조사','보험약가','현재고','유효기한','상태','향정'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:'#666',fontWeight:500,borderBottom:`0.5px solid ${C.grayB}`,whiteSpace:'nowrap'}}>{h}</th>)}
                  </tr></thead>
                  <tbody>{bulk.map((r,i)=>(
                    <tr key={i} title={r.errors&&r.errors.length?r.errors.join(' / '):''} style={{borderBottom:`0.5px solid #f5f5f5`,background:r.status==='error'?C.coralL+'50':''}}>
                      <td style={{padding:'7px 10px',color:'#bbb'}}>{r.idx}</td>
                      <td style={{padding:'7px 10px'}}>{r.status==='error'?<span style={{background:C.coralL,color:C.coral,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:600}}>오류</span>:r.status==='update'?<span style={{background:C.blueL,color:C.blue,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:600}}>갱신</span>:<span style={{background:C.greenL,color:C.greenD,padding:'2px 7px',borderRadius:6,fontSize:10,fontWeight:600}}>신규</span>}</td>
                      <td style={{padding:'7px 10px',fontFamily:'monospace',fontSize:10,color:'#888'}}>{r.code||'없음'}</td>
                      <td style={{padding:'7px 10px',fontWeight:500,textAlign:'left'}}>{r.name||'-'}</td>
                      <td style={{padding:'7px 10px',color:'#666'}}>{r.fields.category||(r.ex&&r.ex.category)||'-'}</td>
                      <td style={{padding:'7px 10px',color:'#888'}}>{r.fields.manufacturer||'-'}</td>
                      <td style={{padding:'7px 10px',textAlign:'right'}}>{r.fields.edi_price!=null?Number(r.fields.edi_price).toLocaleString():'-'}</td>
                      <td style={{padding:'7px 10px',textAlign:'right'}}>{r.fields.current_qty!=null?Number(r.fields.current_qty).toLocaleString():'-'}</td>
                      <td style={{padding:'7px 10px',color:'#888'}}>{r.fields.expiry_date||'-'}</td>
                      <td style={{padding:'7px 10px'}}>{(r.fields.status||(r.ex&&r.ex.status))?<SB s={r.fields.status||r.ex.status}/>:'-'}</td>
                      <td style={{padding:'7px 10px'}}>{r.fields.is_narcotic?<span style={{background:C.lavL,color:C.lavender,padding:'1px 6px',borderRadius:4,fontSize:10}}>향정</span>:'-'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setBulk([]);setBulkMsg(null)}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.grayB}`,cursor:'pointer',background:'#fff',color:'#888',fontSize:13}}>취소</button>
                <button onClick={bulkSubmit} disabled={bulkLoading||bulk.filter(r=>r.status!=='error').length===0}
                  style={{flex:2,padding:11,borderRadius:10,border:'none',cursor:bulkLoading?'not-allowed':'pointer',background:bulkLoading?C.grayB:C.purple,color:'#fff',fontSize:14,fontWeight:700}}>
                  {bulkLoading?'반영 중...':`${bulk.filter(r=>r.status!=='error').length}건 일괄 반영`}
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
function TransactionForm({drugs,onReload,navFilter}){
  const{t}=useTheme();
  const[tab,setTab]=useState(navFilter?.txTab||'입고')
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
    const q=parseInt(form.qty);const amt=q*(selDrug.purchase_price||0)
    const tx={drug_code:selDrug.drug_code,drug_name:selDrug.drug_name,type:tab,sub_type:form.sub_type||null,quantity:q,unit_price:selDrug.purchase_price||0,total_amount:amt,note:form.note||null,transaction_date:new Date().toISOString().split('T')[0],reason:form.reason||null,handler:form.handler||null,approver:form.approver||null,process_status:form.process_status||null,supplier:form.supplier||null,lot_no:form.lot_no||null,expiry_date:form.expiry_date||null}
    let res=await supabase.from('transactions').insert([tx])
    for(let r=0;r<3&&res.error&&res.error.message?.includes('column');r++){const m=res.error.message.match(/'([^']+)' column/);if(!m)break;delete tx[m[1]];res=await supabase.from('transactions').insert([tx])}
    if(res.error){setMsg('오류: '+res.error.message);setSaving(false);return}
    /* 재고는 0009 트리거가 단일 기록(drugs+inventory 동기). 클라 직접 update·음수 절삭 제거 — 부족 시 트리거 RAISE가 위 res.error로 차단. */
    setMsg(`${tab} 완료! ${selDrug.drug_name} ${q}개`);setSelDrug(null);setSearch('');setForm(p=>({...p,qty:'',note:'',lot_no:'',expiry_date:'',reason:'',supplier:''}));setSaving(false);onReload?.();loadTxns()
    setTimeout(()=>setMsg(null),3000)
  }
  async function _delTx(tx){
    if(!confirm(`${tx.drug_name} ${tx.type} ${tx.quantity}개를 삭제하시겠습니까?`))return
    await supabase.from('transactions').delete().eq('id',tx.id)
    /* 삭제 역보정은 0015 AFTER DELETE 트리거(trg_revert_tx_from_inventory)가 drugs+inventory 동기 처리. */
    onReload?.();loadTxns()
  }
  /* 엑셀 대량 업로드 */
  function xlUpload(e){
    const file=e.target.files[0];if(!file)return;setBulkMsg(null)
    const reader=new FileReader();reader.onload=ev=>{
      try{const wb=XLSX.read(ev.target.result,{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false})
      if(!rows.length){setBulkMsg('데이터 없음');return}
      const parsed=rows.map((r,i)=>{
        const code=String(r['약품코드']||r['drug_code']||'').trim().toUpperCase()
        const drug=drugs.find(d=>d.drug_code===code)
        const qtyVal=Number(r[tab==='입고'?'입고수량':tab==='출고'?'출고수량':tab==='반품'?'반품수량':'폐기수량']||r['수량']||r['quantity']||0)
        const price=Number(r['단가']||r['unit_price']||drug?.purchase_price||0)
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
      if(!res.error){ ok++ /* 재고는 0009 트리거 단일기록. 음수는 트리거 RAISE로 차단(해당 행 fail). */ }else fail++
    }
    setBulkLd(false);setBulkMsg(`완료! ${ok}건 등록, ${fail}건 실패`);setBulkData([]);onReload?.();loadTxns()
    setTimeout(()=>setBulkMsg(null),4000)
  }
  function dlTemplate(){
    const hdrs=tab==='입고'?['일자','약품코드','약품명','구분','입고수량','단가','공급업체','비고']:tab==='출고'?['일자','약품코드','약품명','구분','출고수량','단가','비고']:tab==='반품'?['일자','약품코드','약품명','구분','반품수량','단가','로트번호','유효기한','반품사유','처리상태','비고']:['약품코드','약품명','구분','폐기수량','단가','로트번호','유효기한','폐기사유','처리자','승인자','비고']
    const ws=XLSX.utils.aoa_to_sheet([hdrs]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,tab);XLSX.writeFile(wb,`${tab}_양식.xlsx`)
  }
  /* 테이블 컬럼 정의 */
  const cols=tab==='입고'?[['transaction_date','일자'],['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','거래단가'],['total_amount','금액'],['supplier','공급업체'],['note','비고']]:tab==='출고'?[['transaction_date','일자'],['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','거래단가'],['total_amount','금액'],['note','비고']]:tab==='반품'?[['transaction_date','일자'],['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','거래단가'],['total_amount','금액'],['lot_no','LOT'],['expiry_date','유효기한'],['reason','사유'],['process_status','처리상태'],['note','비고']]:[['drug_code','약품코드'],['drug_name','약품명'],['sub_type','구분'],['quantity','수량'],['unit_price','거래단가'],['total_amount','금액'],['lot_no','LOT'],['expiry_date','유효기한'],['reason','사유'],['handler','처리자'],['approver','승인자'],['note','비고']]
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
        {selDrug&&<div style={{background:tc[tab]?.bg,borderRadius:6,padding:'6px 10px',marginBottom:6,fontSize:11,color:tc[tab]?.c}}><strong>{selDrug.drug_name}</strong> · 재고:{selDrug.current_qty} · ₩{selDrug.purchase_price?.toLocaleString()}</div>}
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
function nowStamp(){const n=new Date();const p=x=>String(x).padStart(2,'0');return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate())+' '+p(n.getHours())+':'+p(n.getMinutes())+' 작성'}
const mpTd={border:'1px solid #bbb',padding:'6px 10px'};
function MSec({title,children}){return <div style={{marginBottom:9}}><div style={{background:'#019748',color:'#fff',fontWeight:800,fontSize:13.5,padding:'5px 10px'}}>{title}</div><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><tbody>{children}</tbody></table></div>}
function MRow({label,value,bg}){return <tr><td style={{...mpTd,background:bg||'#eee',fontWeight:700,width:'42%'}}>{label}</td><td style={{...mpTd,textAlign:'right',fontWeight:800,color:'#804A87'}}>{value}</td></tr>}
function MRow2({label,cnt,amt,bg,fg}){return <tr><td style={{...mpTd,background:bg||'#eee',color:fg||'#222',fontWeight:700,width:'42%'}}>{label}</td><td style={{...mpTd,textAlign:'right',width:'29%'}}>{cnt}</td><td style={{...mpTd,textAlign:'right',width:'29%',fontWeight:700}}>{amt}</td></tr>}
function Report({drugs,txns,onNav}){
  const{t,memberRole}=useTheme();
  const isOwner=memberRole==='owner'; // 마감·업로드 권한(고위험 체크박스와 동일 패턴)
  const cy=new Date().getFullYear(),cm=new Date().getMonth()+1;
  const[rtype,setRtype]=useState('monthly');
  const[year,setYear]=useState(cy);const[month,setMonth]=useState(cm);
  const[snaps,setSnaps]=useState([]);const[ld,setLd]=useState(false);
  const[search,setSearch]=useState('');const[cats,setCats]=useState(CATS);const[stats,setStats]=useState(STATS);
  const[closing,setClosing]=useState(false);const[closeMsg,setCloseMsg]=useState(null);
  const[uploadOpen,setUploadOpen]=useState(false);const[dialog,setDialog]=useState(null); // 스냅샷 업로드 모달 · 앱 내 확인/안내 모달
  const{hs,so,SI,TS}=useSort('drug_code');

  /* 마감 버튼 파생값 — 대상은 화면 선택 연/월(year·month). cy/cm은 미래월 차단용 현재값 */
  const isFuture=year>cy||(year===cy&&month>cm); // 현재 월 이후 선택 → 마감 불가
  const monthClosed=snaps.some(s=>Number(s.snap_month)===month); // 선택 월 스냅샷 존재(월간 탭 기준)
  const snapCount=snaps.filter(s=>Number(s.snap_month)===month).length; // 선택 월 스냅샷 행수
  const closedMonthCount=new Set(snaps.map(s=>Number(s.snap_month))).size; // 연간 탭: 해당 연도 마감 완료 월 수

  useEffect(()=>{loadS()},[year,month,rtype]);
  async function loadS(){
    setLd(true);
    let all=[], f=0;
    while(true){
      let q=supabase.from('monthly_snapshots').select('*').eq('snap_year',year);
      if(rtype==='monthly')q=q.eq('snap_month',month);
      const{data,error}=await q.range(f,f+999);
      if(error||!data||!data.length)break;
      all=[...all,...data];
      if(data.length<1000)break;
      f+=1000;
    }
    setSnaps(all);setLd(false)
  }

  /* 월마감 요청 — 실행 직전 대상월 스냅샷 존재를 재조회. 있으면 차단(우회 경로 없음), 없으면 확인 후 진행 */
  async function requestClose(){
    if(!isOwner)return; // owner 전용(프론트 재확인)
    if(isFuture)return; // 미래 월 방어
    const label=`${year}년 ${month}월`;
    const{count,error}=await supabase.from('monthly_snapshots').select('id',{count:'exact',head:true}).eq('snap_year',year).eq('snap_month',month);
    const n=error?snapCount:(count||0);
    if(n>0){ // 기존 스냅샷 보호 — 재마감 차단(강행 버튼 미제공)
      setDialog({title:'재마감 제한',body:`${label}은 이미 스냅샷이 있습니다(${n.toLocaleString()}행).\n현재 값을 보호하기 위해 재마감이 제한됩니다.\n결산 재구축은 '스냅샷 업로드'를 사용하십시오.`});
      return;
    }
    const ym=`${year}-${String(month).padStart(2,'0')}`;
    const noTx=!txns.some(tx=>tx.transaction_date?.startsWith(ym));
    setDialog({title:`${label} 마감`,
      body:noTx?`해당 월의 거래 기록이 없어 입고·사용·폐기·반품이 0으로 기록됩니다.\n계속하시겠습니까?`:`${label}을 마감합니다. 계속하시겠습니까?`,
      confirmLabel:'마감 실행',onConfirm:runClose});
  }

  /* 월마감 실제 반영 — 화면 선택 연/월(year·month) 기준. 집계 산식 무변경.
     기존 스냅샷이 없는 월에서만 도달(requestClose가 차단) → DELETE 없이 insert만(덮어쓰기 경로 미생성) */
  async function runClose(){
    if(!isOwner)return; // 실행부 이중 확인
    setDialog(null);const label=`${year}년 ${month}월`;
    setClosing(true);setCloseMsg(null);
    try{
      const ym=`${year}-${String(month).padStart(2,'0')}`;
      const mTx=txns.filter(tx=>tx.transaction_date?.startsWith(ym));
      const{data:prevData}=await supabase.from('monthly_snapshots').select('*').eq('snap_year',month===1?year-1:year).eq('snap_month',month===1?12:month-1);
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
        return{drug_code:d.drug_code,snap_year:year,snap_month:month,
          opening_qty:prev.closing_qty||d.current_qty||0,opening_amount:prev.closing_amount||(d.current_qty||0)*(d.purchase_price||0),
          total_in_qty:inQ,total_in_amount:inA,total_out_qty:outQ,total_out_amount:outA,
          total_disp_qty:dispQ,total_ret_qty:retQ,
          closing_qty:d.current_qty||0,closing_amount:(d.current_qty||0)*(d.purchase_price||0)}
      });
      const batch=[];for(let i=0;i<rows.length;i+=500)batch.push(rows.slice(i,i+500));
      for(const b of batch){const{error}=await supabase.from('monthly_snapshots').insert(b);if(error)throw error}
      setCloseMsg(`✅ ${label} 마감 완료! (${rows.length}건)`);loadS()
    }catch(err){setCloseMsg('❌ 오류: '+err.message)}
    setClosing(false)
  }

  /* 연마감 — 로직 미구현. 12개월 월마감 선행 조건 안내만 표시(해당 연도 마감 완료 월 수 N/12) */
  function showAnnualInfo(){
    setDialog({title:'연마감 안내',body:`연마감은 12개월 월마감 완료 후 사용할 수 있습니다.\n현재 ${year}년 마감 완료: ${closedMonthCount}/12개월`});
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
  const tot=filtered.reduce((a,d)=>({oa:a.oa+(d.opening_amount||0),ia:a.ia+(d.total_in_amount||0),oua:a.oua+(d.total_out_amount||0),ca:a.ca+(d.closing_amount||0),dq:a.dq+(d.total_disp_qty||0),rq:a.rq+(d.total_ret_qty||0),oq:a.oq+(d.opening_qty||0),iq:a.iq+(d.total_in_qty||0),ouq:a.ouq+(d.total_out_qty||0),cq:a.cq+(d.closing_qty||0),da:a.da+((d.total_disp_qty||0)*(drugMap[d.drug_code]?.purchase_price||0)),ra:a.ra+((d.total_ret_qty||0)*(drugMap[d.drug_code]?.purchase_price||0))}),{oa:0,ia:0,oua:0,ca:0,dq:0,rq:0,oq:0,iq:0,ouq:0,cq:0,da:0,ra:0});
  /* 구분별 */
  const catSum=CATS.map(cat=>{const items=filtered.filter(d=>d.category===cat);if(!items.length)return null;return{cat,count:items.length,inA:items.reduce((a,d)=>a+(d.total_in_amount||0),0),outA:items.reduce((a,d)=>a+(d.total_out_amount||0),0),closeA:items.reduce((a,d)=>a+(d.closing_amount||0),0)}}).filter(Boolean);
  const inCnt=filtered.filter(d=>(d.total_in_qty||0)>0).length,outCnt=filtered.filter(d=>(d.total_out_qty||0)>0).length,dispCnt=filtered.filter(d=>(d.total_disp_qty||0)>0).length,retCnt=filtered.filter(d=>(d.total_ret_qty||0)>0).length,itemCnt=filtered.filter(d=>(d.closing_qty||0)!==0).length;
  const _pn=new Date(),_pf=x=>{const z=new Date(_pn);z.setDate(z.getDate()+x);return z.toISOString().slice(0,10)},_pt=_pn.toISOString().slice(0,10);
  const _pe=drugs.filter(d=>d.status!=='중지'&&d.expiry_date);
  const expExpired=_pe.filter(d=>d.expiry_date<_pt).length,expU30=_pe.filter(d=>d.expiry_date>=_pt&&d.expiry_date<_pf(30)).length,expW60=_pe.filter(d=>d.expiry_date>=_pf(30)&&d.expiry_date<_pf(60)).length,expC90=_pe.filter(d=>d.expiry_date>=_pf(60)&&d.expiry_date<_pf(90)).length;
  /* ── 연간 월별 추이(이전: 구 AnnualReport). 전체 고정 — cats/stats/검색 미연동(연간 정본). 폐기/반품액=Σ(수량×구입단가). 전월재고[m]=현재고[m-1] 연쇄, 1월=opening_amount. ── */
  const _aWon=v=>'₩'+Math.round(v||0).toLocaleString();const _aNoop=()=>{};const _aEmpty=<span style={{color:t.textL}}>–</span>;
  const _aTd={padding:'8px 12px',textAlign:'right',fontSize:12,color:t.text,borderBottom:`1px solid ${t.border}`};const _aTdM={..._aTd,textAlign:'center',color:t.textM,fontWeight:700};
  const _aCols=[{k:'',h:'월',plain:true,th:{textAlign:'center'}},{k:'',h:'전월재고',plain:true,th:{textAlign:'right'}},{k:'',h:'입고',plain:true,th:{textAlign:'right'}},{k:'',h:'사용',plain:true,th:{textAlign:'right'}},{k:'',h:'폐기',plain:true,th:{textAlign:'right'}},{k:'',h:'반품',plain:true,th:{textAlign:'right'}},{k:'',h:'현재고',plain:true,th:{textAlign:'right'}}];
  const annM=[];{let pc=null;for(let m=1;m<=12;m++){const rs=snaps.filter(s=>s.snap_month===m);const has=rs.length>0;const inA=rs.reduce((a,s)=>a+(s.total_in_amount||0),0);const outA=rs.reduce((a,s)=>a+(s.total_out_amount||0),0);const dispA=rs.reduce((a,s)=>a+(s.total_disp_qty||0)*(drugMap[s.drug_code]?.purchase_price||0),0);const retA=rs.reduce((a,s)=>a+(s.total_ret_qty||0)*(drugMap[s.drug_code]?.purchase_price||0),0);const closeA=rs.reduce((a,s)=>a+(s.closing_amount||0),0);const openA=rs.reduce((a,s)=>a+(s.opening_amount||0),0);const prevA=has?(pc!=null?pc:openA):null;annM.push({m,has,prevA,inA,outA,dispA,retA,closeA});if(has)pc=closeA}}
  const _aData=annM.filter(r=>r.has);const annSum={inA:_aData.reduce((a,r)=>a+r.inA,0),outA:_aData.reduce((a,r)=>a+r.outA,0),dispA:_aData.reduce((a,r)=>a+r.dispA,0),retA:_aData.reduce((a,r)=>a+r.retA,0),prevA:_aData.length?_aData[0].prevA:0,closeA:_aData.length?_aData[_aData.length-1].closeA:0};
  /* ── 연간 분석 차트 데이터(전체 고정, 추가 fetch 없음). 사용=출고액 / 손실=폐기+반품 파생액(수량×구입단가). 구분 색상=구분별 현황 팔레트 재사용. ── */
  const _catColor=n=>({'경구제':'#804A87','주사제':'#019748','외용제':'#2E4A62','수액제':'#92C8E0','영양제':'#A8CF5C','의약외품':'#F39E94'}[n]||t.textL);
  const _won2=v=>{v=Math.round(v||0);return v>=1e8?(v/1e8).toFixed(1)+'억':v>=1e4?Math.round(v/1e4).toLocaleString()+'만':v.toLocaleString()};
  const _useAgg={},_lossAgg={};snaps.forEach(s=>{const c=drugMap[s.drug_code]?.category||'미분류';const pp=drugMap[s.drug_code]?.purchase_price||0;_useAgg[c]=(_useAgg[c]||0)+(s.total_out_amount||0);_lossAgg[c]=(_lossAgg[c]||0)+((s.total_disp_qty||0)+(s.total_ret_qty||0))*pp});
  const _useData=Object.entries(_useAgg).map(([name,count])=>({name,count})).filter(d=>d.count>0).sort((a,b)=>b.count-a.count);const _useTot=_useData.reduce((a,d)=>a+d.count,0);
  const _lossData=Object.entries(_lossAgg).map(([name,count])=>({name,count})).filter(d=>d.count>0).sort((a,b)=>b.count-a.count);const _lossTot=_lossData.reduce((a,d)=>a+d.count,0);
  const _barMax=Math.max(1,...annM.map(r=>Math.max(r.inA,r.outA)));

  function dl(){
    const wb=XLSX.utils.book_new();const sn=rtype==='monthly'?`${year}년${month}월보고서`:`${year}년연간보고서`;
    const sum=[['씨엔씨재활의학과병원 약품관리 월간보고서'],['보고월',`${year}년 ${rtype==='monthly'?month+'월':'연간'}`],[],
      ['[재고 현황]'],['관리 품목수',itemCnt],['현재고',Math.round(tot.ca)],['전월재고',Math.round(tot.oa)],['증감',Math.round(tot.ca-tot.oa)],[],
      ['[입출고 현황]','건수','금액'],['입고',inCnt,Math.round(tot.ia)],['출고',outCnt,Math.round(tot.oua)],['순입고',inCnt-outCnt,Math.round(tot.ia-tot.oua)],[],
      ['[손실 현황]','건수','금액'],['폐기',dispCnt,Math.round(tot.da)],['반품',retCnt,Math.round(tot.ra)],[],
      ['[유효기간 관리]'],['만료',expExpired],['긴급(30일)',expU30],['주의(60일)',expW60],['확인(90일)',expC90],[],
      [nowStamp()],['Copyright © 2026 Jeonghwa Lee. All rights reserved.']];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sum),'요약');
    const list=filtered.map(d=>({약품코드:d.drug_code,약품명:d.drug_name,구분:d.category,전월재고수:d.opening_qty,전월재고금액:d.opening_amount,입고수량:d.total_in_qty,입고금액:d.total_in_amount,출고수량:d.total_out_qty,출고금액:d.total_out_amount,폐기수량:d.total_disp_qty,반품수량:d.total_ret_qty,기말재고수:d.closing_qty,기말재고금액:d.closing_amount}));
    const HDR=['약품코드','약품명','구분','전월재고수','전월재고금액','입고수량','입고금액','출고수량','출고금액','폐기수량','반품수량','기말재고수','기말재고금액'];
    const ws=list.length?XLSX.utils.json_to_sheet(list):XLSX.utils.aoa_to_sheet([HDR]);
    XLSX.utils.book_append_sheet(wb,ws,'약품목록');XLSX.writeFile(wb,`${sn}.xlsx`)
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
      {isOwner&&rtype==='monthly'&&<button onClick={()=>setUploadOpen(true)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.accent}`,background:t.accentL,color:t.accent,cursor:'pointer',fontSize:11,fontWeight:600}}>스냅샷 업로드</button>}
      <button onClick={()=>window.print()} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.blue}`,background:t.blueL,color:t.blue,cursor:'pointer',fontSize:11,fontWeight:600}}>인쇄</button>
      {isOwner&&(rtype==='monthly'
        ? <button onClick={requestClose} disabled={closing||isFuture||monthClosed} title={monthClosed?'이미 스냅샷이 있어 재마감이 제한됩니다':isFuture?'미래 월은 마감할 수 없습니다':undefined} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.amber}`,background:t.amberL,color:t.amber,cursor:(closing||isFuture||monthClosed)?'not-allowed':'pointer',opacity:(closing||isFuture||monthClosed)?0.5:1,fontSize:11,fontWeight:700}}>{closing?'마감 중...':(monthClosed?'📋 마감됨':'📋 월마감')}</button>
        : <button onClick={showAnnualInfo} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${t.amber}`,background:t.amberL,color:t.amber,cursor:'pointer',fontSize:11,fontWeight:700}}>📅 연마감</button>)}
    </div>
    {closeMsg&&<div style={{background:closeMsg.includes('✅')?t.greenL:t.redL,border:`1px solid ${closeMsg.includes('✅')?t.green:t.red}`,borderRadius:8,padding:'10px 14px',marginBottom:10,color:closeMsg.includes('✅')?t.green:t.red,fontSize:12,fontWeight:600}}>{closeMsg}</div>}

    {/* 앱 내 확인/안내 모달(alert·confirm 대체) — 기존 DrugDeleteConfirm 스타일 재사용 */}
    {dialog&&<div onClick={()=>setDialog(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:t.cardSolid,borderRadius:14,padding:'22px 26px',maxWidth:420,width:'100%',border:`1px solid ${t.border}`,boxShadow:t.shadowH}}>
        <div style={{fontSize:14,fontWeight:700,color:t.text,marginBottom:10}}>{dialog.title}</div>
        <div style={{fontSize:12,color:t.textM,lineHeight:1.6,whiteSpace:'pre-line',marginBottom:18}}>{dialog.body}</div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          {dialog.onConfirm&&<button onClick={()=>setDialog(null)} style={{padding:'8px 16px',borderRadius:8,border:`1px solid ${t.border}`,background:'transparent',color:t.textM,cursor:'pointer',fontSize:12,fontWeight:700}}>취소</button>}
          <button onClick={()=>{const fn=dialog.onConfirm;if(fn)fn();else setDialog(null)}} style={{padding:'8px 16px',borderRadius:8,border:`1px solid ${t.accent}`,background:t.accent,color:'#fff',cursor:'pointer',fontSize:12,fontWeight:700}}>{dialog.confirmLabel||'확인'}</button>
        </div>
      </div>
    </div>}
    {uploadOpen&&<SnapshotUploadModal t={t} isOwner={isOwner} onClose={()=>setUploadOpen(false)} onReload={loadS} />}

    {rtype==='annual'&&<div className="cnc-annual-print" style={{marginBottom:14}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:12}}>
        <KpiCard label="입고액" value={_aWon(annSum.inA)} color={t.accent} />
        <KpiCard label="사용액" value={_aWon(annSum.outA)} color={t.blue} />
        <KpiCard label="폐기액" value={_aWon(annSum.dispA)} color={t.red} sub="수량×구입단가" />
        <KpiCard label="반품액" value={_aWon(annSum.retA)} color={t.amber} sub="수량×구입단가" />
        <KpiCard label="현재고액" value={_aWon(annSum.closeA)} color={t.green} sub="최근 마감월" />
      </div>
      <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden'}}>
        <div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:13,color:t.accent}}>{year}년 월별 집계 <span style={{fontSize:11,fontWeight:500,color:t.textM}}>(폐기·반품액 = 수량×구입단가 파생)</span></div>
        <StandardTable t={t} TS={_aNoop} sk="" sd="" setSort={_aNoop} hf={{}} hscroll={{noLabel:true,ends:true}} cols={_aCols}>
          <tbody>
            {annM.map(r=><tr key={r.m} style={{background:r.has?'':t.bg}} onMouseEnter={e=>{if(r.has)e.currentTarget.style.background=t.glass}} onMouseLeave={e=>{if(r.has)e.currentTarget.style.background=''}}>
              <td style={_aTdM}>{r.m}월</td>
              <td style={_aTd}>{r.has?_aWon(r.prevA):_aEmpty}</td>
              <td style={_aTd}>{r.has?_aWon(r.inA):_aEmpty}</td>
              <td style={_aTd}>{r.has?_aWon(r.outA):_aEmpty}</td>
              <td style={_aTd}>{r.has?_aWon(r.dispA):_aEmpty}</td>
              <td style={_aTd}>{r.has?_aWon(r.retA):_aEmpty}</td>
              <td style={{..._aTd,fontWeight:700}}>{r.has?_aWon(r.closeA):_aEmpty}</td>
            </tr>)}
            <tr style={{background:t.accentL,fontWeight:800}}>
              <td style={{..._aTdM,color:t.accent}}>합계</td>
              <td style={{..._aTd,fontWeight:800}}>{_aWon(annSum.prevA)}</td>
              <td style={{..._aTd,fontWeight:800}}>{_aWon(annSum.inA)}</td>
              <td style={{..._aTd,fontWeight:800}}>{_aWon(annSum.outA)}</td>
              <td style={{..._aTd,fontWeight:800}}>{_aWon(annSum.dispA)}</td>
              <td style={{..._aTd,fontWeight:800}}>{_aWon(annSum.retA)}</td>
              <td style={{..._aTd,fontWeight:800,color:t.accent}}>{_aWon(annSum.closeA)}</td>
            </tr>
          </tbody>
        </StandardTable>
      </div>
      <div style={{marginTop:10,fontSize:11,color:t.textL,lineHeight:1.7}}>※ 연 KPI·합계는 <b style={{color:t.textM}}>데이터 존재 월({_aData.length}개월) 기준</b> 합계입니다(연 전체 아님).<br />※ 폐기·반품액은 <b style={{color:t.textM}}>현재 구입단가(purchase_price) 기준 파생</b>(수량×단가)이라, 과거월 실제 폐기·반품액과 단가 시점 차가 있을 수 있습니다.</div>
      <style>{'@media print{.cnc-annual-print{display:block!important;page-break-inside:avoid}.cnc-print-month.cnc-hide-print{display:none!important}.cnc-report-table.cnc-hide-print{display:none!important}.cnc-annual-print table{font-size:11px!important}.cnc-annual-print th,.cnc-annual-print td{padding:6px 10px!important}.cnc-annual-print tr{page-break-inside:avoid}}'}</style>
    </div>}

    {rtype==='annual'&&<div className="no-print" style={{marginBottom:14}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:10}}>약품군별 사용 비중 <span style={{fontSize:11,fontWeight:500,color:t.textL}}>· 사용액(출고) 기준</span></div>
          {_useData.length?<div style={{display:'flex',gap:14,alignItems:'center'}}>
            <NDonut data={_useData} total={_useTot} onSlice={()=>{}} centerTop={_won2(_useTot)} centerBot="사용액" t={t} colorOf={n=>_catColor(n)}/>
            <div style={{flex:1,display:'grid',gap:3,minWidth:0}}>{_useData.map(d=><div key={d.name} style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:9,height:9,borderRadius:3,background:_catColor(d.name),flexShrink:0}}/><span style={{fontSize:11,color:t.textM,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}</span><span style={{fontSize:11,fontWeight:700,color:t.text}}>{_won2(d.count)}</span><span style={{fontSize:10,color:t.textL,width:38,textAlign:'right'}}>{Math.round(d.count/_useTot*100)}%</span></div>)}</div>
          </div>:<div style={{padding:24,textAlign:'center',color:t.textL,fontSize:12}}>데이터 없음</div>}
        </div>
        <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'14px 16px'}}>
          <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:10}}>손실 분석 <span style={{fontSize:11,fontWeight:500,color:t.textL}}>· 폐기+반품(수량×구입단가)</span></div>
          {_lossData.length?<div style={{display:'flex',gap:14,alignItems:'center'}}>
            <NDonut data={_lossData} total={_lossTot} onSlice={()=>{}} centerTop={_won2(_lossTot)} centerBot="손실액" t={t} colorOf={n=>_catColor(n)}/>
            <div style={{flex:1,display:'grid',gap:3,minWidth:0}}>{_lossData.map(d=><div key={d.name} style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:9,height:9,borderRadius:3,background:_catColor(d.name),flexShrink:0}}/><span style={{fontSize:11,color:t.textM,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}</span><span style={{fontSize:11,fontWeight:700,color:t.text}}>{_won2(d.count)}</span><span style={{fontSize:10,color:t.textL,width:38,textAlign:'right'}}>{Math.round(d.count/_lossTot*100)}%</span></div>)}</div>
          </div>:<div style={{padding:24,textAlign:'center',color:t.textL,fontSize:12}}>손실 없음</div>}
        </div>
      </div>
      <div style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,padding:'14px 16px'}}>
        <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:8,display:'flex',alignItems:'center',gap:12}}>월별 추이 <span style={{fontSize:11,fontWeight:500,color:t.textL}}>· 입고/사용액</span><span style={{marginLeft:'auto',display:'flex',gap:12,fontSize:10,color:t.textM}}><span><span style={{display:'inline-block',width:9,height:9,borderRadius:2,background:t.accent,marginRight:4,verticalAlign:'middle'}}/>입고</span><span><span style={{display:'inline-block',width:9,height:9,borderRadius:2,background:t.blue,marginRight:4,verticalAlign:'middle'}}/>사용</span></span></div>
        <svg viewBox="0 0 720 210" style={{width:'100%',height:200}} preserveAspectRatio="xMidYMid meet">
          {[0,0.25,0.5,0.75,1].map((g,i)=><line key={i} x1={40} y1={180-g*150} x2={712} y2={180-g*150} stroke={t.border} strokeWidth="1"/>)}
          {annM.map((r,i)=>{const bw=14,gap=56,x=52+i*gap,ih=r.inA/_barMax*150,oh=r.outA/_barMax*150;return <g key={r.m}><rect x={x} y={180-ih} width={bw} height={ih} fill={t.accent} rx="2"><title>{r.m+'월 입고 '+_won2(r.inA)}</title></rect><rect x={x+bw+3} y={180-oh} width={bw} height={oh} fill={t.blue} rx="2"><title>{r.m+'월 사용 '+_won2(r.outA)}</title></rect><text x={x+bw+1} y={196} textAnchor="middle" style={{fontSize:10,fill:t.textM}}>{r.m}</text></g>})}
          <text x={36} y={184} textAnchor="end" style={{fontSize:9,fill:t.textL}}>0</text><text x={36} y={34} textAnchor="end" style={{fontSize:9,fill:t.textL}}>{_won2(_barMax)}</text>
        </svg>
      </div>
    </div>}

      <div className={"cnc-print-month"+(rtype==='annual'?' cnc-hide-print':'')} style={{color:'#222',background:'#fff',fontSize:13,lineHeight:1.4}}>
        <div style={{background:'#804A87',color:'#fff',padding:'12px 16px',textAlign:'center',fontSize:19,fontWeight:800}}>🏥 씨엔씨재활의학과병원 약품관리 월간보고서</div>
        <div style={{textAlign:'center',color:'#804A87',fontWeight:700,margin:'8px 0 14px'}}>▶ 보고월: {year}년 {rtype==='monthly'?month+'월':'연간'}</div>
        <MSec title="■ 재고 현황">
          <MRow label="관리 품목수" bg="#e3f0e3" value={itemCnt.toLocaleString()+'개'} />
          <MRow label="현재고" bg="#e3f0e3" value={'₩'+Math.round(tot.ca).toLocaleString()} />
          <MRow label="전월재고" bg="#e3f0e3" value={'₩'+Math.round(tot.oa).toLocaleString()} />
          <MRow label="증감" bg="#e3f0e3" value={'₩'+Math.round(tot.ca-tot.oa).toLocaleString()} />
        </MSec>
        <MSec title="■ 입출고 현황">
          <MRow2 label="입고" bg="#ece4f1" cnt={inCnt+'건'} amt={'₩'+Math.round(tot.ia).toLocaleString()} />
          <MRow2 label="출고" bg="#f1e4ee" cnt={outCnt+'건'} amt={'₩'+Math.round(tot.oua).toLocaleString()} />
          <MRow2 label="순입고" bg="#ececec" cnt={(inCnt-outCnt)+'건'} amt={'₩'+Math.round(tot.ia-tot.oua).toLocaleString()} />
        </MSec>
        <MSec title="■ 손실 현황">
          <MRow2 label="폐기" bg="#f6dede" cnt={dispCnt+'건'} amt={'₩'+Math.round(tot.da).toLocaleString()} />
          <MRow2 label="반품" bg="#f7f3d6" cnt={retCnt+'건'} amt={'₩'+Math.round(tot.ra).toLocaleString()} />
          <MRow2 label="손실(단순합)" bg="#804A87" fg="#fff" cnt={(dispCnt+retCnt)+'건'} amt={'₩'+Math.round(tot.da+tot.ra).toLocaleString()} />
        </MSec>
        <MSec title="■ 유효기간 관리">
          <MRow label="★ 만료" bg="#f6dede" value={expExpired+'건'} />
          <MRow label="▲ 긴급 (30일)" bg="#fce6cf" value={expU30+'건'} />
          <MRow label="◆ 주의 (60일)" bg="#f7f3d6" value={expW60+'건'} />
          <MRow label="● 확인 (90일)" bg="#e3f0e3" value={expC90+'건'} />
        </MSec>
        <div style={{textAlign:'center',color:'#999',fontSize:11,marginTop:22}}>
          <div>{nowStamp()}</div>
          <div>Copyright © 2026 Jeonghwa Lee. All rights reserved.</div>
        </div>
      </div>
      <style>{'.cnc-print-month{display:none}@media print{.cnc-rpt-hide{display:none!important}.cnc-print-month{display:block!important;page-break-after:always;max-width:680px;margin:0 auto}.cnc-print-month table{font-size:12.5px!important}.cnc-print-month td,.cnc-print-month th{padding:6px 10px!important;font-size:12.5px!important}.cnc-report-table table{font-size:9px!important}}'}</style>
    {/* 요약 카드 — 연간 탭에서는 연 KPI 5장과 지표가 중복되어 숨김(월간 전용) */}
    {rtype==='monthly'&&<div className="cnc-rpt-hide" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
      {[{l:'전월재고',v:tot.oa,c:t.purple,nav:'stock'},{l:'입고 금액',v:tot.ia,c:t.green,nav:'transaction'},{l:'출고 금액',v:tot.oua,c:t.blue,nav:'transaction'},{l:'폐기',v:tot.dq,sub:tot.da,cnt:dispCnt,c:t.red,nav:'transaction'},{l:'반품',v:tot.rq,sub:tot.ra,cnt:retCnt,c:t.amber,nav:'transaction'},{l:'기말재고',v:tot.ca,c:t.accent,nav:'stock'}].map((x,i)=><div key={i} onClick={()=>onNav?.({menu:x.nav})} style={{background:t.card,borderRadius:12,padding:'14px 18px',border:`1px solid ${t.border}`,cursor:'pointer',transition:'all .15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=x.c;e.currentTarget.style.transform='translateY(-1px)'}} onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;e.currentTarget.style.transform=''}}>
        <div style={{fontSize:10,color:t.textM}}>{x.l}</div>
        {x.sub!==undefined?<>
          <div style={{fontSize:20,fontWeight:700,color:x.c,marginTop:4,whiteSpace:'nowrap'}}>{x.cnt} <span style={{fontSize:17}}>({x.v})</span></div>
          <div style={{fontSize:12,color:x.c,marginTop:2}}>₩{x.sub.toLocaleString()}</div>
        </>:<div style={{fontSize:20,fontWeight:700,color:x.c,marginTop:4}}>{typeof x.v==='number'?'₩'+x.v.toLocaleString():x.v}</div>}
      </div>)}
    </div>}

    {/* 구분별 현황 */}
    {catSum.length>0&&<div className="cnc-rpt-hide" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden',marginBottom:12}}>
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

    {/* 상세 테이블 — 연간 탭 미표시(월간 전용) */}
    {rtype==='monthly'&&<div className="cnc-report-table" style={{background:t.card,borderRadius:12,border:`1px solid ${t.border}`,overflow:'hidden'}}>
      <div style={{padding:'12px 18px',borderBottom:`1px solid ${t.border}`,fontWeight:700,fontSize:13,color:t.accent}}>{rtype==='monthly'?`${year}년 ${month}월`:`${year}년 연간`} 보고서 ({filtered.length}건){monthClosed?<span style={{marginLeft:8,fontSize:11,fontWeight:600,color:t.green}}>· 스냅샷 있음({snapCount.toLocaleString()}행)</span>:null} {ld&&<span style={{fontSize:11,color:t.textL}}>로딩...</span>}</div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead><tr>{[['drug_code','약품코드'],['drug_name','약품명'],['category','구분'],['opening_qty','전월재고'],['total_in_qty','입고'],['total_out_qty','출고'],['total_disp_qty','폐기'],['total_ret_qty','반품'],['closing_qty','기말재고'],['closing_amount','기말금액']].map(([k,h])=><th key={k} style={{ ...TS(k), background: t.bg, fontWeight: 700 }} onClick={()=>hs(k)}>{h}<SI col={k}/></th>)}</tr></thead>
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
    </div>}<Ft/>
  </div>
}

/* ═══ 성공 토스트 (공용) ═══ */
/* ═══ 연간보고서 ①단계 — 연 KPI + 월별 12행 (monthly_snapshots 집계, 폐기/반품액=수량×구입단가 파생) ═══ */
function KpiCard({ label, value, color, sub }) {
  const { t } = useTheme();
  return <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '14px 16px' }}>
    <div style={{ fontSize: 12, color: color || t.textM, fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: color || t.text, marginTop: 6, whiteSpace: 'nowrap' }}>{value}</div>
    {sub ? <div style={{ fontSize: 10, color: t.textL, marginTop: 2 }}>{sub}</div> : null}
  </div>;
}
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
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState(null)
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

  async function handleChangePw() {
    setPwMsg(null)
    if (newPw.length < 6) { setPwMsg('비밀번호는 6자 이상이어야 합니다'); return }
    if (newPw !== newPw2) { setPwMsg('비밀번호가 일치하지 않습니다'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwSaving(false)
    if (error) { setPwMsg(error.message); return }
    setNewPw(''); setNewPw2('')
    setPwMsg('✅ 비밀번호가 변경되었습니다')
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

    {/* 비밀번호 변경 */}
    {isEmailUser ? (
      <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 4 }}>비밀번호 변경</div>
        <div style={{ fontSize: 11, color: t.textL, marginBottom: 14 }}>임시 비밀번호를 받으셨다면 여기서 정식 비밀번호로 바꿔 주세요.</div>
        {pwMsg && <div style={{ background: pwMsg.startsWith('✅') ? t.greenL : t.redL, color: pwMsg.startsWith('✅') ? t.green : t.red, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12, fontWeight: 500 }}>{pwMsg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lb}>새 비밀번호</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="6자 이상" style={ip} autoComplete="new-password" />
          </div>
          <div>
            <label style={lb}>새 비밀번호 확인</label>
            <input type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)} placeholder="6자 이상" style={ip} autoComplete="new-password" onKeyDown={e => e.key === 'Enter' && handleChangePw()} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={handleChangePw} disabled={pwSaving} style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: pwSaving ? t.textL : t.accent, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: pwSaving ? 'not-allowed' : 'pointer' }}>{pwSaving ? '변경 중...' : '비밀번호 변경'}</button>
        </div>
      </div>
    ) : (
      <div style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, padding: '16px 20px', fontSize: 12, color: t.textM, lineHeight: 1.6, marginBottom: 16 }}>
        소셜 로그인 계정은 별도 비밀번호가 없습니다. 가입하신 카카오·네이버 등에서 비밀번호를 관리해 주세요.
      </div>
    )}

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
  const { t, user } = useTheme()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [errMsg, setErrMsg] = useState(null)
  const [editRow, setEditRow] = useState(null) /* 수정 모달용 — null이면 닫힘 */
  const [toast, setToast] = useState(null)
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
              <th style={{ ...TS('actions'), cursor: 'default', textAlign: 'center', width: 80 }}>수정</th>
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
              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                <button
                  onClick={() => setEditRow(r)}
                  style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${t.border}`, background: 'transparent', color: t.textM, cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'all .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.color = t.accent }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.textM }}
                >수정</button>
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
    <Toast msg={toast?.msg} kind={toast?.kind} onClose={() => setToast(null)} />
    {editRow && <AdminUserEditModal
      row={editRow}
      currentUserId={user?.id}
      onClose={() => setEditRow(null)}
      onSaved={() => { setEditRow(null); setToast({ msg: '권한이 변경되었습니다', kind: 'ok' }); load() }}
    />}
    <Ft />
  </div>
}

/* ═══ 관리자 — 사용자 권한 수정 모달 (role 변경 전용) ═══ */
function AdminUserEditModal({ row, currentUserId, onClose, onSaved }) {
  const { t } = useTheme()
  const [role, setRole] = useState(row.role || 'user')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState(null)

  const isSelf = currentUserId && row.id === currentUserId
  const isOriginallyAdmin = row.role === 'admin'
  const wantsToRemoveOwnAdmin = isSelf && isOriginallyAdmin && role !== 'admin'  /* 본인 admin 해제 시도 */
  const isUnchanged = role === (row.role || 'user')
  const canSubmit = !isUnchanged && !wantsToRemoveOwnAdmin && !saving

  async function handleSave() {
    if (!canSubmit) return
    setSaving(true); setErrMsg(null)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', row.id)
    setSaving(false)
    if (error) { setErrMsg(error.message.includes('row-level') ? 'DB 권한 정책이 아직 적용되지 않았습니다. SQL 마이그레이션(0005)을 먼저 실행해 주세요.' : error.message); return }
    onSaved?.()
  }

  const lb = { fontSize: 11, color: t.textM, display: 'block', marginBottom: 6, fontWeight: 600 }
  const roleBtn = (val, color, colorL, label) => {
    const active = role === val
    const disabled = isSelf && val === 'user' && isOriginallyAdmin  /* 본인 admin 해제 비활성 */
    return <button
      onClick={() => !disabled && setRole(val)}
      disabled={disabled}
      style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1.5px solid ${active ? color : t.border}`, background: active ? colorL : 'transparent', color: active ? color : (disabled ? t.textL : t.textM), fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all .15s', opacity: disabled ? 0.5 : 1 }}
    >{label}</button>
  }

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 16, padding: '22px 26px', maxWidth: 420, width: '100%', border: `1px solid ${t.border}`, boxShadow: t.shadowH }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 4 }}>사용자 권한 수정</div>
      <div style={{ fontSize: 11, color: t.textL, marginBottom: 18 }}>
        {row.email}{row.full_name ? ` · ${row.full_name}` : ''}
        {isSelf && <span style={{ marginLeft: 6, background: t.accentL, color: t.accent, padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>본인</span>}
      </div>

      {errMsg && <div style={{ background: t.redL, color: t.red, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, fontWeight: 500 }}>{errMsg}</div>}

      <label style={lb}>권한</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {roleBtn('admin', t.purple, t.purpleL, '관리자')}
        {roleBtn('user',  t.green,  t.greenL,  '일반')}
      </div>

      {wantsToRemoveOwnAdmin && <div style={{ background: t.amberL, border: `1px solid ${t.amber}40`, borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: t.text, lineHeight: 1.55, marginBottom: 8, marginTop: 6 }}>
        ⚠️ 본인의 관리자 권한은 직접 해제할 수 없습니다. 다른 관리자가 변경해야 합니다.
      </div>}
      {isSelf && isOriginallyAdmin && !wantsToRemoveOwnAdmin && <div style={{ fontSize: 11, color: t.textL, marginTop: 6, marginBottom: 8 }}>
        본인 계정은 잠금 방지를 위해 '일반'으로 변경할 수 없습니다.
      </div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onClose} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${t.border}`, background: 'transparent', color: t.textM, fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>취소</button>
        <button onClick={handleSave} disabled={!canSubmit} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: canSubmit ? t.accent : t.textL, color: '#fff', fontSize: 12, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'background .15s' }}>{saving ? '저장 중...' : '저장'}</button>
      </div>
    </div>
  </div>
}

/* ═══ 로그인 페이지 ═══ */
function LoginPage() {
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setLoading(false)
    if (error) { setMsg(error.message); return }
    setMsg('✅ 비밀번호 재설정 링크를 이메일로 보냈습니다')
  }
  async function handleKakao() {
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: window.location.origin, scopes: 'profile_nickname account_email' },
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

/* ═══ 비밀번호 재설정(복구) 페이지 — 이메일 링크 클릭 시 노출 ═══ */
function RecoveryPage({ onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const t = themes.light
  async function handleUpdate() {
    if (pw.length < 6) { setMsg('비밀번호는 6자 이상이어야 합니다'); return }
    if (pw !== pw2) { setMsg('비밀번호가 일치하지 않습니다'); return }
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setLoading(false)
    if (error) { setMsg(error.message); return }
    setMsg('✅ 비밀번호가 변경되었습니다. 잠시 후 이동합니다…')
    setTimeout(() => onDone?.(), 1000)
  }
  const ip = { width: '100%', padding: '12px 16px', border: `1.5px solid ${t.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff', color: t.text }
  return <div style={{ minHeight: '100vh', background: `linear-gradient(135deg, ${t.nav} 0%, #804A87 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap');*{font-family:'Roboto','Apple SD Gothic Neo',sans-serif;}`}</style>
    <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 400, padding: '40px 36px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg, #804A87, #019748)`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24, fontWeight: 700, color: '#fff' }}>+</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.nav }}>새 비밀번호 설정</div>
        <div style={{ fontSize: 12, color: t.textL, marginTop: 4 }}>사용할 새 비밀번호를 입력해 주세요</div>
      </div>
      {msg && <div style={{ background: msg.startsWith('✅') ? t.greenL : t.redL, borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: msg.startsWith('✅') ? t.green : t.red, fontSize: 13, fontWeight: 500 }}>{msg}</div>}
      <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 4, fontWeight: 500 }}>새 비밀번호</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="6자 이상" style={ip} autoComplete="new-password" /></div>
      <div style={{ marginBottom: 18 }}><label style={{ fontSize: 11, color: t.textM, display: 'block', marginBottom: 4, fontWeight: 500 }}>새 비밀번호 확인</label><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="6자 이상" style={ip} autoComplete="new-password" onKeyDown={e => e.key === 'Enter' && handleUpdate()} /></div>
      <button onClick={handleUpdate} disabled={loading} style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: loading ? t.textL : `linear-gradient(135deg, #804A87, #019748)`, color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>{loading ? '처리 중...' : '비밀번호 변경'}</button>
    </div>
  </div>
}

/* ═══ 메인 App ═══ */
/* SPA 라우트: 화면 식별자 ↔ URL 해시(#menu). 새로고침/직접진입 복원·뒤로가기 동기화와 일관. */
const ROUTES = ['dashboard', 'alerts', 'druglist', 'expiry', 'stock', 'narcotic', 'nonins', 'ordering', 'transaction', 'report', 'emergency', 'register', 'mypage', 'admin', 'archive'];
function routeFromHash() { const h = (window.location.hash || '').replace(/^#\/?/, ''); return ROUTES.includes(h) ? h : 'dashboard'; }
export default function App() {
  const [dark, setDark] = useState(false)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [memberRole, setMemberRole] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)
  const [menu, setMenu] = useState(routeFromHash)
  const [drugs, setDrugs] = useState([])
  const [inv, setInv] = useState([])
  const [txns, setTxns] = useState([])
  const [nf, setNf] = useState(null)
  const [editDrug, setEditDrug] = useState(null)
  const [adjustDrug, setAdjustDrug] = useState(null)
  const [lotDrug, setLotDrug] = useState(null)
  const [d360, setD360] = useState(null)
  const [d360Pos, setD360Pos] = useState({ x: 0, y: 0 }) // 360° 모달 위치(세션 내 유지, 새로고침 시 중앙 복귀)
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const isPopRef = useRef(false); const isFirstRef = useRef(true)

  const t = dark ? themes.dark : themes.light
  const themeVal = { t, open360: setD360, openSearch: () => setSearchOpen(true), navTo: handleNav, dark, toggle: () => setDark(d => !d), user, profile, setProfile, memberRole, logout: async () => { await supabase.auth.signOut(); setUser(null); setProfile(null); setMemberRole(null); setMenu('dashboard') } }

  /* 인증 상태 확인 */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user || null); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'PASSWORD_RECOVERY') setRecovery(true)
      setUser(session?.user || null)
    })
    return () => subscription.unsubscribe()
  }, [])

  /* SPA 뒤로가기: menu 전환을 브라우저 히스토리에 동기화(라우터 미도입·최소 침습).
     popstate→직전 약플로 화면 복원. URL 미변경(새로고침=대시보드, 기존 동작 유지). */
  useEffect(() => {
    const raw = (window.location.hash || '') + (window.location.search || '')
    if (!/access_token|refresh_token|provider_token|type=recovery|[?&]code=|error=/.test(raw)) { const init = routeFromHash(); window.history.replaceState({ ykMenu: init }, '', '#' + init) }
    function onPop(e) { isPopRef.current = true; setMenu((e.state && e.state.ykMenu) || routeFromHash()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (isFirstRef.current) { isFirstRef.current = false; return }
    if (isPopRef.current) { isPopRef.current = false; return }
    window.history.pushState({ ykMenu: menu }, '', '#' + menu)
  }, [menu])

  /* 비보험 메뉴 진입 시 이전 화면의 필터 잔재(nf) 정리 — 비보험 기본값은 DrugList의 nonins prop이 담당(공유 nf 오염으로 약품목록에 비보험이 새던 문제 방지) */
  useEffect(() => { if (menu === 'nonins') setNf(null) }, [menu])

  /* 프로필 로드 (profiles 테이블이 아직 없을 수도 있으므로 silent fail) */
  async function loadProfile() {
    if (!user) { setProfile(null); return }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (error) { setProfile(null); return }
    setProfile(data)
  }
  useEffect(() => { loadProfile() }, [user])

  /* 테넌트 멤버십 role 로드 — tenant_members 테이블이 아직 없거나 매핑 미존재 시 silent fail
     (앱은 정상 동작하되 관리자 전용 UI만 숨겨짐) */
  async function loadMemberRole() {
    if (!user) { setMemberRole(null); return }
    const { data, error } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    if (error || !data) { setMemberRole(null); return }
    setMemberRole(data.role)
  }
  useEffect(() => { loadMemberRole() }, [user])

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
  useEffect(() => { function onK(e) { if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setSearchOpen(true) } } window.addEventListener('keydown', onK); return () => window.removeEventListener('keydown', onK) }, [])
  /* Realtime: 거래/재고/약품 변경 즉시 반영(디바운스 — 대량 커밋 깜빡임·부하 방지). 구독 RLS 경유·cleanup */
  useEffect(() => {
    if (!user) return
    let timer
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => load(), 400) }
    const ch = supabase.channel('rt-yakflo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drugs' }, bump)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(ch) }
  }, [user])

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

  /* 비밀번호 재설정 링크 진입 → 새 비밀번호 설정 화면 (로그인 여부보다 우선) */
  if (recovery) return <RecoveryPage onDone={() => setRecovery(false)} />

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
        html { scrollbar-gutter: stable; }
        .cnc-legend-scroll { scrollbar-width: thin; scrollbar-color: #D7D7D7 transparent; }
        .cnc-legend-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .cnc-legend-scroll::-webkit-scrollbar-thumb { background: #D7D7D7; border-radius: 4px; }
        .cnc-legend-scroll::-webkit-scrollbar-track { background: transparent; }
        input, select, textarea, button { font-family: inherit; }
        /* ═══ 브랜드 영역 (로고 + 타이틀 + 부제) — 글씨 깨짐 방지 ═══ */
        .brand-area { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .brand-logo { flex-shrink: 0; }
        .brand-title { font-weight: 700; white-space: nowrap; color: #804A87; }
        .brand-sub   { font-size: 12px; color: #5b6776; }
        @media print {
          @page { size: landscape; margin: 8mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          table { font-size: 9px !important; }
          th, td { padding: 4px 6px !important; }
        }
        /* ═══ 알림 전광판(marquee+pulse) — 접근성: 점멸<3Hz, reduced-motion 정지 ═══ */
        @keyframes cncMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes cncPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
        .cnc-marquee-track { animation: cncMarquee 22s linear infinite; }
        .cnc-alert-banner { animation: cncPulse 2.6s ease-in-out infinite; }
        .cnc-alert-banner:hover .cnc-marquee-track { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .cnc-marquee-track { animation: none !important; transform: none !important; }
          .cnc-alert-banner { animation: none !important; }
        }
        /* ═══ 반응형: 태블릿 (≤1024px) — PC 메뉴 유지, gap만 축소 ═══ */
        @media (max-width: 1024px) {
          .cnc-nav-desktop { gap: 1px !important; }
          .cnc-nav-desktop button { padding: 6px 8px !important; font-size: 11px !important; }
        }
        /* ═══ 반응형: 모바일 (≤768px) — PC와 동일 UI, 메뉴는 가로 스크롤 ═══ */
        @media (max-width: 768px) {
          /* 메뉴는 숨기지 않고 가로 스크롤로 모두 노출 */
          .cnc-nav-desktop {
            justify-content: flex-start !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;          /* Firefox */
            flex-wrap: nowrap !important;
          }
          .cnc-nav-desktop::-webkit-scrollbar { display: none; }  /* WebKit */
          .cnc-nav-desktop button {
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            padding: 6px 10px !important;
            font-size: 11px !important;
          }
          /* 햄버거 메뉴는 숨김(가로 스크롤 사용) — PC와 동일 UX 유지 */
          .cnc-hamburger { display: none !important; }
          .cnc-header { padding: 0 10px !important; gap: 6px !important; }
          .cnc-title { font-size: 14px !important; }
          .cnc-plus { width: 30px !important; height: 30px !important; font-size: 17px !important; }
          /* 콘텐츠 영역 — 그리드/패딩 모바일 적응 */
          div[style*="padding: 20px 24px"], div[style*="padding:'20px 24px'"] { padding: 10px 12px !important; }
          div[style*="gridTemplateColumns: 'repeat(4"] { grid-template-columns: repeat(2, 1fr) !important; }
          div[style*="gridTemplateColumns: 'repeat(5"] { grid-template-columns: repeat(2, 1fr) !important; }
          div[style*="gridTemplateColumns: '1fr 1fr 1fr'"] { grid-template-columns: 1fr !important; }
          div[style*="gridTemplateColumns: '340px 1fr'"] { grid-template-columns: 1fr !important; }
          table { font-size: 10px !important; }
          th, td { padding: 4px 6px !important; }
          /* 모달 — 모바일에서 안전한 패딩·풀폭 활용 */
          .no-print[style*="position: 'fixed', inset: 0"] { padding: 12px !important; }
        }
      `}</style>
      <div style={{ minHeight: '100vh', background: t.bg }}>
        <Header menu={menu} setMenu={setMenu} />
        {menu === 'dashboard' && <Dashboard drugs={drugs} inv={inv} txns={txns} onNav={handleNav} onEdit={setEditDrug} />}
        {menu === 'alerts' && <AlertCenter drugs={drugs} onNav={handleNav} />}
        {menu === 'ordering' && <Ordering drugs={drugs} />}
        {menu === 'druglist' && <DrugList drugs={drugs} navFilter={nf} onEdit={setEditDrug} onReload={load} />}
        {menu === 'nonins' && <DrugList drugs={drugs} navFilter={nf} onEdit={setEditDrug} onReload={load} nonins />}
        {menu === 'archive' && <DrugList drugs={drugs} navFilter={{ status: ['중지'], archive: true }} onEdit={setEditDrug} onReload={load} />}
        {menu === 'expiry' && <ExpiryAlert drugs={drugs} onEdit={setEditDrug} focusLevel={nf?.focus} onReload={load} />}
        {menu === 'stock' && <StockStatus drugs={drugs} inv={inv} navFilter={nf} onEdit={setEditDrug} onAdjust={setAdjustDrug} onReload={load} />}
        {menu === 'narcotic' && <NarcoticMgmt drugs={drugs} onEdit={setEditDrug} onAdjust={setAdjustDrug} navFilter={nf} />}
        {menu === 'transaction' && <TransactionForm drugs={drugs} onReload={load} navFilter={nf} />}
        {menu === 'report' && <Report drugs={drugs} txns={txns} onNav={handleNav} />}
        {menu === 'emergency' && <EmergencyDispense />}
        {menu === 'register' && <DrugRegister onRefresh={load} drugs={drugs} />}
        {menu === 'mypage' && <MyPage profile={profile} onProfileUpdated={loadProfile} />}
        {menu === 'admin' && (profile?.role === 'admin' ? <AdminUsers /> : <div style={{ maxWidth: 640, margin: '60px auto', padding: '40px 20px', textAlign: 'center', color: t.textL, fontSize: 14 }}>관리자 권한이 필요한 페이지입니다.</div>)}

        {editDrug && <DrugEditModal drug={editDrug} onClose={() => setEditDrug(null)} onSaved={() => { setEditDrug(null); load() }} onLotManage={d => { setEditDrug(null); setLotDrug(d) }} />}
        {d360 && <Drug360Modal drug={d360} pos={d360Pos} setPos={setD360Pos} onClose={() => setD360(null)} />}
        {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
        {adjustDrug && <AdjustModal drug={adjustDrug} onClose={() => setAdjustDrug(null)} onSaved={() => { setAdjustDrug(null); load() }} />}
        {lotDrug && <LotModal drug={lotDrug} onClose={() => setLotDrug(null)} onSaved={() => { setLotDrug(null); load() }} />}
        <div className="no-print" style={{ position: 'fixed', right: 18, bottom: 18, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 880 }}>
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="맨 위로" style={{ width: 46, height: 46, borderRadius: 23, border: '1px solid ' + t.border, background: t.card, color: t.accent, boxShadow: t.shadowH, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>TOP</button>
          <button onClick={() => { setMenu('dashboard'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} title="대시보드 홈" style={{ width: 46, height: 46, borderRadius: 23, border: '1px solid ' + t.accent, background: t.accent, color: '#ffffff', boxShadow: t.shadowH, cursor: 'pointer', fontSize: 11, fontWeight: 800 }}>HOME</button>
        </div>
      </div>
    </ThemeCtx.Provider>
  )
}
