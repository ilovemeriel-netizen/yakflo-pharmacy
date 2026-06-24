-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0020 단가 변경 감사추적 drug_price_history + AFTER UPDATE 트리거 — 가역
-- 실행: Supabase Management API. IF NOT EXISTS / CREATE OR REPLACE(재실행 안전).
--
-- 목적: 구입단가(purchase_price)는 입고금액 직결 → 누가·언제·얼마→얼마 추적. (edi_price/price_unit 보류·Q2)
-- ▶ INSERT는 트리거(SECURITY DEFINER) 경유만. 직접 INSERT/UPDATE/DELETE 정책 없음(불가).
-- ▶ SELECT는 자기 테넌트만(RLS). 0019(권한 강제)와 직교 — 0019 통과한 변경만 commit→audit 기록.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.drug_price_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  drug_code   text not null,
  field       text not null,                 -- 'purchase_price' | 'edi_price'
  old_price   numeric,
  new_price   numeric,
  changed_by  uuid,                           -- auth.uid()
  changed_at  timestamptz not null default now(),
  source      text                            -- 변경 경로(선택)
);
create index if not exists idx_dph_tenant_drug on public.drug_price_history (tenant_id, drug_code, changed_at desc);

alter table public.drug_price_history enable row level security;

-- SELECT: 자기 테넌트만. (INSERT/UPDATE/DELETE 정책 없음 → 일반 사용자 직접쓰기 불가, 트리거 definer만)
drop policy if exists dph_select_own_tenant on public.drug_price_history;
create policy dph_select_own_tenant on public.drug_price_history
  for select using (tenant_id in (select current_tenant_ids()));

-- AFTER UPDATE 트리거: 단가 값이 실제 변경된 경우에만 기록(무변경 미기록)
create or replace function public.log_drug_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.purchase_price is distinct from old.purchase_price then
    insert into public.drug_price_history(tenant_id, drug_code, field, old_price, new_price, changed_by, source)
    values (new.tenant_id, new.drug_code, 'purchase_price', old.purchase_price, new.purchase_price, auth.uid(), 'drugs.update');
  end if;
  return new;
end $$;

drop trigger if exists trg_log_drug_price_change on public.drugs;
create trigger trg_log_drug_price_change
  after update on public.drugs
  for each row execute function public.log_drug_price_change();

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- drop trigger if exists trg_log_drug_price_change on public.drugs;
-- drop function if exists public.log_drug_price_change();
-- drop table if exists public.drug_price_history;
-- ════════════════════════════════════════════════════════════════
