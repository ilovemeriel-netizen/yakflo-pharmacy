/* 약플로 · 사용량 등록 모달 — 탭 [일괄 등록] [개별 등록]  (2026-11-04 시안)

   ★ 왜 나눴나
     · 일괄 등록 = 지금 쓰던 양식(전년·3개월·1개월을 한 파일에) 그대로. 검토 화면도 그대로.
     · 개별 등록 = **칸 하나만** 골라 파일로 올린다. 병동·외래를 따로 받으면 **더한다**.
       파일에 없는 약품은 **0 으로** 둔다(2026-11-04 이정화 님 결정).

   ★ 색·부품 — 부모가 넘긴 t 만 쓴다. 새 색 없음.
     뱃지·표는 App.jsx 와 같은 모양을 쓰되 **import 하지 않는다** —
     기존 모달(BulkUploadModal·SnapshotUploadModal)이 그렇게 돼 있다(순환 import 회피).

   ★ 저장은 DB 함수 하나(app_save_usage_bulk)로 **한 번에** 한다.
     지금처럼 줄마다 저장하면 중간에 끊겼을 때 절반만 들어간 상태가 남는다. */
import { useState, useRef, useMemo } from 'react'
import { supabase } from './lib/supabase'
import {
  readSheet, mergeRows, buildPreview, confirmText, FIELD_LABEL,
} from './lib/usageParse'

const FIELDS = [
  { k: 'recent_1m_usage', label: '직전1개월사용량', hint: '병동·외래를 합쳐 올립니다' },
  { k: 'recent_3m_usage', label: '최근3개월사용량', hint: '월평균·안전재고가 다시 계산됩니다' },
  { k: 'prev_year_usage', label: '전년사용량', hint: '월평균·안전재고가 다시 계산됩니다' },
]
const PREVIEW_MAX = 50     /* 미리보기 표에 보일 줄 수 — 나머지는 「그 밖 N종」 */

export default function UsageUploadModal({ t, isTenantManager, drugs, onClose, onReload, onBulkFile }) {
  const [tab, setTab] = useState('single')
  const [field, setField] = useState('recent_1m_usage')
  const [files, setFiles] = useState([])            /* [{name, rows, badHeader}] */
  const [err, setErr] = useState('')
  const [keep, setKeep] = useState(() => new Set()) /* 0 으로 만들지 **않을** 약품코드 */
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() || 12)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const fRef = useRef(), bRef = useRef()

  const parsed = useMemo(() => {
    if (!files.length) return null
    const good = files.filter(f => !f.badHeader)
    if (!good.length) return null
    const m = mergeRows(good.map(f => ({ label: f.name, rows: f.rows })))
    return { ...m, ...buildPreview(drugs, m.merged, field) }
  }, [files, drugs, field])

  const zeroTargets = useMemo(
    () => (parsed ? parsed.zeros.filter(z => !keep.has(z.code)) : []),
    [parsed, keep])

  async function onPick(e) {
    const picked = [...(e.target.files || [])]; e.target.value = ''
    if (!picked.length) return
    setErr(''); setResult(null)
    try {
      const XLSX = await import('xlsx')
      const out = []
      for (const file of picked.slice(0, 2)) {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        /* 모든 시트를 훑어 「약품코드」가 있는 첫 시트를 쓴다 — 통합 파일은 시트가 여럿이다 */
        let best = null
        for (const sn of wb.SheetNames) {
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' })
          const r = readSheet(aoa, field)
          if (!r.badHeader) { best = { ...r, sheet: sn }; break }
          if (!best) best = { ...r, sheet: sn }
        }
        out.push({ name: file.name, sheet: best?.sheet || '', rows: best?.rows || [], badHeader: best?.badHeader || null })
      }
      setFiles(out); setKeep(new Set())
    } catch (ex) { setErr('파일 읽기 오류: ' + (ex && ex.message)) }
  }

  async function apply() {
    if (!parsed) return
    setConfirming(false); setApplying(true); setErr('')
    const rowKey = field === 'prev_year_usage' ? 'py' : field === 'recent_3m_usage' ? 'r3' : 'r1'
    const rows = parsed.changes.map(c => ({ code: c.code, [rowKey]: c.after }))
    const { data, error } = await supabase.rpc('app_save_usage_bulk', {
      p_fields: [field],
      p_rows: rows,
      p_zero_missing: true,
      p_keep_codes: [...keep],
    })
    setApplying(false)
    if (error) { setErr('등록 실패: ' + error.message); return }
    setResult(data || {})
    onReload?.()
  }

  /* ── 조각들 — App.jsx 와 같은 모양(색은 t 에서만) ── */
  const badge = (text, bg, color) => (
    <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 8, fontSize: 10,
      fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>{text}</span>
  )
  const th = { padding: '8px 10px', textAlign: 'left', color: t.textM, fontWeight: 600,
    borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap', fontSize: 11, background: t.bg }
  const td = { padding: '6px 10px', fontSize: 11, color: t.textM, borderBottom: `1px solid ${t.border}` }
  const btn = (bg, color, bd) => ({ padding: '8px 16px', borderRadius: 8, border: `1px solid ${bd || bg}`,
    background: bg, color, cursor: 'pointer', fontSize: 12, fontWeight: 700 })

  const tabBtn = (k, label) => (
    <button key={k} onClick={() => { setTab(k); setErr(''); setResult(null) }}
      style={{ padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        border: `1px solid ${tab === k ? t.accent : t.border}`,
        background: tab === k ? t.accentL : 'transparent', color: tab === k ? t.accent : t.textM }}>{label}</button>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 14,
        padding: '22px 26px', maxWidth: 820, width: '100%', maxHeight: '88vh', overflowY: 'auto',
        border: `1px solid ${t.borderH}`, boxShadow: t.shadowH, boxSizing: 'border-box' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>사용량 등록</div>
          <button onClick={onClose} aria-label="닫기" style={{ ...btn('transparent', t.textM, t.border), padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {tabBtn('bulk', '일괄 등록')}{tabBtn('single', '개별 등록')}
        </div>

        {err && <div style={{ background: t.redL, border: `1px solid ${t.red}`, borderRadius: 8,
          padding: '10px 14px', marginBottom: 12, color: t.red, fontSize: 12, fontWeight: 600 }}>{err}</div>}

        {/* ══ 일괄 등록 — 지금 양식·검토 화면 그대로 ══ */}
        {tab === 'bulk' && (
          <div>
            <div style={{ fontSize: 12, color: t.textM, lineHeight: 1.7, marginBottom: 14 }}>
              지금 쓰시던 양식 그대로입니다 — 한 파일에 <b style={{ color: t.text }}>전년·최근3개월·직전1개월</b>을 함께 적습니다.<br />
              파일을 고르면 <b style={{ color: t.text }}>검토 화면</b>이 열립니다. 거기서 확인한 뒤 등록합니다.
            </div>
            <button onClick={() => bRef.current?.click()} style={btn(t.amberL, t.amber)}>파일 고르기</button>
            <input ref={bRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { onBulkFile?.(f); onClose?.() } }} />
          </div>
        )}

        {/* ══ 개별 등록 ══ */}
        {tab === 'single' && (
          <div>
            {/* ① 항목 고르기 */}
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 8 }}>① 어느 칸을 올릴까요?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
              {FIELDS.map(f => (
                <div key={f.k} onClick={() => { setField(f.k); setFiles([]); setKeep(new Set()); setResult(null) }}
                  style={{ cursor: 'pointer', borderRadius: 10, padding: '12px 14px',
                    border: `1px solid ${field === f.k ? t.accent : t.border}`,
                    background: field === f.k ? t.accentL : 'transparent' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: field === f.k ? t.accent : t.text }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: t.textM, marginTop: 4, lineHeight: 1.5 }}>{f.hint}</div>
                </div>
              ))}
            </div>

            {/* ② 파일 */}
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 8 }}>② 파일 고르기 <span style={{ fontWeight: 500, color: t.textM }}>· 1~2개 (둘이면 약품코드별로 더합니다)</span></div>
            <button onClick={() => fRef.current?.click()} style={btn(t.blueL, t.blue)}>파일 고르기</button>
            <input ref={fRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }} onChange={onPick} />

            {files.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: t.textM }}>
                    <span style={{ fontWeight: 600, color: t.text }}>{f.name}</span>
                    {f.sheet && <span>시트 「{f.sheet}」</span>}
                    {f.badHeader
                      ? badge(f.badHeader, t.redL, t.red)
                      : badge(f.rows.length.toLocaleString() + '줄', t.greenL, t.green)}
                  </div>
                ))}
              </div>
            )}

            {/* ③ 미리보기 */}
            {parsed && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>③ 미리보기</div>
                  {badge('변경 ' + parsed.changes.length.toLocaleString() + '종', t.blueL, t.blue)}
                  {zeroTargets.length > 0 && badge('0 으로 ' + zeroTargets.length.toLocaleString() + '종', t.amberL, t.amber)}
                  {parsed.mergedCount > 0 && badge('중복 합산 ' + parsed.mergedCount.toLocaleString(), t.purpleL, t.purple)}
                  {parsed.unmatched.length > 0 && badge('없는 코드 ' + parsed.unmatched.length.toLocaleString(), t.redL, t.red)}
                  {parsed.bad.length > 0 && badge('숫자 아님 ' + parsed.bad.length.toLocaleString(), t.redL, t.red)}
                  {parsed.dateLike.length > 0 && badge('날짜로 바뀐 코드 ' + parsed.dateLike.length.toLocaleString(), t.redL, t.red)}
                </div>

                {parsed.dateLike.length > 0 && (
                  <div style={{ background: t.redL, border: `1px solid ${t.red}`, borderRadius: 8, padding: '8px 12px',
                    marginBottom: 10, fontSize: 11, color: t.red, lineHeight: 1.6 }}>
                    약품코드가 날짜로 바뀐 줄이 있습니다 — 엑셀에서 그 칸을 <b>텍스트</b>로 바꾼 뒤 다시 올려 주세요.<br />
                    {parsed.dateLike.slice(0, 4).map(x => x.raw).join(' · ')}{parsed.dateLike.length > 4 ? ' …' : ''}
                  </div>
                )}

                <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${t.border}`, borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th}>약품코드</th><th style={th}>약품명</th><th style={th}>상태</th>
                      <th style={{ ...th, textAlign: 'right' }}>지금</th>
                      <th style={{ ...th, textAlign: 'right' }}>새 값</th>
                    </tr></thead>
                    <tbody>
                      {parsed.changes.slice(0, PREVIEW_MAX).map(c => (
                        <tr key={c.code}>
                          <td style={{ ...td, textAlign: 'left' }}>{c.code}</td>
                          <td style={{ ...td, textAlign: 'left', color: t.text, fontWeight: 500 }}>{c.name}</td>
                          <td style={{ ...td, textAlign: 'left' }}>{c.status}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{c.before == null ? '-' : c.before.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: 'right', color: t.accent, fontWeight: 700 }}>{c.after.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.changes.length > PREVIEW_MAX && (
                    <div style={{ padding: '8px 10px', fontSize: 11, color: t.textM }}>
                      … 그 밖 {(parsed.changes.length - PREVIEW_MAX).toLocaleString()}종
                    </div>)}
                </div>

                {/* ④ 0 으로 바뀔 약품 */}
                {parsed.zeros.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 6 }}>
                      ④ 파일에 없어 <span style={{ color: t.amber }}>0 으로</span> 바뀔 약품
                      <span style={{ fontWeight: 500, color: t.textM }}> · 체크를 풀면 지금 값을 그대로 둡니다</span>
                    </div>
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${t.border}`, borderRadius: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>
                          <th style={{ ...th, width: 34, textAlign: 'center' }}>
                            <input type="checkbox" checked={keep.size === 0}
                              onChange={e => setKeep(e.target.checked ? new Set() : new Set(parsed.zeros.map(z => z.code)))} />
                          </th>
                          <th style={th}>약품코드</th><th style={th}>약품명</th><th style={th}>상태</th>
                          <th style={{ ...th, textAlign: 'right' }}>지금</th>
                        </tr></thead>
                        <tbody>
                          {parsed.zeros.slice(0, PREVIEW_MAX).map(z => (
                            <tr key={z.code}>
                              <td style={{ ...td, textAlign: 'center' }}>
                                <input type="checkbox" checked={!keep.has(z.code)} onChange={() => setKeep(p => {
                                  const n = new Set(p); n.has(z.code) ? n.delete(z.code) : n.add(z.code); return n
                                })} />
                              </td>
                              <td style={{ ...td, textAlign: 'left' }}>{z.code}</td>
                              <td style={{ ...td, textAlign: 'left', color: t.text, fontWeight: 500 }}>{z.name}</td>
                              <td style={{ ...td, textAlign: 'left' }}>{z.status}</td>
                              <td style={{ ...td, textAlign: 'right' }}>{z.before == null ? '-' : z.before.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsed.zeros.length > PREVIEW_MAX && (
                        <div style={{ padding: '8px 10px', fontSize: 11, color: t.textM }}>
                          … 그 밖 {(parsed.zeros.length - PREVIEW_MAX).toLocaleString()}종
                        </div>)}
                    </div>
                  </div>
                )}

                {/* 못 넣은 줄 사유 */}
                {(parsed.bad.length > 0 || parsed.unmatched.length > 0) && (
                  <div style={{ marginTop: 12, fontSize: 11, color: t.textM, lineHeight: 1.7 }}>
                    {parsed.bad.length > 0 && <div><b style={{ color: t.red }}>숫자가 아니라 넣지 않은 약품</b> — {parsed.bad.slice(0, 6).map(b => b.code).join(' · ')}{parsed.bad.length > 6 ? ' …' : ''}</div>}
                    {parsed.unmatched.length > 0 && <div><b style={{ color: t.red }}>약품목록에 없는 코드</b> — {parsed.unmatched.slice(0, 6).map(u => u.code).join(' · ')}{parsed.unmatched.length > 6 ? ' …' : ''}</div>}
                  </div>
                )}

                {/* ⑤ 기준년월(표시만) + 등록 */}
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>⑤ 어느 달 값인가요?</span>
                  <select value={year} onChange={e => setYear(Number(e.target.value))}
                    style={{ padding: '6px 10px', border: `1px solid ${t.border}`, borderRadius: 8, background: t.bg, color: t.text, fontSize: 12 }}>
                    {[0, 1, 2].map(d => { const y = new Date().getFullYear() - d; return <option key={y} value={y}>{y}년</option> })}
                  </select>
                  <select value={month} onChange={e => setMonth(Number(e.target.value))}
                    style={{ padding: '6px 10px', border: `1px solid ${t.border}`, borderRadius: 8, background: t.bg, color: t.text, fontSize: 12 }}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                  </select>
                  <span style={{ fontSize: 10, color: t.textM }}>확인 문구에만 적습니다 — 저장하지 않습니다</span>
                </div>

                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={onClose} style={btn('transparent', t.textM, t.border)}>닫기</button>
                  <button disabled={!isTenantManager || applying || !parsed.changes.length}
                    onClick={() => setConfirming(true)}
                    style={{ ...btn(t.accent, '#fff'), opacity: (!isTenantManager || applying || !parsed.changes.length) ? 0.5 : 1 }}>
                    {applying ? '등록 중…' : '등록'}
                  </button>
                </div>
                {!isTenantManager && (
                  <div style={{ marginTop: 8, fontSize: 11, color: t.textM, textAlign: 'right' }}>
                    사용량 등록은 관리자만 할 수 있습니다.
                  </div>)}
              </div>
            )}

            {/* 결과 — 기존 초록 안내 띠와 같은 모양 */}
            {result && (
              <div style={{ marginTop: 14, background: t.greenL, border: `1px solid ${t.green}`, borderRadius: 8,
                padding: '10px 14px', color: t.green, fontSize: 12, fontWeight: 600, lineHeight: 1.7 }}>
                등록 완료 — {Number(result.saved || 0).toLocaleString()}종 변경
                {Number(result.zeroed || 0) > 0 ? ' · ' + Number(result.zeroed).toLocaleString() + '종 0 으로' : ''}
                {Array.isArray(result.unmatched) && result.unmatched.length > 0
                  ? ' · 없는 코드 ' + result.unmatched.length.toLocaleString() + '종은 넣지 않았습니다' : ''}
              </div>
            )}
          </div>
        )}

        {/* 확인 창 */}
        {confirming && parsed && (
          <div onClick={() => setConfirming(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: t.cardSolid, borderRadius: 14, padding: '22px 26px',
              maxWidth: 420, width: '100%', border: `1px solid ${t.border}`, boxShadow: t.shadowH, boxSizing: 'border-box' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 10 }}>사용량 등록</div>
              <div style={{ fontSize: 12, color: t.textM, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 18 }}>
                {confirmText({ year, month, field, changeCount: parsed.changes.length, zeroCount: zeroTargets.length })}
                {'\n\n'}한 번에 저장합니다. 중간에 끊겨도 절반만 들어가지 않습니다.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setConfirming(false)} style={btn('transparent', t.textM, t.border)}>취소</button>
                <button onClick={apply} style={btn(t.accent, '#fff')}>등록</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
