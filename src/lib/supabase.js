import { createClient } from '@supabase/supabase-js'
import { makeGuardedFetch } from './session'
import { guardWrites } from './readOnly'

/* 환경변수에서 Supabase 설정 로드 (보안 분리)
   - 로컬: .env 파일 (반드시 .gitignore에 포함)
   - 배포: Netlify 환경변수
   - 키 노출 시 즉시 Supabase Dashboard에서 anon key 회전 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    '[Supabase] 환경변수가 설정되지 않았습니다. .env 파일에 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 설정하세요. (.env.example 참고)'
  )
}

/* ★ 쓰기 요청 바로 앞에서 로그인표를 되살린다 (lib/session.js).
   읽기·로그인 경로·비로그인 사용자는 건드리지 않는다. 자세한 이유는 그 파일 머리말에. */
const guardedFetch = makeGuardedFetch({ getAuth: () => supabase && supabase.auth })

/* ★ 읽기 전용(뷰어) 계정이면 쓰기 호출이 **나가기 전에** 멈춘다 (lib/readOnly.js).
   진짜 자물쇠는 DB 트리거(0123)다 — 여기는 헛수고를 줄이는 안내용이다.
   읽기는 전혀 건드리지 않는다. */
export const supabase = guardWrites(createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: guardedFetch },
}))
