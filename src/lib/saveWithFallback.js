/* ═══════════════════════════════════════════════════════════════════════════
   drugs 저장 폴백 단일 출처 — 「미존재 컬럼 자동 제거」를 한 곳에 모은다.

   ★ 왜 모으는가
     PostgREST 가 PGRST204(`Could not find the 'x' column of 'drugs' in the
     schema cache`)를 돌려주면 저장 코드가 **그 키를 버리고 재시도**한다.
     재시도가 성공하므로 지금까지 **사용자에게는 「저장 완료」로 보이고 값만
     사라졌다.** 같은 유형이 `additive`·`compound_type`·`efficacy_class` 로
     세 번 발생했다(인계문서 함정 #22).
     폴백 자체는 **유지한다** — 일시적 스키마 불일치에서 저장이 통째로 실패하는
     것을 막는 안전장치다. 바꾸는 것은 **조용함**뿐: 무엇을 버렸는지 돌려준다.

   ★ 재시도 조건·횟수·정규식은 이전 12곳과 **똑같다**.
     - 조건: 오류 메시지에 'column' 이 있고, 그 안에서 `'<컬럼>' column` 을 뽑을 수 있을 때
       (홑따옴표로 컬럼명을 감싸는 문구는 PostgREST schema-cache 오류뿐이다.
        PostgreSQL 42703 `column "x" … does not exist` · NOT NULL 23502 ·
        형식 42804 · RLS · GRANT · 트리거 거절은 전부 매칭되지 않아 그대로 오류가 된다.)
     - 횟수: 호출부가 넘긴 retries 그대로(모달·인라인 3회 · 대량 4회).
   ★ transactions 4경로는 아직 옮기지 않았다(이번 범위 밖).
   ═══════════════════════════════════════════════════════════════════════════ */
import { FIELD_DEFS } from './drugRules'

/* ── 「일부 미반영」 표시 값 ───────────────────────────────────────────────
   ★ 새 색이 아니다 — `#BFA6D9` 는 기존 토큰 `t.lavender`(라이트·다크 동일),
     `#2E4A62` 는 라이트 `t.nav` 와 같은 값이다. 글자색은 리터럴로 둔다 —
     `t.nav` 는 다크에서 `#1A2332` 로 바뀌어 연보라 위에서 읽기 어렵다. */
export const PARTIAL_BG = 'rgba(191,166,217,0.45)'
export const PARTIAL_FG = '#2E4A62'
export const PARTIAL_LINE = '#BFA6D9'

/* 컬럼 이름 → 화면 이름. FIELD_DEFS 가 단일 출처이고, 거기 없으면 컬럼 이름 그대로. */
const COL_LABEL = {}
for (const f of FIELD_DEFS) if (f.col && f.label) COL_LABEL[f.col] = f.label

export function colLabel(col) {
  return COL_LABEL[col] || String(col)
}

/* 모달·인라인 칸에 띄우는 문구.
   ★ labelOf 를 받는 이유 — transactions 의 칸은 FIELD_DEFS(drugs 사전)에 거의 없다.
     그대로 두면 「금액」이 `total_amount` 로 뜬다. 입출고 경로는 txColLabel 을 넘긴다.
     기본값은 drugs 라벨이라 기존 호출부는 한 글자도 바뀌지 않는다. */
export function partialText(dropped, labelOf = colLabel) {
  return '저장했지만 반영되지 않은 항목이 있습니다: ' + (dropped || []).map(labelOf).join(', ')
}

/* 엑셀 일괄 결과 요약에 한 줄 */
export function partialBulkText(count, dropped, labelOf = colLabel) {
  const names = (dropped || []).map(labelOf)
  return `${count}건은 일부 항목 미반영(${names[0] || '-'} 등)`
}

/* 오류에서 버릴 컬럼 이름을 뽑는다. 못 뽑으면 null — 호출부는 그대로 오류로 끝낸다. */
export function droppedColumnOf(error) {
  const msg = error && error.message
  if (!msg || !msg.includes('column')) return null
  const m = msg.match(/'([^']+)' column/)
  return m ? m[1] : null
}

/* payload 에서 컬럼 하나를 뺀 **사본**을 돌려준다(배열이면 전 행에서 뺀다).
   ★ 사본인 이유 — 호출부가 넘긴 원본을 건드리지 않는다. 대량 청크는 배열로 들어온다. */
function omit(payload, col) {
  if (Array.isArray(payload)) {
    return payload.map(o => { const x = { ...o }; delete x[col]; return x })
  }
  const x = { ...payload }
  delete x[col]
  return x
}

/* ── 저장 1회 + 폴백 재시도 ───────────────────────────────────────────────
   payload : 보낼 객체(또는 객체 배열)
   send(p) : 그 payload 로 요청을 보내고 { error } 를 돌려주는 함수
   opts    : { retries = 3, label = 'drugs' }
   반환    : { error, dropped: ['efficacy_class', …], payload: 마지막으로 보낸 것 } */
export async function saveWithFallback(payload, send, opts = {}) {
  const retries = opts.retries == null ? 3 : opts.retries
  const label = opts.label || 'drugs'
  const dropped = []
  let cur = payload
  let res = await send(cur)

  for (let r = 0; r < retries && res && res.error; r++) {
    const col = droppedColumnOf(res.error)
    if (!col) break
    /* ★ 어느 경로에서든 흔적을 남긴다 — 예전에 warn 조차 없던 3곳(유효기한·사용점검) 포함 */
    console.warn(`[${label}] 미존재 컬럼 자동 제거:`, col, '/ 원인:', res.error.message)
    dropped.push(col)
    cur = omit(cur, col)
    res = await send(cur)
  }

  return { error: (res && res.error) || null, dropped, payload: cur }
}
