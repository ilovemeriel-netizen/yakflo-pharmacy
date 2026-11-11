-- 0120_drug_powder_sr.sql   ★ 2026-11-11 운영 반영 완료 (dryrun → COMMIT → NOTIFY pgrst reload → API 확인)
--
-- 목적: 1번(일반 정제) 안에서 **서방정만 따로 묶어 보기** 위한, 사람이 정한 표시를 담는다.
--
-- 왜 (2026-11-10~11)
--   2~9번은 이미 「가루로 하지 않는 약」이라 번호를 준 것이고,
--   서방정 구분이 필요한 곳은 **1번 안**뿐이다(2026-11-11 이정화 님 결정).
--   자동은 「이름에 **서방**이 있으면 서방정」으로 본다. 지금 1번 173종 중 12종이 걸린다.
--   그런데 이름에 「서방」이 없는 서방제(웰부트린엑스엘 등)가 있고,
--   거꾸로 「서방」이 있어도 빼고 싶은 약이 생길 수 있다. 그걸 적어 둘 곳이 필요하다.
--
-- ★ 번호를 바꾸지 않는다. 서방정이어도 **1번 그대로**다.
--   그래서 `drug_powder_override`(번호를 **고친** 약만 담는 표)에 섞지 않고 **따로** 둔다.
--   섞으면 「그 표에 줄이 있다 = 번호를 고쳤다」는 뜻이 흐려진다.
--   (0119 는 지금 0줄이고, 그 0 이 「고친 약 없음」을 그대로 말해 준다.)
--
-- ★ 한 칸으로 **넣기와 빼기**를 둘 다 한다.
--     is_sr = true  → 이름에 「서방」이 없어도 서방정으로 본다
--     is_sr = false → 이름에 「서방」이 있어도 서방정에서 뺀다
--   줄이 없으면 자동(이름에 「서방」)으로 돌아간다. 되돌리기는 **줄 지우기**다.
--
-- ★ 화면 쪽 resolveSr() 가 순서를 정한다 — ① 이 표의 줄  ② 이름에 「서방」.
--   번호의 resolveGroup() 과 **같은 모양**이다.
--
-- ★ expand 순서 (CLAUDE.md): 이 표를 먼저 만들고, PostgREST 캐시를 갱신해
--   API 에서 보이는지 확인한 뒤에야 이 표를 읽는 화면을 배포한다.

begin;

-- ═══ ① 서방정 표시를 담는 작은 표 ═══
create table if not exists public.drug_powder_sr (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  drug_code   text not null,                 -- 약플로 약품코드
  is_sr       boolean not null,              -- true=서방정으로 본다 · false=서방정에서 뺀다
  note        text,                          -- 왜 그렇게 정했는지 (선택)
  created_by  uuid,
  created_at  timestamptz not null default clock_timestamp(),
  updated_by  uuid,
  updated_at  timestamptz
);

-- 한 약국 안에서 한 약품은 **한 줄만**
create unique index if not exists drug_powder_sr_uniq
  on public.drug_powder_sr (tenant_id, drug_code);

comment on table public.drug_powder_sr is
  '가루약 1번(일반 정제) 안의 서방정 표시 — 사람이 정한 것만 적는다. 줄이 없으면 이름에 「서방」이 있는지로 본다. 분리번호를 바꾸지 않는다.';
comment on column public.drug_powder_sr.is_sr is
  'true=서방정으로 본다(이름에 「서방」이 없어도) · false=서방정에서 뺀다(이름에 「서방」이 있어도). 줄을 지우면 자동으로 돌아간다.';

-- 테넌트 자동 채움 — 다른 표와 같은 방식
drop trigger if exists trg_set_tenant_id on public.drug_powder_sr;
create trigger trg_set_tenant_id
  before insert on public.drug_powder_sr
  for each row execute function public.set_tenant_id_from_user();

-- ═══ ② 누가 만들고 고쳤는지 줄에 찍는다 (0110·0119 와 같은 방식) ═══
create or replace function public.stamp_drug_powder_sr()
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

drop trigger if exists trg_stamp_drug_powder_sr on public.drug_powder_sr;
create trigger trg_stamp_drug_powder_sr
  before insert or update on public.drug_powder_sr
  for each row execute function public.stamp_drug_powder_sr();

-- ═══ ③ 감사 — 누가·언제·전→후 를 **기존 감사표에** 남긴다 ═══
--   ★ 새 감사표를 만들지 않는다. drug_usage_audit 에 field='powder_sr' 로 적는다.
--     0119 의 'powder_group' 과 나란히 보인다.
--   ★ 지우면 new_value 가 null — 「자동(이름에 「서방」)으로 되돌림」이라는 뜻이다.
create or replace function public.log_drug_powder_sr()
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
    v_old := old.is_sr::text; v_new := null;
  elsif tg_op = 'INSERT' then
    v_tenant := new.tenant_id; v_code := new.drug_code;
    v_old := null; v_new := new.is_sr::text;
  else
    if new.is_sr is not distinct from old.is_sr then return new; end if;
    v_tenant := new.tenant_id; v_code := new.drug_code;
    v_old := old.is_sr::text; v_new := new.is_sr::text;
  end if;

  insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, changed_by)
  values (v_tenant, v_code, 'powder_sr', v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_log_drug_powder_sr on public.drug_powder_sr;
create trigger trg_log_drug_powder_sr
  after insert or update or delete on public.drug_powder_sr
  for each row execute function public.log_drug_powder_sr();

-- ═══ ④ RLS — 같은 약국만 보이고, 쓰기는 owner·admin 만 (0110·0119 와 같은 기준) ═══
alter table public.drug_powder_sr enable row level security;

drop policy if exists drug_powder_sr_select on public.drug_powder_sr;
create policy drug_powder_sr_select on public.drug_powder_sr
  for select using (tenant_id in (select current_tenant_ids()));

-- ★ 쓰기 셋은 **같은 조건**을 쓴다 — 한 곳만 느슨하면 거기로 샌다.
drop policy if exists drug_powder_sr_insert on public.drug_powder_sr;
create policy drug_powder_sr_insert on public.drug_powder_sr
  for insert with check (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = drug_powder_sr.tenant_id
    ));

drop policy if exists drug_powder_sr_update on public.drug_powder_sr;
create policy drug_powder_sr_update on public.drug_powder_sr
  for update using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = drug_powder_sr.tenant_id
    ));

drop policy if exists drug_powder_sr_delete on public.drug_powder_sr;
create policy drug_powder_sr_delete on public.drug_powder_sr
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = drug_powder_sr.tenant_id
    ));

grant select, insert, update, delete on public.drug_powder_sr to authenticated;
revoke all on public.drug_powder_sr from anon;

commit;

-- PostgREST 스키마 캐시 갱신 — 이 줄까지 돌려야 API 에서 새 표가 보인다(CLAUDE.md 함정 #22).
notify pgrst, 'reload schema';

-- ═══ 확인 (읽기 전용) ═══
--   select has_table_privilege('anon','public.drug_powder_sr','select') as anon,
--          has_table_privilege('authenticated','public.drug_powder_sr','update') as auth_update;
--   → anon false · auth_update true
--   select polname, polcmd from pg_policy where polrelid='public.drug_powder_sr'::regclass;
--   → select · insert · update · delete 네 가지
--   select count(*) from public.drug_powder_sr;  → 0 (빈 표로 시작)

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop table if exists public.drug_powder_sr;
--   drop function if exists public.stamp_drug_powder_sr();
--   drop function if exists public.log_drug_powder_sr();
--   ⚠ 사람이 정한 서방정 표시가 사라진다(전부 이름에 「서방」이 있는지로 돌아간다).
--   ⚠ drug_usage_audit 의 powder_sr 기록은 남는다 — 지우려면 따로 지워야 한다.
