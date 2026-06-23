import { CHART_COLORS } from './appConstants'
import { T } from './theme'

/* 의존성 없는 SVG 도넛 차트 + 범례. data: [{k,n}, ...] */
export default function Donut({ data = [], size = 168, thickness = 26 }) {
  const items = data.filter((d) => d.n > 0)
  const total = items.reduce((a, d) => a + d.n, 0)
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r

  if (total === 0) return <div style={{ color: T.textL, fontSize: 13, padding: 20 }}>표시할 데이터가 없습니다.</div>

  const fracs = items.map((d) => d.n / total)
  const offsets = fracs.map((_, i) => fracs.slice(0, i).reduce((a, b) => a + b, 0)) // 누적 시작각(순수 계산)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ececf0" strokeWidth={thickness} />
          {items.map((d, i) => {
            const dash = fracs[i] * C
            return (
              <circle key={d.k} cx={cx} cy={cy} r={r} fill="none"
                stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={thickness}
                strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offsets[i] * C} strokeLinecap="butt" />
            )
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{total.toLocaleString()}</div>
          <div style={{ fontSize: 10, color: T.textL }}>합계</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 140 }}>
        {items.map((d, i) => (
          <div key={d.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
            <span style={{ color: T.text, fontWeight: 500 }}>{d.k}</span>
            <span style={{ color: T.textL, marginLeft: 'auto' }}>{d.n.toLocaleString()} · {Math.round((d.n / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}