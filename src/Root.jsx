import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import { ErrorBoundary } from './lib/errorBoundary.jsx'

/* P2-1 라우팅 골격 (가산적)
   - '/'(및 그 외 모든 경로): 기존 App.jsx 그대로 보존 — 이메일 로그인→drugs 1103 동작 무수정
   - '/app/*': (2026-08-07) 메인 '/'으로 리다이렉트 — v2 인터페이스(DEFAULT_SAFETY=10 판정) 도달 차단.
               v2 컴포넌트·상수 파일(src/v2/*)은 디스크에 보존. 재활성화 시 이 라우트를
               원래 /app 하위 라우트(Layout·DashboardPage·InventoryPage 등)로 복원. */
export default function Root() {
  /* ★ 바깥 경계 — 헤더나 App 본문이 터져도 하얀 화면이 되지 않게 한다.
     ThemeCtx 밖이라 테마 토큰을 받을 수 없어 t 를 주지 않는다 →
     카드가 OS 설정(prefers-color-scheme)에 맞춰 라이트·다크를 고른다.
     「대시보드로」는 주지 않는다(승인 시안) — 여기서는 화면 이동이 뜻이 없다. */
  return (
    <ErrorBoundary full>
      <BrowserRouter>
        <Routes>
          <Route path="/app/*" element={<Navigate to="/" replace />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}