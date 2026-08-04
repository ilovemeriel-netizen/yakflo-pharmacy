-- 0054_guard_plain_date_extract.sql
-- 배경: transactions.transaction_date 는 date 타입(시각·타임존 없음)이라 귀속월에 UTC/KST 문제가 존재하지 않는다.
--       0053에서 추가한 (… AT TIME ZONE 'Asia/Seoul')는 date에는 불필요(항상 동월)하고 의미상 오해를 부른다.
-- 조치: 귀속월을 plain extract(year/month from transaction_date)로 되돌린다(원래의 정확한 로직).
--       0052에서 추가한 UPDATE 가드(old·new 양쪽 마감월 차단)는 유지한다.
--   · INSERT: new만 / DELETE: old만 / UPDATE: old·new 둘 다 검사.
--   · SECURITY DEFINER·search_path 유지. 마감월 차단 메시지 동일.

create or replace function public.guard_closed_month_tx()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  -- INSERT·UPDATE: 대상(new) 귀속월이 마감월이면 차단
  if tg_op in ('INSERT','UPDATE') and exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = new.tenant_id
      and ms.snap_year  = extract(year  from new.transaction_date)::int
      and ms.snap_month = extract(month from new.transaction_date)::int
  ) then
    raise exception '마감된 월(%)의 거래는 수정할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(new.transaction_date, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  -- DELETE·UPDATE: 원본(old) 귀속월이 마감월이면 차단
  if tg_op in ('DELETE','UPDATE') and exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = old.tenant_id
      and ms.snap_year  = extract(year  from old.transaction_date)::int
      and ms.snap_month = extract(month from old.transaction_date)::int
  ) then
    raise exception '마감된 월(%)의 거래는 수정할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(old.transaction_date, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$function$;

-- UPDATE 가드 트리거 보장(멱등)
drop trigger if exists trg_zz_block_update_closed_month on public.transactions;
create trigger trg_zz_block_update_closed_month
  before update on public.transactions
  for each row execute function public.guard_closed_month_tx();