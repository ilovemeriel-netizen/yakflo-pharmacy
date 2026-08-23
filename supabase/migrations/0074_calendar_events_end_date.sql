-- 0074_calendar_events_end_date.sql
-- 목적: 일정 기간 지원 — calendar_events.end_date 추가.
--   · end_date date NULL → NULL이면 단일 날짜(기존 데이터 호환).
--   · CHECK (end_date IS NULL OR end_date >= event_date) — 종료일이 시작일보다 빠를 수 없음.
--   · 정본(monthly_snapshots)·거래 무관 컬럼 추가. dryrun(BEGIN→ALTER→검증 A~D→ROLLBACK) 통과 후 apply.

begin;

alter table public.calendar_events add column if not exists end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'calendar_events_enddate_chk'
      and conrelid = 'public.calendar_events'::regclass
  ) then
    alter table public.calendar_events
      add constraint calendar_events_enddate_chk check (end_date is null or end_date >= event_date);
  end if;
end $$;

commit;

-- 롤백(참고):
-- alter table public.calendar_events drop constraint if exists calendar_events_enddate_chk;
-- alter table public.calendar_events drop column if exists end_date;
