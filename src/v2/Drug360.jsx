import { useEffect, useState } from 'react'
import { T, BRAND } from './theme'
import { fetchDrug, fetchInventory, fetchTransactions, fetchLots } from './api'

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'inout', label: '입출고' },
  { key: 'stock', label: '재고' },
  { key: 'expiry', label: '유효기한' },
  { key: 'narcotic', label: '향정' },
]
const NARC = ['향정', '마약', '한외마약']

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', padding: '7px 0', borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
      <div style={{ width: 120, color: T.textL, flexShrink: 0 }}>{label}</div>
      <div style={{ color: T.text, wordBreak: 'break-all' }}>{value ?? '-'}</div>
    </div>
  )
}
function Empty({ msg }) {
  return <div style={{ padding: '32px 12px', textAlign: 'center', color: T.textL, fontSize: 13 }}>{msg}</div>
}

/* 약품 360° — 코드 클릭 시 개요·입출고·재고·유효기한·향정 (코드 조인, RLS) */
export default function Drug360({ code, onClose }) {
  const [tab, setTab] = useState('overview')
  const [d, setD] = useState(null)
  const [inv, setInv] = useState(null)
  const [tx, setTx] = useState([])
  const [lots, setLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchDrug(code), fetchInventory(code), fetchTransactions(code), fetchLots(code)])
      .then(([dd, iv, tt, ll]) => { if (!active) return; setD(dd); setInv(iv); setTx(tt); setLots(ll); setErr(null); setLoading(false) })
      .catch((e) => { if (active) { setErr(e.message); setLoading(false) } })
    return () => { active = false }
  }, [code])

  const isNarc = d && NARC.includes(d.narcotic_type)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: `1px solid ${T.border}` }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{d?.drug_name || code}</div>
            <div style={{ fontSize: 12, color: BRAND.green, marginTop: 2 }}>{code}{d ? ` · ${d.category}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', cursor: 'pointer', color: T.textM, fontSize: 14 }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '0 12px', borderBottom: `1px solid ${T.border}`, overflowX: 'auto' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
              color: tab === t.key ? BRAND.purple : T.textM,
              borderBottom: tab === t.key ? `2px solid ${BRAND.purple}` : '2px solid transparent',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {loading && <Empty msg="불러오는 중…" />}
          {err && <Empty msg={`오류: ${err}`} />}
          {!loading && !err && d && (
            <>
              {tab === 'overview' && (
                <div>
                  <Row label="약품코드" value={d.drug_code} />
                  <Row label="약품명" value={d.drug_name} />
                  <Row label="구분" value={d.category} />
                  <Row label="성분(한)" value={d.ingredient_kr} />
                  <Row label="복합/단일" value={d.compound_type} />
                  <Row label="전문/일반" value={d.prescription_type} />
                  <Row label="급여구분" value={d.insurance_type} />
                  <Row label="보험코드" value={d.insurance_code} />
                  <Row label="보험약가" value={d.edi_price ? d.edi_price.toLocaleString() + '원' : '-'} />
                  <Row label="보관방법" value={d.storage_method} />
                  <Row label="상태" value={d.status} />
                </div>
              )}
              {tab === 'inout' && (
                tx.length === 0 ? <Empty msg="입출고 이력이 없습니다 (거래 0건)." /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tx.map((r) => (
                      <div key={r.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: BRAND.purple }}>{r.type}</span> · {r.quantity} · {r.transaction_date}
                        {r.supplier ? ` · ${r.supplier}` : ''}
                      </div>
                    ))}
                  </div>
                )
              )}
              {tab === 'stock' && (
                inv ? (
                  <div>
                    <Row label="현재고" value={inv.current_qty} />
                    <Row label="안전재고" value={inv.safety_stock || '-'} />
                    <Row label="최대재고" value={inv.max_stock || '-'} />
                    <Row label="월평균" value={inv.monthly_avg || '-'} />
                    <Row label="전년 사용량" value={inv.prev_year_usage || '-'} />
                    <Row label="최근3개월" value={inv.recent_3m_usage || '-'} />
                  </div>
                ) : <Empty msg="재고 정보가 없습니다." />
              )}
              {tab === 'expiry' && (
                <div>
                  <Row label="대표 유효기한" value={d.expiry_date} />
                  <Row label="대표 로트" value={d.lot_no} />
                  <div style={{ fontSize: 12, color: T.textL, margin: '14px 0 8px' }}>로트별 (drug_lots)</div>
                  {lots.length === 0
                    ? <Empty msg="등록된 로트가 없습니다." />
                    : lots.map((l) => (
                      <div key={l.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 6 }}>
                        {l.lot_no || '(로트번호 없음)'} · 유효 {l.expiry_date || '-'} · 수량 {l.quantity} {l.is_active ? '' : '· 비활성'}
                      </div>
                    ))}
                </div>
              )}
              {tab === 'narcotic' && (
                isNarc ? (
                  <div>
                    <Row label="마약구분" value={d.narcotic_type} />
                    <Row label="규제 대상" value="예" />
                    <div style={{ fontSize: 12, color: T.textL, margin: '14px 0 8px' }}>관련 입출고</div>
                    {tx.length === 0 ? <Empty msg="입출고 이력 없음." /> : tx.map((r) => (
                      <div key={r.id} style={{ fontSize: 13, padding: '4px 0' }}>{r.type} · {r.quantity} · {r.transaction_date}</div>
                    ))}
                  </div>
                ) : <Empty msg="향정·마약·한외마약 해당 없음 (일반 약품)." />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
