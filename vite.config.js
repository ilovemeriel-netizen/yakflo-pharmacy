import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/* ════════════════════════════════════════════════════════════════
   로컬 dev에서 Netlify Functions(/api/*)를 직접 실행하는 adapter
   - Netlify Functions의 (req: Request) => Response 시그니처를 그대로 호출
   - 운영(Netlify)에서는 각 함수가 자체 라우팅으로 동작
   ════════════════════════════════════════════════════════════════ */
async function callNetlifyFn(handlerPromise, req, res) {
  const mod = await handlerPromise
  const handler = mod.default || mod
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers.host || 'localhost'
  const fullUrl = `${protocol}://${host}${req.originalUrl || req.url}`
  let body
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
  const webReq = new Request(fullUrl, { method: req.method, headers, body, duplex: 'half' })
  const webRes = await handler(webReq)
  res.statusCode = webRes.status
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  const buf = Buffer.from(await webRes.arrayBuffer())
  res.end(buf)
}

/* ── 1) 공공데이터 API 프록시 (CORS 우회 + 서버 측 키 첨부) ── */
function datagoDevProxy() {
  return {
    name: 'datago-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/datago', async (req, res) => {
        const apiKey = process.env.DATA_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, msg: '.env에 DATA_API_KEY를 설정하세요 (서버 측 환경변수)' }))
          return
        }
        try {
          const url = new URL(req.url, 'http://localhost')
          const targetPath = url.pathname.replace(/^\//, '')
          if (!targetPath.startsWith('1471000/') && !targetPath.startsWith('B551182/')) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, msg: '허용되지 않은 API 경로' }))
            return
          }
          const params = new URLSearchParams(url.search)
          params.delete('serviceKey'); params.delete('ServiceKey')
          params.set('serviceKey', apiKey)
          const upstream = await fetch(`https://apis.data.go.kr/${targetPath}?${params.toString()}`)
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(text)
        } catch (e) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, msg: '업스트림 호출 실패: ' + e.message }))
        }
      })
    },
  }
}

/* ── 2) Netlify Functions를 dev에서 직접 실행 ──
   ⚠️ vite가 config 파일을 node_modules/.vite-temp/ 로 복사해 실행하므로,
   import 경로는 반드시 import.meta.url 기준의 절대 URL을 사용해야 함. */
function netlifyFunctionsDev() {
  const routes = [
    ['/api/auth/naver/login',    new URL('./netlify/functions/auth-naver-login.js',    import.meta.url).href],
    ['/api/auth/naver/callback', new URL('./netlify/functions/auth-naver-callback.js', import.meta.url).href],
    ['/api/account/delete',      new URL('./netlify/functions/account-delete.js',      import.meta.url).href],
  ]
  return {
    name: 'netlify-functions-dev',
    configureServer(server) {
      for (const [path, fileUrl] of routes) {
        server.middlewares.use(path, async (req, res) => {
          try { await callNetlifyFn(import(fileUrl), req, res) }
          catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, msg: 'dev Function 오류: ' + e.message }))
          }
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  /* Netlify Functions는 process.env에서 키를 읽으므로 .env 값을 주입 */
  Object.assign(process.env, env)
  return {
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('xlsx')) return 'xlsx'
              if (id.includes('@supabase')) return 'supabase'
              if (id.includes('react')) return 'react-vendor'
            }
          },
        },
      },
    },
    plugins: [
      react(),
      datagoDevProxy(),
      netlifyFunctionsDev(),
      VitePWA({
        registerType: 'autoUpdate',
        /* ★ 자동 주입되는 registerSW.js 는 등록 한 줄뿐이라 **갱신 확인도 reload 도 없다.**
           SPA 안에서는 탐색이 없어 열린 탭이 며칠이고 옛 번들을 실행했다
           (회차 마감이 두 번 9시간 밀린 사고의 원인). src/main.jsx 에서 직접 등록한다. */
        injectRegister: null,
        includeAssets: ['favicon.ico', 'favicon.svg', 'icons/*.png', 'offline.html'],
        manifest: {
          name: '약플로 · Yakflo',
          short_name: '약플로',
          description: '약품 통합 관리 솔루션 — 입고부터 폐기까지, 막힘없는 흐름',
          theme_color: '#804A87',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          lang: 'ko',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          /* ★ 결산 엑셀용 exceljs(약 930 kB) 청크도 프리캐시에 **그대로 둔다**(사용자 결정 2026-10-30).
             메인 번들에는 안 들어가고 버튼을 누를 때만 쓰지만, 미리 받아 두면 네트워크가
             느리거나 끊겨도 결산 엑셀을 만들 수 있다. 첫 방문 29개 3,520 KiB.
             ※ 한때 globIgnores 로 뺐다가(28개 2,612 KiB) 되돌렸다 — 다시 빼자는 제안은
               「오프라인에서도 결산 엑셀을 만들 수 있어야 한다」를 먼저 뒤집어야 한다. */
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          navigateFallback: '/offline.html',
          /* SW가 처리하지 않을 경로 (서버 함수·OAuth 콜백 등) */
          navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
          /* SW 캐시 용량 제한 (큰 JS 청크 대응) */
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
      }),
    ],
  }
})
