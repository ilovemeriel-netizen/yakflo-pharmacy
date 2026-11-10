/* 가루약 분리번호 — 사람이 고친 번호를 읽고 쓴다. (2026-11-10 · 0119)
 *
 * ★ 표 `drug_powder_override` 는 **고친 약만** 담는다. 지금은 0줄로 시작한다.
 *   줄이 없으면 규칙(ATC·성분·제형)으로 계산한다 — `resolveGroup()` 이 그 순서를 정한다.
 *
 * ★ 읽기는 **한 번만** 하고 나눠 쓴다.
 *   약품 등록 창·수정 창·가루약분리 화면이 모두 같은 값을 봐야 하고,
 *   창을 열 때마다 조회하면 쓸데없이 느려진다. 고치고 나면 `invalidateOverrides()` 로 버린다.
 *
 * ★ 1,000줄 함정 — 줄이 아무리 늘어도 쪽을 나눠 끝까지 읽는다.
 *   지금은 몇 줄뿐이지만, 「지금은 적으니까」로 두면 나중에 조용히 잘린다.
 */
import { supabase } from './supabase'

export const TABLE = 'drug_powder_override'
export const COLS = 'drug_code,group_no,note,created_by,created_at,updated_by,updated_at'

let cache = null   /* Promise<Array> — 한 번 읽은 것을 나눠 쓴다 */

/** 다음 읽기에서 다시 가져오게 한다 (고친 뒤에 부른다) */
export function invalidateOverrides() { cache = null }

/** 고친 번호 줄을 **전부** 읽는다. { rows, error } */
export async function fetchOverrides() {
  const PAGE = 1000, MAX_PAGES = 20
  let rows = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE
    const { data, error } = await supabase.from(TABLE)
      .select(COLS).order('drug_code').range(from, from + PAGE - 1)
    if (error) return { rows: [], error }
    rows = rows.concat(data || [])
    if (!data || data.length < PAGE) break
  }
  return { rows, error: null }
}

/** 읽어 둔 것을 쓰거나, 없으면 읽는다. */
export function loadOverrides() {
  if (!cache) cache = fetchOverrides()
  return cache
}

/**
 * 번호를 정하거나 고친다 — 한 약품에 한 줄이므로 upsert 다.
 * @param {string} code  약품코드
 * @param {number} no    1~9
 * @param {string} [note] 까닭 (선택 — 비워도 된다)
 */
export async function setOverride(code, no, note) {
  const n = Number(no)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    return { error: { message: '분리번호는 1~9 만 됩니다 (받은 값: ' + no + ')' } }
  }
  const row = { drug_code: String(code), group_no: n, note: note ? String(note) : null }
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'tenant_id,drug_code' })
  if (!error) invalidateOverrides()
  return { error: error || null }
}

/**
 * 여러 약품에 같은 번호를 준다 — 체크해서 한꺼번에 바꿀 때.
 * ★ 한 번의 upsert 로 보낸다. 나눠 보내면 중간에 끊겼을 때 **절반만** 바뀐다.
 */
export async function setOverrideMany(codes, no, note) {
  const n = Number(no)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    return { error: { message: '분리번호는 1~9 만 됩니다 (받은 값: ' + no + ')' }, saved: 0 }
  }
  const list = [...new Set((codes || []).map(c => String(c).trim()).filter(Boolean))]
  if (!list.length) return { error: null, saved: 0 }
  const rows = list.map(code => ({ drug_code: code, group_no: n, note: note ? String(note) : null }))
  const { data, error } = await supabase.from(TABLE)
    .upsert(rows, { onConflict: 'tenant_id,drug_code' }).select('drug_code')
  if (!error) invalidateOverrides()
  return { error: error || null, saved: (data || []).length, sent: rows.length }
}

/** 고친 번호를 **되돌린다** — 줄을 지우면 자동 계산으로 돌아간다. */
export async function clearOverride(code) {
  const { error } = await supabase.from(TABLE).delete().eq('drug_code', String(code))
  if (!error) invalidateOverrides()
  return { error: error || null }
}
