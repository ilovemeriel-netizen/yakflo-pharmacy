import { defineConfig } from 'vitest/config'

/* 테스트 전용 설정 — build용 vite.config.js와 격리(테스트가 dev 프록시·PWA 설정에 영향 0).
   vitest는 이 파일을 우선 사용. */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    /* 루트 앱 + 공개 조회 사이트(vaccine-app). vaccine-app 은 별도 빌드지만
       시험은 루트 vitest 하나로 돌린다.
       ★ Function 시험은 vaccine-app/tests/ 에 둔다 — netlify/functions/ 최상위에 두면
         Netlify 가 그 파일을 **Function 으로 묶어** 공개 엔드포인트로 올리고,
         vitest 를 못 찾아 빌드도 깨진다(2026-10-27 실제 실패). */
    include: [
      'src/**/*.{test,spec}.{js,jsx}',
      'vaccine-app/src/**/*.{test,spec}.{js,jsx}',
      'vaccine-app/tests/**/*.{test,spec}.{js,jsx}',
    ],
  },
})