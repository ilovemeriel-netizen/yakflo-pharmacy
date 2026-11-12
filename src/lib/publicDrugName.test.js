/* 공개 제품명 (0128) — 함수 단위 시험 (2026-11-13 이정화 님 승인)
 *
 * 못 박는 것
 *   ① 적어 두면 **그대로** 나온다 — 규칙을 타지 않는다
 *   ② 비우면 예전 규칙 그대로 — 지금 화면이 한 글자도 안 바뀐다
 *   ③ ★ 관리 화면의 미리 보기와 **공개 서버의 실제 규칙이 같은 답**을 낸다
 *      (두 곳이 갈라지면 미리 보기가 거짓말이 된다)
 *   ④ 저장할 때 공백만 적은 것은 비운 것으로 본다 — DB CHECK 와 같은 규칙
 *   ⑤ 서버가 그 칸을 실제로 쓴다 (소스 검사)
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { autoDrugName, shownDrugName, normDrugName, DRUG_NAME_MAX } from './publicDrugName.js'
import { publicDrugName as serverRule } from '../../vaccine-app/netlify/functions/_lib/stock.js'

/* 운영 9종의 실제 약품명 (2026-11-13 실측) + 지금까지 말썽이던 모양들 */
const CASES = [
  '독감-65세 이상 (플루백신VIII-TF주 0.5mL)',
  '독감-지자체 (플루백신VIII-TF주 0.5mL)',
  '지씨플루프리필드시린지주 0.5mL',
  '스파이크박스프리필드시린지주',
  '코미나티프리필드시린지주',
  '스카이조스터주[대상포진생바이러스백신]',
  '스카이조스터주(대상포진생바이러스백신)',      /* 괄호였을 때 — 말썽이던 모양 */
  '싱그릭스주[대상포진바이러스백신(유전자재조합)]',
  '프로디악스-23',
  '프리베나20프리필드시린지',
  '65세 이상 어르신(지씨플루프리필드시린지주)',   /* 2026-10-30 건 */
  '독감-5 지자체 (플루백신)',
  '이름(',                                      /* 짝이 안 맞는 괄호 */
  '()',                                          /* 괄호뿐 */
  '',
]

describe('★ ③ 관리 화면 미리 보기 = 공개 서버 규칙', () => {
  for (const raw of CASES) {
    it(JSON.stringify(raw).slice(0, 44) + ' — 두 곳이 같은 답', () => {
      expect(autoDrugName(raw)).toBe(serverRule(raw))
    })
  }
  it('값이 없어도 둘 다 빈 글자', () => {
    expect(autoDrugName(null)).toBe('')
    expect(serverRule(null)).toBe('')
    expect(autoDrugName(undefined)).toBe(serverRule(undefined))
  })
})

describe('★ ② 비우면 예전 그대로', () => {
  it('독감은 괄호 안이 제품명이다 — 규칙의 본래 목적', () => {
    expect(autoDrugName('독감-65세 이상 (플루백신VIII-TF주 0.5mL)')).toBe('플루백신VIII-TF주 0.5mL')
  })
  it('괄호가 없으면 한 글자도 안 바뀐다', () => {
    expect(autoDrugName('프로디악스-23')).toBe('프로디악스-23')
    expect(autoDrugName('코미나티프리필드시린지주')).toBe('코미나티프리필드시린지주')
  })
  it('대괄호로 끝나면 규칙을 타지 않는다 — 지금 스카이조스터가 그렇다', () => {
    expect(autoDrugName('스카이조스터주[대상포진생바이러스백신]'))
      .toBe('스카이조스터주[대상포진생바이러스백신]')
  })
  it('★ 소괄호로 끝나면 엉뚱하게 잘린다 — 0128 을 만든 까닭', () => {
    expect(autoDrugName('스카이조스터주(대상포진생바이러스백신)')).toBe('대상포진생바이러스백신')
  })
})

describe('★ ① 적어 두면 그대로', () => {
  it('적어 둔 값이 규칙을 이긴다', () => {
    expect(shownDrugName('스카이조스터주', '스카이조스터주(대상포진생바이러스백신)'))
      .toBe('스카이조스터주')
  })
  it('앞뒤 공백은 떼고 쓴다', () => {
    expect(shownDrugName('  스카이조스터주  ', '아무거나')).toBe('스카이조스터주')
  })
  it('비어 있으면 규칙으로 만든다', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(shownDrugName(v, '독감-지자체 (플루백신VIII-TF주 0.5mL)'), JSON.stringify(v))
        .toBe('플루백신VIII-TF주 0.5mL')
    }
  })
  it('둘 다 없으면 빈 글자 — 화면이 그 줄을 안 그린다', () => {
    expect(shownDrugName(null, null)).toBe('')
    expect(shownDrugName('', '')).toBe('')
  })
})

describe('★ ④ 저장할 값 — 공백만은 비운 것으로', () => {
  it('공백만이면 null', () => {
    for (const v of ['', '   ', '\t', null, undefined]) {
      expect(normDrugName(v), JSON.stringify(v)).toBe(null)
    }
  })
  it('알맹이가 있으면 앞뒤 공백만 뗀다', () => {
    expect(normDrugName('  스카이조스터주 ')).toBe('스카이조스터주')
  })
  it('최대 길이는 DB 검사와 같은 40 이다', () => {
    expect(DRUG_NAME_MAX).toBe(40)
  })
})

/* ★ ⑤ 서버·화면이 그 칸을 실제로 쓰는가 */
describe('★ ⑤ 서버와 화면이 0128 칸을 쓴다', () => {
  const STOCK = fs.readFileSync('vaccine-app/netlify/functions/_lib/stock.js', 'utf8')
  const PANEL = fs.readFileSync('src/VaccinePublicPanel.jsx', 'utf8')
  const SQL = fs.readFileSync('supabase/migrations/0128_vaccine_public_drug_name.sql', 'utf8')

  it('서버가 계정에서 public_drug_name 을 읽는다', () => {
    expect(STOCK).toContain("public_group, public_drug_name')")
  })
  it('★ 적어 둔 값이 규칙보다 앞선다', () => {
    expect(STOCK).toContain("const fixedName = String(a.public_drug_name || '').trim()")
    expect(STOCK).toContain('drug_name: fixedName || publicDrugName(d.drug_name)')
  })
  it('화면이 두 칸을 **함께** 저장한다', () => {
    expect(PANEL).toContain('public_label: normLabel(valOf(a)), public_drug_name: normDrugName(nameOf(a))')
  })
  it('화면이 비었을 때 나올 이름을 미리 보여 준다', () => {
    expect(PANEL).toContain('placeholder={autoDrugName(')
  })
  it('0128 이 비움을 허용하고 공백만은 막는다', () => {
    expect(SQL).toContain('add column if not exists public_drug_name text')
    expect(SQL).toContain('char_length(btrim(public_drug_name)) between 1 and 40')
    expect(SQL).toContain("notify pgrst, 'reload schema'")
  })
})
