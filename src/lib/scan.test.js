/* 바코드 스캔 로직 단위 검증 (PR-B).
   ★ DB 조회 경로는 supabase 를 목으로 갈아끼워 검증한다 — 운영 DB 를 건드리지 않는다.
   ★ ymd 는 보호 계통(App.jsx 82-89)과 같은 구현을 주입한다.
     lib 이 날짜 문자열을 스스로 만들지 않는다는 설계를 그대로 시험한다. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── supabase 목 ────────────────────────────────────────────────────────
   .from(t).select(...).in(...).eq(...)  /  .eq(...).maybeSingle()  /  .ilike(...)
   체이닝을 최소로 흉내낸다. 각 테이블의 응답은 DATA 로 주입한다. */
const DATA = { drug_barcodes: [], drugs: [], drug_master: [], tenant_members: [] }
vi.mock('./supabase', () => {
  const build = table => {
    let rows = () => DATA[table] || []
    const filters = []
    const api = {
      select() { return api },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return api },
      eq(col, val) { filters.push(r => r[col] === val); return api },
      ilike(col, pat) {
        const needle = String(pat).replace(/%/g, '')
        filters.push(r => String(r[col] || '').includes(needle)); return api
      },
      insert(list) { api._inserted = list; return api },
      update(patch) { api._patch = patch; return api },
      limit() { return api },
      then(res) { return Promise.resolve({ data: apply(), error: null }).then(res) },
      maybeSingle() { const a = apply(); return Promise.resolve({ data: a[0] || null, error: null }) },
    }
    const apply = () => {
      if (api._inserted) return api._inserted.map((r, i) => ({ id: 'new-' + i, ...r }))
      let out = rows()
      for (const f of filters) out = out.filter(f)
      if (api._patch) out = out.map(r => ({ ...r, ...api._patch }))
      return out
    }
    return api
  }
  return { supabase: { from: t => build(t) } }
})

import {
  normBarcode, gtin13of, gs1ExpiryParts, decodeGs1, handleScan,
  scanCountQty, candidateCodesFromMemo, CAND_LIMIT,
} from './scan'

/* 보호 계통 ymd 와 같은 구현 (App.jsx 82-89) */
const pad = n => String(n).padStart(2, '0')
const ymd = (yy, mm, dd) => yy + '-' + pad(mm) + '-' + pad(dd)

/* ★ is_active 를 반드시 넣는다 — handleScan 이 .eq('is_active', true) 로 거르므로
   빠뜨리면 전 행이 사라져 8건이 한꺼번에 실패한다(코드 결함 아님, 픽스처 누락). */
const BC = (code, over = {}) => ({
  id: 'b-' + code, code, code_type: 'GS1', drug_code: null, insurance_code: null,
  product_name: null, pack_type: null, pack_qty: null, is_rep: false, source: '심평원',
  memo: null, is_active: true, ...over,
})

beforeEach(() => {
  DATA.drug_barcodes = [
    BC('08806717068539', { drug_code: 'BTGR50', product_name: '베타그론서방정50밀리그램(미라베그론)', pack_type: '병', pack_qty: 100, insurance_code: '671706850' }),
    BC('08806717068515', { drug_code: 'BTGR50', product_name: '베타그론서방정50밀리그램(미라베그론)', pack_type: 'PTP', pack_qty: 90, insurance_code: '671706850' }),
    BC('08806536030014', { drug_code: 'TBRDEXEYE', product_name: '토브라덱스점안액', pack_type: '병', pack_qty: 1, insurance_code: '653603001' }),
    BC('08806457011413', { drug_code: null, product_name: '코데날액', pack_type: '병', pack_qty: 1, insurance_code: '645701141', memo: '후보 CDNSU·CDNSU5 — 확인 필요' }),
  ]
  DATA.drugs = [
    { drug_code: 'BTGR50', drug_name: '베타그론서방정50mg', status: '사용', unit: '병', specification: '정제', current_qty: 676, unit_mgmt: null },
    { drug_code: 'TBRDEXEYE', drug_name: '토브라덱스점안액', status: '사용', unit: '병', specification: '외용', current_qty: 2, unit_mgmt: null },
    { drug_code: 'CDNSU', drug_name: '코데날액1000mL', status: '사용', unit: '병', specification: '내용액', current_qty: 3670, unit_mgmt: null },
    { drug_code: 'CDNSU5', drug_name: '코데날액500mL', status: '휴면', unit: '통', specification: '내용액', current_qty: 8000, unit_mgmt: null },
  ]
  DATA.drug_master = [
    { standard_code: '8806457011420', drug_name: '코데날액', package: '병', total_qty: 1, unit: 'mL/병', specification: '500(1)', insurance_code: '645701142', product_code: '196900131' },
  ]
  DATA.tenant_members = [{ tenant_id: 'T1' }]
})

/* ══ 1. 정규화 ══════════════════════════════════════════════════════════ */
describe('normBarcode — DB norm_barcode 와 같은 규칙', () => {
  it('(01) 접두를 AI 로 떼고 14자리를 그대로 쓴다 (01 이 숫자에 섞이면 안 됨)', () => {
    expect(normBarcode('(01)08806717068539', 'GS1')).toBe('08806717068539')
  })
  it('괄호 없는 14자리는 그대로', () => expect(normBarcode('08806717068539', 'GS1')).toBe('08806717068539'))
  it('괄호 없는 13자리는 좌측 0', () => expect(normBarcode('8806717068539', 'GS1')).toBe('08806717068539'))
  it('12자리(UPC-A)도 허용', () => expect(normBarcode('880671706853', 'GS1')).toBe('00880671706853'))
  it('11자리는 규격 밖 → null (조용히 메우지 않는다)', () => expect(normBarcode('88067170685', 'GS1')).toBeNull())
  it('자체는 btrim 만', () => expect(normBarcode('  ABC-소분-01  ', '자체')).toBe('ABC-소분-01'))
  it('자체 빈값 → null', () => expect(normBarcode('   ', '자체')).toBeNull())
})

describe('gtin13of — 지시자 0 일 때만 성립', () => {
  it('지시자 0 → 13자리', () => expect(gtin13of('08806717068539')).toBe('8806717068539'))
  it('지시자 1 → null (체크디짓이 재계산되므로 절단 불가)', () => expect(gtin13of('18806717068536')).toBeNull())
})

/* ══ 2. (17) 유효기한 ═══════════════════════════════════════════════════ */
describe('gs1ExpiryParts — DD=00 말일 규칙', () => {
  it('271231 → 2027-12-31', () => {
    const p = gs1ExpiryParts('271231')
    expect(ymd(p.y, p.m, p.d)).toBe('2027-12-31')
  })
  it('★ 271200 (DD=00) → 2027-12-31 (해당 월 말일)', () => {
    const p = gs1ExpiryParts('271200')
    expect(ymd(p.y, p.m, p.d)).toBe('2027-12-31')
  })
  it('280200 (윤년 2월) → 2028-02-29', () => {
    const p = gs1ExpiryParts('280200')
    expect(ymd(p.y, p.m, p.d)).toBe('2028-02-29')
  })
  it('270200 (평년 2월) → 2027-02-28', () => {
    const p = gs1ExpiryParts('270200')
    expect(ymd(p.y, p.m, p.d)).toBe('2027-02-28')
  })
  it('월 범위 밖 → null', () => expect(gs1ExpiryParts('271331')).toBeNull())
  it('존재하지 않는 날 → null', () => expect(gs1ExpiryParts('270230')).toBeNull())
})

/* ══ 3. 파싱 ════════════════════════════════════════════════════════════ */
describe('decodeGs1', () => {
  it('(01) 단독', () => {
    const r = decodeGs1('(01)08806717068539', ymd)
    expect(r.ok).toBe(true); expect(r.gtin14).toBe('08806717068539'); expect(r.form).toBe('AI')
  })
  it('★ (01)+(21) — 일련번호 추출', () => {
    const r = decodeGs1('(01)08806536030014(21)10650076088007', ymd)
    expect(r.ok).toBe(true)
    expect(r.gtin14).toBe('08806536030014')
    expect(r.serial).toBe('10650076088007')
  })
  it('(01)+(17)+(10) — 유효기한·LOT 동반 (없다고 전제하되 구현은 해 둠)', () => {
    const r = decodeGs1('(01)08806717068539(17)271200(10)AB-123', ymd)
    expect(r.ok).toBe(true)
    expect(r.expiry).toBe('2027-12-31')
    expect(r.lot).toBe('AB-123')
  })
  it('괄호 없는 13자리 폴백', () => {
    const r = decodeGs1('8806717068539', ymd)
    expect(r.ok).toBe(true); expect(r.gtin14).toBe('08806717068539'); expect(r.form).toBe('BARE')
  })
  it('★ (01) 없는 괄호 입력 → 실패하되 예외 없음, 원문 보존', () => {
    const r = decodeGs1('(21)10650076088007', ymd)
    expect(r.ok).toBe(false)
    expect(r.msg).toContain('(21)10650076088007')
  })
  it('★ 숫자 아님 → 실패하되 예외 없음, 원문 보존', () => {
    const r = decodeGs1('ABC-소분-01', ymd)
    expect(r.ok).toBe(false); expect(r.msg).toContain('ABC-소분-01')
  })
  it('빈 입력 → 실패', () => expect(decodeGs1('', ymd).ok).toBe(false))
  it('ymd 를 안 넘기면 expiry 는 null 이고 parts 만 남는다', () => {
    const r = decodeGs1('(01)08806717068539(17)271231')
    expect(r.expiry).toBeNull(); expect(r.expiryParts).toEqual({ y: 2027, m: 12, d: 31 })
  })
})

/* ══ 4. 조회 3분기 ══════════════════════════════════════════════════════ */
describe('handleScan — 3분기', () => {
  it('★ 1단 — (01)08806717068539 → BTGR50 · 병 · pack_qty 100', async () => {
    const r = await handleScan('(01)08806717068539', 'scanner', ymd)
    expect(r.ok).toBe(true); expect(r.kind).toBe('연결됨')
    expect(r.drug.drug_code).toBe('BTGR50')
    expect(r.pack_type).toBe('병'); expect(r.pack_qty).toBe(100)
  })
  it('★ 1단 — 같은 약품 다른 바코드는 pack_qty 가 다르다 (PTP 90)', async () => {
    const r = await handleScan('(01)08806717068515', 'scanner', ymd)
    expect(r.ok).toBe(true)
    expect(r.drug.drug_code).toBe('BTGR50')
    expect(r.pack_type).toBe('PTP'); expect(r.pack_qty).toBe(90)
  })
  it('★ 1단 — (01)+(21) 매칭 + 일련번호', async () => {
    const r = await handleScan('(01)08806536030014(21)10650076088007', 'scanner', ymd)
    expect(r.ok).toBe(true)
    expect(r.drug.drug_code).toBe('TBRDEXEYE')
    expect(r.pack_qty).toBe(1)
    expect(r.serial).toBe('10650076088007')
  })
  it('★ 1단 — 괄호 없는 13자리도 좌측 0 후 매칭', async () => {
    const r = await handleScan('8806717068539', 'scanner', ymd)
    expect(r.ok).toBe(true); expect(r.drug.drug_code).toBe('BTGR50')
  })
  it('★ 1단 — 괄호 없는 14자리도 매칭', async () => {
    const r = await handleScan('08806717068539', 'scanner', ymd)
    expect(r.ok).toBe(true); expect(r.drug.drug_code).toBe('BTGR50')
  })
  it('★ 2단 보류 — hira 와 candidates(상태 포함) 반환', async () => {
    const r = await handleScan('(01)08806457011413', 'scanner', ymd)
    expect(r.ok).toBe(false); expect(r.kind).toBe('보류')
    expect(r.hira.product_name).toBe('코데날액')
    expect(r.hira.pack_type).toBe('병')
    const codes = r.candidates.map(c => c.drug_code).sort()
    expect(codes).toEqual(['CDNSU', 'CDNSU5'])
    const byCode = Object.fromEntries(r.candidates.map(c => [c.drug_code, c.status]))
    expect(byCode.CDNSU).toBe('사용')
    expect(byCode.CDNSU5).toBe('휴면')     // ★ 상태까지 보여야 고를 수 있다
  })
  it('★ 3단 미등록 — drug_master 로 hira 를 만들고 원문을 보존', async () => {
    const r = await handleScan('(01)08806457011420', 'scanner', ymd)
    expect(r.ok).toBe(false); expect(r.kind).toBe('미등록')
    expect(r.code).toBe('08806457011420')
    expect(r.raw).toBe('(01)08806457011420')
    expect(r.hira.product_name).toBe('코데날액')
    expect(r.hira.pack_type).toBe('병')
    expect(r.hira.from).toBe('drug_master')
    expect(r.candidates.map(c => c.drug_code).sort()).toEqual(['CDNSU', 'CDNSU5'])
  })
  it('★ 3단 미등록 — 마스터에도 없으면 hira 는 null', async () => {
    const r = await handleScan('(01)99999999999999', 'scanner', ymd)
    expect(r.ok).toBe(false); expect(r.kind).toBe('미등록')
    expect(r.code).toBe('99999999999999')
    expect(r.hira).toBeNull()
  })
  it('★ 자체번호 — 등록이 없으면 미등록, 원문이 code 로 남는다', async () => {
    const r = await handleScan('ABC-소분-01', 'scanner', ymd)
    expect(r.ok).toBe(false); expect(r.kind).toBe('미등록')
    expect(r.code).toBe('ABC-소분-01')
  })
  it('★ 자체번호 13자리 오인 대책 — 원문으로 등록된 행을 찾아낸다', async () => {
    DATA.drug_barcodes.push(BC('1234567890123', { code_type: '자체', drug_code: 'CDNSU', source: '학습' }))
    const r = await handleScan('1234567890123', 'scanner', ymd)
    expect(r.ok).toBe(true)
    expect(r.code).toBe('1234567890123')      // GS1 정규화값 01234567890123 이 아님
    expect(r.drug.drug_code).toBe('CDNSU')
  })
  it('★ 원문·정규화값이 둘 다 등록돼 있으면 GS1 을 택하고 collision 을 알린다', async () => {
    DATA.drug_barcodes.push(BC('8806717068539', { code_type: '자체', drug_code: 'CDNSU', source: '학습' }))
    const r = await handleScan('8806717068539', 'scanner', ymd)
    expect(r.ok).toBe(true)
    expect(r.code).toBe('08806717068539')
    expect(r.drug.drug_code).toBe('BTGR50')
    expect(r.collision).toBe(true)
  })
  it('★ 파싱 실패도 예외 없이 { ok:false, msg }', async () => {
    const r = await handleScan('!!!', 'scanner', ymd)
    expect(r.ok).toBe(false)
    expect(typeof r.msg).toBe('string')
  })
  it('빈 입력도 예외 없음', async () => {
    const r = await handleScan('', 'scanner', ymd)
    expect(r.ok).toBe(false); expect(r.kind).toBe('형식오류')
  })
})

describe('candidateCodesFromMemo', () => {
  it('memo 에서 후보 코드를 뽑는다', () => {
    expect(candidateCodesFromMemo('후보 CDNSU·CDNSU5 — 확인 필요')).toEqual(['CDNSU', 'CDNSU5'])
  })
  it('취소예정이 앞에 붙어도 뽑는다', () => {
    expect(candidateCodesFromMemo('취소예정 2025-11-13 / 후보 A·B — 확인 필요')).toEqual(['A', 'B'])
  })
  it('후보가 없으면 빈 배열', () => expect(candidateCodesFromMemo('취소예정 2025-11-13')).toEqual([]))
  it('CAND_LIMIT 는 8', () => expect(CAND_LIMIT).toBe(8))
})

/* ══ 5. 수량 합산 ═══════════════════════════════════════════════════════ */
describe('scanCountQty — 미개봉 × pack_qty + 낱알', () => {
  it('★ (10, 98, 100) → 1098', () => expect(scanCountQty(10, 98, 100)).toMatchObject({ ok: true, qty: 1098 }))
  it('★ (0, 98, 100) → 98', () => expect(scanCountQty(0, 98, 100)).toMatchObject({ ok: true, qty: 98 }))
  it('★ (10, 0, 100) → 1000', () => expect(scanCountQty(10, 0, 100)).toMatchObject({ ok: true, qty: 1000 }))
  it('★ 소수 (2, 0.5, 100) → 200.5', () => expect(scanCountQty(2, 0.5, 100)).toMatchObject({ ok: true, qty: 200.5 }))
  it('★ 시럽 (3, 400, 1) → 403 (pack_qty 1)', () => expect(scanCountQty(3, 400, 1)).toMatchObject({ ok: true, qty: 403 }))
  it('★ 부동소수 잔차를 2자리로 잡는다 (기존 관용구 재사용)', () => {
    expect(scanCountQty(3, 0.1, 40.09).qty).toBe(120.37)
  })
  it('빈칸 둘 다 → 거부', () => expect(scanCountQty('', '', 100).ok).toBe(false))
  it('음수 → 거부', () => expect(scanCountQty(-1, 0, 100).ok).toBe(false))
  it('★ pack_qty 없는데 미개봉을 넣으면 거부 (조용히 1 로 치지 않는다)', () => {
    const r = scanCountQty(5, 0, null)
    expect(r.ok).toBe(false)
    expect(r.msg).toContain('포장수량')
  })
  it('pack_qty 없어도 낱알만이면 통과', () => {
    expect(scanCountQty('', 12, null)).toMatchObject({ ok: true, qty: 12 })
  })
})
