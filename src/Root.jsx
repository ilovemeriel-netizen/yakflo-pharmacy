import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'

/* P2-1 라우팅 골격 (가산적)
   - '/'(및 그 외 모든 경로): 기존 App.jsx 그대로 보존 — 이메일 로그인→drugs 1103 동작 무수정
   - '/app/*': (2026-08-07) 메인 '/'으로 리다이렉트 — v2 인터페이스(DEFAULT_SAFETY=10 판정) 도달 차단.
               v2 컴포넌트·상수 파일(src/v2/*)은 디스크에 보존. 재활성화 시 이 라우트를
               원래 /app 하위 라우트(Layout·DashboardPage·InventoryPage 등)로 복원. */
export default function Root() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/app/*" element={<Navigate to="/" replace />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  )
}