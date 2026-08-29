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

  /* 기본(좁은 화면 · 태블릿·폰): 세로로 쌓임 */
  .wa-wrap { max-width: 720px; margin: 0 auto; padding: 16px 14px 48px; }
  .wa-cols { display: block; }
  .wa-sticky { position: static; }

  /* 넓은 화면: 왼쪽 입력·검색 / 오른쪽 신청 목록(스크롤에 붙어 따라옴) */
  @media (min-width: 900px) {
    .wa-wrap { max-width: 1040px; padding: 20px 20px 56px; }
    .wa-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    .wa-sticky { position: sticky; top: 16px; }
  }
`
document.head.appendChild(base)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
