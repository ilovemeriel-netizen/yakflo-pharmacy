/* @vitest-environment node */
/* 안내 띠 색 판정 — ★ 「실패를 초록으로 보여 주는 일」이 없는지 못 박는다. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { msgIsGood, msgIsBad } from './msgTone'

const rd = p => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('성공은 초록, 실패는 빨강', () => {
  for (const m of ['입고 완료! 가바로닌캡슐100mg 100개', '적용 완료 — 18종을 다시 셌습니다',
    '도매사 등록 완료', 'LOT 을 삭제했습니다', '공개 표시명 3건을 저장했습니다',
    '반영했습니다 · 조정 거래 4건', '순위 변경 완료']) {
    it('초록: ' + m, () => {
      expect(msgIsGood(m), m).toBe(true)
      expect(msgIsBad(m), m).toBe(false)
    })
  }
  for (const m of ['적용하지 못했습니다: JWT expired', '발주서 생성 실패: 권한이 없습니다',
    '삭제 실패: 참조가 남아 있습니다', '기존 스냅샷 조회 오류', '로그인이 풀렸습니다 — 화면을 새로고침한 뒤 다시 눌러 주세요.',
    '권한이 없거나 대상을 찾을 수 없습니다.', 'LOT 상태를 바꾸지 못했습니다: 네트워크']) {
    it('빨강: ' + m, () => {
      expect(msgIsBad(m), m).toBe(true)
      expect(msgIsGood(m), m).toBe(false)
    })
  }
})

describe('★ 「완료」가 들어 있어도 실패면 빨강 — 이게 이 파일의 핵심이다', () => {
  /* 실제로 있는 문구들이다. 옛 판정(`msg.includes('완료')`)은 이 셋을 **초록**으로 보여 줬다. */
  const CASES = [
    '가족 접종 완료 3명보다 적게 바꿀 수 없습니다',                        /* DB 거절 문구 */
    '입고 완료! 가바로닌캡슐100mg 100개 · 단, 마스터 단가 변경 실패(권한 없음)', /* 반만 성공 */
    '세션을 반영완료로 바꾸지 못했습니다: 로그인이 풀렸습니다',                  /* 상태 변경 실패 */
    '출고 이력 12건 전체 삭제 완료 · 단, 사용량 재집계 실패',
  ]
  for (const m of CASES) {
    it('빨강이어야 한다: ' + m.slice(0, 28) + '…', () => {
      expect(m.includes('완료'), '이 문구에는 「완료」가 들어 있다').toBe(true)
      expect(msgIsGood(m), '초록으로 보여 주면 안 된다').toBe(false)
      expect(msgIsBad(m)).toBe(true)
    })
  }
})

describe('둘 다 아니면 성공도 실패도 아니다 (파랑 알림 자리)', () => {
  for (const m of ['처리 중입니다', '12건을 읽었습니다', '']) {
    it('중립: ' + (m || '(빈 글)'), () => {
      expect(msgIsGood(m)).toBe(false)
      expect(msgIsBad(m)).toBe(false)
    })
  }
  it('null·undefined 에 안 터진다', () => {
    expect(msgIsGood(null)).toBe(false)
    expect(msgIsBad(undefined)).toBe(false)
    expect(msgIsGood({ text: '완료' })).toBe(false)
  })
})

describe('★ 띠 색을 글자 맞추기로 정하는 곳이 한 군데도 남지 않았다', () => {
  const FILES = ['src/App.jsx', 'src/SnapshotUploadModal.jsx', 'src/UsageUploadModal.jsx',
    'src/BulkUploadModal.jsx', 'src/VaccineManage.jsx', 'src/VaccineSurveyPanel.jsx',
    'src/VaccinePublicPanel.jsx', 'src/NarcoticUsageModal.jsx']
  for (const f of FILES) {
    it(f + ' — includes(\'완료\') 로 색을 정하지 않는다', () => {
      const src = rd(f)
      /* 색 토큰(t.green/t.red/greenL/redL)이 바로 뒤따르는 글자 맞추기만 잡는다 */
      const bad = [...src.matchAll(/includes\('(완료|성공)'\)\s*\?\s*t\.(green|red)/g)]
      expect(bad.map(m => m[0]), f + ' 에 글자 맞추기로 색을 정하는 곳이 있다').toEqual([])
    })
  }
  it('App.jsx 가 msgTone 을 쓴다', () => {
    const src = rd('src/App.jsx')
    expect(src).toContain("import { msgIsGood, msgIsBad } from './lib/msgTone'")
    /* 띠 7곳 — msgIsGood/msgIsBad 가 충분히 쓰였는지 */
    expect([...src.matchAll(/msgIsGood\(|msgIsBad\(/g)].length).toBeGreaterThanOrEqual(10)
  })
})

describe('★ 오류를 보지 않고 넘어가던 쓰기 다섯 곳 — 소스로 못 박는다', () => {
  const APP = rd('src/App.jsx')

  it('⑦ LOT 삭제 — 실패하면 알린다', () => {
    expect(APP).toMatch(/async function delLot\(id\) \{ const \{ error \} = await supabase\.from\('drug_lots'\)\.delete\(\)/)
    expect(APP).toContain("setMsg('LOT 을 지우지 못했습니다: ' + dbErrorMsg(error)); return")
  })
  it('⑧ LOT 사용/중지 — 실패하면 알린다', () => {
    expect(APP).toMatch(/async function toggleActive\(lot\) \{ const \{ error \} = await supabase\.from\('drug_lots'\)\.update/)
    expect(APP).toContain("setMsg('LOT 상태를 바꾸지 못했습니다: ' + dbErrorMsg(error)); return")
  })
  it('⑨ 출고 전체삭제 뒤 재집계 — 재집계가 실패하면 「완료」로 끝내지 않는다', () => {
    expect(APP).toContain("const _rc=await supabase.rpc('app_recompute_usage',{p_overwrite_manual:false})")
    expect(APP).toContain("'삭제는 됐지만 사용량 재집계에 실패했습니다: '+dbErrorMsg(_rc.error)")
  })
  it('⑩ 실사 항목 반영 표시 — 실패하면 멈춘다', () => {
    expect(APP).toContain("const _iu = await supabase.from('inventory_count_items')")
    expect(APP).toContain("cntFlash('반영 표시를 저장하지 못했습니다: ' + dbErrorMsg(_iu.error), 'err')")
  })
  it('⑪ 실사 세션 반영완료 — 실패하면 「반영했습니다」로 넘어가지 않는다', () => {
    expect(APP).toContain("const _su = await supabase.from('inventory_counts')")
    expect(APP).toContain("cntFlash('세션을 반영완료로 바꾸지 못했습니다: ' + dbErrorMsg(_su.error), 'err')")
  })
  it('★ 되돌아가지 않게 — 옛 「오류를 안 받는」 모양이 사라졌다', () => {
    for (const bad of [
      "async function delLot(id) { await supabase.from('drug_lots').delete()",
      "async function toggleActive(lot) { await supabase.from('drug_lots').update(",
      "{p_overwrite_manual:false});usageMsg=",
    ]) {
      expect(APP.includes(bad), '옛 모양이 남아 있다: ' + bad.slice(0, 40)).toBe(false)
    }
  })
  it('마약·향정 창도 dbErrorMsg 를 쓴다 — 영문 원문만 보여 주지 않는다', () => {
    const M = rd('src/NarcoticUsageModal.jsx')
    expect(M).toContain("import { dbErrorMsg } from './lib/dbError'")
    expect(M).toContain("setApplyErr('적용하지 못했습니다: ' + dbErrorMsg(error))")
  })
})
