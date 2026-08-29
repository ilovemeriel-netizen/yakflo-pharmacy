import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* 병동 신청 앱 — 독립 사이트(ward-request).
   ※ Supabase 클라이언트·키를 포함하지 않는다. 데이터 접근은 전부 같은 사이트의
     Netlify Function(/api/ward/*) 경유이며, service_role 키는 서버에만 존재한다. */
export default defineConfig({
  plugins: [react()],
})
