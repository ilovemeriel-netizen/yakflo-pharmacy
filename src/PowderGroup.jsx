/* 가루약 분리번호 — 조제관리 안의 기준표 화면 (2026-11-10 이정화 님 승인)
 *
 * ★ DB 를 바꾸지 않는다. `drugs` 를 **읽기만** 하고 번호는 그때그때 계산한다.
 *   (규칙은 src/lib/powderGroup.js — ATC·성분·제형만 본다. 약품코드를 박지 않는다.)
 *
 * ★ 1,000줄 함정 — `drugs` 는 **쪽을 나눠 끝까지** 읽는다.
 *   `supabase.from(...).select(...)` 는 기본 1,000줄만 주고 **오류도 내지 않는다.**
 *   약품이 1,100종이 넘으므로 한 번에 읽으면 조용히 잘린다. (src/lib/rowLimit.js)
 *
 * ★ 색·규격 — 새로 그리지 않는다.
 *   제목줄은 비상조제(EmergencyDispense.jsx)와 **같은 모양**:
 *     16px/700 보라(#804A87) 제목 + 12px t.textM 설명을 한 줄에, gap 10 · marginBottom 10.
 *   칩은 주의 칩 토큰(src/lib/cautionDefs.js)을, 표는 StandardTable 머리 규격을 따른다.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useTheme } from './lib/theme'
import { checkRowLimit } from './lib/rowLimit'
import { dbErrorMsg } from './lib/dbError'
import { HIGH_ALERT_BG, HIGH_ALERT_FG } from './lib/cautionDefs'
import { WarnTriangle } from './CautionChips'
import {
  buildPowderTable, searchPowder, GROUP_NAMES, MANUAL, CHECK,
} from './lib/powderGroup'

/* 비상조제와 같은 상수 — 기존 팔레트. 새 색을 만들지 않는다. */
const PURPLE = '#804A87'

const num = n => Number(n || 0).toLocaleString()

/* 가루 위험 칩 — ★ 기존 고위험 칩 토큰을 그대로 쓴다(새 색 아님).
   Chip() 규격: 테두리가 있으면 안여백을 1px 씩 줄여 바깥 크기를 맞춘다. */
function HazardChip({ title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: HIGH_ALERT_BG, color: HIGH_ALERT_FG,
      border: '1px solid ' + HIGH_ALERT_FG,
      padding: '2px 9px', borderRadius: 8,
      fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', verticalAlign: 'middle',
    }}><WarnTriangle />가루 위험</span>
  )
}

function NumBadge({ t, no }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 22, height: 22, padding: '0 6px', borderRadius: 7,
      background: t.accentL, color: t.accent, fontSize: 11.5, fontWeight: 700,
    }}>{no}</span>
  )
}

function ManualChip({ t }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 8,
      background: t.blueL, color: t.blue, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>{MANUAL}</span>
  )
}

export default function PowderGroup() {
  const { t } = useTheme()
  const [drugs, setDrugs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [cutMsg, setCutMsg] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})

  /* ── drugs 읽기 — 쪽을 나눠 끝까지 ───────────────────────────────── */
  useEffect(() => {
    let dead = false
    const PAGE = 1000, MAX_PAGES = 20
    ;(async () => {
      let rows = [], total = null
      for (let i = 0; i < MAX_PAGES; i++) {
        const from = i * PAGE
        const { data, error, count } = await supabase.from('drugs')
          .select('drug_code,drug_name,status,category,atc_code,narcotic_type,ingredient_kr,ingredient_en',
            { count: 'exact' })
          .order('drug_code')
          .range(from, from + PAGE - 1)
        if (dead) return
        if (error) { setErr('약품을 읽지 못했습니다: ' + dbErrorMsg(error)); setLoaded(true); return }
        if (count != null) total = count
        rows = rows.concat(data || [])
        if (!data || data.length < PAGE) break
      }
      const lim = checkRowLimit(rows, total)
      setDrugs(rows)
      setCutMsg(lim.cut ? lim.message : '')
      setLoaded(true)
    })()
    return () => { dead = true }
  }, [])

  const p = useMemo(() => buildPowderTable(drugs), [drugs])
  const hits = useMemo(() => searchPowder(p.rows, q), [p, q])
  const asked = q.trim() !== ''

  const card = {
    background: t.card, border: '1px solid ' + t.border, borderRadius: 12,
    padding: 14, marginBottom: 12,
  }
  const th = {
    padding: '8px 10px', textAlign: 'center', color: t.textM, fontWeight: 700,
    borderBottom: '1px solid ' + t.border, fontSize: 11, background: t.bg,
  }
  const td = { padding: '8px 10px', borderBottom: '1px solid ' + t.border, fontSize: 12, color: t.text }

  const resultRow = x => (
    <tr key={x.d.drug_code}>
      <td style={{ ...td, fontWeight: 600 }}>{x.d.drug_name}</td>
      <td style={{ ...td, textAlign: 'center' }}>
        {x.r.no == null ? <ManualChip t={t} /> : <NumBadge t={t} no={x.r.no} />}
      </td>
      <td style={td}>{x.r.label}</td>
      <td style={td}>
        {x.r.hazard
          ? <HazardChip title={x.r.hazard} />
          : <span style={{ color: t.textL }}>—</span>}
        {x.r.note && <span style={{
          marginLeft: 6, fontSize: 10, color: t.amber, background: t.amberL,
          padding: '2px 7px', borderRadius: 8, fontWeight: 700,
        }}>{x.r.note}</span>}
      </td>
      <td style={{ ...td, color: t.textM, fontSize: 11 }}>{x.d.ingredient_kr || ''}</td>
      <td style={{ ...td, color: t.textM, fontSize: 11, textAlign: 'center' }}>{x.d.atc_code || ''}</td>
    </tr>
  )

  const pill = x => (
    <span key={x.d.drug_code} title={x.r.why} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: t.text,
      background: t.bg, border: '1px solid ' + t.border, borderRadius: 7, padding: '3px 9px',
    }}>
      {x.d.drug_name}
      {x.r.hazard && <WarnTriangle />}
    </span>
  )

  const section = (key, head, list, foldedByDefault) => {
    const isOpen = open[key] === undefined ? !foldedByDefault : open[key]
    return (
      <div key={key} style={{
        border: '1px solid ' + t.border, borderRadius: 10, background: t.card,
        marginBottom: 8, overflow: 'hidden',
      }}>
        <button
          type="button"
          onClick={() => setOpen(s => ({ ...s, [key]: !isOpen }))}
          aria-expanded={isOpen}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px',
            fontSize: 12, background: isOpen ? t.bg : 'transparent', border: 0,
            borderBottom: isOpen ? '1px solid ' + t.border : 0,
            cursor: 'pointer', textAlign: 'left', color: t.text, fontFamily: 'inherit',
          }}>
          <span style={{ color: t.textL, fontSize: 11, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
          {head}
          <span style={{ fontSize: 11, color: t.textM }}>{num(list.length)}종</span>
          {foldedByDefault && !isOpen
            && <span style={{ marginLeft: 'auto', fontSize: 10, color: t.textL }}>기본 접힘</span>}
        </button>
        {isOpen && (
          <div style={{ padding: '11px 13px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {list.length ? list.map(pill)
              : <span style={{ color: t.textL, fontSize: 11 }}>해당 약 없음</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* ── 제목줄 — 비상조제와 같은 모양 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: PURPLE }}>가루약 분리번호</span>
        <span style={{ fontSize: 12, color: t.textM }}>
          약품 정보(ATC·성분·제형)로 그때그때 계산합니다 · 저장하지 않습니다
        </span>
        {loaded && !err && (
          <span style={{ fontSize: 11, color: t.textL }}>
            사용 중인 경구제 {num(p.total)}종
          </span>
        )}
      </div>

      {err && (
        <div style={{
          background: t.redL, color: t.red, border: '1px solid ' + t.red, borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 12,
        }}>❗ {err}</div>
      )}
      {cutMsg && (
        <div style={{
          background: t.amberL, color: t.amber, border: '1px solid ' + t.amber, borderRadius: 8,
          padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 12,
        }}>⚠ {cutMsg}</div>
      )}

      {/* ── 검색 ── */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="약품명 · 성분명으로 찾기 (예: 시그마트 · 니코란딜 · 마그네슘)"
            aria-label="약품명 또는 성분명으로 찾기"
            style={{
              flex: 1, border: '1px solid ' + t.borderH, borderRadius: 9, background: t.card,
              padding: '9px 12px', fontSize: 13, color: t.text, outline: 'none', fontFamily: 'inherit',
            }} />
          {asked && (
            <button type="button" onClick={() => setQ('')} style={{
              padding: '9px 16px', borderRadius: 9, border: '1px solid ' + t.border,
              background: 'transparent', color: t.textM, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>지우기</button>
          )}
        </div>
        {!asked && (
          <div style={{ fontSize: 10.5, color: t.textL, marginTop: 7 }}>
            약품명 일부나 성분명(한글·영문)으로 찾을 수 있습니다.
          </div>
        )}
      </div>

      {/* ── 검색 결과 ── */}
      {asked && (
        <div style={card}>
          {hits.length === 0
            ? <div style={{ padding: '18px 4px', color: t.textL, fontSize: 12 }}>
              「{q.trim()}」로 찾은 약이 없습니다. 약품명 일부나 성분명으로 다시 찾아 보세요.
            </div>
            : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                <th style={{ ...th, width: 260 }}>약품명</th>
                <th style={{ ...th, width: 76 }}>번호</th>
                <th style={{ ...th, width: 150 }}>구분</th>
                <th style={{ ...th, width: 190 }}>가루 위험</th>
                <th style={th}>성분(한글)</th>
                <th style={{ ...th, width: 90 }}>ATC</th>
              </tr></thead>
              <tbody>{hits.map(resultRow)}</tbody>
            </table>}
        </div>
      )}

      {/* ── 「확인 필요」 안내 ── */}
      {loaded && !err && (
        <div style={{
          background: p.check.length ? t.amberL : t.accentL,
          border: '1px solid ' + (p.check.length ? t.amber : t.border),
          borderRadius: 10, padding: '9px 13px', fontSize: 11.5,
          color: p.check.length ? t.amber : t.text, marginBottom: 12,
        }}>
          {p.check.length
            ? <><b>{CHECK} {num(p.check.length)}종</b> — 규칙에 안 걸려 번호를 매기지 않았습니다:{' '}
              {p.check.map(x => x.d.drug_name).join(', ')}</>
            : <><b style={{ color: t.accent }}>{CHECK} 0종</b> — 사용 중인 경구제 {num(p.total)}종 모두 규칙으로 정해졌습니다.</>}
        </div>
      )}

      {/* ── 번호별 전체 목록 ── */}
      {loaded && !err && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: PURPLE }}>번호별 전체 목록</span>
            <span style={{ fontSize: 12, color: t.textM }}>
              {GROUP_NAMES[1]}·{GROUP_NAMES[6]}은 약이 많아 기본으로 접혀 있습니다
            </span>
          </div>
          {p.groups.map(g => section(
            'g' + g.no,
            <>
              <NumBadge t={t} no={g.no} />
              <span style={{ fontWeight: 700, color: t.text }}>{g.name}</span>
            </>,
            g.list, g.folded))}
          {section(
            'manual',
            <>
              <ManualChip t={t} />
              <span style={{ fontWeight: 700, color: t.text }}>마약 · 액체·가루 제형 — 분리번호 없음</span>
            </>,
            p.manual, false)}
        </>
      )}

      {!loaded && (
        <div style={{ padding: 40, textAlign: 'center', color: t.textL, fontSize: 13 }}>약품을 읽는 중입니다…</div>
      )}
    </div>
  )
}
