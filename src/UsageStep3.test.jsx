/* 3단계 — 마감 뒤 사용량을 **마감월 기준**으로 저절로 다시 센다 (2026-11-14 이정화 님 승인)
 *
 * 왜
 *   자동집계는 **오늘 기준 롤링 3개월**을 봤다. 재고현황 「N개월 사용량 0」 판정은
 *   **마감된 달 3개**를 본다. 두 잣대가 달라 11월 출고를 넣으면 갈라진다.
 *
 * 무엇을
 *   · `0134` — 자동집계에 **「일반만 · 마감월 기준」** 갈래(`p_scope='normal'`)
 *     창 셈법은 **마약 갈래와 같다**(그 코드를 본떴다 — 새 잣대를 만들지 않는다).
 *     범위만 다르다: 마약·향정·한외마약·백신(ATC J07)·수기를 뺀다.
 *   · 월마감이 **끝난 뒤** 그 갈래를 부른다. 실패해도 **마감은 되돌리지 않는다.**
 *   · 바뀐 약을 기존 띠·창 모양으로 알린다. 새 색 없음.
 *
 * ★ 이 PR 의 JSX 가 깨지지 않았는지는 ViewerNoCodeLeak.test.jsx 가
 *   보고서 화면을 **실제로 그려서** 잡는다(2026-11-14 월마감 고장의 교훈).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = p => resolve(process.cwd(), p)
const APP = readFileSync(root('src/App.jsx'), 'utf8')
const S34 = readFileSync(root('supabase/migrations/0134_recompute_normal_closed.sql'), 'utf8')

/* ══ ① 0134 — 갈래와 창 ═══════════════════════════════════════════════ */
describe('★★ ① 0134 — 「일반만 · 마감월 기준」 갈래', () => {
  it('★ 갈래 이름을 받아들인다', () => {
    expect(S34).toContain(`if p_scope is null or p_scope not in ('all', 'narcotic', 'normal') then`)
    expect(S34).toContain(`if p_scope = 'normal' then`)
  })

  it('★★ 창은 **마감 연·월** 기준이다 — 오늘(current_date)이 아니다', () => {
    const i = S34.indexOf(`if p_scope = 'normal' then`)
    const j = S34.indexOf(`if p_scope = 'narcotic' then`)
    expect(i, 'normal 갈래를 찾지 못했다').toBeGreaterThan(0)
    expect(j, 'narcotic 갈래보다 앞에 와야 한다').toBeGreaterThan(i)
    const body = S34.slice(i, j)
    expect(body).toContain('v_m1_from := make_date(p_year, p_month, 1)')
    expect(body).toContain(`v_m3_from := (v_m1_from - interval '2 months')::date`)
    expect(body).toContain(`v_to      := (v_m1_from + interval '1 month')::date`)
    expect(body.includes('current_date'), 'normal 갈래에 롤링(current_date)이 섞이면 안 된다').toBe(false)
  })

  it('★ 연·월을 안 주면 멈춘다', () => {
    expect(S34).toContain('마감월(연·월)을 함께 주십시오')
  })

  it('★★ 범위 — 마약·향정·**한외마약**·백신·수기를 뺀다', () => {
    const i = S34.indexOf(`if p_scope = 'normal' then`)
    const body = S34.slice(i, S34.indexOf(`if p_scope = 'narcotic' then`))
    for (const w of [
      `d.narcotic_type is distinct from '마약'`,
      `d.narcotic_type is distinct from '향정'`,
      `d.narcotic_type is distinct from '한외마약'`,
      `coalesce(d.atc_code, '') not like 'J07%'`,
      `(p_overwrite_manual or d.usage_source is distinct from 'manual')`,
    ]) expect(body, w).toContain(w)
  })

  it('★★ 월평균 규칙이 (A)·0131 과 **같다**', () => {
    const i = S34.indexOf(`if p_scope = 'normal' then`)
    const body = S34.slice(i, S34.indexOf(`if p_scope = 'narcotic' then`))
    /* 창에 기록이 있는데 출고 0 → 0 · 출고 있는데 반올림 0 → 빈 값(그대로 둔다) */
    expect(body).toContain(`when coalesce(tx.m3, 0) = 0 then 0`)
    expect(body).toContain(`else nullif(round(coalesce(tx.m3, 0) / 3.0), 0) end`)
    expect(body).toContain(`monthly_avg  = coalesce(c.mavg, d.monthly_avg)`)
  })

  it('★★ 두 번 돌아도 안전하다 — 바뀌는 것이 없으면 건드리지 않는다', () => {
    const i = S34.indexOf(`if p_scope = 'normal' then`)
    const body = S34.slice(i, S34.indexOf(`if p_scope = 'narcotic' then`))
    expect(body).toContain(`and (d.recent_1m_usage is distinct from c.m1`)
    expect(body).toContain(`or d.usage_source   is distinct from 'auto')`)
  })

  it('★ 옛 갈래(all·narcotic)는 한 글자도 안 바꿨다', () => {
    expect(S34).toContain(`where d.narcotic_type in ('마약', '향정')`)   /* narcotic 범위 그대로 */
    expect(S34).toContain(`transaction_date >= current_date - interval '3 months'`)  /* all 의 롤링 그대로 */
    expect(S34).toContain('CREATE OR REPLACE FUNCTION public.app_recompute_usage(')
  })
})

/* ══ ② 마감 배선 ═══════════════════════════════════════════════════ */
describe('★★ ② 마감이 끝난 **뒤에** 부른다', () => {
  it('★★ 마감 완료 글을 띄운 **다음** 줄에서 부른다', () => {
    const i = APP.indexOf('setCloseMsg(`✅ ${label} 마감 완료! (${rows.length}건)`);loadS()')
    expect(i, '마감 완료 줄을 찾지 못했다').toBeGreaterThan(0)
    const j = APP.indexOf('await recalcAfterClose(year,month,label)', i)
    expect(j, '마감 뒤 다시 세기를 찾지 못했다').toBeGreaterThan(i)
    /* 사이에 다른 저장이 끼지 않았다 */
    expect(APP.slice(i, j).includes('insert('), '마감과 다시 세기 사이에 새 저장이 끼면 안 된다').toBe(false)
  })

  it('★★ 다시 세기가 실패해도 **마감은 되돌리지 않는다**', () => {
    const i = APP.indexOf('async function recalcAfterClose(')
    expect(i).toBeGreaterThan(0)
    const fn = APP.slice(i, i + 2600)
    expect(fn).toContain('catch(e){')
    expect(fn).toContain('마감은 끝났습니다')
    /* ★ try 안의 throw 는 **이 함수의 catch** 가 받는다. 막아야 할 것은 **catch 안에서 다시 던지는 것**이다. */
    const k = fn.indexOf('catch(e){')
    const tail = fn.slice(k, k + 420)
    expect(tail.includes('throw'), '다시 던지면 마감 catch 로 흘러가 「오류」로 보인다').toBe(false)
  })

  it('★★ 마감한 **그 달**을 연·월로 준다', () => {
    expect(APP).toContain(`{p_overwrite_manual:false,p_scope:'normal',p_year:y,p_month:m}`)
    expect(APP).toContain('await recalcAfterClose(year,month,label)')
  })

  it('★ 전 값을 **부르기 전에** 찍어 둔다 — 뒤에 읽으면 이미 바뀐 값이다', () => {
    const i = APP.indexOf('async function recalcAfterClose(')
    const fn = APP.slice(i, i + 2600)
    const a = fn.indexOf('const before={}')
    const b = fn.indexOf(`supabase.rpc('app_recompute_usage'`)
    expect(a, '전 값 찍는 줄을 찾지 못했다').toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })

  it('★★ 다시 읽을 때 1,000줄에서 잘리지 않는다 — 쪽 나눠 읽기', () => {
    const i = APP.indexOf('async function recalcAfterClose(')
    const fn = APP.slice(i, i + 2600)
    expect(fn).toContain(".order('drug_code').range(_f,_f+_P-1)")
    expect(fn).toContain('if(!data||data.length<_P)break')
  })

  it('★ 마감은 owner 만 할 수 있으므로 다시 세기도 owner 만 닿는다', () => {
    const i = APP.indexOf('async function runClose(')
    expect(APP.slice(i, i + 80)).toContain('if(!isOwner)return')
  })
})

/* ══ ③ 알림 띠·목록 ════════════════════════════════════════════════ */
describe('★★ ③ 바뀐 내역 알림', () => {
  it('★★ 띠 글자가 「N종이 바뀌었습니다」로 바뀐다', () => {
    expect(APP).toContain('사용량을 이 마감 기준으로 다시 셌습니다 — ')
    expect(APP).toContain('마약·향정·한외마약·백신과 수기로 지킨 약은 그대로입니다')
  })

  it('★ 다시 세기 전·실패 때는 **옛 글자** 그대로다', () => {
    expect(APP).toContain('사용량 비교표를 볼 수 있습니다.')
  })

  it('★★ 「바뀐 약 N종 보기」 단추가 있다 — 바뀐 것이 없으면 안 나온다', () => {
    expect(APP).toContain('바뀐 약 {reCalc.n.toLocaleString()}종 보기')
    expect(APP).toContain('{reCalc&&!reCalc.err&&reCalc.n>0&&<button')
  })

  it('★★ 목록에 **전 → 후** 두 칸이 있다 — 월평균·안전재고', () => {
    const i = APP.indexOf('마감 뒤 사용량이 바뀐 약 —')
    expect(i, '목록 창을 찾지 못했다').toBeGreaterThan(0)
    const win = APP.slice(i, i + 2200)
    expect(win).toContain(`{['약품','월평균','안전재고']`)
    expect(win).toContain('{Number(r.om||0).toLocaleString()}')
    expect(win).toContain('{Number(r.nm||0).toLocaleString()}')
    expect(win).toContain('{Number(r.osf||0).toLocaleString()}')
    expect(win).toContain('{Number(r.nsf||0).toLocaleString()}')
  })

  it('★ 인쇄에서 빠진다 — 띠도 창도 no-print', () => {
    const i = APP.indexOf('{reOpen&&reCalc&&!reCalc.err&&<div')
    expect(i).toBeGreaterThan(0)
    expect(APP.slice(i, i + 60)).toContain('className="no-print"')
  })

  it('★ 새 색이 없다 — 바뀐 곳에 hex 색이 없다', () => {
    const bad = []
    for (const line of APP.split(/\r?\n/)) {
      if (/reCalc|reOpen|recalcAfterClose/.test(line) && /#[0-9a-fA-F]{3,8}\b/.test(line)) {
        /* '#fff' 는 기존 단추가 쓰던 글자색 — 그 줄만 허용한다 */
        /* '#fff' 는 기존 단추가 쓰던 글자색이다 — 새 색이 아니다 */
        if (line.replace(/'#fff'/g, '').match(/#[0-9a-fA-F]{3,8}\b/)) bad.push(line.trim().slice(0, 90))
      }
    }
    expect(bad, '새 색을 쓰지 말 것\n' + bad.join('\n')).toEqual([])
  })
})
