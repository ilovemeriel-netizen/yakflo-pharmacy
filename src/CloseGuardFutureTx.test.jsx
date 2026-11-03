/* 마감 차단 — 마감월보다 뒤 날짜로 입력된 거래가 있으면 마감을 막는다 (2026-11-03 신설).

   ★ 왜 이 시험이 있나
     업무 규칙상 **월마감을 누르기 전에 넣는 데이터는 이전 달 몫**인데(매월 초에 전달 마감),
     입력 화면은 오늘 날짜를 기본으로 넣는다. 그대로 마감하면 그 거래가 다음 달로 새어 나간다.
     2026-10 에 실제로 15건이 그랬고, 화면에 거래 수정 기능이 없어 손으로 SQL 을 돌려 고쳤다.

   ★ 렌더 시험이 아니라 소스 검사다 — 이 화면은 supabase 조회·집계·인쇄를 한꺼번에 끌고 와
     jsdom 에서 띄우려면 앱 절반을 흉내내야 한다. 고정하려는 성질은 소스에서 확정할 수 있다:
       ① 마감 흐름에 차단이 끼어 있다  ② 「모두 바꾸기」는 owner·admin 에게만 보인다
       ③ 화면과 DB 가 **같은 기준**으로 거른다(이미 마감된 달은 제외)
       ④ 거래일 말고는 아무것도 바꾸지 않는다 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rd = p => readFileSync(resolve(process.cwd(), p), 'utf8')
const APP = rd('src/App.jsx')
const SQL = rd('supabase/migrations/0107_fix_tx_dates_to_month_end.sql')
/* 주석을 떼고 코드만 본다 — 설명 글자에 걸려 거짓 통과·거짓 실패가 나지 않게 */
const CODE = SQL.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n')

describe('① 마감 흐름에 차단이 끼어 있다', () => {
  it('거래 0건 검사 **뒤에** 뒤 날짜 검사가 온다', () => {
    const i = APP.indexOf("해당 월 거래가 없습니다")
    const j = APP.indexOf('const _fx=await _loadFutureTx()')
    expect(i, '거래 0건 검사를 찾지 못했다').toBeGreaterThan(0)
    expect(j, '뒤 날짜 검사를 찾지 못했다').toBeGreaterThan(i)
  })
  it('1건이라도 있으면 **마감하지 않고** 창만 띄운다', () => {
    const i = APP.indexOf('if(_fx.length>0)')
    const line = APP.slice(i, APP.indexOf('\n', i))
    expect(line).toContain('setDialog(_futureTxDialog(_fx))')
    expect(line, '차단이면 반드시 return 한다').toContain('return')
    expect(line, '여기서 마감을 이어가면 안 된다').not.toContain('runClose')
  })
  it('조회 실패는 조용히 넘어가지 않는다 — null 이면 멈춘다', () => {
    expect(APP).toContain('if(_fx===null)return')
    const i = APP.indexOf('async function _loadFutureTx()')
    const seg = APP.slice(i, i + 900)
    expect(seg, '오류를 사용자에게 알린다').toContain('setCloseMsg')
    expect(seg).toContain('return null')
  })
})

describe('② 「모두 바꾸기」는 owner·admin 에게만', () => {
  const seg = APP.slice(APP.indexOf('function _futureTxDialog('), APP.indexOf('async function _fixFutureTx('))
  it('관리자가 아니면 안내만 — 단추가 붙지 않는다', () => {
    expect(seg).toContain('if(!isTenantManager)return d')
    /* 안내만 주는 객체에는 onConfirm 이 없어야 한다(있으면 단추가 생긴다) */
    const i = seg.indexOf('const d={title:')
    const line = seg.slice(i, seg.indexOf('\n', i))
    expect(line, '안내 전용 객체에 onConfirm 이 있으면 안 된다').not.toContain('onConfirm')
  })
  it('누르면 바로 실행하지 않고 한 번 더 묻는다', () => {
    const i = seg.indexOf('confirmLabel:`모두 ')
    expect(i, '바꾸기 단추를 찾지 못했다').toBeGreaterThan(0)
    const tail = seg.slice(i)
    expect(tail, '첫 단추는 두 번째 창을 연다').toContain('onConfirm:()=>setDialog({')
    expect(tail, '두 번째 창에서야 실행한다').toContain("confirmLabel:'바꾸기',onConfirm:()=>_fixFutureTx()")
  })
  it('기존 창을 그대로 쓴다 — 새 모양·새 색을 만들지 않았다', () => {
    expect(seg, '새 모달 컴포넌트를 만들지 않았다').not.toMatch(/position:'fixed'|rgba\(/)
    expect(seg, '새 색 지정이 없다').not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})

describe('③ 화면과 DB 가 같은 기준으로 거른다', () => {
  it('화면 — 이미 마감된 달의 거래는 빼고 센다', () => {
    const i = APP.indexOf('async function _loadFutureTx()')
    const seg = APP.slice(i, i + 900)
    expect(seg, '스냅샷이 있는 달을 제외한다').toContain('closed.has(')
    expect(seg).toContain('snap_year')
  })
  it('DB — 같은 제외 조건이 RPC 에도 있다', () => {
    expect(CODE).toMatch(/not exists\s*\(/)
    expect(CODE).toContain('monthly_snapshots')
    expect(CODE, '대상 월 자체가 마감이면 거절한다').toContain('이미 마감되어')
  })
  it('DB — 권한은 0105c 와 같은 방식(owner·admin · session_user · auth.uid())', () => {
    expect(CODE).toContain("tm.role in ('owner', 'admin')")
    expect(CODE).toContain('session_user')
    expect(CODE).toContain('auth.uid()')
    expect(CODE, 'DEFINER 함정을 부르는 current_user 는 쓰지 않는다').not.toContain('current_user')
  })
  it('DB — 거절 문구에 진단값이 붙고 비밀값은 없다', () => {
    expect(CODE).toContain('[진단: uid=%, member_role=%, guc_role=%]')
    expect(CODE, 'uid 는 앞 8자리만').toContain('left(auth.uid()::text, 8)')
    expect(CODE).not.toMatch(/service_role_key|password|Bearer/i)
  })
})

describe('④ 거래일 말고는 아무것도 바꾸지 않는다', () => {
  it('UPDATE 가 손대는 칸은 transaction_date 와 memo 뿐이다', () => {
    const i = CODE.indexOf('update public.transactions')
    const seg = CODE.slice(i, CODE.indexOf('get diagnostics', i))
    const sets = [...seg.matchAll(/^\s*(?:set\s+)?(\w+)\s*=/gm)].map(m => m[1])
    expect(new Set(sets), '칸이 늘면 재고·금액이 흔들린다').toEqual(new Set(['transaction_date', 'memo']))
  })
  it('수량·금액 칸은 이름조차 나오지 않는다', () => {
    const i = CODE.indexOf('update public.transactions')
    const seg = CODE.slice(i, CODE.indexOf('get diagnostics', i))
    for (const col of ['quantity', 'unit_price', 'total_amount', 'drug_code', 'type']) {
      expect(seg, col + ' 을 건드리면 안 된다').not.toContain(col)
    }
  })
  it('memo 는 덮어쓰지 않고 뒤에 잇는다 — 기존 글자가 사라지면 안 된다', () => {
    expect(CODE).toContain("case when coalesce(u.memo, '') = '' then v_note else u.memo || ' / ' || v_note end")
  })
  it('실행 권한을 좁힌다 — anon 회수 · authenticated 유지', () => {
    expect(CODE).toContain('revoke execute on function public.app_fix_tx_dates_to_month_end(integer, integer) from anon')
    expect(CODE).toContain('grant  execute on function public.app_fix_tx_dates_to_month_end(integer, integer) to authenticated')
  })
})

describe('⑤ 마감 산식·인쇄는 건드리지 않았다', () => {
  it('runClose 의 기말은 여전히 current_qty 다 (업무 규칙상 의도된 동작)', () => {
    expect(APP).toContain('closing_qty:d.current_qty||0')
  })
  it('인쇄 마커 개수가 그대로다', () => {
    const MARKERS = { 'cnc-print-month': 7, 'atc-print-only': 14, 'cnc-report-table': 31,
      'ward-print': 23, 'loc-print': 36, 'alc-grid': 3 }
    for (const [m, want] of Object.entries(MARKERS)) {
      expect((APP.match(new RegExp(m, 'g')) || []).length, m).toBe(want)
    }
  })
})
