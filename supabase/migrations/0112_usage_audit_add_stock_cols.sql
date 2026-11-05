-- 0112_usage_audit_add_stock_cols.sql
-- 목적: 사용량 감사표(drug_usage_audit)에 **안전재고·최대재고**도 기록한다.
--
-- ★ 왜 — 지금 감사표는 사용량 5칸(prev_year·recent_3m·recent_1m·monthly_avg·usage_source)만
--   남긴다. 그런데 `app_recompute_usage` 는 safety_stock·max_stock 도 함께 바꾼다.
--   그 두 칸은 **발주 기준**이라 「언제 누가 왜 바뀌었나」가 가장 중요한데 기록이 없다.
--   2026-11-05 마약·향정 적용에서도 안전 1,060→1,035 · 최대 2,628→2,568 이 바뀌었으나
--   감사표에는 그 흔적이 남지 않았다(사용량 칸만 36줄).
--
-- ★ 범위 — **기록만 더한다.**
--   · 권한·정책·가드는 **한 글자도 바꾸지 않는다.** 특히 `enforce_usage_edit_owner()` 는 건드리지 않는다
--     (그 함수는 「무엇을 막을지」를 정하고, 이 함수는 「무엇을 적을지」만 정한다. 섞으면 안 된다).
--   · 지난 기록은 **그대로 둔다.** 소급해서 채우지 않는다 — 없던 기록을 만들어 내면 감사표가 거짓이 된다.
--   · 트리거 배선(trg_log_drugs_usage)은 **다시 걸지 않는다.** 함수 본문만 갈아 끼운다.
--   · 계산식·저장값은 무변경. 이 파일은 `drugs` 를 수정하지 않는다.
--
-- ★ 왜 CHECK 제약을 함께 넓히나
--   `field` 칸에 허용 목록(CHECK)이 걸려 있으면 새 이름 두 개가 **INSERT 에서 거절**된다.
--   그러면 트리거가 터져 **사용량 저장 자체가 막힌다**(기록을 더하려다 저장을 깨는 꼴).
--   그래서 제약이 있으면 **먼저 넓힌다** — 권한 규칙과 같은 방향이다(넓히는 변경은 먼저).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) field 허용 목록이 있으면 넓힌다 (없으면 아무 일도 하지 않는다)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
   where n.nspname = 'public' and cl.relname = 'drug_usage_audit'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%field%'
   limit 1;

  if v_name is null then
    raise notice '0112: field 에 걸린 허용 목록(CHECK)이 없다 — 넓힐 것이 없다';
  else
    execute format('alter table public.drug_usage_audit drop constraint %I', v_name);
    alter table public.drug_usage_audit
      add constraint drug_usage_audit_field_chk
      check (field in ('prev_year_usage', 'recent_3m_usage', 'recent_1m_usage',
                       'monthly_avg', 'usage_source',
                       'safety_stock', 'max_stock'));          -- ★ 새로 더한 둘
    raise notice '0112: 허용 목록 % 를 safety_stock·max_stock 까지 넓혔다', v_name;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 기록 함수 — 기존 5칸은 **글자 그대로 그대로** 두고 두 칸만 뒤에 붙인다
--    ★ SECURITY DEFINER·search_path 는 지금 것과 같다(0105 틀 유지).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.log_drugs_usage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- ★ 2026-11-05 이정화 님 승인 — 여기서부터 새로 더한 둘. 발주 기준이 바뀐 흔적을 남긴다.
  if new.safety_stock is distinct from old.safety_stock then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'safety_stock',
            old.safety_stock::text, new.safety_stock::text, old.usage_source, new.usage_source, auth.uid());
  end if;
  if new.max_stock is distinct from old.max_stock then
    insert into public.drug_usage_audit(tenant_id, drug_code, field, old_value, new_value, old_source, new_source, changed_by)
    values (new.tenant_id, new.drug_code, 'max_stock',
            old.max_stock::text, new.max_stock::text, old.usage_source, new.usage_source, auth.uid());
  end if;

  return new;
end $function$;

-- ★ 트리거 배선은 0105 것을 그대로 쓴다 — drop/create trigger 를 하지 않는다.

-- 함수 본문만 바꿨으므로 스키마 캐시 갱신이 꼭 필요하진 않지만, 습관으로 둔다(함정 #22).
notify pgrst, 'reload schema';

commit;
