/* 보관위치 — 「중지」 숨김 + 시스템 위치(임시보관함).

   ★ 실제 컴포넌트를 렌더한다 — LocDrugsModal·LocationVocab 을 그대로 마운트하고,
     supabase 는 통째로 가짜로 바꿔 **질의에 붙은 조건을 받아 적는다.**
     그래서 「상태 조건을 걸었나」를 소스 대조가 아니라 **실제 호출**로 확인한다.

   ★ 고정하는 것
     ① 위치별 약품 창이 중지를 빼고 조회하고, 머리글 건수 = 보이는 줄 수
     ② 위치 목록의 「사용 약품」 건수도 같은 기준(중지 제외)
     ③ 세 경로(건수·목록·인쇄)가 **같은 상수**를 쓴다 — 하나만 고치면 어긋난다
     ④ 임시보관함이 맨 위에 고정되고 이름 변경·삭제·중지·순서가 막힌다
     ⑤ 위치 값 자체는 지우지 않는다(다시 「사용」이 되면 돌아온다) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { planReorder } from './lib/locOrder'

/* ── 가짜 약품 — D-1 에 사용 3 · 중지 2(폴리콜정 같은 건) ───────────────── */
const DRUGS = [
  { id: 'd1', drug_code: 'AAA', drug_name: '가나다정', category: '경구제', current_qty: 10, status: '사용', storage_location: 'D-1' },
  { id: 'd2', drug_code: 'BBB', drug_name: '나다라정', category: '경구제', current_qty: 0, status: '사용', storage_location: 'D-1' },
  { id: 'd3', drug_code: 'CCC', drug_name: '다라마주', category: '주사제', current_qty: 5, status: '휴면', storage_location: 'D-1' },
  { id: 'd4', drug_code: 'PLC', drug_name: '시험_폴리콜정', category: '경구제', current_qty: 215, status: '중지', storage_location: 'D-1' },
  { id: 'd5', drug_code: 'DDD', drug_name: '라마바정', category: '경구제', current_qty: 0, status: '중지', storage_location: 'D-1' },
  { id: 'd6', drug_code: 'EEE', drug_name: '마바사정', category: '경구제', current_qty: 7, status: '사용', storage_location: 'O-1' },
]
const VOCAB = [
  { id: 'v0', tenant_id: 'tn', code: '보관 위치를 정하기 전 잠시 두는 약품', label: '임시보관(미지정)', sort_order: 0, is_active: true, is_system: true },
  { id: 'v1', tenant_id: 'tn', code: 'D-1', label: 'D-1', sort_order: 1, is_active: true, is_system: false },
  { id: 'v2', tenant_id: 'tn', code: '주사 냉장', label: 'O-1', sort_order: 2, is_active: true, is_system: false },
  { id: 'v3', tenant_id: 'tn', code: 'T-1', label: 'T-1', sort_order: 3, is_active: true, is_system: false },
]

/* 질의에 붙은 조건을 받아 적는다 — 시험이 「실제로 무엇을 보냈는지」 본다 */
const calls = []
const writes = []

vi.mock('./lib/supabase', () => {
  const result = data => Promise.resolve({ data, error: null })
  function from(table) {
    const st = { table, cols: null, in: null, eq: {}, kind: 'select' }
    calls.push(st)
    const q = {
      select(c) { st.cols = c; return q },
      in(col, vals) { st.in = { col, vals }; return q },
      eq(col, v) { st.eq[col] = v; return q },
      order() { return q },
      range(a, b) { st.range = [a, b]; return q },
      limit() { return q },
      maybeSingle() { return result({ tenant_id: 'tn' }) },
      update(v) { st.kind = 'update'; st.payload = v; writes.push(st); return q },
      delete() { st.kind = 'delete'; writes.push(st); return q },
      insert(v) { st.kind = 'insert'; st.payload = v; writes.push(st); return result(null) },
      upsert(v) { st.kind = 'upsert'; st.payload = v; writes.push(st); return result(null) },
      then(res) {
        if (table === 'location_vocab') return result(VOCAB).then(res)
        if (table === 'tenant_members') return result({ tenant_id: 'tn' }).then(res)
        if (table === 'drugs') {
          let rows = DRUGS
          if (st.in && st.in.col === 'status') rows = rows.filter(d => st.in.vals.includes(d.status))
          if (st.eq.storage_location) rows = rows.filter(d => d.storage_location === st.eq.storage_location)
          return result(rows.map(d => ({ ...d }))).then(res)
        }
        return result([]).then(res)
      },
    }
    return q
  }
  return { supabase: { from, rpc: () => result(null), auth: { getUser: () => result(null) } } }
})

vi.mock('./lib/theme', async (orig) => {
  const real = await orig()
  return {
    ...real,
    useTheme: () => ({
      t: {
        bg: '#fff', card: '#fff', border: '#ddd', text: '#111', textM: '#555', textL: '#888',
        accent: '#804A87', purple: '#804A87', purpleL: '#f2ecf7', lavender: '#BFA6D9',
        green: '#019748', greenL: '#eafaf0', red: '#c00', amber: '#c80', nav: '#2E4A62',
        shadowH: 'none',
      },
      memberRole: 'owner', profile: { role: 'admin' },
    }),
  }
})

const { LocDrugsModal, LocationVocab } = await import('./App.jsx')

beforeEach(() => { calls.length = 0; writes.length = 0; cleanup() })

const drugCalls = () => calls.filter(c => c.table === 'drugs')

describe('① 위치별 약품 창 — 중지를 숨긴다', () => {
  it('★ 조회에 상태 조건이 붙는다 (중지 제외)', async () => {
    render(<LocDrugsModal loc="D-1" desc="" onClose={() => {}} />)
    await screen.findByText('가나다정')
    const c = drugCalls().find(x => x.eq.storage_location === 'D-1')
    expect(c, 'D-1 조회가 없다').toBeTruthy()
    expect(c.in, '상태 조건이 없다 — 중지가 그대로 보인다').toBeTruthy()
    expect(c.in.col).toBe('status')
    expect([...c.in.vals].sort()).toEqual(['사용', '휴면'])
  })

  it('★★ 중지 약품이 목록에 없다 (이 결함의 회귀 시험)', async () => {
    render(<LocDrugsModal loc="D-1" desc="" onClose={() => {}} />)
    await screen.findByText('가나다정')
    expect(screen.queryByText('시험_폴리콜정'), '중지 약품이 보인다').toBeNull()
    expect(screen.queryByText('라마바정'), '재고 0 인 중지도 보이면 안 된다').toBeNull()
    /* 사용·휴면은 그대로 보인다 */
    expect(screen.getByText('나다라정')).toBeTruthy()
    expect(screen.getByText('다라마주')).toBeTruthy()
  })

  it('★ 재고가 남아 있어도 숨긴다 — 기준은 상태뿐이다', async () => {
    render(<LocDrugsModal loc="D-1" desc="" onClose={() => {}} />)
    await screen.findByText('가나다정')
    /* 폴리콜정은 재고 215 인데도 안 보인다 */
    expect(screen.queryByText('215')).toBeNull()
  })

  it('★★ 머리글 건수 = 보이는 줄 수', async () => {
    const { container } = render(<LocDrugsModal loc="D-1" desc="" onClose={() => {}} />)
    await screen.findByText('가나다정')
    /* 머리글의 「N건」 */
    /* 검색줄에도 건수가 있어 **첫 번째**(머리글)를 쓴다 */
    const head = screen.getAllByText(/^\d+건$/)[0]
    const headN = Number(head.textContent.replace('건', ''))
    /* 본문 줄 수 — 약품명이 들어간 행만 센다 */
    const bodyRows = [...container.querySelectorAll('tbody tr')]
    expect(headN, '머리글 건수').toBe(3)
    expect(bodyRows.length, '보이는 줄 수가 머리글과 달라졌다').toBe(headN)
  })

  it('★ 위치 값을 지우지 않는다 — 숨기기만 한다(쓰기 0건)', async () => {
    render(<LocDrugsModal loc="D-1" desc="" onClose={() => {}} />)
    await screen.findByText('가나다정')
    expect(writes, '조회만 해야 하는데 쓰기가 나갔다').toHaveLength(0)
  })
})

describe('② 위치 목록 — 건수도 같은 기준', () => {
  it('★ 건수 조회에도 상태 조건이 붙는다', async () => {
    render(<LocationVocab />)
    await screen.findByText('임시보관(미지정)')
    const usage = drugCalls().filter(c => c.cols === 'storage_location')
    expect(usage.length, 'lvUsage 조회가 없다').toBeGreaterThan(0)
    for (const c of usage) {
      expect(c.in, 'lvUsage 에 상태 조건이 없다').toBeTruthy()
      expect([...c.in.vals].sort()).toEqual(['사용', '휴면'])
    }
  })

  it('★★ D-1 건수가 3이다 — 중지 2건을 뺀 수', async () => {
    const { container } = render(<LocationVocab />)
    await screen.findByText('D-1')
    await waitFor(() => {
      const tr = [...container.querySelectorAll('tbody tr')]
        .find(r => r.textContent.includes('D-1'))
      expect(tr, 'D-1 줄을 찾지 못했다').toBeTruthy()
      expect(tr.textContent).toMatch(/\b3\b/)
    })
  })
})

describe('③ 세 경로가 같은 상수를 쓴다', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
  it('★ MAIN_STATS 는 사용·휴면이다', () => {
    expect(APP).toContain("const MAIN_STATS = ['사용','휴면']")
  })
  it('★ 건수·목록·인쇄 세 곳이 모두 MAIN_STATS 를 쓴다', () => {
    expect((APP.match(/\.in\('status', MAIN_STATS\)/g) || []).length).toBe(3)
  })
  it('★ 보관위치 쪽에 상태 목록을 손으로 적은 곳이 없다', () => {
    const loc = APP.slice(APP.indexOf('async function lvUsage'), APP.indexOf('export default function App'))
    expect(loc.includes("['사용', '휴면']"), '상수 대신 리터럴을 적었다').toBe(false)
  })
})

describe('④ 임시보관함 — 시스템 위치', () => {
  const row = (container, label) => [...container.querySelectorAll('tbody tr')]
    .find(r => r.textContent.includes(label))

  it('★ 목록 맨 위에 온다', async () => {
    const { container } = render(<LocationVocab />)
    await screen.findByText('임시보관(미지정)')
    const first = container.querySelector('tbody tr')
    expect(first.textContent).toContain('임시보관(미지정)')
  })

  it('★ 「시스템」 표시가 붙는다', async () => {
    const { container } = render(<LocationVocab />)
    await screen.findByText('임시보관(미지정)')
    expect(row(container, '임시보관(미지정)').textContent).toContain('시스템')
    expect(row(container, 'D-1').textContent).not.toContain('시스템')
  })

  it('★★ 이름 변경·삭제·중지 버튼이 막혀 있다', async () => {
    const { container } = render(<LocationVocab />)
    await screen.findByText('임시보관(미지정)')
    const sys = row(container, '임시보관(미지정)')
    const btn = name => [...sys.querySelectorAll('button')].find(b => b.textContent.trim() === name)
    for (const name of ['이름 변경', '중지', '삭제']) {
      const b = btn(name)
      expect(b, name + ' 버튼을 찾지 못했다').toBeTruthy()
      expect(b.disabled, name + ' 버튼이 눌린다').toBe(true)
    }
    /* 일반 줄은 그대로 눌린다 */
    const normal = row(container, 'D-1')
    const nb = [...normal.querySelectorAll('button')].find(b => b.textContent.trim() === '삭제')
    expect(nb.disabled, '일반 위치까지 막히면 안 된다').toBe(false)
  })

  it('★ 순서 이동 버튼도 막혀 있다', async () => {
    const { container } = render(<LocationVocab />)
    await screen.findByText('임시보관(미지정)')
    const sys = row(container, '임시보관(미지정)')
    for (const b of [...sys.querySelectorAll('button')].filter(x => ['⤒', '↑', '↓', '⤓'].includes(x.textContent.trim()))) {
      expect(b.disabled, '순서 버튼이 눌린다').toBe(true)
    }
  })

  it('★ 눌러도 쓰기가 나가지 않는다 — 화면 밖 호출까지 막는다', async () => {
    const { container } = render(<LocationVocab />)
    await screen.findByText('임시보관(미지정)')
    const sys = row(container, '임시보관(미지정)')
    for (const b of sys.querySelectorAll('button')) fireEvent.click(b)
    const vocabWrites = writes.filter(w => w.table === 'location_vocab')
    expect(vocabWrites, '시스템 위치에 쓰기가 나갔다').toHaveLength(0)
  })

  it('★ 순서 재계산에서 시스템 위치가 빠진다 — 0번이 그대로 남는다', () => {
    /* 화면이 planReorder 에 넘기는 것은 is_system 을 뺀 배열이다 */
    const movable = VOCAB.filter(r => !r.is_system)
    const ups = planReorder(movable, 0, 2)          /* D-1 을 맨 아래로 */
    expect(ups.every(u => !u.is_system)).toBe(true)
    expect(ups.map(u => u.sort_order).sort()).toEqual([1, 2, 3])
    /* 시스템 행은 대상에 없으므로 sort_order 0 이 유지된다 */
    expect(ups.find(u => u.label === '임시보관(미지정)')).toBeUndefined()
  })
})

describe('④-b 임시보관함이 제안 목록·목적지에서도 맨 위다', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
  it('★ 약품 등록·수정의 제안 목록(datalist)이 시스템 위치를 먼저 둔다', () => {
    const dl = APP.slice(APP.indexOf('function LocVocabDatalist'), APP.indexOf('export function DrugEditModal'))
    expect(dl).toContain('is_system')
    expect(dl).toContain('live.filter(x => x.is_system)')
  })
  it('★ 이동 창 목적지도 시스템 위치를 먼저 둔다', () => {
    const md = APP.slice(APP.indexOf('const [destOpts'), APP.indexOf('const qq = q.trim()'))
    expect(md).toContain('live.filter(x => x.is_system)')
  })
  it('★ 자유 입력은 그대로다 — datalist 이지 select 가 아니다', () => {
    const dl = APP.slice(APP.indexOf('function LocVocabDatalist'), APP.indexOf('export function DrugEditModal'))
    expect(dl).toContain('<datalist')
    expect(dl.includes('<select'), '자유 입력을 막는 select 로 바뀌었다').toBe(false)
  })
})

describe('⑤ NULL(위치 미등록)은 건드리지 않았다', () => {
  const APP = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
  it('★ 위치 해제는 여전히 NULL 을 쓴다', () => {
    expect(APP).toContain("update({ storage_location: null })")
  })
  const MIG = readFileSync(resolve(process.cwd(), 'supabase/migrations/0103_location_vocab_system.sql'), 'utf8')

  it('★ 임시보관함은 NULL 이 아니라 이름이 있는 위치다', () => {
    expect(MIG).toContain("'임시보관(미지정)'")
    expect(MIG).toContain('is_system')
    /* 약품 데이터를 건드리는 구문이 들어 있지 않다 */
    expect(MIG.includes('update public.drugs'), '마이그레이션이 약품을 건드린다').toBe(false)
    expect(MIG.includes('storage_location'), '마이그레이션이 약품 위치를 건드린다').toBe(false)
  })

  it('★ 설명 문구가 확정본이다', () => {
    expect(MIG).toContain('보관 위치를 정하기 전 잠시 두는 약품')
  })

  it('★★ DB 트리거가 삭제·이름 변경·중지를 막는다 — 화면 가드만으로는 엑셀·직접 SQL 을 못 막는다', () => {
    expect(MIG).toContain('create trigger trg_guard_location_vocab_system')
    expect(MIG).toContain('before update or delete on public.location_vocab')
    for (const msg of ['시스템 위치는 삭제할 수 없습니다', '시스템 위치의 이름은 바꿀 수 없습니다', '시스템 위치는 중지할 수 없습니다']) {
      expect(MIG, '막는 문구가 없다: ' + msg).toContain(msg)
    }
  })

  it('★ 잠금을 푸는 길이 남아 있다 — is_system=false 는 통과시킨다', () => {
    expect(MIG).toContain('old.is_system and new.is_system')
    expect(MIG).toContain('set is_system = false')
  })
})
