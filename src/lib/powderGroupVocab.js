/* 가루약 분리번호 **목록**을 읽는다 — `drug_vocab` 의 `axis='powder_group'`. (2026-11-11 · 0121)
 *
 * ★ 왜 표에서 읽나
 *   번호와 이름이 코드에 박혀 있으면 번호를 하나 더할 때마다 배포해야 한다.
 *   표에 두면 **화면에서 더하고 이름을 바꾸고 숨길** 수 있다.
 *
 * ★ `drug_vocab` 에는 `tenant_id` 가 없다 — **약국이 함께 쓰는 표**다.
 *   지금은 약국이 하나라 문제가 없지만, 여럿이 되면 분리번호 이름이 공유된다.
 *   (백로그에 적어 두었다.)
 *
 * ★ 못 읽으면 **기본값(powderGroup.js 의 GROUP_NOS·GROUP_NAMES)** 으로 돌아간다.
 *   목록을 못 읽었다고 화면이 비면 안 된다.
 *
 * ★ `code` 는 글자다. 차례는 `sort_order` 로 잡는다 — '10' 이 '2' 앞에 오지 않게.
 */
import { supabase } from './supabase'
import { GROUP_NOS, GROUP_NAMES } from './powderGroup'

export const TABLE = 'drug_vocab'
export const AXIS = 'powder_group'
export const COLS = 'code,label,sort_order,is_active,note'

let cache = null

/** 다음 읽기에서 다시 가져오게 한다 */
export function invalidateVocab() { cache = null }

/** 기본값 — 못 읽었을 때 쓴다 */
export function fallbackVocab() {
  return GROUP_NOS.map((no, i) => ({ no, label: GROUP_NAMES[no], sort: i + 1, active: true, note: '' }))
}

/** 읽어 온 줄을 화면이 쓰는 꼴로 바꾼다. 켜진 줄만, sort_order 차례로. */
export function toVocab(rows) {
  const out = []
  for (const r of rows || []) {
    const no = Number(r && r.code)
    if (!Number.isInteger(no) || no < 1) continue
    if (r.is_active === false) continue
    out.push({
      no,
      label: String(r.label || GROUP_NAMES[no] || ('' + no)),
      sort: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : no,
      active: true,
      note: String(r.note || ''),
    })
  }
  out.sort((a, b) => a.sort - b.sort || a.no - b.no)
  return out
}

/** 번호 → 이름 */
export function vocabNames(vocab) {
  const m = {}
  for (const v of vocab || []) m[v.no] = v.label
  return m
}

/** 목록을 읽는다. { vocab, error, fell } — fell 은 「기본값으로 돌아갔다」 */
export async function fetchGroupVocab() {
  const { data, error } = await supabase.from(TABLE)
    .select(COLS).eq('axis', AXIS).order('sort_order')
  if (error) return { vocab: fallbackVocab(), error, fell: true }
  const v = toVocab(data)
  if (!v.length) return { vocab: fallbackVocab(), error: null, fell: true }
  return { vocab: v, error: null, fell: false }
}

/** 읽어 둔 것을 나눠 쓴다 */
export function loadGroupVocab() {
  if (!cache) cache = fetchGroupVocab()
  return cache
}
