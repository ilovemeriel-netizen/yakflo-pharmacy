-- 0114_revoke_trend_public.sql
-- 목적: `usage_monthly_trend(integer)` 의 **PUBLIC·anon 실행 권한을 회수**한다.
--
-- ★ 왜 — 0026 이 `grant execute … to authenticated` 만 하고, `create function` 이
--   기본으로 주는 **PUBLIC 실행 권한을 거두지 않았다.** 그래서 로그인하지 않은
--   `anon` 도 이 함수를 부를 수 있었다(2026-11-05 발견).
--   ※ 값이 새어 나간 것은 아니다 — 이 함수는 `security invoker` 라서 RLS 가 그대로 걸려
--     anon 에게는 **0줄**을 돌려준다(실측 확인). 그래도 부를 수 있다는 것 자체가 불필요한 문턱이다.
--
-- ★ 범위 — **권한만 좁힌다.** 함수 본문·반환형·수식은 한 글자도 바꾸지 않는다.
--   · 화면(로그인한 사용자)은 `authenticated` 로 부르므로 **수량 막대는 그대로 동작한다.**
--   · 이 함수를 쓰는 곳은 발주관리 「사용량 분석」 한 곳뿐이고, 공개 앱(백신·병동)은 쓰지 않는다.
--
-- ★ 순서 규칙 — CLAUDE.md 「권한을 회수하거나 좁히는 마이그레이션은 그 권한을 쓰는 옛 코드가
--   운영에서 사라진 뒤에 적용한다」. 여기서 회수하는 것은 **anon 권한**이고,
--   운영 코드는 anon 으로 이 함수를 부른 적이 없다(앱에서 `.rpc('usage_monthly_trend')` 를
--   부르는 곳은 `src/App.jsx` 한 군데이며 로그인 뒤 화면이다). 그래서 지금 적용해도 안전하다.

begin;

revoke all on function public.usage_monthly_trend(integer) from public;
revoke all on function public.usage_monthly_trend(integer) from anon;

-- 화면이 쓰는 권한은 그대로 둔다(이미 있지만 명시해 둔다 — 재실행 안전)
grant execute on function public.usage_monthly_trend(integer) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — 되돌릴 일은 없어야 하지만 적어 둔다
-- grant execute on function public.usage_monthly_trend(integer) to public;
-- ════════════════════════════════════════════════════════════════
