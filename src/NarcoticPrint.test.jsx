/* 향정·마약류 인쇄 리포트 — 2026-11-02.

   ★ 고정하는 것
     ① 화면에 보이는 줄 수 = 종이에 찍히는 줄 수 (칩·카드·검색 어떤 조합이든)
     ② 머리글 칸 수 = 몸통 칸 수 (함정 #27)
     ③ 글자를 자르지 않는다 (함정 #32) · 칸마다 정렬을 직접 적는다 (함정 #31)
     ④ **다른 인쇄물에 영향 0** — 새 인쇄 CSS 에 @page 가 없고,
       용지 설정은 누를 때만 끼웠다 뺀다
     ⑤ 비밀값·내부 ID 가 종이에 안 나온다 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mk = (code, name, nt, cat, ing, en, status = '사용') => ({
  drug_code: code, drug_name: name, narcotic_type: nt, is_narcotic: true,
  category: cat, ingredient_kr: ing, ingredient_en: en, status,
  current_qty: 10, expiry_date: '2027-05-31', atc_l1: 'N', manufacturer: '한국제약',
})
const DRUGS = [
  mk('NARC1', '염산페티딘주사액 50mg/1mL', '마약', '주사제', '페티딘염산염', 'Pethidine Hydrochloride'),
  mk('NARC2', '모르핀황산염수화물주사액 10mg', '마약', '주사제', '모르핀황산염수화물', 'Morphine Sulfate Hydrate'),
  mk('PSY1', '알프라졸람정 0.25mg', '향정', '경구제', '알프라졸람', 'Alprazolam'),
  mk('PSY2', '졸피뎀타르타르산염정 10mg', '향정', '경구제', '졸피뎀타르타르산염', ''),
  mk('PSY3', '디아제팜주사액 10mg/2mL', '향정', '주사제', '디아제팜', 'Diazepam'),
  mk('STOP1', '중지된향정정 1mg', '향정', '경구제', '테스트성분', 'TestIngredient', '중지'),
]

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
  amber: '#B8860B', amberL: '#FFF8E1', nav: '#2E4A62', shadow: 'none', shadowH: 'none', lavender: '#BFA6D9',
}
vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return { ...real, useTheme: () => ({ t: T, dark: false, setTheme: () => {}, memberRole: 'owner', profile: { role: 'user' } }) }
})

let NarcoticMgmt
beforeEach(async () => { if (!NarcoticMgmt) NarcoticMgmt = (await import('./App.jsx')).NarcoticMgmt })
afterEach(() => cleanup())

const open = async () => {
  render(<NarcoticMgmt drugs={DRUGS} onEdit={() => {}} onAdjust={() => {}} navFilter={null} />)
  await waitFor(() => expect(document.querySelectorAll('.np-main tbody tr').length).toBeGreaterThan(0))
}
const 인쇄행 = () => document.querySelectorAll('.np-main tbody tr').length
const btn = s => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === s)

describe('① 「인쇄」 단추', () => {
  it('★ 「엑셀」 바로 오른쪽에 있다', async () => {
    await open()
    const ex = btn('엑셀'), pr = btn('인쇄')
    expect(ex, '엑셀').toBeTruthy()
    expect(pr, '인쇄').toBeTruthy()
    expect(ex.nextElementSibling, '엑셀 바로 다음이 인쇄여야 한다').toBe(pr)
  })
  it('보이는 조건이 「엑셀」과 같다 — 둘 다 역할을 안 본다', () => {
    const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
    const i = APP.indexOf('>엑셀</button>')
    const seg = APP.slice(i - 400, i + 400)
    expect(seg, '엑셀에 역할 조건이 붙으면 인쇄도 같이 봐야 한다').not.toMatch(/memberRole[^<]{0,40}&&<button onClick=\{dl\}/)
  })
  it('새 라이브러리를 쓰지 않는다 — window.print 하나', () => {
    const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
    expect(APP).toContain('const narcPrint=()=>setNarcAsk(true)')
    expect(APP, '실제 인쇄는 effect 에서 — 고른 값이 그려진 뒤여야 한다')
      .toContain('useEffect(()=>{if(narcGo)window.print()},[narcGo])')
    expect(APP, 'react-to-print 금지').not.toContain('react-to-print')
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    for (const k of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(k, '새 인쇄 라이브러리가 들어왔다').not.toMatch(/print|lucide/i)
    }
  })
})

describe('② 화면 줄 수 = 종이 줄 수', () => {
  it('처음 상태(사용) — 중지 약품은 안 들어간다', async () => {
    await open()
    expect(인쇄행()).toBe(DRUGS.filter(d => d.status === '사용').length)
    expect(document.querySelector('.narc-print').textContent).not.toContain('중지된향정정')
  })
  it('★ 카드 「마약」을 고르면 마약만', async () => {
    await open()
    fireEvent.click([...document.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('마약') && /\d/.test(d.textContent)))
    await waitFor(() => expect(인쇄행()).toBeLessThan(5))
    const txt = document.querySelector('.narc-print').textContent
    expect(txt).toContain('염산페티딘주사액')
    expect(txt, '향정이 섞이면 안 된다').not.toContain('알프라졸람정')
  })
  it('★ 검색어를 넣으면 그 줄만', async () => {
    await open()
    fireEvent.change(document.querySelector('input[placeholder*="검색"]'), { target: { value: '알프라졸람' } })
    await waitFor(() => expect(인쇄행()).toBe(1))
    expect(document.querySelector('.narc-print').textContent).toContain('알프라졸람정 0.25mg')
  })
  it('★ 아무것도 안 걸리면 「없습니다」가 뜬다 — 빈 표가 아니다', async () => {
    await open()
    fireEvent.change(document.querySelector('input[placeholder*="검색"]'), { target: { value: '없는약품이름zzz' } })
    await waitFor(() => expect(인쇄행()).toBe(0))
    expect(document.querySelector('.narc-print').textContent).toContain('해당하는 약품이 없습니다')
  })
  it('머리에 출력일시·필터·건수가 적힌다', async () => {
    await open()
    const m = document.querySelector('.narc-print .np-m').textContent
    expect(m).toMatch(/출력 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect(m).toContain('상태 사용')
    expect(m).toMatch(/모두 \d+건/)
  })
})

describe('③ 표 모양 — 함정 #27·#31·#32', () => {
  /* ★ 세로 병합(rowspan)이 들어가 「칸 수」를 그냥 세면 안 된다 —
     묶음 **첫 줄**은 번호+구분+제형+3 = 6칸, 이어지는 줄은 구분·제형이 없어 4칸이다.
     머리글 6칸과 맞는지 보려면 rowspan 을 펼쳐 세야 한다(함정 #27 의 변형). */
  it('★ 머리글 칸 수 = 몸통 칸 수 — rowspan 을 펼쳐 센다 (함정 #27)', async () => {
    await open()
    const th = document.querySelectorAll('.np-main thead th').length
    expect(th, '머리글 6칸').toBe(6)
    for (const tb of document.querySelectorAll('.np-main tbody.np-g')) {
      const first = tb.querySelector('tr')
      const n = first.querySelectorAll('td').length
      expect(n, '묶음 첫 줄은 6칸').toBe(6)
      for (const tr of [...tb.querySelectorAll('tr')].slice(1)) {
        expect(tr.querySelectorAll('td').length, '이어지는 줄은 4칸(구분·제형은 위에서 병합)').toBe(4)
      }
    }
  })
  it('머리글 글자가 정해진 대로다', async () => {
    await open()
    const hs = [...document.querySelectorAll('.np-main thead th')].map(e => e.textContent.trim())
    /* ★ 2026-11-02 — 「규격」을 「성분명(영문)」으로 바꿨다.
       specification 은 함량이 아니라 **세부 제형**(정제·주사제·패취제)이라
       옆의 「제형」 열과 뜻이 겹쳤다. 영문 성분명은 29종 전부 값이 있다. */
    expect(hs).toEqual(['번호', '마약류 구분', '제형', '약품명', '성분명', '성분명(영문)'])
  })
  it('★ 번호가 1부터 끊김 없이 이어진다 — 묶음이 바뀌어도', async () => {
    await open()
    const nos = [...document.querySelectorAll('.np-main .np-no')].map(e => Number(e.textContent.trim()))
    expect(nos[0]).toBe(1)
    expect(nos).toEqual(nos.map((_, i) => i + 1))
  })
  it('★ 구분·제형은 묶음마다 한 번만 — rowspan 으로 묶인다', async () => {
    await open()
    for (const tb of document.querySelectorAll('.np-main tbody.np-g')) {
      const grp = tb.querySelectorAll('.np-grp')
      expect(grp.length, '묶음마다 구분+제형 두 칸').toBe(2)
      expect(Number(grp[0].getAttribute('rowspan'))).toBe(tb.querySelectorAll('tr').length)
    }
  })
  it('★ 긴 이름을 자르지 않는다 (함정 #32)', async () => {
    await open()
    const txt = document.querySelector('.narc-print').textContent
    expect(txt).toContain('모르핀황산염수화물주사액 10mg')
    expect(txt, '… 로 잘린 흔적이 있으면 안 된다').not.toContain('…')
  })
  it('★ 칸마다 정렬을 직접 적는다 (함정 #31)', async () => {
    await open()
    for (const td of document.querySelectorAll('.np-main tbody tr:first-child td')) {
      expect(td.className, '정렬 클래스가 없다: ' + td.textContent).toMatch(/np-(l|c)/)
    }
  })
  it('약품명이 굵게 · 마약류 구분은 테두리 뱃지', async () => {
    await open()
    expect(document.querySelector('.np-main tbody .np-name')).toBeTruthy()
    expect(document.querySelector('.np-main tbody .np-b')).toBeTruthy()
  })
  it('서명 칸과 저작권 문구가 있다', async () => {
    await open()
    const txt = document.querySelector('.narc-print').textContent
    expect(txt).toContain('작성자')
    expect(txt).toContain('확인자')
    expect(txt).toContain('© 2026 JEONGHWALEE. All rights reserved.')
  })
  /* ★ 정렬 3단계 — 마약/향정 → 제형(경구→주사→외용) → 약품명 가나다 */
  it('정렬 — 마약 먼저 → 제형 → 약품명 가나다', async () => {
    await open()
    const rows = [...document.querySelectorAll('.np-main tbody.np-g')].flatMap(tb => {
      const g = tb.querySelectorAll('.np-grp')
      const nt = g[0].textContent.trim(), cat = g[1].textContent.trim()
      return [...tb.querySelectorAll('.np-name')].map(e => ({ nt, cat, name: e.textContent.trim() }))
    })
    expect(rows[0].nt, '마약이 먼저').toBe('마약')
    expect(rows[0].name).toBe('모르핀황산염수화물주사액 10mg')
    expect(rows[1].name).toBe('염산페티딘주사액 50mg/1mL')
    /* 향정 묶음은 경구제가 주사제보다 앞 */
    const psy = rows.filter(r => r.nt === '향정')
    const firstInj = psy.findIndex(r => r.cat === '주사제')
    const lastOral = psy.map(r => r.cat).lastIndexOf('경구제')
    expect(lastOral, '경구제가 주사제보다 앞').toBeLessThan(firstInj)
  })
})

describe('④ ★ 다른 인쇄물에 영향 0', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
  const i = APP.indexOf('const NARC_PRINT_CSS=`')
  const CSS = APP.slice(i, APP.indexOf('`', i + 22))

  it('★ 새 인쇄 CSS 에 @page 가 **없다** — 전역 용지를 덮지 않는다', () => {
    expect((CSS.match(/@page/g) || []).length).toBe(0)
    expect(CSS).not.toMatch(/size:\s*A4/)
  })
  /* ★ 2026-11-02 결정 ⑤ — 15mm 주입을 버리고 전역 12mm 에 맞췄다.
     전: <style id="narc-page-style"> 주입 → afterprint 제거 → 1.5초 보험
     후: window.print() 한 줄. 용지를 아예 안 건드리므로 영향 0 이 저절로 증명된다. */
  it('★ 용지를 아예 건드리지 않는다 — 전역 12mm 를 그대로 쓴다', () => {
    expect(APP, '주입 코드가 남으면 안 된다').not.toContain('narc-page-style')
    expect(APP, '보험 타이머도 없어야 한다').not.toContain('setTimeout(off,1500)')
  })
  it('★ 묶음이 쪽 경계에서 쪼개지지 않는다', () => {
    expect(CSS).toContain('.narc-print tbody.np-g{break-inside:avoid;page-break-inside:avoid}')
  })
  it('★ 제형 배경은 인쇄에 실리게 print-color-adjust 를 준다', () => {
    expect(CSS).toContain('-webkit-print-color-adjust:exact')
    expect(CSS).toContain('print-color-adjust:exact')
  })
  /* ★ 2026-11-02 결정 — 나안(팔레트 안 색만 옅게). 가안(살구·하늘·노랑)은 **삭제**했다. */
  it('★ 제형 배경은 브랜드 4색만 쓴다 — 새 색 0건', () => {
    for (const rgba of ['rgba(191,166,217,0.22)', 'rgba(46,74,98,0.14)', 'rgba(1,151,72,0.14)']) {
      expect(CSS, rgba).toContain(rgba)
    }
    /* 191,166,217=#BFA6D9 라벤더 · 46,74,98=#2E4A62 네이비 · 1,151,72=#019748 녹색 */
    expect(CSS, '가안의 살구').not.toContain('#FFE5D0')
    expect(CSS, '가안의 하늘').not.toContain('#D8ECFA')
    expect(CSS, '가안의 노랑').not.toContain('#FFF6C8')
  })
  it('★ 인쇄 CSS 에 새 색(브랜드 4색 밖의 16진 색)이 없다', () => {
    const OK = ['#000', '#fff', '#FFF', '#333', '#666', '#804A87', '#019748', '#BFA6D9', '#2E4A62']
    const hexes = [...new Set(CSS.match(/#[0-9a-fA-F]{3,6}/g) || [])]
    for (const h of hexes) expect(OK, '새 색: ' + h).toContain(h)
  })
  it('★ 배경색이 화면 쪽으로 새지 않았다', () => {
    const outside = APP.split(CSS).join('')
    for (const rgba of ['rgba(191,166,217,0.22)', 'rgba(46,74,98,0.14)', 'rgba(1,151,72,0.14)']) {
      expect(outside, rgba + ' 가 화면 쪽에도 있다').not.toContain(rgba)
    }
  })
  it('머리글 아래가 이중선이다', () => {
    expect(CSS).toContain('border-bottom:3pt double #000')
  })
  it('★ 전역 @page(A4 세로 12mm)는 그대로다', () => {
    expect(APP).toContain('@page { size: A4 portrait; margin: 12mm; }')
  })
  it('★ 다른 인쇄 마커 6종이 그대로다', () => {
    for (const [m, n] of [['cnc-print-month', 7], ['atc-print-only', 14], ['cnc-report-table', 31],
      ['ward-print', 23], ['loc-print', 36], ['alc-grid', 3]]) {
      expect((APP.match(new RegExp(m, 'g')) || []).length, m).toBe(n)
    }
  })
  it('인쇄 규칙이 이 화면 안에서만 돈다 — 선택자가 전부 .narc 로 시작', () => {
    const sels = CSS.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('/*') && l.includes('{') && !l.startsWith('@'))
    for (const s of sels) {
      expect(s.startsWith('.narc') || s.startsWith('}'), '화면 밖으로 새는 선택자: ' + s).toBe(true)
    }
  })
})

describe('⑤ 종이에 비밀이 안 나온다', () => {
  it('★ 키·토큰·내부 ID 가 없다', async () => {
    await open()
    const txt = document.querySelector('.narc-print').textContent
    for (const bad of ['eyJ', 'supabase', 'SUPABASE', 'apikey', 'Bearer', 'http']) {
      expect(txt, bad).not.toContain(bad)
    }
    /* 약품코드(내부 코드)도 종이에는 넣지 않았다 */
    expect(txt).not.toContain('NARC1')
    expect(txt).not.toContain('PSY1')
  })
  it('인쇄 표에 uuid 모양 글자가 없다', async () => {
    await open()
    expect(document.querySelector('.narc-print').textContent)
      .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
  })
})

/* ═══ ⑥ 게시용 / 심사용 고르기 ═══ */
describe('⑥ 「인쇄」를 누르면 쓰임새를 먼저 고른다', () => {
  const 창 = () => [...document.querySelectorAll('div')]
    .find(d => d.textContent.includes('어떤 쓰임새로 뽑을까요?'))
  const inDlg = s => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === s)

  it('★ 누르면 바로 인쇄하지 않고 창이 뜬다', async () => {
    await open()
    expect(창(), '누르기 전에는 창이 없다').toBeFalsy()
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
  })
  it('단추 셋 — 취소 · 게시용 · 심사용', async () => {
    await open()
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
    for (const s of ['취소', '게시용', '심사용']) expect(inDlg(s), s).toBeTruthy()
  })
  it('★ 「게시용」 — 서명 칸이 없다', async () => {
    await open()
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
    fireEvent.click(inDlg('게시용'))
    await waitFor(() => expect(창()).toBeFalsy())
    expect(document.querySelector('.np-sign'), '게시용에는 서명 칸이 없어야 한다').toBeFalsy()
    expect(document.querySelector('.narc-print').textContent).not.toContain('작성자')
  })
  it('★ 「심사용」 — 서명 칸이 있다', async () => {
    await open()
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
    fireEvent.click(inDlg('심사용'))
    await waitFor(() => expect(창()).toBeFalsy())
    expect(document.querySelector('.np-sign')).toBeTruthy()
    const txt = document.querySelector('.narc-print').textContent
    expect(txt).toContain('작성자')
    expect(txt).toContain('확인자')
  })
  it('★ 「취소」 — 창만 닫히고 아무 일도 없다', async () => {
    await open()
    const before = document.querySelector('.narc-print').innerHTML
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
    fireEvent.click(inDlg('취소'))
    await waitFor(() => expect(창()).toBeFalsy())
    expect(document.querySelector('.narc-print').innerHTML, '표가 그대로다').toBe(before)
  })
  it('★ Esc 로도 닫힌다', async () => {
    await open()
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(창()).toBeFalsy())
  })
  it('창에 건수가 적힌다', async () => {
    await open()
    fireEvent.click(btn('인쇄'))
    await waitFor(() => expect(창()).toBeTruthy())
    expect(창().textContent).toContain('모두 ' + 인쇄행() + '건')
  })
})

/* ═══ ⑦ 「성분명(영문)」 열 ═══ */
describe('⑦ 성분명(영문)', () => {
  it('★ 영문 성분명이 나온다', async () => {
    await open()
    const txt = document.querySelector('.narc-print').textContent
    expect(txt).toContain('Pethidine Hydrochloride')
    expect(txt).toContain('Alprazolam')
  })
  it('★ 영문이 없으면 빈칸 — 「-」 같은 글자를 넣지 않는다', async () => {
    await open()
    const row = [...document.querySelectorAll('.np-main tbody tr')]
      .find(tr => tr.textContent.includes('졸피뎀타르타르산염정'))
    const en = row.querySelector('.np-en')
    expect(en, '영문 칸이 있다').toBeTruthy()
    expect(en.textContent.trim(), '빈칸이어야 한다').toBe('')
  })
  it('★ 긴 영문을 자르지 않는다 (함정 #32)', async () => {
    await open()
    const txt = document.querySelector('.narc-print').textContent
    expect(txt).toContain('Morphine Sulfate Hydrate')
    expect(txt).not.toContain('…')
  })
  it('세부 제형(specification)은 더 이상 종이에 안 나온다 — 제형 열과 겹쳤다', async () => {
    await open()
    const hs = [...document.querySelectorAll('.np-main thead th')].map(e => e.textContent.trim())
    expect(hs).not.toContain('규격')
  })
})
