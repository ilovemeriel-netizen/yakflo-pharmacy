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

  /* ★ 최소 지원 폭 360px · 임계 346.7px
     — 병동 신청 링크는 메신저·QR로 전달돼 폰 접속이 기본 경로다. 720px 상향은 채택하지 않는다.
     ★ 배지 행에 요소를 추가할 때는 900px 이상을 기준으로 재계산할 것.
       .wa-top-ward가 360px **고정**이라 창을 넓혀도 버튼 1칸은 68.1px로 늘지 않는다
       — 가장 빡빡한 지점은 좁은 화면이 아니라 여기다.
     [계산식] 버튼1칸 = (viewport − 28(wrap padding) − 32(card padding)
                        − 배지폭 − 8(gap) − 18(grid gap)) ÷ 4                (<900px)
              버튼1칸 = (360 − 배지폭 − 8 − 18) ÷ 4                          (≥900px) */

  /* 상단 한 줄: [병동] 3 4 5 6 | [작성자] ____ — 좁은 화면에서는 두 줄로 쌓임 */
  .wa-top { display: flex; flex-direction: column; gap: 10px; }
  .wa-top-ward, .wa-top-name { display: flex; align-items: center; gap: 8px; }
  .wa-top-ward > .wa-grow, .wa-top-name > .wa-grow { flex: 1; min-width: 0; }

  /* 저장 영역: 2단 아래 가운데 */
  .wa-save { max-width: 420px; margin: 4px auto 0; }

  /* 넓은 화면: 왼쪽 약품 검색 / 오른쪽 신청 목록(스크롤에 붙어 따라옴) */
  @media (min-width: 900px) {
    .wa-wrap { max-width: 1040px; padding: 20px 20px 56px; }
    .wa-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    .wa-sticky { position: sticky; top: 16px; }
    .wa-top { flex-direction: row; align-items: center; gap: 20px; }
    /* ★ 병동 버튼을 넓게 — 360px → 480px. .wa-top-name(flex:1)이 남는 폭을 가져간다.
       하한 검증: 900px 창에서 이름 입력칸 = 828(카드) − 480 − 20(gap) − 72.5(② 배지) − 8 = 247.5px.
       placeholder 「이름을 입력해 주세요」(한글 9 + 공백 2 @16px = 160px) + padding 24 + 테두리 2
       = **186px**가 하한이므로 61.5px 여유가 남는다. 900px 미만 구간은 건드리지 않는다. */
    .wa-top-ward { flex: 0 0 480px; }
    .wa-top-name { flex: 1; min-width: 0; }
  }
`
document.head.appendChild(base)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
