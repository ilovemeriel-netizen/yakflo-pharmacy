// check_0097_api.mjs — PostgREST 가 새 칸(changes)을 보는지 확인한다. 읽기만.
//
// ★ CLAUDE.md 규칙: 컬럼을 추가한 뒤 스키마 캐시를 갱신하고, 새 칸이 **API 에서**
//   보이는지 확인한 다음에 그 칸을 쓰는 쪽을 올린다. 캐시가 낡으면 실재하는
//   컬럼에도 PGRST204/42703 이 난다.
// ★ 키 값은 출력하지 않는다.
import { readFileSync, existsSync } from 'node:fs'

function rd(p) {
  const o = {}; if (!existsSync(p)) return o
  let t = readFileSync(p, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([\w.]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return o
}
const env = rd('.env')
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY || env.SUPABASE_ANON_KEY
if (!URL_ || !KEY) { console.error('★ VITE_SUPABASE_URL / anon key 를 .env 에서 못 찾음'); process.exit(1) }
console.log('대상 프로젝트 ref: ' + new URL(URL_).hostname.split('.')[0])

async function probe(col) {
  const r = await fetch(URL_ + '/rest/v1/vaccine_survey_audit?select=' + col + '&limit=1',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
  let body = ''
  try { body = (await r.text()).slice(0, 180) } catch { /* 무시 */ }
  return { status: r.status, body }
}

const ok = await probe('changes')
const bad = await probe('zzz_not_a_column')

console.log('')
console.log('  changes            → HTTP ' + ok.status + '  ' + ok.body.replace(/\s+/g, ' '))
console.log('  zzz_not_a_column   → HTTP ' + bad.status + '  ' + bad.body.replace(/\s+/g, ' '))
console.log('')

/* ★ anon 에는 이 표의 SELECT 권한이 없다(설계: 기록은 로그인한 관리자만 본다).
   그래서 200 은 나오지 않는다. 가리는 기준은 **오류의 종류**다 —
     칸을 모르면  42703 «column ... does not exist»  (400)
     칸을 알면    42501 «permission denied»          (401)
   즉 42703 이 아니면 PostgREST 가 그 칸을 이미 안다는 뜻이다. */
const colUnknown = s => /42703|PGRST204|PGRST100/.test(s)
const knows = !colUnknown(ok.body)
const discriminates = colUnknown(bad.body)
const permOnly = /42501/.test(ok.body) || ok.status === 200

const gate = (n, v) => console.log('  ' + (v ? 'OK ' : '★NG') + '  ' + n)
gate('API 가 changes 칸을 안다 — 42703·PGRST204 가 아니다', knows)
gate('없는 칸은 42703 으로 거절한다 — 검사가 실제로 가린다', discriminates)
gate('남은 거절은 권한(42501)뿐 — 스키마 캐시는 최신이다', permOnly)
process.exitCode = (knows && discriminates && permOnly) ? 0 : 1
