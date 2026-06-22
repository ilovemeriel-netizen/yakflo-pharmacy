import { T, BRAND } from './theme'
import { COLUMNS, STATUS_CHIP } from './columns'

/* 사용/휴면/중지 뷰가 공통으로 쓰는 재사용 그리드.
   props: rows, visibleKeys(표시 컬럼), onRowClick, action?({label,onClick(row)}) */
export default function DrugTable({ rows, visibleKeys, onRowClick, action }) {
  const cols = COLUMNS.filter((c) => visibleKeys.includes(c.key))
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 12, color: T.textL, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: `1px solid ${T.border}` }
  const td = { padding: '10px 12px', fontSize: 13, color: T.text, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key} style={{ ...th, textAlign: c.align === 'right' ? 'right' : 'left' }}>{c.label}</th>)}
            {action && <th style={{ ...th, textAlign: 'right' }}></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.drug_code} onClick={() => onRowClick(d.drug_code)} style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => e.currentTarget.style.background = T.bg}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              {cols.map((c) => (
                <td key={c.key} style={{
                  ...td,
                  textAlign: c.align === 'right' ? 'right' : 'left',
                  whiteSpace: c.wrap ? 'normal' : 'nowrap',
                  fontFamily: c.mono ? 'monospace' : 'inherit',
                  color: c.mono ? BRAND.green : T.text,
                  fontWeight: c.bold ? 500 : 400,
                }}>
                  {c.chip
                    ? <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: (STATUS_CHIP[d.status] || {}).bg || '#f0f0f2', color: (STATUS_CHIP[d.status] || {}).fg || '#888' }}>{d.status}</span>
                    : c.num ? (d[c.key] ?? 0).toLocaleString() : (d[c.key] || '-')}
                </td>
              ))}
              {action && (
                <td style={{ ...td, textAlign: 'right' }}>
                  {(!action.applicable || action.applicable(d)) && (
                    <button onClick={(e) => { e.stopPropagation(); action.onClick(d) }}
                      style={{ padding: '5px 10px', border: `1px solid ${BRAND.purple}`, borderRadius: 6, background: 'transparent', color: BRAND.purple, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {action.label}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
