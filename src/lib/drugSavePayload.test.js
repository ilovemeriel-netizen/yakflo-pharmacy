/* @vitest-environment node */
/* ═══════════════════════════════════════════════════════════════════════════
   저장 페이로드 ↔ 마이그레이션 스키마 대조 — 「조용히 버려지는 컬럼」 재발 차단

   ★ 막으려는 결함 (인계문서 함정 #22 · 같은 유형 3번 발생)
     PostgREST 가 PGRST204(`Could not find the 'x' column of 'drugs' in the
     schema cache`)를 돌려주면, 저장 코드가 **오류 문구에서 컬럼명을 뽑아 그 키를
     페이로드에서 지우고 재시도**한다. 재시도가 성공하므로 **사용자에게는 「저장
     완료」로 보이고 값만 사라진다.** 흔적은 console.warn 한 줄뿐이다.
       1 additive      (#243) · 2 compound_type (#243)
       3 efficacy_class(#262/0081) ← payload 엔 있는데 DB 컬럼이 없어 폴백이 은폐

   ★ 그래서 이 시험은 **폴백이 발동할 상황 자체를 코드에서 없앤다** —
     저장 경로가 보내는 키가 전부 마이그레이션에 정의된 컬럼인지 본다.
     없는 키가 하나라도 있으면 실패한다. 폴백 자체는 손대지 않는다
     (함정 #22: 「폴백은 일시적 스키마 불일치에서 저장이 통째로 실패하는 것을
     막는 안전장치다 — 유지한다」).

   ★ 기준은 **마이그레이션**이다(운영 DB 조회 없음). 시험이 네트워크·비밀값에
     의존하지 않아야 CI 에서 돌 수 있다. supabase/migrations/*.sql 을 파일명
     순서로 읽어 create table / add column / drop column / rename column 을 접는다.

   ★ App.jsx 소스를 직접 읽어 못을 박는다 — lib/vaccineRoute.test.js 가
     ROUTES 를 같은 방식으로 고정한다. 저장 경로가 움직이면 닻(anchor)을 못 찾아
     이 시험이 먼저 걸린다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { FIELD_DEFS } from './drugRules'

const root = process.cwd()
const rd = p => readFileSync(resolve(root, p), 'utf8')

/* ── 마이그레이션에서 컬럼 집합 접기 ──────────────────────────────────────── */
function columnsFromMigrations(table) {
  const dir = resolve(root, 'supabase/migrations')
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  const cols = new Set()
  const t = '(?:public\\.)?' + table

  for (const f of files) {
    /* 줄 주석 제거 — 주석 안의 예시 DDL 이 집계되면 안 된다 */
    const sql = rd('supabase/migrations/' + f).split(/\r?\n/)
      .filter(l => !/^\s*--/.test(l)).join('\n')

    /* CREATE TABLE <t> ( ... ) — 괄호 깊이를 세어 본문을 잘라낸다 */
    const m = new RegExp('create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?' + t + '\\s*\\(', 'i').exec(sql)
    if (m) {
      let i = m.index + m[0].length, depth = 1
      while (i < sql.length && depth > 0) { const c = sql[i]; if (c === '(') depth++; else if (c === ')') depth--; i++ }
      const body = sql.slice(m.index + m[0].length, i - 1)
      /* 최상위 콤마로 쪼갠 뒤 각 조각의 첫 식별자를 컬럼명으로 본다 */
      let d = 0, cur = ''
      const parts = []
      for (const c of body) {
        if (c === '(') d++
        if (c === ')') d--
        if (c === ',' && d === 0) { parts.push(cur); cur = '' } else cur += c
      }
      parts.push(cur)
      for (const p of parts) {
        const s = p.trim()
        if (!s) continue
        if (/^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i.test(s)) continue
        const id = s.match(/^"?([a-z_][a-z0-9_]*)"?/i)
        if (id) cols.add(id[1])
      }
    }

    /* ALTER TABLE <t> … ; — 한 문장에 여러 절이 올 수 있고 여러 줄에 걸칠 수 있다 */
    const at = new RegExp('alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?' + t + '\\b([\\s\\S]*?);', 'gi')
    for (const a of sql.matchAll(at)) {
      const body = a[1]
      for (const x of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) cols.add(x[1])
      for (const x of body.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) cols.delete(x[1])
      for (const x of body.matchAll(/rename\s+column\s+"?([a-z_][a-z0-9_]*)"?\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) { cols.delete(x[1]); cols.add(x[2]) }
    }
  }
  return cols
}

const DRUGS_COLS = columnsFromMigrations('drugs')
const TX_COLS = columnsFromMigrations('transactions')

/* ── 저장 경로의 페이로드 키 뽑기 ─────────────────────────────────────────
   from 닻 다음부터 to 닻 전까지를 잘라, 그 안의 **속성 키만** 모은다.
   ★ 키 정규식이 `[{,]` 로 시작하는 이유 — 그냥 `ident:` 로 찾으면
     삼항연산자(`? null : f.x`)의 `null` 까지 키로 잡힌다.
   to: null 이면 그 줄 끝까지(한 줄짜리 리터럴).
   v: 페이로드 변수명 — `ud.foo = …` 처럼 뒤에 덧붙이는 키까지 모은다. */
function keysOf(src, site) {
  const i = src.indexOf(site.from)
  expect(i, `닻을 찾지 못했다 — 저장 경로가 움직였는지 확인할 것: ${site.n}`).toBeGreaterThanOrEqual(0)
  expect(src.indexOf(site.from, i + 1), `닻이 두 번 이상 나온다 — 더 긴 닻으로 바꿀 것: ${site.n}`).toBe(-1)

  const j = site.to === null ? src.indexOf('\n', i) : src.indexOf(site.to, i)
  expect(j, `to 닻을 찾지 못했다: ${site.n}`).toBeGreaterThan(i)
  const slice = src.slice(i, j)

  const keys = new Set()
  for (const m of slice.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[1])
  if (site.v) for (const m of slice.matchAll(new RegExp('\\b' + site.v + '\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)', 'g'))) keys.add(m[1])
  /* ['a','b'].forEach(k => ud[k] = …) 로 넣는 키들 */
  for (const m of slice.matchAll(/\[((?:\s*'[\w]+'\s*,?)+)\]\s*\.forEach/g))
    for (const k of m[1].matchAll(/'([^']+)'/g)) keys.add(k[1])
  return [...keys].sort()
}

/* ── 검사 대상 ────────────────────────────────────────────────────────────
   ★ n 개수는 **정확값**이다 — 추출이 조용히 0 개를 집고 통과하는 일을 막는다.
     페이로드에서 칸을 일부러 더하거나 뺐다면 이 숫자도 함께 고칠 것
     (인쇄 표식 개수 불변 검사와 같은 취지). */
const APP_SITES = [
  /* ★ drugs 6경로의 to 닻은 2026-10-29 바뀌었다 — 재시도 루프를 lib/saveWithFallback.js 로
       모았으므로 페이로드 끝이 더는 `supabase.from('drugs')…` 가 아니라 `saveWithFallback(…)` 이다.
       페이로드 리터럴 자체는 그대로이므로 키 개수는 변하지 않았다. */
  { n: 'drugs INSERT · 약품 등록 모달 (DrugEditModal.saveNew)', table: 'drugs', count: 38, v: 'row',
    from: "const _initQty = Number(f.current_qty) || 0; const _atc = decomposeAtc(f.atc_code); const row = {",
    to: "await saveWithFallback(row, p => supabase.from('drugs').insert([p])" },
  { n: 'drugs UPDATE · 약품 정보 수정 모달 (DrugEditModal.save)', table: 'drugs', count: 38, v: 'ud',
    from: "const ud = { status: f.status, is_narcotic:",
    to: "await saveWithFallback(ud, p => dr.id ?" },
  { n: 'drugs UPDATE · 유효기한 표 인라인 (ExpiryTable.saveField)', table: 'drugs', count: 3, v: 'ud',
    from: "async function saveField(d,field,value){",
    to: "await saveWithFallback(ud,p=>supabase.from('drugs').update(p)" },
  { n: 'drugs UPDATE · 유효기한 비고 (ExpiryTable.saveNote)', table: 'drugs', count: 1, v: null,
    from: "async function saveNote(d,val){",
    to: "flash(d.drug_code+':expiry_notes'" },
  { n: 'drugs INSERT · 약품 등록 화면 (#register submit)', table: 'drugs', count: 35, v: 'row',
    from: "const _atc=decomposeAtc(form.atc_code); const row={",
    to: "await saveWithFallback(row,p=>supabase.from('drugs').insert([p])" },
  { n: 'drugs UPDATE · 사용점검 표 인라인 (IdleTable.saveDrugField)', table: 'drugs', count: 2, v: 'ud',
    from: "async function saveDrugField(d, field, value) {",
    to: "await saveWithFallback(ud, p => supabase.from('drugs').update(p).eq('drug_code', d.drug_code)" },
  { n: 'drugs UPDATE · 사용점검 등록 모달 (IdleRegisterModal.save)', table: 'drugs', count: 2, v: 'ud',
    from: "const ud = { last_used_date: f.last_used_date || null, last_used_dept: f.last_used_dept || '' }",
    to: "await saveWithFallback(ud, p => supabase.from('drugs').update(p).eq('drug_code', selCode)" },

  /* transactions — 같은 폴백이 4곳에 더 있다. 검사만 하고 코드는 고치지 않는다. */
  { n: 'transactions INSERT · 재고 조정', table: 'transactions', count: 6, v: null,
    from: "const tx = { drug_code: dr.drug_code, type: TX_ADJUST,", to: null },
  { n: 'transactions INSERT · 입출고 모달', table: 'transactions', count: 14, v: null,
    from: "const tx = { drug_code: dr.drug_code, type: txType,", to: null },
  { n: 'transactions INSERT · 입출고 단건', table: 'transactions', count: 14, v: null,
    from: "const tx={drug_code:selDrug.drug_code,type:tab,", to: null },
  { n: 'transactions INSERT · 입출고 엑셀', table: 'transactions', count: 14, v: null,
    from: "const tx={drug_code:r.drug_code,type:tab,", to: null },
]

describe('마이그레이션 스키마 접기', () => {
  it('drugs·transactions 컬럼을 읽어낸다', () => {
    expect(DRUGS_COLS.size).toBeGreaterThan(60)
    expect(TX_COLS.size).toBeGreaterThan(10)
    /* 과거 사고 3건의 필드가 전부 컬럼으로 존재해야 한다 */
    for (const c of ['additive', 'compound_type', 'efficacy_class']) {
      expect(DRUGS_COLS.has(c), `마이그레이션에 drugs.${c} 가 없다`).toBe(true)
    }
    /* 금액 철칙에 쓰이는 3종 (CLAUDE.md) */
    for (const c of ['purchase_price', 'price_unit', 'edi_price']) {
      expect(DRUGS_COLS.has(c), `마이그레이션에 drugs.${c} 가 없다`).toBe(true)
    }
  })
})

describe('App.jsx 저장 경로 11곳 — 보내는 키가 전부 실재 컬럼인가', () => {
  const SRC = rd('src/App.jsx')
  for (const site of APP_SITES) {
    it(site.n, () => {
      const keys = keysOf(SRC, site)
      expect(keys.length, `뽑은 키 개수가 달라졌다 — 페이로드가 바뀌었는지 확인할 것 (뽑힌 키: ${keys.join(' ')})`).toBe(site.count)
      const cols = site.table === 'drugs' ? DRUGS_COLS : TX_COLS
      const unknown = keys.filter(k => !cols.has(k))
      expect(unknown, `★ ${site.table} 에 없는 컬럼을 보낸다 — PGRST204 로 조용히 버려진다: ${unknown.join(', ')}`).toEqual([])
    })
  }
})

describe('대량 등록 경로 6곳 — drugRules.normalizeDrugRow 가 만드는 키', () => {
  /* ★ BulkUploadModal.jsx 3곳과 lib/drugBulk.js 3곳은 둘 다
       normalizeDrugRow 의 결과를 그대로 보낸다 → 그 함수의 출력 키만 보면 6곳이 덮인다.
       normalizeDrugRow 는 fields[fd.col] 에 담는다(fd.key 가 아니다 —
       예: key 'notes' → col 'memo'). 거기에 직접 넣는 3키를 더한다. */
  const EXTRA = ['drug_code', 'drug_name', 'is_narcotic', 'current_qty']
  const keys = [...new Set([...FIELD_DEFS.map(f => f.col), ...EXTRA])].sort()

  it('FIELD_DEFS 의 col 이 전부 drugs 컬럼으로 실재한다', () => {
    expect(keys.length).toBeGreaterThan(25)
    const unknown = keys.filter(k => !DRUGS_COLS.has(k))
    expect(unknown, `★ drugs 에 없는 컬럼을 보낸다 — PGRST204 로 조용히 버려진다: ${unknown.join(', ')}`).toEqual([])
  })

  it('★ FIELD_DEFS 는 col 을 쓴다 — key 로 보내면 엉뚱한 컬럼에 저장된다', () => {
    const src = rd('src/lib/drugRules.js')
    expect(src).toContain('fields[fd.col]')
    expect(src).not.toContain('fields[fd.key]')
    /* 실제로 key ≠ col 인 항목이 있어 이 구분이 중요하다 */
    expect(FIELD_DEFS.some(f => f.key !== f.col)).toBe(true)
  })

  it('금액 파생 컬럼은 대량 경로가 쓰지 않는다 (CLAUDE.md 단가 철칙)', () => {
    expect(keys).not.toContain('price_unit')
    expect(keys).not.toContain('current_amount')
  })
})

describe('폴백 재시도 루프 개수 — 줄면 좋고, 늘면 멈춰 세운다', () => {
  /* ★ 이 숫자는 「재시도 조건이 몇 군데 흩어져 있나」다.
       · 2026-10-29 2단계: drugs 12경로의 루프를 lib/saveWithFallback.js **한 곳**으로 모았다.
       · 2026-10-29 3단계: transactions 4경로도 같은 도우미로 옮겼다
         → App.jsx 는 **4 → 0**. 이제 조건·횟수·정규식은 도우미에만 있다.
       루프를 더 없앨 곳은 없다. 새 저장 경로를 만들었으면 그 경로를 APP_SITES 에
       올린 뒤 숫자를 늘릴 것. 모르고 늘지 않게 못을 박는다. */
  const EXPECT = [
    ['src/lib/saveWithFallback.js', 1],  /* 단일 출처 — 조건·횟수·정규식이 여기에만 있다 */
    ['src/App.jsx', 0],                  /* drugs 6 + transactions 4 전부 도우미로 이관 */
    ['src/BulkUploadModal.jsx', 0],      /* insertOne · insertChunk · updateOne → 도우미로 이관 */
    ['src/lib/drugBulk.js', 0],          /* 같은 3종 → 도우미로 이관 */
  ]
  for (const [file, n] of EXPECT) {
    it(`${file} 의 재시도 루프 ${n}곳`, () => {
      const hits = rd(file).match(/includes\('column'\)/g) || []
      expect(hits.length).toBe(n)
    })
  }

  it('★ 저장 16경로가 모두 도우미를 거친다 — 호출 16곳', () => {
    const calls = f => (rd(f).match(/saveWithFallback\(/g) || []).length
    /* App.jsx = drugs 6 + transactions 4 */
    expect(calls('src/App.jsx'), 'App.jsx drugs 6 + transactions 4').toBe(10)
    expect(calls('src/BulkUploadModal.jsx')).toBe(3)
    expect(calls('src/lib/drugBulk.js')).toBe(3)
  })

  it('★ 호출부에 직접 재시도가 한 곳도 남아 있지 않다', () => {
    /* `'<col>' column` 정규식을 직접 쓰는 곳 — 도우미 1곳뿐이어야 한다. */
    const re = f => (rd(f).match(/match\(\/'\(\[\^'\]\+\)' column\//g) || []).length
    expect(re('src/App.jsx'), 'App.jsx — transactions 까지 이관됐다').toBe(0)
    expect(re('src/BulkUploadModal.jsx')).toBe(0)
    expect(re('src/lib/drugBulk.js')).toBe(0)
    expect(re('src/lib/saveWithFallback.js'), '도우미에 정규식이 정확히 한 번 — 단일 출처').toBe(1)
  })

  it("★ saveNote 는 빈 객체로 재시도하지 않는다 — 비고가 확정 미저장인데 성공 표시가 떴다", () => {
    const SRC = rd('src/App.jsx')
    const i = SRC.indexOf('async function saveNote(d,val){')
    expect(i).toBeGreaterThanOrEqual(0)
    const slice = SRC.slice(i, SRC.indexOf("flash(d.drug_code+':expiry_notes'", i))
    /* ★ 먼저 슬라이스가 비지 않았음을 확인한다 — 빈 문자열은 not.toContain 을 그냥 통과한다 */
    expect(slice).toContain("update({expiry_notes:val||null})")
    expect(slice).not.toContain('update({})')
    expect(slice).not.toContain("includes('column')")
  })
})
