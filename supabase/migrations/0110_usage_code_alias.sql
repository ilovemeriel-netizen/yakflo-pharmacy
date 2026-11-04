-- 0110_usage_code_alias.sql   ★ 시안 — **적용하지 않았다**(dryrun 결과만 보고)
--
-- 목적: 원내 프로그램 코드와 약플로 코드가 다른 약품의 **짝을 기억한다**.
--
-- 왜 (2026-11-04 실측)
--   원내 파일에 약플로에 없는 코드가 12건 있었다. 이름으로 찾아 짝지을 수는 있지만,
--   지금은 **올릴 때마다 다시** 짝지어야 한다. 매달 같은 일을 되풀이한다.
--     2-APR    알프람정0.25mg(알프라졸람)  →  APR2    ★ 향정
--     CHLCRT8  (본부80)콜린세레이트정       →  CHLCRT
--     CFOB     칼페온정(비급여)            →  CFO
--     MMMSC8   (본부80)메모엠연질캡슐       →  MMMSC
--     7BCHX2   삐콤헥사주 2ml             →  7BCHX
--     NS20NB   휴온스생리식염주사액20ml-NB  →  NS20
--     JAN-02   영양제-안타솔주250ml(직원가) →  2002
--     SGRX0·SGRX12·SGRX2·SGRX12-A 싱그릭스주 4종 → SGRX1
--
-- ★ 이 표는 **약품을 바꾸지 않는다**. 「올라온 코드를 어느 약품으로 읽을까」만 적는다.
--   drugs 에는 손대지 않으므로 마감·재고·금액에 영향이 없다.
-- ★ 한 원내코드는 한 약플로코드로만 — tenant 안에서 (alias_code) 가 유일하다.
--   거꾸로는 여럿이어도 된다(싱그릭스주 4종 → SGRX1).
-- ★ expand 순서 (CLAUDE.md): 이 표를 먼저 만들고, PostgREST 캐시를 갱신해
--   API 에서 보이는지 확인한 뒤에야 이 표를 읽는 화면을 배포한다.

begin;

create table if not exists public.usage_code_alias (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  alias_code  text not null,                 -- 원내 프로그램 코드
  drug_code   text not null,                 -- 약플로 코드
  note        text,                          -- 적어 둘 말(약품명 따위)
  created_by  uuid,                          -- 만든 사람 (auth.uid())
  created_at  timestamptz not null default clock_timestamp(),
  updated_by  uuid,
  updated_at  timestamptz
);

-- 한 약국 안에서 원내코드는 하나의 뜻만 갖는다
create unique index if not exists usage_code_alias_uniq
  on public.usage_code_alias (tenant_id, alias_code);
-- 거꾸로 찾기(이 약품을 가리키는 원내코드들)
create index if not exists usage_code_alias_drug
  on public.usage_code_alias (tenant_id, drug_code);

comment on table public.usage_code_alias is
  '사용량 올릴 때 원내 코드 → 약플로 코드 짝. drugs 를 바꾸지 않는다(읽는 방법만 적는다).';

-- 테넌트 자동 채움 — 다른 표와 같은 방식
drop trigger if exists trg_set_tenant_id on public.usage_code_alias;
create trigger trg_set_tenant_id
  before insert on public.usage_code_alias
  for each row execute function public.set_tenant_id_from_user();

-- ═══ 누가 만들고 고쳤는지 남긴다 ═══
--   ★ 따로 감사표를 두지 않고 이 표에 적는다 — 줄 수가 적고(수십 건),
--     「지금 짝이 무엇인가」와 「누가 언제 정했나」를 한자리에서 보는 편이 낫다.
create or replace function public.stamp_usage_code_alias()
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

drop trigger if exists trg_stamp_usage_code_alias on public.usage_code_alias;
create trigger trg_stamp_usage_code_alias
  before insert or update on public.usage_code_alias
  for each row execute function public.stamp_usage_code_alias();

-- ═══ RLS — 같은 약국만 보이고, 쓰기는 owner·admin 만 ═══
alter table public.usage_code_alias enable row level security;

drop policy if exists usage_code_alias_select on public.usage_code_alias;
create policy usage_code_alias_select on public.usage_code_alias
  for select using (tenant_id in (select current_tenant_ids()));

-- ★ 쓰기 셋은 **같은 조건**을 쓴다 — 0105c·0107·0108 과 같은 기준(owner·admin).
--   한 곳만 느슨하면 거기로 새므로 insert·update·delete 를 모두 건다.
drop policy if exists usage_code_alias_insert on public.usage_code_alias;
create policy usage_code_alias_insert on public.usage_code_alias
  for insert with check (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = usage_code_alias.tenant_id
    ));

drop policy if exists usage_code_alias_update on public.usage_code_alias;
create policy usage_code_alias_update on public.usage_code_alias
  for update using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = usage_code_alias.tenant_id
    ));

drop policy if exists usage_code_alias_delete on public.usage_code_alias;
create policy usage_code_alias_delete on public.usage_code_alias
  for delete using (
    tenant_id in (select current_tenant_ids())
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id = usage_code_alias.tenant_id
    ));

grant select, insert, update, delete on public.usage_code_alias to authenticated;
revoke all on public.usage_code_alias from anon;

commit;

-- PostgREST 스키마 캐시 갱신 — 이 줄까지 돌려야 API 에서 새 표가 보인다(CLAUDE.md 함정 #22).
notify pgrst, 'reload schema';

-- ═══ 확인 (읽기 전용) ═══
--   select has_table_privilege('anon','public.usage_code_alias','select') as anon,
--          has_table_privilege('authenticated','public.usage_code_alias','insert') as auth_insert;
--   → anon false · auth_insert true
--   select polname, polcmd from pg_policy where polrelid='public.usage_code_alias'::regclass;
--   → select · insert · update · delete 네 가지

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop table if exists public.usage_code_alias;
--   drop function if exists public.stamp_usage_code_alias();
--   ⚠ 짝이 저장되기 시작한 뒤에는 그 짝이 사라진다(다시 손으로 짝지어야 한다).
