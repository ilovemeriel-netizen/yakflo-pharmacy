import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

/* 전역 기본 스타일 — 브랜드 팔레트 4색 외 신규 색상값 없음(그 외는 white 키워드·rgba 파생) */
const base = document.createElement('style')
base.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: rgba(46,74,98,0.04);
    color: #2E4A62;
    -webkit-text-size-adjust: 100%;
  }
  input, select, textarea, button { font-family: inherit; font-size: 16px; } /* 16px: iOS 자동 확대 방지 */
`
document.head.appendChild(base)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
