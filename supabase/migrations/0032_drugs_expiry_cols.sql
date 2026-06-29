-- 0032: 유효기한 화면 권장조치·비고 저장용 컬럼 신설 (drugs)
-- 배경: ExpiryAlert에서 recommended_action / expiry_notes 저장 시, 해당 컬럼이 drugs에 없어
--       saveRow/saveNote의 'column 오류 시 필드 삭제 후 재시도' 로직이 그 필드를 조용히 제거 →
--       DB 미반영 → 리렌더 시 '클릭'(미선택)으로 원복되던 문제 해결.
-- 성격: 가산·멱등(IF NOT EXISTS). RLS·tenant_id 등 기존 구조 무변경(컬럼 추가만).
-- 적용: Supabase SQL Editor(운영 phgkjrvdtcdrdiuigici)에 붙여넣어 실행.
-- 롤백: alter table public.drugs drop column if exists recommended_action, drop column if exists expiry_notes;

alter table public.drugs add column if not exists recommended_action text;
alter table public.drugs add column if not exists expiry_notes      text;

comment on column public.drugs.recommended_action is '권장조치 — 유효기한 화면 수기 입력';
comment on column public.drugs.expiry_notes       is '비고 — 유효기한 화면 수기 입력';