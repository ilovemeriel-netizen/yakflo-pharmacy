-- 0052_guard_update_closed_month.sql  (0053 KST 교정 뒤 적용 — KST 산정 유지)
-- 목적: 마감월(monthly_snapshots 존재) 거래의 UPDATE를 INSERT·DELETE와 동일하게 차단.
--   · 0053에서 귀속월을 KST로 교정했으므로, 본 함수도 KST(AT TIME ZONE 'Asia/Seoul') 기준을 유지한다.
--   · UPDATE: old(원본 KST월)·new(대상 KST월) 중 하나라도 마감월이면 차단.
--   · ★ INSERT는 new만·DELETE는 old만 검사(tg_op 분기로 0053과 동일 동작 유지).
--   · 미마감월 무영향 · SECURITY DEFINER·search_path 유지.

create or replace function public.guard_closed_month_tx()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  -- INSERT·UPDATE: 대상(new) KST월이 마감월이면 차단 (INSERT 기존 동작 유지)
  if tg_op in ('INSERT','UPDATE') and exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = new.tenant_id
      and ms.snap_year  = extract(year  from (new.transaction_date at time zone 'Asia/Seoul'))::int
      and ms.snap_month = extract(month from (new.transaction_date at time zone 'Asia/Seoul'))::int
  ) then
    raise exception '마감된 월(%)의 거래는 수정할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(new.transaction_date at time zone 'Asia/Seoul', 'YYYY-MM') using errcode = 'check_violation';
  end if;

  -- DELETE·UPDATE: 원본(old) KST월이 마감월이면 차단 (DELETE 기존 동작 유지)
  if tg_op in ('DELETE','UPDATE') and exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = old.tenant_id
      and ms.snap_year  = extract(year  from (old.transaction_date at time zone 'Asia/Seoul'))::int
      and ms.snap_month = extract(month from (old.transaction_date at time zone 'Asia/Seoul'))::int
  ) then
    raise exception '마감된 월(%)의 거래는 수정할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(old.transaction_date at time zone 'Asia/Seoul', 'YYYY-MM') using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$function$;

drop trigger if exists trg_zz_block_update_closed_month on public.transactions;
create trigger trg_zz_block_update_closed_month
  before update on public.transactions
  for each row execute function public.guard_closed_month_tx();

-- 롤백(참고): drop trigger if exists trg_zz_block_update_closed_month on public.transactions;
--            그리고 0053 정의로 guard_closed_month_tx() 복원.