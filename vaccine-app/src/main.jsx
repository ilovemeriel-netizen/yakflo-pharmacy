import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import './index.css'

/* ★ 앱 전체를 감싸는 경계 하나 — 한 군데가 터져도 하얀 화면이 되지 않는다 */
createRoot(document.getElementById('root')).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
