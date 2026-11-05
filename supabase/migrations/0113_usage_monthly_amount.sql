-- 0113_usage_monthly_amount.sql
-- 목적: 발주관리 「사용량 분석 → 금액」 막대가 **달별 합계를 DB에서 받게** 한다.
--
-- ★ 왜 — 지금 화면은 `monthly_snapshots` 를 **줄 단위로 전부 읽어와** 브라우저에서 달별로
--   더한다. 그런데 스냅샷이 11,014줄이라 PostgREST 가 **1,000줄에서 조용히 자른다**
--   (오류 없이 `error: null`). 그래서 대부분의 달이 0원으로, 2026-07 은 32,002,763원인데
--   4,234,525원으로 보였다. 자른 줄은 요청마다 달라져 숫자가 흔들린다.
--
-- ★ 범위 — **읽기 함수 하나를 더한다.** 기존 것은 한 글자도 바꾸지 않는다.
--   · 0026 의 `usage_monthly_trend(integer)` 는 **그대로 둔다**(지우거나 반환형을 바꾸지 않는다).
--     반환형을 바꾸면 CREATE OR REPLACE 가 안 되고 drop 이 필요해, 옛 코드가 배포에서
--     사라지기 전에 함수가 없어지는 틈이 생긴다. 그래서 **쌍둥이 함수를 새로 더한다**
--     (넓히는 변경은 먼저 적용해도 된다 — 권한 규칙과 같은 방향).
--   · 수식은 화면이 지금 하는 것과 **똑같다**: `sum(coalesce(total_out_amount, 0))` 를
--     (연, 월)로 묶는다. 반올림·단위 변환을 하지 않는다(원 단위 그대로, 소수점 보존).
--   · 창(窓)도 `usage_monthly_trend` 와 **글자 그대로 같다** — 두 막대가 어긋나면 안 된다.
--   · `security invoker`(기본) · `stable` — 0026 틀을 그대로 따른다. RLS 를 지난다.

begin;

create or replace function public.usage_monthly_amount(p_months integer default 6)
returns table(ym text, out_amount numeric)
language sql stable
set search_path = public
as $$
  select to_char(make_date(s.snap_year, s.snap_month, 1), 'YYYY-MM') as ym,
         sum(coalesce(s.total_out_amount, 0)) as out_amount
  from public.monthly_snapshots s
  where make_date(s.snap_year, s.snap_month, 1)
        >= (date_trunc('month', current_date) - ((greatest(p_months,1) - 1) || ' months')::interval)
  group by 1
  order by 1
$$;

-- ★ 새 함수라 옛 코드가 의존하지 않는다 — 처음부터 좁게 준다.
--   create function 은 기본으로 PUBLIC 에 EXECUTE 를 주므로 그것부터 거둔다.
revoke all on function public.usage_monthly_amount(integer) from public;
revoke all on function public.usage_monthly_amount(integer) from anon;
grant execute on function public.usage_monthly_amount(integer) to authenticated;

-- 새 함수를 API 가 바로 보게 한다 (함정 #22)
notify pgrst, 'reload schema';

commit;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop function if exists public.usage_monthly_amount(integer);
-- ════════════════════════════════════════════════════════════════
