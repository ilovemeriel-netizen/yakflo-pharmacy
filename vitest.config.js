import { defineConfig } from 'vitest/config'

/* 테스트 전용 설정 — build용 vite.config.js와 격리(테스트가 dev 프록시·PWA 설정에 영향 0).
   vitest는 이 파일을 우선 사용. */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    /* 루트 앱 + 공개 조회 사이트(vaccine-app). vaccine-app 은 별도 빌드지만
       시험은 루트 vitest 하나로 돌린다 — Function 쪽 순수 모듈도 포함한다. */
    include: [
      'src/**/*.{test,spec}.{js,jsx}',
      'vaccine-app/src/**/*.{test,spec}.{js,jsx}',
      'vaccine-app/netlify/**/*.{test,spec}.{js,jsx}',
    ],
  },
})