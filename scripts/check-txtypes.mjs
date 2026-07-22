/* 거래 타입 드리프트 탐지:
   src/lib/txTypes.js 의 TX_* 상수 값 ↔ supabase/migrations 의 최신 transactions.type CHECK 허용값.
   불일치 시 exit 1. 실행: npm run check:txtypes
   (txTypes.js 를 import 하지 않고 텍스트 파싱 → ESM/CJS·package type 설정 무관하게 동작) */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 1) 코드 상수(txTypes.js)에서 TX_* 값 추출
const txSrc = readFileSync(join(root, 'src', 'lib', 'txTypes.js'), 'utf8')
const codeVals = [...txSrc.matchAll(/export const TX_(?:IN|OUT|RETURN|DISPOSE|ADJUST)\s*=\s*'([^']*)'/g)].map(m => m[1])

// 2) 최신 마이그레이션의 transactions_type_check 허용값 추출
const migDir = join(root, 'supabase', 'migrations')
const files = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()
let dbVals = null, srcFile = null
for (const f of files) {
  const sql = readFileSync(join(migDir, f), 'utf8')
  const m = sql.match(/transactions_type_check[\s\S]{0,240}?type\s+in\s*\(([^)]*)\)/i)
  if (m) { dbVals = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]); srcFile = f }
}

if (codeVals.length !== 5) { console.error('✗ txTypes.js 에서 TX_* 상수 5종을 찾지 못함:', codeVals); process.exit(1) }
if (!dbVals) { console.error('✗ transactions_type_check 를 마이그레이션에서 찾지 못함'); process.exit(1) }

const a = [...codeVals].sort(), b = [...dbVals].sort()
const same = a.length === b.length && a.every((v, i) => v === b[i])
if (same) {
  console.log(`✓ 거래 타입 일치 (src/lib/txTypes.js ↔ ${srcFile}): [${b.join(', ')}]`)
  process.exit(0)
}
console.error('✗ 드리프트 감지 — 코드 상수와 DB CHECK 허용값 불일치')
console.error('  txTypes.js : [' + a.join(', ') + ']')
console.error(`  DB CHECK   : [` + b.join(', ') + `]  (${srcFile})`)
console.error('  → 저장이 CHECK 위반으로 실패할 수 있습니다. 양쪽을 함께 수정하세요.')
process.exit(1)