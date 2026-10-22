// check_pw_spec.mjs — 비밀번호 scrypt 규격이 **복제본 사이에서** 어긋나지 않았는지 검사한다.
//
// 왜 필요한가
//   신청 앱(ward-app)·관리 화면(루트)·공개 조회 앱(vaccine-app)은 **별개 npm 프로젝트**라
//   서로 import할 수 없어 scrypt 규격(PW_LEN · salt 바이트 · keylen)이 여러 파일에 복제돼 있다.
//   한쪽만 고치면 저장은 성공하는데 조회만 실패한다 — 사용자에게는 「비밀번호가 틀림」으로만 보이고
//   로그에도 오류가 남지 않는다. 폴백이 실패를 숨기는 함정 #22와 같은 성격이라,
//   어긋나는 즉시 드러나도록 이 검사를 둔다.
//
// ★ 2026-10-23 확장 — 2개 → 4개 비교.
//   복제본이 늘어나는데 검사가 2개만 보면, 새 복제본이 어긋나도 이 스크립트는 「전부 일치」라고 답한다.
//   그 침묵이야말로 이 검사가 막으려던 실패 방식이라 대상을 함께 넓힌다.
//
// ★ 아직 병합되지 않은 파일은 **없을 수 있다**(PR 단위로 들어온다).
//   없는 파일은 조용히 빼지 않고 「건너뜀」으로 **눈에 보이게** 적는다 — 조용히 줄어드는 검사가
//   바로 위에서 말한 함정이기 때문이다. 단, 비교 대상이 2개 미만이면 검사 의미가 없어 실패로 본다.
//
// 실행:  node scripts/check_pw_spec.mjs      (수동 · CI 미연결)
// 종료코드: 일치 0 · 불일치 1 · 블록 못 찾음/대상 부족 2
//
// 검사 내용
//   1) 두 파일의 // PW_SPEC:BEGIN ~ // PW_SPEC:END 블록이 **문자 단위로** 동일한가
//      (줄바꿈은 CRLF/LF 차이를 무시한다 — git 설정 산물이지 규격 차이가 아니다)
//   2) 블록이 실제로 파싱돼 PW_LEN·PW_SALT_B·PW_KEYLEN 값이 기대대로인가
//   3) 같은 값으로 실제 scrypt를 돌려 두 파일의 해시가 같은지 (규격 일치의 최종 확인)
//   4) [부가] 신청 앱 화면의 PW_MSG 리터럴이 PW_SPEC의 파생 문구와 같은가
//      — 화면은 Function을 import할 수 없어(supabase 클라이언트가 번들로 새어 든다) 문구를 복제한다.
import { existsSync, readFileSync } from 'node:fs'
import { scrypt as _scrypt, randomBytes } from 'node:crypto'

/* 복제본 목록 — 새 복제본을 만들면 **여기에 반드시 추가**한다 */
const TARGETS = [
  { path: 'ward-app/netlify/functions/ward-submit.js', note: '신청 앱 · 저장 시 해시' },
  { path: 'netlify/functions/ward-pw-reset.js', note: '루트 사이트 · 관리 화면 재설정' },
  { path: 'netlify/functions/vaccine-public-admin.js', note: '루트 사이트 · 공개 비밀번호 설정' },
  { path: 'vaccine-app/netlify/functions/vaccine-verify.js', note: '공개 조회 앱 · 비밀번호 확인' },
]
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

let fail = 0
const P = (ok, label, detail) => { if (!ok) fail++; console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`) }

console.log("■ PW_SPEC 규격 검사")

/* ── 대상 추리기 — 없는 파일은 눈에 보이게 적는다 ── */
const present = [], skipped = []
for (const t of TARGETS) {
  if (!existsSync(t.path)) { skipped.push(t); continue }
  const b = block(t.path)
  if (b.err) { console.log(`   X ${t.path} — ${b.err}`); fail++; continue }
  present.push({ ...t, text: b.text })
}
present.forEach((t, i) => console.log(`   ${String.fromCharCode(65 + i)} ${t.path}  (${t.note})`))
skipped.forEach(t => console.log(`   - ${t.path}  (${t.note})  ★ 건너뜀 — 파일 없음(미병합)`))
console.log("")

if (fail) { console.log("■ 블록 추출 실패 — 위 파일을 확인해 주세요.") ; process.exit(2) }
if (present.length < 2) {
  console.log(`■ 비교 대상이 ${present.length}개뿐입니다 — 최소 2개가 있어야 규격 대조가 성립합니다.`)
  process.exit(2)
}
if (skipped.length) console.log(`  ※ ${TARGETS.length}개 중 ${present.length}개만 검사했습니다. 건너뛴 파일은 병합 후 다시 돌려 주세요.
`)

/* 1) 문자 단위 동일 — 첫 파일을 기준으로 나머지를 댄다 */
const base = present[0]
let allSame = true
for (const t of present.slice(1)) {
  if (t.text === base.text) continue
  allSame = false
  P(false, `블록 동일 — ${base.path} <-> ${t.path}`)
  const la = base.text.split('\n'), lb = t.text.split('\n')
  for (let k = 0; k < Math.max(la.length, lb.length); k++) {
    if (la[k] !== lb[k]) {
      console.log(`       ${k + 1}행 기준: ${JSON.stringify(la[k] ?? "(없음)")}`)
      console.log(`       ${k + 1}행 대상: ${JSON.stringify(lb[k] ?? "(없음)")}`)
    }
  }
}
if (allSame) P(true, `블록 문자 단위 동일 (${present.length}개 파일)`, `${base.text.split('\n').length}줄`)

/* 2) 값 확인 — 블록이 같아도 상수 자체가 깨졌으면 잡는다 */
const EXPECT = { PW_LEN: 4, PW_SALT_B: 16, PW_KEYLEN: 64 }
const cs = present.map(t => ({ path: t.path, c: consts(t.text) }))
for (const k of Object.keys(EXPECT)) {
  const ok = cs.every(x => x.c[k] === EXPECT[k])
  P(ok, `${k} = ${EXPECT[k]}`, cs.map(x => `${x.path.split("/").pop()}=${x.c[k]}`).join(" · "))
}

/* 3) 실제 해시 대조 — 모든 파일의 규격으로 같은 비밀번호를 해싱해 결과가 같은지 */
if (cs.every(x => x.c.PW_KEYLEN && x.c.PW_SALT_B)) {
  const pw = "0000"
  const salt = randomBytes(cs[0].c.PW_SALT_B).toString("hex")
  const hs = await Promise.all(cs.map(x => hash(pw, salt, x.c.PW_KEYLEN)))
  P(hs.every(h => h === hs[0]), `같은 salt로 해싱한 결과 동일 (${hs.length}개)`, `${hs[0].length / 2}바이트 · ${hs[0].slice(0, 16)}…`)
  P(salt.length === cs[0].c.PW_SALT_B * 2, "salt hex 길이", `${salt.length}자 (= ${cs[0].c.PW_SALT_B}바이트 × 2)`)
}

/* 4) [부가] 신청 앱 화면의 PW_MSG 리터럴 — 블록을 평가해 얻은 문구와 대조한다.
      화면은 Function을 import할 수 없어 같은 문장을 복제해 두었다(그 파일 주석 참조). */
const SCREEN = 'ward-app/src/App.jsx'
try {
  /* 마커 줄은 주석이라 그대로 둔다 — 지우면 뒤따르는 설명 문구가 코드로 읽혀 파싱이 깨진다 */
  const body = base.text.replace(/export const/g, 'const')
  /* 줄바꿈으로 이어 붙인다 — 블록 마지막 줄이 // PW_SPEC:END 주석이라 같은 줄에 두면 통째로 먹힌다 */
  const { PW_MSG } = new Function(`${body}\nreturn { PW_MSG }`)()
  const src = readFileSync(SCREEN, 'utf8')
  P(src.includes(PW_MSG), `화면 문구 일치 (${SCREEN})`, JSON.stringify(PW_MSG))
} catch (e) {
  P(false, `화면 문구 일치 (${SCREEN})`, e.message)
}

console.log(`\n${fail ? `■ 불일치 ${fail}건 — 복제본들의 PW_SPEC 블록을 맞춰 주세요.` : `■ 전부 일치 (검사 ${present.length}개 / 전체 ${TARGETS.length}개).`}`)
process.exit(fail ? 1 : 0)
