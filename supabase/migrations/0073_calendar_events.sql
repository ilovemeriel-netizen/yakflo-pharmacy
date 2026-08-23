-- 0073_calendar_events.sql
-- 목적: 일정(달력) 직접 입력 이벤트 저장. 기존 일정(유효기한·약품변경·마감)은 파생 표시라 무관.
--   · calendar_events: 제목·날짜·분류(발주·실사·마감·기타)·메모. category는 CHECK 없음(유연).
--   · 규약: drug_change_plans(0038)·drug_status_audit(0072) RLS/GRANT 4정책 + trg_set_tenant_id.
--   · 정본(monthly_snapshots)·거래 무관 — 신규 테이블. dryrun(BEGIN→생성→검증 A~D→ROLLBACK) 통과 후 apply.

begin;

create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  title       text not null,
  event_date  date not null,
  category    text,               -- '발주' · '실사' · '마감' · '기타'
  memo        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_calendar_events_tenant_date on public.calendar_events(tenant_id, event_date);

-- tenant_id 자동 세팅(클라 미지정 → auth 기반, NULL일 때만 충전)
drop trigger if exists trg_set_tenant_id on public.calendar_events;
create trigger trg_set_tenant_id
  before insert on public.calendar_events
  for each row execute function public.set_tenant_id_from_user();

alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_select_own_tenant on public.calendar_events;
create policy calendar_events_select_own_tenant on public.calendar_events
  for select using (tenant_id in (select current_tenant_ids()));

drop policy if exists calendar_events_insert_own_tenant on public.calendar_events;
create policy calendar_events_insert_own_tenant on public.calendar_events
  for insert with check (tenant_id in (select current_tenant_ids()));

drop policy if exists calendar_events_update_own_tenant on public.calendar_events;
create policy calendar_events_update_own_tenant on public.calendar_events
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

drop policy if exists calendar_events_delete_admin_own_tenant on public.calendar_events;
create policy calendar_events_delete_admin_own_tenant on public.calendar_events
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.tenant_id = calendar_events.tenant_id
        and tm.role in ('owner', 'admin')
    )
  );

-- ⚠ GRANT(42501 재발 방지 — 0038 이력)
grant select, insert, update, delete on public.calendar_events to anon, authenticated;
grant all on public.calendar_events to service_role;

commit;

-- 롤백(참고): drop table if exists public.calendar_events;
