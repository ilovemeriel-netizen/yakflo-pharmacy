-- 0119_drug_powder_override.sql   ★ 2026-11-10 운영 반영 완료 (dryrun 2회 → COMMIT → NOTIFY pgrst reload → API 확인)
--
-- 목적: 가루약 분리번호를 **사람이 고친 것만** 기억한다.
--
-- 왜 (2026-11-10)
--   분리번호는 ATC·성분·제형으로 **그때그때 계산**한다(src/lib/powderGroup.js).
--   그래서 약이 제네릭으로 바뀌어도 저절로 따라오고, 중지된 약은 저절로 빠진다.
--   그런데 규칙으로 정할 수 없는 약이 생기거나(「확인 필요」),
--   약사가 「이 약은 9번으로 따로 빼자」고 정하는 일이 있다. 지금은 그걸 적어 둘 곳이 없다.
--
-- ★ drugs 에 칸을 더하지 않는다.
--   고친 약만 줄로 남긴다. 지금이라면 **0줄로 시작**한다(사용 경구제 359종 모두 규칙으로 정해짐).
--   1,133줄 전부에 빈 칸을 만드는 쪽보다 가볍고, 「자동으로 되돌리기」가 **줄 지우기** 한 번이다.
--
-- ★ 이 표는 약품을 바꾸지 않는다. drugs 에 손대지 않으므로
--   마감·재고·금액·사용량에 **영향이 없다.**
--
-- ★ 우선순위는 화면 쪽 resolveGroup() 한 함수가 정한다 —
--     ① 이 표에 줄이 있으면 그 번호   ② 없으면 decideGroup() 자동 계산   ③ 자동도 못 정하면 「확인 필요」
--   가루약분리 화면·약품 등록·수정 창이 **모두 같은 함수**를 쓴다.
--
-- ★ expand 순서 (CLAUDE.md): 이 표를 먼저 만들고, PostgREST 캐시를 갱신해
--   API 에서 보이는지 확인한 뒤에야 이 표를 읽는 화면을 배포한다.

begin;

-- ═══ ① 고친 번호를 담는 작은 표 ═══
create table if not exists public.drug_powder_override (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  drug_code   text not null,                 -- 약플로 약품코드
  group_no    smallint not null,             -- 사람이 정한 분리번호 1~9
  note        text,                          -- 왜 그렇게 정했는지
  created_by  uuid,
  created_at  timestamptz not null default clock_timestamp(),
  updated_by  uuid,
  updated_at  timestamptz,
  -- 1~9 밖의 값이 들어오면 막는다. 「수기조제」·「확인 필요」는 번호가 없으므로 여기 적지 않는다.
  constraint drug_powder_override_no_chk check (group_no between 1 and 9)
);

-- 한 약국 안에서 한 약품은 **한 줄만** — 고친 번호가 둘일 수 없다
create unique index if not exists drug_powder_override_uniq
  on public.drug_powder_override (tenant_id, drug_code);

comment on table public.drug_powder_override is
  '가루약 분리번호 — 사람이 고친 것만 적는다. 줄이 없으면 규칙(ATC·성분·제형)으로 계산한다. drugs 를 바꾸지 않는다.';
comment on column public.drug_powder_override.group_no is
  '사람이 정한 분리번호 1~9. 이 줄을 지우면 자동 계산으로 돌아간다.';

-- 테넌트 자동 채움 — 다른 표와 같은 방식
drop trigger if exists trg_set_tenant_id on public.drug_powder_override;
create trigger trg_set_tenant_id
  before insert on public.drug_powder_override
  for each row execute function public.set_tenant_id_from_user();

-- ═══ ② 누가 만들고 고쳤는지 줄에 찍는다 (0110 과 같은 방식) ═══
create or replace function public.stamp_drug_powder_override()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_drug_powder_override on public.drug_powder_override;
create trigger trg_stamp_drug_powder_override
  before insert or update on public.drug_powder_override
  for each row execute function public.stamp_drug_powder_override();

-- ═══ ③ 감사 — 누가·언제·전→후 를 **기존 감사표에** 남긴다 ═══
--   ★ 새 감사표를 만들지 않는다. drug_usage_audit 이 이미
--     tenant_id · drug_code · field · old_value · new_value · changed_by · changed_at 를 갖고 있고,
--     주의 표시·보관방법·사용량이 모두 거기 쌓인다. 한자리에서 보는 편이 낫다.
--   ★ field 는 'powder_group' 으로 적는다. 지우면 new_value 가 null — 「자동으로 되돌림」이라는 뜻이다.
create or replace function public.log_drug_powder_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_code   text;
  v_old    text;
  v_new    text;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id; v_code := old.drug_code;
    v_old := old.group_no::text; v_new := null;
  elsif tg_op = 'INSERT' then
    v_tenant := new.tenant_id; v_code := new.drug_code;
    v_old := null; v_new := new.group_no::text;
  else
    if new.group_no is not distinct from old.group_no then return new; end if;
    v_tenant := new.tenant_id; v_code := new.drug_code;
    v_old := old.group_no::text; v_new := new.group_no::text;
  end if;

  insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, changed_by)
  values (v_tenant, v_code, 'powder_group', v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_log_drug_powder_override on public.drug_powder_override;
create trigger trg_log_drug_powder_override
  after insert or update or delete on public.drug_powder_override
  for each row execute function public.log_drug_powder_override();

-- ═══ ④ RLS — 같은 약국만 보이고, 쓰기는 owner·admin 만 (0110 과 같은 기준) ═══
alter table public.drug_powder_override enable row level security;

drop policy if exists drug_powder_override_select on public.drug_powder_override;
create policy drug_powder_override_select on public.drug_powder_override
  for select using (tenant_id in (select current_tenant_ids()));

-- ★ 쓰기 셋은 **같은 조건**을 쓴다 — 한 곳만 느슨하면 거기로 샌다.
drop policy if exists drug_powder_override_insert on public.drug_powder_override;
create policy drug_powder_override_insert on public.drug_powder_override
  for insert with check (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = drug_powder_override.tenant_id
    ));

drop policy if exists drug_powder_override_update on public.drug_powder_override;
create policy drug_powder_override_update on public.drug_powder_override
  for update using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = drug_powder_override.tenant_id
    ));

drop policy if exists drug_powder_override_delete on public.drug_powder_override;
create policy drug_powder_override_delete on public.drug_powder_override
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = drug_powder_override.tenant_id
    ));

grant select, insert, update, delete on public.drug_powder_override to authenticated;
revoke all on public.drug_powder_override from anon;

commit;

-- PostgREST 스키마 캐시 갱신 — 이 줄까지 돌려야 API 에서 새 표가 보인다(CLAUDE.md 함정 #22).
notify pgrst, 'reload schema';

-- ═══ 확인 (읽기 전용) ═══
--   select has_table_privilege('anon','public.drug_powder_override','select') as anon,
--          has_table_privilege('authenticated','public.drug_powder_override','insert') as auth_insert;
--   → anon false · auth_insert true
--   select polname, polcmd from pg_policy where polrelid='public.drug_powder_override'::regclass;
--   → select · insert · update · delete 네 가지
--   select count(*) from public.drug_powder_override;  → 0 (빈 표로 시작)

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop table if exists public.drug_powder_override;
--   drop function if exists public.stamp_drug_powder_override();
--   drop function if exists public.log_drug_powder_override();
--   ⚠ 고친 번호가 저장되기 시작한 뒤에는 그 번호가 사라진다(전부 자동 계산으로 돌아간다).
--   ⚠ drug_usage_audit 의 powder_group 기록은 남는다 — 지우려면 따로 지워야 한다.
