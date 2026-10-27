import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    /* Node 컨텍스트(빌드·서버리스 설정/스크립트): Buffer/process 등 Node 전역 허용 */
    /* ★ vaccine-app/netlify 도 같은 Node 컨텍스트다 — 빠져 있어 Buffer·process 가
       no-undef 로 잡혔다(2026-10-27 추가). ward-app 은 자체 설정이 따로 있다. */
    files: ['*.config.js', 'vite.config.js', 'vitest.config.js', 'netlify/**/*.js', 'scripts/**/*.js',
      'vaccine-app/netlify/**/*.js'],
    languageOptions: { globals: globals.node },
  },
])
