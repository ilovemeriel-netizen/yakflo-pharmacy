/* 중복 신청 정책 — 사번·동명이인·확인번호 대조.

   ★ 막으려는 것
     ⓐ 취소한 사람이 같은 사번으로 **다시 신청하지 못하는 것**(옛 제약)
     ⓑ 확인번호를 무차별로 찔러 남의 신청을 여는 것
     ⓒ 「그 이름이 있다/없다」가 응답으로 새는 것
     ⓓ 소속 목록이 세 곳(화면·함수·DB)에서 어긋나 저장이 조용히 막히는 것
     ⓔ 공개 앱 번들에 서버 전용 낱말이 섞여 나가는 것 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import {
  DEPTS, validDept, claimLockState, claimFailCount, claimFailNext, claimLeft,
  CLAIM_MAX_FAIL, CLAIM_IP_MAX_FAIL, CLAIM_LOCK_MIN, nameKey,
} from '../netlify/functions/_lib/survey.js'

const root = (...p) => resolve(process.cwd(), ...p)
const rd = p => readFileSync(root(p), 'utf8')
const FN = rd('vaccine-app/netlify/functions/vaccine-survey.js')
const UI = rd('vaccine-app/src/SurveyTab.jsx')
const M99 = rd('supabase/migrations/0099_vaccine_survey_dup_policy.sql')
const M100 = rd('supabase/migrations/0100_vaccine_survey_emp_uniq_applied.sql')
const M101 = rd('supabase/migrations/0101_vaccine_survey_dup_checked.sql')

describe('소속 — 세 곳이 같은 목록을 본다', () => {
  it('★ 17개·순서 고정', () => {
    expect(DEPTS).toEqual([
      '진료부', '간호부', '약제과', '재활치료센터', '임상병리실', '영상의학과',
      '사회사업실', '감염관리실', 'QPS실', '진료협력팀', '영양실', '심사팀',
      '원무과', '총무과', '전산', '홍보', '고객지원',
    ])
  })
  it('★ 화면 목록이 함수 목록과 같다 — 한쪽만 고치면 저장이 막힌다', () => {
    const ui = rd('vaccine-app/src/lib/depts.js')
    const got = [...ui.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(v => DEPTS.includes(v))
    expect(got).toEqual(DEPTS)
  })
  it('★ DB CHECK 가 같은 값을 허용한다', () => {
    const i = M99.indexOf('vaccine_survey_responses_dept_chk')
    const block = M99.slice(i, M99.indexOf(';', M99.indexOf('check (dept', i)))
    for (const d of DEPTS) expect(block.includes("'" + d + "'"), d + ' 가 CHECK 에 없다').toBe(true)
  })
  it('허용 밖 값은 거른다', () => {
    expect(validDept('약제과')).toBe(true)
    expect(validDept('없는부서')).toBe(false)
    expect(validDept('')).toBe(false)
    expect(validDept(null)).toBe(false)
  })
})

describe('사번 — 신청 중인 건만 막는다', () => {
  it('★ 함수가 status=applied 로 좁혀 본다', () => {
    const i = FN.indexOf("'사번 중복 조회 실패'")
    const near = FN.slice(Math.max(0, i - 600), i)
    expect(near).toContain(".eq('emp_no', emp)")
    expect(near, '취소분까지 중복으로 보면 재신청이 막힌다').toContain(".eq('status', 'applied')")
  })
  it('★ DB 부분 UNIQUE 도 같은 조건이다 — 한쪽만 고치면 어긋난다', () => {
    expect(M100).toContain("where emp_no is not null and status = 'applied'")
    expect(M100, '새 인덱스를 먼저 만들고 옛 것을 지운다').toMatch(
      /create unique index concurrently[\s\S]*drop index concurrently/)
  })
  it('23505 를 사번 중복으로 알린다', () => {
    expect(FN).toContain("/emp_applied_uniq|emp_uniq/.test(error.message)")
  })
})

describe('확인번호 대조(claim) — 잠금과 남은 횟수', () => {
  const NOW = 1_700_000_000_000
  it('기준값 — 이름 5회 · IP 20회 · 60분', () => {
    expect(CLAIM_MAX_FAIL).toBe(5)
    expect(CLAIM_IP_MAX_FAIL).toBe(20)
    expect(CLAIM_LOCK_MIN).toBe(60)
  })
  it('★ 처음에는 5회 남아 있다', () => {
    expect(claimLeft(null, NOW)).toBe(5)
  })
  it('★ 틀릴 때마다 남은 횟수가 줄고, 5회째에 잠긴다', () => {
    let row = null
    const seen = []
    for (let i = 0; i < 5; i++) {
      const r = claimFailNext(row, NOW + i * 1000)
      seen.push(r.left)
      row = { ...r.next }
      if (r.locked) {
        expect(i, '다섯 번째에 잠겨야 한다').toBe(4)
        expect(r.mins).toBe(60)
      }
    }
    expect(seen).toEqual([4, 3, 2, 1, 0])
  })
  it('★ 잠긴 동안에는 잠김으로 보인다', () => {
    const until = new Date(NOW + 30 * 60_000).toISOString()
    const st = claimLockState({ locked_until: until }, NOW)
    expect(st.locked).toBe(true)
    expect(st.mins).toBe(30)
  })
  it('잠금이 풀리면 다시 센다', () => {
    const until = new Date(NOW - 1000).toISOString()
    expect(claimLockState({ locked_until: until }, NOW).locked).toBe(false)
  })
  it('★ 창이 지나면 실패 횟수가 0 부터다', () => {
    const old = { window_start: new Date(NOW - 61 * 60_000).toISOString(), fail_count: 4 }
    expect(claimFailCount(old, NOW)).toBe(0)
    expect(claimLeft(old, NOW)).toBe(5)
  })
  it('창 안이면 이어서 센다', () => {
    const cur = { window_start: new Date(NOW - 10 * 60_000).toISOString(), fail_count: 3 }
    expect(claimFailCount(cur, NOW)).toBe(3)
    expect(claimLeft(cur, NOW)).toBe(2)
  })
  it('IP 축은 20회까지 센다', () => {
    const cur = { window_start: new Date(NOW).toISOString(), fail_count: 19 }
    expect(claimFailNext(cur, NOW, CLAIM_IP_MAX_FAIL).locked).toBe(true)
  })
})

describe('존재 여부를 흘리지 않는다', () => {
  it('★ 「없음」과 「틀림」이 같은 문구다', () => {
    const i = FN.indexOf('const CLAIM_BAD_MSG')
    const line = FN.slice(i, FN.indexOf('\n', FN.indexOf('left > 0', i)))
    expect(line).toContain('확인번호가 일치하지 않습니다.')
    expect(line, '「그런 이름 없음」 같은 말을 쓰지 않는다').not.toMatch(/신청 내역이 없|찾을 수 없|등록되지/)
  })
  it('★ 후보가 없어도 해시 비용을 치른다 — 응답 시간으로 새지 않게', () => {
    const i = FN.indexOf("action === 'claim'")
    const body = FN.slice(i, FN.indexOf('lookup · update · cancel', i))
    expect(body).toContain('await hashPin(pin, makeSalt())')
  })
  it('★ 다른 사람의 성명·사번을 돌려주지 않는다', () => {
    const i = FN.indexOf("action === 'claim'")
    const body = FN.slice(i, FN.indexOf('lookup · update · cancel', i))
    expect(body).toContain("json({ ok: true, receipt_code: hit.receipt_code }")
    expect(body, 'name 을 응답에 싣지 않는다').not.toMatch(/name:\s*hit\./)
  })
  it('잠금 안내에 문의처가 있다', () => {
    expect(FN).toContain('문의: 약제과(내선 217)')
  })
  it('★ 잠금 안내가 「다른 사람을 고르라」고 시키지 않는다(사용자 확정 2026-10-30)', () => {
    const i = FN.indexOf('const CLAIM_LOCK_MSG')
    const block = FN.slice(i, FN.indexOf('const DEPT_MSG', i))
    expect(block).toContain('제한 시간이 지난 후 다시 시도해 주시기 바랍니다.')
    expect(block).not.toMatch(/저는 다른 사람|소속을 적어/)
  })
})

describe('화면 — 승인 범위', () => {
  it('★ 본문 토큰이 AA 를 넘는다(0.62 → 0.78)', () => {
    const css = rd('vaccine-app/src/index.css')
    expect(css).toContain('--v-ink-dim: rgba(46, 74, 98, 0.78)')
    expect(css).not.toContain('rgba(46, 74, 98, 0.62)')
  })
  it('★ 빨강·노랑을 쓰지 않는다 — 승인된 색만', () => {
    /* 승인 팔레트 + 흰색. 그 밖의 리터럴이 들어오면 걸린다. */
    const OK = ['#804A87', '#019748', '#BFA6D9', '#2E4A62', '#FFFFFF']
    const hex = [...new Set((UI.match(/#[0-9A-Fa-f]{6}/g) || []).map(h => h.toUpperCase()))]
    for (const h of hex) expect(OK, '허용 밖 색: ' + h).toContain(h)
  })
  it('★ 소속은 「저는 다른 사람이에요」를 골랐을 때만 필수다', () => {
    expect(UI).toContain("dupPick === 'other'")
    expect(UI).toContain('dept: confirmDup ? dept : null')
  })
  it('★ 되돌릴 수 없는 새 경로를 만들지 않았다 — claim 뒤 기존 lookup 을 탄다', () => {
    expect(UI).toContain("action: 'claim'")
    expect(UI).toContain("action: 'lookup', key: j.receipt_code")
  })
})

describe('관리자 — 확인 완료', () => {
  it('★ 열 GRANT 를 넓히지 않고 함수로 처리한다', () => {
    expect(M101).toContain('security definer')
    expect(M101).toContain('grant execute on function public.mark_vaccine_survey_dup_checked')
    expect(M101, '열 권한을 넓히면 안 된다').not.toMatch(/^\s*grant\s+update/im)
  })
  it('★ 바뀐 값이 기록에 담긴다', () => {
    expect(M101).toContain("jsonb_build_object('dup_checked'")
    expect(M101).toContain('insert into public.vaccine_survey_audit')
  })
  it('★ 동명이인으로 선언된 건에만 쓸 수 있다', () => {
    expect(M101).toContain('동명이인으로 표시된 신청이 아닙니다')
  })
  it('같은 값이면 기록하지 않는다', () => {
    expect(M101).toContain('같은 값이면 기록하지 않는다')
  })
})

describe('엑셀·PDF — 소속 열', () => {
  it('★ 성명 다음에 소속이 들어간다', () => {
    const ex = rd('src/lib/surveyExport.js')
    const i = ex.indexOf('const HEAD = [')
    const head = ex.slice(i, ex.indexOf(']', i) + 1)
    expect(head).toContain("'신청번호', '사번', '성명', '소속'")
  })
  it('엑셀 폭도 열 수에 맞게 늘었다(11칸)', () => {
    const ex = rd('src/lib/surveyExport.js')
    const i = ex.indexOf("ws['!cols'] = [") + "ws['!cols'] = [".length
    const block = ex.slice(i, ex.indexOf(']', i))
    expect((block.match(/wch:/g) || []).length).toBe(11)
  })
  it('PDF 의 비고·확인 열 번호가 하나씩 밀렸다', () => {
    const ex = rd('src/lib/surveyExport.js')
    expect(ex).toContain('columnStyles: { 10: { cellWidth: 22 }, 11: { cellWidth: 12, halign: \'center\' } }')
  })
})

describe('★ 공개 앱 번들에 금지 문자열이 없다', () => {
  it('빌드 결과 전체를 검사한다', () => {
    const dist = root('vaccine-app/dist')
    if (!existsSync(dist)) {
      execSync('npm run build', { cwd: root('vaccine-app'), stdio: 'ignore' })
    }
    const files = []
    const walk = d => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = resolve(d, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.(js|css|html|json|map)$/i.test(e.name)) files.push(full)
      }
    }
    walk(dist)
    expect(files.length, '검사할 파일이 없다 — 빌드를 확인할 것').toBeGreaterThan(2)
    const bad = []
    for (const f of files) {
      const t = readFileSync(f, 'utf8')
      for (const w of ['supabase', 'eyJ', 'createClient', 'scrypt', 'yakflo', 'service_role']) {
        if (t.includes(w)) bad.push(f.split(/[\\/]/).pop() + ':' + w)
      }
    }
    expect(bad, '공개 번들에 서버 전용 낱말이 섞였다').toEqual([])
  })
})

describe('이름 비교 — 공백 제거', () => {
  it('공백·대소문자를 무시한다', () => {
    expect(nameKey(' 홍 길 동 ')).toBe('홍길동')
    expect(nameKey('Hong Gildong')).toBe('honggildong')
  })
})

describe('문구 원문 고정 — 사용자 확정본(2026-10-30)', () => {
  /* ★ 문구는 사용자가 정한 것이다. 바뀌면 바로 걸리게 **원문 그대로** 박아 둔다. */
  const PUB = [
    ['01 제목', '동일한 이름의 신청 내역이 있습니다.'],
    ['01 본문', '동일한 이름으로 접수된 신청 내역이 있습니다. 본인의 신청 여부를 확인해 주시기 바랍니다.'],
    ['01 선택지1', '본인이 신청한 내역입니다.'],
    ['01 선택지1 설명', '확인번호 4자리를 입력하면 신청 내역을 조회·수정할 수 있습니다.'],
    ['01 선택지2', '본인의 신청 내역이 아닙니다.'],
    ['01 선택지2 설명', '소속을 선택하면 신규 신청을 진행할 수 있습니다.'],
    ['01 소속 라벨', '(필수)'],
    ['01 소속 빈 선택', '소속을 선택해 주시기 바랍니다.'],
    ['02 선택지1 설명(오류 뒤)', '신청 내역을 확인하려면 확인번호 4자리를 입력해 주시기 바랍니다.'],
    ['02 오류', '확인번호가 일치하지 않습니다. 확인번호를 확인한 후 다시 입력해 주시기 바랍니다. 남은 시도 횟수:'],
    ['03 제목', '확인번호 입력이 일시적으로 제한되었습니다.'],
    ['04 제목', '해당 사번으로 접수된 신청 내역이 있습니다.'],
    ['04 본문', '동일한 사번으로 중복 신청할 수 없습니다.'],
    ['04 본문2', '신청번호를 모르는 경우 사번과 확인번호로 기존 신청 내역을 조회할 수 있습니다.'],
    ['04 버튼', '기존 신청 조회·수정'],
    ['공통 버튼', '처음 화면으로'],
  ]
  for (const [what, text] of PUB) {
    it('공개 ' + what, () => { expect(UI.includes(text), text).toBe(true) })
  }

  const SRV = [
    ['03 본문 앞', '확인번호 입력 오류가 반복되어 약 '],
    ['03 본문 뒤', '제한 시간이 지난 후 다시 시도해 주시기 바랍니다. 문의: 약제과(내선 217)'],
    ['소속 안내', '소속을 선택해 주시기 바랍니다.'],
    ['사번 중복', '동일한 사번으로 중복 신청할 수 없습니다.'],
    ['조회 실패', '신청번호 또는 확인번호가 일치하지 않습니다.'],
  ]
  for (const [what, text] of SRV) {
    it('서버 ' + what, () => { expect(FN.includes(text), text).toBe(true) })
  }

  it('★ 옛 말투가 남아 있지 않다', () => {
    for (const old of ['같은 이름으로 접수된 신청이 있어요', '제가 신청한 게 맞아요',
      '저는 다른 사람이에요', '이 사번으로 접수된 신청이 있어요', '신청 내용 고치기',
      '확인번호가 맞지 않습니다']) {
      expect(UI.includes(old), '옛 문구가 남아 있다: ' + old).toBe(false)
      expect(FN.includes(old), '옛 문구가 남아 있다(서버): ' + old).toBe(false)
    }
  })

  it('★ 「처음으로」 를 쓰지 않는다 — 「처음 화면으로」 로 통일', () => {
    expect(UI).not.toMatch(/처음으로</)
  })
})

describe('관리 화면 문구', () => {
  const PANEL = rd('src/VaccineSurveyPanel.jsx')
  const CALC = rd('src/lib/surveyCalc.js')
  it('★ 화면 제목', () => { expect(PANEL).toContain('독감 예방접종 신청 현황') })
  it('★ 칩 4개', () => {
    for (const c of ['전체 신청', '사번 미입력', '동일 성명 확인 대상', '동명이인 여부 확인 필요']) {
      expect(PANEL.includes('label="' + c + '"'), c).toBe(true)
    }
  })
  it('★ 열 머리글 — 긴 것은 두 줄로 접는다', () => {
    for (const h of ['본인 접종', '접종 희망일', '신청 상태', '확인 사항']) {
      expect(PANEL.includes("h: '" + h + "'"), h).toBe(true)
    }
    /* 두 줄짜리 — 접은 자리까지 고정한다 */
    expect(PANEL).toContain("h: '가족 접종', h2: '인원'")
    expect(PANEL).toContain("h: '신청 수량', h2: '(도즈)'")
    expect(PANEL, '공용 ColMenu 의 nowrap 때문에 <br/> 로 끊는다').toContain('{c.h2 ? <>{c.h}<br />{c.h2}</> : c.h}')
  })
  it('★ 표 폭이 화면(#root 1126px) 안에 들어간다', () => {
    const sum = [...PANEL.matchAll(/\{ k: '[a-z_]+', h: '[^']+'(?:, h2: '[^']+')?, w: (\d+)/g)]
      .reduce((a, m) => a + Number(m[1]), 0)
    expect(sum, '열 폭 합계가 화면보다 넓다').toBeLessThanOrEqual(1126)
    expect(sum, '열이 빠졌다').toBeGreaterThan(900)
  })
  it('★ 01 진행 버튼은 「확인」 하나다 — 선택지 문장을 버튼에 넣지 않는다', () => {
    expect(UI).toContain("{busy ? '처리 중...' : dupLocked ? '본인의 신청 내역이 아닙니다.' : '확인'}")
  })
  it('★ 확인 사항 표기 — 확인 전에는 「동명이인」으로 단정하지 않는다', () => {
    expect(CALC).toContain("out.push('사번 미입력')")
    expect(CALC).toContain("out.push('동일 성명 확인 필요')")
    expect(CALC, '확인 전에 단정하면 안 된다').not.toContain("out.push('동명이인')")
  })
  it('★ 엑셀·PDF 머리글도 같은 이름이다', () => {
    const ex = rd('src/lib/surveyExport.js')
    for (const h of ['본인 접종', '가족 접종 인원', '신청 수량(도즈)', '접종 희망일', '신청 상태', '확인 사항']) {
      expect(ex.includes("'" + h + "'"), h).toBe(true)
    }
  })
})

describe('우회 점검 — 입력 제한 중 접수', () => {
  const PANEL = rd('src/VaccineSurveyPanel.jsx')
  const M102 = rd('supabase/migrations/0102_vaccine_survey_locked_bypass.sql')
  it('★ 칸은 기본 거짓이라 기존 행이 안 바뀐다', () => {
    expect(M102).toContain('add column if not exists locked_bypass boolean not null default false')
    expect(M102).toContain("notify pgrst, 'reload schema'")
  })
  it('★ 접수를 막지 않고 표시만 남긴다', () => {
    const i = FN.indexOf('locked_bypass')
    expect(i).toBeGreaterThan(-1)
    const near = FN.slice(Math.max(0, FN.indexOf('bypass = (lockRows') - 500), FN.indexOf('bypass = (lockRows') + 80)
    expect(near, '잠금이면 돌려보내면 안 된다').not.toMatch(/return json\(\{ ok: false[^}]*LOCK/)
    expect(FN).toContain('locked_bypass: bypass,')
  })
  it('★ 관리 화면 확인 사항에 뜬다', () => {
    expect(PANEL).toContain('입력 제한 중 접수')
    expect(PANEL).toContain('locked_bypass')
  })
  it('★ 동일 성명 확인 대상에 저절로 들어간다 — 같은 이름·사번 없음·신청 중', () => {
    /* name_dup_cnt 는 applied + emp_no is null 중 같은 name_key 가 2건 이상인 묶음을 센다.
       우회 접수 건은 같은 이름으로 들어오므로 그 묶음에 자동으로 포함된다. */
    const m93 = rd('supabase/migrations/0093_vaccine_survey.sql')
    const i = m93.indexOf('name_dup_cnt')
    const block = m93.slice(i, i + 400)
    expect(block).toContain("status = 'applied' and emp_no is null")
  })
})

describe('집계 기준 — 칩과 표가 어긋나지 않게', () => {
  const PANEL = rd('src/VaccineSurveyPanel.jsx')
  it('★ dupNeed 도 뷰와 같은 기준(applied) 으로 센다', () => {
    expect(PANEL).toContain("rows.filter(r => r.status === 'applied' && r.dup_declared && !r.dup_checked_at)")
  })
  it('★ 전체 신청도 같은 기준이다', () => {
    expect(PANEL).toContain("const appliedCnt = rows.filter(r => r.status === 'applied').length")
  })
})
