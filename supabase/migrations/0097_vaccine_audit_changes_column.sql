-- ════════════════════════════════════════════════════════════════════════════
-- 0097 — 감사 기록에 「무엇이 어떻게 바뀌었는가」를 담을 칸을 만든다.
--
-- ★ 왜 필요한가 (2026-10-30 실측)
--   vaccine_survey_audit 은 8칸뿐이라 **바뀐 값을 적지 않는다**. 「가족 수를 3→2 로
--   고쳤다」를 기록으로 입증할 방법이 없었고, 실제로 가족 수가 왜 1 이 됐는지
--   추적할 수 없었다(edit 기록 9건만 남고 값은 없음).
--
-- ★ 이 파일은 **칸만 만든다.** 함수가 이 칸을 쓰기 시작하는 것은 0098 이다.
--   CLAUDE.md 규칙: 컬럼을 추가한 뒤 PostgREST 스키마 캐시를 갱신하고, 새 칸이
--   API 에서 보이는지 확인한 다음에 그 칸을 쓰는 코드를 적용한다.
--   (캐시가 낡은 동안에는 실재하는 컬럼에도 PGRST204 가 난다.)
--
-- ★ NULL 허용이다. 기존 기록(0097 이전)은 NULL 로 남는다 — 소급해 채우지 않는다.
--   없는 정보를 추측해 적으면 기록이 아니라 창작이 된다.
--
-- ★ append-only 가드(trg_vaccine_survey_audit_append_only)와 권한은 건드리지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.vaccine_survey_audit
  add column if not exists changes jsonb;

comment on column public.vaccine_survey_audit.changes is
  '바뀐 칸만 {"칸":{"from":옛값,"to":새값}} 으로 담는다. '
  '대상: family_count · self_dose · dose · wish_date · status · done_self · done_family. '
  '★ 개인정보(성명·사번·연락처·신청번호)는 절대 넣지 않는다. '
  '0097 이전 기록은 NULL (소급 금지).';

-- ★ PostgREST 가 새 칸을 보게 한다. 이 알림은 커밋될 때 나간다.
notify pgrst, 'reload schema';
