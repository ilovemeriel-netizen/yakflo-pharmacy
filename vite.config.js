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
