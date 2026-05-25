import { createClient } from '@supabase/supabase-js'

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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
