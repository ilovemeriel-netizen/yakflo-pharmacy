-- 0075_holidays.sql
-- 목적: 공휴일 공유 레퍼런스 테이블(전 테넌트 공유, tenant_id 없음) — drug_master(0041) 패턴.
--   · 한국천문연구원 특일정보(getRestDeInfo) 연 단위 조회분을 service_role이 upsert.
--   · 읽기: 인증 사용자 SELECT 허용. 쓰기: service_role(RLS 우회)만. 화면은 읽기 전용 자동 표시.
--   · UNIQUE(date, name) — 같은 날 복수 공휴일(예: 겹치는 기념일) 허용, 중복 방지.
--   · 정본(monthly_snapshots)·거래 무관 신규 테이블. dryrun(BEGIN→생성→검증 A~D→ROLLBACK) 통과 후 apply.

begin;

create table if not exists public.holidays (
  id          uuid primary key default gen_random_uuid(),
  year        int not null,
  date        date not null,
  name        text not null,
  is_holiday  boolean default true,
  fetched_at  timestamptz default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'holidays_date_name_key' and conrelid = 'public.holidays'::regclass
  ) then
    alter table public.holidays add constraint holidays_date_name_key unique (date, name);
  end if;
end $$;

create index if not exists idx_holidays_year on public.holidays(year);
create index if not exists idx_holidays_date on public.holidays(date);

-- 권한: 공유 레퍼런스(테넌트 스코프 없음). authenticated SELECT 전용, 쓰기는 service_role.
revoke all on public.holidays from anon;
revoke all on public.holidays from authenticated;
grant select on public.holidays to authenticated;
grant all on public.holidays to service_role;

alter table public.holidays enable row level security;

drop policy if exists holidays_select_all on public.holidays;
create policy holidays_select_all on public.holidays
  for select to authenticated using (true);
-- 쓰기 정책 없음: INSERT/UPDATE/DELETE 는 service_role(RLS 우회)만.

commit;

-- 롤백(참고): drop table if exists public.holidays;
