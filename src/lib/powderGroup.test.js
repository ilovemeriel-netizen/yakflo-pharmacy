/* 가루약 분리번호 규칙 — **순서**를 못 박는다.
 *
 * ★ 여기서 지키는 것은 두 가지 순서다. 둘 다 바뀌면 조제실이 틀린 번호를 본다.
 *   ① 제형을 가리는 순서  : 캡슐 → 정 → 액체
 *   ② 규칙을 보는 순서    : 제형(액체·가루) → ATC
 *
 * ★ 그리고 「모르면 추측하지 않는다」 — 규칙에 안 걸리면 「확인 필요」다.
 */
import { describe, it, expect } from 'vitest'
import {
  decideGroup, formOf, buildPowderTable, searchPowder, isTarget,
  GROUP_NAMES, GROUP_NOS, FOLDED_NOS, MANUAL, CHECK, NINE_ATC, HAZARD_ATC,
} from './powderGroup'

const D = o => ({ drug_code: 'X', drug_name: '', atc_code: '', narcotic_type: '일반', status: '사용', category: '경구제', ...o })
const no = d => decideGroup(d).no
const label = d => decideGroup(d).label

describe('제형 가리기 — 캡슐 → 정 → 액체 순서', () => {
  it('캡슐이 가장 먼저다', () => {
    expect(formOf('프라닥사캡슐110mg')).toBe('캡슐')
    expect(formOf('리포덱스캅셀150mg')).toBe('캡슐')      /* 「캅셀」 표기도 캡슐 */
    expect(formOf('아나딘연질캡슐0.5mg')).toBe('캡슐')
  })
  it('정이 액체보다 먼저다 — ★ 이 순서가 보장이다', () => {
    /* 「산」·「액」 글자가 들어도 정이면 정이다 */
    expect(formOf('삼천당산화마그네슘정250mg')).toBe('정')
    expect(formOf('파마탄산칼슘정')).toBe('정')
    expect(formOf('액토피스정')).toBe('정')
    expect(formOf('액티피드정')).toBe('정')
    expect(formOf('명인아미트리프틸린염산염정10mg')).toBe('정')
  })
  it('정도 캡슐도 아니면 액체', () => {
    for (const n of ['레보투스시럽', '트리렙탈현탁액6%', '비오플250산', '리박트과립',
      '큐팜액100mL', '디3베이스경구솔루션25,000IU/2.5mL', '부펜솔주100mL']) {
      expect(formOf(n), n).toBe('액체')
    }
  })
  it('아무것도 못 가리면 빈 글자', () => {
    expect(formOf('이름없음')).toBe('')
    expect(formOf('')).toBe('')
    expect(formOf(null)).toBe('')
  })
})

describe('★ 「산·액」 글자가 든 정제·캡슐이 수기조제로 빠지지 않는다', () => {
  const 함정 = [
    { drug_name: '삼천당산화마그네슘정250mg', atc_code: 'A02AA02', want: 4 },
    { drug_name: '파마탄산칼슘정', atc_code: 'A02AC01', want: 1 },
    { drug_name: '액토피스정', atc_code: 'A10BG03', want: 5 },
    { drug_name: '액티피드정', atc_code: 'R01BA52', want: 1 },
    { drug_name: '유한메트포르민염산염정850mg', atc_code: 'A10BA02', want: 5 },
    { drug_name: '보령메이액트정100mg', atc_code: 'J01DD15', want: 1 },
    { drug_name: '신일브롬헥신염산염정', atc_code: 'R05CB02', want: 1 },
  ]
  for (const x of 함정) {
    it(x.drug_name + ' → ' + x.want + '번', () => {
      const r = decideGroup(D(x))
      expect(r.label, x.drug_name).not.toBe(MANUAL)
      expect(r.no, x.drug_name).toBe(x.want)
    })
  }
})

describe('★ 규칙 순서 — 제형(액체·가루)이 ATC 보다 먼저다', () => {
  it('변비약(ATC A06)이라도 시럽이면 수기조제다', () => {
    const r = decideGroup(D({ drug_name: '듀락칸이지시럽15mL', atc_code: 'A06AD11' }))
    expect(r.no).toBeNull()
    expect(r.label).toBe(MANUAL)
    expect(r.why).toContain('액체·가루')
  })
  it('과립·산도 마찬가지다', () => {
    expect(label(D({ drug_name: '아기오과립6g', atc_code: 'A06AC01' }))).toBe(MANUAL)
    expect(label(D({ drug_name: '폴락스산4g', atc_code: 'A06AD15' }))).toBe(MANUAL)
  })
  it('같은 변비약이라도 **정**이면 4번이다', () => {
    expect(no(D({ drug_name: '마그밀정', atc_code: 'A02AA04' }))).toBe(4)
    expect(no(D({ drug_name: '셀칼콘정', atc_code: 'A06AC08' }))).toBe(4)
  })
  it('당뇨·혈압·항혈전도 액체면 수기조제다', () => {
    expect(label(D({ drug_name: '어떤당뇨시럽', atc_code: 'A10BA02' }))).toBe(MANUAL)
    expect(label(D({ drug_name: '어떤혈압액100mL', atc_code: 'C09AA02' }))).toBe(MANUAL)
    expect(label(D({ drug_name: '어떤항혈전현탁액', atc_code: 'B01AC06' }))).toBe(MANUAL)
  })
  it('마약은 제형과 상관없이 수기조제다', () => {
    expect(label(D({ drug_name: '타진서방정5/2.5mg', atc_code: 'N02AA55', narcotic_type: '마약' }))).toBe(MANUAL)
    expect(label(D({ drug_name: '마이폴캡슐10mg', atc_code: 'N02AJ09', narcotic_type: '마약' }))).toBe(MANUAL)
  })
})

describe('ATC 규칙', () => {
  it('2번 — C01~C09 혈압/심장', () => {
    expect(no(D({ drug_name: '시그마트정5mg', atc_code: 'C01DX16' }))).toBe(2)
    expect(no(D({ drug_name: '라식스정40mg', atc_code: 'C03CA01' }))).toBe(2)
    expect(no(D({ drug_name: '콩코르정5mg', atc_code: 'C07AB07' }))).toBe(2)
  })
  it('★ C10(고지혈증)은 2번이 아니다 — 1번으로 간다', () => {
    const r = decideGroup(D({ drug_name: '대웅바이오아토르바스타틴정80mg', atc_code: 'C10AA05' }))
    expect(r.no).toBe(1)
    expect(r.label).toBe(GROUP_NAMES[1])
  })
  it('3번·8번 — 항혈전은 제형으로 갈린다', () => {
    expect(no(D({ drug_name: '릭시아나정30mg', atc_code: 'B01AF03' }))).toBe(3)
    expect(no(D({ drug_name: '프라닥사캡슐110mg', atc_code: 'B01AE07' }))).toBe(8)
    expect(no(D({ drug_name: '보령바이오아스트릭스캡슐100mg', atc_code: 'B01AC06' }))).toBe(8)
  })
  it('5번 — A10 당뇨', () => {
    expect(no(D({ drug_name: '게리드정2mg', atc_code: 'A10BB12' }))).toBe(5)
  })
  it('4번 — A06 변비 · A02AA 마그네슘 제산제만', () => {
    expect(no(D({ drug_name: '모비졸로정2mg', atc_code: 'A06AX05' }))).toBe(4)
    expect(no(D({ drug_name: '마그밀정', atc_code: 'A02AA04' }))).toBe(4)
  })
  it('★ A02A 를 넓히지 않는다 — 제산제·소화제는 1번이다', () => {
    expect(no(D({ drug_name: '알드린정', atc_code: 'A02AD03' }))).toBe(1)
    expect(no(D({ drug_name: '파마탄산칼슘정', atc_code: 'A02AC01' }))).toBe(1)
    expect(no(D({ drug_name: '애니탈정', atc_code: 'A02AX' }))).toBe(1)
    expect(no(D({ drug_name: '타스나정500mg', atc_code: 'A02A' }))).toBe(1)
  })
  it('7번 — 향정', () => {
    expect(no(D({ drug_name: '졸피드정10mg', atc_code: 'N05CF02', narcotic_type: '향정' }))).toBe(7)
  })
  it('한외마약은 향정이 아니다 — 일반 규칙을 탄다', () => {
    expect(label(D({ drug_name: '코푸정', atc_code: 'R05FA02', narcotic_type: '한외마약' }))).toBe(GROUP_NAMES[1])
  })
})

describe('9번 예외 — ★ 약품코드가 아니라 ATC 로 지정한다', () => {
  it('글리코피롤레이트(A03AB02)', () => {
    expect(no(D({ drug_name: '명문글리코피롤레이트정', atc_code: 'A03AB02' }))).toBe(9)
  })
  it('염화칼륨(A12BA01)', () => {
    expect(no(D({ drug_name: '케이콘틴서방정', atc_code: 'A12BA01' }))).toBe(9)
  })
  it('★ 이름이 달라져도 ATC 가 같으면 그대로 9번이다', () => {
    expect(no(D({ drug_name: '아무개정100mg', atc_code: 'A12BA01' }))).toBe(9)
  })
  it('예외 목록에 약품코드가 들어 있지 않다', () => {
    for (const x of NINE_ATC) {
      expect(Object.keys(x).sort()).toEqual(['atc', 'why'])
      expect(x.atc).toMatch(/^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/)
    }
  })
})

describe('가루 위험 — 표시와 번호를 나눠 둔다', () => {
  it('피나스테리드(G04CB01) — 9번으로 못 박는다', () => {
    const r = decideGroup(D({ drug_name: '피나스테아정5mg', atc_code: 'G04CB01' }))
    expect(r.no).toBe(9)
    expect(r.hazard).toContain('피나스테리드')
    expect(r.note).toBe('')
  })
  it('두타스테리드(G04CB02) — 번호는 일반 규칙(캡슐 → 6번), 표시만 붙는다', () => {
    const r = decideGroup(D({ drug_name: '아나딘연질캡슐0.5mg', atc_code: 'G04CB02' }))
    expect(r.no).toBe(6)
    expect(r.label).toBe(GROUP_NAMES[6])
    expect(r.hazard).toContain('두타스테리드')
    expect(r.note).toBe('재확인 필요')
  })
  it('가루 위험 목록에 약품코드가 들어 있지 않다', () => {
    for (const x of HAZARD_ATC) {
      expect(Object.keys(x).sort()).toEqual(['atc', 'no', 'note', 'why'])
      expect(x.atc).toMatch(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/)
    }
  })
})

describe('★ 모르면 추측하지 않는다', () => {
  it('규칙에 안 걸리고 제형도 못 가리면 「확인 필요」', () => {
    const r = decideGroup(D({ drug_name: '새로들어온무엇', atc_code: 'Z99ZZ99' }))
    expect(r.no).toBeNull()
    expect(r.label).toBe(CHECK)
    expect(r.why).toContain('추측하지 않음')
  })
  it('ATC 가 비어도 번호를 지어내지 않는다', () => {
    expect(label(D({ drug_name: '이름만있는약', atc_code: '' }))).toBe(CHECK)
  })
  it('ATC 가 없어도 제형이 분명하면 1·6번은 준다', () => {
    expect(no(D({ drug_name: '무슨정5mg', atc_code: '' }))).toBe(1)
    expect(no(D({ drug_name: '무슨캡슐5mg', atc_code: '' }))).toBe(6)
  })
  it('빈 약을 넣어도 터지지 않는다', () => {
    expect(decideGroup(undefined).label).toBe(CHECK)
    expect(decideGroup({}).label).toBe(CHECK)
  })
})

describe('대상 거르기 — 사용 중인 경구제만', () => {
  it('중지·휴면 약은 빠진다', () => {
    expect(isTarget(D({ status: '중지' }))).toBe(false)
    expect(isTarget(D({ status: '휴면' }))).toBe(false)
    expect(isTarget(D({ status: '사용' }))).toBe(true)
  })
  it('주사제·외용제는 빠진다', () => {
    expect(isTarget(D({ category: '주사제' }))).toBe(false)
    expect(isTarget(D({ category: '외용제' }))).toBe(false)
    expect(isTarget(D({ category: '경구제' }))).toBe(true)
  })
})

describe('기준표 한 벌', () => {
  const drugs = [
    D({ drug_code: 'A', drug_name: '하정10mg', atc_code: 'C09AA02' }),
    D({ drug_code: 'B', drug_name: '가정10mg', atc_code: 'C09AA02' }),
    D({ drug_code: 'C', drug_name: '다캡슐', atc_code: 'Z00' }),
    D({ drug_code: 'E', drug_name: '라시럽', atc_code: 'A06AD11' }),
    D({ drug_code: 'F', drug_name: '마중지정', atc_code: 'C09AA02', status: '중지' }),
    D({ drug_code: 'G', drug_name: '바주사', atc_code: 'C09AA02', category: '주사제' }),
  ]
  const p = buildPowderTable(drugs)
  it('대상만 들어온다', () => {
    expect(p.total).toBe(4)
    expect(p.rows.map(x => x.d.drug_code)).not.toContain('F')
    expect(p.rows.map(x => x.d.drug_code)).not.toContain('G')
  })
  it('가나다순이다', () => {
    expect(p.rows.map(x => x.d.drug_name)).toEqual(['가정10mg', '다캡슐', '라시럽', '하정10mg'])
  })
  it('번호 묶음 9개 · 1·6번만 접힘', () => {
    expect(p.groups.map(g => g.no)).toEqual(GROUP_NOS)
    expect(p.groups.filter(g => g.folded).map(g => g.no)).toEqual(FOLDED_NOS)
  })
  it('수기조제·확인 필요가 따로 나온다', () => {
    expect(p.manual.map(x => x.d.drug_code)).toEqual(['E'])
    expect(p.check).toEqual([])
    expect(p.groups.find(g => g.no === 2).list.length).toBe(2)
    expect(p.groups.find(g => g.no === 6).list.length).toBe(1)
  })
  it('빈 배열·undefined 도 견딘다', () => {
    expect(buildPowderTable([]).total).toBe(0)
    expect(buildPowderTable(undefined).total).toBe(0)
  })
})

describe('검색', () => {
  const p = buildPowderTable([
    D({ drug_code: 'SGMT5', drug_name: '시그마트정5mg', atc_code: 'C01DX16', ingredient_kr: '니코란딜', ingredient_en: 'Nicorandil' }),
    D({ drug_code: 'MGM', drug_name: '마그밀정', atc_code: 'A02AA04', ingredient_kr: '수산화마그네슘', ingredient_en: 'Magnesium Hydroxide' }),
  ])
  it('약품명 일부로 찾는다', () => {
    expect(searchPowder(p.rows, '시그마트').map(x => x.d.drug_code)).toEqual(['SGMT5'])
  })
  it('한글 성분으로 찾는다', () => {
    expect(searchPowder(p.rows, '니코란딜').map(x => x.d.drug_code)).toEqual(['SGMT5'])
    expect(searchPowder(p.rows, '마그네슘').map(x => x.d.drug_code)).toEqual(['MGM'])
  })
  it('영문 성분으로도 찾는다 — 대소문자 안 가림', () => {
    expect(searchPowder(p.rows, 'nicorandil').map(x => x.d.drug_code)).toEqual(['SGMT5'])
  })
  it('약품코드로도 찾는다', () => {
    expect(searchPowder(p.rows, 'MGM').map(x => x.d.drug_code)).toEqual(['MGM'])
  })
  it('빈 글자는 0건 — 전체를 쏟지 않는다', () => {
    expect(searchPowder(p.rows, '')).toEqual([])
    expect(searchPowder(p.rows, '   ')).toEqual([])
  })
})
