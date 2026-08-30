// check_pw_spec.mjs — 재조회 비밀번호 scrypt 규격이 두 파일에서 어긋나지 않았는지 검사한다.
//
// 왜 필요한가
//   신청 앱(ward-app)과 관리 화면(루트 사이트)은 **별개 npm 프로젝트**라 서로 import할 수 없어
//   scrypt 규격(PW_LEN · salt 바이트 · keylen)이 두 파일에 복제돼 있다.
//   한쪽만 고치면 저장은 성공하는데 조회만 실패한다 — 사용자에게는 「비밀번호가 틀림」으로만 보이고
//   로그에도 오류가 남지 않는다. 폴백이 실패를 숨기는 함정 #22와 같은 성격이라,
//   어긋나는 즉시 드러나도록 이 검사를 둔다.
//
// 실행:  node scripts/check_pw_spec.mjs      (수동 · CI 미연결)
// 종료코드: 일치 0 · 불일치 1 · 블록 못 찾음 2
//
// 검사 내용
//   1) 두 파일의 // PW_SPEC:BEGIN ~ // PW_SPEC:END 블록이 **문자 단위로** 동일한가
//      (줄바꿈은 CRLF/LF 차이를 무시한다 — git 설정 산물이지 규격 차이가 아니다)
//   2) 블록이 실제로 파싱돼 PW_LEN·PW_SALT_B·PW_KEYLEN 값이 기대대로인가
//   3) 같은 값으로 실제 scrypt를 돌려 두 파일의 해시가 같은지 (규격 일치의 최종 확인)
//   4) [부가] 신청 앱 화면의 PW_MSG 리터럴이 PW_SPEC의 파생 문구와 같은가
//      — 화면은 Function을 import할 수 없어(supabase 클라이언트가 번들로 새어 든다) 문구를 복제한다.
import { readFileSync } from 'node:fs'
import { scrypt as _scrypt, randomBytes } from 'node:crypto'

const A = 'ward-app/netlify/functions/ward-submit.js'   // 신청 앱 · 저장 시 해시
const B = 'netlify/functions/ward-pw-reset.js'          // 루트 사이트 · 관리 화면 재설정
const BEGIN = '// PW_SPEC:BEGIN'
const END = '// PW_SPEC:END'

function block(path) {
  let t
  try { t = readFileSync(path, 'utf8') } catch { return { err: '파일을 열 수 없습니다' } }
  t = t.replace(/\r\n/g, '\n')
  const i = t.indexOf(BEGIN)
  const j = t.indexOf(END, i + 1)
  if (i < 0 || j < 0) return { err: `PW_SPEC 블록을 찾을 수 없습니다 (${BEGIN} ~ ${END})` }
  return { text: t.slice(i, j + END.length) }
}

/* 블록에서 상수를 읽는다 — 정규식 한 줄씩. 값이 숫자가 아니면 null. */
function consts(text) {
  const num = k => {
    const m = new RegExp(`export const ${k}\\s*=\\s*(\\d+)`).exec(text)
    return m ? Number(m[1]) : null
  }
  return { PW_LEN: num('PW_LEN'), PW_SALT_B: num('PW_SALT_B'), PW_KEYLEN: num('PW_KEYLEN') }
}

const hash = (pw, salt, keylen) => new Promise((res, rej) =>
  _scrypt(pw, salt, keylen, (e, dk) => (e ? rej(e) : res(dk.toString('hex')))))

const a = block(A), b = block(B)
let fail = 0
const P = (ok, label, detail) => { if (!ok) fail++; console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`) }

console.log('■ PW_SPEC 규격 검사')
console.log(`   A ${A}`)
console.log(`   B ${B}\n`)

if (a.err || b.err) {
  console.log(`  FAIL 블록 추출 — A: ${a.err || 'OK'} · B: ${b.err || 'OK'}`)
  process.exit(2)
}

/* 1) 문자 단위 동일 */
if (a.text === b.text) {
  P(true, '블록 문자 단위 동일', `${a.text.split('\n').length}줄`)
} else {
  P(false, '블록 문자 단위 동일')
  const la = a.text.split('\n'), lb = b.text.split('\n')
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      console.log(`       ${i + 1}행 A: ${JSON.stringify(la[i] ?? '(없음)')}`)
      console.log(`       ${i + 1}행 B: ${JSON.stringify(lb[i] ?? '(없음)')}`)
    }
  }
}

/* 2) 값 확인 — 블록이 같아도 상수 자체가 깨졌으면 잡는다 */
const ca = consts(a.text), cb = consts(b.text)
const EXPECT = { PW_LEN: 4, PW_SALT_B: 16, PW_KEYLEN: 64 }
for (const k of Object.keys(EXPECT)) {
  P(ca[k] === EXPECT[k] && cb[k] === EXPECT[k], `${k} = ${EXPECT[k]}`, `A=${ca[k]} · B=${cb[k]}`)
}

/* 3) 실제 해시 대조 — 두 파일의 규격으로 같은 비밀번호를 해싱해 결과가 같은지 */
if (ca.PW_KEYLEN && cb.PW_KEYLEN && ca.PW_SALT_B && cb.PW_SALT_B) {
  const pw = '0000'
  const salt = randomBytes(ca.PW_SALT_B).toString('hex')
  const [ha, hb] = await Promise.all([hash(pw, salt, ca.PW_KEYLEN), hash(pw, salt, cb.PW_KEYLEN)])
  P(ha === hb, '같은 salt로 해싱한 결과 동일', `${ha.length / 2}바이트 · ${ha.slice(0, 16)}…`)
  P(salt.length === ca.PW_SALT_B * 2, 'salt hex 길이', `${salt.length}자 (= ${ca.PW_SALT_B}바이트 × 2)`)
}

/* 4) [부가] 신청 앱 화면의 PW_MSG 리터럴 — 블록을 평가해 얻은 문구와 대조한다.
      화면은 Function을 import할 수 없어 같은 문장을 복제해 두었다(그 파일 주석 참조). */
const SCREEN = 'ward-app/src/App.jsx'
try {
  /* 마커 줄은 주석이라 그대로 둔다 — 지우면 뒤따르는 설명 문구가 코드로 읽혀 파싱이 깨진다 */
  const body = a.text.replace(/export const/g, 'const')
  /* 줄바꿈으로 이어 붙인다 — 블록 마지막 줄이 // PW_SPEC:END 주석이라 같은 줄에 두면 통째로 먹힌다 */
  const { PW_MSG } = new Function(`${body}\nreturn { PW_MSG }`)()
  const src = readFileSync(SCREEN, 'utf8')
  P(src.includes(PW_MSG), `화면 문구 일치 (${SCREEN})`, JSON.stringify(PW_MSG))
} catch (e) {
  P(false, `화면 문구 일치 (${SCREEN})`, e.message)
}

console.log(`\n${fail ? `■ 불일치 ${fail}건 — 두 파일의 PW_SPEC 블록을 맞춰 주세요.` : '■ 전부 일치.'}`)
process.exit(fail ? 1 : 0)
