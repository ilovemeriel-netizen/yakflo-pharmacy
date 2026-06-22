import { T, BRAND } from './theme'

/* P2-1 라우트 스캐폴드용 자리표시 페이지.
   실제 구현은 P2-2(약품 360°)·P2-3(상태 뷰)·P2-4(거래/재고)에서 채운다. */
export default function Placeholder({ title, source, step }) {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', color: T.text }}>{title}</h1>
      <div style={{ fontSize: 13, color: T.textM, marginBottom: 20 }}>신규 인터페이스 — 골격(P2-1) 완료, 콘텐츠 구현 예정</div>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20,
        display: 'inline-block', minWidth: 280,
      }}>
        {step && (
          <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#fff', background: BRAND.purple, padding: '3px 8px', borderRadius: 999, marginBottom: 12 }}>
            {step}
          </div>
        )}
        {source && (
          <div style={{ fontSize: 12, color: T.textM, lineHeight: 1.7 }}>
            <span style={{ color: T.textL }}>데이터 소스</span><br />
            <code style={{ fontSize: 12, color: BRAND.green }}>{source}</code>
          </div>
        )}
        <div style={{ fontSize: 11, color: T.textL, marginTop: 12 }}>
          매핑 기준: <code>docs/DATA_UI_CONTRACT.md</code>
        </div>
      </div>
    </div>
  )
}
