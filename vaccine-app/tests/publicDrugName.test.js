/* 공개 화면 약품명 다듬기 — 약제과 내부 앞머리를 보일 때만 없앤다.
   ★ drugs 원본 값은 건드리지 않는다. 여기는 표시용 순수 함수만 본다. */
import { describe, it, expect } from 'vitest'
import { publicDrugName } from '../netlify/functions/_lib/stock.js'

describe('publicDrugName — 운영 5종', () => {
  /* 2026-10-28 운영 DB 실측값 */
  const CASES = [
    ['지씨플루프리필드시린지주PFS/독감_일반0.5mL', '지씨플루프리필드시린지주PFS/독감_일반0.5mL'],
    ['독감-5 지자체 (플루백신VIII-TF주 0.5ml)', '플루백신VIII-TF주 0.5ml'],
    ['독감-6 (플루백신VIII-TF주 0.5ml)', '플루백신VIII-TF주 0.5ml'],
    ['스파이크박스프리필드시린지주', '스파이크박스프리필드시린지주'],
    ['코미나티엘피에이트원프리필드시린지', '코미나티엘피에이트원프리필드시린지'],
  ]
  for (const [raw, want] of CASES) {
    it(`「${raw}」 → 「${want}」`, () => {
      expect(publicDrugName(raw)).toBe(want)
    })
  }
})

describe('publicDrugName — 규칙', () => {
  it('★ 앞머리가 없는 이름은 한 글자도 바뀌지 않는다', () => {
    for (const s of ['스파이크박스프리필드시린지주', '싱그릭스주대상포진바이러스백신',
      '박씨그리프테트라주(인플루엔자분할백신)0.5 mL', '지씨플루프리필드시린지주PFS/독감_일반0.5mL']) {
      expect(publicDrugName(s)).toBe(s)
    }
  })
  it('「독감-숫자」 앞머리를 없앤다 (괄호가 없어도)', () => {
    expect(publicDrugName('독감-7 플루백신주')).toBe('플루백신주')
    expect(publicDrugName('독감-12 어떤백신')).toBe('어떤백신')
  })
  it('「지자체」는 앞머리 뒤에 올 때만 없앤다', () => {
    expect(publicDrugName('독감-5 지자체 플루백신주')).toBe('플루백신주')
    /* 앞머리 없이 「지자체」로 시작하면 그대로 둔다 — 제품명의 일부일 수 있다 */
    expect(publicDrugName('지자체 플루백신주')).toBe('지자체 플루백신주')
  })
  it('★ 남은 이름 전체를 감싼 괄호 하나만 없앤다', () => {
    expect(publicDrugName('독감-6 (가나다)')).toBe('가나다')
    /* 괄호가 이름 안에 또 있어도 바깥 한 겹만 */
    expect(publicDrugName('독감-6 (가나(다)라)')).toBe('가나(다)라')
  })
  it('★ 전체를 감싼 것이 아니면 괄호를 건드리지 않는다', () => {
    expect(publicDrugName('독감-6 (가)와 (나)')).toBe('(가)와 (나)')
    expect(publicDrugName('독감-6 (가나다) 0.5ml')).toBe('(가나다) 0.5ml')
  })
  it('★ 다듬은 결과가 비면 원래 이름을 쓴다 — 이름을 잃지 않는다', () => {
    expect(publicDrugName('독감-6')).toBe('독감-6')
    expect(publicDrugName('독감-5 지자체')).toBe('독감-5 지자체')
    expect(publicDrugName('독감-6 ()')).toBe('독감-6 ()')
  })
  it('빈 값·없는 값은 빈 문자열', () => {
    expect(publicDrugName('')).toBe('')
    expect(publicDrugName(null)).toBe('')
    expect(publicDrugName(undefined)).toBe('')
  })
  it('앞뒤 공백은 정리한다', () => {
    expect(publicDrugName('  독감-6  (가나다)  ')).toBe('가나다')
  })
})
