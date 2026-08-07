-- 0056_drug_qty_audit.sql
-- 목적: drugs.current_qty 변경 감사 — updated_at 자동 + 변경 이력 테이블.
--   · drugs.updated_at(timestamptz) + moddatetime 트리거로 UPDATE 시 자동 갱신.
--   · drug_qty_audit: current_qty 변경 시 이전값·변경값·시각·변경자·경로 기록.
--   · 경로 = app.qty_via_tx 플래그로 판별('거래(trigger)' vs '직접').
--   · ★ 기존 데이터 소급 채우기 없음(신규 변경분부터). dryrun 필수 → apply 미실행.

-- 1) updated_at 컬럼 + 자동 갱신
create extension if not exists moddatetime;
alter table public.drugs add column if not exists updated_at timestamptz;
drop trigger if exists trg_drugs_moddatetime on public.drugs;
create trigger trg_drugs_moddatetime
  before update on public.drugs
  for each row execute procedure moddatetime(updated_at);

-- 2) 수량 변경 이력 테이블
create table if not exists public.drug_qty_audit (
  id          bigint generated always as identity primary key,
  tenant_id   uuid,
  drug_code   text,
  drug_name   text,
  old_qty     numeric,
  new_qty     numeric,
  delta       numeric,
  changed_at  timestamptz not null default now(),
  changed_by  uuid,
  path        text
);
create index if not exists idx_drug_qty_audit_code on public.drug_qty_audit(drug_code, changed_at desc);

-- 3) 변경 로깅 트리거(AFTER UPDATE, current_qty 변경 시에만)
create or replace function public.log_drugs_qty()
returns trigger language plpgsql security definer set search_path = 'public' as $function$
begin
  if new.current_qty is distinct from old.current_qty then
    insert into public.drug_qty_audit(tenant_id, drug_code, drug_name, old_qty, new_qty, delta, changed_by, path)
    values (new.tenant_id, new.drug_code, new.drug_name, old.current_qty, new.current_qty,
            coalesce(new.current_qty,0) - coalesce(old.current_qty,0),
            auth.uid(),
            case when coalesce(current_setting('app.qty_via_tx', true),'off')='on' then '거래(trigger)' else '직접' end);
  end if;
  return new;
end $function$;

drop trigger if exists trg_log_drugs_qty on public.drugs;
create trigger trg_log_drugs_qty
  after update on public.drugs
  for each row execute function public.log_drugs_qty();

-- 롤백(참고): drop trigger if exists trg_log_drugs_qty on public.drugs;
--            drop trigger if exists trg_drugs_moddatetime on public.drugs;
--            drop table if exists public.drug_qty_audit; alter table public.drugs drop column if exists updated_at;