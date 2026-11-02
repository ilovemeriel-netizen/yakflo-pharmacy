-- 0105_usage_owner_guard.sql
-- 목적: 사용량 5칸(prev_year_usage·recent_3m_usage·recent_1m_usage·monthly_avg·usage_source)을
--       「최고 관리자(owner)만 바꿀 수 있고, 수기 값은 자동집계가 덮지 않으며, 바뀌면 기록이 남는」 상태로 만든다.
--
-- 왜 — 2026-11-01~02 읽기 전용 진단에서 확인한 구멍들:
--   ① app_recompute_usage 의 EXECUTE 가 PUBLIC(기본값 방치). 0044~0051 어디에도 grant 가 없다.
--   ② 그 함수의 (B) 블록에는 (A) 블록이 쓰는 manual 보호 줄이 **없어서**, 출고가 0건인 지금
--      누르면 usage_source='manual' 인 357종의 직전1개월이 전부 0 으로 사라진다.
--   ③ drugs UPDATE 정책(drugs_update_own_tenant)은 **역할을 보지 않는다** → 로그인한 일반 직원도
--      사용량을 전부 덮어쓸 수 있다(화면의 「사용량 업로드」 단추에도 역할 조건이 없었다).
--   ④ 사용량에는 감사표가 없어 「언제 누가 무엇을 무엇으로」 바꿨는지 되짚을 수 없다.
--      updated_at 은 어느 칸을 고쳐도 갱신되므로 증거가 못 된다.
--   ⑤ DB 에 음수 제약이 없다. 최근3개월에 음수가 들어가면 월평균→안전재고→재고상태까지 번진다.
--
-- 업무 규칙(사용자 확정, 2026-11-02):
--   · 직전1개월사용량은 **수기 입력이 정본**. 출고를 삭제해도 수기 값은 지킨다.
--   · 사용량 관련 기능은 모두 **owner 전용**.
--   · **직전1개월만 음수 허용**(원내 프로그램 반납 등). 전년·최근3개월·월평균은 음수 금지.
--
-- ★ 바꾸지 않는 것: (A)·(A2) 블록의 산식 한 글자도 손대지 않는다.
--   auto·미설정 약품의 결과는 지금과 완전히 같다(1단계 시뮬레이션 C-2 에서 다른 줄 0건 확인).
--
-- 적용 순서(본 파일은 1~3 만. 4 는 화면 배포 뒤 별도 파일):
--   0105  = (1) 감사표 + 트리거  (2) CHECK 제약  (3) 함수 교체(owner 검사 + manual 보호)
--   0105b = (4) 권한 회수(revoke execute from anon/public) — ★ 화면 배포 **뒤에** 적용
--   CLAUDE.md 규칙: 「칸·권한을 넓히는 변경은 먼저, 좁히는 변경은 배포 뒤」.

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1) 사용량 변경 이력 (append-only)
--    틀은 drug_price_history 를 그대로 베꼈다 — 지킬 칸이 여럿이라 field 방식이 맞다.
--    path(업로드/화면저장/자동집계) 칸은 이번에 넣지 않는다. 호출 쪽이 값을 넘겨야 해서
--    화면 코드가 따라 바뀌는데, 이번 차의 목표는 「기록이 남는 것」까지다.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.drug_usage_audit (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,
  drug_code   text not null,
  field       text not null,
  old_value   text,            -- 숫자 4칸과 usage_source(텍스트)를 한 표에 담으므로 text 로 통일
  new_value   text,
  old_source  text,            -- 그때의 usage_source — manual↔auto 전환도 같이 보인다
  new_source  text,
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);

comment on table public.drug_usage_audit is
  '사용량 5칸 변경 이력(append-only). 0105. 지우거나 고치지 말 것 — 되짚을 유일한 증거다.';

create index if not exists drug_usage_audit_code_at_idx
  on public.drug_usage_audit (drug_code, changed_at desc);
create index if not exists drug_usage_audit_tenant_at_idx
  on public.drug_usage_audit (tenant_id, changed_at desc);

-- 권한·RLS: drug_price_history 와 **같은 모양** — authenticated 는 읽기만.
-- 쓰기는 아래 SECURITY DEFINER 트리거만 한다(사람이 직접 INSERT 할 길이 없다 = append-only).
alter table public.drug_usage_audit enable row level security;
revoke all on table public.drug_usage_audit from anon, authenticated;
grant select on table public.drug_usage_audit to authenticated;

drop policy if exists dua_select_own_tenant on public.drug_usage_audit;
create policy dua_select_own_tenant on public.drug_usage_audit
  for select using (tenant_id in (select current_tenant_ids()));

-- 기록 트리거 — log_drug_price_change 와 같은 틀(AFTER UPDATE · DEFINER · 바뀐 칸만)
create or replace function public.log_drugs_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.prev_year_usage is distinct from old.prev_year_usage then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'prev_year_usage',
            old.prev_year_usage::text, new.prev_year_usage::text, old.usage_source, new.usage_source, auth.uid());
  end if;
  if new.recent_3m_usage is distinct from old.recent_3m_usage then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'recent_3m_usage',
            old.recent_3m_usage::text, new.recent_3m_usage::text, old.usage_source, new.usage_source, auth.uid());
  end if;
  if new.recent_1m_usage is distinct from old.recent_1m_usage then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'recent_1m_usage',
            old.recent_1m_usage::text, new.recent_1m_usage::text, old.usage_source, new.usage_source, auth.uid());
  end if;
  if new.monthly_avg is distinct from old.monthly_avg then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'monthly_avg',
            old.monthly_avg::text, new.monthly_avg::text, old.usage_source, new.usage_source, auth.uid());
  end if;
  if new.usage_source is distinct from old.usage_source then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'usage_source',
            old.usage_source, new.usage_source, old.usage_source, new.usage_source, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_log_drugs_usage on public.drugs;
create trigger trg_log_drugs_usage
  after update on public.drugs
  for each row execute function public.log_drugs_usage();

-- ═══════════════════════════════════════════════════════════════════
-- 2) 사용량 칸 owner 전용 트리거 (BEFORE UPDATE)
--    본보기는 enforce_price_edit_role — 「그 칸이 실제로 바뀐 경우에만」 역할을 본다.
--    ★ INSERT 에는 걸지 않는다. 신규 약품 등록은 사용량 칸을 아예 넣지 않으므로(1단계 A 확인)
--      직원의 약품 등록이 막히지 않는다.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.enforce_usage_edit_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  -- ★ SECURITY DEFINER 안에서 current_user 는 **함수 주인(postgres)** 으로 바뀐다.
  --   그걸로 관리자 여부를 보면 **모두가 관리자로 보여** 검사가 통째로 무력해진다
  --   (2026-11-02 dryrun 에서 일반 직원이 그대로 통과하는 것을 확인하고 고쳤다).
  --   session_user 는 SET ROLE·DEFINER 둘 다에 흔들리지 않는 **접속한 롤**이고,
  --   GUC 'role' 은 PostgREST 가 건 SET ROLE 결과(anon/authenticated/service_role)다.
  --   둘을 같이 봐야 「직접 접속한 관리자」와 「웹에서 들어온 사람」이 갈린다.
  v_srole text := session_user;
  v_grole text := coalesce(current_setting('role', true), 'none');
begin
  -- 사용량 칸이 하나도 안 바뀌었으면 그냥 통과(다른 칸 저장은 무영향)
  if not (new.prev_year_usage is distinct from old.prev_year_usage
       or new.recent_3m_usage is distinct from old.recent_3m_usage
       or new.recent_1m_usage is distinct from old.recent_1m_usage
       or new.monthly_avg     is distinct from old.monthly_avg
       or new.usage_source    is distinct from old.usage_source) then
    return new;
  end if;

  -- 예외는 둘뿐이다: service_role(JWT) · 직접 접속한 관리 롤(마이그레이션·관리 스크립트).
  -- ★ 「auth.uid() 가 NULL 이면 통과」로 적으면 **로그인 안 한 사람(anon)까지 통과**한다.
  --   anon 은 RLS 가 따로 막아 주지만, 보호를 RLS 한 겹에만 기대면 그 정책이 느슨해지는 날
  --   조용히 뚫린다. 그래서 여기서도 직접 막는다.
  -- 웹에서 들어온 사람은 PostgREST 가 SET ROLE 을 걸어 v_grole 이 anon/authenticated 이므로
  -- 아래 예외에 걸리지 않는다. 직접 접속한 관리자는 SET ROLE 을 걸지 않아 'none' 이다.
  if coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
     or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none') then
    return new;
  end if;

  if not exists (
    select 1 from public.tenant_members tm
     where tm.user_id = auth.uid()
       and tm.tenant_id = new.tenant_id
       and tm.role = 'owner'
  ) then
    raise exception '사용량은 최고 관리자만 수정할 수 있습니다'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_usage_edit_owner on public.drugs;
create trigger trg_enforce_usage_edit_owner
  before update on public.drugs
  for each row execute function public.enforce_usage_edit_owner();

-- ═══════════════════════════════════════════════════════════════════
-- 3) 음수 금지 CHECK — 세 칸만. 직전1개월은 **제외**(반납 등으로 음수가 정당하다).
--    NOT VALID 로 넣고 바로 VALIDATE 한다(현재 음수 0건 확인 완료 — 1단계 B).
-- ═══════════════════════════════════════════════════════════════════
alter table public.drugs drop constraint if exists drugs_prev_year_usage_nonneg;
alter table public.drugs drop constraint if exists drugs_recent_3m_usage_nonneg;
alter table public.drugs drop constraint if exists drugs_monthly_avg_nonneg;

alter table public.drugs
  add constraint drugs_prev_year_usage_nonneg check (prev_year_usage is null or prev_year_usage >= 0) not valid;
alter table public.drugs
  add constraint drugs_recent_3m_usage_nonneg check (recent_3m_usage is null or recent_3m_usage >= 0) not valid;
alter table public.drugs
  add constraint drugs_monthly_avg_nonneg     check (monthly_avg is null or monthly_avg >= 0) not valid;

alter table public.drugs validate constraint drugs_prev_year_usage_nonneg;
alter table public.drugs validate constraint drugs_recent_3m_usage_nonneg;
alter table public.drugs validate constraint drugs_monthly_avg_nonneg;

-- ═══════════════════════════════════════════════════════════════════
-- 4) app_recompute_usage — ★ (A)·(A2) 는 0051 정의를 **글자 그대로** 옮겼다.
--    더한 것은 두 가지뿐:
--      ⓐ 첫머리 owner 검사
--      ⓑ (B) 블록의 where 에 (A) 와 **같은 문구**의 manual 보호 줄
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.app_recompute_usage(p_overwrite_manual boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_count2 integer;
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_srole  text := session_user;                                    -- 접속한 롤 (SET ROLE 에 안 흔들린다)
  v_grole  text := coalesce(current_setting('role', true), 'none');  -- PostgREST 가 건 SET ROLE 결과
begin
  -- ⓐ owner 검사 — 0105 신규. 예외는 service_role(JWT)·직접 접속한 관리 롤뿐이다.
  --    ★ 「auth.uid() is null 이면 통과」로 적지 않는다 — 그러면 로그인 안 한 사람까지 통과한다.
  --    ★ current_user 도 쓰지 않는다 — 트리거 쪽 주석 참조(DEFINER 안에서 주인으로 바뀐다).
  if not (coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
          or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none')) then
    if not exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role = 'owner'
         and tm.tenant_id in (select current_tenant_ids())
    ) then
      raise exception '출고 자동집계는 최고 관리자만 실행할 수 있습니다'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- (A) recent_3m·prev_year·monthly_avg·safety·max: 출고 있는 약품만 갱신, manual 보존(기존 로직·무변경).
  with agg as (
    select t.drug_code,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
      sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
    from public.transactions t
    where t.type = '출고'
    group by t.drug_code
  ),
  calc as (
    select drug_code,
      coalesce(py, 0) as py,
      coalesce(r3, 0) as r3,
      case when coalesce(r3,0) > 0 then round(coalesce(r3,0) / 3.0)
           when coalesce(py,0) > 0 then round(coalesce(py,0) / 12.0)
           else null end as mavg
    from agg
  )
  update public.drugs d set
    prev_year_usage = c.py,
    recent_3m_usage = c.r3,
    monthly_avg  = coalesce(c.mavg, d.monthly_avg),
    safety_stock = case when c.mavg is not null then ceil(c.mavg * 1.2) else d.safety_stock end,
    max_stock    = case when c.mavg is not null then round(c.mavg * 3)   else d.max_stock end,
    usage_source = 'auto'
  from calc c
  where d.drug_code = c.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');
  get diagnostics v_count = row_count;

  -- (A2) 신규: (A)에서 빠진(출고 없음) 또는 manual 스킵된 약품 중 safety_stock 미설정 건을
  --      컬럼 폴백으로 채운다. 컬럼(prev_year/recent_3m)·usage_source 무변경, 빈 값만, mavg>0만.
  update public.drugs d set
    monthly_avg  = fb.mavg,
    safety_stock = ceil(fb.mavg * 1.2),
    max_stock    = round(fb.mavg * 3)
  from (
    select dd.drug_code,
      case
        when coalesce(txa.r3,0) > 0 then round(coalesce(txa.r3,0) / 3.0)
        when coalesce(txa.py,0) > 0 then round(coalesce(txa.py,0) / 12.0)
        when coalesce(dd.prev_year_usage,0) > 0 then round(coalesce(dd.prev_year_usage,0) / 12.0)
        when coalesce(dd.recent_3m_usage,0) > 0 then round(coalesce(dd.recent_3m_usage,0) / 3.0)
        else null
      end as mavg
    from public.drugs dd
    left join (
      select t.drug_code,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '12 months') as py,
        sum(t.quantity) filter (where t.transaction_date >= current_date - interval '3 months')  as r3
      from public.transactions t
      where t.type = '출고'
      group by t.drug_code
    ) txa on txa.drug_code = dd.drug_code
    where dd.status in ('사용','휴면')
      and coalesce(dd.safety_stock, 0) <= 0
      and coalesce(dd.monthly_avg, 0) <= 0
  ) fb
  where d.drug_code = fb.drug_code
    and fb.mavg is not null
    and fb.mavg > 0;
  get diagnostics v_count2 = row_count;

  -- (B) recent_1m_usage: 최근 1개월 출고 합(없으면 0).
  --     ★ 0105: (A) 와 **글자 그대로 같은** manual 보호 줄을 더했다.
  --       0046·0047 은 「직전1개월은 출고 사실」이라는 전제로 manual 게이트를 일부러 뺐는데,
  --       2026-08-07 PR #177 이 업로드 양식에 직전1개월 열을 더하면서 그 전제가 깨졌다.
  --       지금 업무 규칙은 「수기가 정본」이므로 수기 값을 지킨다.
  update public.drugs d set
    recent_1m_usage = coalesce(sub.r1, 0)
  from (
    select d2.drug_code, ag.r1
    from public.drugs d2
    left join (
      select t.drug_code, sum(t.quantity) as r1
      from public.transactions t
      where t.type = '출고'
        and t.transaction_date >= current_date - interval '1 month'
      group by t.drug_code
    ) ag on ag.drug_code = d2.drug_code
  ) sub
  where d.drug_code = sub.drug_code
    and (p_overwrite_manual or d.usage_source is distinct from 'manual');

  return v_count + v_count2;
end
$$;

commit;

-- ═══════════════════════════════════════════════════════════════════
-- 되돌리기 (참고 — 실행하지 않음). 0105b 를 먼저 되돌린 뒤 이것을 돌린다.
-- ═══════════════════════════════════════════════════════════════════
-- begin;
--   drop trigger if exists trg_enforce_usage_edit_owner on public.drugs;
--   drop function if exists public.enforce_usage_edit_owner();
--   drop trigger if exists trg_log_drugs_usage on public.drugs;
--   drop function if exists public.log_drugs_usage();
--   -- ★ 감사표는 지우지 않는다(기록이 증거다). 정말 지워야 하면 아래 두 줄을 사람이 직접 판단해 실행:
--   -- drop policy if exists dua_select_own_tenant on public.drug_usage_audit;
--   -- drop table if exists public.drug_usage_audit;
--   alter table public.drugs drop constraint if exists drugs_prev_year_usage_nonneg;
--   alter table public.drugs drop constraint if exists drugs_recent_3m_usage_nonneg;
--   alter table public.drugs drop constraint if exists drugs_monthly_avg_nonneg;
--   -- 함수는 0051 정의로 되돌린다: supabase/migrations/0051_recompute_column_fallback.sql 을 그대로 실행.
-- commit;
