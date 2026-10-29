/* 입출고 저장 4경로의 「일부 미반영」 — **진짜 컴포넌트**(App.jsx)를 렌더해 확인한다.
   ★ supabase 는 통째로 가짜다. 운영 DB 에 닿지 않는다(운영에 입출고 기록을 만들지 않는다).
   ★ 재고 반영은 DB 트리거(trg_apply_tx_to_inventory)가 한다 — 클라이언트는 INSERT 만 한다.
     그래서 「재고 반영이 전후로 같다」는 **INSERT 호출 횟수·순서와 그 뒤 호출들**로 고정한다.
   ★ 확인하는 것(경로별)
     ① nullable 칸 1개가 PGRST204 로 빠짐 → 연보라 알림 + INSERT 2회(첫 요청 + 재시도 1회) 성공
     ② 빠짐 없음 → 기존 성공 표시 그대로 + INSERT 1회
     ③ NOT NULL 칸이 빠짐 → 오류 표시(**조용히 성공하지 않는다**) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PARTIAL_BG, PARTIAL_FG, partialText, partialBulkText } from './lib/saveWithFallback'
import { txColLabel } from './lib/txTypes'

/* PostgREST PGRST204 — 폴백을 발동시키는 유일한 문구 */
const pgrst = col => ({ message: `Could not find the '${col}' column of 'transactions' in the schema cache`, code: 'PGRST204' })
/* NOT NULL 위반 — 'column' 이라는 글자는 있지만 홑따옴표 모양이 아니라 폴백이 발동하지 않는다 */
const e23502 = col => ({ message: `null value in column "${col}" of relation "transactions" violates not-null constraint`, code: '23502' })

let txErrors = []     /* transactions 쓰기에 순서대로 돌려줄 오류 */
let calls = []        /* 호출 순서 기록: 'transactions.insert' · 'drugs.update' … */
let txPayloads = []

vi.mock('./lib/supabase', () => {
  const ok = d => Promise.resolve({ data: d, error: null })
  function from(table) {
    const q = {
      _tbl: table, _op: null, _p: null,
      select() { return q }, eq() { return q }, gte() { return q }, lt() { return q },
      order() { return q }, limit() { return q }, range() { return q },
      maybeSingle() { return ok(null) },
      insert(p) { q._op = 'insert'; q._p = p; return finish() },
      update(p) { q._op = 'update'; q._p = p; return q },
      delete() { q._op = 'delete'; return q },
      then(res) { return finish().then(res) },
    }
    function finish() {
      if (q._tbl === 'transactions' && q._op === 'insert') {
        calls.push('transactions.insert')
        txPayloads.push(Array.isArray(q._p) ? q._p[0] : q._p)
        return Promise.resolve({ data: null, error: txErrors.shift() || null })
      }
      if (q._tbl === 'drugs' && q._op === 'update') { calls.push('drugs.update'); return ok(null) }
      return ok([])
    }
    return q
  }
  return { supabase: { from, rpc: () => ok(null), auth: { getUser: () => ok({ user: { id: 'u1' } }) } } }
})

import { ThemeCtx } from './lib/theme'
import { AdjustModal, DisposalModal } from './App'

const T = {
  t: {
    bg: '#fff', card: '#fff', cardSolid: '#fff', border: '#e5e5e5', borderH: '#ccc',
    text: '#222', textM: '#666', textL: '#999', accent: '#BFA6D9',
    green: '#019748', greenL: '#E6F4EA', red: '#D9342B', redL: '#FDECEA',
    amber: '#E65100', amberL: '#FFF4E5', blue: '#2B7BB9', blueL: '#E8F2F9',
    purple: '#BFA6D9', shadow: 'none', shadowH: 'none',
  },
  profile: { role: 'admin' }, memberRole: 'owner',
}
const wrap = ui => render(<ThemeCtx.Provider value={T}>{ui}</ThemeCtx.Provider>)

/* 색 비교는 자기 보정 — jsdom 이 rgba 표기를 바꿔 쓴다 */
const css = (prop, v) => { const d = document.createElement('div'); d.style[prop] = v; return String(d.style[prop]).replace(/\s/g, '').toLowerCase() }
const bgOf = el => String(el.style.background).replace(/\s/g, '').toLowerCase()
const fgOf = el => String(el.style.color).replace(/\s/g, '').toLowerCase()
const noticeOf = cols => screen.queryByText(partialText(cols, txColLabel))

beforeEach(() => { txErrors = []; calls = []; txPayloads = []; vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/* ══════════════ ① 재고 보정 (AdjustModal · type='조정') ══════════════ */
describe('재고 보정 모달 — AdjustModal', () => {
  const DRUG = { id: 'd1', drug_code: 'A001', drug_name: '가바로닌캡슐100mg', current_qty: 10, purchase_price: 198 }

  async function save(errors) {
    txErrors = errors
    const onClose = vi.fn(), onSaved = vi.fn()
    wrap(<AdjustModal drug={DRUG} onClose={onClose} onSaved={onSaved} />)
    /* 실재고를 12 로 바꿔 차이 +2 를 만든다(차이 0 이면 저장 버튼이 비활성) */
    fireEvent.change(document.querySelector('input[type="number"]'), { target: { value: '12' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '보정 적용' })) })
    return { onClose, onSaved }
  }

  it('★ 금액이 빠지면 연보라 알림 + 닫지 않는다 · INSERT 2회', async () => {
    const { onClose, onSaved } = await save([pgrst('total_amount')])
    const el = noticeOf(['total_amount'])
    expect(el, '「일부 미반영」 문구가 없다').toBeTruthy()
    expect(el.textContent).toContain('금액')            /* 날컬럼 이름이 아니라 화면 이름 */
    expect(bgOf(el)).toBe(css('background', PARTIAL_BG))
    expect(fgOf(el)).toBe(css('color', PARTIAL_FG))
    expect(onClose, '모달이 자동으로 닫혔다').not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalled()
    expect(screen.queryByText('보정 완료')).toBeNull()
    /* 재고 반영 경로 고정: transactions INSERT 만, 첫 요청 + 재시도 1회 */
    expect(calls).toEqual(['transactions.insert', 'transactions.insert'])
    expect('total_amount' in txPayloads[1]).toBe(false)
    expect(txPayloads[1].quantity).toBe(2)             /* 수량은 그대로 */
  })

  it('빠짐 없으면 기존 「보정 완료」 그대로 · INSERT 1회', async () => {
    await save([])
    expect(screen.getByText('보정 완료')).toBeTruthy()
    expect(noticeOf([])).toBeNull()
    expect(calls).toEqual(['transactions.insert'])
  })

  it('★ NOT NULL 칸(수량)이 빠지면 오류 — 조용히 성공하지 않는다', async () => {
    /* PGRST204 가 quantity 를 가리켜 폴백이 버리고 재시도 → 23502 로 거절된다 */
    await save([pgrst('quantity'), e23502('quantity')])
    expect(noticeOf(['quantity']), '일부 미반영으로 넘어가면 안 된다').toBeNull()
    expect(screen.queryByText('보정 완료')).toBeNull()
    expect(screen.getByText(/not-null constraint/)).toBeTruthy()
    expect(calls).toEqual(['transactions.insert', 'transactions.insert'])
  })

  it('★ NOT NULL 위반 문구만으로는 폴백이 발동하지 않는다 — INSERT 1회', async () => {
    await save([e23502('quantity')])
    expect(calls, '재시도하면 안 된다').toEqual(['transactions.insert'])
    expect(screen.getByText(/not-null constraint/)).toBeTruthy()
  })
})

/* ══════════════ ② 폐기·반품 (DisposalModal) ══════════════ */
describe('폐기·반품 모달 — DisposalModal', () => {
  const DRUG = { id: 'd1', drug_code: 'A001', drug_name: '가바로닌캡슐100mg', current_qty: 50, purchase_price: 198, expiry_date: '2026-11-15' }

  async function save(errors) {
    txErrors = errors
    const onClose = vi.fn(), onSaved = vi.fn()
    wrap(<DisposalModal drug={DRUG} onClose={onClose} onSaved={onSaved} />)
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3' } })
    /* 사유 선택 — 첫 실제 사유를 고른다 */
    const sels = [...document.querySelectorAll('select')]
    const reasonSel = sels[1]
    const opt = [...reasonSel.querySelectorAll('option')].map(o => o.value).filter(Boolean)[0]
    fireEvent.change(reasonSel, { target: { value: opt } })
    /* 「폐기 처리」 → 확인 모달 「폐기 확정」 2단계다 */
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '폐기 처리' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '폐기 확정' })) })
    return { onClose, onSaved }
  }

  it('★ LOT 이 빠지면 연보라 알림 + 닫지 않는다 · INSERT 2회', async () => {
    const { onClose, onSaved } = await save([pgrst('lot_no')])
    const el = noticeOf(['lot_no'])
    expect(el, '「일부 미반영」 문구가 없다').toBeTruthy()
    expect(el.textContent).toContain('LOT')
    expect(bgOf(el)).toBe(css('background', PARTIAL_BG))
    expect(onClose, '모달이 자동으로 닫혔다').not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalled()
    expect(screen.queryByText('처리 완료')).toBeNull()
    expect(calls).toEqual(['transactions.insert', 'transactions.insert'])
  })

  it('빠짐 없으면 기존 「처리 완료」 그대로 · INSERT 1회', async () => {
    await save([])
    expect(screen.getByText('처리 완료')).toBeTruthy()
    expect(calls).toEqual(['transactions.insert'])
  })

  it('★ NOT NULL 칸이 빠지면 오류 — 조용히 성공하지 않는다', async () => {
    await save([pgrst('quantity'), e23502('quantity')])
    expect(noticeOf(['quantity'])).toBeNull()
    expect(screen.queryByText('처리 완료')).toBeNull()
    expect(calls).toEqual(['transactions.insert', 'transactions.insert'])
  })
})

/* ══════════════ ③④ 입출고 화면 (TransactionForm) ══════════════
   ★ 단건 저장(_doSave)과 엑셀 일괄은 TxForm 안에 인라인으로 있다.
     단건은 아래 소스 검사 + 도우미 합성으로 고정하고, 엑셀 일괄도 같은 방식으로 본다.
     (TxForm 을 렌더해 엑셀을 올리려면 실제 xlsx 파싱이 필요해 시험 범위를 넘는다.
      그래서 **렌더 시험이 아님을 밝혀 둔다** — 2단계의 IdleCheck 와 같은 취급.) */
describe('입출고 화면 — 단건 저장·엑셀 일괄의 배선', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  it('③ 단건 저장이 도우미를 거치고, 버린 칸이 있으면 자동 지움을 건너뛴다', () => {
    const i = SRC.indexOf('async function _doSave(pp,updateMaster){')
    expect(i).toBeGreaterThan(0)
    const body = SRC.slice(i, SRC.indexOf('\r\n  }', i))
    expect(body).toContain("saveWithFallback(tx,p=>supabase.from('transactions').insert([p]),{retries:3,label:'transactions insert'}")
    expect(body).toContain('if(res.dropped.length){setDropped(res.dropped);return}')
    /* 기존 연결은 한 줄도 바뀌지 않았다 — 마스터 단가 갱신·폼 초기화·재조회 */
    expect(body).toContain("supabase.from('drugs').update({purchase_price:pp})")
    expect(body).toContain('onReload?.();loadTxns()')
    expect(body).toContain('setTimeout(()=>setMsg(null),3000)')
  })

  it('③ 단건 배너가 연보라 분기를 쓴다 — 「완료」가 없는 문구는 빨강이 되므로 별도 상태다', () => {
    expect(SRC).toContain("{dropped.length>0&&<div style={{background:PARTIAL_BG,borderRadius:6,padding:'6px 10px',marginBottom:6,color:PARTIAL_FG,fontSize:11,fontWeight:600}}>{partialText(dropped,txColLabel)}</div>}")
    expect(SRC).toContain("{dropped.length===0&&msg&&<div style={{background:msg.includes('완료')?t.greenL:t.redL")
  })

  it('④ 엑셀 일괄이 행마다 집계하고, 기존 건수 줄은 그대로다', () => {
    const i = SRC.indexOf('let ok=0,fail=0; const okIdx=new Set(); const failMap=new Map()')
    expect(i).toBeGreaterThan(0)
    const body = SRC.slice(i, SRC.indexOf('setBulkData(prev=>', i))
    expect(body).toContain("saveWithFallback(tx,q=>supabase.from('transactions').insert([q]),{retries:3,label:'transactions insert'}")
    expect(body).toContain('if(res.dropped.length){partialCount++;')
    /* 성공·실패 건수 문구는 손대지 않았다 */
    expect(body).toContain('setBulkMsg(`완료! ${ok}건 등록${replaced?` · 기존 ${replaced}건 교체`:\'\'}${fail?` · ${fail}건 실패`:\'\'}`)')
    /* 일부 미반영이 있으면 자동 소멸시키지 않는다 */
    expect(SRC).toContain('if(!fail&&!partialCount) setTimeout(()=>setBulkMsg(null),4000)')
  })

  it('④ 일괄 요약 한 줄이 연보라이고 화면 이름을 쓴다', () => {
    expect(SRC).toContain('{bulkPartial&&<div style={{marginTop:6,background:PARTIAL_BG')
    expect(SRC).toContain('partialBulkText(bulkPartial.n,bulkPartial.cols,txColLabel)')
    /* 문구 합성이 화면 이름으로 나온다 */
    expect(partialBulkText(3, ['total_amount'], txColLabel)).toBe('3건은 일부 항목 미반영(금액 등)')
  })

  it('★ 재고 반영은 코드가 하지 않는다 — 트리거가 한다(주석으로 고정)', () => {
    /* current_qty 직접 UPDATE 가 저장 경로에 다시 생기면 이 시험이 걸린다 */
    expect(SRC).not.toContain("update({current_qty")
    expect(SRC).toContain('재고는 0009 트리거')
  })
})
