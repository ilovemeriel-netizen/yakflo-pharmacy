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

/* ── 「일부 미반영」·「취소했습니다」 안내 색 ──────────────────────────────
   ★ 새 색이 아니다 — 전부 기존 토큰 값이다.
     `#BFA6D9` = `t.lavender`(라이트·다크 동일) = 다크 `t.accent`
     `#2E4A62` = 라이트 `t.text`,  `#E8E6E1` = 다크 `t.text`
     `#804A87` = 라이트 `t.accent`
     `rgba(191,166,217,0.12)` = 다크 `t.accentL`

   ★ 왜 CSS 변수인가 (2026-10-30 실측)
     다크에서 라벤더 45% 는 카드 배경과 섞여 `rgb(100,94,125)` 가 되고,
     그 위의 `#2E4A62` 글자는 **1.51:1** 로 거의 읽히지 않는다.
     그런데 이 안내는 **11곳**에서 쓰이고, 그중 일부(DrugRegister·BulkUploadModal)는
     테마에 접근조차 하지 않는다. 화면마다 분기를 넣으면 한 곳을 빠뜨린다.
     그래서 값만 테마별로 바꾸고 **부르는 쪽은 한 글자도 고치지 않는다.**
     변수는 index.css 가 `<html data-yp-theme>` 기준으로 정한다(모달 포털도 탄다).
   ★ 괄호 안은 변수가 없을 때의 기본값 = 라이트. 라이트 모양은 그대로다. */
export const PARTIAL_LIGHT = {
  bg: 'rgba(191,166,217,0.45)', fg: '#2E4A62', line: '#BFA6D9', btn: '#804A87',
}
export const PARTIAL_DARK = {
  bg: 'rgba(191,166,217,0.12)', fg: '#E8E6E1', line: '#BFA6D9', btn: '#BFA6D9',
}
export const PARTIAL_BG = 'var(--yp-partial-bg, ' + PARTIAL_LIGHT.bg + ')'
export const PARTIAL_FG = 'var(--yp-partial-fg, ' + PARTIAL_LIGHT.fg + ')'
export const PARTIAL_LINE = 'var(--yp-partial-line, ' + PARTIAL_LIGHT.line + ')'
/* 안내 안의 버튼(예: [되돌리기]) — 강조 토큰을 쓴다 */
export const PARTIAL_BTN = 'var(--yp-partial-btn, ' + PARTIAL_LIGHT.btn + ')'

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

/* 받침이 있으면 '이', 없으면 '가' — 「금액이」 · 「거래단가가」 · 「일자가」.
   ★ 문장을 고정으로 「이」로 쓰면 「거래단가이」가 된다. */
function subjP(word) {
  const s = String(word || '')
  const last = s.charCodeAt(s.length - 1)
  if (!(last >= 0xac00 && last <= 0xd7a3)) return '이'   /* 한글이 아니면 보수적으로 '이' */
  return (last - 0xac00) % 28 !== 0 ? '이' : '가'
}

/* ★ 버리면 안 되는 칸이 거절돼 **아무것도 기록하지 않은** 경우의 안내.
   거래는 저장되지 않았다 — 「일부 미반영」(연보라)이 아니라 오류(빨강)다. */
export function blockedText(blocked, labelOf = colLabel) {
  const names = (blocked || []).map(labelOf)
  const n = names.join(', ')
  return `${n}${subjP(names[names.length - 1])} 저장되지 않아 거래를 기록하지 않았습니다. 약제과 관리자에게 알려 주세요`
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
   opts    : { retries = 3, label = 'drugs', neverDrop = [] }

   ★ neverDrop — 「버리고 재시도하면 안 되는 칸」. 거기 적힌 칸이 거절되면
     **그 칸을 뺀 요청을 아예 보내지 않고** blocked 에 담아 끝낸다.
     입출고(transactions)의 금액·거래단가·일자가 그렇다 — 보내는 순간
     trg_apply_tx_to_inventory 가 재고를 반영해 버리므로, 보낸 뒤에 알리면 늦다.
     drugs 경로는 이 옵션을 쓰지 않아 지금까지와 똑같이 동작한다.

   반환 : { error, dropped: ['lot_no', …], blocked: ['total_amount', …],
            payload: 마지막으로 보낸 것 }
          blocked 가 비어 있지 않으면 **아무것도 기록되지 않았다**(error 도 함께 찬다). */
export async function saveWithFallback(payload, send, opts = {}) {
  const retries = opts.retries == null ? 3 : opts.retries
  const label = opts.label || 'drugs'
  const neverDrop = opts.neverDrop || []
  const dropped = []
  const blocked = []
  let cur = payload
  let res = await send(cur)

  for (let r = 0; r < retries && res && res.error; r++) {
    const col = droppedColumnOf(res.error)
    if (!col) break
    if (neverDrop.indexOf(col) !== -1) {
      /* ★ 재시도를 보내지 않는다 — 보내면 그 거래가 재고에 반영된 채 값만 빠진다 */
      console.warn(`[${label}] ★ 버리면 안 되는 칸이라 재시도하지 않는다:`, col, '/ 원인:', res.error.message)
      blocked.push(col)
      break
    }
    /* ★ 어느 경로에서든 흔적을 남긴다 — 예전에 warn 조차 없던 3곳(유효기한·사용점검) 포함 */
    console.warn(`[${label}] 미존재 컬럼 자동 제거:`, col, '/ 원인:', res.error.message)
    dropped.push(col)
    cur = omit(cur, col)
    res = await send(cur)
  }

  return { error: (res && res.error) || null, dropped, blocked, payload: cur }
}
