import { NavLink, Outlet } from 'react-router-dom'
import { T, BRAND } from './theme'

/* 8 주메뉴 (통합구현가이드 §2) */
const MENUS = [
  { to: '/app', label: '대시보드', end: true },
  { to: '/app/drugs', label: '약품관리' },
  { to: '/app/inout', label: '입출고관리' },
  { to: '/app/inventory', label: '재고관리' },
  { to: '/app/expiry', label: '유효기한' },
  { to: '/app/narcotic', label: '향정관리' },
  { to: '/app/reports', label: '보고서' },
  { to: '/app/settings', label: '설정' },
]

/* 상단 GNB + 콘텐츠 영역 공통 레이아웃 */
export default function Layout() {
  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', height: 56,
        background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: BRAND.purple, whiteSpace: 'nowrap' }}>
          약플로 <span style={{ fontSize: 10, color: T.textL, fontWeight: 500 }}>v2</span>
        </div>
        <nav style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1 }}>
          {MENUS.map(m => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              style={({ isActive }) => ({
                padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                textDecoration: 'none',
                color: isActive ? '#fff' : T.textM,
                background: isActive ? BRAND.purple : 'transparent',
              })}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
        <a href="/" style={{ fontSize: 12, color: T.textL, textDecoration: 'none', whiteSpace: 'nowrap' }}>기존 화면 →</a>
      </header>
      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
