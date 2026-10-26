import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* 백신 잔량 공개 조회 — 독립 사이트(vaccine-public).
   ※ Supabase 클라이언트·키를 포함하지 않는다. 데이터 접근은 전부 같은 사이트의
     Netlify Function(/api/vaccine/*) 경유이며, service_role 키는 서버에만 존재한다.
   ※ 번들에 supabase·createClient·scrypt 문자열이 들어가면 안 된다(검증 항목). */
export default defineConfig({
  plugins: [react()],
})
