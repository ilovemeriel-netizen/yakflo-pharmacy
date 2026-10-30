-- ═══════════════════════════════════════
-- 0104 — 보관위치 이동 기록(감사) + 일괄 이동 RPC
--
-- ★ 왜 필요한가
--   지금은 약품의 보관위치가 바뀌어도 **아무 기록도 남지 않는다.** 495건을 한꺼번에
--   임시보관함으로 옮기는 식의 조작을 되돌릴 근거가 없다(기술 부채 1번).
--   그래서 `drugs.storage_location` 이 바뀔 때마다 DB 가 한 줄씩 적는다 —
--   **수정 창·보관위치 화면·엑셀 일괄등록·직접 SQL 까지 모든 경로**가 포함된다.
--   화면은 하나도 바뀌지 않는다.
--
-- ★ append-only 로 둔다 — 기존 관례 중 **새 쪽**을 따른다.
--     · drug_status_audit(0072) : SELECT·INSERT·UPDATE·DELETE 4정책 (고칠 수 있다)
--     · vaccine_survey_audit(0093·0095) : SELECT·INSERT 2정책 (append-only)
--   되돌릴 근거로 쓸 기록이라 **고치거나 지울 수 있으면 근거가 아니다.** 후자를 따른다.
--   ※ 정말 지워야 할 때는 정책을 하나 더 만들어야 한다 — 그 자체가 승인 절차가 된다.
--
-- ★ changed_by 는 NOT NULL 이 아니다 — 0095 의 교훈.
--   JWT 가 없는 경로(service_role·배치)에서 auth.uid() 가 NULL 인데 NOT NULL 이면
--   **기록이 막히는 게 아니라 원래 UPDATE 가 통째로 실패한다.** 기록 때문에 업무가 멈추면 안 된다.
--
-- ★ 소급 적재 없음 — 적용 시점부터만 쌓인다.
-- ★ 개인정보가 아니다(약품코드·위치·사용자 uuid).
--
-- ★★ 적용 순서 — 이 마이그레이션이 코드 배포보다 **먼저**다(칸·함수 추가이므로).
--   적용 뒤 `notify pgrst, 'reload schema'` 로 RPC 가 API 에 보이는지 확인하고 배포한다.
--   (인계문서 함정 #22 — 캐시가 낡으면 실재하는 것도 PGRST204/404 가 난다)
--
-- ★ 되돌리기
--     drop trigger if exists trg_log_drugs_location on public.drugs;
--     drop function if exists public.log_drugs_location();
--     drop function if exists public.app_move_drug_location(uuid[], text);
--     drop table if exists public.drug_location_audit;   -- ※ 쌓인 기록이 사라진다
-- ═══════════════════════════════════════

begin;

-- ── 1) 이동 기록 표 ───────────────────────────────────────────────────────
-- ★ drug_name 을 함께 박아 둔다. 약품명은 바뀔 수 있고, 기록은 **그때 무엇을 옮겼는지**를
--   말해야 한다. drug_code 만 두면 이름이 바뀐 뒤 기록을 읽을 수 없다.
create table if not exists public.drug_location_audit (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  drug_code     text not null,
  drug_name     text,
  old_location  text,
  new_location  text,
  changed_at    timestamptz not null default now(),
  changed_by    uuid default auth.uid()
);

comment on table public.drug_location_audit is
  '보관위치 이동 기록. drugs.storage_location 이 바뀔 때마다 트리거가 한 줄 적는다. append-only.';

create index if not exists idx_drug_location_audit_tenant_changed
  on public.drug_location_audit(tenant_id, changed_at desc);
create index if not exists idx_drug_location_audit_tenant_code
  on public.drug_location_audit(tenant_id, drug_code);
-- 「이 위치에서 무엇이 나갔나 / 들어왔나」를 찾는 길
create index if not exists idx_drug_location_audit_tenant_new
  on public.drug_location_audit(tenant_id, new_location);

-- tenant_id 자동 채움(수동 insert 대비 — 기존 함수 재사용, NULL 일 때만 충전)
drop trigger if exists trg_set_tenant_id on public.drug_location_audit;
create trigger trg_set_tenant_id
  before insert on public.drug_location_audit
  for each row execute function public.set_tenant_id_from_user();

-- ── 2) RLS — append-only(SELECT·INSERT 만) ────────────────────────────────
alter table public.drug_location_audit enable row level security;

drop policy if exists drug_location_audit_select_own_tenant on public.drug_location_audit;
create policy drug_location_audit_select_own_tenant on public.drug_location_audit
  for select using (tenant_id in (select current_tenant_ids()));

drop policy if exists drug_location_audit_insert_own_tenant on public.drug_location_audit;
create policy drug_location_audit_insert_own_tenant on public.drug_location_audit
  for insert with check (tenant_id in (select current_tenant_ids()));

-- ⚠ GRANT — PostgREST 는 RLS 이전에 테이블 권한을 본다(0038 에서 42501 로 당한 적 있다).
--   UPDATE·DELETE 는 주지 않는다. 정책과 권한 **둘 다** 막아 둔다.
grant select, insert on public.drug_location_audit to anon, authenticated;
grant all on public.drug_location_audit to service_role;

-- ── 3) 기록 트리거 ────────────────────────────────────────────────────────
-- ★ AFTER UPDATE **OF storage_location** — 그 칸이 UPDATE 문에 없으면 발화조차 않는다.
--   `is distinct from` 으로 같은 값 덮어쓰기도 거른다(NULL ↔ 값 포함).
create or replace function public.log_drugs_location()
returns trigger language plpgsql security definer set search_path = 'public' as $function$
begin
  if new.storage_location is distinct from old.storage_location then
    insert into public.drug_location_audit
      (tenant_id, drug_code, drug_name, old_location, new_location, changed_by)
    values (new.tenant_id, new.drug_code, new.drug_name,
            old.storage_location, new.storage_location, auth.uid());
  end if;
  return new;
end $function$;

comment on function public.log_drugs_location() is
  '보관위치가 바뀔 때 drug_location_audit 에 한 줄 적는다. 모든 경로(화면·엑셀·SQL) 공통.';

drop trigger if exists trg_log_drugs_location on public.drugs;
create trigger trg_log_drugs_location
  after update of storage_location on public.drugs
  for each row execute function public.log_drugs_location();

-- ── 4) 일괄 이동 RPC ──────────────────────────────────────────────────────
-- ★ 왜 RPC 인가
--   화면은 지금 100건씩 끊어 .in() 으로 보낸다. 쿼리스트링이라 691건이면 Kong 의 URI
--   한계(8KB)에 걸리기 때문이다. 그래서 **단일 트랜잭션이 아니고**, 중간에 실패하면
--   앞 청크만 반영된 채 끝난다. RPC 는 id 배열을 본문으로 받으므로 길이 한계가 없고
--   함수 한 번이 한 트랜잭션이라 **중간에 실패하면 전부 취소**된다.
--
-- ★ SECURITY INVOKER 다 — 부르는 사람의 권한과 RLS 를 그대로 받는다.
--   DEFINER 로 두면 남의 테넌트 약품도 옮길 수 있게 되고, auth.uid() 기록도 흐려진다.
--
-- ★ 막는 것 두 가지(둘 다 전체 취소)
--     · 등록되지 않았거나 중지된 위치로 옮기기 — 유령 위치가 생긴다
--     · 중지 약품 옮기기 — 화면이 체크를 막고 있고, DB 에서도 받친다
create or replace function public.app_move_drug_location(p_ids uuid[], p_dest text)
returns integer
language plpgsql
security invoker
set search_path = 'public'
as $function$
declare
  v_dest text := btrim(coalesce(p_dest, ''));
  v_bad  int;
  v_n    int;
begin
  if v_dest = '' then
    raise exception '옮길 위치를 고르지 않았습니다' using errcode = 'check_violation';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- 목적지가 등록된 활성 위치인가 (내 테넌트 기준)
  if not exists (
    select 1 from public.location_vocab v
     where v.label = v_dest and v.is_active and v.tenant_id in (select current_tenant_ids())
  ) then
    raise exception '등록되지 않았거나 중지된 보관위치입니다 (%)', v_dest
      using errcode = 'check_violation';
  end if;

  -- 중지 약품이 섞여 있으면 통째로 취소
  select count(*) into v_bad
    from public.drugs d where d.id = any(p_ids) and d.status = '중지';
  if v_bad > 0 then
    raise exception '중지된 약품 %건이 들어 있어 옮기지 않았습니다', v_bad
      using errcode = 'check_violation';
  end if;

  -- ★ storage_location 하나만 쓴다 — current_qty 를 건드리면 0055 가드(23514)에 걸린다.
  --   이미 그 위치인 행은 건드리지 않는다(기록이 쓸데없이 늘어난다).
  update public.drugs d
     set storage_location = v_dest
   where d.id = any(p_ids)
     and d.storage_location is distinct from v_dest;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

comment on function public.app_move_drug_location(uuid[], text) is
  '약품 여러 건의 보관위치를 한 트랜잭션으로 옮긴다. 등록 어휘·중지 약품을 검사하고, '
  '위치가 이미 같은 행은 건너뛴다. 반환값은 실제로 바뀐 행수.';

grant execute on function public.app_move_drug_location(uuid[], text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
