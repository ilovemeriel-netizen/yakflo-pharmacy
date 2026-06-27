import { defineConfig } from 'vitest/config'

/* 테스트 전용 설정 — build용 vite.config.js와 격리(테스트가 dev 프록시·PWA 설정에 영향 0).
   vitest는 이 파일을 우선 사용. */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})