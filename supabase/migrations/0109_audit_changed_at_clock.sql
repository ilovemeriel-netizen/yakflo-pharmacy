-- 0109_audit_changed_at_clock.sql
--
-- 목적: 사용량 감사표의 기록 시각을 **줄마다 다르게** 남긴다.
--
-- 왜 (2026-11-04 실측)
--   · 0105 의 트리거 함수는 `changed_at` 을 **적지 않는다**. 칸 기본값 `now()` 가 채운다.
--   · `now()` 는 **트랜잭션 시작 시각**이라, 한 트랜잭션에서 여러 줄이 바뀌면
--     **전부 같은 시각**으로 찍혀 순서를 잃는다.
--   · 실측: 기존 기록 18건 중 **16건이 같은 시각**(14:26:3x).
--     0108(한 번에 저장)이 들어오면 한 번에 수백 줄이 같은 시각이 된다.
--   · `clock_timestamp()` 는 **그 줄을 쓰는 순간**의 시각이라 순서가 남는다.
--
-- ★ 지난 기록은 **그대로 둔다**. 기본값만 바꾸므로 이미 저장된 값은 건드리지 않는다
--   (소급해 시각을 지어내지 않는다 — 9월 마감 시각을 역산만 하고 채우지 않은 것과 같은 원칙).
-- ★ 트리거 함수는 손대지 않는다. 그 함수가 `changed_at` 을 적지 않기 때문에
--   칸 기본값만 바꾸면 바로 효과가 난다.

begin;

alter table public.drug_usage_audit
  alter column changed_at set default clock_timestamp();

comment on column public.drug_usage_audit.changed_at is
  '기록 시각. 2026-11-04 부터 clock_timestamp() — 한 번에 여러 줄을 바꿔도 줄마다 다르다. 그 전 기록은 now()(트랜잭션 시작 시각)라 뭉쳐 있다.';

commit;

-- ═══ 확인 (읽기 전용) ═══
--   select column_default from information_schema.columns
--    where table_schema='public' and table_name='drug_usage_audit' and column_name='changed_at';
--   → clock_timestamp()

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   alter table public.drug_usage_audit alter column changed_at set default now();
