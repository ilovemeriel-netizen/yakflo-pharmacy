-- 0114_revoke_trend_public.sql
-- 목적: 바깥에서 부를 이유가 없는 함수 **세 개의 PUBLIC·anon 실행 권한을 회수**한다.
--
-- ★ 왜 — 예전 마이그레이션들이 `grant execute … to authenticated` 만 하고,
--   `create function` 이 기본으로 주는 **PUBLIC 실행 권한을 거두지 않았다.**
--   그래서 로그인하지 않은 `anon` 도 부를 수 있었다(2026-11-05 전수 조사에서 발견 —
--   public 함수 55개 중 49개가 그런 상태였다).
--
-- ★ 이 파일이 다루는 셋 (적용 전에 부르는 곳을 전부 확인했다 — 2026-11-06)
--   ① `usage_monthly_trend(integer)`  (0026)
--        부르는 곳: `src/App.jsx` 발주관리 「사용량 분석」 **한 곳**. 로그인 뒤 화면이라 `authenticated`.
--        anon 호출 시 지금도 **0줄**(security invoker → RLS 가 막는다). 값이 새지는 않았다.
--   ② `drug_change_forecast(integer)` (0026 쌍둥이)
--        부르는 곳: `src/App.jsx` 같은 useEffect **한 곳**. 공개 앱(vaccine-app·ward-app)은 쓰지 않는다.
--        같은 useEffect 의 `usage_monthly_amount`(0113 에서 이미 authenticated 전용)가
--        화면에서 값을 내놓고 있으므로, 이 경로가 `authenticated` 로 도는 것이 실증됐다.
--   ③ `purge_vaccine_survey_claim_attempts()` (0099)
--        ★ 셋 중 **유일하게 실제로 쓰기가 되던 구멍** — anon 이 불러 줄을 지울 수 있었다(실측).
--        부르는 곳: `vaccine-app/netlify/functions/vaccine-survey.js` **한 곳**,
--        1/100 확률로 부르는 청소 작업이고 **`SUPABASE_SERVICE_ROLE_KEY` 로 만든 서버 클라이언트**다.
--        즉 **브라우저가 아니라 서버**가 부른다 → `service_role` 권한으로 도므로 회수해도 끊기지 않는다.
--        (pg_cron 은 이 프로젝트에 **설치돼 있지 않다**. 다른 함수·뷰에서 부르는 곳도 없다.)
--
-- ★ 범위 — **권한만 좁힌다.** 함수 본문·반환형·수식·트리거는 한 글자도 바꾸지 않는다.
--
-- ★ 순서 규칙 — CLAUDE.md 「권한을 회수·축소하는 마이그레이션은 그 권한을 쓰는 옛 코드가
--   운영에서 사라진 뒤에 적용한다」. 여기서 거두는 것은 **anon·PUBLIC 권한**이고,
--   운영 코드 가운데 그 권한으로 이 셋을 부르는 곳은 **한 군데도 없다**(위에 전부 적었다).
--   그래서 지금 적용해도 운영 화면이 멈추지 않는다.

begin;

-- ① 발주관리 「사용량 분석」 수량 막대
revoke all on function public.usage_monthly_trend(integer) from public;
revoke all on function public.usage_monthly_trend(integer) from anon;
grant execute on function public.usage_monthly_trend(integer) to authenticated;

-- ② 발주관리 변경 예측
revoke all on function public.drug_change_forecast(integer) from public;
revoke all on function public.drug_change_forecast(integer) from anon;
grant execute on function public.drug_change_forecast(integer) to authenticated;

-- ③ 공개 백신 신청의 확인번호 시도 기록 청소 — **서버(service_role)만** 부른다.
--    ★ `authenticated` 에는 주지 않는다. 화면에서 부를 일이 없고, 준 적도 없다.
revoke all on function public.purge_vaccine_survey_claim_attempts() from public;
revoke all on function public.purge_vaccine_survey_claim_attempts() from anon;
grant execute on function public.purge_vaccine_survey_claim_attempts() to service_role;

notify pgrst, 'reload schema';

commit;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — 되돌릴 일은 없어야 하지만 적어 둔다
-- grant execute on function public.usage_monthly_trend(integer) to public;
-- grant execute on function public.drug_change_forecast(integer) to public;
-- grant execute on function public.purge_vaccine_survey_claim_attempts() to public;
-- ════════════════════════════════════════════════════════════════
