/* 공개 화면 약품명 다듬기 — 약제과 내부 앞머리를 보일 때만 없앤다.
   ★ drugs 원본 값은 건드리지 않는다. 여기는 표시용 순수 함수만 본다. */
import { describe, it, expect } from 'vitest'
import { publicDrugName } from '../netlify/functions/_lib/stock.js'

describe('publicDrugName — 운영 5종 (2026-10-30 실측)', () => {
  /* ★ 이름이 바뀌면 여기부터 깨진다 — 그게 이 시험의 일이다.
     2026-10-30 실측: TETRA6 이 「독감-6 (…)」에서 「65세 이상 어르신(…)」으로 바뀌어
     앞머리 규칙 밖으로 나갔고, 구분 문구가 공개 화면에 그대로 나갔다. */
  const CASES = [
    ['65세 이상 어르신(플루백신VIII-TF주 0.5mL)', '플루백신VIII-TF주 0.5mL'],   /* TETRA6 — 이번에 고친 것 */
    ['독감-5 지자체 (플루백신VIII-TF주 0.5mL)', '플루백신VIII-TF주 0.5mL'],      /* TETRA5 */
    ['지씨플루프리필드시린지주 0.5mL', '지씨플루프리필드시린지주 0.5mL'],          /* TT-FLU44 */
    ['스파이크박스프리필드시린지주', '스파이크박스프리필드시린지주'],              /* SPIKVX */
    ['코미나티프리필드시린지주', '코미나티프리필드시린지주'],                      /* CMNTLP */
  ]
  for (const [raw, want] of CASES) {
    it(`「${raw}」 → 「${want}」`, () => {
      expect(publicDrugName(raw)).toBe(want)
    })
  }
  it('★ 독감 셋 중 둘(국가무료·지자체)이 같은 제품명으로 나온다 — 같은 제품이라 맞다', () => {
    expect(publicDrugName('65세 이상 어르신(플루백신VIII-TF주 0.5mL)'))
      .toBe(publicDrugName('독감-5 지자체 (플루백신VIII-TF주 0.5mL)'))
  })
})

describe('publicDrugName — 옛 이름(회귀 방지)', () => {
  /* 2026-10-28 실측값. 이름이 되돌아가도 같은 결과가 나와야 한다.
     ★ ml/mL 은 글자 그대로 흘려보낸다 — 표기를 고치는 것은 이 함수의 일이 아니다. */
  const OLD = [
    ['독감-6 (플루백신VIII-TF주 0.5ml)', '플루백신VIII-TF주 0.5ml'],
    ['독감-5 지자체 (플루백신VIII-TF주 0.5ml)', '플루백신VIII-TF주 0.5ml'],
    ['지씨플루프리필드시린지주PFS/독감_일반0.5mL', '지씨플루프리필드시린지주PFS/독감_일반0.5mL'],
    ['코미나티엘피에이트원프리필드시린지', '코미나티엘피에이트원프리필드시린지'],
  ]
  for (const [raw, want] of OLD) {
    it(`「${raw}」 → 「${want}」`, () => expect(publicDrugName(raw)).toBe(want))
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
  it('★ 끝 괄호 안을 제품명으로 본다 — 괄호 앞 공백이 있든 없든', () => {
    expect(publicDrugName('독감-6 (가나다)')).toBe('가나다')
    expect(publicDrugName('독감-6(가나다)')).toBe('가나다')
    expect(publicDrugName('65세 이상 어르신(가나다)')).toBe('가나다')
    expect(publicDrugName('아무 구분 문구나 붙어도(가나다)')).toBe('가나다')
    /* 안쪽에 괄호가 또 있어도 바깥 짝을 집는다 */
    expect(publicDrugName('독감-6 (가나(다)라)')).toBe('가나(다)라')
  })
  it('★ 괄호가 두 번이면 끝 괄호 기준이다', () => {
    /* ⚠ 사용자 결정(끝 괄호 기준)의 결과다. 「독감-6 (국가) (플루백신주)」 같은 실제
       형태에서는 뒤쪽이 제품명이라 맞지만, 「(가)와 (나)」 같은 글은 뒤만 남는다.
       규칙으로 하는 추측의 한계라 형식이 또 달라지면 방안 B(공개용 제품명 칸)로 간다. */
    expect(publicDrugName('독감-6 (국가) (플루백신주)')).toBe('플루백신주')
    expect(publicDrugName('독감-6 (가)와 (나)')).toBe('나')
  })
  it('★ 괄호로 끝나지 않으면 벗기지 않는다 — 뒤 글자를 잃지 않으려고', () => {
    expect(publicDrugName('독감-6 (가나다) 0.5ml')).toBe('(가나다) 0.5ml')
    expect(publicDrugName('박씨그리프테트라주(인플루엔자분할백신)0.5 mL'))
      .toBe('박씨그리프테트라주(인플루엔자분할백신)0.5 mL')
  })
  it('여는 괄호가 모자라면 손대지 않는다', () => {
    expect(publicDrugName('어르신 플루백신주)')).toBe('어르신 플루백신주)')
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
