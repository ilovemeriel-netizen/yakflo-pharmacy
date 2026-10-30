/* 백신관리 「LOT · 유효기한」 표 — 이름 전체 표시 · 정렬 · 머리글 메뉴.

   ★ 실제 VaccineManage 를 띄우고, 공용 부품(ColMenu)은 **진짜 것**을 App.jsx 에서 주입한다.
   ★ 고정하는 것
     ① 긴 이름이 잘리지 않는다 — 「…」도 없고 글자 수도 원본 그대로
     ② 기본 정렬은 유효기한 오름차순, 미기재는 뒤
     ③ 같은 유효기한이면 약품코드 → LOT 으로 묶인다(조회할 때마다 순서가 달라지지 않게)
     ④ 머리글(약품·LOT·유효기한)에 ColMenu 정렬 메뉴가 붙고 눌리면 순서가 바뀐다
     ⑤ 왼쪽 정렬·여백은 #379 그대로다(함정 #31)
     ⑥ 부작용 없음 — 약품별 집계표 정렬이 LOT 표 정렬에 따라 움직이지 않는다 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { useState } from 'react'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'

/* ── 재료 — 유효기한 동률·미기재·아주 긴 이름을 일부러 섞는다 ────────── */
const LONG = '65세 이상 어르신(플루백신VIII-TF주 0.5mL)'      /* 25자 — 옛 규칙이 18자에서 잘랐다 */
const LONG2 = '독감-5 지자체 (플루백신VIII-TF주 0.5mL)'        /* 24자 */
const ACCS = [
  { id: 'a1', drug_code: 'TETRA6', funding_source: '보건소', season: '2026-2027', is_active: true, public_label: null },
  { id: 'a2', drug_code: 'TETRA5', funding_source: '지자체', season: '2026-2027', is_active: true, public_label: null },
  { id: 'a3', drug_code: 'SPIKVX', funding_source: '일반', season: '2026-2027', is_active: true, public_label: null },
]
const BAL = ACCS.map((a, i) => ({
  account_id: a.id, drug_code: a.drug_code, funding_source: a.funding_source,
  allocated_qty: 0, received_qty: 100, administered_qty: 10 * i, returned_qty: 0,
  balance_qty: 100 - 10 * i, season: '2026-2027',
}))
/* 유효기한: a2 가 더 이르고, a1·a3 이 **같은 날**(동률) · a3 에 미기재 한 줄 */
const EVTS = [
  { id: 'e1', account_id: 'a1', event_type: '입고', qty: 50, event_date: '2026-10-01', lot_no: 'LOT-B', expiry_date: '2027-05-10', category_id: null, memo: null },
  { id: 'e2', account_id: 'a2', event_type: '입고', qty: 50, event_date: '2026-10-02', lot_no: 'LOT-Z', expiry_date: '2027-01-02', category_id: null, memo: null },
  { id: 'e3', account_id: 'a3', event_type: '입고', qty: 50, event_date: '2026-10-03', lot_no: 'LOT-A', expiry_date: '2027-05-10', category_id: null, memo: null },
  { id: 'e4', account_id: 'a3', event_type: '입고', qty: 10, event_date: '2026-10-04', lot_no: 'LOT-N', expiry_date: null, category_id: null, memo: null },
]
const DRUGS = [
  { drug_code: 'TETRA6', drug_name: LONG },
  { drug_code: 'TETRA5', drug_name: LONG2 },
  { drug_code: 'SPIKVX', drug_name: '스파이크박스프리필드시린지주' },
]

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  function from(table) {
    const rowsFor = () => {
      if (table === 'vaccine_accounts') return ACCS
      if (table === 'v_vaccine_balance') return BAL
      if (table === 'vaccine_events') return EVTS
      if (table === 'vaccine_categories') return []
      if (table === 'drugs') return DRUGS
      if (table === 'tenant_members') return [{ tenant_id: 'tn', role: 'owner' }]
      return []
    }
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, gte: () => q, lt: () => q,
      range: () => q, limit: () => q,
      maybeSingle: () => result(rowsFor()[0] || null),
      insert: () => result(null), update: () => q, upsert: () => result(null), delete: () => q,
      then(res) { return result(rowsFor()).then(res) },
    }
    return q
  }
  return { supabase: { from, rpc: () => result(null), auth: { getUser: () => result(null) } } }
})

const T = {
  bg: '#F7F6F3', card: '#fff', cardSolid: '#fff', border: '#E8E6E1', borderH: '#D7D7D7',
  text: '#2E4A62', textM: '#52524E', textL: '#A3A39E', accent: '#804A87', accentL: '#F5EDF6',
  purple: '#804A87', purpleL: '#F5EDF6', green: '#019748', greenL: '#E6F7EE',
  red: '#C62828', redL: '#FFEBEE', blue: '#2E4A62', blueL: '#EAF0F5',
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', lavender: '#BFA6D9', shadow: 'none', shadowH: 'none',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, profile: { id: 'u1' }, memberRole: 'owner' }) }
})

/* App.jsx 가 useSort 를 내보내지 않아 같은 모양을 여기서 만든다(TS 값도 그대로) */
function useSortLocal(ik = '') {
  const [sk, s1] = useState(ik)
  const [sd, s2] = useState('asc')
  return {
    sk, sd, setSort(k, d) { s1(k); s2(d) },
    so(a) { return a },
    TS() { return { padding: '10px 12px', textAlign: 'left', color: T.textM, fontWeight: 600, borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', background: 'transparent', fontSize: 11 } },
    SI() { return null }, hs() {},
  }
}

let VaccineManage, ColMenu
let styleEl, rootEl
beforeEach(async () => {
  styleEl = document.createElement('style')
  styleEl.textContent = '#root { text-align: center; }'
  document.head.appendChild(styleEl)
  rootEl = document.createElement('div'); rootEl.id = 'root'; document.body.appendChild(rootEl)
  if (!VaccineManage) {
    ColMenu = (await import('./App.jsx')).ColMenu
    VaccineManage = (await import('./VaccineManage.jsx')).default
  }
})
afterEach(() => { cleanup(); styleEl.remove(); rootEl.remove() })

const open = () => render(
  <VaccineManage ColMenu={ColMenu} useSort={useSortLocal} ymd={d => String(d).slice(0, 10)} todayYmd={() => '2026-10-31'} />,
  { container: rootEl })
const css = el => window.getComputedStyle(el)

/* LOT 표는 접힌 채 시작한다 — 펼쳐야 생긴다 */
/* ★ 머리글에 ColMenu 가 붙어 글자가 「LOT⇅」처럼 된다 — 정렬 기호를 떼고 찾는다 */
const clean = s => String(s || '').replace(/[⇅▲▼✓\s]/g, '')
const lotTable = () => [...document.querySelectorAll('table')]
  .find(tb => [...tb.querySelectorAll('th')].some(x => clean(x.textContent) === 'LOT'))
async function openLot() {
  open()
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))
  const head = [...document.querySelectorAll('*')]
    .find(el => el.children.length === 0 && el.textContent.trim() === 'LOT · 유효기한')
  expect(head, 'LOT 구역 머리를 찾지 못했다').toBeTruthy()
  /* ★ 머리글을 **한 번만** 누른다. React 재렌더는 비동기라, 바로 다시 눌러 보면
     아직 열린 줄 모르고 한 번 더 눌러 **도로 접는다**(처음에 그렇게 당했다).
     클릭은 버블링되므로 핸들러가 조상에 있어도 이 한 번으로 닿는다. */
  head.click()
  await waitFor(() => expect(lotTable()).toBeTruthy())
}
const lotRows = () => [...lotTable().querySelectorAll('tbody tr')]
const cellsOf = tr => [...tr.querySelectorAll('td')]
const nameAt = i => cellsOf(lotRows()[i])[0].textContent.trim()
const lotAt = i => cellsOf(lotRows()[i])[1].textContent.trim()
const expAt = i => cellsOf(lotRows()[i])[2].textContent.trim()
const thOf = label => [...lotTable().querySelectorAll('th')]
  .find(x => x.textContent.replace(/[⇅▲▼✓\s]/g, '').startsWith(label.replace(/\s/g, '')))

describe('① 약품 이름이 잘리지 않는다', () => {
  it('★ 긴 이름이 「…」 없이 전부 보인다', async () => {
    await openLot()
    const row = lotRows().find(r => cellsOf(r)[0].textContent.includes('TETRA6'))
    expect(row, 'TETRA6 줄을 찾지 못했다').toBeTruthy()
    const text = cellsOf(row)[0].textContent
    expect(text).toContain(LONG)
    expect(text, '말줄임이 남아 있다').not.toContain('…')
  })
  it('★ 괄호가 중간에서 끊기지 않는다', async () => {
    await openLot()
    const text = lotRows().map(r => cellsOf(r)[0].textContent).join(' ')
    expect(text).toContain('(플루백신VIII-TF주 0.5mL)')
    /* 여는 괄호 수 = 닫는 괄호 수 */
    expect((text.match(/\(/g) || []).length).toBe((text.match(/\)/g) || []).length)
  })
  it('★ 관리 화면은 원본 이름을 쓴다 — 공개용 가공을 들이지 않는다', async () => {
    await openLot()
    const text = lotRows().map(r => cellsOf(r)[0].textContent).join(' ')
    expect(text).toContain('독감-5 지자체')        /* publicDrugName 이면 사라졌을 부분 */
    expect(text).toContain('65세 이상 어르신')
    /* ★ 낱말이 아니라 **쓰임**을 본다 — 주석으로 「쓰지 않는다」고 적어 둘 수 있어야 한다 */
    const src = readFileSync('src/VaccineManage.jsx', 'utf8')
    expect(src, 'import 하지 않는다').not.toMatch(/import[^\n]*publicDrugName/)
    expect(src, '호출하지 않는다').not.toMatch(/publicDrugName\s*\(/)
  })
  it('넘치면 줄을 바꾼다 — 한 줄에 가두지 않는다', async () => {
    await openLot()
    const cell = cellsOf(lotRows()[0])[0]
    expect(css(cell).whiteSpace).toBe('normal')
    expect(css(cell).wordBreak).toBe('break-word')
  })
  it('다른 칸은 한 줄 유지(nowrap) — 약품 칸만 열었다', async () => {
    await openLot()
    const cells = cellsOf(lotRows()[0])
    expect(css(cells[1]).whiteSpace, 'LOT').toBe('nowrap')
    expect(css(cells[2]).whiteSpace, '유효기한').toBe('nowrap')
  })
})

describe('② 기본 정렬 — 유효기한 오름차순', () => {
  it('이른 유효기한이 먼저, 미기재는 맨 뒤', async () => {
    await openLot()
    expect(expAt(0)).toBe('2027-01-02')
    expect(expAt(1)).toBe('2027-05-10')
    expect(expAt(2)).toBe('2027-05-10')
    expect(expAt(3)).toBe('—')
  })
  it('★ 같은 유효기한이면 약품코드 → LOT 으로 묶인다', async () => {
    await openLot()
    /* 2027-05-10 두 줄: SPIKVX(LOT-A) 와 TETRA6(LOT-B) → 코드순 S < T */
    expect(nameAt(1)).toContain('SPIKVX')
    expect(nameAt(2)).toContain('TETRA6')
  })
})

describe('③ 머리글 정렬 메뉴 (공용 ColMenu)', () => {
  it('약품·LOT·유효기한에 메뉴가 붙는다', async () => {
    await openLot()
    for (const h of ['약품', 'LOT', '유효기한']) {
      expect(thOf(h), h + ' 머리글').toBeTruthy()
      expect(thOf(h).querySelector('span[title="정렬(오름→내림→해제)"]'), h + ' 정렬 아이콘').toBeTruthy()
    }
  })
  it('숫자·상태 머리글에는 메뉴를 붙이지 않았다', async () => {
    await openLot()
    for (const h of ['입고', '잔량(참고)', '상태']) {
      expect(thOf(h).querySelector('span[title="정렬(오름→내림→해제)"]'), h).toBeNull()
    }
  })
  it('★ LOT 머리글을 누르면 LOT 순으로 선다', async () => {
    await openLot()
    thOf('LOT').querySelector('span[title="정렬(오름→내림→해제)"]').click()
    await waitFor(() => expect(lotAt(0)).toBe('LOT-A'))
    expect([lotAt(0), lotAt(1), lotAt(2), lotAt(3)]).toEqual(['LOT-A', 'LOT-B', 'LOT-N', 'LOT-Z'])
  })
  it('★ 한 번 더 누르면 내림차순, 값 없는 줄은 그래도 뒤', async () => {
    await openLot()
    const icon = () => thOf('유효기한').querySelector('span[title="정렬(오름→내림→해제)"]')
    icon().click()
    await waitFor(() => expect(expAt(0)).toBe('2027-01-02'))
    icon().click()
    await waitFor(() => expect(expAt(0)).toBe('2027-05-10'))
    expect(expAt(3), '미기재는 방향과 무관하게 뒤').toBe('—')
  })
  it('세 번 누르면 해제되어 기본(유효기한 오름차순)으로 돌아온다', async () => {
    await openLot()
    const icon = () => thOf('LOT').querySelector('span[title="정렬(오름→내림→해제)"]')
    /* ★ 한 번 누를 때마다 재렌더를 기다린다. 연달아 누르면 ColMenu 가 **낡은 sk/sd** 로
       세 번 다 「처음 누름」처럼 처리해 해제까지 가지 않는다(처음에 그렇게 당했다). */
    icon().click()
    await waitFor(() => expect(lotAt(0)).toBe('LOT-A'))      /* 오름 */
    icon().click()
    await waitFor(() => expect(lotAt(0)).toBe('LOT-Z'))      /* 내림 */
    icon().click()
    await waitFor(() => expect(expAt(0)).toBe('2027-01-02')) /* 해제 → 기본 */
    expect(expAt(3)).toBe('—')
  })
})

describe('④ 정렬·여백은 #379 그대로 (함정 #31)', () => {
  it('약품·LOT·유효기한 칸이 왼쪽, 머리글과 여백 9px 동일', async () => {
    await openLot()
    const ths = [...lotTable().querySelectorAll('th')]
    const tds = cellsOf(lotRows()[0])
    for (const i of [0, 1, 2]) {
      expect(css(tds[i]).textAlign, i + '번째 칸').toBe('left')
      expect(css(tds[i]).paddingLeft).toBe(css(ths[i]).paddingLeft)
      expect(css(tds[i]).paddingLeft).toBe('9px')
    }
  })
  it('숫자 칸은 오른쪽 그대로', async () => {
    await openLot()
    const tds = cellsOf(lotRows()[0])
    for (const i of [3, 4]) expect(css(tds[i]).textAlign).toBe('right')
  })
})

/* 메뉴 항목 — ColMenu 는 켜진 항목 뒤에 ✓ 를 붙이므로 이름으로 찾을 때 기호를 뗀다 */
const menuItem = (label) => [...document.querySelectorAll('button')]
  .find(b => clean(b.textContent) === clean(label))
const openMenu = async (th) => {
  const lab = th.querySelector('span[title="필터"]')
  expect(lab, '필터 라벨을 찾지 못했다').toBeTruthy()
  lab.click()
  await waitFor(() => expect(menuItem('전체')).toBeTruthy())
}
/* 구역 머리의 건수 — 「N건」 또는 「N건 / 전체 M」.
   ★ 화면에 「1건」 같은 글자가 여러 곳(위쪽 요약 카드 「유효기한 임박 1건」 등)에 있다.
     조상을 더듬어 찾으면 그 카드를 집는다. 구역을 여닫는 **단추 안**의 글자만 본다 —
     제목과 건수가 한 단추에 나란히 있으므로 「LOT · 유효기한」을 품은 단추가 곧 그 구역이다. */
const lotHint = () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('LOT · 유효기한'))
  if (!btn) return ''
  const el = [...btn.querySelectorAll('span')].find(e => /^\d+건/.test(e.textContent.trim()))
  return el ? el.textContent.trim() : ''
}

describe('⑦ 약품 복수 필터 (LOT 표)', () => {
  it('약품 머리글에만 필터가 붙는다', async () => {
    await openLot()
    expect(thOf('약품').querySelector('span[title="필터"]'), '약품').toBeTruthy()
    for (const h of ['LOT', '유효기한', '입고', '잔량(참고)', '상태']) {
      expect(thOf(h).querySelector('span[title="필터"]'), h + ' 는 필터 없음').toBeNull()
    }
  })
  it('메뉴에 「코드 · 이름」으로 항목이 뜬다', async () => {
    await openLot()
    await openMenu(thOf('약품'))
    expect(menuItem('TETRA6 · ' + LONG), 'TETRA6 항목').toBeTruthy()
    expect(menuItem('SPIKVX · 스파이크박스프리필드시린지주'), 'SPIKVX 항목').toBeTruthy()
  })
  it('★ 하나를 끄면 그 약품 줄이 사라지고 건수도 함께 준다', async () => {
    await openLot()
    expect(lotHint()).toMatch(/^4건/)
    await openMenu(thOf('약품'))
    menuItem('SPIKVX · 스파이크박스프리필드시린지주').click()
    await waitFor(() => expect(lotRows().length).toBe(2))
    expect(lotHint(), '건수 = 보이는 줄 수').toMatch(/^2건 \/ 전체 4/)
    expect(lotRows().map((_, i) => nameAt(i)).join(' ')).not.toContain('SPIKVX')
  })
  it('★ 복수 선택 — 고를 때마다 메뉴가 닫히지 않는다', async () => {
    await openLot()
    await openMenu(thOf('약품'))
    menuItem('SPIKVX · 스파이크박스프리필드시린지주').click()
    /* ★ 한 번 누를 때마다 재렌더를 기다린다 — 연달아 누르면 두 번째가 **낡은 값**으로
       토글해 첫 선택이 묻힌다(정렬에서 겪은 것과 같은 함정). */
    await waitFor(() => expect(lotRows().length).toBe(2))
    expect(menuItem('TETRA5 · ' + LONG2), '메뉴가 열린 채여야 한다').toBeTruthy()
    menuItem('TETRA5 · ' + LONG2).click()
    await waitFor(() => expect(lotRows().length).toBe(1))
    expect(nameAt(0)).toContain('TETRA6')
  })
  it('「전체」로 되돌리면 건수도 돌아온다', async () => {
    await openLot()
    await openMenu(thOf('약품'))
    menuItem('SPIKVX · 스파이크박스프리필드시린지주').click()
    await waitFor(() => expect(lotRows().length).toBe(2))
    menuItem('전체').click()
    await waitFor(() => expect(lotRows().length).toBe(4))
    expect(lotHint()).toMatch(/^4건/)
    expect(lotHint(), '전체면 「/ 전체」를 붙이지 않는다').not.toContain('/ 전체')
  })
  it('필터와 정렬이 함께 걸린다', async () => {
    await openLot()
    await openMenu(thOf('약품'))
    menuItem('SPIKVX · 스파이크박스프리필드시린지주').click()
    await waitFor(() => expect(lotRows().length).toBe(2))
    thOf('LOT').querySelector('span[title="정렬(오름→내림→해제)"]').click()
    await waitFor(() => expect(lotAt(0)).toBe('LOT-B'))
    expect(lotRows().length, '필터가 풀리지 않는다').toBe(2)
  })
})

describe('⑧ 공개 표시명 표 — 약품명 정렬·필터', () => {
  const pubTable = () => [...document.querySelectorAll('table')]
    .find(tb => [...tb.querySelectorAll('th')].some(x => clean(x.textContent) === '공개표시명'))
  const pubRows = () => [...pubTable().querySelectorAll('tbody tr')]
  const pubTh = (label) => [...pubTable().querySelectorAll('th')]
    .find(x => clean(x.textContent).startsWith(clean(label)))
  const pubCount = () => {
    const el = [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && /^\d+건( \/ 전체 \d+)?$/.test(e.textContent.trim()))
    return el.length ? el[el.length - 1].textContent.trim() : ''
  }
  async function openPub() {
    open()
    await waitFor(() => expect(pubTable()).toBeTruthy())
  }

  it('약품명 머리글에만 메뉴가 붙는다', async () => {
    await openPub()
    expect(pubTh('약품명').querySelector('span[title="필터"]'), '약품명').toBeTruthy()
    for (const h of ['약품코드', '재원', '공개 표시명', '공개']) {
      expect(pubTh(h).querySelector('span[title="필터"]'), h + ' 는 변경 없음').toBeNull()
    }
  })
  it('★ 필터를 걸면 줄과 건수가 함께 준다', async () => {
    await openPub()
    const all = pubRows().length
    expect(pubCount()).toBe(all + '건')
    await openMenu(pubTh('약품명'))
    menuItem('스파이크박스프리필드시린지주').click()
    await waitFor(() => expect(pubRows().length).toBe(all - 1))
    expect(pubCount()).toBe((all - 1) + '건 / 전체 ' + all)
  })
  it('정렬 — 약품명 가나다순으로 선다', async () => {
    await openPub()
    pubTh('약품명').querySelector('span[title="정렬(오름→내림→해제)"]').click()
    await waitFor(() => expect(pubTh('약품명').textContent).toMatch(/[▲▼]/))
    const names = pubRows().map(r => r.querySelectorAll('td')[2].textContent.trim())
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ko')))
  })
  it('★ 필터 중에도 공개 표시명 입력·저장 대상이 그대로다 (데이터는 안 건드린다)', async () => {
    await openPub()
    /* 먼저 **걸러질 줄**의 표시명을 고친다 */
    const target = pubRows().find(r => r.querySelectorAll('td')[2].textContent.includes('스파이크박스'))
    const input = target.querySelector('input')
    fireEvent.change(input, { target: { value: '코로나(모더나)' } })
    await waitFor(() => expect(document.body.textContent).toContain('바뀐 칸 1개'))
    /* 그 줄을 걸러 내도 「바뀐 칸」은 그대로여야 한다 */
    await openMenu(pubTh('약품명'))
    menuItem('스파이크박스프리필드시린지주').click()
    await waitFor(() => expect(pubRows().every(r => !r.textContent.includes('스파이크박스'))).toBe(true))
    expect(document.body.textContent, '안 보이는 수정이 사라지면 안 된다').toContain('바뀐 칸 1개')
  })
})

/* ★ 시안 캡처 — 실제 렌더 결과를 떠 둔다(함정 #27). CAPTURE_DIR 이 있을 때만 파일로 남긴다. */
describe('⑥ 시안 캡처', () => {
  it('표와 머리글 메뉴 연 모습을 떠 둔다', async () => {
    const dir = process.env.CAPTURE_DIR
    await openLot()
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(dir + '/app.html', rootEl.innerHTML, 'utf8')
    }
    /* ★ 이 표의 ColMenu 에는 filter 를 주지 않았으므로 **열리는 드롭다운이 없다** —
       라벨을 눌러도 아무 일이 없고, 정렬 삼각형만 오름→내림→해제로 돈다.
       그래서 「메뉴 열린 모습」 대신 **정렬이 걸린 모습**을 떠 둔다. */
    const icon = thOf('약품').querySelector('span[title="정렬(오름→내림→해제)"]')
    expect(icon, '정렬 아이콘을 찾지 못했다').toBeTruthy()
    icon.click()
    await waitFor(() => expect(thOf('약품').textContent).toMatch(/[▲▼]/))
    if (dir) writeFileSync(dir + '/sorted.html', rootEl.innerHTML, 'utf8')
    expect(lotTable()).toBeTruthy()
  })
})

describe('⑤ 부작용 없음', () => {
  const aggTable = () => [...document.querySelectorAll('table')]
    .find(tb => { const h = [...tb.querySelectorAll('th')].map(x => x.textContent); return h.some(x => x.includes('약품명')) && h.some(x => x.includes('잔여')) })

  it('★ LOT 표 정렬을 바꿔도 약품별 집계표 순서가 그대로다', async () => {
    await openLot()
    const before = [...aggTable().querySelectorAll('tbody tr')].map(r => r.querySelector('td').textContent.trim())
    thOf('LOT').querySelector('span[title="정렬(오름→내림→해제)"]').click()
    await waitFor(() => expect(lotAt(0)).toBe('LOT-A'))
    const after = [...aggTable().querySelectorAll('tbody tr')].map(r => r.querySelector('td').textContent.trim())
    expect(after).toEqual(before)
  })
  it('백신 카드의 잔량·소진율이 그대로 보인다', async () => {
    await openLot()
    const txt = document.body.textContent
    expect(txt).toContain('소진율')
    expect(txt).toContain('TETRA6')
    expect(txt).toContain('TETRA5')
  })
  it('LOT 표 줄 수가 입고 이벤트 수와 같다', async () => {
    await openLot()
    expect(lotRows().length).toBe(EVTS.filter(e => e.event_type === '입고').length)
  })
  it('인쇄 표식을 건드리지 않았다', () => {
    const src = readFileSync('src/VaccineManage.jsx', 'utf8')
    expect(src).not.toContain('@media print')
    expect(readFileSync('src/App.jsx', 'utf8').split('no-print').length - 1).toBeGreaterThan(10)
  })
  it('★ 공용 ColMenu 를 고치지 않았다', () => {
    const src = readFileSync('src/App.jsx', 'utf8')
    const i = src.indexOf('export function ColMenu(')
    expect(src.slice(i, src.indexOf('\n', i)).trim())
      .toBe('export function ColMenu({ colKey, label, sk, sd, setSort, filter }) {')
  })
})
