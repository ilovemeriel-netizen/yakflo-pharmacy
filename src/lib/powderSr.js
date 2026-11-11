/* 가루약 1번(일반 정제) 안의 **서방정 표시** — 사람이 정한 것만 읽고 쓴다. (2026-11-11 · 0120)
 *
 * ★ 표 `drug_powder_sr` 는 **사람이 손댄 약만** 담는다. 0줄로 시작한다.
 *   줄이 없으면 **이름에 「서방」**이 있는지로 본다 — `resolveSr()` 가 그 순서를 정한다.
 *
 * ★ 한 칸으로 넣기·빼기를 둘 다 한다.
 *     is_sr = true  → 이름에 「서방」이 없어도 서방정으로 본다
 *     is_sr = false → 이름에 「서방」이 있어도 서방정에서 뺀다
 *   되돌리기는 **줄 지우기**다 — 자동으로 돌아간다.
 *
 * ★ 분리번호를 바꾸지 않는다. 이 표는 **보여 주는 방법**만 정한다.
 *
 * ★ 1,000줄 함정 — 줄이 늘어도 쪽을 나눠 끝까지 읽는다.
 */
import { supabase } from './supabase'

export const TABLE = 'drug_powder_sr'
export const COLS = 'drug_code,is_sr,note,created_by,created_at,updated_by,updated_at'

let cache = null

/** 다음 읽기에서 다시 가져오게 한다 (고친 뒤에 부른다) */
export function invalidateSr() { cache = null }

/** 서방정 표시 줄을 **전부** 읽는다. { rows, error } */
export async function fetchSr() {
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
export function loadSr() {
  if (!cache) cache = fetchSr()
  return cache
}

/**
 * 여러 약품의 서방정 표시를 한꺼번에 정한다.
 * ★ 한 번의 upsert 로 보낸다 — 나눠 보내면 중간에 끊겼을 때 절반만 바뀐다.
 * @param {string[]} codes
 * @param {boolean}  isSr   true=서방정으로 · false=서방정에서 빼기
 * @param {string}  [note]  까닭 (선택)
 */
export async function setSrMany(codes, isSr, note) {
  if (typeof isSr !== 'boolean') {
    return { error: { message: '서방정 표시는 참/거짓만 됩니다 (받은 값: ' + isSr + ')' }, saved: 0 }
  }
  const list = [...new Set((codes || []).map(c => String(c).trim()).filter(Boolean))]
  if (!list.length) return { error: null, saved: 0, sent: 0 }
  const rows = list.map(code => ({ drug_code: code, is_sr: isSr, note: note ? String(note) : null }))
  const { data, error } = await supabase.from(TABLE)
    .upsert(rows, { onConflict: 'tenant_id,drug_code' }).select('drug_code')
  if (!error) invalidateSr()
  return { error: error || null, saved: (data || []).length, sent: rows.length }
}

/** 서방정 표시를 **되돌린다** — 줄을 지우면 이름으로 보는 자동으로 돌아간다. */
export async function clearSr(code) {
  const { error } = await supabase.from(TABLE).delete().eq('drug_code', String(code))
  if (!error) invalidateSr()
  return { error: error || null }
}
