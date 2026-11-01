/* 재고현황 급변(급증·급감) 필터.

   ★ 판정은 **한 곳**에서만 한다 — surgeOf(월평균, 직전1개월).
     색·필터·엑셀이 각자 판단하면 조용히 어긋난다. 식은 쓰던 것을 글자 그대로 옮겼다:
       급증 = 월평균 × 1.5 **초과** · 급감 = 월평균 × 0.5 **미만**
       월평균이 0 이하이거나 직전1개월이 비면 판정하지 않는다.

   ★ 고정하는 것
     ① 머리글 메뉴(A)와 칩(B)이 **같은 state** 를 쓴다 — 한쪽을 바꾸면 다른 쪽도 바뀐다
     ② 급변 필터가 구분·상태 칩과 **함께**(AND) 걸린다
     ③ 「○○개」와 쪽 나누기가 따라온다
     ④ 색만이 아니라 ▲▼ 모양으로도 읽힌다
     ⑤ 엑셀은 급변이 걸렸을 때만 범위를 묻는다 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'

/* 월평균 100 기준 — 급증(>150) 2종 · 급감(<50) 3종 · 보통 2종 · 확인필요 4종 */
const mk = (code, cat, r1, src = 'manual') => ({
  drug_code: code, drug_name: code + '약', category: cat, status: '사용',
  current_qty: 100, safety_stock: 10, max_stock: 300, purchase_price: 100,
  prev_year_usage: 1200, recent_3m_usage: 300, monthly_avg: 100,
  recent_1m_usage: r1, usage_source: src, expiry_date: '2027-06-01',
})
const DRUGS = [
  mk('UP1', '경구제', 200), mk('UP2', '주사제', 151),
  mk('DN1', '경구제', 10), mk('DN2', '주사제', 49),
  mk('DN3', '경구제', 0),                    /* ★ 수기 0 — 사람이 「안 썼다」고 적었다 → 급감 그대로 */
  mk('OK1', '경구제', 100), mk('OK2', '주사제', 150),   /* 150 은 초과가 아니라 보통 */
  /* ★ 확인필요 네 갈래 — 2026-11-01 규칙 */
  mk('CK1', '경구제', null),                 /* ① 빈 값 */
  mk('CK2', '주사제', -5),                   /* ② 음수 (DB 에 제약이 없어 들어올 수 있다) */
  mk('CK3', '경구제', 0, null),              /* ③ 0 + usage_source 미설정 */
  mk('CK4', '주사제', 0, 'auto'),            /* ③ 0 + 자동집계가 남긴 값 */
]
const UP = 2, DN = 3, CHK = 4

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  const q = {
    select: () => q, in: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
    range: () => result([]), limit: () => result([]), maybeSingle: () => result(null),
    insert: () => result(null), upsert: () => result(null), update: () => q, delete: () => q,
    then(res) { return result([]).then(res) },
  }
  return { supabase: { from: () => q, rpc: () => result(0), auth: { getUser: () => result(null) } } }
})
const T = {
  bg: '#F7F6F3', card: '#FFFFFF', cardSolid: '#FFFFFF', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, memberRole: 'owner', profile: { role: 'user' }, setTheme: () => {} }) }
})

let StockStatus
beforeEach(async () => { if (!StockStatus) StockStatus = (await import('./App.jsx')).StockStatus })
afterEach(() => cleanup())

const open = () => render(<StockStatus drugs={DRUGS} inv={[]} navFilter={null}
  onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
const codes = () => [...document.querySelectorAll('tbody tr')]
  .map(tr => tr.querySelector('td').textContent.trim())
/* ★ 급변 칩 **묶음 안에서만** 찾는다 — 화면에는 재고상태 카드에도 「전체」가 있어
   그냥 글자로 찾으면 엉뚱한 것을 누른다(실제로 그렇게 당했다). */
const upChip = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '▲ 급증')
/* ★ 급변 칩 넷은 한 줄에 나란히 있다(전체 · ▲ 급증 · ▼ 급감 · ? 확인 필요) — **형제 관계**로 집는다.
   같은 줄에 구분·상태 묶음도 있어 「전체」를 글자로 찾으면 그쪽을 누른다. */
const chip = label => {
  const up = upChip()
  if (!up) return null
  if (label === '▲ 급증') return up
  if (label === '▼ 급감') return up.nextElementSibling
  if (label === '? 확인 필요') return up.nextElementSibling.nextElementSibling
  if (label === '전체') return up.previousElementSibling
  return null
}
/* 열린 드롭다운 안에서만 — 같은 글자가 칩에도 있다 */
const menuItem = label => {
  const menu = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '9999')
  return menu ? [...menu.querySelectorAll('button')].find(b => b.textContent.replace(/[✓s]/g, '') === label) : null
}
const countText = () => {
  const el = [...document.querySelectorAll('span')].find(s => /^\d+개$/.test(s.textContent.trim()))
  return el ? el.textContent.trim() : ''
}
const th1m = () => [...document.querySelectorAll('thead th')]
  .find(x => x.textContent.replace(/[⇅▲▼✓\s]/g, '') === '직전1개월사용량')
async function ready() {
  open()
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
}

describe('① 칩(B)으로 거르기', () => {
  it('처음에는 전부 보인다', async () => {
    await ready()
    expect(codes().length).toBe(DRUGS.length)
    expect(countText()).toBe(DRUGS.length + '개')
  })
  it('★ 「▲ 급증」 — 월평균 1.5배를 **넘는** 줄만', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    expect(codes().sort()).toEqual(['UP1', 'UP2'])
    expect(countText(), '「○○개」도 따라온다').toBe(UP + '개')
  })
  it('★ 「▼ 급감」 — 월평균 0.5배 **미만**인 줄만 (수기 0 포함)', async () => {
    await ready()
    fireEvent.click(chip('▼ 급감'))
    await waitFor(() => expect(codes().length).toBe(DN))
    expect(codes().sort()).toEqual(['DN1', 'DN2', 'DN3'])
    expect(codes(), '미입력 0 은 급감이 아니다').not.toContain('CK3')
    expect(codes()).not.toContain('CK4')
  })
  it('딱 1.5배·0.5배는 급변이 아니다 — 초과·미만이다', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    expect(codes(), '150 은 1.5배 **딱** 이라 급증 아님').not.toContain('OK2')
  })
  it('「전체」로 돌아온다', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    fireEvent.click(chip('전체'))
    await waitFor(() => expect(codes().length).toBe(DRUGS.length))
  })
})

describe('② 머리글 메뉴(A)와 칩(B)이 같이 움직인다', () => {
  it('직전1개월 머리글에 필터가 붙었다', async () => {
    await ready()
    expect(th1m().querySelector('span[title="필터"]'), '필터 라벨').toBeTruthy()
  })
  it('★ 머리글에서 고르면 칩도 같이 눌린다', async () => {
    await ready()
    th1m().querySelector('span[title="필터"]').click()
    await waitFor(() => expect(menuItem('급증')).toBeTruthy())
    fireEvent.click(menuItem('급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    expect(chip('▲ 급증').getAttribute('aria-pressed'), '칩이 눌린 상태').toBe('true')
  })
  it('★ 칩에서 고르면 머리글 메뉴도 그 값이다', async () => {
    await ready()
    fireEvent.click(chip('▼ 급감'))
    await waitFor(() => expect(codes().length).toBe(DN))
    th1m().querySelector('span[title="필터"]').click()
    await waitFor(() => expect([...document.querySelectorAll('button')].some(b => /급감/.test(b.textContent))).toBe(true))
    const on = [...document.querySelectorAll('button')].find(b => b.textContent.replace(/\s|✓/g, '') === '급감')
    expect(on.textContent, '켜진 항목에 ✓').toContain('✓')
  })
})

describe('③ 다른 칩과 함께 걸린다 (AND)', () => {
  it('★ 급증 + 구분(경구제) — 둘 다 만족하는 줄만', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    /* 구분 머리글 메뉴에서 경구제만 */
    const thCat = [...document.querySelectorAll('thead th')]
      .find(x => x.textContent.replace(/[⇅▲▼✓\s]/g, '') === '구분')
    thCat.querySelector('span[title="필터"]').click()
    await waitFor(() => expect(menuItem('경구제')).toBeTruthy())
    fireEvent.click(menuItem('경구제'))
    await waitFor(() => expect(codes()).toEqual(['UP1']))
  })
  it('「필터 초기화」 개수에 급변이 들어간다', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    const reset = [...document.querySelectorAll('button')].find(b => /필터 초기화/.test(b.textContent))
    expect(reset, '초기화 버튼이 나타난다').toBeTruthy()
    expect(reset.textContent).toContain('(1)')
  })
  it('초기화하면 급변도 풀린다', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    fireEvent.click([...document.querySelectorAll('button')].find(b => /필터 초기화/.test(b.textContent)))
    await waitFor(() => expect(codes().length).toBe(DRUGS.length))
    expect(chip('전체').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('④ 색 말고 모양으로도 읽힌다', () => {
  it('★ 급증 줄에 ▲, 급감 줄에 ▼', async () => {
    await ready()
    const row = c => [...document.querySelectorAll('tbody tr')]
      .find(tr => tr.querySelector('td').textContent.trim() === c)
    expect(row('UP1').textContent, '급증').toContain('▲')
    expect(row('DN1').textContent, '급감').toContain('▼')
    expect(row('OK1').textContent, '보통은 표시 없음').not.toContain('▲')
    expect(row('OK1').textContent).not.toContain('▼')
  })
  it('모양에 읽는 도구용 이름이 붙는다', async () => {
    await ready()
    const row = [...document.querySelectorAll('tbody tr')]
      .find(tr => tr.querySelector('td').textContent.trim() === 'UP1')
    const mark = [...row.querySelectorAll('span')].find(s => s.getAttribute('aria-label'))
    expect(mark.getAttribute('aria-label')).toBe('급증')
  })
  it('범례가 한 줄 있다', async () => {
    await ready()
    expect(document.body.textContent).toContain('▲ 급증(월평균 1.5배 초과) · ▼ 급감(0.5배 미만)')
  })
})

describe('⑤ 엑셀 — 급변이 걸렸을 때만 묻는다', () => {
  const excel = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '엑셀')
  const ask = () => [...document.querySelectorAll('div')]
    .find(d => d.textContent.includes('어떤 줄을 엑셀로 받을까요?'))
  const btn = re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent))

  it('급변이 없으면 선택 창이 안 뜬다', async () => {
    await ready()
    fireEvent.click(excel())
    await waitFor(() => expect(true).toBe(true))
    expect(ask()).toBeFalsy()
  })
  it('★ 급변이 걸려 있으면 선택 창이 뜬다 — 단추 문구에 줄 수가 붙는다', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    fireEvent.click(excel())
    await waitFor(() => expect(ask()).toBeTruthy())
    const txt = ask().textContent
    expect(txt).toContain('▲ 급증 필터가 걸려 있습니다.')
    expect(txt).toContain('구분·상태·검색 칩은 그대로 적용됩니다.')
    expect(btn(/^보이는 줄만 \(2줄\)$/), '보이는 줄만 (2줄)').toBeTruthy()
    expect(btn(/^급변 필터 빼고 모두 \(11줄\)$/), '급변 필터 빼고 모두 (11줄)').toBeTruthy()
    expect(btn(/^취소$/), '취소').toBeTruthy()
  })
  it('★ 확인필요가 걸려 있어도 묻는다 — 문구가 그 필터를 말한다', async () => {
    await ready()
    fireEvent.click(chip('? 확인 필요'))
    await waitFor(() => expect(codes().length).toBe(CHK))
    fireEvent.click(excel())
    await waitFor(() => expect(ask()).toBeTruthy())
    expect(ask().textContent).toContain('? 확인 필요 필터가 걸려 있습니다.')
    expect(btn(/^보이는 줄만 \(4줄\)$/)).toBeTruthy()
  })
})

/* ═══ ⑦ 확인필요 — 2026-11-01 추가 규칙 ═══
   0 이 두 가지 뜻으로 섞여 있던 것을 가른다.
     수기 0   = 사람이 「안 썼다」고 적었다 → ▼ 급감 (그대로)
     그 밖의 0·빈 값·음수 = 아직 못 믿는 값 → ? 확인 필요 (새로 뺀 것) */
describe('⑦ 확인필요 — 네 갈래', () => {
  const row = c => [...document.querySelectorAll('tbody tr')]
    .find(tr => tr.querySelector('td').textContent.trim() === c)

  it('★ 칩으로 거르면 네 갈래가 모두 나온다', async () => {
    await ready()
    fireEvent.click(chip('? 확인 필요'))
    await waitFor(() => expect(codes().length).toBe(CHK))
    expect(codes().sort()).toEqual(['CK1', 'CK2', 'CK3', 'CK4'])
  })

  it('★ 빈 값은 「-」 뒤에 ? 가 붙는다 (숫자 0 으로 꾸미지 않는다)', async () => {
    await ready()
    const td = [...row('CK1').querySelectorAll('td')][9]
    expect(td.textContent.trim(), '빈 값은 - 로 보여야 한다').toBe('- ?'.replace(' ', ''))
  })

  it('★ 음수는 값을 그대로 보여 주고 ? 를 붙인다', async () => {
    await ready()
    expect(row('CK2').textContent).toContain('-5')
    expect(row('CK2').textContent).toContain('?')
  })

  it('★ 수기 0 과 미입력 0 이 갈린다 — 같은 0 인데 표시가 다르다', async () => {
    await ready()
    expect(row('DN3').textContent, '수기 0 → 급감').toContain('▼')
    expect(row('DN3').textContent).not.toContain('?')
    expect(row('CK3').textContent, '미설정 0 → 확인필요').toContain('?')
    expect(row('CK3').textContent).not.toContain('▼')
    expect(row('CK4').textContent, '자동 0 → 확인필요').toContain('?')
  })

  it('★ 확인필요 줄은 급증·빨강도 급감·파랑도 아니다 — 회색 그대로', async () => {
    await ready()
    const mark = c => [...row(c).querySelectorAll('span')].find(s => s.getAttribute('aria-label'))
    for (const c of ['CK1', 'CK2', 'CK3', 'CK4']) {
      expect(mark(c).getAttribute('aria-label'), c).toBe('확인필요')
      /* 숫자를 감싼 span 의 색 — 빨강·파랑이 아니다 */
      const wrap = mark(c).parentElement
      /* jsdom 은 #52524E 를 rgb(82, 82, 78) 로 적어 둔다 — 회색 토큰인지만 본다 */
      expect(wrap.style.color, c + ' 색').toBe('rgb(82, 82, 78)')
      expect(wrap.style.color, c + ' 빨강 아님').not.toBe('rgb(198, 40, 40)')
      expect(wrap.style.color, c + ' 파랑 아님').not.toBe('rgb(46, 74, 98)')
      expect(wrap.style.fontWeight, c + ' 두께').toBe('400')
    }
  })

  it('툴팁이 왜 확인이 필요한지 말해 준다', async () => {
    await ready()
    const mark = [...row('CK3').querySelectorAll('span')].find(s => s.getAttribute('aria-label'))
    expect(mark.parentElement.getAttribute('title'))
      .toBe('확인 필요 — 값이 비었거나 0(미입력)·음수')
  })

  it('범례에 「? 확인 필요」가 있다', async () => {
    await ready()
    expect(document.body.textContent).toContain('? 확인 필요')
  })

  it('머리글 메뉴에도 항목이 있다 — 칩과 같은 값을 쓴다', async () => {
    await ready()
    th1m().querySelector('span[title="필터"]').click()
    await waitFor(() => expect(menuItem('확인필요')).toBeTruthy())
    fireEvent.click(menuItem('확인필요'))
    await waitFor(() => expect(codes().length).toBe(CHK))
    expect(chip('? 확인 필요').getAttribute('aria-pressed')).toBe('true')
  })

  it('★ 급증·급감 숫자가 확인필요 때문에 변하지 않았다', async () => {
    await ready()
    fireEvent.click(chip('▲ 급증'))
    await waitFor(() => expect(codes().length).toBe(UP))
    fireEvent.click(chip('▼ 급감'))
    await waitFor(() => expect(codes().length).toBe(DN))
    /* 세 갈래는 겹치지 않고, 나머지는 표시 없음 */
    expect(UP + DN + CHK + 2).toBe(DRUGS.length)
  })
})

/* ═══ ⑧ 5·6번 판정 불변 증명 ═══
   「확인필요 대상이 아닌 줄」에서는 전·후 결과가 **글자 하나도** 달라지지 않아야 한다.
   식을 눈으로 비교하는 대신, 경계값을 모두 깐 표를 **실제로 렌더해서** ▲▼와 색을 본다.
   줄 수는 한 쪽 분량(20줄)에 맞췄다 — 쪽 나누기 때문에 21줄째는 화면에 없다. */
describe('⑧ 급증·급감이 전혀 변하지 않았다 (경계값 20줄)', () => {
  /* 확인필요가 될 수 없는 조합만 깐다: 값이 있고, 음수가 아니고, 0 이면 수기다 */
  const V = [0, 1, 49, 50, 51, 100, 149, 150, 151, 200]
  const GRID = []
  for (const ma of [0, 100]) for (const v1 of V) {
    GRID.push({ ...mk('G' + ma + '_' + v1, '경구제', v1), monthly_avg: ma })
  }
  /* ★ 옛 식을 **그대로** 적어 둔다 — 이것이 기준이다 */
  const old = (ma, v1) => (v1 == null || v1 === '') ? null
    : !(ma > 0) ? null
      : v1 > ma * 1.5 ? '급증' : v1 < ma * 0.5 ? '급감' : null

  it('★ 20줄 모두 옛 식과 같은 ▲▼·같은 색', async () => {
    render(<StockStatus drugs={GRID} inv={[]} navFilter={null}
      onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(GRID.length))
    const diff = []
    for (const d of GRID) {
      const tr = [...document.querySelectorAll('tbody tr')]
        .find(x => x.querySelector('td').textContent.trim() === d.drug_code)
      const mark = [...tr.querySelectorAll('span')].find(s => s.getAttribute('aria-label'))
      const got = mark ? mark.getAttribute('aria-label') : null
      const want = old(d.monthly_avg, d.recent_1m_usage)
      const color = mark ? mark.parentElement.style.color : null
      const wantColor = want === '급증' ? 'rgb(198, 40, 40)' : want === '급감' ? 'rgb(46, 74, 98)' : null
      if (got !== want || (want && color !== wantColor)) {
        diff.push(d.drug_code + ' 월평균' + d.monthly_avg + '·값' + d.recent_1m_usage
          + ' → 옛 ' + want + ' / 새 ' + got + ' (색 ' + color + ')')
      }
    }
    expect(diff, '달라진 줄:\n' + diff.join('\n')).toEqual([])
  })

  it('확인필요는 이 20줄에 하나도 없다 (대조군이 깨끗하다)', async () => {
    render(<StockStatus drugs={GRID} inv={[]} navFilter={null}
      onEdit={() => {}} onAdjust={() => {}} onReload={() => {}} onDispose={() => {}} />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(GRID.length))
    expect(document.querySelector('tbody').textContent).not.toContain('?')
  })
})

describe('⑥ 판정 함수가 한 곳뿐이다', () => {
  it('surgeOf 만 쓰고 옛 인라인 식은 없다', () => {
    const { readFileSync } = require('node:fs')
    const src = readFileSync('src/App.jsx', 'utf8')
    expect(src).toContain('function surgeOf(ma, v1, src)')
    expect(src, '옛 인라인 판정식이 남으면 두 벌이 된다')
      .not.toMatch(/\(ma>0&&v1>ma\*1\.5\)\?t\.red/)
    expect((src.match(/surgeOf\(/g) || []).length, '색·필터·엑셀이 같은 함수를 부른다')
      .toBeGreaterThanOrEqual(3)
  })

  /* ★ 5·6번(급증·급감) 식은 **한 글자도** 바꾸지 않기로 했다 — 글자 그대로 고정한다.
     확인필요를 넣다가 여기를 건드리면 지금까지 본 ▲▼가 조용히 달라진다. */
  it('★ 급증·급감 식이 글자 그대로다', () => {
    const { readFileSync } = require('node:fs')
    const src = readFileSync('src/App.jsx', 'utf8')
    expect(src).toContain("return v1 > ma * 1.5 ? '급증' : v1 < ma * 0.5 ? '급감' : null")
    expect(src, '월평균 게이트도 그대로').toContain('if (!(ma > 0)) return null')
  })

  it('★ 확인필요가 월평균 게이트보다 **먼저** 판정된다', () => {
    const { readFileSync } = require('node:fs')
    const src = readFileSync('src/App.jsx', 'utf8')
    const body = src.slice(src.indexOf('function surgeOf('), src.indexOf('const SURGE_ALL'))
    const iChk = body.lastIndexOf('return SURGE_CHECK')
    const iGate = body.indexOf('if (!(ma > 0)) return null')
    expect(iChk, '확인필요 판정이 있다').toBeGreaterThan(0)
    expect(iChk, '확인필요가 월평균 게이트보다 위에 있다').toBeLessThan(iGate)
  })
})
