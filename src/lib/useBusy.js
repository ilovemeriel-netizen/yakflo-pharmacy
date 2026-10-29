/* 「입력 중」 등록을 화면에서 켜고 끄는 훅 — 새 배포 자동 적용을 미루기 위한 것.

   ★ 화면에 아무것도 그리지 않는다. 배치·색·문구가 바뀌지 않는다.
   ★ 조건이 거짓이 되면(저장 뒤 폼 초기화 · 취소 · 모달 닫힘) 자동으로 해제된다.
     화면이 사라질 때도 해제된다 — 정리 함수가 한다.
   ★ 판단 자체는 lib/pwaUpdate.js 에 있다(순수 함수 · 시험 있음). */
import { useEffect } from 'react'
import { markBusy } from './pwaUpdate.js'

export function useBusy(key, on) {
  const flag = !!on
  useEffect(() => {
    markBusy(key, flag)
    return () => markBusy(key, false)
  }, [key, flag])
}
