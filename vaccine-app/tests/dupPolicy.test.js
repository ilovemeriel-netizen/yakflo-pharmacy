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
    expect(line).toContain('확인번호가 맞지 않습니다')
    expect(line, '「그런 이름 없음」 같은 말을 쓰지 않는다').not.toMatch(/없습니다|없어요|찾을 수 없/)
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
  it('잠금 안내에 내선 217 이 있다', () => {
    expect(FN).toContain('문의 약제과 내선 217')
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
