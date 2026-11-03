-- 0107_fix_tx_dates_to_month_end.sql
--
-- 목적: 마감하려는 달보다 **뒤 날짜로 입력된 거래**의 날짜를 그 달 말일로 한 번에 바꾼다.
--
-- 왜 필요한가 (2026-11-03 실측)
--   · 업무 규칙상 **월마감을 누르기 전에 넣는 데이터는 이전 달 몫**이다(매월 초에 전달 마감).
--     그런데 입력 화면은 오늘 날짜를 기본으로 넣으므로, 11월 3일에 10월 실사를 넣으면
--     거래일이 11-03 이 된다. 그대로 마감하면 그 거래가 **다음 달로 새어 나간다**.
--   · 2026-10 에 실제로 15건이 그랬고, 손으로 SQL 을 돌려 고쳤다. 화면에는 거래 수정 기능이
--     없다(코드 전체에 transactions UPDATE 경로 0건). 그래서 이 함수를 둔다.
--
-- ★ 무엇을 바꾸나 — **거래일 한 칸뿐**이다.
--   수량·금액·약품·종류는 손대지 않는다. `transactions` 에는 **UPDATE 재고 트리거가 없으므로**
--   (apply_tx_to_inventory 는 INSERT, revert_tx_from_inventory 는 DELETE 전용)
--   `drugs.current_qty` 는 **한 개도 변하지 않는다**.
--
-- ★ 안 건드리는 것
--   · **이미 마감된 달의 거래** — OLD 날짜가 마감된 달이면 제외한다.
--     (마감 가드 트리거는 NEW 날짜만 보므로 그것만 믿으면 지나간다. 여기서 직접 막는다.)
--   · 대상 월(p_year·p_month) 자체가 이미 마감이면 아예 거절한다.
--   · 다른 약국(tenant)의 거래 — current_tenant_ids() 안에 있는 것만.
--
-- ★ 권한: owner·admin 만 (0105c 와 **같은 판정 방식**).
--   session_user·GUC role 예외, auth.uid() 필수, 거절 문구에 진단값.

begin;

create or replace function public.app_fix_tx_dates_to_month_end(
  p_year  integer,
  p_month integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  -- ★ SECURITY DEFINER 가 아니어도 current_user 는 쓰지 않는다 — 0105 에서 겪은 함정과
  --   같은 기준을 유지해, 두 함수의 판정이 갈라지지 않게 한다.
  v_srole text := session_user;
  v_grole text := coalesce(current_setting('role', true), 'none');
  v_mrole text;
  v_end   date;
  v_n     integer;
  v_note  text;
begin
  if p_year is null or p_month is null or p_month < 1 or p_month > 12 then
    raise exception '연·월이 올바르지 않습니다' using errcode = 'invalid_parameter_value';
  end if;

  v_end := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;

  -- ═══ 권한 — 0105c 와 같은 판정 ═══
  if not (coalesce(v_claims::jsonb ->> 'role', '') = 'service_role'
          or (v_srole in ('postgres', 'supabase_admin') and v_grole = 'none')) then
    if not exists (
      select 1 from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.role in ('owner', 'admin')
         and tm.tenant_id in (select current_tenant_ids())
    ) then
      select tm.role into v_mrole
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id in (select current_tenant_ids())
       limit 1;
      raise exception '거래일 정정은 관리자만 할 수 있습니다 [진단: uid=%, member_role=%, guc_role=%]',
        coalesce(left(auth.uid()::text, 8), '없음'),
        coalesce(v_mrole, '없음'),
        v_grole
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ═══ 대상 월이 이미 마감이면 거절 ═══
  if exists (
    select 1 from public.monthly_snapshots ms
     where ms.snap_year = p_year and ms.snap_month = p_month
       and ms.tenant_id in (select current_tenant_ids())
  ) then
    raise exception '%년 %월은 이미 마감되어 거래일을 바꿀 수 없습니다', p_year, p_month
      using errcode = 'check_violation';
  end if;

  v_note := '[' || to_char(current_date, 'YYYY-MM-DD') || ' 거래일 정정] 월마감 전 입력분 → 마감월 말일';

  -- ═══ 본체 — 거래일 한 칸만 ═══
  with target as (
    select t.id
      from public.transactions t
     where t.transaction_date > v_end
       and t.tenant_id in (select current_tenant_ids())
       -- ★ 이미 마감된 달의 거래는 건드리지 않는다
       and not exists (
         select 1 from public.monthly_snapshots ms
          where ms.tenant_id  = t.tenant_id
            and ms.snap_year  = extract(year  from t.transaction_date)::int
            and ms.snap_month = extract(month from t.transaction_date)::int
       )
  )
  update public.transactions u
     set transaction_date = v_end,
         memo = case when coalesce(u.memo, '') = '' then v_note else u.memo || ' / ' || v_note end
    from target
   where u.id = target.id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 실행 권한 — 로그인한 사람만. 역할 검사는 함수 본문이 한다(0105b 와 같은 방침).
revoke execute on function public.app_fix_tx_dates_to_month_end(integer, integer) from public;
revoke execute on function public.app_fix_tx_dates_to_month_end(integer, integer) from anon;
grant  execute on function public.app_fix_tx_dates_to_month_end(integer, integer) to authenticated;

commit;

-- ═══ 확인 (읽기 전용 — 함수를 실행하지 않는다) ═══
--   select has_function_privilege('anon','public.app_fix_tx_dates_to_month_end(integer,integer)','execute') as anon,
--          has_function_privilege('authenticated','public.app_fix_tx_dates_to_month_end(integer,integer)','execute') as authenticated;
--   → anon false · authenticated true

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   drop function if exists public.app_fix_tx_dates_to_month_end(integer, integer);
--   ⚠ 이미 바뀐 거래일은 되돌아가지 않는다(memo 에 정정 흔적이 남아 있으므로 손으로 되짚을 수는 있다).
