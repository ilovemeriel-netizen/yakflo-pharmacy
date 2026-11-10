/* 가루약 환자 「분리번호」 — 약품 정보로 **그때그때 계산**한다. DB 에 저장하지 않는다.
 *
 * ★ 왜 저장하지 않나 (2026-11-10 이정화 님 결정)
 *   `drugs` 에 칸을 더하지 않는다. 번호는 ATC·성분·제형에서 나오므로
 *   약이 제네릭으로 바뀌어도 **저절로 따라온다** — 이어받기 장치가 필요 없다.
 *   중지된 약은 목록 조건(status='사용')에서 **저절로 빠진다**.
 *
 * ★ 규칙에 약품코드를 적지 않는다
 *   예외(9번·가루 위험)도 **ATC 로** 지정한다. 약이 바뀌어 코드가 달라져도
 *   성분이 같으면 그대로 걸린다. 화면 코드에 약품코드를 박는 방식은 쓰지 않는다.
 *
 * ★ 모르면 추측하지 않는다
 *   규칙에 안 걸리면 「확인 필요」로 둔다. 번호를 지어내면 조제실이 그것을 믿는다.
 *
 * ★ 이 파일은 **읽기만** 한다. DB 를 건드리지 않는다.
 */

/* 번호 이름 — 원본 엑셀(「가루약 환자 약제 분리번호 지정」)의 구분 글자 그대로 */
export const GROUP_NAMES = {
  1: '일반 정제',
  2: '혈압약/심장약',
  3: '항혈전제',
  4: '변비약',
  5: '당뇨약',
  6: '일반 캡슐제',
  7: '향정신성의약품',
  8: '항혈전제(캡슐)',
  9: '그 외 분리 필요한 약제',
}
export const GROUP_NOS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
/* 약이 많아 **기본으로 접어 두는** 번호 (2026-11-10 이정화 님 결정) */
export const FOLDED_NOS = [1, 6]

export const MANUAL = '수기조제'   /* 마약 · 액체·가루 제형 — 분리번호를 매기지 않는다 */
export const CHECK = '확인 필요'   /* 규칙에 안 걸림 — 번호를 추측하지 않는다 */

/* ── 예외 — 전부 ATC 로 지정한다 ──────────────────────────────────── */

/* 9번으로 못 박는 성분 */
export const NINE_ATC = [
  { atc: 'A03AB02', why: '예외 9번 — 글리코피롤레이트(ATC A03AB02)' },
  { atc: 'A12BA01', why: '예외 9번 — 염화칼륨(ATC A12BA01, 케이콘틴 계열)' },
]

/* 가루 위험 성분 — 가루를 들이마시면 위험한 약.
     no: 9    = 번호도 9번으로 못 박는다
     no: null = 번호는 **일반 규칙**을 따르고 표시만 붙인다 */
export const HAZARD_ATC = [
  {
    atc: 'G04CB01', no: 9, note: '',
    why: '가루 위험 — 피나스테리드(ATC G04CB01) · 가루 흡입 시 기형아 위험',
  },
  {
    atc: 'G04CB02', no: null, note: '재확인 필요',
    why: '가루 위험 — 두타스테리드(ATC G04CB02) · 가루 흡입 시 기형아 위험',
  },
]

/* ── 제형 — 이름의 제형 글자로만 가린다 ────────────────────────────
   ★ 가리는 **순서가 보장**이다: 캡슐 → 정 → 액체.
     「삼천당산화마그네슘정250mg」 은 「산」도 들었지만 **정**이 먼저 걸려야 한다.
     순서를 바꾸면 「산·액」 글자가 든 정제·캡슐이 수기조제로 잘못 빠진다.
     (2026-11-10 실측 — 그런 이름이 16종 있고, 지금 규칙에서 잘못 빠진 약은 0종) */
export const CAP_RE = /캡슐|캅셀/                        /* 「캅셀」 표기 포함 */
export const TAB_RE = /정/
export const LIQ_RE = /시럽|현탁액|솔루션|과립|산|액|mL|㎖/  /* 빻을 수 없는 제형 */

const S = v => String(v == null ? '' : v)

/** 이름에서 제형을 가린다. '캡슐' | '정' | '액체' | '' */
export function formOf(name) {
  const n = S(name)
  if (CAP_RE.test(n)) return '캡슐'
  if (TAB_RE.test(n)) return '정'
  if (LIQ_RE.test(n)) return '액체'
  return ''
}

/**
 * 한 약의 분리번호를 정한다.
 * @param {{drug_name?:string, atc_code?:string, narcotic_type?:string}} d
 * @returns {{no:number|null, label:string, why:string, hazard:string, note:string}}
 *   no    — 1~9, 또는 null(번호 없음)
 *   label — 번호 이름, 또는 '수기조제' / '확인 필요'
 */
export function decideGroup(d) {
  const drug = d || {}
  const atc = S(drug.atc_code).toUpperCase()
  const nm = S(drug.drug_name)
  const nt = S(drug.narcotic_type)
  const fm = formOf(nm)
  const hz = HAZARD_ATC.find(x => atc === x.atc)
  const HZ = hz ? hz.why : ''
  const NOTE = hz ? hz.note : ''
  const out = (no, label, why) => ({ no, label, why, hazard: HZ, note: NOTE })

  /* ① 마약 — 분리번호를 매기지 않는다 */
  if (nt === '마약') return out(null, MANUAL, '마약(narcotic_type=마약) — 수기조제')

  /* ② 액체·가루 제형 — **약 종류와 상관없이** 수기조제. ATC 보다 먼저 본다.
        빻을 수 없는 제형이면 어떤 약이든 분리번호가 뜻이 없다.
        (2026-11-10 이정화 님 결정 — 이 순서 바꿈으로 움직인 약은 변비 4종뿐) */
  if (fm === '액체') {
    return out(null, MANUAL, '액체·가루 제형(시럽·현탁액·산·과립·액·솔루션) — 빻을 수 없어 수기조제')
  }

  /* ③ 가루 위험 성분 가운데 9번으로 못 박은 것 */
  if (hz && hz.no === 9) return out(9, GROUP_NAMES[9], hz.why + ' → 기본 9번')

  /* ④ 9번 예외 성분 */
  const nine = NINE_ATC.find(x => atc === x.atc)
  if (nine) return out(9, GROUP_NAMES[9], nine.why)

  /* ⑤ 향정 */
  if (nt === '향정') return out(7, GROUP_NAMES[7], '향정(narcotic_type=향정)')

  /* ⑥ 항혈전 — 캡슐이면 8, 정이면 3 */
  if (atc.startsWith('B01')) {
    if (fm === '캡슐') return out(8, GROUP_NAMES[8], 'ATC B01 항혈전 + 캡슐')
    if (fm === '정') return out(3, GROUP_NAMES[3], 'ATC B01 항혈전 + 정')
    return out(null, CHECK, 'ATC B01 항혈전인데 제형을 가릴 수 없음 — 번호를 추측하지 않음')
  }

  /* ⑦ 당뇨 */
  if (atc.startsWith('A10')) return out(5, GROUP_NAMES[5], 'ATC A10 당뇨')

  /* ⑧ 변비 — A06, 그리고 마그밀 계열
       ★ 마그밀 계열만 4번 — A02AA(마그네슘 제산제)로 **좁힌다.**
         A02A 전체로 넓히면 파마탄산칼슘정·애니탈정·타스나정 같은 제산제·소화제가
         변비약으로 섞인다(2026-11-10 실측 5종). 그건 추측이므로 하지 않는다. */
  if (atc.startsWith('A06')) return out(4, GROUP_NAMES[4], 'ATC A06 변비')
  if (atc.startsWith('A02AA')) return out(4, GROUP_NAMES[4], 'ATC A02AA 마그네슘 제산제(마그밀 계열) → 4번')

  /* ⑨ 혈압/심장 — C01~C09. ★ C10(고지혈증)은 뺀다 */
  if (/^C0[1-9]/.test(atc)) {
    return out(2, GROUP_NAMES[2], 'ATC ' + atc.slice(0, 3) + ' 혈압/심장 (C10 고지혈증 제외)')
  }

  /* ⑩ 나머지 — 제형으로 1·6. 제형을 못 가리면 「확인 필요」 */
  if (fm === '캡슐') return out(6, GROUP_NAMES[6], '위 규칙에 안 걸림 + 캡슐 → 6번')
  if (fm === '정') return out(1, GROUP_NAMES[1], '위 규칙에 안 걸림 + 정 → 1번')
  return out(null, CHECK, '규칙에 안 걸림 · 제형을 가릴 수 없음 — 번호를 추측하지 않음')
}

/** 기준표에 넣을 약인가 — 사용 중인 경구제만 */
export function isTarget(d) {
  const drug = d || {}
  return S(drug.status).trim() === '사용' && S(drug.category).trim() === '경구제'
}

const KO = (a, b) => String(a).localeCompare(String(b), 'ko')

/**
 * ★ 번호를 정하는 **유일한 길목** — 가루약분리 화면·약품 등록·수정 창이 **모두 이 함수**를 쓴다.
 *   세 곳이 어긋날 수 없게 한 곳에 모아 둔다.
 *
 *   ① 사람이 고친 번호가 있으면  →  그 번호 (manual: true)
 *   ② 없으면                     →  decideGroup() 자동 계산
 *   ③ 자동도 못 정하면           →  「확인 필요」 (추측 금지)
 *
 *   ★ 고친 번호가 있어도 **자동 계산 결과를 함께 돌려준다**(`auto`).
 *     화면이 「자동이면 N번 입니다」를 늘 보여 줄 수 있어야 하기 때문이다
 *     — 사람이 고친 것인지, 규칙이 그렇게 말한 것인지 한눈에 갈라 보라고.
 *
 * @param {object} d        약 한 줄
 * @param {object} [ovMap]  { 약품코드: { group_no, note, updated_by, updated_at, … } }
 */
export function resolveGroup(d, ovMap) {
  const auto = decideGroup(d)
  const ov = (ovMap || {})[(d && d.drug_code) || '']
  const n = ov == null ? null : Number(ov.group_no)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    return { ...auto, manual: false, override: null, auto }
  }
  return {
    no: n,
    label: GROUP_NAMES[n],
    why: '사람이 고친 번호입니다' + (ov.note ? ' — ' + ov.note : ''),
    /* 가루 위험은 **규칙이 정한다** — 번호를 고쳐도 위험 표시는 그대로 붙어 있어야 한다 */
    hazard: auto.hazard,
    note: auto.note,
    manual: true,
    override: ov,
    auto,
  }
}

/**
 * 기준표 한 벌을 만든다.
 * @param {Array} drugs    약품 전체(상태·구분은 여기서 거른다)
 * @param {object} [ovMap] 사람이 고친 번호 { 약품코드: {group_no, …} }
 */
export function buildPowderTable(drugs, ovMap) {
  const rows = (drugs || []).filter(isTarget)
    .map(d => ({ d, r: resolveGroup(d, ovMap) }))
    .sort((a, b) => KO(a.d.drug_name, b.d.drug_name))
  const groups = GROUP_NOS.map(no => ({
    no,
    name: GROUP_NAMES[no],
    list: rows.filter(x => x.r.no === no),
    folded: FOLDED_NOS.includes(no),
  }))
  const manual = rows.filter(x => x.r.label === MANUAL)
  const check = rows.filter(x => x.r.label === CHECK)
  return {
    rows, groups, manual, check,
    total: rows.length,
    hazard: rows.filter(x => !!x.r.hazard),
    /* 사람이 고친 줄 — 요약 띠에 쓴다. 「수기조제(MANUAL)」와 헷갈리지 않게 이름을 edited 로 둔다. */
    edited: rows.filter(x => x.r.manual),
  }
}

/** 고친 번호 줄들을 { 약품코드: 줄 } 로 바꾼다. 같은 약이 둘이면 뒤엣것이 이긴다(DB 는 유일 인덱스로 막는다). */
export function overridesToMap(rows) {
  const m = {}
  for (const r of rows || []) {
    const k = S(r && r.drug_code).trim()
    if (k) m[k] = r
  }
  return m
}

/** 검색 — 약품명·성분명(한글/영문)으로 찾는다. 약품코드도 받아 준다. */
export function searchPowder(rows, q) {
  const s = S(q).trim().toLowerCase()
  if (!s) return []
  return (rows || []).filter(x => {
    const d = x.d || {}
    return S(d.drug_name).toLowerCase().includes(s)
      || S(d.ingredient_kr).toLowerCase().includes(s)
      || S(d.ingredient_en).toLowerCase().includes(s)
      || S(d.drug_code).toLowerCase() === s
  })
}
